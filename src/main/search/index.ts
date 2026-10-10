import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { Database } from 'node-sqlite3-wasm'
import type { SearchHit } from '../../shared/types'
import { run } from '../services/util'
import { walksInto } from '../services/workspace'
import { nativeExtracts, nativeText } from '../native'

// ProjectIndex: passages of files, FTS5 for exact words plus (optionally) an embedding for
// meaning on prose, merged by reciprocal rank fusion. Each tag (a project slug, or "~workspace" for ⌘K)
// keeps its own passages; refresh only re-reads files whose mtime changed.
//
// Storage: <workspace>/.bridle/index-electron.sqlite, NOT an older index.sqlite beside it, which may be
// open in WAL mode, and the endpoint embedders would put other vector spaces in its table. Same schema
// otherwise (files + fts5 chunks), plus a meta row naming the embedder.
//
// SQLite is node-sqlite3-wasm: SQLite compiled to wasm with FTS5, persisting through Node's fs, so there's
// no native module to rebuild for Electron and tests run on plain Node.
// ponytail: synchronous wasm calls on the main thread, yielding between files; a worker if indexing ever
// stutters the UI. Brute-force cosine over a tag's vectors.

export const WORKSPACE_TAG = '~workspace'

export const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', 'DerivedData', 'Pods', 'venv', '__pycache__', 'target',
  'vendor', 'coverage', 'chats'])
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Package.resolved', 'Cargo.lock', 'Podfile.lock', 'poetry.lock'])
/** Only prose (and chats) gets an embedding; code is found better by its exact names. */
const PROSE = new Set(['md', 'markdown', 'txt', 'pdf', 'docx', 'doc', 'rtf', 'rtfd', 'odt'])
const MAX_FILES = 5000 // per source folder

// MARK: Pure logic

/** About 1,500 characters per passage on line boundaries, overlapping by about 300, each with its first line. */
export function chunks(text: string): { line: number; text: string }[] {
  const lines = text.split('\n')
  const out: { line: number; text: string }[] = []
  let start = 0
  while (start < lines.length) {
    let end = start
    let size = 0
    while (end < lines.length && (size < 1500 || end === start)) {
      size += lines[end].length + 1
      end++
    }
    const chunk = lines.slice(start, end).join('\n')
    if (chunk.trim()) out.push({ line: start + 1, text: chunk.slice(0, 4000) })
    if (end === lines.length) break
    let back = end
    let overlap = 0
    while (back > start + 1 && overlap < 300) {
      back--
      overlap += lines[back].length + 1
    }
    start = back
  }
  return out
}

/** The FTS5 MATCH for a query: its words longer than two characters, each quoted, OR'd; null when none.
 *  Words are runs of letters and digits only, so nothing in them can break the quoting. */
export function ftsQuery(text: string): string | null {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => [...w].length > 2)
  return words.length ? words.map((w) => `"${w}"`).join(' OR ') : null
}

/** Reciprocal rank fusion: each list adds weight / (60 + rank) to its ids; best first, ties in first-seen order. */
export function fuse(lists: { ids: number[]; weight: number }[], limit: number): number[] {
  const score = new Map<number, number>()
  for (const { ids, weight } of lists) ids.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + weight / (60 + rank)))
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id)
}

/** A saved chat: chats/<id>.jsonl, at the top level or in a goal. */
export const isChat = (path: string): boolean => extname(path) === '.jsonl' && basename(dirname(path)) === 'chats'

/** A chat as readable lines ("You: …", "Agent: …"), so search matches what was said, not its JSON. */
export function chatText(jsonl: string): string {
  const out: string[] = []
  for (const line of jsonl.split('\n')) {
    let turn: Record<string, unknown>
    try {
      turn = JSON.parse(line)
    } catch {
      continue
    }
    if (!turn || typeof turn !== 'object') continue
    if (typeof turn.title === 'string') out.push(`# ${turn.title}`)
    else if (typeof turn.content === 'string' && turn.content) out.push((turn.role === 'user' ? 'You: ' : 'Agent: ') + turn.content)
  }
  return out.join('\n')
}

// MARK: Files → text

