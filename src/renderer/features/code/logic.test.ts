import { describe, expect, it } from 'vitest'
import type { DiffHunk } from '../../../shared/types'
import { chatChanges, compact, elapsed, glyph, glyphs, hunkHeader, planBlocks, prefixHunks, ruleCommand, splitPath, summary, totals, workingLabel } from './logic'

describe('Code view logic (chat and diffs)', () => {
  it('summarizes activity and picks glyphs', () => {
    expect(summary(1, 0)).toBe('1 tool call')
    expect(summary(9, 2)).toBe('9 tool calls, 2 subagents')
    expect(glyph('bash swift test')).toBe('bash')
    expect(glyph('multiedit a.swift')).toBe('edit')
    expect(glyphs(['read a', 'read b', 'edit a', 'bash x', 'grep y', 'webfetch z', 'agent w'])).toEqual(['read', 'edit', 'bash', 'search', 'web'])
    expect(workingLabel('Reading files', [])).toBe('Reading files')
    expect(workingLabel('x', [{}, {}] as never)).toBe('2 subagents working')
  })

  it('formats elapsed time as seconds, then minutes and seconds', () => {
    expect(elapsed('2026-10-09T14:00:00Z', '2026-10-09T14:00:42Z')).toBe('42s')
    expect(elapsed('2026-10-09T14:00:00Z', '2026-10-09T14:26:58Z')).toBe('26m 58s')
  })

  it('cuts a long diff at a row budget, headers counting as rows', () => {
    const line = (n: number) => ({ kind: 'context' as const, old: n, new: n, text: String(n) })
    const hunks: DiffHunk[] = [
      { oldStart: 1, oldCount: 3, newStart: 1, newCount: 3, lines: [line(1), line(2), line(3)] },
      { oldStart: 10, oldCount: 3, newStart: 10, newCount: 3, lines: [line(10), line(11), line(12)] }
    ]
    expect(prefixHunks(hunks, 6).map((h) => h.lines.length)).toEqual([3, 1])
    expect(prefixHunks(hunks, 4).map((h) => h.lines.length)).toEqual([3])
    expect(hunkHeader(hunks[1])).toBe('@@ -10,3 +10,3 @@')
  })

  it('splits a plan into headings, code and paragraphs (PlanDocument.blocks)', () => {
    expect(planBlocks('# Plan\nFirst line\nsecond\n\n```\ncode\n```\n## Steps\n- a')).toEqual([
      { kind: 'heading', level: 1, text: 'Plan' },
      { kind: 'text', text: 'First line\nsecond' },
      { kind: 'code', text: 'code' },
      { kind: 'heading', level: 2, text: 'Steps' },
      { kind: 'text', text: '- a' }
    ])
  })

  it('sums what a chat changed, per file', () => {
    const m = (changes: { path: string; added: number; removed: number }[]) => ({ id: '', role: 'assistant' as const, text: '', date: '', changes })
    const all = chatChanges([m([{ path: 'a', added: 2, removed: 1 }]), m([{ path: 'a', added: 1, removed: 0 }, { path: 'b', added: 5, removed: 5 }])])
    expect(all).toEqual([{ path: 'a', added: 3, removed: 1 }, { path: 'b', added: 5, removed: 5 }])
    expect(totals(all)).toEqual({ added: 8, removed: 6 })
    expect([compact(311), compact(1900), compact(2500), compact(1000), compact(12_400)]).toEqual(['311', '1.9k', '2.5k', '1k', '12k'])
    expect(splitPath('docs/android/BACKLOG.md')).toEqual(['docs/android/', 'BACKLOG.md'])
    expect(ruleCommand('Bash(swift test:*)')).toBe('swift test')
  })
})
