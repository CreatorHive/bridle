import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Chat, CalendarEvent } from '../../shared/types'
import { slug } from '../services/workspace'

// Pure pieces of the watcher: the watch.json state, budget, quiet hours, URLs, Away text, prep
// file names, Home adoption and the coexistence lock. No Electron, no network.

export const DAILY_LIMIT = 5 // messages per 24 hours
export const SPACING = 30 * 60_000 // between messages, except critical ones
const DAY = 86_400_000

/** Watcher.State in memory; every date is Unix milliseconds. */
export interface State {
  seen: Record<string, number>
  baselined: string[]
  notified: number[]
  chatID?: string | null
  /** The UTC day ("2026-10-09") the morning briefing went out. */
  briefed?: string | null
  /** event id → when its prep note went out. */
  prepped: Record<string, number>
}

export const emptyState = (): State => ({ seen: {}, baselined: [], notified: [], prepped: {} })

// On disk, every Date is a number of seconds since 2001-01-01 (Apple's reference date), not ISO.
const REFERENCE = 978_307_200
export const toSwiftDate = (ms: number): number => ms / 1000 - REFERENCE
export const fromSwiftDate = (s: number): number => (s + REFERENCE) * 1000

const mapValues = (o: unknown, f: (n: number) => number): Record<string, number> =>
  Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, f(v as number)]))

/** watch.json text → State. Unreadable means a fresh state. */
export function decodeState(text: string): State {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(text)
  } catch {
    return emptyState()
  }
  if (!o || typeof o !== 'object') return emptyState()
  return {
    seen: mapValues(o.seen, fromSwiftDate),
    baselined: Array.isArray(o.baselined) ? o.baselined.filter((s): s is string => typeof s === 'string') : [],
    notified: Array.isArray(o.notified) ? o.notified.filter((n): n is number => typeof n === 'number').map(fromSwiftDate) : [],
    chatID: typeof o.chatID === 'string' ? o.chatID : null,
    briefed: typeof o.briefed === 'string' ? o.briefed : null,
    prepped: mapValues(o.prepped, fromSwiftDate)
  }
}

/** State → watch.json text. The four non-optional keys are always present; nil optionals are omitted. */
export function encodeState(s: State): string {
  const out: Record<string, unknown> = {
    seen: mapValues(s.seen, toSwiftDate),
    baselined: [...new Set(s.baselined)],
    notified: s.notified.map(toSwiftDate),
    prepped: mapValues(s.prepped, toSwiftDate)
  }
  if (s.chatID) out.chatID = s.chatID.toUpperCase()
  if (s.briefed) out.briefed = s.briefed
  return JSON.stringify(out)
}

export const stateFile = (root: string): string => join(root, '.bridle', 'watch.json')

export async function loadState(root: string): Promise<State> {
  return decodeState(await readFile(stateFile(root), 'utf8').catch(() => ''))
}

export async function saveState(root: string, s: State): Promise<void> {
  const file = stateFile(root)
  await mkdir(join(root, '.bridle'), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, encodeState(s), 'utf8')
  await rename(tmp, file) // atomic, like Data.write(options: .atomic)
}

/** Forget items older than two weeks (they've aged out of every source query). */
export function prune(s: State, now = Date.now()): void {
  s.seen = Object.fromEntries(Object.entries(s.seen).filter(([, t]) => t > now - 14 * DAY))
  s.notified = s.notified.filter((t) => t > now - DAY)
  s.prepped = Object.fromEntries(Object.entries(s.prepped).filter(([, t]) => t > now - 2 * DAY))
}

/** At most DAILY_LIMIT a day, and SPACING apart unless it's critical. */
export function allows(s: State, critical: boolean, now = Date.now()): boolean {
  const today = s.notified.filter((t) => t > now - DAY)
  if (today.length >= DAILY_LIMIT) return false
  return critical || today.length === 0 || now - Math.max(...today) >= SPACING
}

/** The first look at a source is a baseline: everything there is marked seen and nothing is new.
 *  Later looks return the unseen items. */
