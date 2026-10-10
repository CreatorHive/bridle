import type { Account, TaskItem, TaskStatus } from '../../../shared/types'

// Pure helpers for the board (TasksBoard, TaskCard, tag chips).

/** The same tag gets the same color everywhere (a stable, wrapping 64-bit hash). */
const TAG_PALETTE = ['#1C9BEF', '#7C5CFF', '#F2711C', '#E64980', '#1E9E5A', '#E8A200']
export function tagColor(tag: string): string {
  let h = BigInt(0)
  for (const c of tag) h = BigInt.asIntN(64, h * BigInt(31) + BigInt(c.codePointAt(0)!))
  const n = h < 0 ? -h : h
  return TAG_PALETTE[Number(n % BigInt(TAG_PALETTE.length))]
}

/** Long tags end in "…" after 21 characters. */
export const chipText = (tag: string): string => ([...tag].length > 22 ? [...tag].slice(0, 21).join('') + '…' : tag)

/** Trying 2, 1, then 0 tags: how many tag chips fit beside the (optional) identifier chip. */
export function fitChips(widths: { lead: number; tags: number[] }, available: number, gap = 6, max = 2): number {
  for (let n = Math.min(max, widths.tags.length); n > 0; n--) {
    const parts = [...(widths.lead ? [widths.lead] : []), ...widths.tags.slice(0, n)]
    const total = parts.reduce((a, b) => a + b, 0) + gap * (parts.length - 1)
    if (total <= available) return n
  }
  return 0
}

/** Cards of one column, newest first. */
export const columnCards = (tasks: TaskItem[], status: TaskStatus): TaskItem[] =>
  tasks.filter((t) => t.status === status).sort((a, b) => b.updated.localeCompare(a.updated))

/** Done shows six until "Show all". */
export const DONE_CAP = 6
export function capped(cards: TaskItem[], status: TaskStatus, showAll: boolean): { shown: TaskItem[]; more: boolean } {
  const more = status === 'done' && cards.length > DONE_CAP
  return { shown: more && !showAll ? cards.slice(0, DONE_CAP) : cards, more }
}

export type Filter = 'All tasks' | 'Mine' | 'Linear'
export const FILTERS: Filter[] = ['All tasks', 'Mine', 'Linear']
export const filterTasks = (tasks: TaskItem[], f: Filter): TaskItem[] =>
  f === 'All tasks' ? tasks : tasks.filter((t) => (f === 'Linear') === !!t.linear)

/** "Updated recently" within two days, else "Updated Oct 4". */
export function updatedLabel(updated: string, now = new Date()): string {
  const d = new Date(updated)
  if (now.getTime() - d.getTime() < 2 * 86400_000) return 'Updated recently'
  return `Updated ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

/** `.relative(presentation: .named)`: "yesterday", "3 days ago", "now". */
export function relative(date: string, now = new Date()): string {
  const s = (new Date(date).getTime() - now.getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]
  for (const [unit, size] of units) if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit)
  return rtf.format(0, 'second')
}

/** LinearSync.grant: the first working Linear grant. */
export const linearGrant = (accounts: Account[]): string | undefined =>
  accounts.flatMap((a) => a.grants).find((g) => g.toolkit === 'linear' && g.ok)?.id

/** An IPC rejection without Electron's "Error invoking remote method '…': Error: " prefix. */
export function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, '')
}
