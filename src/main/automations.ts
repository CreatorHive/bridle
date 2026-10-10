import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import type { BridleAPI, BridleEvents } from '../shared/api'
import type { Loop, Routine } from '../shared/types'
import { banner, emit, onEmit } from './events'
import { tasks } from './services/tasks'
import { cliEnv, isWindows, iso, run } from './services/util'
import { workspaceRoot } from './services/workspace'

// Work Bridle starts on its own, like Comma's Routines, Loops and Tasks. Each runs as an ordinary chat turn
// that main asks the main window to send ('agent:start'), so it streams, asks for approvals and saves like
// one you typed:
//   Routines  routines/<slug>.md: front matter `when: weekdays 08:00`, then "# Title" and the prompt.
//   Loops     loops/<slug>/LOOP.md (`every: 15m`, "# Title", what to do) + check.sh. The script runs with no
//             model; when its output changes, the agent wakes with it. It runs only once you approve its text.
//   Tasks     a board task, worked in its own chat until the agent marks it done or needs review.
// State (last runs, approvals, chats) is .bridle/automations.json. ponytail: runs only while Bridle is open.

// MARK: Front matter

/** `---` key: value lines `---`, then the rest. */
export function frontMatter(md: string): { fields: Record<string, string>; body: string } {
  const fields: Record<string, string> = {}
  const lines = md.split('\n')
  if (lines[0]?.trim() !== '---') return { fields, body: md }
  const end = lines.indexOf('---', 1)
  if (end < 0) return { fields, body: md }
  for (const line of lines.slice(1, end)) {
    const i = line.indexOf(':')
    if (i > 0) fields[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return { fields, body: lines.slice(end + 1).join('\n') }
}

/** Sets one front matter field, adding the block if there's none. */
export function withField(md: string, key: string, value: string): string {
  const lines = md.split('\n')
  if (lines[0]?.trim() !== '---' || lines.indexOf('---', 1) < 0) return `---\n${key}: ${value}\n---\n${md}`
  const end = lines.indexOf('---', 1)
  const at = lines.slice(1, end).findIndex((l) => l.split(':')[0].trim().toLowerCase() === key)
  if (at >= 0) lines[at + 1] = `${key}: ${value}`
  else lines.splice(end, 0, `${key}: ${value}`)
  return lines.join('\n')
}

/** "# Title" and what follows it. */
function titled(body: string, fallback: string): { title: string; text: string } {
  const lines = body.trim().split('\n')
  if (lines[0]?.startsWith('# ')) return { title: lines[0].slice(2).trim() || fallback, text: lines.slice(1).join('\n').trim() }
  return { title: fallback, text: body.trim() }
}

const on = (v: string | undefined) => !/^(false|no|off|0)$/i.test(v ?? '')

// MARK: Schedules

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** "weekdays 08:00", "daily 7:30 pm", "mon, thu 16:00" → days (0 = Sunday) and minutes after midnight. */
export function parseWhen(when: string): { days: number[]; minutes: number } | null {
  const m = when.trim().toLowerCase().match(/^(.*?)\s*(\d{1,2}):(\d{2})\s*(am|pm)?$/)
  if (!m) return null
  let hour = Number(m[2])
  const minute = Number(m[3])
  if (m[4]) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (m[4] === 'pm' ? 12 : 0)
  }
  if (hour > 23 || minute > 59) return null
  const spec = m[1].replace(/^every\s+/, '').trim()
  let days: number[]
  if (spec === '' || spec === 'daily' || spec === 'day') days = [0, 1, 2, 3, 4, 5, 6]
  else if (spec === 'weekdays') days = [1, 2, 3, 4, 5]
  else if (spec === 'weekends') days = [0, 6]
  else {
    days = spec.split(/[\s,]+/).filter(Boolean).map((d) => DAYS.indexOf(d.slice(0, 3)))
    if (!days.length || days.includes(-1)) return null
  }
  return { days, minutes: hour * 60 + minute }
}

/** The latest scheduled time at or before `now`, within a week. */
export function lastDue(when: { days: number[]; minutes: number }, now: Date): Date | null {
  for (let back = 0; back < 8; back++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 0, when.minutes)
    if (when.days.includes(d.getDay()) && d <= now) return d
  }
  return null
}

