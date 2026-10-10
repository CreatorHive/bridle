// The feature burst: after "Here's what I do.", fourteen little cards fly in around the conversation, settle into a
// constellation in three depths, and gather back into the middle. This file is the pure part (layout, timing),
// so it can be tested; Showcase.tsx draws it.

export type CardId = 'mail' | 'invite' | 'prep' | 'github' | 'linear' | 'terminal' | 'change'
  | 'search' | 'files' | 'briefing' | 'imessage' | 'approval' | 'drive' | 'home'

/** 0 near, 1 mid, 2 far. */
export type Layer = 0 | 1 | 2

export const LAYERS: { scale: number; blur: number; opacity: number; parallax: number }[] = [
  { scale: 1, blur: 0, opacity: 1, parallax: 16 },
  { scale: 0.85, blur: 0.5, opacity: 0.92, parallax: 9 },
  { scale: 0.7, blur: 1.5, opacity: 0.6, parallax: 4 }
]

interface Spec {
  id: CardId
  /** Size at scale 1, px. */
  w: number
  h: number
  layer: Layer
  /** -1 left of the column, 1 right. */
  side: -1 | 1
  /** Where in its side: u 0 hugs the column, 1 the screen edge; v 0 top, 1 bottom. */
  u: number
  v: number
}

// In the order they fly in: alternating sides and depths, so the field fills evenly from the first beat.
export const CARDS: Spec[] = [
  { id: 'mail', w: 280, h: 104, layer: 0, side: -1, u: 0.05, v: 0.08 },
  { id: 'linear', w: 260, h: 92, layer: 2, side: 1, u: 1, v: 0.16 },
  { id: 'prep', w: 250, h: 150, layer: 1, side: -1, u: 0.85, v: 0.33 },
  { id: 'search', w: 300, h: 160, layer: 0, side: 1, u: 0.12, v: 0.3 },
  { id: 'briefing', w: 250, h: 150, layer: 2, side: -1, u: 1, v: 0.02 },
  { id: 'github', w: 270, h: 96, layer: 1, side: 1, u: 0, v: 0.02 },
  { id: 'terminal', w: 270, h: 140, layer: 0, side: -1, u: 0.25, v: 0.62 },
  { id: 'files', w: 240, h: 124, layer: 2, side: 1, u: 1, v: 1 },
  { id: 'imessage', w: 170, h: 220, layer: 1, side: -1, u: 0.9, v: 1 },
  { id: 'invite', w: 352, h: 76, layer: 0, side: 1, u: 0.9, v: 0.55 },
  { id: 'drive', w: 220, h: 96, layer: 2, side: -1, u: 1, v: 0.6 },
  { id: 'home', w: 280, h: 104, layer: 1, side: 1, u: 1, v: 0.68 },
  { id: 'change', w: 380, h: 56, layer: 1, side: -1, u: 0, v: 0.97 },
  { id: 'approval', w: 280, h: 170, layer: 0, side: 1, u: 0, v: 0.86 }
]

export interface Rect { x: number; y: number; w: number; h: number }
export interface Placed extends Rect { id: CardId; layer: Layer; side: -1 | 1; /** CSS zoom for the card. */ zoom: number }

/** The conversation column (Onboarding .column), the clear space kept around it, the screen margin. */
export const COLUMN = 440
const GAP = 32 // > the near layer's parallax + float, so a drifting card never reaches the column
const MARGIN = 24
const SPACING = 14
/** The corner buttons: fast-forward, mute, skip (Onboarding .corner: 40 px each, 8 apart, 24 from the edges), padded for drift. */
const CORNER = { w: 3 * 40 + 2 * 8, h: 40, inset: 24, pad: 28 }

export const intersects = (a: Rect, b: Rect, gap = 0): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

/** The cards' rects for a screen, plus the areas they keep clear. Deterministic; cards in one layer never overlap,
 *  cards in different layers overlap by at most a margin of each other. Shrinks everything until it fits. */
export function layout(W: number, H: number): { cards: Placed[]; column: Rect; corner: Rect; k: number } {
  const column = { x: W / 2 - COLUMN / 2 - GAP, y: 0, w: COLUMN + 2 * GAP, h: H }
  const corner = { x: W - CORNER.inset - CORNER.w - CORNER.pad, y: 0, w: CORNER.w + CORNER.inset + CORNER.pad, h: CORNER.inset + CORNER.h + CORNER.pad }
  const regionW = Math.max(0, column.x - MARGIN)
  let k = Math.min(1.4, regionW / 390, (H - 2 * MARGIN) / 780)
  let cards: Placed[] = []
  for (let tries = 0; tries < 16; tries++, k *= 0.92) {
    cards = place(W, H, k, column, corner)
    if (valid(cards, W, H, column, corner)) break
  }
  return { cards, column, corner, k }
}

