import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChangedFile, DiffHunk, DiffLine, FileChange } from '../../shared/types'
import { interactiveShell, isWindows, run, type RunResult } from '../services/util'

// Every command is argv (no shell) through /usr/bin/env with the login PATH, so a missing tool
// exits 127; git never prompts (there's no terminal to answer it). On Windows, GUI apps already get the
// user's PATH and there's no /usr/bin/env: the tool runs directly.

let loginPATH: Promise<string | null> | null = null

/** PATH from an interactive login shell (zsh on macOS, $SHELL on Linux), read once; 3 s timeout keeps the current PATH. */
function readLoginPATH(): Promise<string | null> {
  return new Promise((resolve) => {
    const [shell] = interactiveShell()
    const child = spawn(shell, ['-lic', 'printf "__BRIDLE_PATH__%s\\n" "$PATH"'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    const timer = setTimeout(() => child.kill(), 3000)
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d))
    child.on('error', () => resolve(null))
    child.on('close', () => {
      clearTimeout(timer)
      const line = out.split('\n').reverse().find((l) => l.startsWith('__BRIDLE_PATH__'))
      resolve(line ? line.slice('__BRIDLE_PATH__'.length) : null)
    })
  })
}

/** This process's environment with the login PATH, plus `extra`. */
export async function shellEnv(extra: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  loginPATH ??= process.env.VITEST || isWindows ? Promise.resolve(null) : readLoginPATH()
  const path = await loginPATH
  return { ...process.env, ...(path ? { PATH: path } : {}), ...extra }
}

export type Result = RunResult & { ok: boolean }

/** `args[0]` looked up on the login PATH, in `cwd`. Never rejects. */
export async function sh(args: string[], cwd: string, env: Record<string, string> = {}): Promise<Result> {
  try {
    const r = isWindows ? await run(args[0], args.slice(1), { cwd, env: await shellEnv(env) }) : await run('/usr/bin/env', args, { cwd, env: await shellEnv(env) })
    return { ...r, ok: r.code === 0 }
  } catch (e) {
    return { code: -1, stdout: '', stderr: e instanceof Error ? e.message : String(e), ok: false }
  }
}

/** Git that never prompts for credentials. */
export const git = (args: string[], cwd: string, env: Record<string, string> = {}): Promise<Result> =>
  sh(['git', ...args], cwd, { GIT_TERMINAL_PROMPT: '0', ...env })

export async function isRepo(root: string): Promise<boolean> {
  return (await git(['rev-parse', '--is-inside-work-tree'], root)).stdout.startsWith('true')
}

/** The checked-out branch; null when detached or not a repo. */
export async function branch(root: string): Promise<string | null> {
  const r = await git(['branch', '--show-current'], root)
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null
}

/** The remote's default branch ("origin/main"), else the branch you're on. */
export async function defaultBase(root: string): Promise<string> {
  const remote = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root)
  if (remote.ok && remote.stdout.trim()) return remote.stdout.trim()
  return (await branch(root)) ?? 'HEAD'
}

/** What a workspace diffs against: the merge-base with its base, else HEAD. */
export async function mergeBase(path: string, base: string): Promise<string> {
  const r = await git(['merge-base', 'HEAD', base], path)
  return r.ok ? r.stdout.trim() : 'HEAD'
}

// MARK: Changes (Workspaces.refresh / parse)

/** Combines `diff --numstat -z`, `diff --name-status -z` and `ls-files -z --others`.
 *  `lines(path)` counts an untracked file's lines (0 for binary). */
export function parseChanges(numstat: string, nameStatus: string, untracked: string, lines: (path: string) => number): ChangedFile[] {
  const counts = new Map<string, [number, number]>()
  for (const line of numstat.split('\0')) {
    const parts = splitTabs(line)
    if (parts) counts.set(parts[2], [Number(parts[0]) || 0, Number(parts[1]) || 0]) // binary: "-"
  }
  const files: ChangedFile[] = []
  const fields = nameStatus.split('\0').filter(Boolean)
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const path = fields[i + 1]
    const [added, removed] = counts.get(path) ?? [0, 0]
    files.push({ path, status: fields[i].slice(0, 1), added, removed })
  }
  for (const path of untracked.split('\0').filter(Boolean)) files.push({ path, status: 'U', added: lines(path), removed: 0 })
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** "added\tremoved\tpath" → its three parts (the path may hold tabs). */
function splitTabs(line: string): [string, string, string] | null {
  const a = line.indexOf('\t')
  const b = a < 0 ? -1 : line.indexOf('\t', a + 1)
  return b < 0 ? null : [line.slice(0, a), line.slice(a + 1, b), line.slice(b + 1)]
}

