// StreamingMarkdown, as plain logic: every newly rendered character gets an
// arrival time, paced evenly (≤ 90 per second, faster when a burst would take longer than half a
// second to clear), then fades in over 0.9 s from a soft violet through pink into the text color.
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

/** Appends arrival times (ms) for `backlog` new characters. */
export function pace(arrivals: number[], backlog: number, now: number): void {
  if (backlog <= 0) return
  let t = Math.max(now, arrivals[arrivals.length - 1] ?? now)
  const step = Math.min(1000 / 90, 500 / backlog)
  for (let i = 0; i < backlog; i++) arrivals.push((t += step))
}

/** How many arrivals have finished fading at `now` (they render as plain text). */
export function settled(arrivals: number[], now: number): number {
  const i = arrivals.findIndex((t) => now - t < FADE)
  return i < 0 ? arrivals.length : i
}

// The tints are mixed into the text color, so they read as a hint rather than a color.
const VIOLET = 'color-mix(in oklab, #8b5cf6 65%, #1a1b1e)'
const PINK = 'color-mix(in oklab, #ec4899 55%, #1a1b1e)'

/** A character's color by age: visible a third of the way in; violet → pink by 40%, then text. */
export const CHAR_KEYFRAMES: Keyframe[] = [
  { offset: 0, opacity: 0, color: VIOLET },
  { offset: 0.35, opacity: 1 },
  { offset: 0.4, color: PINK },
  { offset: 1, opacity: 1, color: '#1a1b1e' }
]
