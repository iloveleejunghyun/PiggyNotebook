// Thin wrapper around uni统计's custom event reporting (uni.report), so call
// sites stay clean and every event name/shape is defined in exactly one
// place. Requires uniStatistics.enable: true in manifest.json — see there
// for the account setup (same DCloud/HBuilderX login, no new signup).
//
// These map directly to the Go/No-Go signals from Thoughts.md: D7 retention
// is computed automatically by uni统计 once enabled (no code needed for
// that part); these custom events cover the behavior-specific half —
// "auto-triggered summary" and "≥3 fragments per topic" aren't things
// uni统计 knows about on its own.
//
// Never report actual note content here — only structural/behavioral
// metadata (which action happened, via which path).

function report(eventName, data) {
  // uni.report() is a real no-op during debug runs — DCloud's own docs:
  // "应用在运行、调试时不会上报统计数据，仅在发行后...才会上报数据。" So this
  // log is the ONLY feedback you get that an event fired correctly until
  // you package a real build. Check console for this on every action you'd
  // expect to be tracked — if it's not here, the bug is in our code; if it
  // IS here but missing from the dashboard later, the bug is elsewhere.
  console.log(`[analytics] ${eventName}`, data || {})
  try {
    uni.report(eventName, data || {})
  } catch (e) {
    // Analytics should never be able to break the app.
    console.warn('Analytics report failed:', eventName, e)
  }
}

/**
 * A fragment was saved (text or voice, new topic or existing).
 * topicId/fragmentCount/topicAgeHours carry no note content — just enough
 * structure to later ask "did fragments land in old topics, or only ever
 * in brand-new ones" (topicAgeHours is close to a direct read on the core
 * hypothesis: did the user come back to a scattered thought days later?).
 * @param {{ isNewTopic: boolean, viaFastPath: boolean, source: 'text'|'voice', topicId: string, fragmentCount: number, topicAgeHours: number }} info
 */
export function trackFragmentSaved({ isNewTopic, viaFastPath, source, topicId, fragmentCount, topicAgeHours }) {
  report('fragment_saved', {
    is_new_topic: isNewTopic,
    via_fast_path: viaFastPath,
    source,
    topic_id: topicId,
    fragment_count: fragmentCount,
    topic_age_hours: topicAgeHours
  })
}

/** A new topic was created (regardless of path — AI-suggested or manual). */
export function trackTopicCreated() {
  report('topic_created')
}

/** A topic's rolling summary was successfully (re)generated — the core "auto-summary" signal. */
export function trackSummaryGenerated() {
  report('summary_generated')
}

/** The AI gave a single-shot answer to a fragment (question/bare term/etc). */
export function trackAIAnswerGiven() {
  report('ai_answer_given')
}

/**
 * A topic just crossed the "≥3 fragments" threshold from Thoughts.md's
 * success metric — fired exactly once, the moment a topic's fragment count
 * hits 3 (not on every save after). This turns an unanswerable "which users
 * have a topic with ≥3 fragments" dashboard query into the simplest
 * possible one: "how many distinct users ever fired this event."
 */
export function trackTopicReached3Fragments() {
  report('topic_reached_3_fragments')
}
