// Singleton wrapper around uni.getRecorderManager().
//
// Why this file exists: uni.getRecorderManager() returns a device-wide
// singleton (there's only one microphone). Its .onStart/.onStop/.onError
// are ADDITIVE listener registrations, not property setters — calling them
// again doesn't replace the previous handler, it stacks another one on top.
//
// capture-bar.vue is mounted fresh on every page that embeds it (home,
// topic-detail). Since uni.navigateTo keeps the previous page alive on the
// stack (it isn't destroyed), every page visited left its own set of
// listeners attached to the same recorder, forever. Two components then
// "race" to handle the same recording events, with no defined winner —
// which is what caused voice input to get stuck on "连接中…" after using
// it on more than one page.
//
// Fix: register the native listeners exactly once, here, at module scope.
// Whichever CaptureBar instance is currently active calls setHandlers() on
// mount to CLAIM the callbacks — that replaces the previous claim outright,
// so a stale instance's handlers simply stop firing once a newer one takes
// over, regardless of whether the old component technically still exists.

let recorderManager = null
let currentHandlers = { onStart: null, onStop: null, onError: null }

function ensureInitialized() {
  if (recorderManager) return
  recorderManager = uni.getRecorderManager()
  recorderManager.onStart(() => {
    if (currentHandlers.onStart) currentHandlers.onStart()
  })
  recorderManager.onStop(res => {
    if (currentHandlers.onStop) currentHandlers.onStop(res)
  })
  recorderManager.onError(err => {
    if (currentHandlers.onError) currentHandlers.onError(err)
  })
}

/**
 * Claim the recorder's callbacks for whichever component calls this.
 * Call from mounted() — overwrites any previous claim, so only the most
 * recently mounted instance ever actually receives events.
 * @param {{ onStart?: Function, onStop?: Function, onError?: Function }} handlers
 */
export function setRecorderHandlers({ onStart = null, onStop = null, onError = null } = {}) {
  ensureInitialized()
  currentHandlers = { onStart, onStop, onError }
}

export function startRecording(options) {
  ensureInitialized()
  recorderManager.start(options)
}

export function stopRecording() {
  ensureInitialized()
  recorderManager.stop()
}
