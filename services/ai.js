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

// Pull the two tagged blocks out of the reply. Tags instead of JSON: the
// summary is long multi-line Markdown, which models often break when they have
// to escape it inside a JSON string.
function parseNoteReply(content) {
  const block = tag => {
    const m = content.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
    return m ? m[1].trim() : null
  }
  const reply = block('reply')
  const summary = block('summary')
  if (reply === null) return { ok: false, reason: 'missing <reply>...</reply> block' }
  if (!summary) return { ok: false, reason: 'missing or empty <summary>...</summary> block' }
  return {
    ok: true,
    value: { reply: /^none$/i.test(reply) || !reply ? null : reply, summary }
  }
}

/**
 * ONE call per saved note, replacing the old answerIfNeeded + summarizeTopic
 * pair. Because the reply and the summary are written in the same pass, the
 * summary (and its Glossary) always includes the reply to the new note, and
 * there is nothing left to race.
 *
 * @param {{title: string, fragments: Array<{id: string, text: string, aiAnswer?: string|null}>}} topic
 *   the topic AFTER the new note was saved (the new note is one of its fragments)
 * @param {string} newFragmentId - which fragment is the new one
 * @returns {Promise<{ reply: string|null, summary: string }>}
 * @throws {AIServiceUnavailableError} when the service isn't configured, the call fails,
 *   or the reply is still malformed after one retry
 */
export async function processNote(topic, newFragmentId) {
  const newFragment = topic.fragments.find(f => f.id === newFragmentId)
  if (!newFragment) throw new AIServiceUnavailableError('processNote: new fragment not found in topic')

  const earlier = topic.fragments.filter(f => f.id !== newFragmentId)
  const earlierList = earlier.length
    ? earlier.map((f, i) => {
        const base = `${i + 1}. ${f.text}`
        return f.aiAnswer ? `${base} (AI explanation: ${f.aiAnswer})` : base
      }).join('\n')
    : '(none yet)'

  const prompt = `You are a note-organizing assistant. The user keeps notes under the topic "${topic.title}". They just added a new note. Do two things:

TASK 1 — Reply to the new note (often not needed).
- If the new note is a plain statement, thought or plan, no reply is needed.
- If it is a question, a request to explain something, a bare word or short phrase with no context (assume they want to know what it means, even in English), or a word/phrase in a different language than the rest of the user's notes (assume they want its meaning or translation), give a concise reply of at most 60 words, in plain text with no Markdown symbols.
- If you are not confident the reply is accurate, do not reply. Never guess or fabricate.

TASK 2 — Write the topic summary covering ALL notes (earlier ones plus the new one), including any AI explanations, and including your reply from Task 1 if you gave one.
1. Present the user's actual views/thoughts as bullet points (each starting with "- " on its own line). Write out what the user's actual view or conclusion is; no hollow paraphrases like "discussed…" or "pointed out that…".
2. Group notes about the same sub-topic into one set of bullets rather than repeating overlapping content. If there are clear categories, use short sub-headings written as "## Heading" on their own line. You may use **bold** for key terms and indented sub-bullets where they help; use no tables.
3. Summarize only what the notes contain. If a note is just an instruction to the app (for example "create a new topic X") or has no content of its own, leave it out of the summary; if that leaves nothing to summarize, the summary is just "No content yet." If a note is incomplete (e.g. a single term), you may add common-knowledge facts you are confident are correct.
4. Whenever a note has an AI explanation (including your Task 1 reply), the summary must contain that information, not merely say the user asked. For word/phrase meanings, add a separate "Glossary" section at the end, one line per "term — meaning", without repeating them in the main body. For an answered question, put the key answer in a bullet under the relevant sub-heading.
Keep the main body under 200 words (the Glossary is separate but concise too).

Earlier notes:
${earlierList}

New note:
"""
${newFragment.text}
"""

Output exactly this format and nothing else:
<reply>
the reply to the new note, or the single word NONE if no reply is needed
</reply>
<summary>
the full topic summary
</summary>`

  const messages = [{ role: 'user', content: prompt }]
  let content = await chatCompletion(messages, 0.2, 'processNote')
  let result = parseNoteReply(content)
  if (!result.ok) {
    messages.push({ role: 'assistant', content })
    messages.push({
      role: 'user',
      content: `Your reply was invalid: ${result.reason}. Reply again using exactly the <reply>...</reply> and <summary>...</summary> format.`
    })
    content = await chatCompletion(messages, 0.2, 'processNote:retry')
    result = parseNoteReply(content)
  }
  if (!result.ok) {
    throw new AIServiceUnavailableError(`AI note reply was invalid: ${result.reason}`)
  }
  return result.value
}

export { AIServiceUnavailableError }

