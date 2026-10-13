// StreamingMarkdown, as plain logic: every newly rendered character gets an
// arrival time, paced at the rate the text came in (never slower than 90 a second, never more than half a
// second behind), then fades in over 0.9 s from a soft violet through pink into the text color.
import type { Block, Inline } from './parseMarkdown'

/** Seconds a character takes to settle, in ms. */
export const FADE = 900

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : null
const SIMPLE = /^[\u0000-˿]*$/ // no combining marks, emoji or surrogates: one char per code unit

/** User-perceived characters (grapheme clusters): "é", "👍🏽" and flags stay whole. */
export function graphemes(s: string): string[] {
  if (SIMPLE.test(s)) return s.split('')
  return segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s)
}

export function graphemeCount(s: string): number {
  return SIMPLE.test(s) ? s.length : graphemes(s).length
}

function inlineCount(nodes: Inline[]): number {
  let n = 0
  for (const x of nodes) n += x.type === 'text' || x.type === 'code' ? graphemeCount(x.text) : inlineCount(x.children)
  return n
}

/** Characters drawn, in reading order (markup like ** isn't counted). */
export function renderedCount(blocks: Block[]): number {
  let n = 0
  for (const b of blocks) {
    if (b.type === 'code') n += graphemeCount(b.text)
    else if (b.type === 'list') for (const item of b.items) n += inlineCount(item)
    else if (b.type !== 'rule') n += inlineCount(b.children)
  }
  return n
}

/** Appends arrival times (ms) for `backlog` new characters, spread over `gap` (ms since the previous chunk) so the
 *  reveal runs as fast as the text arrives. At least 90 a second (a first chunk, or one after a pause), and finished
 *  within half a second of `now` however far behind it was. */
export function pace(arrivals: number[], backlog: number, now: number, gap = Infinity): void {
  if (backlog <= 0) return
  let t = Math.max(now, arrivals[arrivals.length - 1] ?? now)
  const step = Math.max(0, Math.min(gap, backlog * 1000 / 90, 500 - (t - now))) / backlog
  for (let i = 0; i < backlog; i++) arrivals.push((t += step))
}

/** How many arrivals have finished fading at `now` (they render as plain text). */
export function settled(arrivals: number[], now: number): number {
  const i = arrivals.findIndex((t) => now - t < FADE)
  return i < 0 ? arrivals.length : i
}

/** A character's color by age: visible a third of the way in; violet → pink by 40%, then its own color (no end
 *  color, so it lands on the CSS one: text, code or link, light or dark). The tints are mixed into `text` (the theme's
 *  --text), so they read as a hint rather than a color. */
export function charKeyframes(text: string): Keyframe[] {
  return [
    { offset: 0, opacity: 0, color: `color-mix(in oklab, #8b5cf6 65%, ${text})` },
    { offset: 0.35, opacity: 1 },
    { offset: 0.4, color: `color-mix(in oklab, #ec4899 55%, ${text})` },
    { offset: 1, opacity: 1 }
  ]
}
