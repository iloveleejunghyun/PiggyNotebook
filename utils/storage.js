// Local-only storage layer for MVP (no backend, per Thoughts.md).
// Everything lives in one uni-storage key as a JSON blob — data volume
// during validation is tiny (a few hundred fragments at most), so this
// is simpler than reaching for plus.sqlite right now. Swap later if needed.

const TOPICS_KEY = 'pn_topics'
const SELECTED_TOPIC_KEY = 'pn_selected_topic_id'

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
    aiAnswer: null, // filled in later by setFragmentAnswer, if the AI has something to add
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
 * Attach a single-shot AI answer to an existing fragment (e.g. a definition
 * for a bare vocab word) so it renders as one Q&A card instead of two
 * separate fragments.
 * @param {string} topicId
 * @param {string} fragmentId
 * @param {string} answer
 * @returns {object|null} the updated fragment, or null if not found
 */
export function setFragmentAnswer(topicId, fragmentId, answer) {
  const topics = getTopics()
  const topic = topics.find(t => t.id === topicId)
  if (!topic) return null
  const fragment = topic.fragments.find(f => f.id === fragmentId)
  if (!fragment) return null
  fragment.aiAnswer = answer
  topic.updatedAt = nowISO()
  saveTopics(topics)
  return fragment
}

/**
 * Overwrite a topic's rolling summary (called after a successful AI summarize call).
 * @param {string} topicId
 * @param {string} summary
 */
export function updateTopicSummary(topicId, summary) {
  const topics = getTopics()
  const topic = topics.find(t => t.id === topicId)
  if (!topic) return null
  topic.summary = summary
  topic.updatedAt = nowISO()
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
