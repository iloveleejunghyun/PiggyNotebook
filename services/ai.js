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
  console.log(`[AI:${label}] prompt sent:\n` + messages.map(m => `--- ${m.role} ---\n${m.content}`).join('\n'))
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

// Titles that say nothing about the subject. A topic with one of these names
// becomes a black hole that swallows every later note, so a model-chosen title
// like this is rejected in code (a title the user typed themselves is kept).
const CATCH_ALL_TITLES = new Set([
  'misc', 'miscellaneous', 'other', 'others', 'notes', 'note', 'random',
  'random thoughts', 'thoughts', 'general', 'uncategorized', 'untitled'
])

function isCatchAllTitle(title) {
  return CATCH_ALL_TITLES.has(title.toLowerCase().replace(/[^a-z ]/g, '').trim())
}

// Turn the model's JSON into a decision the app can act on, or say exactly
// what was wrong with it. All branching lives here, not in the prompt.
function interpretRouting(parsed, options, originalText, currentTopic) {
  const explicit = parsed.explicit_new_topic === true
  let choice = parsed.choice
  if (typeof choice === 'string' && /^\d+$/.test(choice.trim())) choice = parseInt(choice, 10)
  if (explicit) choice = 0

  if (!Number.isInteger(choice) || choice < 0 || choice > options.length) {
    return { ok: false, reason: `"choice" must be an integer from 0 to ${options.length}` }
  }

  if (choice === 0) {
    const title = typeof parsed.new_topic_title === 'string' ? parsed.new_topic_title.trim() : ''
    if (!title) return { ok: false, reason: '"new_topic_title" is required when choice is 0' }
    if (!explicit && isCatchAllTitle(title)) {
      return { ok: false, reason: `"${title}" is too vague as a topic title; name the specific subject` }
    }
    return {
      ok: true,
      value: {
        decision: 'new',
        topicId: null,
        suggestedTitle: title.slice(0, 40), // matches the review sheet's input limit
        isNewTopic: true,
        explicit
      }
    }
  }

  const option = options[choice - 1]
  return {
    ok: true,
    value: {
      decision: option.kind,
      topicId: option.kind === 'keep' ? currentTopic.id : option.topicId,
      suggestedTitle: option.title,
      isNewTopic: false,
      explicit: false
    }
  }
}

/**
 * Decide where a new note belongs, in ONE call. This replaces the old
 * suggestTopic (no topics yet) and checkTopicFit (a topic is selected): with
 * no topics at all, currentTopic is null and otherTopics is empty, so the only
 * option left is "create a new topic" and the model just proposes a title.
 *
 * The model picks a numbered option instead of walking a decision tree, and
 * always returns the same JSON shape. Everything that follows from the pick is
 * decided in code by the caller.
 *
 * @param {string} text - the raw note text
 * @param {{id: string, title: string}|null} currentTopic - the selected topic, or null
 * @param {Array<{id: string, title: string}>} otherTopics - every other existing topic
 * @returns {Promise<{
 *   decision: 'keep'|'move'|'new',
 *   topicId: string|null,      // the topic to save into (null when decision is 'new')
 *   suggestedTitle: string,    // existing topic's title, or the proposed new title
 *   isNewTopic: boolean,
 *   explicit: boolean          // the user asked for a new topic: follow it, skip confirmation
 * }>}
 * @throws {AIServiceUnavailableError} when the service isn't configured, the call fails,
 *   or the reply is still invalid after one retry
 */
