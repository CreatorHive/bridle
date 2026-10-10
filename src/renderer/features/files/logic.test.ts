import { describe, expect, it } from 'vitest'
import type { FileKind, WorkspaceFile } from '../../../shared/types'
import { byteCount, canTrash, excerpt, fileKind, folder, kindCount, previewKind, related, shownFiles, when } from './logic'

const file = (path: string, o: Partial<WorkspaceFile> = {}): WorkspaceFile => {
  const name = path.split('/').pop()!
  return {
    path, name, kind: fileKind(name), size: 100, system: false,
    modified: '2026-10-01T00:00:00Z', opened: '2026-10-01T00:00:00Z', ...o
  }
}

describe('files logic', () => {
  it('classifies kinds by extension, case-insensitively', () => {
    const cases: [string, FileKind][] = [
      ['Plan.DOCX', 'documents'], ['notes.md', 'documents'], ['q3.csv', 'spreadsheets'], ['deck.key', 'presentations'],
      ['photo.HEIC', 'images'], ['logo.svg', 'images'], ['scan.pdf', 'pdfs'], ['archive.zip', 'other'],
      ['Makefile', 'other'], ['.env', 'other']
    ]
    for (const [name, kind] of cases) expect(fileKind(name), name).toBe(kind)
  })

  it('picks a preview: decodable images, text, or the icon', () => {
    expect(previewKind('a.png')).toBe('image')
    expect(previewKind('a.heic')).toBe('none') // Chromium can't decode it
    expect(previewKind('a.md')).toBe('text')
    expect(previewKind('Makefile')).toBe('text')
    expect(previewKind('a.docx')).toBe('none')
    expect(excerpt('a\nb\nc', 2)).toBe('a\nb')
    expect(excerpt('PK\u0003\u0004\u0000')).toBeNull()
  })

  it("shows yours or Bridle's, by kind and search, sorted", () => {
    const files = [
      file('/w/user/files/b 10.md', { opened: '2026-10-03T00:00:00Z', size: 5 }),
      file('/w/user/files/b 9.md', { opened: '2026-10-02T00:00:00Z', size: 50 }),
      file('/w/user/files/pic.png', { opened: '2026-10-04T00:00:00Z' }),
      file('/w/SOUL.md', { system: true })
    ]
    const o = { kind: null, system: false, query: '', sort: 'Last opened' as const }
    expect(shownFiles(files, o).map((f) => f.name)).toEqual(['pic.png', 'b 10.md', 'b 9.md'])
    expect(shownFiles(files, { ...o, sort: 'Name' }).map((f) => f.name)).toEqual(['b 9.md', 'b 10.md', 'pic.png'])
    expect(shownFiles(files, { ...o, sort: 'Size' })[0].name).toBe('pic.png')
    expect(shownFiles(files, { ...o, kind: 'documents', query: 'B 1' }).map((f) => f.name)).toEqual(['b 10.md'])
    expect(shownFiles(files, { ...o, system: true }).map((f) => f.name)).toEqual(['SOUL.md'])
    expect(kindCount(files, 'documents')).toBe(2) // SOUL.md is Bridle's
  })

  it("never offers Move to Trash for Bridle's files", () => {
    expect(canTrash(file('/w/a.md'))).toBe(true)
    expect(canTrash(file('/w/SOUL.md', { system: true }))).toBe(false)
  })

  it('relates same folder first, then same kind, three at most', () => {
    const f = file('/w/a/x.md')
    const files = [f, file('/w/b/y.md', { opened: '2026-10-05T00:00:00Z' }), file('/w/a/z.png'), file('/w/a/q.csv'),
      file('/w/c/k.png')]
    expect(related(files, f).map((r) => r.name)).toEqual(['z.png', 'q.csv', 'y.md'])
  })

  it('formats folders, dates and sizes', () => {
    expect(folder('/Users/me/Bridle/user/files/a.pdf')).toBe('~/Bridle/user/files')
    const now = new Date(2026, 9, 9, 15, 0)
    expect(when(new Date(2026, 9, 9, 11, 24).toISOString(), now)).toBe('Today, 11:24 AM')
    expect(when(new Date(2026, 9, 8, 16, 18).toISOString(), now)).toBe('Yesterday, 4:18 PM')
    expect(when(new Date(2026, 9, 6, 9, 0).toISOString(), now)).toBe('Oct 6, 2026')
    expect([0, 512, 1500, 12_345, 1_500_000, 2_340_000_000].map(byteCount)).toEqual(['Zero KB', '512 bytes', '2 KB', '12 KB', '1.5 MB', '2.34 GB'])
  })
})
