import type { FileKind, WorkspaceFile } from '../../../shared/types'

// Pure helpers for the Files screen.

export const KINDS: FileKind[] = ['documents', 'spreadsheets', 'presentations', 'images', 'pdfs', 'other']

export const KIND_INFO: Record<FileKind, { title: string; tint: string; extensions: string[] }> = {
  documents: { title: 'Documents', tint: '#2F6FED', extensions: ['doc', 'docx', 'pages', 'rtf', 'rtfd', 'txt', 'md', 'markdown', 'odt'] },
  spreadsheets: { title: 'Spreadsheets', tint: '#1E9E5A', extensions: ['xls', 'xlsx', 'csv', 'tsv', 'numbers', 'ods'] },
  presentations: { title: 'Presentations', tint: '#E8590C', extensions: ['ppt', 'pptx', 'key', 'odp'] },
  images: { title: 'Images', tint: '#E64980', extensions: ['png', 'jpg', 'jpeg', 'heic', 'gif', 'webp', 'tiff', 'bmp', 'svg'] },
  pdfs: { title: 'PDFs', tint: '#E03131', extensions: ['pdf'] },
  other: { title: 'Other', tint: '#7F8286', extensions: [] }
}

export const ext = (name: string): string => {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** FileKind(url): by extension, else Other. */
export const fileKind = (name: string): FileKind =>
  KINDS.find((k) => KIND_INFO[k].extensions.includes(ext(name))) ?? 'other'

/** What the inspector can show without Quick Look: an image Chromium decodes, the first lines of text, or just the icon. */
const IMAGE_PREVIEW = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
const TEXT_PREVIEW = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'js', 'ts', 'tsx', 'jsx', 'mjs', 'swift', 'py', 'rb',
  'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'm', 'css', 'html', 'xml', 'yml', 'yaml', 'toml', 'ini', 'sh', 'zsh', 'log', 'sql', 'env']
export function previewKind(name: string): 'image' | 'text' | 'none' {
  const e = ext(name)
  if (IMAGE_PREVIEW.includes(e)) return 'image'
  return TEXT_PREVIEW.includes(e) || e === '' ? 'text' : 'none'
}
/** What Quick Look thumbnails through the native helper (window.bridle.native.thumbnail): pages, slides, sheets,
 *  HEIC/TIFF and movies. */
const THUMBNAIL = ['pdf', 'doc', 'docx', 'pages', 'rtf', 'xls', 'xlsx', 'numbers', 'ppt', 'pptx', 'key', 'heic', 'heif', 'tiff', 'tif',
  'mov', 'mp4', 'm4v']
export const thumbnailable = (name: string): boolean => THUMBNAIL.includes(ext(name))
export const MIME: Record<string, string> = { svg: 'image/svg+xml', jpg: 'image/jpeg' }
export const imageMime = (name: string): string => MIME[ext(name)] ?? `image/${ext(name)}`

/** The first `lines` lines of a text file, or null for binary content. */
export function excerpt(text: string, lines = 40): string | null {
  if (text.slice(0, 4096).includes('\u0000')) return null
  return text.split('\n').slice(0, lines).join('\n')
}

export type Sort = 'Last opened' | 'Last modified' | 'Name' | 'Size'
export const SORTS: Sort[] = ['Last opened', 'Last modified', 'Name', 'Size']

const compare: Record<Sort, (a: WorkspaceFile, b: WorkspaceFile) => number> = {
  'Last opened': (a, b) => b.opened.localeCompare(a.opened),
  'Last modified': (a, b) => b.modified.localeCompare(a.modified),
  Name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  Size: (a, b) => b.size - a.size
}

/** FilesScreen.shown: yours or Bridle's (the Bridle chip), one kind or all, matching the search. */
export function shownFiles(files: WorkspaceFile[], o: { kind: FileKind | null; system: boolean; query: string; sort: Sort }): WorkspaceFile[] {
  const q = o.query.toLowerCase()
  return files
    .filter((f) => f.system === o.system && (o.kind === null || f.kind === o.kind) && (!q || f.name.toLowerCase().includes(q)))
    .sort(compare[o.sort])
}

/** Tile counts: your files only. */
export const kindCount = (files: WorkspaceFile[], kind: FileKind): number => files.filter((f) => f.kind === kind && !f.system).length

/** Bridle's own files shape how it behaves: no Move to Trash for them (delete those in Finder if you must). */
export const canTrash = (f: WorkspaceFile): boolean => !f.system

const dir = (path: string) => path.slice(0, path.lastIndexOf('/'))

/** Same folder first, then the same kind; most recent first; three at most. */
export function related(files: WorkspaceFile[], f: WorkspaceFile): WorkspaceFile[] {
  const others = files.filter((o) => o.path !== f.path).sort(compare['Last opened'])
  const near = others.filter((o) => dir(o.path) === dir(f.path))
  const alike = others.filter((o) => o.kind === f.kind && !near.includes(o))
  return [...near, ...alike].slice(0, 3)
}

/** "~/Bridle/user/files", the folder it sits in. ponytail: assumes macOS /Users/<name> homes. */
export const folder = (path: string): string => dir(path).replace(/^\/Users\/[^/]+/, '~')

/** WorkspaceFiles.when: "Today, 11:24 AM", "Yesterday, 4:18 PM", "Oct 6, 2026". */
export function when(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86400_000)
  if (diff === 0) return `Today, ${time}`
  if (diff === 1) return `Yesterday, ${time}`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const lowercasedFirst = (s: string): string => s.slice(0, 1).toLowerCase() + s.slice(1)

/** ByteCountFormatter, .file style (decimal): "Zero KB", "512 bytes", "12 KB", "1.5 MB". */
export function byteCount(n: number): string {
  if (n === 0) return 'Zero KB'
  if (n < 1000) return `${n} bytes`
  const units: [string, number][] = [['KB', 0], ['MB', 1], ['GB', 2], ['TB', 2]]
  let v = n / 1000
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${Number(v.toFixed(units[i][1]))} ${units[i][0]}`
}
