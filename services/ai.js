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

async function chatCompletion(messages, temperature = 0.3) {
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
        temperature
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

  const prompt = `你是一个笔记整理助手，帮用户把随手记下的碎片想法归类到"主题"下。

重要原则：这个产品的核心目的就是防止用户的想法过度分散在太多主题里，所以：
1. 只要碎片和某个已有主题存在合理关联——哪怕碎片很短、很模糊（比如一个单词、一个缩写），只要它可能是该主题下的一个细节或子项——就优先把它归入那个已有主题，不要新建主题。
2. 只有当碎片明显和所有已有主题都无关时，才新建主题。
3. 新建主题也要谨慎：主题应该是一个较宽泛的领域/项目/话题，不要为单条碎片单独开一个过于具体、狭窄的新主题。

已有主题列表：
${topicList}

用户新记录的碎片：
"""
${text}
"""

只输出一个 JSON 对象，不要输出其他任何文字，格式如下：
{"topicId": "已有主题的id，如果新建主题则为null", "suggestedTitle": "主题名称（已有主题则原样返回其title，新主题则给一个简洁的标题，不超过12个字）", "isNewTopic": true或false}`

  // Low temperature — this is a classification task, we want consistent
  // categorization, not creative variation between near-identical inputs.
  const content = await chatCompletion([{ role: 'user', content: prompt }], 0.1)
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
 * Check whether a fragment fits the topic the user currently has selected
 * (the fast path — most captures should land here without ever calling
 * suggestTopic). Only flags a mismatch when the fragment is clearly about
 * something else; ambiguous/short fragments default to "fits".
 * @param {string} text - the raw fragment text
 * @param {{title: string}} currentTopic - the topic currently selected
 * @param {Array<{id: string, title: string}>} otherTopics - every other existing topic
 * @returns {Promise<{ fits: true } | { fits: false, topicId: string|null, suggestedTitle: string, isNewTopic: boolean }>}
 * @throws {AIServiceUnavailableError} when the service isn't configured or the call fails
 */
export async function checkTopicFit(text, currentTopic, otherTopics) {
  const otherList = otherTopics.length
    ? otherTopics.map(t => `- id: ${t.id}, title: ${t.title}`).join('\n')
    : '(无其他主题)'

  const prompt = `你是一个笔记整理助手。用户当前正在"${currentTopic.title}"这个主题下连续记录碎片想法，现在新记了一条，请判断它是否仍然适合归入当前主题。

判断标准（宁可判定"适合"，也不要轻易判定"不适合"）：
1. 只要碎片和当前主题存在合理关联——哪怕很简短、模糊（比如一个单词、一个缩写），只要可能是当前主题下的一个细节或子项——就判定为适合。
2. 只有当碎片明显、清晰地属于下面列出的另一个主题，或者明显是一个全新的、无关的话题时，才判定为不适合。

当前主题："${currentTopic.title}"

其他已有主题：
${otherList}

用户新记录的碎片：
"""
${text}
"""

只输出一个 JSON 对象，不要输出其他任何文字：
- 如果适合归入当前主题：{"fits": true}
- 如果不适合，给出更合适的去向：{"fits": false, "topicId": "更合适的已有主题id，如果建议新建主题则为null", "suggestedTitle": "主题名称（已有主题则原样返回其title，新主题则给一个简洁的标题，不超过12个字）", "isNewTopic": true或false}`

  // Low temperature — this is a classification task, not creative writing.
  const content = await chatCompletion([{ role: 'user', content: prompt }], 0.1)
  const parsed = extractJSON(content)

  if (typeof parsed.fits !== 'boolean') {
    throw new AIServiceUnavailableError(`AI JSON response missing "fits" field: ${content}`)
  }
  if (parsed.fits) return { fits: true }

  if (typeof parsed.suggestedTitle !== 'string' || typeof parsed.isNewTopic !== 'boolean') {
    throw new AIServiceUnavailableError(`AI JSON response missing expected fields: ${content}`)
  }
  return {
    fits: false,
    topicId: parsed.isNewTopic ? null : (parsed.topicId || null),
    suggestedTitle: parsed.suggestedTitle,
    isNewTopic: parsed.isNewTopic
  }
}

/**
 * Single-shot, best-effort answer to a fragment that reads like a question,
 * a bare term needing context (e.g. a vocab word), or a request to explain
 * something. NOT a chat — one question, one answer, no follow-up thread.
 * Stays silent (needsAnswer: false) unless the AI is actually confident,
 * per the project's no-hallucination rule.
 * @param {string} text - the raw fragment text
 * @param {{title: string, summary: string}} topic - context for grounding the answer
 * @returns {Promise<{ needsAnswer: false } | { needsAnswer: true, answer: string }>}
 * @throws {AIServiceUnavailableError} when the service isn't configured or the call fails
 */
export async function answerIfNeeded(text, topic) {
  const prompt = `你是一个笔记助手。用户在主题"${topic.title}"下记了一条新碎片。请判断这条碎片是否是一个问题、一个缺乏上下文的术语/单词（比如只写了一个英语单词），或者是一个让你解释/行动的请求。

主题背景（供参考，可能为空）：
${topic.summary || '(暂无)'}

用户新记录的碎片：
"""
${text}
"""

判断规则：
1. 如果这条碎片只是单纯的陈述、想法、计划记录（不是在提问或要求解释），判定不需要回答。
2. 如果碎片是问题/术语/请求解释，但你并不确信答案的准确性，也判定不需要回答——绝对不要编造或猜测，宁可不答。
3. 只有当碎片明显需要回答，且你确信答案正确时，才给出回答。回答要简洁，不超过80字。

只输出一个 JSON 对象，不要输出其他任何文字：
- 不需要回答：{"needsAnswer": false}
- 需要且能回答：{"needsAnswer": true, "answer": "回答内容"}`

  const content = await chatCompletion([{ role: 'user', content: prompt }])
  const parsed = extractJSON(content)

  if (typeof parsed.needsAnswer !== 'boolean') {
    throw new AIServiceUnavailableError(`AI JSON response missing "needsAnswer" field: ${content}`)
  }
  if (!parsed.needsAnswer) return { needsAnswer: false }

  if (typeof parsed.answer !== 'string' || !parsed.answer.trim()) {
    throw new AIServiceUnavailableError(`AI said needsAnswer=true but gave no answer: ${content}`)
  }
  return { needsAnswer: true, answer: parsed.answer.trim() }
}

/**
 * Ask the AI to regenerate a topic's rolling summary from all its fragments.
 * @param {{title: string, fragments: Array<{text: string}>}} topic
 * @returns {Promise<string>} the new summary text
 * @throws {AIServiceUnavailableError} when the service isn't configured or the call fails
 */
export async function summarizeTopic(topic) {
  const fragmentList = topic.fragments.map((f, i) => `${i + 1}. ${f.text}`).join('\n')

  const prompt = `你是一个笔记整理助手。下面是用户在主题"${topic.title}"下陆续记录的所有碎片想法，请把它们汇总成一段连贯的摘要，帮用户回顾这个主题下的完整思路脉络。

补充规则：如果某条碎片信息不完整（比如只写了一个单词、术语、人名，没有附带解释），并且这是你确信无误的常识性知识（比如单词释义、术语定义），可以在汇总里顺带补充，省得用户回头自己查。但如果你不确定，绝对不要编造——照实记录用户写的原文就好，不要编造事实。

不超过200字，直接输出摘要正文，不要加任何前缀或解释。

碎片记录：
${fragmentList}`

  const content = await chatCompletion([{ role: 'user', content: prompt }])
  return content.trim()
}

export { AIServiceUnavailableError }
