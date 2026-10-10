import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CalendarEvent, Chat } from '../../shared/types'

// Watcher logic. No network, no CLI, no osascript.
vi.mock('electron', () => ({ app: {}, shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] }, Notification: {}, powerMonitor: {} }))

const s = await import('./state')
const { group } = await import('../services/composio')

describe('watch.json (reference-date numbers)', () => {
  const swift = '{"prepped":{"evt1":813269000.5},"chatID":"F580670F-9DD7-4B64-91AD-BAD2EB7143A2","baselined":["gmail:a@x.com","github:me"],' +
    '"notified":[813269964.527205],"seen":{"gmail:1a1145a20a752353":813269964.527205},"briefed":"2026-10-09"}'

  it('reads dates as seconds since 2001-01-01', () => {
    const st = s.decodeState(swift)
    expect(new Date(st.seen['gmail:1a1145a20a752353']).toISOString()).toBe('2026-10-09T20:19:24.527Z')
    expect(st.notified).toHaveLength(1)
    expect(st.chatID).toBe('F580670F-9DD7-4B64-91AD-BAD2EB7143A2')
    expect(st.briefed).toBe('2026-10-09')
    expect(st.baselined).toEqual(['gmail:a@x.com', 'github:me'])
  })

  it('writes the same numbers back, every required key, no nil optionals', () => {
    const out = JSON.parse(s.encodeState(s.decodeState(swift)))
    expect(out.seen['gmail:1a1145a20a752353']).toBeCloseTo(813269964.527205, 5)
    expect(out.prepped.evt1).toBeCloseTo(813269000.5, 5)
    expect(out.notified[0]).toBeCloseTo(813269964.527205, 5)
    const empty = JSON.parse(s.encodeState({ ...s.emptyState(), chatID: 'f580670f-9dd7-4b64-91ad-bad2eb7143a2' }))
    expect(Object.keys(empty).sort()).toEqual(['baselined', 'chatID', 'notified', 'prepped', 'seen'])
    expect(empty.chatID).toBe('F580670F-9DD7-4B64-91AD-BAD2EB7143A2')
  })

  it('treats an unreadable file as a fresh state', () => {
    expect(s.decodeState('')).toEqual(s.emptyState())
  })

  it('round-trips through disk', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bridle-watch-'))
    expect(await s.loadState(root)).toEqual(s.emptyState())
    const st = s.decodeState(swift)
    await s.saveState(root, st)
    const back = await s.loadState(root)
    expect(back.chatID).toBe(st.chatID)
    expect(Math.abs(back.seen['gmail:1a1145a20a752353'] - st.seen['gmail:1a1145a20a752353'])).toBeLessThan(1)
  })
})

describe('baseline, seen, budget', () => {
  const now = Date.parse('2026-10-09T15:00:00Z')
  const item = (key: string) => ({ key })

  it('baselines a source on first look, then returns only unseen items once', () => {
    const st = s.emptyState()
    expect(s.newItems(st, [['gmail:a', [item('g1'), item('g2')]]], now)).toEqual([])
    expect(st.baselined).toEqual(['gmail:a'])
    expect(st.seen.g1).toBe(now)
    const fresh = s.newItems(st, [['gmail:a', [item('g1'), item('g3')]], ['invites:a', [item('i1')]], ['invites:b', []]], now)
    expect(fresh).toEqual([item('g3')]) // invites:a is a new source: baseline
    st.baselined.push('invites:b')
    // The same invite on two of your calendars is judged once.
    expect(s.newItems(st, [['gmail:a', [item('i9')]], ['invites:b', [item('i9')]]], now)).toEqual([item('i9')])
  })

  it('prunes seen after 14 days, notified after 1, prepped after 2', () => {
    const day = 86_400_000
    const st = { ...s.emptyState(), seen: { old: now - 15 * day, ok: now - 13 * day }, notified: [now - 2 * day, now - 1000], prepped: { a: now - 3 * day, b: now - day } }
    s.prune(st, now)
    expect(Object.keys(st.seen)).toEqual(['ok'])
    expect(st.notified).toEqual([now - 1000])
    expect(Object.keys(st.prepped)).toEqual(['b'])
  })

  it('allows 5 a day, 30 minutes apart unless critical', () => {
    const st = s.emptyState()
    expect(s.allows(st, false, now)).toBe(true)
    st.notified = [now - 10 * 60_000]
    expect(s.allows(st, false, now)).toBe(false)
    expect(s.allows(st, true, now)).toBe(true)
    st.notified = [now - 31 * 60_000]
    expect(s.allows(st, false, now)).toBe(true)
    st.notified = [1, 2, 3, 4, 5].map((h) => now - h * 3_600_000)
    expect(s.allows(st, true, now)).toBe(false)
  })
})