/** A missed run still goes out if Bridle opens within this long after it (the Mac was asleep at 8:00). */
const CATCH_UP = 3 * 3600_000

export function routineDue(when: string, lastRun: string | null, now = new Date()): boolean {
  const parsed = parseWhen(when)
  const due = parsed && lastDue(parsed, now)
  if (!due || now.getTime() - due.getTime() > CATCH_UP) return false
  return !lastRun || new Date(lastRun) < due
}

/** "15m", "2h", "30 minutes" → milliseconds; at least a minute, 15 minutes when unreadable. */
export function every(text: string): number {
  const m = text.trim().toLowerCase().match(/^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)$/)
  if (!m) return 15 * 60_000
  return Math.max(1, Number(m[1])) * (m[2].startsWith('h') ? 3600_000 : 60_000)
}

// MARK: State

interface State {
  routines: Record<string, { lastRun?: string; chatId?: string }>
  loops: Record<string, { approved?: string; lastRun?: string; output?: string; error?: string; chatId?: string }>
}

async function stateFile(): Promise<string> {
  return join(await workspaceRoot(), '.bridle', 'automations.json')
}

async function load(): Promise<State> {
  try {
    const s = JSON.parse(await readFile(await stateFile(), 'utf8')) as Partial<State>
    return { routines: s.routines ?? {}, loops: s.loops ?? {} }
  } catch {
    return { routines: {}, loops: {} }
  }
}

async function save(state: State): Promise<void> {
  const file = await stateFile()
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, JSON.stringify(state, null, 2))
}

/** The loop's check script: check.sh (run with /bin/sh), or check.ps1 with PowerShell on Windows. */
export const LOOP_SCRIPT = isWindows ? 'check.ps1' : 'check.sh'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const slugOk = (slug: string) => /^[\w.-]+$/.test(slug) && slug !== '.' && slug !== '..'

// MARK: Starting turns

const queue: BridleEvents['agent:start'][] = []
const busy = new Set<string>()
let ready = false

/** The main window (no #hash) has loaded and listens for 'agent:start'. */
function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !w.webContents.getURL().includes('#'))
}

/** Sends `text` in chat `chatId` through the main window; waits for a window if none is open. */
export function startTurn(chatId: string, title: string, text: string): void {
  busy.add(chatId)
  queue.push({ chatId, title, text })
  flush()
}

function flush(): void {
  if (!ready || !mainWindow()) return
  for (const turn of queue.splice(0)) emit('agent:start', turn)
}

// MARK: Routines

async function readRoutines(state: State): Promise<(Routine & { prompt: string; file: string })[]> {
  const dir = join(await workspaceRoot(), 'routines')
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.md'))
  const out = []
  for (const n of names.sort()) {
    const file = join(dir, n)
    const md = await readFile(file, 'utf8').catch(() => null)
    if (md === null) continue
    const slug = n.slice(0, -3)
    const { fields, body } = frontMatter(md)
    const { title, text } = titled(body, slug)
    const when = fields.when ?? ''
    const st = state.routines[slug] ?? {}
    out.push({
      slug, title, when, valid: !!parseWhen(when), enabled: on(fields.enabled), lastRun: st.lastRun ?? null,
      chatId: st.chatId ?? null, prompt: text, file
    })
  }
  return out
}

async function runRoutine(r: { slug: string; title: string; when: string; prompt: string }, state: State): Promise<void> {
  const st = (state.routines[r.slug] ??= {})
  if (st.chatId && busy.has(st.chatId)) return
  st.chatId ??= randomUUID()
  st.lastRun = iso()
  await save(state)
  startTurn(st.chatId, r.title, `Routine "${r.title}" (${r.when}). Do this now:\n\n${r.prompt}`)
}

// MARK: Loops

