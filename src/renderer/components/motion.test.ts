import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { avatarHash, sphere } from './Avatar'
import { invert, MOTION, spring, springAt } from './motion'
import { parseBlocks } from './parseMarkdown'
import { FADE, graphemes, pace, renderedCount, settled } from './stream'

describe('springs', () => {
  it('starts at rest, ends at 1, and a lightly damped one overshoots', () => {
    expect(springAt(0.44, 0.99, 0)).toBe(0)
    expect(springAt(0.44, 0.99, 2)).toBeCloseTo(1, 4)
    const peak = Math.max(...Array.from({ length: 700 }, (_, i) => springAt(0.5, 0.86, i / 1000)))
    expect(peak).toBeGreaterThan(1)
    expect(springAt(0.3, 1, 0.3)).toBeLessThan(1) // critically damped never overshoots
  })

  it('samples into a linear() easing that settles in a sensible time', () => {
    const s = spring(0.44, 0.99)
    expect(s.easing.startsWith('linear(0, ')).toBe(true)
    expect(s.easing.endsWith(', 1)')).toBe(true)
    expect(s.duration).toBeGreaterThan(400)
    expect(s.duration).toBeLessThan(900)
  })

  it('tokens.css carries the same springs as motion.ts', () => {
    const css = readFileSync(new URL('../theme/tokens.css', import.meta.url), 'utf8')
    for (const [name, m] of [['send', MOTION.send], ['lines', MOTION.composerLines], ['settle', MOTION.settle], ['fold', MOTION.fold]] as const) {
      expect(css, name).toContain(`--dur-${name}: ${m.duration}ms;`)
      expect(css, name).toContain(`--ease-${name}: ${m.easing};`)
    }
  })
})

describe('FLIP', () => {
  it('inverts a move and a resize about the center', () => {
    const first = { left: 100, top: 300, width: 811, height: 60 }
    const last = { left: 80, top: 700, width: 780, height: 58 }
    const t = invert(first, last)
    expect(t.scale).toBeCloseTo(811 / 780)
    // The inverted box's center lands on the first box's center.
    expect(last.left + last.width / 2 + t.x).toBe(first.left + first.width / 2)
    expect(last.top + last.height / 2 + t.y).toBe(first.top + first.height / 2)
    expect(invert(first, first)).toEqual({ x: 0, y: 0, scale: 1 })
  })
})

describe('streaming reveal', () => {
  it('paces at the rate text arrives: ≥ 90 characters a second, never more than half a second behind', () => {
    const slow: number[] = []
    pace(slow, 10, 1000)
    expect(slow[0]).toBeCloseTo(1000 + 1000 / 90)
    expect(slow[9] - slow[8]).toBeCloseTo(1000 / 90)
    const burst: number[] = []
    pace(burst, 500, 0)
    expect(burst[499]).toBeCloseTo(500)
    // A later chunk queues behind characters still waiting.
    pace(burst, 1, 100)
    expect(burst[500]).toBeGreaterThan(500)
    // 40 characters every 100 ms (400/s): drawn at 400/s, so the lag the first chunk set never grows (at 90/s it would).
    const fast: number[] = []
    for (let i = 0; i < 20; i++) pace(fast, 40, i * 100, i ? 100 : Infinity)
    const lag = (n: number) => fast[n * 40 + 39] - n * 100
    expect(lag(19)).toBeCloseTo(lag(1))
  })

  it('counts characters as drawn: markup is not counted, graphemes stay whole', () => {
    expect(renderedCount(parseBlocks('Hi **there**\n\n- a\n- `b`'))).toBe('Hi there'.length + 2)
    expect(graphemes('👍🏽é!')).toEqual(['👍🏽', 'é', '!'])
    expect(renderedCount(parseBlocks('🇺🇸 ok'))).toBe(4)
  })

  it('settles characters once their fade is over', () => {
    const arrivals = [0, 10, 20, 2000]
    expect(settled(arrivals, 5)).toBe(0)
    expect(settled(arrivals, 15 + FADE)).toBe(2)
    expect(settled(arrivals, 3000 + FADE)).toBe(4)
  })
})

describe('avatars', () => {
  it('hashes with FNV-1a and a finalizer (UInt32)', () => {
    const h = avatarHash(0, 'ruby')
    expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true)
    expect(avatarHash(0, 'ruby')).toBe(h)
    expect(avatarHash(1, 'ruby')).not.toBe(h)
  })

  it('draws the main agent indigo and a seeded worker the same way every time', () => {
    expect(sphere('Bridle', 0)).toContain('rgba(99, 102, 241, 1)') // indigo accent
    expect(sphere('worker-7')).toBe(sphere('worker-7'))
  })
})