describe('time', () => {
  it('quiet hours are 9 PM to 8 AM local', () => {
    const at = (h: number) => new Date(2026, 9, 9, h, 30)
    expect([7, 8, 12, 20, 21, 23, 0].map((h) => s.quietHours(at(h)))).toEqual([true, false, false, false, true, true, true])
  })
})

describe('GitHub web URLs', () => {
  it('converts API URLs and falls back to the repo', () => {
    expect(s.githubWebURL('https://api.github.com/repos/o/r/pulls/7', 'PullRequest', 'https://github.com/o/r')).toBe('https://github.com/o/r/pull/7')
    expect(s.githubWebURL('https://api.github.com/repos/o/r/issues/3', 'Issue', 'https://github.com/o/r')).toBe('https://github.com/o/r/issues/3')
    expect(s.githubWebURL(null, 'CheckSuite', 'https://github.com/o/r')).toBe('https://github.com/o/r/actions')
    expect(s.githubWebURL(undefined, 'Release', 'https://github.com/o/r')).toBe('https://github.com/o/r')
  })
})

describe('Away', () => {
  it('sends the first line, links and bold stripped, at most 160 characters', () => {
    expect(s.awayText('**Ana** needs the [deck](https://x.y/z) by noon.\n\nWant me to draft it?'))
      .toBe('From Bridle: Ana needs the deck by noon. Open Bridle to reply.')
    expect(s.awayText('\n  \n  second line wins  ')).toBe('From Bridle: second line wins Open Bridle to reply.')
    const long = s.awayText('x'.repeat(200))
    expect(long).toBe(`From Bridle: ${'x'.repeat(159)}… Open Bridle to reply.`)
  })

  it('passes text and handle as argv, never inside the script', () => {
    const evil = 'hi" & do shell script "rm -rf ~" & "'
    const args = s.iMessageArgs(evil, '+1 555 0100')
    expect(args.slice(-2)).toEqual([evil, '+1 555 0100'])
    const script = args.slice(0, -2)
    expect(script.filter((_, i) => i % 2 === 0).every((a) => a === '-e')).toBe(true)
    expect(script.join('\n')).not.toContain('rm -rf')
    expect(script).toContain('send (item 1 of argv) to participant (item 2 of argv) of svc')
  })
})

describe('meeting prep files', () => {
  const e = { id: 'evt1', account: 'me@x.com', title: 'Launch Bridle v0.1', start: '2026-10-14T14:00:00Z' } as CalendarEvent

  it('names the file by the UTC day and slug', () => {
    expect(s.prepFileName(e)).toBe('meetings/2026-10-14-launch-bridle-v0-1.md')
    expect(s.prepFileName({ ...e, start: '2026-10-15T02:30:00Z' })).toBe('meetings/2026-10-15-launch-bridle-v0-1.md')
  })

  it('writes front matter and reads the note back without it', () => {
    const file = s.prepFileText(e, '**Prep: Launch**\n- one', '2026-10-14T14:00:00Z')
    expect(file).toBe('---\nevent: evt1\naccount: me@x.com\nstart: 2026-10-14T14:00:00Z\n---\n**Prep: Launch**\n- one\n')
    expect(s.prepBody(file)).toBe('**Prep: Launch**\n- one\n')
  })
})

