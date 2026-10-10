import { existsSync, statSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ChangedFile, DiffHunk, DirEntry, GitHubRepo, Space, Workspace } from '../../shared/types'
import { iso } from '../services/util'
import { slug as slugify, workspaceRoot } from '../services/workspace'
import { compareURL, countLines, defaultBase, git, isRepo, mergeBase, parseChanges, parseUnified, sh } from './git'

// Spaces, workspaces, cloning and the file tree. Everything lives in the
// Bridle workspace, never inside the repo:
//   spaces/<slug>/space.json                          repo path, trust, always-allowed commands
//   spaces/<repo>/workspaces/<name>/workspace.json   (+ chats/)
//   .bridle/worktrees/<repo>/<name>/                 the checkout, on branch bridle/<name>
// JSON on disk: `root`/`path` as file:// URLs, ISO dates, sorted keys; unknown keys are kept.

export const UNTITLED = 'New workspace'

/** The names new workspaces (and their branches) get. */
export const CITIES = ['lisbon', 'porto', 'madrid', 'seville', 'valencia', 'paris', 'lyon', 'marseille', 'nice', 'geneva',
  'zurich', 'vienna', 'prague', 'berlin', 'hamburg', 'munich', 'cologne', 'amsterdam', 'utrecht', 'brussels',
  'ghent', 'antwerp', 'london', 'bristol', 'dublin', 'galway', 'edinburgh', 'oslo', 'bergen', 'stockholm',
  'malmo', 'helsinki', 'tallinn', 'riga', 'vilnius', 'warsaw', 'krakow', 'budapest', 'zagreb', 'split',
  'athens', 'rome', 'milan', 'turin', 'florence', 'naples', 'venice', 'istanbul', 'cairo', 'tunis',
  'marrakesh', 'lagos', 'nairobi', 'kyoto', 'osaka', 'tokyo', 'seoul', 'taipei', 'hanoi', 'manila',
  'jakarta', 'sydney', 'hobart', 'auckland', 'lima', 'quito', 'bogota', 'havana', 'denver', 'austin']

/** A free name: a random city, then "lisbon-2", "lisbon-3"… while `taken`. */
export async function freeCity(taken: (name: string) => Promise<boolean>, pick = Math.random): Promise<string> {
  const stem = CITIES[Math.floor(pick() * CITIES.length)]
  let name = stem
  for (let n = 2; await taken(name); n++) name = `${stem}-${n}`
  return name
}

/** A free Space slug for a folder name: "my-repo", "my-repo-2"… */
export function freeSlug(folder: string, used: string[]): string {
  const base = slugify(folder) || 'space'
  let slug = base
  for (let n = 2; used.includes(slug); n++) slug = `${base}-${n}`
  return slug
}

const toPath = (url: unknown): string => {
  const s = String(url ?? '')
  return (s.startsWith('file:') ? fileURLToPath(s) : s).replace(/(.)\/+$/, '$1')
}

async function readJSON(file: string): Promise<Record<string, unknown> | null> {
  try {
    const v = JSON.parse(await readFile(file, 'utf8'))
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

/** Atomic write of sorted, pretty JSON. */
async function writeJSON(file: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const sorted = Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]]))
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(sorted, null, 2), 'utf8')
  await rename(tmp, file)
}

// MARK: Spaces

const spacesDir = async () => join(await workspaceRoot(), 'spaces')

export function decodeSpace(o: Record<string, unknown>): Space | null {
  if (typeof o.slug !== 'string' || typeof o.name !== 'string' || !o.root) return null
  return {
    slug: o.slug, name: o.name, root: toPath(o.root), trusted: o.trusted === true,
    allowedCommands: Array.isArray(o.allowedCommands) ? o.allowedCommands.filter((c): c is string => typeof c === 'string') : [],
    engine: typeof o.engine === 'string' ? o.engine : 'claude',
    setupScript: typeof o.setupScript === 'string' ? o.setupScript : null
  }
}

/** Space as stored: `root` a file URL, nil setupScript left out. */
export function encodeSpace(s: Space): Record<string, unknown> {
  const o: Record<string, unknown> = {
    slug: s.slug, name: s.name, root: pathToFileURL(s.root).href, trusted: s.trusted,
    allowedCommands: s.allowedCommands, engine: s.engine
  }
  if (s.setupScript) o.setupScript = s.setupScript
  return o
}

