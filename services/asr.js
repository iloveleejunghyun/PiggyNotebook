// Voice-to-text via Doubao/Volcano Engine's "大模型录音文件识别 Flash" API.
//
// Static single API Key (new-console auth) — no OAuth token-minting/refresh
// cycle, so this stays simple to keep backend-less. Same tradeoff already
// accepted for the LLM key: credentials ship in the client bundle,
// extractable in principle. Keep the beta small/private.
//
// Note: the current published docs for this endpoint only show audio.url
// (a hosted link) in the request body, not inline base64 — but empirically
// verified (2026-08-09, live API test) that audio.data + format:'aac'
// still works fine despite not being documented. Re-verify if this starts
// failing after a Volcano API update.
//
// Real key lives in asr.config.js (gitignored). See asr.config.example.js.

import { ASR_CONFIG } from './asr.config.js'

class ASRUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ASRUnavailableError'
  }
}

function assertConfigured() {
  if (!ASR_CONFIG.apiKey) {
    throw new ASRUnavailableError(
      'ASR service is not configured yet — fill in apiKey in services/asr.config.js.'
    )
  }
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// uni.getFileSystemManager() only works on H5/mini-program — the App (vue3)
// platform doesn't implement it at all (hence "is not a function" on iOS/
// Android). App-plus needs the 5+ plus.io API instead.
function readFileBase64(filePath) {
  return new Promise((resolve, reject) => {
    if (typeof plus === 'undefined' || !plus.io) {
      reject(new ASRUnavailableError('plus.io unavailable — this only runs on the App (iOS/Android) platform'))
      return
    }
    plus.io.resolveLocalFileSystemURL(
      filePath,
      entry => {
        entry.file(file => {
          const reader = new plus.io.FileReader()
          reader.onloadend = evt => {
            // result is a data URL like "data:audio/aac;base64,XXXX" — strip the prefix
            const dataUrl = String(evt.target.result || '')
            const base64 = dataUrl.split(',')[1] || ''
            if (!base64) {
              reject(new ASRUnavailableError('Failed to read recording: empty base64 result'))
              return
            }
            resolve(base64)
          }
          reader.onerror = err => reject(new ASRUnavailableError(`Failed to read recording: ${JSON.stringify(err)}`))
          reader.readAsDataURL(file)
        }, err => reject(new ASRUnavailableError(`Failed to open recording file: ${JSON.stringify(err)}`)))
      },
      err => reject(new ASRUnavailableError(`Failed to resolve recording path: ${JSON.stringify(err)}`))
    )
  })
}

// uni.request lower/upper-cases response headers inconsistently across
// platforms — check both, same defensive pattern the reference
// implementation used for wx.request.
// Response header casing isn't standardized across platforms — iOS and
// Android's native HTTP clients normalize it differently (e.g.
// "X-Api-Status-Code" vs "x-api-status-code" vs something else entirely).
// Checking 3 hardcoded variants missed Android's actual casing; scan
// case-insensitively instead so this doesn't depend on guessing right.
function getHeader(headers, name) {
  if (!headers) return undefined
  const target = name.toLowerCase()
  const key = Object.keys(headers).find(k => k.toLowerCase() === target)
  return key !== undefined ? headers[key] : undefined
}

/**
 * Transcribe a recorded audio file (expects the AAC format this app
 * records with — see capture-bar.vue's recorder options).
 * @param {string} filePath - local temp file path from uni.getRecorderManager's onStop
 * @returns {Promise<string>} the transcribed text
 * @throws {ASRUnavailableError} when the service isn't configured or the call fails
 */
export async function recognizeAudio(filePath) {
  assertConfigured()
  if (!filePath) throw new ASRUnavailableError('No recording file path provided')

  const base64Data = await readFileBase64(filePath)

  const requestBody = {
    user: { uid: ASR_CONFIG.appKey },
    audio: { data: base64Data, format: 'aac' },
    request: {
      model_name: 'bigmodel',
      enable_itn: true,   // normalize numbers/dates etc. into standard written form
      enable_punc: true,  // auto-punctuate
      enable_ddc: false,
      enable_speaker_info: false
    }
  }

  let res
  try {
    res = await uni.request({
      url: ASR_CONFIG.url,
      method: 'POST',
      timeout: 15000,
      header: {
        'Content-Type': 'application/json',
        'X-Api-Key': ASR_CONFIG.apiKey,
        'X-Api-Resource-Id': ASR_CONFIG.resourceId,
        'X-Api-Request-Id': generateUUID(),
        'X-Api-Sequence': '-1'
      },
      data: requestBody
    })
  } catch (e) {
    throw new ASRUnavailableError(`Network error calling ASR: ${e.errMsg || e.message}`)
  }

  if (res.statusCode !== 200) {
    throw new ASRUnavailableError(`ASR API HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`)
  }

  const apiStatusCode = getHeader(res.header, 'x-api-status-code')
  // 20000000 = full success. 20000003 = "recognized fine, but silence / no
  // speech in the audio" — that's a legitimate outcome (empty transcript),
  // not a service failure, so it shouldn't throw. Anything else is a real
  // error (bad auth, malformed request, server issue, etc).
  const NON_FATAL_EMPTY_CODES = ['20000003']
  if (apiStatusCode !== '20000000') {
    if (NON_FATAL_EMPTY_CODES.includes(apiStatusCode)) {
      return ''
    }
    const message = getHeader(res.header, 'x-api-message') || 'recognition failed'
    throw new ASRUnavailableError(`ASR API error ${apiStatusCode}: ${message}`)
  }

  const text = res.data && res.data.result && res.data.result.text
  if (!text) {
    // Not necessarily an error — could just be silence/noise. Let the
    // caller decide how to handle "nothing was said" rather than guessing.
    return ''
  }
  return text
}

export { ASRUnavailableError }