async function readLoops(state: State): Promise<(Loop & { dir: string; prompt: string })[]> {
  const root = join(await workspaceRoot(), 'loops')
  const out = []
  for (const slug of (await readdir(root).catch(() => [] as string[])).sort()) {
    if (!slugOk(slug)) continue
    const dir = join(root, slug)
    const md = await readFile(join(dir, 'LOOP.md'), 'utf8').catch(() => null)
    if (md === null) continue
    const script = await readFile(join(dir, LOOP_SCRIPT), 'utf8').catch(() => '')
    const { fields, body } = frontMatter(md)
    const { title, text } = titled(body, slug)
    const st = state.loops[slug] ?? {}
    out.push({
      slug, title, every: fields.every ?? '15m', enabled: on(fields.enabled), script,
      approved: !!script && st.approved === sha(script), lastRun: st.lastRun ?? null,
      lastOutput: st.error ?? st.output ?? null, chatId: st.chatId ?? null, dir, prompt: text
    })
  }
  return out
}

const MAX_OUTPUT = 20_000

/** Runs check.sh (no model); a changed, non-empty output wakes the agent. The first run only records it. */
async function checkLoop(l: { slug: string; title: string; dir: string; script: string; prompt: string }, state: State): Promise<void> {
  const st = (state.loops[l.slug] ??= {})
  const first = st.lastRun === undefined
  st.lastRun = iso()
  try {
    const r = await withTimeout(isWindows
      ? run('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', LOOP_SCRIPT], { cwd: l.dir, env: cliEnv() })
      : run('/bin/sh', [LOOP_SCRIPT], { cwd: l.dir, env: cliEnv() }), 60_000)
    if (r.code !== 0) throw new Error(`${LOOP_SCRIPT} exited with ${r.code}: ${(r.stderr || r.stdout).trim().slice(0, 500)}`)
    const output = r.stdout.trim().slice(0, MAX_OUTPUT)
    const changed = output !== (st.output ?? '')
    st.output = output
    delete st.error
    if (changed && output && !first && !(st.chatId && busy.has(st.chatId))) {
      st.chatId ??= randomUUID()
      startTurn(st.chatId, l.title, `Loop "${l.title}" noticed a change. Its check printed:\n\n\`\`\`\n${output}\n\`\`\`\n\n${l.prompt}`)
    }
  } catch (e) {
    st.error = e instanceof Error ? e.message : String(e)
  }
  await save(state)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  // ponytail: the timeout stops waiting, not the script; a hung check keeps its process until it ends.
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${LOOP_SCRIPT} took over a minute`)), ms))])
}

// MARK: Task runs

const MAX_ATTEMPTS = 3
const taskRuns = new Map<string, { taskId: string; attempts: number }>()

const TASK_RULES = `Plan it, do the work, then check it. Stay inside the workspace unless I approve something outside it.
When you're finished, edit the task file's front matter: \`status: done\` if it's complete and checked, or \`status: needs review\` if a decision or approval is mine. Add a short "## Result" section to its notes saying what you did and where.`

/** Works one of your board tasks in its own chat: moves it to In progress and starts the agent. */
export async function runTask(id: string): Promise<void> {
  const task = (await tasks.list()).find((t) => t.id === id)
  if (!task) throw new Error('No such task')
  if (task.linear) throw new Error('Bridle can only run your own tasks, not Linear issues')
  const chatId = task.chat ?? randomUUID()
  if (busy.has(chatId)) return
  await tasks.update({ ...task, status: 'in progress', chat: chatId })
  emit('tasks:changed', {})
  taskRuns.set(chatId, { taskId: id, attempts: 1 })
  startTurn(chatId, task.title, `Work on this task from my board until it's done. It's tasks/${id}.md:\n\n# ${task.title}\n${task.notes}\n\n${TASK_RULES}`)
}