export function newItems<T extends { key: string }>(s: State, sources: [string, T[]][], now = Date.now()): T[] {
  const fresh = new Map<string, T>()
  for (const [source, items] of sources) {
    if (!s.baselined.includes(source)) {
      s.baselined.push(source)
      for (const i of items) s.seen[i.key] = now
      continue
    }
    // An invite between your own accounts is on both calendars: judge it once.
    for (const i of items) if (s.seen[i.key] === undefined && !fresh.has(i.key)) fresh.set(i.key, i)
  }
  return [...fresh.values()]
}

/** 9 PM to 8 AM, local time. */
export const quietHours = (d = new Date()): boolean => d.getHours() >= 21 || d.getHours() < 8

/** The UTC day, "2026-10-09". */
export const utcDay = (d: Date | string | number = new Date()): string => new Date(d).toISOString().slice(0, 10)

/** API URL → web URL: api.github.com/repos/o/r/pulls/7 → github.com/o/r/pull/7; no subject URL → the repo (or its Actions). */
export function githubWebURL(subjectURL: string | null | undefined, type: string, repoURL: string): string {
  if (subjectURL) return subjectURL.split('https://api.github.com/repos/').join('https://github.com/').split('/pulls/').join('/pull/')
  return type === 'CheckSuite' ? `${repoURL}/actions` : repoURL
}

/** What Away texts: the first line without links or bold, at most 160 characters, and a pointer back. */
export function awayText(text: string): string {
  const plain = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').split('**').join('')
  const first = plain.split('\n').map((l) => l.replace(/^[ \t]+|[ \t]+$/g, '')).find((l) => l) ?? ''
  const chars = [...first]
  const line = chars.length > 160 ? chars.slice(0, 159).join('') + '…' : first
  return `From Bridle: ${line} Open Bridle to reply.`
}

/** osascript argv for one iMessage. The text and handle travel as `argv`, never inside the script. */
export function iMessageArgs(text: string, handle: string): string[] {
  const script = [
    'on run argv',
    'tell application "Messages"',
    'set svc to 1st account whose service type = iMessage',
    'send (item 1 of argv) to participant (item 2 of argv) of svc',
    'end tell',
    'end run'
  ]
  return [...script.flatMap((line) => ['-e', line]), text, handle]
}

/** meetings/<UTC yyyy-MM-dd>-<slug(title)>.md, relative to the workspace. */
export const prepFileName = (e: Pick<CalendarEvent, 'start' | 'title'>): string => `meetings/${utcDay(e.start)}-${slug(e.title)}.md`

/** The prep file: front matter, then the note. */
export const prepFileText = (e: CalendarEvent, note: string, start: string): string =>
  `---\nevent: ${e.id}\naccount: ${e.account}\nstart: ${start}\n---\n${note}\n`

/** The note without its front matter. */
export const prepBody = (file: string): string => file.split('\n---\n').pop() ?? file

/** Which chat is Home: the saved one if it still exists, else one titled "Home" or "Needs you". */
export function pickHome(chats: Chat[], saved: string | null | undefined): Chat | null {
  const byID = saved ? chats.find((c) => c.id.toUpperCase() === saved.toUpperCase()) : undefined
  return byID ?? chats.find((c) => c.title === 'Home' || c.title === 'Needs you') ?? null
}

export interface Lock {
  pid: number
  app: string
  at: string
}

/** Another live process watched in the last 10 minutes: skip this pass. */
export function lockedOut(lock: Lock | null, now: number, self: number, alive: (pid: number) => boolean): boolean {
  if (!lock || lock.pid === self) return false
  const age = now - new Date(lock.at).getTime()
  return age >= 0 && age < 10 * 60_000 && alive(lock.pid)
}

export interface Verdict {
  key: string
  urgency: string
  summary: string
  question: string
}

/** The judge's JSON reply → a verdict on one of `items` (ids are 1-based), or null. */
export function parseVerdict(reply: string, items: { key: string }[]): Verdict | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end < start) return null
  let o: Record<string, unknown>
  try {
    o = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return null
  }
  const id = typeof o.id === 'number' ? o.id : typeof o.id === 'string' && /^\d+$/.test(o.id.trim()) ? Number(o.id) : NaN
  const item = Number.isInteger(id) ? items[id - 1] : undefined
  if (!item || typeof o.urgency !== 'string' || typeof o.summary !== 'string' || typeof o.question !== 'string') return null
  return { key: item.key, urgency: o.urgency.toLowerCase(), summary: o.summary, question: o.question }
}
