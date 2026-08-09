// Copy this file to asr.config.js (same folder) and fill in your own key.
// asr.config.js is gitignored — never commit a real key.
//
// Get an API Key from the Volcano Engine console:
// https://console.volcengine.com/speech/app  (语音技术 → API Key管理)
// New-console single-key auth (X-Api-Key header) — not the old app-id +
// access-token pair.
//
// Don't reuse a key from another project — different app, different quota/billing.

export const ASR_CONFIG = {
  apiKey: '',
  url: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash',
  resourceId: 'volc.bigasr.auc_turbo'
}
