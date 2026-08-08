// AI integration: 百度千帆v2 (ERNIE), called directly from the client.
//
// Decision (per user, see conversation): no proxy backend for MVP — the API
// key ships embedded in the app. Known tradeoff: the key is extractable from
// the client bundle. Keep the beta small/private until retention is proven;
// revisit a proxy before any wider paid rollout.
//
// Real key lives in ai.config.js (gitignored). See ai.config.example.js.

import { AI_CONFIG } from './ai.config.js'

const QIANFAN_V2_BASE = 'https://qianfan.baidubce.com/v2'

class AIServiceUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AIServiceUnavailableError'
  }
}

function assertConfigured() {
  if (!AI_CONFIG.apiKey) {
    throw new AIServiceUnavailableError(
      'AI service is not configured yet — fill in apiKey in services/ai.config.js.'
    )
  }
}

async function chatCompletion(messages) {
  assertConfigured()
  let res
  try {
    res = await uni.request({
      url: `${QIANFAN_V2_BASE}/chat/completions`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_CONFIG.apiKey}`
      },
      data: {
        model: AI_CONFIG.model,
        messages,
        temperature: 0.3
      }
    })
  } catch (e) {
    throw new AIServiceUnavailableError(`Network error calling Qianfan: ${e.errMsg || e.message}`)
  }

  if (res.statusCode !== 200) {
    throw new AIServiceUnavailableError(`Qianfan API HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`)
  }
  const content = res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message
    ? res.data.choices[0].message.content
    : null
  if (!content) {
    throw new AIServiceUnavailableError('Qianfan API returned no content')
  }
  return content
}

// Models sometimes wrap JSON in prose or ```json fences — pull out the
// first {...} block rather than trusting content to be pure JSON.
function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new AIServiceUnavailableError(`AI response was not valid JSON: ${text}`)
  try {
    return JSON.parse(match[0])
  } catch (e) {
    throw new AIServiceUnavailableError(`Failed to parse AI JSON response: ${e.message}`)
  }
}

/**
 * Ask the AI to suggest an existing topic or a brand-new topic title for a fragment.
 * @param {string} text - the raw fragment text
 * @param {Array<{id: string, title: string}>} existingTopics
 * @returns {Promise<{ topicId: string|null, suggestedTitle: string, isNewTopic: boolean }>}
 * @throws {AIServiceUnavailableError} when the service isn't configured or the call fails
 */
export async function suggestTopic(text, existingTopics) {
  const topicList = existingTopics.length
    ? existingTopics.map(t => `- id: ${t.id}, title: ${t.title}`).join('\n')
    : '(暂无已有主题)'

  const prompt = `你是一个笔记整理助手。用户随手记录了一条碎片想法，你需要判断它属于下面哪个已有主题，或者需要新建一个主题。

已有主题列表：
${topicList}

用户新记录的碎片：
"""
${text}
"""

只输出一个 JSON 对象，不要输出其他任何文字，格式如下：
{"topicId": "已有主题的id，如果是新主题则为null", "suggestedTitle": "主题名称（已有主题则原样返回其title，新主题则给一个简洁的标题，不超过12个字）", "isNewTopic": true或false}`

  const content = await chatCompletion([{ role: 'user', content: prompt }])
  const parsed = extractJSON(content)

  if (typeof parsed.suggestedTitle !== 'string' || typeof parsed.isNewTopic !== 'boolean') {
    throw new AIServiceUnavailableError(`AI JSON response missing expected fields: ${content}`)
  }
  return {
    topicId: parsed.isNewTopic ? null : (parsed.topicId || null),
    suggestedTitle: parsed.suggestedTitle,
    isNewTopic: parsed.isNewTopic
  }
}

/**
 * Ask the AI to regenerate a topic's rolling summary from all its fragments.
 * @param {{title: string, fragments: Array<{text: string}>}} topic
 * @returns {Promise<string>} the new summary text
 * @throws {AIServiceUnavailableError} when the service isn't configured or the call fails
 */
export async function summarizeTopic(topic) {
  const fragmentList = topic.fragments.map((f, i) => `${i + 1}. ${f.text}`).join('\n')

  const prompt = `你是一个笔记整理助手。下面是用户在主题"${topic.title}"下陆续记录的所有碎片想法，请把它们汇总成一段连贯的摘要，帮用户回顾这个主题下的完整思路脉络。不超过200字，直接输出摘要正文，不要加任何前缀或解释。

碎片记录：
${fragmentList}`

  const content = await chatCompletion([{ role: 'user', content: prompt }])
  return content.trim()
}

export { AIServiceUnavailableError }