/** Every spaces/<slug>/space.json, by name. */
export async function loadSpaces(): Promise<Space[]> {
  const dir = await spacesDir()
  const names = await readdir(dir).catch(() => [] as string[])
  const all = await Promise.all(names.map(async (n) => {
    const o = await readJSON(join(dir, n, 'space.json'))
    return o && decodeSpace(o)
  }))
  return all.filter((s): s is Space => !!s).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

export async function saveSpace(s: Space): Promise<void> {
  const file = join(await spacesDir(), s.slug, 'space.json')
  const old = (await readJSON(file)) ?? {}
  delete old.setupScript
  await writeJSON(file, { ...old, ...encodeSpace(s) })
}

export async function spaceOf(slug: string): Promise<Space> {
  const s = (await loadSpaces()).find((x) => x.slug === slug)
  if (!s) throw new Error(`No repository “${slug}”`)
  return s
}

/** A repo folder (a file adds its folder), or the Space it already has. */
export async function addSpace(path: string): Promise<Space> {
  let root = resolve(path.replace(/^~(?=$|\/)/, homedir()))
  if (existsSync(root) && !statSync(root).isDirectory()) root = dirname(root)
  const all = await loadSpaces()
  const existing = all.find((s) => s.root === root)
  if (existing) return existing
  const space: Space = { slug: freeSlug(basename(root), all.map((s) => s.slug)), name: basename(root), root, trusted: false, allowedCommands: [], engine: 'claude', setupScript: null }
  await saveSpace(space)
  return space
}

// MARK: Workspaces

const worktreePath = async (repo: string, name: string) => join(await workspaceRoot(), '.bridle', 'worktrees', repo, name)
const recordDir = async (repo: string, name: string) => join(await spacesDir(), repo, 'workspaces', name)
export const chatsDir = async (w: Workspace) => join(await recordDir(w.repo, w.name), 'chats')

export function decodeWorkspace(o: Record<string, unknown>): Workspace | null {
  const keys = ['repo', 'name', 'branch', 'base', 'title', 'path', 'created'] as const
  if (keys.some((k) => typeof o[k] !== 'string')) return null
  const s = o as Record<(typeof keys)[number], string>
  return { id: `${s.repo}/${s.name}`, repo: s.repo, name: s.name, branch: s.branch, base: s.base, title: s.title, path: toPath(s.path), created: iso(s.created) }
}

async function saveWorkspace(w: Workspace, archived = false): Promise<void> {
  const file = join(await recordDir(w.repo, w.name), 'workspace.json')
  const old = (await readJSON(file)) ?? {}
  const o: Record<string, unknown> = { ...old, repo: w.repo, name: w.name, branch: w.branch, base: w.base, title: w.title, path: pathToFileURL(w.path).href, created: iso(w.created) }
  if (archived) o.archived = true
  await mkdir(join(dirname(file), 'chats'), { recursive: true })
  await writeJSON(file, o)
}

/** Active (not archived) workspaces, newest first. */
export async function loadWorkspaces(): Promise<Workspace[]> {
  const dir = await spacesDir()
  const out: Workspace[] = []
  for (const space of await readdir(dir).catch(() => [] as string[])) {
    for (const name of await readdir(join(dir, space, 'workspaces')).catch(() => [] as string[])) {
      const o = await readJSON(join(dir, space, 'workspaces', name, 'workspace.json'))
      const w = o && o.archived !== true ? decodeWorkspace(o) : null
      if (w) out.push(w)
    }
  }
  return out.sort((a, b) => b.created.localeCompare(a.created))
}

export async function workspaceOf(id: string): Promise<Workspace> {
  const w = (await loadWorkspaces()).find((x) => x.id === id)
  if (!w) throw new Error('That workspace is gone.')
  return w
}

/** Best effort, so a new workspace starts from the latest; gives up waiting after 5 s.
 *  ponytail: a timed-out fetch keeps running until git gives up on its own. */
async function fetchBase(root: string, branch: string): Promise<void> {
  await Promise.race([git(['fetch', '--quiet', 'origin', branch], root), new Promise((r) => setTimeout(r, 5000))])
}

/** Gitignored local files a fresh checkout lacks: what `.worktreeinclude` lists, else the root's `.env*` files. */
export async function copyLocalFiles(root: string, path: string): Promise<void> {
  const include = join(root, '.worktreeinclude')
  const pattern = existsSync(include) ? `--exclude-from=${include}` : '--exclude=/.env*'
  const r = await git(['ls-files', '-z', '--others', '--ignored', pattern], root)
  for (const file of r.stdout.split('\0').filter(Boolean)) {
    const to = join(path, file)
    await mkdir(dirname(to), { recursive: true }).catch(() => {})
    await copyFile(join(root, file), to).catch(() => {})
  }
}

/** A worktree on bridle/<city> from the default base, without tracking (it must never push to the base). */
export async function createWorkspace(space: Space): Promise<Workspace> {
  const root = space.root
  if (!(await isRepo(root))) throw new Error(`${space.name} isn't a git repository.`)
  const base = await defaultBase(root)
  if (base.startsWith('origin/')) await fetchBase(root, base.slice(7))
  const taken = async (name: string) =>
    existsSync(await recordDir(space.slug, name)) || existsSync(await worktreePath(space.slug, name))
      || (await git(['rev-parse', '--verify', '--quiet', `refs/heads/bridle/${name}`], root)).ok
  const name = await freeCity(taken)
  const path = await worktreePath(space.slug, name)
  await mkdir(dirname(path), { recursive: true })
  const add = await git(['worktree', 'add', '--no-track', '-b', `bridle/${name}`, path, base], root)
  if (!add.ok) throw new Error(add.stderr.trim() || 'git worktree add failed')
  const w: Workspace = { id: `${space.slug}/${name}`, repo: space.slug, name, branch: `bridle/${name}`, base, title: UNTITLED, path, created: iso() }
  await saveWorkspace(w)
  await copyLocalFiles(root, path)
  return w
}

/** Removes the worktree (refusing with uncommitted work unless `force`); branch and record stay. */
export async function archiveWorkspace(w: Workspace, force: boolean): Promise<void> {
  if (existsSync(w.path)) {
    const status = await git(['status', '--porcelain'], w.path)
    if (!force && status.stdout.trim()) throw new Error('This workspace has uncommitted changes.')
    const root = (await loadSpaces()).find((s) => s.slug === w.repo)?.root ?? w.path
    const r = await git(['worktree', 'remove', '--force', w.path], root)
    if (!r.ok) throw new Error(r.stderr.trim())
    await git(['worktree', 'prune'], root)
  }
  await saveWorkspace(w, true)
}

export async function renameWorkspace(w: Workspace, title: string): Promise<void> {
  await saveWorkspace({ ...w, title })
}

export async function dirty(w: Workspace): Promise<boolean> {
  return !!(await git(['status', '--porcelain'], w.path)).stdout.trim()
}

/** Everything the branch changed since it left `base`. */
export async function changes(w: Workspace): Promise<ChangedFile[]> {
  const mb = await mergeBase(w.path, w.base)
  const [n, s, o] = await Promise.all([
    git(['diff', '--numstat', '-z', '--no-renames', mb], w.path),
    git(['diff', '--name-status', '-z', '--no-renames', mb], w.path),
    git(['ls-files', '-z', '--others', '--exclude-standard'], w.path)
  ])
  const untracked = o.stdout.split('\0').filter(Boolean)
  const lines = new Map(await Promise.all(untracked.map(async (p) =>
    [p, countLines(await readFile(join(w.path, p), 'utf8').catch(() => ''))] as const)))
  return parseChanges(n.stdout, s.stdout, o.stdout, (p) => lines.get(p) ?? 0)
}

/** One file against the merge-base as unified-diff hunks; an untracked file diffs against nothing. */
export async function diff(w: Workspace, path: string): Promise<DiffHunk[]> {
  const mb = await mergeBase(w.path, w.base)
  const tracked = await git(['diff', '--no-color', '--no-ext-diff', '--no-renames', '-U3', mb, '--', path], w.path)
  if (tracked.stdout.trim()) return parseUnified(tracked.stdout)
  const untracked = await git(['diff', '--no-color', '--no-ext-diff', '--no-index', '-U3', '--', '/dev/null', path], w.path)
  return parseUnified(untracked.stdout)
}

/** A file back as it was at the merge-base, deleted if it didn't exist there. */
export async function revert(w: Workspace, path: string): Promise<void> {
  const full = resolve(w.path, path)
  if (!full.startsWith(w.path + '/')) throw new Error(`${path} isn't in this workspace.`) // it may delete
  const mb = await mergeBase(w.path, w.base)
  if ((await git(['cat-file', '-e', `${mb}:${path}`], w.path)).ok) {
    await git(['checkout', mb, '--', path], w.path)
  } else {
    await git(['rm', '--cached', '--quiet', '--ignore-unmatch', '--', path], w.path)
    await rm(full, { force: true, recursive: true })
  }
}

/** Pushes the branch and opens a PR (or a draft) with gh; without gh, the compare page. */
export async function createPR(w: Workspace, draft: boolean): Promise<string> {
  const remote = await git(['remote', 'get-url', 'origin'], w.path)
  if (!remote.ok) throw new Error('This repo has no “origin” remote to push to.')
  const push = await git(['push', '-u', 'origin', w.branch], w.path)
  if (!push.ok) throw new Error('Push failed: ' + push.stderr.trim())
  const target = w.base.startsWith('origin/') ? w.base.slice(7) : w.base
  const gh = await sh(['gh', 'pr', 'create', '--fill', '--head', w.branch, '--base', target, ...(draft ? ['--draft'] : [])], w.path)
  if (gh.code === 127) { // env: gh not found
    const url = compareURL(remote.stdout, target, w.branch)
    if (!url) throw new Error(`Pushed ${w.branch}, but origin isn't a GitHub remote Bridle can open a PR page for.`)
    return url
  }
  // A new PR prints its URL; an existing one is named in the error, which is fine too.
  const m = /https:\/\/\S+\/pull\/\d+/.exec(gh.stdout + '\n' + gh.stderr)
  if (m) return m[0]
  throw new Error("gh couldn't create the pull request: " + (gh.stderr.trim() || gh.stdout.trim()))
}

/** The open pull request for the branch, via gh; null without one (or without gh). */
export async function pullRequest(w: Workspace): Promise<string | null> {
  const r = await sh(['gh', 'pr', 'view', w.branch, '--json', 'url,state', '-q', 'select(.state == "OPEN").url'], w.path)
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null
}

// MARK: File tree

const HIDDEN = new Set(['.git', '.DS_Store'])
const PACKAGE = /\.(app|bundle|framework|xcodeproj|xcworkspace|playground|xcassets)$/i

/** A folder's entries: folders first, then files, each in Finder's order. Packages count as files. */
export async function listDir(path: string): Promise<DirEntry[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  return entries.filter((e) => !HIDDEN.has(e.name))
    .map((e) => {
      const full = join(path, e.name)
      let folder = e.isDirectory()
      if (e.isSymbolicLink()) folder = (() => { try { return statSync(full).isDirectory() } catch { return false } })()
      return { path: full, name: e.name, folder: folder && !PACKAGE.test(e.name) }
    })
    .sort((a, b) => (a.folder !== b.folder ? (a.folder ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })))
}

