// Live chat state and the reply loop (send, new chat, reply). Module-level, not
// component state: a reply keeps streaming when you switch sections.
//
// `latest` is the newest copy of every chat. Edits apply to it synchronously and then go to the
// store, so back-to-back stream events never build on a stale render. sync() takes the store's
// chats back in, keeping ours wherever the store only holds an older copy of our own edit.
import type { AgentEvent, Chat, Message } from '../../../shared/types'
import { play } from '../../sound'
import { cleanError, extractActions, mergeChat, needsTitle, now, relativePath, sortedJSON, uuid, watcherTurn } from './logic'

let latest: Chat[] = []
const ours = new WeakSet<Chat>()
let upsert: (chat: Chat) => void = () => {}
let setWorking: (ids: string[]) => void = () => {}
const running = new Set<string>()

/** Permission card id → the CLI request it answers.
 *  ponytail: in memory only; a card from before a relaunch shows as Expired. */
export const pendingPermissions = new Map<string, string>()
/** Cards denied in this session: they show "Denied" for a beat before folding away. Older denials stay hidden. */
export const deniedNow = new Set<string>()

export function sync(chats: Chat[], upsertChat: (chat: Chat) => void, working: (ids: string[]) => void): void {
  upsert = upsertChat
  setWorking = working
  const prev = new Map(latest.map((c) => [c.id, c]))
  const next = chats.map((c) => {
    const mine = prev.get(c.id)
    if (ours.has(c)) return mine ?? c
    return mine && running.has(c.id) ? mergeChat(mine, c) : c
  })
  for (const id of running) if (!next.some((c) => c.id === id) && prev.has(id)) next.unshift(prev.get(id)!)
  latest = next
}

export const getChat = (id: string): Chat | undefined => latest.find((c) => c.id === id)
export const isRunning = (id: string): boolean => running.has(id)

export function insertChat(chat: Chat): void {
  ours.add(chat)
  latest = [chat, ...latest]
  upsert(chat)
}

export function editChat(id: string, change: (chat: Chat) => Chat): void {
  const c = getChat(id)
  if (!c) return
  const next = change(c)
  ours.add(next)
  latest = latest.map((x) => (x === c ? next : x))
  upsert(next)
}

export function editMessage(chatId: string, messageId: string, change: (m: Message) => Message): void {
  editChat(chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === messageId ? change(m) : m)) }))
}

const append = (chatId: string, m: Message) => editChat(chatId, (c) => ({ ...c, messages: [...c.messages, m] }))

export function saveChat(id: string): void {
  const chat = getChat(id)
  if (chat) window.bridle.workspace.saveChat(chat).catch((e) => console.warn('saveChat:', cleanError(e)))
}

let root: Promise<string> | null = null
/** The workspace folder, for workspace-relative names in prompts and cards. */
export function workspaceRoot(): Promise<string> {
  root ??= window.bridle.workspace.path().catch(() => '')
  return root
}

/** Uploads.add for every attachment; the originals if copying fails. */
export async function upload(paths: string[]): Promise<string[]> {
  if (!paths.length) return []
  return window.bridle.workspace.addFiles(paths).catch(() => paths)
}

const notify = (title: string, body: string, chatId: string, when: 'notifyApprovals' | 'notifyDone') =>
  window.bridle.notify.post(title, body, chatId, when).catch(() => {})

export interface SendOptions {
  chatId: string
  text: string
  /** Already uploaded (see upload()). */
  files: string[]
  agentName: string
  /** contactsLine(): people and Gmail accounts for the agent. */
  contacts: string
  /** Holds "Thinking" back until a new chat's composer has settled. */
  thinkingDelay?: number
}

/** Appends your turn, saves, then streams the reply into a placeholder. */
export async function send(o: SendOptions): Promise<void> {
  const ws = await workspaceRoot()
  append(o.chatId, { id: uuid(), role: 'user', text: o.text, files: o.files, trace: [], date: now() })
  saveChat(o.chatId)
  const prompt = o.files.length ? `${o.text}\n\nAttached: ${o.files.map((f) => relativePath(f, ws)).join(', ')}` : o.text
  running.add(o.chatId)
  setWorking([...running])
  if (o.thinkingDelay) await new Promise((r) => setTimeout(r, o.thinkingDelay))
  const placeholder: Message = { id: uuid(), role: 'assistant', text: '', trace: [], date: now(), status: 'Thinking', workers: [] }
  append(o.chatId, placeholder)
  try {
    await reply(o, placeholder.id, prompt)
  } finally {
    running.delete(o.chatId)
    setWorking([...running])
  }
}

const cancelled = new Set<string>()

/** Stops the chat's running reply. */
export function cancel(chatId: string): void {
  if (!running.has(chatId)) return
  cancelled.add(chatId)
  window.bridle.agent.cancel(chatId).catch(() => {})
}