/** Lines in a text (a final newline doesn't start a line); 0 for binary. */
export function countLines(text: string): number {
  if (!text || text.includes('\0')) return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

// MARK: Unified diff (hunks from git rather than recomputed)

/** Hunks of a `git diff -U3` for one file. Lines keep both numbers; "\ No newline" markers are dropped. */
export function parseUnified(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let hunk: DiffHunk | null = null
  let oldN = 0
  let newN = 0
  for (const raw of diff.split('\n')) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw)
    if (header) {
      hunk = {
        oldStart: Number(header[1]), oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]), newCount: header[4] === undefined ? 1 : Number(header[4]), lines: []
      }
      hunks.push(hunk)
      oldN = hunk.oldStart
      newN = hunk.newStart
      continue
    }
    if (!hunk) continue
    const sign = raw[0]
    let line: DiffLine | null = null
    if (sign === ' ') line = { kind: 'context', old: oldN++, new: newN++, text: raw.slice(1) }
    else if (sign === '-') line = { kind: 'removed', old: oldN++, new: null, text: raw.slice(1) }
    else if (sign === '+') line = { kind: 'added', old: null, new: newN++, text: raw.slice(1) }
    if (line) hunk.lines.push(line)
  }
  return hunks
}

// MARK: Snapshots

/** The ref a turn's snapshot lives at; `space` is the workspace id ("repo/name"). */
export const snapshotRef = (space: string, turn: string, side: 'before' | 'after'): string =>
  `refs/bridle/${space}/${turn.toLowerCase()}-${side}`

/** Commits the working tree (untracked files too) through a throwaway index and points `ref` at it.
 *  Your index, HEAD and branches are never touched. Returns the commit, or null.
 *  ponytail: hashes every non-ignored file; a huge un-ignored folder makes it slow. */
export async function snapshot(root: string, ref: string): Promise<string | null> {
  const index = join(tmpdir(), `bridle-index-${randomUUID().toUpperCase()}`)
  try {
    const yours = (await git(['rev-parse', '--path-format=absolute', '--git-path', 'index'], root)).stdout.trim()
    await copyFile(yours, index).catch(() => {}) // start from your index so unchanged files aren't re-hashed
    const env = {
      GIT_INDEX_FILE: index, GIT_AUTHOR_NAME: 'Bridle', GIT_AUTHOR_EMAIL: 'bridle@localhost',
      GIT_COMMITTER_NAME: 'Bridle', GIT_COMMITTER_EMAIL: 'bridle@localhost'
    }
    if (!(await git(['add', '-A', '--', ':/'], root, env)).ok) return null
    const tree = await git(['write-tree'], root, env)
    if (!tree.ok) return null
    const commit = await git(['commit-tree', tree.stdout.trim(), '-m', 'bridle-snapshot'], root, env)
    if (!commit.ok || !(await git(['update-ref', ref, commit.stdout.trim()], root)).ok) return null
    return commit.stdout.trim()
  } finally {
    await rm(index, { force: true })
  }
}

/** Files that differ between two snapshots. Binary files count 0 / 0. */
export async function numstat(root: string, a: string, b: string): Promise<FileChange[]> {
  const r = await git(['diff', '--numstat', '--no-renames', '--relative', '-z', a, b], root)
  return parseNumstat(r.stdout)
}

export function parseNumstat(out: string): FileChange[] {
  return out.split('\0').map(splitTabs).filter((p): p is [string, string, string] => p !== null)
    .map(([a, r, path]) => ({ path, added: Number(a) || 0, removed: Number(r) || 0 }))
}

// MARK: Pull requests

/** "git@github.com:o/r.git" or "https://github.com/o/r" → ".../o/r/compare/main...bridle/x?expand=1". */
export function compareURL(remote: string, base: string, branchName: string): string | null {
  let s = remote.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const ssh = /^(?:ssh:\/\/)?[^@/]+@([^:/]+)[:/](?:\d+\/)?(.+)$/.exec(s)
  const https = /^https?:\/\/(?:[^@/]+@)?(.+)$/.exec(s)
  if (ssh) s = `https://${ssh[1]}/${ssh[2]}`
  else if (https) s = `https://${https[1]}`
  else return null
  return `${s}/compare/${base}...${branchName}?expand=1`
}