export async function chooseTopic(text, currentTopic, otherTopics) {
  // Option 0 is always "new topic". The rest are numbered here so the model
  // picks a number instead of copying opaque topic ids.
  const options = []
  if (currentTopic) options.push({ kind: 'keep', title: currentTopic.title })
  otherTopics.forEach(t => options.push({ kind: 'move', title: t.title, topicId: t.id }))

  const optionLines = [
    '0) Create a new topic',
    ...options.map((o, i) => o.kind === 'keep'
      ? `${i + 1}) Keep in the current topic: "${o.title}"`
      : `${i + 1}) Move to the topic: "${o.title}"`)
  ].join('\n')

  const prompt = `You are a note-organizing assistant. The user just wrote a quick note. Decide where it belongs by picking exactly one option number.

Options:
${optionLines}

Rules:
1. This product exists to stop notes from scattering across too many topics. Prefer an existing option whenever the note has any plausible connection to it, even a loose one (a single word, an abbreviation).
2. If there is a current topic, lean toward keeping it. Pick another option only when the note clearly belongs somewhere else.
3. Pick 0 (new topic) only when the note is unrelated to every option. Keep the new topic broad, at most 6 words, and never name it something vague like "Misc", "Other", "Notes" or "Random". If you cannot tell the subject, use the note's own key words as the title.
4. Do not pick an option just because its name is vague ("Misc", "Other"). Pick it only if the note has no specific subject at all.
5. If the user explicitly asks for a new topic ("new topic: ...", "create a topic called ..."), always pick 0, set explicit_new_topic to true, and set new_topic_title to a short topic name (2-4 words) that captures what the note is about. If the user gave a name, use it; otherwise abstract the name from the note's content.
6. A note that merely mentions the words "new topic" without asking for one (for example "I should write a new topic outline") is a normal note, so explicit_new_topic is false.

Examples (in these examples the options were: 0) new topic, 1) keep current: "Sleep", 2) move to: "Startup Ideas"):
Note: "No screens after 10pm" -> {"choice": 1, "new_topic_title": null, "explicit_new_topic": false}
Note: "Pricing test: charge $9 for the first month" -> {"choice": 2, "new_topic_title": null, "explicit_new_topic": false}
Note: "Renew passport in October" -> {"choice": 0, "new_topic_title": "Travel Admin", "explicit_new_topic": false}
Note: "New topic: gym - squats on Monday" -> {"choice": 0, "new_topic_title": "Gym", "explicit_new_topic": true}

The user's note:
"""
${text}
"""

Reply with only a JSON object with exactly these four keys:
{"choice": <option number>, "new_topic_title": <string when choice is 0, otherwise null>, "explicit_new_topic": <true or false>}`

  const tryInterpret = reply => {
    let parsed
    try {
      parsed = extractJSON(reply)
    } catch (e) {
      return { ok: false, reason: 'the reply was not a valid JSON object' }
    }
    return interpretRouting(parsed, options, text, currentTopic)
  }

  // Low temperature: classification, not creative writing.
  const messages = [{ role: 'user', content: prompt }]
  let reply = await chatCompletion(messages, 0, 'chooseTopic')
  let result = tryInterpret(reply)

  if (!result.ok) {
    // One retry, showing the model what was wrong with its own reply. The
    // temperature is 0, so an identical retry would just repeat the mistake.
    messages.push(
      { role: 'assistant', content: reply },
      { role: 'user', content: `Your reply was not valid: ${result.reason}. Reply again with only the JSON object in the required format.` }
    )
    reply = await chatCompletion(messages, 0, 'chooseTopic:retry')
    result = tryInterpret(reply)
  }

  if (!result.ok) {
    throw new AIServiceUnavailableError(`AI routing reply was invalid: ${result.reason}`)
  }
  return result.value
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
  const prompt = `You are a notes assistant. The user just recorded a new fragment under the topic "${topic.title}". Determine whether this fragment is a question, a term/word lacking context (e.g. just a single foreign word), or a request for you to explain or act on something.

Topic background (for reference, may be empty):
${topic.summary || '(none yet)'}

The user's new fragment:
"""
${text}
"""

Rules:
1. If the fragment is simply a plain statement, thought, or plan (not a question or request for explanation), decide no answer is needed.
2. Special case: if this fragment is a word/phrase/sentence in a different language than the rest of the user's notes — even without explicitly asking "what does this mean" — assume the user wants to know its meaning, and decide an answer is needed (give its meaning/translation).
3. If the fragment is a question/term/request for explanation but you're not confident the answer is accurate, also decide no answer is needed — never fabricate or guess; when in doubt, stay silent.
4. Only give an answer when the fragment clearly needs one and you're confident it's correct. Keep the answer concise, no more than 60 words.

Output only a JSON object, nothing else:
- No answer needed: {"needsAnswer": false}
- Needed and answerable: {"needsAnswer": true, "answer": "the answer"}`

  const content = await chatCompletion([{ role: 'user', content: prompt }], 0.1, 'answerIfNeeded')
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
    return f.aiAnswer ? `${base} (AI explanation: ${f.aiAnswer})` : base
  }).join('\n')

  const prompt = `You are a note-organizing assistant. Below are all the fragments the user has recorded over time under the topic "${topic.title}" — organize them into a useful summary to help the user quickly review.

Summary format requirements:
1. Present the user's actual views/thoughts as bullet points (each starting with "- " on its own line) — don't write hollow paraphrases like "discussed…" or "pointed out that… isn't necessarily good" — write out what the user's actual view or conclusion actually is.
2. If multiple fragments belong to the same sub-topic, group them into one set of bullets together rather than listing overlapping content repeatedly; if there are clear categories, group them under short sub-headings.
3. If a fragment's information is incomplete (e.g. just a single word/term), you may supplement it with common-knowledge facts you're confident are correct, but never fabricate.
4. If any fragment has an AI explanation attached (e.g. a word or phrase's meaning/translation), additionally compile a separate "Glossary" section at the end of the summary, one line per "term — meaning," so the user can look them up quickly; don't repeat these meanings in the main body.

Keep the main body under 200 words (the glossary is separate, but keep it concise too). Output only the summary text directly, no prefix, explanation, or phrases like "here is the summary."

Fragments:
${fragmentList}`

  const content = await chatCompletion([{ role: 'user', content: prompt }], 0.3, 'summarizeTopic')
  return content.trim()
}

export { AIServiceUnavailableError }

