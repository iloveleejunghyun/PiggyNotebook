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

// label is just for console tracing — every one of the 4 prompt functions
// passes its own name so you can see, per call, which prompt ran and
// exactly what the model said back (the raw JSON/text, before parsing).
async function chatCompletion(messages, temperature = 0.3, label = 'ai') {
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
    console.error(`[AI:${label}] network error:`, e.errMsg || e.message)
    throw new AIServiceUnavailableError(`Network error calling Qianfan: ${e.errMsg || e.message}`)
  }

  if (res.statusCode !== 200) {
    console.error(`[AI:${label}] HTTP ${res.statusCode}:`, res.data)
    throw new AIServiceUnavailableError(`Qianfan API HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`)
  }
  const content = res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message
    ? res.data.choices[0].message.content
    : null
  if (!content) {
    console.error(`[AI:${label}] no content in response:`, res.data)
    throw new AIServiceUnavailableError('Qianfan API returned no content')
  }
  console.log(`[AI:${label}] raw response:`, content)
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
4. 特殊情况：如果用户当前使用中文记录，而这条碎片本身是一个英语单词/短语/句子（哪怕没有明确提问"这是什么意思"），这通常意味着用户在学英语——如果已有主题里存在类似"英语学习"这样的主题，优先归入那个主题，而不是新建一个新的英语相关主题（比如"日常词汇记录"）。

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
  const content = await chatCompletion([{ role: 'user', content: prompt }], 0.1, 'suggestTopic')
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
3. 特殊情况：如果用户当前使用中文记录，而这条碎片本身是一个英语单词/短语/句子，且当前主题或"其他已有主题"里存在类似"英语学习"这样的主题，判定适合归入那个英语学习类主题。

如果判定不适合，需要给出更合适的去向——这个产品的核心目的是防止想法过度分散在太多主题里，所以：
- 优先从"其他已有主题"里选一个合理关联的（哪怕关联很松散），而不是新建主题。
- 只有确实和所有已有主题都无关时，才新建主题，且新主题要宽泛，不要为单条碎片开一个过窄的新主题。

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
  const content = await chatCompletion([{ role: 'user', content: prompt }], 0.1, 'checkTopicFit')
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
2. 特殊情况：如果用户当前使用中文记录，而这条碎片本身是一个英语单词/短语/句子——即使没有明确提问"这是什么意思"——也应当假设用户是想了解它的含义，判定需要回答（给出中文释义/翻译）。
3. 如果碎片是问题/术语/请求解释，但你并不确信答案的准确性，也判定不需要回答——绝对不要编造或猜测，宁可不答。
4. 只有当碎片明显需要回答，且你确信答案正确时，才给出回答。回答要简洁，不超过80字。

只输出一个 JSON 对象，不要输出其他任何文字：
- 不需要回答：{"needsAnswer": false}
- 需要且能回答：{"needsAnswer": true, "answer": "回答内容"}`

  const content = await chatCompletion([{ role: 'user', content: prompt }], 0.3, 'answerIfNeeded')
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
 * @param {{title: string, fragments: Array<{text: string, aiAnswer?: string}>}} topic
 * @returns {Promise<string>} the new summary text
 * @throws {AIServiceUnavailableError} when the service isn't configured or the call fails
 */
export async function summarizeTopic(topic) {
  // Include each fragment's AI answer (if any) — otherwise the model has no
  // way to compile a glossary/reference list of things it already explained.
  const fragmentList = topic.fragments.map((f, i) => {
    const base = `${i + 1}. ${f.text}`
    return f.aiAnswer ? `${base}（AI 解释：${f.aiAnswer}）` : base
  }).join('\n')

  const prompt = `你是一个笔记整理助手。下面是用户在主题"${topic.title}"下陆续记录的所有碎片想法，请把它们整理成一份有用的汇总，帮用户快速回顾。

汇总格式要求：
1. 用要点（每条以"- "开头另起一行）呈现用户的具体观点/想法，不要写"探讨了…""指出…不一定好"这种空洞的转述句——直接写出用户的实际观点或结论本身是什么。
2. 如果多条碎片属于同一个子话题，把它们归并成一组要点放在一起，不要逐条罗列重复内容；如果明显能分成几类，可以用简短的小标题分组。
3. 如果碎片信息不完整（比如只写了一个单词/术语），且是你确信无误的常识性知识，可以补充，但绝不能编造。
4. 如果碎片里有 AI 解释（比如单词、短语的含义/翻译），额外在汇总末尾整理一个独立的"词汇列表"部分，每行一个"词语 —— 含义"，方便用户快速查阅；正文部分不用重复这些含义。

主体部分不超过300字（词汇列表另计，但保持简洁）。直接输出汇总正文，不要加任何前缀、解释或"以下是汇总"之类的话。

碎片记录：
${fragmentList}`

  const content = await chatCompletion([{ role: 'user', content: prompt }], 0.3, 'summarizeTopic')
  return content.trim()
}

export { AIServiceUnavailableError }
