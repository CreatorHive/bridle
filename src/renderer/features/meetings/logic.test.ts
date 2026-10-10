import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../../../shared/types'
import { byDay, meetingsFrom, past, prepBody, prepPath, slug, upcoming } from './logic'

const ev = (id: string, day: number, rest: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id, account: 'a', grant: 'g', title: id, start: new Date(2026, 9, day, 10).toISOString(),
  end: new Date(2026, 9, day, 11).toISOString(), allDay: false,
  guests: [{ email: 'b@x', status: 'accepted', organizer: true, me: false }, { email: 'me@x', status: 'accepted', organizer: false, me: true }],
  ...rest
})

describe('meetings', () => {
  it('keeps timed meetings with others or a call link, not declined, sorted, each id once', () => {
    const all = [
      ev('late', 12), ev('early', 9), ev('early', 9, { account: 'b' }),
      ev('solo', 10, { guests: [] }), ev('call', 11, { guests: [], meeting: { url: 'https://meet.google.com/x', name: 'Meet' } }),
      ev('allday', 10, { allDay: true }),
      ev('nope', 10, { guests: [{ email: 'me@x', status: 'declined', organizer: false, me: true }, { email: 'b@x', status: 'accepted', organizer: false, me: false }] })
    ]
    expect(meetingsFrom(all).map((e) => `${e.account}:${e.id}`)).toEqual(['a:early', 'a:call', 'a:late'])
  })

  it('splits upcoming and the last six past, and groups by day', () => {
    const events = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => ev(`d${d}`, d))
    const now = new Date(2026, 9, 9, 10, 30)
    expect(upcoming(events, now).map((e) => e.id)).toEqual(['d9', 'd10'])
    expect(past(events, now).map((e) => e.id)).toEqual(['d8', 'd7', 'd6', 'd5', 'd4', 'd3'])
    const groups = byDay([ev('a', 9), ev('b', 10), ev('c', 9)])
    expect(groups.map((g) => [g.day.getDate(), g.events.map((e) => e.id)])).toEqual([[9, ['a', 'c']], [10, ['b']]])
  })

  it('names prep notes like Watcher.prepFile', () => {
    expect(slug('Launch Bridle v0.1')).toBe('launch-bridle-v0-1')
    const e = ev('x', 9, { title: 'Sync: Ruby / Sean', start: '2026-10-09T23:30:00Z' })
    expect(prepPath('/Users/me/Bridle/', e)).toBe('/Users/me/Bridle/meetings/2026-10-09-sync-ruby-sean.md')
    expect(prepBody('---\nevent: x\n---\n# Prep\n\nHi\n')).toBe('# Prep\n\nHi\n')
    expect(prepBody('just a note')).toBe('just a note')
  })
})
