import { describe, expect, it } from 'vitest'
import { CAPTION, CARDS, COLUMN, entrance, intersects, layout, schedule } from './burst'

const SCREENS: [number, number][] = [[1280, 800], [1440, 900], [1512, 982], [1728, 1117], [1920, 1080], [2560, 1440], [1024, 768]]

describe('feature burst layout', () => {
  it.each(SCREENS)('fits every card around the column at %i×%i', (W, H) => {
    const { cards, column, corner } = layout(W, H)
    expect(cards).toHaveLength(14)
    expect(new Set(cards.map((c) => c.id)).size).toBe(14)
    // The kept-clear column is at least the conversation's 440 px, centered.
    expect(column.x).toBeLessThanOrEqual(W / 2 - COLUMN / 2)
    expect(column.x + column.w).toBeGreaterThanOrEqual(W / 2 + COLUMN / 2)
    for (const c of cards) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeGreaterThanOrEqual(0)
      expect(c.x + c.w).toBeLessThanOrEqual(W)
      expect(c.y + c.h).toBeLessThanOrEqual(H)
      expect(intersects(c, column), `${c.id} covers the column`).toBe(false)
      expect(intersects(c, corner), `${c.id} covers the corner buttons`).toBe(false)
      for (const d of cards) {
        if (d !== c && d.layer === c.layer) expect(intersects(c, d), `${c.id} overlaps ${d.id}`).toBe(false)
      }
    }
  })

  it('is deterministic and uses the space it has', () => {
    expect(layout(1440, 900)).toEqual(layout(1440, 900))
    expect(layout(2560, 1440).k).toBeGreaterThan(layout(1440, 900).k)
    expect(layout(1440, 900).k).toBeGreaterThan(0.9)
  })

  it('brings every card in from off screen', () => {
    const W = 1440
    const H = 900
    for (const c of layout(W, H).cards) {
      const { x, y } = entrance(c, W, H)
      const r = { x: c.x + x, y: c.y + y, w: c.w, h: c.h }
      expect(intersects(r, { x: 0, y: 0, w: W, h: H }), c.id).toBe(false)
    }
  })

  it('builds the caption word by word, then gathers', () => {
    const { words, gather } = schedule()
    expect(words.map((l) => l.length)).toEqual(CAPTION.map((l) => l.length))
    const flat = words.flat()
    expect(flat.every((t, i) => i === 0 || t > flat[i - 1])).toBe(true)
    // All cards are in before the caption finishes; the whole showcase stays around 5 s.
    expect(gather).toBeGreaterThan(flat[flat.length - 1])
    expect(gather).toBeGreaterThan(CARDS.length * 70)
    expect(gather).toBeLessThan(5000)
  })
})
