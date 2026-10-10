// Pure chat logic (no React, no window.bridle). Everything here is covered by logic.test.ts.
import {
  PROVIDERS, TASK_STATUSES,
  type Account, type AgentAction, type ApprovalPolicy, type Chat, type Mail, type Message, type Settings
} from '../../../shared/types'

/** A random UUID, uppercase. */
export const uuid = (): string => crypto.randomUUID().toUpperCase()

/** ISO-8601 without fractional seconds. */
export const now = (): string => new Date().toISOString().replace(/\.\d+Z$/, 'Z')

/** The new-chat greeting for the time of day. */
export function greeting(hour: number, userName: string): string {
  const word = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return userName ? `${word}, ${userName}` : word
}

/** ApprovalPolicy.caption: under the chat box. */
export const POLICY_CAPTION: Record<ApprovalPolicy, string> = {
  'Always ask': 'Writes outside your workspace need approval.',
  'Allow app actions': 'Connected apps act without asking.',
  'Allow everything': 'Almost everything runs without asking.'
}

/** Provider.current.models / .model / .modelKey, and the top bar's label ("anthropic/x" → "x"). */
export function modelChoice(s: Settings): { models: string[]; key: 'model' | 'openRouterModel' | 'localModel' | null; value: string; label: string } {
  const p = PROVIDERS[s.provider] ?? PROVIDERS['Claude CLI']
  const models = p.modelKey === 'localModel' ? [s.localModel] : p.models
  const value = (p.modelKey && s[p.modelKey]) || models[0] || ''
  return { models, key: p.modelKey, value, label: value.split('/').pop() ?? value }
}

/** AgentAction.extract: the reply without its ```bridle:<kind>``` blocks (and without a half-streamed one), plus the actions. */
export function extractActions(text: string): { text: string; actions: AgentAction[] } {
  const marker = '```bridle:'
  let clean = ''
  let rest = text
  const actions: AgentAction[] = []
  for (let start = rest.indexOf(marker); start >= 0; start = rest.indexOf(marker)) {
    clean += rest.slice(0, start)
    const after = rest.slice(start + marker.length)
    const newline = after.indexOf('\n')
    const end = newline < 0 ? -1 : after.indexOf('```', newline)
    if (end < 0) { rest = ''; break } // still streaming
    const kind = after.slice(0, newline).trim()
    try {
      const obj: unknown = JSON.parse(after.slice(newline, end))
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const fields = Object.fromEntries(Object.entries(obj).map(([k, v]) =>
          [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)]))
        actions.push({ kind, fields })
      }
    } catch { /* a malformed block is dropped */ }
    rest = after.slice(end + 3)
  }
  return { text: (clean + rest).trim(), actions }
}

/**
 * Watcher messages since your last turn (the agent's session never saw them).
 * They're quoted into this turn so a short "yeah" attaches to them, and summarized as context.
 */
export function watcherTurn(history: Message[], prompt: string): { turn: string; alert: string | null } {
  const since: Message[] = []
  for (let i = history.length - 1; i >= 0 && history[i].role !== 'user'; i--) since.unshift(history[i])
  const unseen = since.filter((m) => m.source != null)
  if (!unseen.length) return { turn: prompt, alert: null }
  const alert = 'You (Bridle) messaged the user first about:\n- ' + unseen.map((m) => m.source).join('\n- ')
    + '\nTheir message answers yours. Take the next step you offered, using the Composio tools. Anything that sends or changes something goes through an approval card.'
  const quoted = unseen.map((m) => `«${m.text}»`).join('\n\n')
  return { turn: `[Earlier in this chat, you (Bridle) wrote to the user first:\n${quoted}\n\nThe user's reply below answers that.]\n\n${prompt}`, alert }
}

/** The user's Gmail addresses (GmailSync.accounts). */
export const gmailLogins = (accounts: Account[]): string[] =>
  accounts.filter((a) => a.grants.some((g) => g.toolkit === 'gmail' && g.ok)).map((a) => a.login)

/** People the agent can address, so "email Alex" resolves to an address. */
export function contactsLine(mail: Mail[], accounts: Account[]): string {
  const seen = new Set<string>()
  const people = mail.filter((m) => m.mailbox === 'Inbox' && !seen.has(m.email) && seen.add(m.email)).map((m) => `${m.from} <${m.email}>`)
  const mine = gmailLogins(accounts)
  return 'Contacts: ' + people.join('; ') + (mine.length ? '\nThe user\'s Gmail accounts (for "from"): ' + mine.join(', ') : '')
}

/** Uploads.path: workspace-relative, or the full path for files outside it. */
export function relativePath(path: string, root: string): string {
  const r = root.endsWith('/') ? root : root + '/'
  return path.startsWith(r) ? path.slice(r.length) : path
}

/** A workspace path back to absolute. */
export const absolutePath = (path: string, root: string): string => (path.startsWith('/') ? path : `${root.replace(/\/$/, '')}/${path}`)

export const basename = (path: string): string => path.split('/').pop() ?? path

export const isImage = (path: string): boolean => /\.(png|jpe?g|gif|webp|heic|tiff?|bmp|svg)$/i.test(path)

