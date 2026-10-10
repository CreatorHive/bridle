import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DevToolsState, RunConfig, Space, Workspace } from '../../shared/types'
import { emit } from '../events'
import { shellEnv } from './git'
import { interactiveShell, isWindows, shellCommand } from '../services/util'
import { clean, detect, serverURL } from './runconfigs'

// Run configurations, workspace setup and terminals. Kept in main for as
// long as Bridle runs, so runs and shells survive the panel or the workspace switching.

const MAX = 250_000 // ponytail: keep the last ~200k characters; a real log view would virtualize lines
const trim = (s: string) => (s.length > MAX ? s.slice(-200_000) : s)

interface Tools {
  state: DevToolsState
  child?: ChildProcess
  partial: string
}

const tools = new Map<string, Tools>()

function of(id: string): Tools {
  let t = tools.get(id)
  if (!t) {
    t = { partial: '', state: { workspaceId: id, configs: [], running: null, last: null, serverURL: null, exitCode: null, output: '', setupLog: '', settingUp: false, hasSetup: false } }
    tools.set(id, t)
  }
  return t
}

function publish(t: Tools): void {
  const { output: _o, setupLog: _s, ...rest } = t.state
  emit('code:tools', rest)
}

function append(t: Tools, kind: 'setup' | 'run', text: string, reset = false): void {
  if (kind === 'run') t.state.output = trim(reset ? text : t.state.output + text)
  else t.state.setupLog = trim(reset ? text : t.state.setupLog + text)
  emit('code:output', { workspaceId: t.state.workspaceId, kind, text, reset })
}

/** The setup script: Space.setupScript, else the repo's .bridle/setup.sh (in the worktree or the main checkout). */
export function setupScript(space: Space, w: Workspace): string | null {
  if (space.setupScript?.trim()) return space.setupScript
  return existsSync(join(space.root, '.bridle/setup.sh')) || existsSync(join(w.path, '.bridle/setup.sh'))
    ? 'zsh "$BRIDLE_ROOT_PATH/.bridle/setup.sh"' : null
}

/** Whether a new workspace runs setup by itself: your own setupScript always, the repo's .bridle/setup.sh only once
 *  you trust the repo (it's the repo's code, and a fresh clone isn't trusted yet). "Re-run setup" still runs it. */
export const autoSetup = (space: Space): boolean => space.trusted || !!space.setupScript?.trim()

export async function state(space: Space, w: Workspace): Promise<DevToolsState> {
  const t = of(w.id)
  t.state.configs = await detect(w.path)
  t.state.hasSetup = setupScript(space, w) !== null
  return t.state
}

/** The setup script in a login zsh in the worktree, output streaming into the setup log. */
export async function runSetup(space: Space, w: Workspace): Promise<void> {
  const t = of(w.id)
  const script = setupScript(space, w)
  if (!script || t.state.settingUp) return
  append(t, 'setup', `$ ${space.setupScript?.trim() ? space.setupScript : '.bridle/setup.sh'}\n`)
  const [shell, shellArgs] = shellCommand(script)
  const child = spawn(shell, shellArgs, {
    cwd: w.path, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: await shellEnv({ BRIDLE_ROOT_PATH: space.root, BRIDLE_WORKSPACE_NAME: w.name, TERM: 'dumb' })
  })
  t.state.settingUp = true
  publish(t)
  const out = (d: string) => append(t, 'setup', d)
  child.stdout?.setEncoding('utf8').on('data', out)
  child.stderr?.setEncoding('utf8').on('data', out)
  child.on('error', (e) => append(t, 'setup', `Couldn't start ${shell}: ${e.message}\n`))
  child.on('close', (code) => {
    append(t, 'setup', code === 0 ? '\nSetup finished.\n' : `\nSetup failed (exit ${code ?? -1}).\n`)
    t.state.settingUp = false
    publish(t)
  })
}

