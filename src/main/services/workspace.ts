import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dialog, shell } from 'electron'
import type { BridleAPI } from '../../shared/api'
import type { Chat, FileKind, Message, WorkspaceFile } from '../../shared/types'
import { settings } from './settings'
import { iso, sortKeys } from './util'

// The workspace: chats, files and uploads. Chats are JSONL files in a fixed on-disk format:
// sorted keys, unescaped slashes, ISO-8601 dates without fractions, UPPERCASE UUIDs.

/** `defaults read Bridle workspace` (default ~/Bridle), tilde expanded, created if missing. */
export async function workspaceRoot(): Promise<string> {
  const setting = (await settings.get('workspace')) || '~/Bridle'
  const path = setting.replace(/^~(?=$|\/)/, homedir())
  mkdirSync(path, { recursive: true })
  return path
}

/** "Launch Bridle v0.1" → "launch-bridle-v0-1". */
export function slug(name: string): string {
  return name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join('-')
}

// MARK: Chat JSONL

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ids on disk are uppercase UUIDs and nothing else; a non-UUID id gets a stable UUID derived from it. */
export function swiftUUID(id: string): string {
  if (UUID_RE.test(id)) return id.toUpperCase()
  const h = createHash('sha1').update(id).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase()
}

const OPTIONAL_KEYS = ['title', 'icon', 'confirm', 'action', 'approved', 'dismissed', 'source', 'changes', 'plan', 'todos', 'subagents', 'calls'] as const

/** One turn as a JSONL line. Live-only `workers`/`status` are never written. */
export function encodeTurn(m: Message): string {
  const line: Record<string, unknown> = {
    turn_id: swiftUUID(m.id),
    role: m.role,
    content: m.text,
    created_at: iso(m.date),
    files: (m.files ?? []).map((f) => (f.startsWith('file://') ? f : pathToFileURL(f).href)),
    trace: m.trace ?? []
  }
  for (const key of OPTIONAL_KEYS) if (m[key] != null) line[key] = m[key]
  if (m.subagents) {
    line.subagents = m.subagents.map((s) => {
      const out: Record<string, unknown> = { ...s, startedAt: iso(s.startedAt) }
      if (s.endedAt) out.endedAt = iso(s.endedAt)
      for (const k of Object.keys(out)) if (out[k] == null) delete out[k]
      return out
    })
  }
  if (m.ended) line.ended = iso(m.ended)
  return JSON.stringify(sortKeys(line))
}

/** The whole file: header {"id","session_id","title"}, then the finished turns. */
export function encodeChat(chat: Chat): string {
  const header: Record<string, unknown> = { id: swiftUUID(chat.id), title: chat.title }
  if (chat.sessionID) header.session_id = chat.sessionID
  const turns = chat.messages.filter((m) => m.status == null).map(encodeTurn)
  return [JSON.stringify(sortKeys(header)), ...turns].join('\n') + '\n'
}

function decodeTurn(line: string): Message | null {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(line)
  } catch {
    return null
  }
  const date = new Date(String(o.created_at))
  if (typeof o.role !== 'string' || typeof o.content !== 'string' || isNaN(date.getTime())) return null
  const m: Message = {
    id: typeof o.turn_id === 'string' ? o.turn_id : randomUUID().toUpperCase(),
    role: o.role as Message['role'],
    text: o.content,
    date: iso(date),
    files: Array.isArray(o.files) ? o.files.map((f: string) => (f.startsWith('file:') ? fileURLToPath(f) : f)) : [],
    trace: Array.isArray(o.trace) ? (o.trace as string[]) : []
  }
  for (const key of OPTIONAL_KEYS) if (o[key] != null) (m as unknown as Record<string, unknown>)[key] = o[key]
  if (o.ended != null) m.ended = String(o.ended)
  return m
}

