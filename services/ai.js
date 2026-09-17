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
    : '(no existing topics yet)'

  const prompt = `You are a note-organizing assistant. Help the user file a quick, unstructured fragment of a thought under a "topic".

Important principles: this product's core purpose is to prevent the user's thoughts from being scattered across too many topics, so:
1. As long as the fragment has any reasonable connection to an existing topic — even if it's short or vague (a single word, an abbreviation) — as long as it could plausibly be a detail or sub-item of that topic, prefer filing it under that existing topic rather than creating a new one.
2. Only create a new topic when the fragment is clearly unrelated to every existing topic.
3. Be conservative even when creating a new topic: a topic should be a reasonably broad area/project/subject — don't spin up an overly narrow, specific new topic for a single fragment.
4. Special case: if this fragment is a word/phrase/sentence in a different language than the rest of the user's notes (suggesting they're learning that language), and an existing topic like "Language Learning" (or a specific-language variant) already exists, prefer filing it there instead of creating a new, narrower language-related topic.
5. Watch out for the "catch-all topic" trap: if an existing topic's name is itself vague and unfocused (e.g. "Misc", "Other", "Notes", "Random"), don't dump the fragment there just because it "could fit anything" — only use such a broad topic when the fragment genuinely has no specific direction at all. If the fragment has even a slight specific lean, create a more specific new topic, or file it under another genuinely relevant specific topic instead of taking the easy way into a catch-all.
6. When creating a new topic, its title itself must never be a vague catch-all label like "Misc", "Other", "Notes", "Random" — such a label becomes a black hole that swallows every future fragment, effectively defeating classification. If you truly can't discern a specific direction, just use the fragment's own key wording as the title rather than inventing a generic category name.

Existing topics:
${topicList}

The user's new fragment:
"""
${text}
"""

Output only a JSON object, nothing else, in this format:
{"topicId": "the existing topic's id, or null if creating a new topic", "suggestedTitle": "the topic name (return the existing topic's title verbatim if reusing one; for a new topic, give a concise title, no more than 6 words)", "isNewTopic": true or false}`

  // Low temperature — this is a classification task, we want consistent
  // categorization, not creative variation between near-identical inputs.
  const content = await chatCompletion([{ role: 'user', content: prompt }], 0, 'suggestTopic')
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
    : '(no other topics)'

  const prompt = `You are a note-organizing assistant. The user is currently recording a string of fragments under the topic "${currentTopic.title}", and just recorded a new one — determine whether it still fits the current topic.

Judging standard (lean toward "fits" rather than readily deciding "doesn't fit"):
1. As long as the fragment has any reasonable connection to the current topic — even if brief or vague (a single word, an abbreviation) — as long as it could plausibly be a detail or sub-item of the current topic, judge it as fitting.
2. Only judge it as not fitting when the fragment clearly and unambiguously belongs to one of the other topics listed below, or is obviously a brand-new, unrelated subject.
3. Special case: if this fragment is a word/phrase/sentence in a different language than the rest of the user's notes, and the current topic or one of the "other existing topics" is something like "Language Learning" (or a specific-language variant), judge it as fitting that language-learning topic.
4. Watch out for the "catch-all topic" trap: if the current topic's own name is vague and unfocused (e.g. "Misc", "Other", "Notes", "Random"), don't automatically judge it as fitting just because it "could hold anything" — if the fragment has even a slight specific lean (related to a more specific topic in "other existing topics," or specific enough to stand as its own new topic), judge it as not fitting, and let it go somewhere more suitable.

If judged as not fitting, you need to suggest a better destination — this product's core purpose is to prevent thoughts from being scattered across too many topics, so:
- Prefer picking a reasonably related topic from "other existing topics" (even a loose connection) over creating a new one — but likewise avoid vague catch-all topics unless there's truly no more specific option.
- Only create a new topic when the fragment is genuinely unrelated to every existing topic, and keep the new topic broad — don't open an overly narrow topic for a single fragment.
- A new topic's title must never be a vague catch-all label like "Misc", "Other", "Notes", "Random" — such a label becomes a black hole that swallows every future fragment. If you truly can't discern a specific direction, just use the fragment's own key wording as the title.

Current topic: "${currentTopic.title}"

Other existing topics:
${otherList}

The user's new fragment:
"""
${text}
"""

Output only a JSON object, nothing else:
- If it fits the current topic: {"fits": true}
- If not, give a better destination: {"fits": false, "topicId": "the more suitable existing topic's id, or null if suggesting a new topic", "suggestedTitle": "the topic name (return the existing topic's title verbatim if reusing one; for a new topic, give a concise title, no more than 6 words)", "isNewTopic": true or false}`

  // Low temperature — this is a classification task, not creative writing.
  const content = await chatCompletion([{ role: 'user', content: prompt }], 0, 'checkTopicFit')
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