/** The command in a login zsh at the root, in its own process group so Stop reaches what it spawned. */
export async function runConfig(w: Workspace, c: RunConfig): Promise<void> {
  const t = of(w.id)
  if (t.child) stopRun(w.id)
  t.state.running = c
  t.state.last = c
  t.state.serverURL = null
  t.state.exitCode = null
  t.partial = ''
  append(t, 'run', `$ ${c.command}\n`, true)
  const [shell, shellArgs] = shellCommand(c.command)
  // Its own process group (not on Windows, where detached opens a console), so Stop reaches what it spawned.
  const child = spawn(shell, shellArgs, { cwd: w.path, detached: !isWindows, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: await shellEnv({ TERM: 'dumb' }) })
  t.child = child
  publish(t)
  /** Finished lines are cleaned, shown, and scanned for a server address. */
  const show = (lines: string[]) => {
    let text = ''
    for (const raw of lines) {
      const line = clean(raw)
      text += line + '\n'
      t.state.serverURL ??= serverURL(line)
    }
    append(t, 'run', text)
    publish(t)
  }
  const receive = (d: string) => {
    if (t.child !== child) return // a replaced run's last words
    const lines = (t.partial + d).split('\n')
    t.partial = lines.pop() ?? ''
    if (lines.length) show(lines)
  }
  child.stdout?.setEncoding('utf8').on('data', receive)
  child.stderr?.setEncoding('utf8').on('data', receive)
  child.on('error', (e) => append(t, 'run', `Couldn't start zsh: ${e.message}\n`))
  child.on('close', (code) => {
    if (t.child !== child) return // stopped, or a newer run replaced this one
    if (t.partial) show([t.partial])
    t.partial = ''
    t.child = undefined
    t.state.running = null
    t.state.exitCode = code ?? -1
    append(t, 'run', code === 0 ? '' : `\nExited with status ${code ?? -1}.\n`)
    publish(t)
  })
}

/** SIGTERM to the whole group, SIGKILL two seconds later if it's still there. */
export function stopRun(id: string): void {
  const t = tools.get(id)
  const pid = t?.child?.pid
  if (!t || !pid) return
  t.child = undefined
  t.state.running = null
  if (isWindows) {
    // No process groups: taskkill ends the tree.
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => {})
  } else {
    const kill = (sig: NodeJS.Signals) => { try { process.kill(-pid, sig) } catch { /* gone */ } }
    kill('SIGTERM')
    setTimeout(() => kill('SIGKILL'), 2000)
  }
  publish(t)
}

export function clearOutput(id: string): void {
  append(of(id), 'run', '', true)
}

// MARK: Terminals (one interactive login zsh per session)

interface Term {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

const terms = new Map<string, Term & { workspace: string }>()

type Pty = typeof import('node-pty')
let pty: Pty | null | undefined

/** node-pty, rebuilt for Electron by `npm run rebuild`; null when it didn't build. */
function loadPty(): Pty | null {
  if (pty === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      pty = require('node-pty') as Pty
    } catch (e) {
      console.warn('node-pty unavailable, terminals fall back to script(1):', e)
      pty = null
    }
  }
  return pty
}

export async function termOpen(w: Workspace, cols: number, rows: number): Promise<string> {
  const termId = randomUUID()
  const env = await shellEnv({ TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG || 'en_US.UTF-8' })
  const data = (d: string) => emit('code:term', { termId, data: d })
  const exited = () => {
    terms.delete(termId)
    emit('code:term', { termId, exited: true })
  }
  const p = loadPty()
  let term: Term
  if (p) {
    const [shell, shellArgs] = interactiveShell()
    const proc = p.spawn(shell, shellArgs, { name: 'xterm-256color', cols, rows, cwd: w.path, env: env as Record<string, string> })
    proc.onData(data)
    proc.onExit(exited)
    term = { write: (d) => proc.write(d), resize: (c, r) => proc.resize(Math.max(c, 2), Math.max(r, 1)), kill: () => proc.kill() }
  } else if (isWindows) {
    data('Terminals need node-pty: run `npm run rebuild`.\r\n')
    term = { write: () => {}, resize: () => {}, kill: () => {} }
  } else {
    // Fallback without node-pty: script(1) gives zsh a real tty, but resizing can't reach it.
    const child = spawn('/usr/bin/script', ['-q', '/dev/null', '/bin/zsh', '-l'], { cwd: w.path, env: { ...env, COLUMNS: String(cols), LINES: String(rows) } })
    child.stdout.setEncoding('utf8').on('data', data)
    child.stderr.setEncoding('utf8').on('data', data)
    child.on('close', exited)
    child.on('error', (e) => data(`Failed to start terminal: ${e.message}\r\n`))
    term = { write: (d) => child.stdin.write(d), resize: () => {}, kill: () => child.kill() }
  }
  terms.set(termId, { ...term, workspace: w.id })
  return termId
}

export const termWrite = (termId: string, data: string) => terms.get(termId)?.write(data)
export const termResize = (termId: string, cols: number, rows: number) => terms.get(termId)?.resize(cols, rows)
export function termClose(termId: string): void {
  terms.get(termId)?.kill()
  terms.delete(termId)
}

/** Stops what an archived workspace was running. */
export function dropTools(id: string): void {
  stopRun(id)
  for (const [termId, t] of terms) if (t.workspace === id) termClose(termId)
  tools.delete(id)
}

/** Everything still running (app quit). */
export function stopAllTools(): void {
  for (const id of tools.keys()) stopRun(id)
  for (const termId of terms.keys()) termClose(termId)
}
