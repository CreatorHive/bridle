import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { every, frontMatter } from './automations'
import { agent, unattended } from './services/agent'
import { settings } from './services/settings'
import { iso } from './services/util'
import { workspaceRoot } from './services/workspace'
import { postHome } from './watch'

// The heartbeat: every 30 minutes in active hours the agent itself, with its tools and memory, goes through the
// checklist in HEARTBEAT.md and writes in Home only when something needs you. The file's front matter is its settings
// (`every: 30m`, `hours: 08:00-21:00`, `enabled: false`); with no checklist it doesn't run, and spends nothing.
// BOOT.md, if there is one, runs the same way once at each launch.

export interface Beat {
  every: number
  /** Minutes after midnight: from (inclusive), to (exclusive); from > to wraps past midnight. */
  hours: [number, number]
  enabled: boolean
  checklist: string[]
}

const minutes = (hm: string | undefined): number | null => {
  const m = hm?.trim().match(/^(\d{1,2}):(\d{2})$/)
  return m && Number(m[1]) <= 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null
}

export function beat(md: string): Beat {
  const { fields, body } = frontMatter(md)
  const [from, to] = (fields.hours ?? '').split('-').map(minutes)
  // The list under the first "## …check…" heading.
  const section = body.split(/^##\s+/m).slice(1).find((s) => /^[^\n]*check/i.test(s)) ?? ''
  return {
    every: fields.every ? every(fields.every) : 30 * 60_000,
    hours: from != null && to != null ? [from, to] : [8 * 60, 21 * 60],
    enabled: !/^(false|no|off|0)$/i.test(fields.enabled ?? ''),
    checklist: section.split('\n').filter((l) => /^\s*[-*] /.test(l)).map((l) => l.trim())
  }
}

export function inHours([from, to]: [number, number], d = new Date()): boolean {
  const m = d.getHours() * 60 + d.getMinutes()
  return from <= to ? m >= from && m < to : m >= from || m < to
}

/** NO_REPLY alone, or at either end of a short reply (OpenClaw's rule), means nothing to say. */
export function silent(reply: string): boolean {
  const t = reply.trim()
  return !t || (t.length <= 300 && (t.startsWith('NO_REPLY') || t.endsWith('NO_REPLY')))
}

export function beatPrompt(checklist: string[], now = new Date()): string {
  return `Heartbeat check, ${now.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}. Nobody asked; you're looking around on your own. Go through this list, looking things up with your tools (the workspace's files, the user's apps through Composio):
${checklist.join('\n')}

HEARTBEAT.md says when something is worth writing about. In this check, don't send, schedule or change anything outside the workspace: anything that needs the user's approval is declined, so offer it instead ("Want me to draft the reply?"). Look at today's log first so you don't repeat yourself, and when you do write, add a line there saying what about.
If nothing needs the user now, reply with exactly NO_REPLY. Otherwise your reply is the message they'll see in Home: short, who needs what and why now, and one next step.`
}

const ID = 'heartbeat'
let beating = false

async function tick(now = new Date()): Promise<void> {
  if (beating || !(await settings.get('watchEnabled'))) return
  const root = await workspaceRoot()
  const b = beat(await readFile(join(root, 'HEARTBEAT.md'), 'utf8').catch(() => ''))
  if (!b.enabled || !b.checklist.length || !inHours(b.hours, now)) return
  const file = join(root, '.bridle', 'heartbeat.json')
  const last = (JSON.parse(await readFile(file, 'utf8').catch(() => '{}')) as { lastRun?: string }).lastRun
  if (last && now.getTime() - new Date(last).getTime() < b.every) return
  beating = true
  try {
    // Saved first: a check that fails waits for the next one instead of retrying every minute.
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ lastRun: iso(now) }))
    const stop = setTimeout(() => void agent.cancel(ID), 10 * 60_000)
    const reply = await unattended(ID, beatPrompt(b.checklist, now)).finally(() => clearTimeout(stop))
    if (!silent(reply)) await postHome(reply.trim(), 'heartbeat check', 'a heartbeat check', (await settings.get('agentName')) || 'Bridle')
  } catch (e) {
    console.warn('[heartbeat]', e)
  } finally {
    beating = false
  }
}

/** BOOT.md, if you keep one: once each launch, a minute in, the agent follows it (OpenClaw's boot hook). */
async function boot(): Promise<void> {
  const md = (await readFile(join(await workspaceRoot(), 'BOOT.md'), 'utf8').catch(() => '')).trim()
  if (!md) return
  try {
    const stop = setTimeout(() => void agent.cancel('boot'), 10 * 60_000)
    const reply = await unattended('boot', `Bridle just started. Follow BOOT.md:

${md}

Anything that needs the user's approval is declined here, so offer it instead. If there's nothing to tell the user, reply with exactly NO_REPLY; otherwise your reply is the message they'll see in Home.`).finally(() => clearTimeout(stop))
    if (!silent(reply)) await postHome(reply.trim(), 'BOOT.md', 'BOOT.md at launch', (await settings.get('agentName')) || 'Bridle')
  } catch (e) {
    console.warn('[boot]', e)
  }
}

export function startHeartbeat(): void {
  setInterval(() => void tick(), 60_000)
  setTimeout(() => void boot(), 60_000)
}
