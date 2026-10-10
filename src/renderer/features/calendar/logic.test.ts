import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../../../shared/types'
import { allDayOn, dayLabel, eventDate, guestSummary, layout, linkify, longNotes, place, sampleWeek, tidy, weekStart, withStatus } from './logic'

const at = (h: number) => new Date(2026, 9, 9, 0, h * 60).toISOString()
const ev = (id: string, from: number, to: number, rest: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({ id, account: 'a', grant: 'g', title: id, start: at(from), end: at(to), allDay: false, guests: [], ...rest })

describe('layout', () => {
  it('gives overlapping events side-by-side lanes, per cluster', () => {
    const laid = layout([ev('b', 9.5, 10.5), ev('a', 9, 10), ev('c', 10, 11), ev('d', 12, 13)])
    const by = Object.fromEntries(laid.map((l) => [l.event.id, [l.lane, l.lanes]]))
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] })
  })

  it('puts the longer of two same-start events first', () => {
    const laid = layout([ev('short', 9, 9.5), ev('long', 9, 11)])
    expect(laid.map((l) => [l.event.id, l.lane])).toEqual([['long', 0], ['short', 1]])
  })
})

describe('dates', () => {
  it('reads all-day dates as local days', () => {
    expect(eventDate('2026-10-09', true)).toEqual(new Date(2026, 9, 9))
    expect(eventDate('2026-10-09T00:00:00Z', true)).toEqual(new Date(2026, 9, 9))
    expect(eventDate('2026-10-09T14:00:00Z').toISOString()).toBe('2026-10-09T14:00:00.000Z')
  })

  it('starts weeks on Sunday and finds all-day events per day', () => {
    expect(weekStart(new Date(2026, 9, 9, 15))).toEqual(new Date(2026, 9, 4))
    const offsite = ev('o', 0, 0, { allDay: true, start: '2026-10-08', end: '2026-10-10' })
    expect(allDayOn([offsite], new Date(2026, 9, 9))).toHaveLength(1)
    expect(allDayOn([offsite], new Date(2026, 9, 10))).toHaveLength(0)
  })

  it('labels days relative to now', () => {
    const now = new Date(2026, 9, 9, 23, 30)
    expect(dayLabel(new Date(2026, 9, 9, 8), now)).toBe('Today')
    expect(dayLabel(new Date(2026, 9, 10, 0, 5), now)).toBe('Tomorrow')
    expect(dayLabel(new Date(2026, 9, 8), now)).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 9, 14), now)).toBe(new Date(2026, 9, 14).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }))
  })
})

describe('notes', () => {
  it('tidies divider lines and blank runs', () => {
    expect(tidy('\nJoin us\n_____\n\n\n\nAgenda\n- - -\n---\n * \n')).toBe('Join us\n\nAgenda\n- - -')
  })

  it('linkifies URLs without trailing punctuation', () => {
    expect(linkify('See https://x.co/a?b=1. Or www.y.org, mailto:z@x.co')).toEqual([
      { text: 'See ' }, { text: 'https://x.co/a?b=1', href: 'https://x.co/a?b=1' }, { text: '. Or ' },
      { text: 'www.y.org', href: 'https://www.y.org' }, { text: ', ' }, { text: 'mailto:z@x.co', href: 'mailto:z@x.co' }
    ])
    expect(linkify('no links')).toEqual([{ text: 'no links' }])
  })

  it('folds long notes', () => {
    expect(longNotes('a\nb')).toBe(false)
    expect(longNotes('l\n'.repeat(9))).toBe(true)
    expect(longNotes('x'.repeat(501))).toBe(true)
  })
})

describe('guests', () => {
  const g = (status: string, me = false) => ({ email: `${status}${me}@x`, status, organizer: false, me })
  const e = ev('m', 9, 10, { guests: [g('accepted'), g('declined'), g('tentative'), g('needsAction', true)] })

  it('summarizes RSVPs', () => expect(guestSummary(e)).toBe('1 yes, 1 no, 1 awaiting'))

  it('sets only your status on the matching event', () => {
    const [changed, other] = withStatus([e, { ...e, account: 'b' }], e, 'accepted')
    expect(changed.guests.map((x) => x.status)).toEqual(['accepted', 'declined', 'tentative', 'accepted'])
    expect(other.guests[3].status).toBe('needsAction')
  })

  it('has a sample week inside the current week', () => {
    const now = new Date(2026, 9, 9)
    for (const s of sampleWeek(now)) expect(eventDate(s.start, s.allDay) >= weekStart(now)).toBe(true)
  })
})

describe('popover placement', () => {
  it('sits right of the anchor, centered on it, flipping left near the edge and staying on screen', () => {
    const a = { left: 100, right: 200, top: 300, height: 40 }
    expect(place(a, 380, 200, 1200, 800)).toEqual({ x: 214, y: 220, arrowY: 100, side: 'right' })
    expect(place({ ...a, left: 900, right: 1000 }, 380, 200, 1200, 800)).toMatchObject({ x: 506, side: 'left' })
    // Near the bottom the card is pushed up and the arrow follows the anchor.
    expect(place({ ...a, top: 770 }, 380, 200, 1200, 800)).toMatchObject({ y: 592, arrowY: 184 })
  })
})
