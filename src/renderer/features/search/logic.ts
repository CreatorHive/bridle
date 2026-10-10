import type { Chat, Mail, SearchHit, TaskItem } from '../../../shared/types'

// Index hits become rows (best passage per file); mail and Linear issues, which don't live
// in the workspace, are matched here from what the app already loaded.

export type ResultKind = 'chat' | 'task' | 'meeting' | 'file' | 'mail'

export interface Result {
  key: string
  kind: ResultKind
  title: string
  /** "Chat", "Task", a workspace-relative path, or the sender. */
  detail: string
  snippet: string
  path?: string
  chatId?: string
  mail?: Mail
}

/** The passage around the first query word it contains, on one line. */
export function snippet(text: string, query: string): string {
  const flat = text.replace(/\n/g, ' ')
  const lower = flat.toLowerCase()
  const at = query.split(' ').filter((w) => w.length > 2).map((w) => lower.indexOf(w.toLowerCase())).find((i) => i >= 0)
  if (at === undefined) return flat.slice(0, 220)
  const start = Math.max(0, at - 60)
  return (start > 0 ? '…' : '') + flat.slice(start, start + 220)
}

/** chats/<id>.jsonl (top level or in a goal) → its id. */
export const chatFileId = (path: string): string | null => path.match(/\/chats\/([^/]+)\.jsonl$/)?.[1] ?? null

/** What an index hit is, from where it lives in the workspace. */
export function kindOf(path: string, root: string): Exclude<ResultKind, 'mail'> {
  if (chatFileId(path)) return 'chat'
  const rel = path.startsWith(root + '/') ? path.slice(root.length + 1) : path
  if (/^tasks\/[^/]+\.md$/.test(rel)) return 'task'
  if (/^meetings\//.test(rel)) return 'meeting'
  return 'file'
}

/** Index hits as rows: the best passage per file, ten at most. A chat file Bridle doesn't know shows as a file. */
export function hitResults(hits: SearchHit[], query: string, root: string, chats: Chat[]): Result[] {
  const seen = new Set<string>()
  const out: Result[] = []
  for (const h of hits) {
    if (seen.has(h.path) || out.length >= 10) continue
    seen.add(h.path)
    const id = chatFileId(h.path)
    const chat = id ? chats.find((c) => c.id.toLowerCase() === id.toLowerCase()) : undefined
    const kind = id && !chat ? 'file' : kindOf(h.path, root)
    const name = h.path.split('/').pop() ?? h.path
    const rel = h.path.startsWith(root + '/') ? h.path.slice(root.length + 1) : h.path.replace(/^\/Users\/[^/]+/, '~')
    const taskTitle = kind === 'task' ? h.text.match(/^# (.+)$/m)?.[1] : undefined
    out.push({
      key: h.path,
      kind,
      title: chat?.title ?? taskTitle ?? name,
      detail: { chat: 'Chat', task: 'Task', meeting: 'Meeting prep', file: rel }[kind],
      snippet: snippet(h.text, query),
      path: h.path,
      chatId: chat?.id
    })
  }
  return out
}

/** Every word of the query (two characters or more) appears in `haystack`. */
export function matches(haystack: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1)
  const hay = haystack.toLowerCase()
  return words.length > 0 && words.every((w) => hay.includes(w))
}

/** Loaded mail whose sender, subject or text has every word, newest first as loaded. */
export function mailResults(mail: Mail[], query: string, limit = 5): Result[] {
  return mail
    .filter((m) => matches(`${m.from} ${m.email} ${m.subject} ${m.snippet ?? ''} ${m.body}`, query))
    .slice(0, limit)
    .map((m) => ({ key: `mail:${m.id}`, kind: 'mail', title: m.subject || '(no subject)', detail: m.from || m.email,
      snippet: snippet(m.snippet || m.body, query), mail: m }))
}

/** Linear issues (yours are already in the index as tasks/*.md). */
export function linearResults(tasks: TaskItem[], query: string, limit = 3): Result[] {
  return tasks
    .filter((t) => t.linear && matches(`${t.linear.identifier} ${t.title} ${t.notes}`, query))
    .slice(0, limit)
    .map((t) => ({ key: t.id, kind: 'task', title: t.title, detail: `${t.linear!.identifier} · Linear`, snippet: snippet(t.notes, query) }))
}
