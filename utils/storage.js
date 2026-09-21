// Local-only storage layer for MVP (no backend, per Thoughts.md).
// Everything lives in one uni-storage key as a JSON blob — data volume
// during validation is tiny (a few hundred fragments at most), so this
// is simpler than reaching for plus.sqlite right now. Swap later if needed.

const TOPICS_KEY = 'pn_topics'
const SELECTED_TOPIC_KEY = 'pn_selected_topic_id'
const AI_CONSENT_KEY = 'pn_ai_consent_given'

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function nowISO() {
  return new Date().toISOString()
}

/** @returns {Array} all topics, newest-updated first */
export function getTopics() {
  const topics = uni.getStorageSync(TOPICS_KEY)
  return Array.isArray(topics) ? topics : []
}

function saveTopics(topics) {
  uni.setStorageSync(TOPICS_KEY, topics)
}

export function getTopicById(topicId) {
  return getTopics().find(t => t.id === topicId) || null
}

/**
 * Create a new topic.
 * @param {string} title
 * @returns {object} the created topic
 */
export function createTopic(title) {
  const topics = getTopics()
  const topic = {
    id: uid(),
    title: title.trim(),
    summary: '',
    fragments: [],
    createdAt: nowISO(),
    updatedAt: nowISO()
  }
  topics.unshift(topic)
  saveTopics(topics)
  return topic
}

/**
 * Append a fragment to a topic and bump its updatedAt.
 * @param {string} topicId
 * @param {{text: string, source: 'text'|'voice'}} fragment
 * @returns {object|null} the newly created fragment (with its id), or null if topicId not found
 */
export function addFragment(topicId, fragment) {
  const topics = getTopics()
  const topic = topics.find(t => t.id === topicId)
  if (!topic) return null

  const newFragment = {
    id: uid(),
    text: fragment.text,
    source: fragment.source || 'text',
    aiAnswer: null, // filled in later by applyNoteResult, if the AI has something to add
    createdAt: nowISO()
  }
  topic.fragments.push(newFragment)
  topic.updatedAt = nowISO()

  // move to front (most-recently-active topic surfaces first on home)
  const rest = topics.filter(t => t.id !== topicId)
  saveTopics([topic, ...rest])
  return newFragment
}

/**
 * Write the AI's result for a newly saved note in ONE storage write: the
 * (optional) reply on that fragment plus the topic's fresh summary.
 * @param {string} topicId
 * @param {string} fragmentId
 * @param {{reply: string|null, summary: string}} result
 * @returns {object|null} the updated topic, or null if the topic was deleted meanwhile
 */
export function applyNoteResult(topicId, fragmentId, { reply, summary }) {
  const topics = getTopics()
  const topic = topics.find(t => t.id === topicId)
  if (!topic) return null
  const fragment = topic.fragments.find(f => f.id === fragmentId)
  if (fragment && reply) fragment.aiAnswer = reply
  topic.summary = summary
  topic.summaryFailed = false
  topic.updatedAt = nowISO()
  saveTopics(topics)
  return topic
}

/**
 * Record that the last AI update for this topic failed, so the detail page can
 * say so honestly instead of showing an out-of-date summary as if it were current.
 */
export function markSummaryFailed(topicId) {
  const topics = getTopics()
  const topic = topics.find(t => t.id === topicId)
  if (!topic) return null
  topic.summaryFailed = true
  saveTopics(topics)
  return topic
}

export function deleteTopic(topicId) {
  saveTopics(getTopics().filter(t => t.id !== topicId))
}

/**
 * The "currently active" topic — auto-defaults to the most recently active
 * topic, but is pinned explicitly once the user opens a topic or saves a
 * fragment, so it survives across app restarts (per TODO: 默认选择当前主题).
 * @returns {string|null}
 */
export function getSelectedTopicId() {
  return uni.getStorageSync(SELECTED_TOPIC_KEY) || null
}

/** @param {string|null} topicId - pass null to clear the pinned selection */
export function setSelectedTopicId(topicId) {
  if (topicId) {
    uni.setStorageSync(SELECTED_TOPIC_KEY, topicId)
  } else {
    uni.removeStorageSync(SELECTED_TOPIC_KEY)
  }
}

/**
 * Whether the user has explicitly agreed to send fragment text/voice
 * recordings to the third-party AI services (百度千帆/文心一言, 火山引擎/豆包
 * ASR) that power classification, summarization, and transcription.
 * Required before any capture/AI flow runs — per App Store Guidelines
 * 5.1.1(i)/5.1.2(i), disclosing this in the privacy policy alone isn't
 * sufficient; the app must ask first.
 * @returns {boolean}
 */
export function getAIConsent() {
  return uni.getStorageSync(AI_CONSENT_KEY) === true
}

export function setAIConsent(agreed) {
  uni.setStorageSync(AI_CONSENT_KEY, agreed === true)
}
