import type { CalendarEvent } from '../../../shared/types'

// Pure calendar logic: the week layout, account colors, event text (tidy / linkify / when) and days.

const DAY = 86_400_000

/** An event's instant. All-day events are local dates: "2026-10-09" (or a midnight timestamp) is that day here. */
export function eventDate(s: string, allDay = false): Date {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s)
  if (ymd && (allDay || s.length === 10)) return new Date(+ymd[1], +ymd[2] - 1, +ymd[3])
  return new Date(s)
}

export const start = (e: CalendarEvent) => eventDate(e.start, e.allDay)
export const end = (e: CalendarEvent) => eventDate(e.end, e.allDay)

/** Your RSVP, if you're a guest. */
export const myStatus = (e: CalendarEvent): string | undefined => e.guests.find((g) => g.me)?.status

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
export const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime()

/** The Sunday that starts `d`'s week (US convention). */
export const weekStart = (d: Date) => addDays(startOfDay(d), -d.getDay())
export const weekDays = (start: Date) => Array.from({ length: 7 }, (_, i) => addDays(start, i))

/** Hours since midnight, for placing on the grid. */
export const hours = (d: Date) => d.getHours() + d.getMinutes() / 60

/** One color per account, in Settings order. */
const PALETTE = ['#1A73E8', '#8E44D9', '#0B8043', '#E37400', '#D50000']
export function accountColor(account: string, logins: string[]): string {
  return PALETTE[Math.max(0, logins.indexOf(account)) % PALETTE.length]
}

export interface Laid { event: CalendarEvent; lane: number; lanes: number }

/** Side-by-side lanes for overlapping events, per cluster of overlaps. */
export function layout(events: CalendarEvent[]): Laid[] {
  const out: Laid[] = []
  let cluster: { event: CalendarEvent; lane: number }[] = []
  let laneEnds: number[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    out.push(...cluster.map((c) => ({ ...c, lanes: laneEnds.length })))
    cluster = []
    laneEnds = []
  }
  const t = (e: CalendarEvent) => [start(e).getTime(), end(e).getTime()]
  const sorted = [...events].sort((a, b) => t(a)[0] - t(b)[0] || t(b)[1] - t(a)[1])
  for (const e of sorted) {
    const [s, f] = t(e)
    if (s >= clusterEnd) flush()
    let lane = laneEnds.findIndex((x) => x <= s)
    if (lane < 0) lane = laneEnds.push(f) - 1
    else laneEnds[lane] = f
    cluster.push({ event: e, lane })
    clusterEnd = Math.max(clusterEnd, f)
  }
  flush()
  return out
}

/** Timed events starting on `day`. */
export const timedOn = (events: CalendarEvent[], day: Date) => events.filter((e) => !e.allDay && sameDay(start(e), day))

/** All-day events covering `day`. */
export const allDayOn = (events: CalendarEvent[], day: Date) =>
  events.filter((e) => e.allDay && start(e) <= day && end(e) > day)