function place(W: number, H: number, k: number, column: Rect, corner: Rect): Placed[] {
  const span = (side: -1 | 1) => (side === 1 ? [column.x + column.w, W - MARGIN] : [MARGIN, column.x])
  const cards: Placed[] = CARDS.map((c) => {
    const zoom = k * LAYERS[c.layer].scale
    const w = c.w * zoom
    const h = c.h * zoom
    const [lo, hi] = span(c.side)
    const room = Math.max(0, hi - lo - w)
    const x = c.side === 1 ? lo + c.u * room : hi - w - c.u * room
    return { id: c.id, layer: c.layer, side: c.side, zoom, w, h, x, y: MARGIN + c.v * (H - 2 * MARGIN - h) }
  })

  const clamp = (c: Placed) => {
    const [lo, hi] = span(c.side)
    c.x = Math.min(Math.max(c.x, lo), hi - c.w)
    if (intersects(c, corner)) c.y = corner.y + corner.h
    c.y = Math.min(Math.max(c.y, MARGIN), H - MARGIN - c.h)
  }
  // Pushes a and b apart along the shorter way out; `gap` > 0 keeps space, < 0 allows that much overlap.
  const separate = (a: Placed, b: Placed, gx: number, gy: number) => {
    const ox = Math.min(a.x + a.w, b.x + b.w) + gx - Math.max(a.x, b.x)
    const oy = Math.min(a.y + a.h, b.y + b.h) + gy - Math.max(a.y, b.y)
    if (ox <= 0 || oy <= 0) return false
    const [first, second] = (ox < oy ? a.x + a.w / 2 <= b.x + b.w / 2 : a.y + a.h / 2 <= b.y + b.h / 2) ? [a, b] : [b, a]
    if (ox < oy) {
      first.x -= ox / 2
      second.x += ox / 2
    } else {
      first.y -= oy / 2
      second.y += oy / 2
    }
    return true
  }

  for (let round = 0; round < 400; round++) {
    let moved = false
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i]
        const b = cards[j]
        if (a.side !== b.side) continue
        moved = (a.layer === b.layer
          ? separate(a, b, SPACING * k, SPACING * k)
          // Across layers: let them tuck under each other by up to 20% of the smaller one.
          : separate(a, b, -0.2 * Math.min(a.w, b.w), -0.2 * Math.min(a.h, b.h))) || moved
      }
    }
    cards.forEach(clamp)
    if (!moved) break
  }
  return cards
}

function valid(cards: Placed[], W: number, H: number, column: Rect, corner: Rect): boolean {
  return cards.every((a, i) =>
    a.x >= 0 && a.y >= 0 && a.x + a.w <= W && a.y + a.h <= H && !intersects(a, column) && !intersects(a, corner) &&
    cards.every((b, j) => j <= i || a.layer !== b.layer || !intersects(a, b)))
}

/** Timing, ms from the start. */
export const STAGGER = 70
const CAPTION_AT = 450
const WORD_STEP = 150
const LINE_PAUSE = 350
/** A word takes this long to arrive (stream.ts FADE). */
export const WORD_FADE = 900
const HOLD = 1200

export const CAPTION: string[][] = [
  ['Mail.', 'Calendar.', 'Meetings.', 'Code.', 'Tasks.', 'Files.', 'Search.'],
  ['And', 'I', 'write', 'first.']
]

/** When each caption word starts arriving, and when the cards gather (the caption done, plus a beat). */
export function schedule(): { words: number[][]; gather: number } {
  let t = CAPTION_AT - WORD_STEP
  const words = CAPTION.map((line, i) => {
    if (i) t += LINE_PAUSE
    return line.map(() => (t += WORD_STEP))
  })
  return { words, gather: t + WORD_FADE + HOLD }
}

/** Where a card flies in from: just past the screen edge nearest to it, pushed a little further out along its
 *  direction from the center so the paths fan out. Offsets from its resting place, px. */
export function entrance(c: Rect, W: number, H: number): { x: number; y: number } {
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2
  const out = 60
  const edges = [
    { d: c.x + c.w, x: -(c.x + c.w + out), y: (cy - H / 2) * 0.35 },
    { d: W - c.x, x: W - c.x + out, y: (cy - H / 2) * 0.35 },
    { d: c.y + c.h, x: (cx - W / 2) * 0.35, y: -(c.y + c.h + out) },
    { d: H - c.y, x: (cx - W / 2) * 0.35, y: H - c.y + out }
  ]
  const e = edges.reduce((a, b) => (b.d < a.d ? b : a))
  return { x: e.x, y: e.y }
}