/** Parses a chat file; null when the header is unreadable. Undecodable turns are dropped. */
export function decodeChat(text: string): Chat | null {
  const lines = text.split('\n').filter((l) => l.length > 0)
  let header: { id?: unknown; title?: unknown; session_id?: unknown }
  try {
    header = JSON.parse(lines[0] ?? '')
  } catch {
    return null
  }
  if (typeof header.id !== 'string' || typeof header.title !== 'string') return null
  const chat: Chat = { id: header.id, title: header.title, messages: lines.slice(1).map(decodeTurn).filter((m): m is Message => m !== null) }
  if (typeof header.session_id === 'string') chat.sessionID = header.session_id
  return chat
}

/** Every *.jsonl chat in `dir`, newest file first. */
async function readChats(dir: string, project: string | null): Promise<Chat[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.jsonl'))
  const chats = await Promise.all(names.map(async (name) => {
    const file = join(dir, name)
    try {
      const [text, s] = await Promise.all([readFile(file, 'utf8'), stat(file)])
      const chat = decodeChat(text)
      return chat && { ...chat, project, modified: iso(s.mtime), mtime: s.mtimeMs }
    } catch {
      return null
    }
  }))
  return chats
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ mtime: _mtime, ...chat }) => chat)
}

/** Project folders that are real projects: goals/<dir>/GOAL.md exists. */
async function projectDirs(root: string): Promise<string[]> {
  const dirs = await readdir(join(root, 'goals')).catch(() => [] as string[])
  return dirs.filter((d) => existsSync(join(root, 'goals', d, 'GOAL.md')))
}

/** goals/<dir> for a chat's project: the folder itself when it exists, else slug(name). */
export function projectDir(root: string, project: string): string {
  // One folder under goals/, never a path ("../.." would leave the workspace); slug() can't make one.
  const single = basename(project) === project && project !== '.' && project !== '..'
  return single && existsSync(join(root, 'goals', project)) ? project : slug(project)
}

function chatFile(root: string, chat: Chat): string {
  const dir = chat.project ? join(root, 'goals', projectDir(root, chat.project), 'chats') : join(root, 'chats')
  return join(dir, `${swiftUUID(chat.id).toLowerCase()}.jsonl`)
}

// MARK: Files screen

