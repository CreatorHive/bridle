import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

// Small helpers shared by the services. No shell anywhere: every command is argv.

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs a binary (no shell), optionally feeding `input` on stdin. Never rejects on a non-zero exit. */
export function run(cmd: string, args: string[], options: { input?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    child.stdin.on('error', () => {}) // the child may exit before reading
    child.stdin.end(options.input ?? '')
  })
}

/** ISO 8601: "2026-10-09T14:03:11Z", UTC, no fractional seconds. */
export function iso(date: Date | string | number = new Date()): string {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** JSON with object keys sorted at every level. */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]))
  }
  return value
}

/** Environment for the Claude CLI: a stray key would override the user's subscription. `extra` (LM Studio's
 *  ANTHROPIC_BASE_URL) is deliberate and goes on after. */
export function cliEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[key]
  return { ...env, ...extra }
}

/** macOS keeps settings in `defaults` and keys in the Keychain; elsewhere they're JSON files in userData. */
export const isMac = process.platform === 'darwin'

/** A private JSON object in Electron's userData folder (settings and secrets off macOS). */
export function userDataFile(name: string): { read(): Record<string, unknown>; write(value: Record<string, unknown>): void } {
  const path = () => join(app.getPath('userData'), name)
  return {
    read() {
      try {
        return JSON.parse(readFileSync(path(), 'utf8')) as Record<string, unknown>
      } catch {
        return {}
      }
    },
    write(value) {
      mkdirSync(dirname(path()), { recursive: true })
      writeFileSync(`${path()}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 })
      renameSync(`${path()}.tmp`, path())
    }
  }
}

export const isWindows = process.platform === 'win32'

/** A login shell that runs `script` and exits: zsh on macOS, $SHELL on Linux, PowerShell on Windows. */
export function shellCommand(script: string): [string, string[]] {
  if (isWindows) return ['powershell.exe', ['-NoLogo', '-NoProfile', '-Command', script]]
  return [isMac ? '/bin/zsh' : process.env.SHELL || '/bin/bash', ['-lc', script]]
}

/** An interactive shell for a terminal. */
export function interactiveShell(): [string, string[]] {
  if (isWindows) return ['powershell.exe', ['-NoLogo']]
  return [isMac ? '/bin/zsh' : process.env.SHELL || '/bin/bash', ['-l']]
}
