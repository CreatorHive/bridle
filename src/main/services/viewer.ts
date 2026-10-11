import { open, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { app } from 'electron'
import type { BridleAPI } from '../../shared/api'
import type { ViewerKind } from '../../shared/types'
import { walksInto } from './workspace'

// The viewer's file access. Chromium shows images and (in an iframe) PDFs itself, and the rest gets its
// Finder icon and "Open in default app".

const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const utf8 = new TextDecoder('utf-8', { fatal: true })

/** A Finder package (an .app, a .key…): shown as a file, not walked into. */
const isPackage = (name: string): boolean => extname(name) !== '' && !walksInto(name)

/** True when the first bytes read as UTF-8 text (UTType.conforms(to: .text), roughly). */
export function looksLikeText(head: Uint8Array): boolean {
  if (head.includes(0)) return false
  try {
    utf8.decode(head, { stream: true }) // a character cut off at the end is fine
    return true
  } catch {
    return false
  }
}

/** How the viewer shows a file: folders list, markdown renders, images and PDFs preview, other text is monospace. */
export function viewerKind(name: string, folder: boolean, head: Uint8Array): ViewerKind {
  if (folder && !isPackage(name)) return 'folder'
  const ext = extname(name).slice(1).toLowerCase()
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (IMAGES.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return !folder && looksLikeText(head) ? 'text' : 'other'
}

async function head(path: string): Promise<Uint8Array> {
  const f = await open(path, 'r')
  try {
    const buf = new Uint8Array(8000)
    const { bytesRead } = await f.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await f.close()
  }
}

export const viewer: BridleAPI['viewer'] = {
  async inspect(path) {
    const s = await stat(path)
    const folder = s.isDirectory()
    const name = basename(path)
    return { path, name, size: s.size, kind: viewerKind(name, folder, folder ? new Uint8Array() : await head(path)) }
  },

  async list(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    const listed = await Promise.all(entries.filter((e) => !e.name.startsWith('.')).map(async (e) => {
      const path = join(dir, e.name)
      const s = await stat(path).catch(() => null)
      return { path, name: e.name, folder: e.isDirectory() && !isPackage(e.name), size: s?.isFile() ? s.size : 0, modified: s ? s.mtime.toISOString() : '' }
    }))
    return listed.sort((a, b) => (a.folder !== b.folder ? (a.folder ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })))
  },

  async save(path, text) {
    const tmp = `${path}.${process.pid}.tmp`
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, path) // atomically
  },

  async icon(path) {
    return (await app.getFileIcon(path, { size: 'normal' })).toDataURL()
  }
}