/** Files under `root` with their mtimes (seconds), skipping hidden, build and dependency folders and packages. */
export async function files(root: string, skip: Set<string>): Promise<{ path: string; mtime: number }[]> {
  const out: { path: string; mtime: number }[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (out.length >= MAX_FILES) return
      if (e.name.startsWith('.')) continue
      const path = join(dir, e.name)
      if (e.isDirectory()) {
        if (!skip.has(e.name) && walksInto(e.name)) await walk(path)
      } else if (e.isFile() && !SKIP_FILES.has(e.name) && !e.name.endsWith('.min.js')) {
        const s = await stat(path).catch(() => null)
        if (s) out.push({ path, mtime: s.mtimeMs / 1000 })
      }
    }
  }
  await walk(root)
  return out
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

/** PDFKit through JXA: the path goes in argv, never into the script. */
const PDF_TEXT = `function run(argv) {
  ObjC.import('PDFKit')
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]))
  return doc.isNil() ? '' : ObjC.unwrap(doc.string)
}`

/** Plain text from PDFs, Word/RTF documents and any text or code file; images and recordings through the native
 *  helper (it throws while the helper isn't built); null for the rest. */
export async function textOf(path: string): Promise<string | null> {
  if (isChat(path)) return readFile(path, 'utf8').then(chatText, () => null)
  if (nativeExtracts(path)) return nativeText(path)
  const ext = extname(path).slice(1).toLowerCase()
  if (ext === 'pdf' && process.platform === 'darwin') { // PDFKit through JXA; elsewhere PDFs aren't indexed yet
    const r = await run('osascript', ['-l', 'JavaScript', '-e', PDF_TEXT, path]).catch(() => null)
    return r?.code === 0 ? r.stdout : null
  }
  if (['docx', 'doc', 'rtf', 'odt'].includes(ext) && process.platform === 'darwin') {
    const r = await run('textutil', ['-convert', 'txt', '-stdout', path]).catch(() => null)
    return r?.code === 0 ? r.stdout : null
  }
  try {
    if ((await stat(path)).size > 512_000) return null
    const data = await readFile(path)
    if (data.subarray(0, 8000).includes(0)) return null
    return utf8.decode(data)
  } catch {
    return null
  }
}

// MARK: Embeddings

/** Turns passages into unit vectors; a failed call rejects. */
export interface Embedder {
  /** Names the vector space: a change of embedder re-indexes everything. */
  id: string
  embed(texts: string[]): Promise<Float32Array[]>
}

const unit = (v: number[]): Float32Array | null => {
  const norm = Math.hypot(...v)
  return norm > 0 ? Float32Array.from(v, (x) => x / norm) : null
}

/** An OpenAI-compatible /embeddings endpoint (Ollama, LM Studio, OpenAI). */
export function endpointEmbedder(base: string, model: string, key: string | null): Embedder {
  const url = `${base.replace(/\/$/, '')}/embeddings`
  return {
    id: `${url}|${model}`,
    async embed(texts) {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (key) headers.authorization = `Bearer ${key}`
      const res = await fetch(url, {
        method: 'POST', headers, signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ model, input: texts.map((t) => t.slice(0, 2000)) })
      })
      if (!res.ok) throw new Error(`embeddings: ${res.status}`)
      const json = (await res.json()) as { data?: { embedding: number[]; index?: number }[] }
      const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      if (data.length !== texts.length) throw new Error('embeddings: wrong count')
      return data.map((d) => unit(d.embedding) ?? new Float32Array(d.embedding.length))
    }
  }
}

const dot = (a: Float32Array, b: Float32Array): number => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

const toBlob = (v: Float32Array): Uint8Array => new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
const fromBlob = (b: Uint8Array): Float32Array => new Float32Array(b.slice().buffer)

// MARK: The index

const yieldNow = (): Promise<void> => new Promise((r) => setImmediate(r))

export class ProjectIndex {
  private db: Database

