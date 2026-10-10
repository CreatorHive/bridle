import { extname } from 'node:path'
import { stat } from 'node:fs/promises'
import type { BridleAPI } from '../../shared/api'
import { emit } from '../events'
import type { Embedder } from '../search/index'
import { helper, NOT_BUILT } from './helper'

// What the app does with bridle-helper: the `native` contract group (thumbnails, dictation), the
// "On-device" search embedder, and text for the index from images (OCR) and audio (transcription).

/** The on-device model: NLContextualEmbedding (English), mean-pooled, unit length, 512 dimensions. */
export const onDeviceEmbedder: Embedder = {
  id: 'on-device|NLContextualEmbedding|en|mean',
  async embed(texts) {
    const r = await helper.request<{ vectors: number[][] }>('embed', { texts })
    return r.vectors.map((v) => Float32Array.from(v))
  }
}

let probe: { ok: Promise<boolean>; at: number } | null = null

/** Whether on-device embeddings work (helper built, model assets downloaded). A yes holds for the run;
 *  a no is asked again after five minutes, as macOS may still be downloading the model. */
export async function onDeviceReady(): Promise<boolean> {
  if (!helper.available()) return false
  if (probe && (Date.now() - probe.at < 5 * 60_000 || (await probe.ok))) return probe.ok
  const ok = onDeviceEmbedder.embed(['ready']).then(() => true, (e: Error) => {
    console.warn('[native] on-device embeddings unavailable:', e.message)
    return false
  })
  probe = { ok, at: Date.now() }
  return ok
}

/** PLAN.md extractors: Vision OCR for images, SpeechAnalyzer for audio and movies. */
const OCR = new Set(['png', 'jpg', 'jpeg', 'heic', 'heif', 'tiff', 'tif', 'gif', 'bmp', 'webp'])
const AUDIO = new Set(['m4a', 'mp3', 'wav', 'aiff', 'aif', 'caf', 'aac', 'flac', 'mov', 'mp4', 'm4v'])

export const nativeExtracts = (path: string): boolean => {
  const ext = extname(path).slice(1).toLowerCase()
  return OCR.has(ext) || AUDIO.has(ext)
}

/** An image's or recording's text, or null when it has none or can't be read. Throws NOT_BUILT without the
 *  helper, so the index tries the file again once it's built.
 *  ponytail: a long recording holds the index queue while it transcribes (capped at 200 MB / 10 min). */
export async function nativeText(path: string): Promise<string | null> {
  if (!helper.available()) throw new Error(NOT_BUILT)
  const ext = extname(path).slice(1).toLowerCase()
  const size = (await stat(path)).size
  const cmd = OCR.has(ext) ? (size < 40_000_000 ? 'ocr' : null) : AUDIO.has(ext) && size < 200_000_000 ? 'transcribe' : null
  if (!cmd) return null
  return helper.request<{ text: string }>(cmd, { path }).then((r) => r.text || null, () => null)
}

// Dictation text goes to the renderer as it comes; a helper crash mid-dictation ends it with an error.
let dictating = false
helper.onEvent((e) => {
  if (e.event === 'dictation') emit('native:dictation', { text: e.text as string | undefined, final: e.final as boolean | undefined, error: e.error as string | undefined })
  else if (e.event === 'exit' && dictating) {
    dictating = false
    emit('native:dictation', { error: `Dictation stopped: the helper ${e.why}. If macOS didn't ask for the microphone, see native/BridleHelper/README.md.` })
  }
})

export const native: BridleAPI['native'] = {
  async thumbnail(path, size) {
    if (!helper.available()) return null
    const r = await helper.request<{ png: string }>('thumbnail', { path, size }).catch(() => null)
    return r ? `data:image/png;base64,${r.png}` : null
  },

  async dictate(action) {
    if (action === 'start') dictating = true
    try {
      await helper.request('dictate', { action })
    } catch (e) {
      dictating = false
      throw e
    }
    if (action !== 'start') dictating = false
  }
}