describe('Home adoption', () => {
  const chat = (id: string, title: string): Chat => ({ id, title, messages: [] })
  const chats = [chat('A', 'Lunch'), chat('B', 'Needs you'), chat('C', 'Home')]

  it('prefers the saved chat, case-insensitively', () => {
    expect(s.pickHome([chat('ABC-DEF', 'Anything'), ...chats], 'abc-def')?.id).toBe('ABC-DEF')
  })
  it('else the first chat titled Home or Needs you', () => {
    expect(s.pickHome(chats, 'GONE')?.id).toBe('B')
    expect(s.pickHome(chats, null)?.id).toBe('B')
  })
  it('else none', () => {
    expect(s.pickHome([chat('A', 'Lunch')], null)).toBeNull()
  })
})

describe('coexistence lock', () => {
  const now = Date.parse('2026-10-09T15:00:00Z')
  const lock = (pid: number, minutesAgo: number) => ({ pid, app: 'electron', at: new Date(now - minutesAgo * 60_000).toISOString() })
  it('skips only for another live process under 10 minutes old', () => {
    expect(s.lockedOut(null, now, 1, () => true)).toBe(false)
    expect(s.lockedOut(lock(1, 1), now, 1, () => true)).toBe(false) // ours
    expect(s.lockedOut(lock(2, 1), now, 1, () => true)).toBe(true)
    expect(s.lockedOut(lock(2, 1), now, 1, () => false)).toBe(false) // dead
    expect(s.lockedOut(lock(2, 11), now, 1, () => true)).toBe(false) // stale
  })
})

describe('judge reply', () => {
  const items = [{ key: 'gmail:1' }, { key: 'invite:2' }]
  it('maps the 1-based id to an item', () => {
    expect(s.parseVerdict('Sure:\n{"id": "2", "urgency": "High", "summary": "S", "question": "Q?"}', items))
      .toEqual({ key: 'invite:2', urgency: 'high', summary: 'S', question: 'Q?' })
    expect(s.parseVerdict('{"id": 1, "urgency": "low", "summary": "S", "question": "Q"}', items)?.key).toBe('gmail:1')
  })
  it('rejects out-of-range ids and missing fields', () => {
    expect(s.parseVerdict('{"id": "3", "urgency": "high", "summary": "S", "question": "Q"}', items)).toBeNull()
    expect(s.parseVerdict('{"id": "1", "urgency": "high"}', items)).toBeNull()
    expect(s.parseVerdict('no json', items)).toBeNull()
  })
})

describe('Google accounts (group)', () => {
  it('keeps two Google identities apart: Gmail by displayName, Calendar/Drive by their who-am-i alias', () => {
    const r = (id: string, slug: string, who: { alias?: string; dn?: string }) =>
      ({ id, status: 'ACTIVE', toolkit: { slug }, alias: who.alias ?? null, state: { val: who.dn ? { displayName: who.dn } : {} }, is_disabled: false })
    const accounts = group([
      r('d1', 'googledrive', { alias: 'work@x.com' }), r('c1', 'googlecalendar', { alias: 'work@x.com' }), r('m1', 'gmail', { dn: 'work@x.com' }),
      r('d2', 'googledrive', { alias: 'me@gmail.com' }), r('c2', 'googlecalendar', { alias: 'me@gmail.com' }), r('m2', 'gmail', { dn: 'me@gmail.com' }),
      r('gh', 'github', { dn: 'octo' })
    ])
    expect(accounts.map((a) => [a.id, a.grants.map((g) => g.id)])).toEqual([
      ['google:work@x.com', ['d1', 'c1', 'm1']],
      ['google:me@gmail.com', ['d2', 'c2', 'm2']],
      ['github:octo', ['gh']]
    ])
  })
})
