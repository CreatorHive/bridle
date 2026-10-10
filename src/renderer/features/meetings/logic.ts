import type { CalendarEvent } from '../../../shared/types'
import { end, myStatus, start, startOfDay } from '../calendar/logic'

// Pure meetings logic, and the watcher's prep note paths (prepFile / savedPrep).

/** An event id is only unique within its account. */
export const meetingKey = (e: CalendarEvent) => `${e.account}|${e.id}`

/** Timed events with someone else or a call link that you haven't declined, by start; an invite between
 *  your own accounts is on both calendars, so each id shows once. */
export function meetingsFrom(all: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>()
  return all
    .filter((e) => !e.allDay && myStatus(e) !== 'declined' && (e.guests.some((g) => !g.me) || !!e.meeting))
    .sort((a, b) => start(a).getTime() - start(b).getTime())
    .filter((e) => !seen.has(e.id) && !!seen.add(e.id))
}

export const upcoming = (events: CalendarEvent[], now = new Date()) => events.filter((e) => end(e) > now)

/** The last six that ended, most recent first. */
export const past = (events: CalendarEvent[], now = new Date()) => events.filter((e) => end(e) <= now).reverse().slice(0, 6)

/** Upcoming meetings grouped by local day, in order. */
export function byDay(events: CalendarEvent[]): { day: Date; events: CalendarEvent[] }[] {
  const groups = new Map<number, CalendarEvent[]>()
  for (const e of events) {
    const k = startOfDay(start(e)).getTime()
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  return [...groups].sort(([a], [b]) => a - b).map(([k, list]) => ({ day: new Date(k), events: list }))
}

export const STATUS_LABELS: Record<string, string> = {
  accepted: 'Going', declined: 'Not going', tentative: 'Maybe', needsAction: "Hasn't replied"
}

/** "Launch Bridle v0.1" → "launch-bridle-v0-1". */
export const slug = (name: string) => name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join('-')

/** Watcher.prepFile: meetings/<yyyy-MM-dd>-<slug>.md. The date is the UTC day. */
export const prepPath = (workspace: string, e: CalendarEvent) =>
  `${workspace.replace(/\/$/, '')}/meetings/${start(e).toISOString().slice(0, 10)}-${slug(e.title)}.md`

/** Watcher.savedPrep: the note without its front matter. */
export const prepBody = (file: string) => file.split('\n---\n').pop() ?? file