/** Runs the agent and streams its reply into the placeholder. */
async function reply(o: SendOptions, id: string, prompt: string): Promise<void> {
  const { chatId } = o
  const update = (change: (m: Message) => Partial<Message>) => editMessage(chatId, id, (m) => ({ ...m, ...change(m) }))
  const chat = getChat(chatId)
  if (!chat) return
  const at = chat.messages.findIndex((m) => m.id === id)
  // Everything before this turn (your message and the placeholder), without live-only fields.
  const history = chat.messages.slice(0, Math.max(0, at - 1)).map(({ status: _s, workers: _w, ...m }) => m)
  const { turn, alert } = watcherTurn(history, prompt)
  let failure: string | null = null
  cancelled.delete(chatId)

  const off = window.bridle.on('agent:event', ({ chatId: c, event }) => {
    if (c === chatId) handle(event)
  })
  function handle(event: AgentEvent) {
    switch (event.type) {
      case 'session': return editChat(chatId, (c) => ({ ...c, sessionID: event.session }))
      case 'status': return update((m) => (m.text ? {} : { status: event.status }))
      case 'trace': return update((m) => ({
        trace: [...(m.trace ?? []), event.line],
        ...(event.call ? { calls: [...(m.calls ?? []), { ...event.call, step: m.trace?.length ?? 0 }] } : {})
      }))
      case 'result': return update((m) => ({ calls: m.calls?.map((c) => (c.id === event.id ? { ...c, result: event.result, error: event.error } : c)) }))
      case 'worker': return update((m) => (m.workers?.includes(event.worker) ? {} : { workers: [...(m.workers ?? []), event.worker] }))
      case 'text': return update((m) => ({ status: null, workers: [], text: m.text + event.text }))
      case 'error': failure = event.message; return
      case 'permission': {
        // The run is paused until you answer this card. The tool's arguments travel with it, capped for huge writes.
        const r = event.request
        const input = sortedInput(r.input)
        const card: Message = {
          id: uuid(), role: 'tool', text: r.detail, trace: [], date: now(),
          action: { kind: 'permission', fields: { title: r.title, tool: r.tool, ...(input ? { input } : {}) } }
        }
        pendingPermissions.set(card.id, r.requestId)
        append(chatId, card)
        play('attention')
        notify(o.agentName, `Needs your OK: ${r.title}`, chatId, 'notifyApprovals')
        return
      }
    }
  }

  try {
    await window.bridle.agent.run(chatId, turn, history, {
      sessionID: chat.sessionID ?? null,
      project: chat.project ?? null,
      context: [o.contacts, alert].filter(Boolean).join('\n\n')
    })
    off()
    update(() => ({ status: null, workers: [] }))
    if (cancelled.has(chatId)) return stopped(chatId, id)
    play('ready', { emphasis: 'subtle' })
    // Action blocks in the reply become approval cards under it.
    const text = getChat(chatId)?.messages.find((m) => m.id === id)?.text ?? ''
    const { text: clean, actions } = extractActions(text)
    if (actions.length) {
      update(() => ({ text: clean }))
      for (const action of actions) {
        await new Promise((r) => setTimeout(r, 150))
        append(chatId, { id: uuid(), role: 'tool', text: action.fields.body ?? '', trace: [], date: now(), action })
        play('attention')
      }
      const what = actions.map((a) => a.fields.subject ?? a.fields.title ?? a.kind).join(', ')
      notify(o.agentName, `Needs your approval: ${what}`, chatId, 'notifyApprovals')
    } else {
      notify(o.agentName, clean || 'Done', chatId, 'notifyDone')
    }
  } catch (e) {
    off()
    if (cancelled.has(chatId)) {
      update(() => ({ status: null, workers: [] }))
      stopped(chatId, id)
    } else {
      const message = failure ?? cleanError(e)
      update((m) => ({ status: null, workers: [], text: m.text + (m.text ? '\n\n' : '') + '⚠️ ' + message }))
      play('error')
    }
  }
  cancelled.delete(chatId)
  saveChat(chatId)
  void nameChat(chatId) // "what is unidesk" → "UniDesk Overview"
}

/** A stopped reply that never said anything leaves no empty turn behind. */
function stopped(chatId: string, id: string) {
  editChat(chatId, (c) => ({ ...c, messages: c.messages.filter((m) => m.id !== id || m.text || m.trace?.length) }))
}

function sortedInput(input: Record<string, unknown>): string | null {
  try {
    const json = sortedJSON(input)
    return json.length <= 20_000 ? json : null
  } catch {
    return null
  }
}

/** ChatTitle.name: a short name for a chat still titled with its first message. */
async function nameChat(chatId: string): Promise<void> {
  const chat = getChat(chatId)
  if (!chat || !needsTitle(chat)) return
  const name = await window.bridle.agent.chatTitle(chat).catch(() => null)
  const current = getChat(chatId)
  const first = current?.messages.find((m) => m.role === 'user')?.text
  if (!name || !current || current.title !== first) return // renamed meanwhile
  editChat(chatId, (c) => ({ ...c, title: name }))
  saveChat(chatId)
}
