import { spawn } from 'node:child_process'

// Small helpers shared by the services. No shell anywhere: every command is argv.

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs a binary (no shell), optionally feeding `input` on stdin. Never rejects on a non-zero exit. */
export function run(cmd: string, args: string[], options: { input?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] })
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

/** Environment for the Claude CLI: a stray key would override the user's subscription. */
export function cliEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra }
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[key]
  return env
}