// MARK: Clone

/** Repos in a GitHub tool's data, wherever its list sits (`details`, `repositories`, or the root). */
export function parseRepos(data: unknown): GitHubRepo[] {
  const list = (v: unknown): Record<string, unknown>[] | null => {
    if (Array.isArray(v)) return v.length && v[0] && typeof v[0] === 'object' && 'full_name' in v[0] ? v : null
    if (v && typeof v === 'object') for (const x of Object.values(v)) { const found = list(x); if (found) return found }
    return null
  }
  return (list(data) ?? []).flatMap((r) => {
    const full = r.full_name
    if (typeof full !== 'string') return []
    const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : null)
    return [{
      fullName: full, name: str('name') ?? full, summary: str('description'), isPrivate: r.private === true,
      cloneURL: str('clone_url') ?? `https://github.com/${full}.git`, sshURL: str('ssh_url') ?? `git@github.com:${full}.git`,
      pushed: str('pushed_at')
    }]
  })
}

/** Clones into `parent/<name>` (or a clone of the same repo already there). gh first (it has your
 *  GitHub sign-in), then git over https, then ssh. Nothing can prompt. */
export async function cloneRepo(repo: GitHubRepo, parentPath: string): Promise<string> {
  const parent = resolve(parentPath.replace(/^~(?=$|\/)/, homedir()))
  await mkdir(parent, { recursive: true })
  let dest = join(parent, repo.name)
  for (let n = 2; existsSync(dest); n++) {
    const origin = await git(['remote', 'get-url', 'origin'], dest)
    if (origin.ok && origin.stdout.includes(repo.fullName)) return dest // already cloned here
    dest = join(parent, `${repo.name}-${n}`)
  }
  const quiet = { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }
  const gh = await sh(['gh', 'repo', 'clone', repo.fullName, dest], parent, quiet)
  if (gh.ok) return dest
  let last = gh.code === 127 ? '' : gh.stderr
  for (const url of [repo.cloneURL, repo.sshURL]) {
    const r = await git(['clone', url, dest], parent, quiet)
    if (r.ok) return dest
    last = r.stderr
    await rm(dest, { recursive: true, force: true }) // a half-made clone
  }
  throw new Error(`Couldn't clone ${repo.fullName}. `
    + (repo.isPrivate ? "It's private: sign in with `gh auth login` or set up a GitHub SSH key, then try again. " : '') + last.trim())
}