/** AgentMessage trace: "read notes/x.md" → "notes/x.md" when the step names a file (Trace links it once it exists). */
export function traceTarget(step: string): string | null {
  const i = step.indexOf(' ')
  const path = i < 0 ? '' : step.slice(i + 1)
  return /^[^\s·]+(\/[^\s·]*)*\.\w{1,8}$/.test(path) ? path : null
}

/** Files a reply names in backticks ("`user/files/Plan.docx`"), first four, in order; AgentMessage shows the ones that exist. */
export function mentionedFiles(text: string): string[] {
  const paths = [...text.matchAll(/`([^`\n]+\.\w{1,8})`/g)].map((m) => m[1].trim())
  return [...new Set(paths)].slice(0, 4)
}

/** JSON with sorted keys (JSONSerialization .sortedKeys), for a permission card's saved input. */
export function sortedJSON(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v)
}

/** PermissionDetail.leaves: every leaf value of nested input, keyed by its last name. */
export function leaves(value: unknown, key = ''): { key: string; value: string }[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const d = value as Record<string, unknown>
    return Object.keys(d).sort().flatMap((k) => leaves(d[k], k))
  }
  if (Array.isArray(value) && value.some((v) => v && typeof v === 'object' && !Array.isArray(v))) {
    return value.flatMap((v) => leaves(v, key))
  }
  return [{ key, value: typeof value === 'string' ? value : Array.isArray(value) ? value.map(String).join(', ') : String(value) }]
}

/** DiffLines.trim: drops lines an edit leaves alone at either end, so only the change shows. */
export function trimDiff(old: string[], next: string[]): [string[], string[]] {
  let start = 0
  while (start < old.length && start < next.length && old[start] === next[start]) start++
  let end = 0
  while (end < old.length - start && end < next.length - start && old[old.length - 1 - end] === next[next.length - 1 - end]) end++
  return [old.slice(start, old.length - end), next.slice(start, next.length - end)]
}

/** ToolCard: what kind of card a tool message is and what it says. */
export function cardInfo(message: Message, gmails: string[]) {
  const action = message.action ?? null
  const f = action?.fields ?? {}
  const kind = action?.kind
  const isPermission = kind === 'permission'
  const isEvent = kind === 'event'
  const isTask = kind === 'task'
  const isEmail = kind === 'email'
  const toLinear = ['yes', 'true'].includes((f.linear ?? '').toLowerCase())

  let title: string
  if (!action) title = message.title ?? 'Approve this?'
  else if (isPermission) title = f.title ?? 'Allow this?'
  else if (isEvent) title = `Add “${f.title ?? 'event'}” to your calendar?`
  else if (isTask) title = `Add “${f.title ?? 'task'}” as a task?`
  else {
    const name = (f.to ?? '').split('<')[0].trim()
    title = name ? `Send email to ${name.split(' ')[0]}?` : 'Send this email?'
  }

  let rows: [string, string][] = []
  if (isEvent) rows = [['When', [f.start, f.end].filter((v) => v != null).join(' – ')]]
  else if (isTask) {
    const status = TASK_STATUSES.find((s) => s.status === (f.status ?? '').toLowerCase()) ?? TASK_STATUSES[0]
    rows = ([['Column', status.title], ['Tags', f.tags ?? ''], ['Linear', toLinear ? 'Also create an issue assigned to you' : '']] as [string, string][])
      .filter(([, v]) => v)
  } else if (isEmail) rows = [['To', f.to ?? ''], ['Subject', f.subject ?? '']]

  /** The account it sends from: the agent's pick when it's one of yours, else your first Gmail. */
  const sender = f.from && gmails.includes(f.from) ? f.from : gmails[0] ?? null
  const confirm = message.confirm ?? (isPermission ? 'Allow' : isEvent ? 'Add' : isTask ? 'Add task' : 'Send')
  const done = !action ? 'Done' : isPermission ? 'Allowed' : isEvent || isTask ? 'Added' : 'Sent'
  return { action, kind, isPermission, isEvent, isTask, isEmail, title, rows, sender, confirm, done }
}

/** ChatTitle.name's guard: still titled with its first message, which has text, and answered. */
export function needsTitle(chat: Chat): boolean {
  const first = chat.messages.find((m) => m.role === 'user')
  return !!first?.text && chat.title === first.text && chat.messages.some((m) => m.role === 'assistant' && !!m.text)
}

/** An IPC rejection without Electron's "Error invoking remote method '…': Error: " prefix. */
export function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, '')
}

/** A chat reloaded from disk while a reply streams: keep ours (with the live placeholder) and add
 *  turns only the disk has (a watcher post to Home). */
export function mergeChat(ours: Chat, theirs: Chat): Chat {
  const ids = new Set(ours.messages.map((m) => m.id))
  return { ...ours, messages: [...ours.messages, ...theirs.messages.filter((m) => !ids.has(m.id))] }
}

/** Where a chat lives: chats/<id>.jsonl, or goals/<project>/chats/<id>.jsonl.
 *  Null for an id the main process would hash (not a UUID); such chats are only ever made by tests. */
export function chatFilePath(chat: Chat, root: string): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chat.id)) return null
  const dir = chat.project ? `goals/${chat.project}/chats` : 'chats'
  return `${root.replace(/\/$/, '')}/${dir}/${chat.id.toLowerCase()}.jsonl`
}
