// Pure Code view logic (chat, diffs, workspace panel), covered by logic.test.ts.
import type { DiffHunk, FileChange, Message, Subagent } from '../../../shared/types'

/** "+N −M" totals. */
export function totals(files: { added: number; removed: number }[]): { added: number; removed: number } {
  return files.reduce((t, f) => ({ added: t.added + f.added, removed: t.removed + f.removed }), { added: 0, removed: 0 })
}

/** A sidebar line count: 311, 1.9k, 12k. */
export function compact(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
}

/** CodeReply.meta: "26m 58s · Jul 2, 5:37 PM", or just the date for a reply from before `ended` was kept. */
export function meta(start: string, end?: string | null): string {
  const s = new Date(start)
  const date = s.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  if (!end) return date
  return `${took(Math.max(0, Math.floor((new Date(end).getTime() - s.getTime()) / 1000)))} · ${date}`
}

const took = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`)

/** SubagentRow.elapsed. */
export function elapsed(from: string, to: string | Date = new Date()): string {
  const s = Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Activity.summary: "9 tool calls, 2 subagents". */
export function summary(trace: number, subagents: number): string {
  const parts = [`${trace} tool call${trace === 1 ? '' : 's'}`]
  if (subagents > 0) parts.push(`${subagents} subagent${subagents === 1 ? '' : 's'}`)
  return parts.join(', ')
}

export type Glyph = 'read' | 'edit' | 'bash' | 'search' | 'web' | 'agent' | 'todo' | 'tool'

/** A trace line ("read Sources/a.swift", "bash swift test") → its tool's kind. */
export function glyph(line: string): Glyph {
  const word = line.split(' ')[0]
  if (word === 'read') return 'read'
  if (['edit', 'multiedit', 'write', 'notebookedit'].includes(word)) return 'edit'
  if (word === 'bash') return 'bash'
  if (['grep', 'glob', 'ls'].includes(word)) return 'search'
  if (['webfetch', 'websearch'].includes(word)) return 'web'
  if (['agent', 'task'].includes(word)) return 'agent'
  if (['todowrite', 'taskcreate', 'taskupdate'].includes(word)) return 'todo'
  return 'tool'
}

/** Activity.glyphs: the distinct tools used, in order, at most five. */
export function glyphs(trace: string[]): Glyph[] {
  return [...new Set(trace.map(glyph))].slice(0, 5)
}

/** WorkingLine: what the working row says. */
export function workingLabel(status: string, running: Subagent[]): string {
  return running.length > 1 ? `${running.length} subagents working` : status
}

/** DiffView.prefix: the first `rows` rows (hunk headers count as one), cutting the last hunk short. */
export function prefixHunks(hunks: DiffHunk[], rows: number): DiffHunk[] {
  let left = rows
  const out: DiffHunk[] = []
  for (const hunk of hunks) {
    if (left <= 1) break
    const lines = hunk.lines.slice(0, left - 1)
    left -= lines.length + 1
    out.push({ ...hunk, lines })
  }
  return out
}

export const hunkHeader = (h: DiffHunk) => `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`

/** Rows a diff draws (each hunk's header plus its lines). */
export const diffRows = (hunks: DiffHunk[]) => hunks.reduce((n, h) => n + h.lines.length + 1, 0)

export type PlanBlock = { kind: 'heading'; level: number; text: string } | { kind: 'code'; text: string } | { kind: 'text'; text: string }

/** PlanDocument.blocks: headings, fenced code, and paragraphs. */
export function planBlocks(text: string): PlanBlock[] {
  const out: PlanBlock[] = []
  let para: string[] = []
  let code: string[] | null = null
  const flush = () => {
    if (para.length) out.push({ kind: 'text', text: para.join('\n') })
    para = []
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      if (code) {
        out.push({ kind: 'code', text: code.join('\n') })
        code = null
      } else {
        flush()
        code = []
      }
    } else if (code) code.push(line)
    else if (line.startsWith('#')) {
      flush()
      const level = /^#+/.exec(line)![0].length
      out.push({ kind: 'heading', level, text: line.slice(level).trim() })
    } else if (!line.trim()) flush()
    else para.push(line)
  }
  if (code) out.push({ kind: 'code', text: code.join('\n') })
  flush()
  return out
}

/** CodeAgent.changedFiles: every file the chat's turns changed, counts summed. */
export function chatChanges(messages: Message[]): FileChange[] {
  const out = new Map<string, FileChange>()
  for (const m of messages) {
    for (const c of m.changes ?? []) {
      const prev = out.get(c.path)
      out.set(c.path, prev ? { ...prev, added: prev.added + c.added, removed: prev.removed + c.removed } : { ...c })
    }
  }
  return [...out.values()]
}

/** "docs/android/BACKLOG.md" → ["docs/android/", "BACKLOG.md"]. */
export function splitPath(path: string): [string, string] {
  const i = path.lastIndexOf('/')
  return i < 0 ? ['', path] : [path.slice(0, i + 1), path.slice(i + 1)]
}

/** "Always allow `swift test`": the rule's command, "Bash(swift test:*)" → "swift test". */
export const ruleCommand = (rule: string) => rule.replace(/^Bash\(/, '').replace(/:\*\)$/, '')

/** The base a PR targets: "origin/main" → "main". */
export const prBase = (base: string) => (base.startsWith('origin/') ? base.slice(7) : base)

/** ~ for the home folder in paths shown to you. */
export const tildePath = (path: string, home: string) => (home && path.startsWith(home + '/') ? '~' + path.slice(home.length) : path)

/** Build output and installed packages: dimmed in the file tree, since you rarely open them. */
export const HEAVY_FOLDERS = new Set(['node_modules', '.build', 'build', 'dist', 'DerivedData', '.next', 'Pods', '.venv', '__pycache__'])