  constructor(file: string, private embedder: Embedder | null = null) {
    this.db = new Database(file)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS files(tag TEXT, path TEXT, mtime REAL, PRIMARY KEY(tag, path));
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(text, tag UNINDEXED, path UNINDEXED, line UNINDEXED, vec UNINDEXED);`)
    this.useEmbedder(embedder)
  }

  /** Switches the embedder; a different vector space drops every passage so the next refresh rebuilds them. */
  useEmbedder(embedder: Embedder | null): void {
    this.embedder = embedder
    const id = embedder?.id ?? 'none'
    const row = this.db.get('SELECT value FROM meta WHERE key = ?', ['embedder'])
    if (row?.value === id) return
    this.db.exec('DELETE FROM files; DELETE FROM chunks;')
    this.db.run('INSERT OR REPLACE INTO meta VALUES (?, ?)', ['embedder', id])
  }

  /** Brings a tag's passages up to date: new and changed files are read again, gone ones dropped.
   *  A file whose embeddings (or native extraction) failed keeps mtime 0, so it's tried again next time. */
  async refresh(tag: string, roots: string[], skip: Set<string> = SKIP_DIRS): Promise<void> {
    const known = new Map<string, number>()
    for (const r of this.db.all('SELECT path, mtime FROM files WHERE tag = ?', [tag])) known.set(String(r.path), Number(r.mtime))
    const seen = new Set<string>()
    let embedder = this.embedder
    this.db.exec('BEGIN')
    try {
      for (const root of roots) {
        for (const { path, mtime } of await files(root, skip)) {
          if (seen.has(path)) continue
          seen.add(path)
          if (known.get(path) === mtime) continue
          let stored = mtime
          const passages = chunks((await textOf(path).catch(() => ((stored = 0), null))) ?? '')
          let vecs: (Float32Array | null)[] = passages.map(() => null)
          if (embedder && passages.length && (PROSE.has(extname(path).slice(1).toLowerCase()) || isChat(path))) {
            try {
              vecs = []
              for (let i = 0; i < passages.length; i += 32) vecs.push(...(await embedder.embed(passages.slice(i, i + 32).map((p) => p.text))))
            } catch {
              vecs = passages.map(() => null)
              embedder = null // the endpoint is down: words only for the rest of this pass
              stored = 0
            }
          }
          this.db.run('DELETE FROM chunks WHERE tag = ? AND path = ?', [tag, path])
          passages.forEach((p, i) => {
            const v = vecs[i]
            this.db.run('INSERT INTO chunks(text, tag, path, line, vec) VALUES (?, ?, ?, ?, ?)', [p.text, tag, path, p.line, v ? toBlob(v) : null])
          })
          this.db.run('INSERT OR REPLACE INTO files VALUES (?, ?, ?)', [tag, path, stored])
          await yieldNow()
        }
      }
      for (const path of known.keys()) {
        if (seen.has(path)) continue
        this.db.run('DELETE FROM chunks WHERE tag = ? AND path = ?', [tag, path])
        this.db.run('DELETE FROM files WHERE tag = ? AND path = ?', [tag, path])
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  /** Indexed files and passages, for a project page. */
  counts(tag: string): { files: number; passages: number } {
    const n = (sql: string) => Number(this.db.get(sql, [tag])?.n ?? 0)
    return { files: n('SELECT count(*) AS n FROM files WHERE tag = ?'), passages: n('SELECT count(*) AS n FROM chunks WHERE tag = ?') }
  }

  /** Word matches and meaning matches, merged by RRF. Meaning counts half, so it never outranks the exact name you typed. */
  async search(tag: string, text: string, limit = 6): Promise<SearchHit[]> {
    const lists: { ids: number[]; weight: number }[] = []
    const match = ftsQuery(text)
    if (match) {
      const rows = this.db.all('SELECT rowid AS id FROM chunks WHERE chunks MATCH ? AND tag = ? ORDER BY rank LIMIT 30', [match, tag])
      lists.push({ ids: rows.map((r) => Number(r.id)), weight: 1 })
    }
    if (this.embedder && text.trim()) {
      const q = await this.embedder.embed([text]).then((v) => v[0], () => null)
      if (q) {
        const scored: [number, number][] = []
        for (const r of this.db.all('SELECT rowid AS id, vec FROM chunks WHERE tag = ? AND vec IS NOT NULL', [tag])) {
          const v = fromBlob(r.vec as Uint8Array)
          if (v.length === q.length) scored.push([Number(r.id), dot(q, v)])
        }
        lists.push({ ids: scored.sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id]) => id), weight: 0.5 })
      }
    }
    return fuse(lists, limit).flatMap((id) => {
      const r = this.db.get('SELECT path, line, text FROM chunks WHERE rowid = ?', [id])
      return r ? [{ path: String(r.path), line: Number(r.line), text: String(r.text) }] : []
    })
  }

  close(): void {
    if (this.db.isOpen) this.db.close()
  }
}
