import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Memory import and viewer routing, on temp dirs only.
vi.mock('electron', () => ({ app: {}, shell: {}, dialog: {}, nativeImage: {}, BrowserWindow: { getAllWindows: () => [] } }))

const { applyMemory, memoryPrompt, memorySections } = await import('./memory')
const { looksLikeText, viewer, viewerKind } = await import('./viewer')

const temps: string[] = []
const temp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'bridle-mem-'))
  temps.push(d)
  return d
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('memory import', () => {
  it('splits an answer into its files, dropping fences, case-insensitively', () => {
    const answer = '```\n=== USER.md ===\n- Name: Sean\n  - indented\n\n=== memory.md ===\n- Ships Bridle\n```\n'
    expect(memorySections(answer)).toEqual({ 'USER.md': '- Name: Sean\n  - indented', 'MEMORY.md': '- Ships Bridle' })
  })

  it('puts an unmarked answer in MEMORY.md, and drops empty sections', () => {
    expect(memorySections('- likes tea\n- lives in Boston\n')).toEqual({ 'MEMORY.md': '- likes tea\n- lives in Boston' })
    expect(memorySections('=== USER.md ===\n\n=== MEMORY.md ===\n- x')).toEqual({ 'MEMORY.md': '- x' })
    expect(memorySections('  \n```\n```')).toEqual({})
  })

  it('appends under a dated heading, creating missing files with a title', async () => {
    const root = temp()
    writeFileSync(join(root, 'USER.md'), '# User\n\n- Name: Sean\n\n')
    const added = await applyMemory(root, '=== USER.md ===\n- Works on Bridle\n=== MEMORY.md ===\n- Launch is Friday', 'Claude Code',
      new Date('2026-10-09T12:00:00Z'))
    expect(added).toEqual(['USER.md', 'MEMORY.md'])
    expect(readFileSync(join(root, 'USER.md'), 'utf8')).toBe('# User\n\n- Name: Sean\n\n## Imported from Claude Code · 2026-10-09\n\n- Works on Bridle\n')
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toBe('# Memory\n\n## Imported from Claude Code · 2026-10-09\n\n- Launch is Friday\n')
    expect(await applyMemory(root, '   ', 'ChatGPT')).toEqual([])
  })

  it('asks each source for the same format', () => {
    for (const source of ['ChatGPT', 'Claude Code'] as const) {
      expect(memoryPrompt(source)).toContain('=== USER.md ===')
      expect(memoryPrompt(source)).toContain('=== MEMORY.md ===')
    }
    expect(memoryPrompt('Claude Code')).toContain('~/.claude/projects/*/memory/')
  })
})

describe('viewer routing', () => {
  const text = new TextEncoder().encode('hello')
  it('routes by kind', () => {
    expect(viewerKind('notes', true, new Uint8Array())).toBe('folder')
    expect(viewerKind('Bridle.app', true, new Uint8Array())).toBe('other') // a package isn't browsed
    expect(viewerKind('README.md', false, text)).toBe('markdown')
    expect(viewerKind('a.MARKDOWN', false, text)).toBe('markdown')
    expect(viewerKind('photo.JPG', false, new Uint8Array([0xff, 0xd8, 0]))).toBe('image')
    expect(viewerKind('logo.svg', false, text)).toBe('image')
    expect(viewerKind('paper.pdf', false, new Uint8Array([0x25, 0]))).toBe('pdf')
    expect(viewerKind('main.swift', false, text)).toBe('text')
    expect(viewerKind('Makefile', false, text)).toBe('text')
    expect(viewerKind('empty.txt', false, new Uint8Array())).toBe('text')
    expect(viewerKind('report.docx', false, new Uint8Array([0x50, 0x4b, 3, 4, 0]))).toBe('other')
    expect(viewerKind('photo.heic', false, new Uint8Array([0, 0, 0, 0x18]))).toBe('other')
  })

  it('sniffs text: no NUL, valid UTF-8, a cut-off character at the end is fine', () => {
    expect(looksLikeText(new TextEncoder().encode('café ✓'))).toBe(true)
    expect(looksLikeText(new TextEncoder().encode('✓').subarray(0, 2))).toBe(true)
    expect(looksLikeText(new Uint8Array([0xc3, 0x28]))).toBe(false)
    expect(looksLikeText(new Uint8Array([0x41, 0]))).toBe(false)
  })

  it('inspects, lists folders first, and saves', async () => {
    const root = temp()
    mkdirSync(join(root, 'b-folder'))
    writeFileSync(join(root, 'file 10.md'), '# Ten')
    writeFileSync(join(root, 'file 2.md'), '# Two')
    writeFileSync(join(root, '.DS_Store'), '')
    expect((await viewer.list(root)).map((e) => [e.name, e.folder])).toEqual([['b-folder', true], ['file 2.md', false], ['file 10.md', false]])
    expect(await viewer.inspect(join(root, 'file 2.md'))).toMatchObject({ kind: 'markdown', name: 'file 2.md', size: 5 })
    expect((await viewer.inspect(join(root, 'b-folder'))).kind).toBe('folder')
    await viewer.save(join(root, 'file 2.md'), '# Deux')
    expect(readFileSync(join(root, 'file 2.md'), 'utf8')).toBe('# Deux')
    await expect(viewer.inspect(join(root, 'missing'))).rejects.toThrow()
  })
})
