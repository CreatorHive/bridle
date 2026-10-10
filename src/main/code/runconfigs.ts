import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunConfig } from '../../shared/types'

// Run configurations detected from the files at a repo's root, plus
// output cleaning. Every parser is pure over a file's contents.

/** Everything runnable at `root`: `.bridle/run.json` first, then what project files declare. Names are unique (first wins). */
export async function detect(root: string): Promise<RunConfig[]> {
  const read = (name: string) => readFile(join(root, name), 'utf8').catch(() => null)
  const files = new Set(await readdir(root).catch(() => [] as string[]))
  const all: RunConfig[] = []
  const user = await read('.bridle/run.json')
  if (user) all.push(...userDefined(user))
  const pkg = await read('package.json')
  if (pkg) all.push(...npm(pkg, files))
  const swift = await read('Package.swift')
  if (swift) {
    const names = swiftExecutables(swift)
    all.push(...(names.length ? names.map((n) => ({ name: n, command: `swift run ${n}` })) : [{ name: 'swift run', command: 'swift run' }]))
  }
  if (files.has('Cargo.toml')) all.push({ name: 'cargo run', command: 'cargo run' })
  const py = await read('pyproject.toml')
  if (py) all.push(...pyproject(py, files))
  if (files.has('manage.py')) all.push({ name: 'runserver', command: 'python3 manage.py runserver' })
  const make = (await read('Makefile')) ?? (await read('makefile'))
  if (make) all.push(...makefile(make))
  const procs = await read('Procfile')
  if (procs) all.push(...procfile(procs))
  const seen = new Set<string>()
  return all.filter((c) => !seen.has(c.name) && !!seen.add(c.name))
}

/** `[{"name": …, "command": …}]` from `.bridle/run.json`. */
export function userDefined(json: string): RunConfig[] {
  try {
    const items: unknown = JSON.parse(json)
    if (!Array.isArray(items)) return []
    return items.filter((d) => typeof d?.name === 'string' && typeof d?.command === 'string').map((d) => ({ name: d.name, command: d.command }))
  } catch {
    return []
  }
}

/** package.json scripts through the runner its lockfile implies; dev and start first, the rest sorted. */
export function npm(json: string, files: Set<string>): RunConfig[] {
  let scripts: Record<string, unknown>
  try {
    scripts = JSON.parse(json)?.scripts
  } catch {
    return []
  }
  if (!scripts || typeof scripts !== 'object') return []
  const runner = files.has('bun.lockb') || files.has('bun.lock') ? 'bun'
    : files.has('pnpm-lock.yaml') ? 'pnpm' : files.has('yarn.lock') ? 'yarn' : 'npm'
  const first = ['dev', 'start'].filter((n) => n in scripts)
  const names = [...first, ...Object.keys(scripts).filter((n) => !first.includes(n)).sort()]
  return names.map((n) => ({ name: n, command: `${runner} run ${n}` }))
}

/** `.executable(name:)` products, else `.executableTarget(name:)`.
 *  ponytail: a regex over the manifest; computed names fall back to plain `swift run`. */
export function swiftExecutables(manifest: string): string[] {
  const names = (re: RegExp) => [...manifest.matchAll(re)].map((m) => m[1])
  const products = names(/\.executable\(\s*name:\s*"([^"]+)"/g)
  return products.length ? products : names(/\.executableTarget\(\s*name:\s*"([^"]+)"/g)
}

/** Makefile targets, skipping special targets (`.PHONY`) and `VAR:=` assignments. */
export function makefile(text: string): RunConfig[] {
  return text.split('\n').flatMap((line) => {
    const m = /^([A-Za-z0-9_.-]+):(?!=)/.exec(line)
    return m && !m[1].startsWith('.') ? [{ name: `make ${m[1]}`, command: `make ${m[1]}` }] : []
  })
}

/** Procfile `name: command` lines. */
export function procfile(text: string): RunConfig[] {
  return text.split('\n').flatMap((line) => {
    const colon = line.indexOf(':')
    if (line.startsWith('#') || colon < 0) return []
    const name = line.slice(0, colon).trim()
    const command = line.slice(colon + 1).trim()
    return name && command ? [{ name, command }] : []
  })
}

/** `[project.scripts]` / `[tool.poetry.scripts]` entries, run through uv or poetry when locked. */
export function pyproject(text: string, files: Set<string>): RunConfig[] {
  const prefix = files.has('uv.lock') ? 'uv run ' : files.has('poetry.lock') ? 'poetry run ' : ''
  let inScripts = false
  const out: RunConfig[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inScripts = line === '[project.scripts]' || line === '[tool.poetry.scripts]'
      continue
    }
    const eq = line.indexOf('=')
    if (!inScripts || eq < 0 || line.startsWith('#')) continue
    const name = line.slice(0, eq).trim().replace(/^["']+|["']+$/g, '')
    if (name) out.push({ name, command: prefix + name })
  }
  return out
}

// MARK: Output (clean / serverURL)

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g

/** Drops ANSI escapes and carriage-return overwrites (a progress bar keeps its last frame). */
export function clean(line: string): string {
  return line.replace(ANSI, '').split('\r').filter(Boolean).pop() ?? ''
}

/** The first local dev-server address in a line; 0.0.0.0 opens as localhost. */
export function serverURL(line: string): string | null {
  const m = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+\S*/.exec(line)
  return m ? m[0].replace(/[.,;)'"]+$/, '').replace('0.0.0.0', 'localhost') : null
}