/** After each turn: done or needs review ends it; still in progress goes again, up to three turns, then needs review. */
async function taskTurnEnded(chatId: string, failed: boolean): Promise<void> {
  const r = taskRuns.get(chatId)
  if (!r) return
  const task = (await tasks.list()).find((t) => t.id === r.taskId)
  if (!task) return void taskRuns.delete(chatId)
  if (task.status === 'in progress' && !failed && r.attempts < MAX_ATTEMPTS) {
    r.attempts++
    setTimeout(() => startTurn(chatId, task.title, `The task is still marked in progress. Keep going: finish and check the work, then set its status, or set \`status: needs review\` and say what you need from me.`), 2000)
    return
  }
  taskRuns.delete(chatId)
  if (task.status === 'in progress') await tasks.move(task.id, 'needs review')
  emit('tasks:changed', {})
  const final = task.status === 'in progress' ? 'needs review' : task.status
  banner(final === 'done' ? 'Task done' : 'Task needs you', task.title, chatId)
}

// MARK: Scheduler

let ticking = false

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const state = await load()
    for (const r of await readRoutines(state)) {
      if (r.enabled && r.valid && routineDue(r.when, r.lastRun)) await runRoutine(r, state)
    }
    const now = Date.now()
    for (const l of await readLoops(state)) {
      const last = l.lastRun ? new Date(l.lastRun).getTime() : 0
      if (l.enabled && l.approved && now - last >= every(l.every)) await checkLoop(l, state)
    }
  } catch (e) {
    console.warn('[automations]', e)
  } finally {
    ticking = false
  }
}

export function startAutomations(): void {
  onEmit((event, payload) => {
    if (event !== 'agent:event') return
    const { chatId, event: e } = payload as BridleEvents['agent:event']
    if (e.type !== 'done' && e.type !== 'error') return
    busy.delete(chatId)
    void taskTurnEnded(chatId, e.type === 'error')
  })
  // The main window's renderer subscribes once React has mounted; give it a moment after load.
  app.on('browser-window-created', (_e, w) => {
    w.webContents.on('did-finish-load', () => {
      if (w.webContents.getURL().includes('#')) return
      setTimeout(() => {
        ready = true
        flush()
      }, 1500)
    })
  })
  setInterval(() => void tick(), 60_000)
  setTimeout(() => void tick(), 10_000)
}

// MARK: API

async function routineFile(slug: string): Promise<string> {
  if (!slugOk(slug)) throw new Error('No such routine')
  return join(await workspaceRoot(), 'routines', `${slug}.md`)
}

async function loopFile(slug: string, name: string): Promise<string> {
  if (!slugOk(slug)) throw new Error('No such loop')
  return join(await workspaceRoot(), 'loops', slug, name)
}

const strip = <T extends object>(o: T, ...keys: string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) as T

export const automations: BridleAPI['automations'] = {
  async routines() {
    return (await readRoutines(await load())).map((r) => strip(r, 'prompt', 'file'))
  },

  async loops() {
    return (await readLoops(await load())).map((l) => strip(l, 'dir', 'prompt'))
  },

  async setEnabled(kind, slug, enabled) {
    const file = kind === 'routine' ? await routineFile(slug) : await loopFile(slug, 'LOOP.md')
    await writeFile(file, withField(await readFile(file, 'utf8'), 'enabled', String(enabled)))
  },

  async approve(slug) {
    const script = await readFile(await loopFile(slug, LOOP_SCRIPT), 'utf8')
    const state = await load()
    // A fresh approval re-baselines: the next check records the output instead of waking the agent.
    state.loops[slug] = { ...state.loops[slug], approved: sha(script), lastRun: undefined, output: undefined, error: undefined }
    await save(state)
  },

  async runNow(kind, slug) {
    const state = await load()
    if (kind === 'routine') {
      const r = (await readRoutines(state)).find((x) => x.slug === slug)
      if (!r) throw new Error('No such routine')
      return runRoutine(r, state)
    }
    const l = (await readLoops(state)).find((x) => x.slug === slug)
    if (!l) throw new Error('No such loop')
    if (!l.approved) throw new Error(`Approve ${LOOP_SCRIPT} first`)
    await checkLoop(l, state)
  }
}