const SYSTEM_DIRS = new Set(['chats', 'agent', 'agents', 'memory', 'dreams', 'prompts', 'routines', 'loops', 'meetings', 'tasks', 'notes', 'spaces', '.bridle'])
const SYSTEM_NAMES = new Set(['GOAL.md', 'BOARD.md', 'SOURCES.md', 'AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'MEMORY.md', 'HEARTBEAT.md', 'BOOT.md'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'worktrees'])
/** Finder packages (`.skipsPackageDescendants`): neither listed nor walked. */
const PACKAGES = new Set(['app', 'bundle', 'framework', 'pages', 'key', 'numbers', 'rtfd', 'photoslibrary', 'xcodeproj', 'xcworkspace'])
const KINDS: [FileKind, string[]][] = [
  ['documents', ['doc', 'docx', 'pages', 'rtf', 'rtfd', 'txt', 'md', 'markdown', 'odt']],
  ['spreadsheets', ['xls', 'xlsx', 'csv', 'tsv', 'numbers', 'ods']],
  ['presentations', ['ppt', 'pptx', 'key', 'odp']],
  ['images', ['png', 'jpg', 'jpeg', 'heic', 'gif', 'webp', 'tiff', 'bmp', 'svg']],
  ['pdfs', ['pdf']]
]

export function fileKind(name: string): FileKind {
  const ext = extname(name).slice(1).toLowerCase()
  return KINDS.find(([, exts]) => exts.includes(ext))?.[0] ?? 'other'
}

/** Bridle's own file: inside a system folder, a persona/project file, or any .jsonl. `rel` is workspace-relative. */
export function isSystem(rel: string): boolean {
  const parts = rel.split(/[\\/]/).filter(Boolean)
  const name = parts[parts.length - 1] ?? ''
  return parts.some((p) => SYSTEM_DIRS.has(p)) || SYSTEM_NAMES.has(name) || extname(name) === '.jsonl'
}

/** Whether the walk descends into a folder. */
export function walksInto(name: string): boolean {
  if (SKIP_DIRS.has(name) || (name.startsWith('.') && name !== '.bridle')) return false
  return !PACKAGES.has(extname(name).slice(1).toLowerCase())
}

/** Every file under `root`, capped at 5,000. ponytail: a full walk per refresh. */
export async function scan(root: string, cap = 5000): Promise<WorkspaceFile[]> {
  const out: WorkspaceFile[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (out.length >= cap) return
      const path = join(dir, e.name)
      if (e.isDirectory()) {
        if (walksInto(e.name)) await walk(path)
        continue
      }
      if (e.name.startsWith('.')) continue // .DS_Store and friends
      const s = await stat(path).catch(() => null)
      if (!s || s.isDirectory()) continue
      out.push({
        path,
        name: e.name,
        kind: fileKind(e.name),
        size: s.size,
        modified: iso(s.mtime),
        opened: iso(Math.max(s.atimeMs, s.mtimeMs)),
        system: isSystem(relative(root, path))
      })
    }
  }
  await walk(root)
  return out
}

/** Where `file` lands in `dir`: its own name, or "name 2.ext", "name 3.ext"… */
export function freeName(dir: string, file: string, exists: (p: string) => boolean = existsSync): string {
  const ext = extname(file)
  const base = basename(file, ext)
  let dest = join(dir, basename(file))
  for (let n = 2; exists(dest); n++) dest = join(dir, `${base} ${n}${ext}`)
  return dest
}

/** `path` resolved, if it's the workspace or inside it; Drive's calls never reach past it. */
export function within(root: string, path: string): string {
  const p = resolve(root, path)
  if (p !== root && !p.startsWith(root + sep)) throw new Error('That folder is outside the workspace')
  return p
}

export const workspace: BridleAPI['workspace'] = {
  path: workspaceRoot,

  async loadChats() {
    const root = await workspaceRoot()
    const recent = await readChats(join(root, 'chats'), null)
    const projects = await Promise.all((await projectDirs(root)).map((d) => readChats(join(root, 'goals', d, 'chats'), d)))
    return [...recent, ...projects.flat()]
  },

  async saveChat(chat) {
    if (chat.messages.length === 0) return
    const root = await workspaceRoot()
    const file = chatFile(root, chat)
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, encodeChat(chat), 'utf8')
    await rename(tmp, file) // atomically
    // Moved between Recent and a project: its old file goes.
    const name = basename(file)
    const others = [join(root, 'chats', name), ...(await projectDirs(root)).map((d) => join(root, 'goals', d, 'chats', name))]
    await Promise.all(others.filter((p) => p !== file && existsSync(p)).map((p) => rm(p)))
  },

  async listFiles() {
    return scan(await workspaceRoot())
  },

  readFile: (path, encoding) => readFile(path, encoding ?? 'utf8'),

  trashFile: (path) => shell.trashItem(path),

  async addFiles(paths, folder = 'user/files') {
    const root = await workspaceRoot()
    const dir = join(root, folder)
    await mkdir(dir, { recursive: true })
    const out: string[] = []
    for (const path of paths) {
      if (path.startsWith(root + sep)) {
        out.push(path)
        continue
      }
      const dest = freeName(dir, path)
      try {
        await copyFile(path, dest)
        out.push(dest)
      } catch {
        out.push(path) // keeps the original when the copy fails
      }
    }
    return out
  },

  async createFolder(parent, name) {
    const clean = name.trim().replace(/[/:]/g, '-')
    if (!clean || clean.startsWith('.')) throw new Error('Give the folder a name')
    const dest = freeName(within(await workspaceRoot(), parent), clean)
    await mkdir(dest)
    return dest
  },

  async pickFiles(options) {
    const props: ('openFile' | 'openDirectory' | 'multiSelections')[] = [options?.directories ? 'openDirectory' : 'openFile']
    if (options?.multiple ?? true) props.push('multiSelections')
    const r = await dialog.showOpenDialog({ buttonLabel: options?.prompt, properties: props })
    return r.canceled ? [] : r.filePaths
  },

  async openPath(path) {
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  },

  revealInFinder: async (path) => shell.showItemInFolder(path)
}