export const time = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** "1 AM" … "11 PM"; midnight is left blank. */
export const hourLabel = (h: number) => (h === 0 ? '' : new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' }))

/** "Today", "Tomorrow", "Yesterday", else "Wednesday, Oct 14". */
export function dayLabel(d: Date, now = new Date()): string {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

/** "Friday, October 9 · 2:00 PM – 3:00 PM", or just the day for all-day events. */
export function when(e: CalendarEvent): string {
  const day = start(e).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  return e.allDay ? day : `${day} · ${time(start(e))} – ${time(end(e))}`
}

/** Drops divider lines (____, ----) and runs of blank lines that invite templates are full of. */
export function tidy(s: string): string {
  return s
    .split('\n')
    .filter((line) => line.trim() === '' || ![...line.trim()].every((c) => '_-=*'.includes(c)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Plain text split into text and link runs (URLs: http(s), www., mailto). */
export function linkify(s: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = []
  const re = /\b(?:https?:\/\/|www\.)[^\s<>"]+|\bmailto:[^\s<>"]+/gi
  let last = 0
  for (const m of s.matchAll(re)) {
    const url = m[0].replace(/[.,;:!?)\]'"]+$/, '')
    const i = m.index!
    if (i > last) out.push({ text: s.slice(last, i) })
    out.push({ text: url, href: url.startsWith('www.') ? `https://${url}` : url })
    last = i + url.length
  }
  if (last < s.length) out.push({ text: s.slice(last) })
  return out
}

/** EventCard's "Show more": long notes fold to 8 lines. */
export const longNotes = (notes: string) => notes.split('\n').filter(Boolean).length > 8 || notes.length > 500

/** "3 yes, 1 no, 2 awaiting". */
export function guestSummary(e: CalendarEvent): string {
  const n = (s: string) => e.guests.filter((g) => g.status === s).length
  const yes = n('accepted')
  const no = n('declined')
  const waiting = e.guests.length - yes - no - n('tentative')
  return [yes && `${yes} yes`, no && `${no} no`, waiting && `${waiting} awaiting`].filter(Boolean).join(', ')
}

/** Sets your RSVP on one event (by account and id) in a list; the list is unchanged if you're not a guest. */
export function withStatus(events: CalendarEvent[], target: CalendarEvent, status: string): CalendarEvent[] {
  return events.map((e) =>
    e.id === target.id && e.account === target.account
      ? { ...e, guests: e.guests.map((g) => (g.me ? { ...g, status } : g)) }
      : e)
}

/** The sample week shown when no Google Calendar is connected, around `now`'s week. */
export function sampleWeek(now = new Date()): CalendarEvent[] {
  const sunday = weekStart(now)
  const at = (day: number, h: number) => new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + day, 0, Math.round(h * 60)).toISOString()
  const me = { email: 'you@example.com', name: 'You', organizer: false, me: true }
  const guest = (name: string, status = 'accepted', organizer = false) =>
    ({ email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`, name, status, organizer, me: false })
  let n = 0
  const ev = (title: string, day: number, h: number, len: number, rest: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id: `sample-${++n}`, account: 'Sample calendar', grant: '', title, start: at(day, h), end: at(day, h + len),
    allDay: false, guests: [], ...rest
  })
  const ymd = (day: number) => addDays(sunday, day)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return [
    ev('Standup', 1, 9, 0.5, { guests: [guest('Ruby Park', 'accepted', true), { ...me, status: 'accepted' }],
      meeting: { url: 'https://meet.google.com/abc-defg-hij', name: 'Google Meet', code: 'abc-defg-hij' } }),
    ev('Design review', 2, 11, 1, { guests: [guest('Marcus Lee', 'accepted', true), { ...me, status: 'needsAction' }],
      notes: 'Walk through onboarding and the mail reader.\n\nDeck: https://example.com/deck' }),
    ev('Lunch with Ana', 2, 12.5, 1, { location: 'Blue Bottle, Hayes Valley' }),
    ev('Planning', 3, 14, 1.5, { guests: [guest('Ruby Park'), guest('Marcus Lee', 'tentative'), { ...me, status: 'tentative' }] }),
    ev('Customer call', 3, 14.5, 1, { guests: [guest('Dana Wu', 'accepted', true), { ...me, status: 'declined' }] }),
    ev('Focus time', 4, 9, 3),
    ev('Launch', 5, 10, 1, { guests: [guest('Ruby Park', 'accepted', true), guest('Marcus Lee'), { ...me, status: 'accepted' }] }),
    { ...ev('Offsite', 4, 0, 0), allDay: true, start: iso(ymd(4)), end: iso(ymd(6)) }
  ]
}

const ARROW = 10
const GAP = 4

/** Where the popover goes: right of the anchor (left when it won't fit), vertically centered on it, 8 px inside
 *  the window; the arrow stays on the anchor's center, at least 16 px from the card's corners. */
export function place(anchor: { left: number; right: number; top: number; height: number }, width: number, height: number, vw: number, vh: number) {
  const right = anchor.right + GAP + ARROW + width <= vw - 8
  const x = right ? anchor.right + GAP + ARROW : Math.max(8, anchor.left - GAP - ARROW - width)
  const cy = anchor.top + anchor.height / 2
  const y = Math.max(8, Math.min(cy - height / 2, vh - height - 8))
  const arrowY = Math.max(16, Math.min(cy - y, height - 16))
  return { x, y, arrowY, side: right ? 'right' as const : 'left' as const }
}
