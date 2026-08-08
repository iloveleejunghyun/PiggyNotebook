// Local-only storage layer for MVP (no backend, per Thoughts.md).
// Everything lives in one uni-storage key as a JSON blob — data volume
// during validation is tiny (a few hundred fragments at most), so this
// is simpler than reaching for plus.sqlite right now. Swap later if needed.

const TOPICS_KEY = 'pn_topics'

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
 * @returns {object|null} the updated topic, or null if topicId not found
 */
export function addFragment(topicId, fragment) {
  const topics = getTopics()
  const topic = topics.find(t => t.id === topicId)
  if (!topic) return null

  topic.fragments.push({
    id: uid(),
    text: fragment.text,
    source: fragment.source || 'text',
    createdAt: nowISO()
  })
  topic.updatedAt = nowISO()

  // move to front (most-recently-active topic surfaces first on home)
  const rest = topics.filter(t => t.id !== topicId)
  saveTopics([topic, ...rest])
  return topic
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
