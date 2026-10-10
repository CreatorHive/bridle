import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentEvent, ApprovalPolicy, Chat, CodeAgentState, CodeMode, Message, PermissionRequest, Space, Subagent, Todo, Workspace } from '../../shared/types'
import { emit } from '../events'
import { agent, allows, readOnly, runClaude, trace, workspaceEdit } from '../services/agent'
import { pref, settings } from '../services/settings'
import { iso, sortKeys } from '../services/util'
import { decodeChat, encodeChat } from '../services/workspace'
import { isRepo, numstat, snapshot, snapshotRef } from './git'
import { chatsDir, loadSpaces, renameWorkspace, saveSpace, UNTITLED } from './spaces'

// The agent for a Workspace, the Claude CLI running in its worktree. One turn is
// one CLI process (resumed by session id) in the mode of the composer:
//   Plan  → plan         read-only; the plan comes back for Approve / Revise, and Approve switches the
//                        same turn to acceptEdits
//   Build → acceptEdits  edits in the worktree go through (every turn is snapshotted, so Revert undoes)
// Read-only commands never ask; others show a card with "Always allow", saved on the Space. Commits,
// pushes and anything outside the worktree always ask. Chats are JSONL in spaces/<repo>/workspaces/<name>/chats/.

// MARK: Rules (pure)

/** Looking around never asks (the CLI knows these too). */
export const READ_ONLY = ['Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)',
  'Bash(ls:*)', 'Bash(rg:*)', 'Bash(grep:*)', 'Bash(cat:*)', 'Bash(find:*)', 'Bash(pwd)']

/** Shell plumbing that could hide a second command behind an allowed one. */
export const chained = (command: string): boolean =>
  ['&&', '||', ';', '|', '`', '$(', '>', '<', '\n', '&'].some((s) => command.includes(s))

const COMMIT_OR_PUSH = /\bgit\s+(commit|push)\b/

/** "swift test --filter X" → "Bash(swift test:*)". None for git commit/push, bare git, or chains. */
export function rule(command: string): string | null {
  const words = command.split(' ').filter(Boolean)
  if (!words.length || chained(command)) return null
  const [first, second] = words
  const prefix = second && /^[\p{L}-]+$/u.test(second) && !second.startsWith('-') ? `${first} ${second}` : first
  if (prefix === 'git' || prefix === 'git commit' || prefix === 'git push') return null
  return `Bash(${prefix}:*)`
}

/** Whether a saved "Bash(prefix:*)" rule covers `command`. Never chains, commits or pushes. */
export function allowed(command: string, rules: string[]): boolean {
  if (chained(command) || COMMIT_OR_PUSH.test(command)) return false
  return rules.some((r) => {
    if (!r.startsWith('Bash(') || !r.endsWith(':*)')) return false
    const prefix = r.slice(5, -3)
    return command === prefix || command.startsWith(prefix + ' ')
  })
}

const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

/**
 * Whether a Code turn's tool request runs without a card:
 * - edits inside the worktree go through (snapshotted), except while it's still planning;
 * - git commit / git push and anything outside the worktree always ask;
 * - read-only and "Always allow" commands go through; the rest follows Settings → Tools (ApprovalPolicy).
 */
export function codeAllows(tool: string, input: Record<string, unknown>,
  o: { cwd: string; planning: boolean; policy: ApprovalPolicy; rules: string[] }): boolean {
  if (FILE_TOOLS.includes(tool)) return !o.planning && workspaceEdit(tool, input, o.cwd) !== null
  if (tool === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : ''
    if (COMMIT_OR_PUSH.test(command)) return false
    if (allowed(command, [...READ_ONLY, ...o.rules])) return true
  }
  return readOnly(tool, input) || allows(o.policy, tool, input, [o.cwd])
}

// MARK: Folding stream lines

/** "Explore" → "Explorer", "general-purpose" → "Worker". */
export function displayName(type: unknown): string {
  if (type == null || type === 'general-purpose' || type === 'claude') return 'Worker'
  if (type === 'Explore') return 'Explorer'
  if (type === 'Plan') return 'Planner'
  return String(type).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

type Line = Record<string, any>

/** Folds one CLI stream line into the reply: its checklist and its subagents. Returns `m` itself when nothing changed. */
export function fold(e: Line, m: Message, root: string, now = iso()): Message {
  const parent = typeof e.parent_tool_use_id === 'string' ? e.parent_tool_use_id : null
  let subagents = m.subagents ?? null
  let todos = m.todos ?? null
  let changed = false
  const update = (id: string, change: (s: Subagent) => Subagent) => {
    if (!subagents?.some((s) => s.id === id)) return
    subagents = subagents.map((s) => (s.id === id ? change(s) : s))
    changed = true
  }
  const blocks = (e.message?.content ?? []) as Line[]
  if (e.type === 'assistant') {
    for (const b of blocks.filter((b) => b?.type === 'tool_use')) {
      const name: string = b.name ?? ''
      const input: Line = b.input ?? {}
      if (parent) { // a subagent's own step
        update(parent, (s) => ({ ...s, trace: [...s.trace, trace(name, input, root)] }))
        continue
      }
      if (name === 'Agent' || name === 'Task') {
        subagents = [...(subagents ?? []), {
          id: typeof b.id === 'string' ? b.id : randomUUID().toUpperCase(), name: displayName(input.subagent_type),
          description: typeof input.description === 'string' ? input.description : '', state: 'running', trace: [], startedAt: now
        }]
        changed = true
      } else if (name === 'TaskCreate') {
        todos = [...(todos ?? []), { title: String(input.subject ?? ''), status: 'pending' }]
        changed = true
      } else if (name === 'TaskUpdate') {
        // ponytail: task ids are "1", "2"… in creation order; read the tool result if that ever changes.
        const i = Number.parseInt(String(input.taskId), 10) - 1
        if (todos && i >= 0 && i < todos.length && typeof input.status === 'string') {
          todos = input.status === 'deleted' ? todos.filter((_, j) => j !== i)
            : todos.map((t, j) => (j === i ? { ...t, status: input.status as Todo['status'] } : t))
          changed = true
        }
      } else if (name === 'TodoWrite') {
        const items = Array.isArray(input.todos) ? (input.todos as Line[]) : []
        todos = items.map((t) => ({ title: String(t.content ?? ''), status: (t.status ?? 'pending') as Todo['status'] }))
        changed = true
      }
    }
  } else if (e.type === 'user' && !parent) {
    // The Agent call's result means the subagent is done.
    for (const b of blocks.filter((b) => b?.type === 'tool_result' && typeof b.tool_use_id === 'string')) {
      update(b.tool_use_id, (s) => ({ ...s, state: b.is_error === true ? 'failed' : 'done', endedAt: now, activity: null }))
    }
  } else if (e.type === 'system' && typeof e.tool_use_id === 'string') {
    if (e.subtype === 'task_started') update(e.tool_use_id, (s) => ({ ...s, agentID: typeof e.task_id === 'string' ? e.task_id : null }))
    if (e.subtype === 'task_progress') update(e.tool_use_id, (s) => ({ ...s, activity: typeof e.description === 'string' ? e.description : null }))
  }
  return changed ? { ...m, subagents, todos } : m
}

/** CodeAgent.systemPrompt. A trusted repo's CLAUDE.md loads through --setting-sources project; otherwise we pass its text. */
export async function systemPrompt(space: Space, w: Workspace): Promise<string> {
  const name = (await settings.get('agentName')) || 'Bridle'
  const user = (await settings.get('userName')) || 'the user'
  let prompt = `You are ${name}, a coding agent inside Bridle's Code section, working with ${user} in the repo "${space.name}". The current folder is a git worktree of it on the branch ${w.branch}, made for this task. Make focused changes in the codebase's own style. Never commit or push unless asked.`
  for (const file of space.trusted ? ['AGENTS.md'] : ['CLAUDE.md', 'AGENTS.md']) {
    const text = await readFile(join(w.path, file), 'utf8').catch(() => '')
    if (text) prompt += `\n\nThe repo's ${file}:\n\n` + text.slice(0, 20_000)
  }
  return prompt
}

// MARK: The agent, one per workspace (kept while Bridle runs)

interface Rec {
  id: string
  chats: Chat[]
  running: boolean
  runningChat: string | null
  planWaiting: string | null
  planAnswer: ((approved: boolean, feedback: string) => void) | null
  /** Permission card id → the CLI request it answers. */
  cards: Map<string, string>
  rules: string[]
  stopped: boolean
}

const recs = new Map<string, Rec>()
const uuid = () => randomUUID().toUpperCase()
const runKey = (id: string) => `code:${id}`

/** A workspace's chats, newest file first. */
export async function readChats(dir: string): Promise<Chat[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.jsonl'))
  const chats = await Promise.all(names.map(async (n) => {
    try {
      const [text, s] = await Promise.all([readFile(join(dir, n), 'utf8'), stat(join(dir, n))])
      const chat = decodeChat(text)
      return chat && { chat: { ...chat, modified: iso(s.mtime) }, mtime: s.mtimeMs }
    } catch {
      return null
    }
  }))
  return chats.filter((c): c is NonNullable<typeof c> => !!c).sort((a, b) => b.mtime - a.mtime).map((c) => c.chat)
}

/** Writes one chat: finished turns only, atomically; empty chats aren't saved. */
export async function writeChat(dir: string, chat: Chat): Promise<void> {
  if (!chat.messages.length) return
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${chat.id.toLowerCase()}.jsonl`)
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, encodeChat(chat), 'utf8')
  await rename(tmp, file)
}

async function rec(w: Workspace): Promise<Rec> {
  let r = recs.get(w.id)
  if (!r) {
    const chats = await readChats(await chatsDir(w))
    r = recs.get(w.id) ?? { id: w.id, chats, running: false, runningChat: null, planWaiting: null, planAnswer: null, cards: new Map(), rules: [], stopped: false }
    recs.set(w.id, r)
  }
  return r
}

const stateOf = (r: Rec): CodeAgentState =>
  ({ workspaceId: r.id, running: r.running, runningChat: r.runningChat, planWaiting: r.planWaiting, pending: [...r.cards.keys()] })

const publish = (r: Rec) => emit('code:agent', stateOf(r))

export async function chats(w: Workspace): Promise<{ chats: Chat[]; state: CodeAgentState }> {
  const r = await rec(w)
  return { chats: r.chats, state: stateOf(r) }
}

async function save(w: Workspace, chat: Chat): Promise<void> {
  await writeChat(await chatsDir(w), chat).catch((e) => console.warn('code chat save:', e))
}

/** Your turn and a "Thinking" reply, then the turn runs in the background. Returns the chat id. */
export async function send(w: Workspace, space: Space, chatId: string | null, prompt: string, mode: CodeMode): Promise<string> {
  const r = await rec(w)
  if (r.running) throw new Error('The agent is still working in this workspace.')
  if (w.title === UNTITLED) { // the first message names the workspace
    const title = prompt.split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
    if (title) {
      await renameWorkspace(w, title)
      w = { ...w, title }
      emit('code:workspaces', {})
    }
  }
  let chat = chatId ? r.chats.find((c) => c.id === chatId) : undefined
  if (!chat) {
    chat = { id: uuid(), title: prompt.slice(0, 60), messages: [] }
    r.chats.unshift(chat)
  }
  const reply: Message = { id: uuid(), role: 'assistant', text: '', trace: [], date: iso(), status: 'Thinking' }
  chat.messages.push({ id: uuid(), role: 'user', text: prompt, files: [], trace: [], date: iso() }, reply)
  await save(w, chat)
  emit('code:chat', { workspaceId: w.id, chat })
  r.running = true
  r.runningChat = chat.id
  r.stopped = false
  r.rules = space.allowedCommands
  publish(r)
  void turn(r, w, space, chat, reply.id, prompt, mode)
  return chat.id
}

async function turn(r: Rec, w: Workspace, space: Space, chat: Chat, id: string, prompt: string, mode: CodeMode): Promise<void> {
  const root = w.path
  const i = chat.messages.findIndex((m) => m.id === id)
  const message = () => chat.messages[i]
  const update = (change: (m: Message) => Message) => {
    const next = change(message())
    if (next === message()) return
    chat.messages[i] = next
    emit('code:message', { workspaceId: w.id, chatId: chat.id, message: next })
  }
  const before = (await isRepo(root)) ? await snapshot(root, snapshotRef(w.id, id, 'before')) : null
  let planning = mode === 'plan'
  const policy = await settings.get('approvalPolicy')

  const handle = (e: AgentEvent) => {
    switch (e.type) {
      case 'session':
        chat.sessionID = e.session
        return
      case 'status': return update((m) => (m.text ? m : { ...m, status: e.status }))
      case 'trace': return update((m) => ({ ...m, trace: [...(m.trace ?? []), e.line] }))
      case 'text': return update((m) => ({ ...m, status: null, text: m.text + e.text }))
      case 'permission': return ask(r, w, chat, message(), e.request)
      default: // workers: subagents arrive through the stream lines
    }
  }
  try {
    const effort = await pref('codeEffort')
    await runClaude(runKey(w.id), prompt, chat.sessionID ?? null, await systemPrompt(space, w), handle, {
      cwd: root,
      permissionMode: mode === 'plan' ? 'plan' : 'acceptEdits',
      settingSources: space.trusted ? 'project' : '',
      allowedTools: [...READ_ONLY, ...space.allowedCommands],
      effort: typeof effort === 'string' && effort ? effort : undefined,
      env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' }, // TaskCreate / TaskUpdate → the checklist
      onLine: (line) => update((m) => fold(line, m, root)),
      onPlan: (plan, respond) => {
        update((m) => ({ ...m, plan }))
        r.planAnswer = (approved, feedback) => {
          if (approved) planning = false
          respond(approved, feedback)
        }
        r.planWaiting = id
        publish(r)
      },
      decide: (tool, input) => codeAllows(tool, input, { cwd: root, planning, policy, rules: r.rules })
    })
  } catch (e) {
    if (!r.stopped) update((m) => ({ ...m, text: m.text + (m.text ? '\n\n' : '') + '⚠️ ' + (e instanceof Error ? e.message : String(e)) }))
  }
  // What the turn changed, from git: any tool, script or formatter counts.
  const after = before ? await snapshot(root, snapshotRef(w.id, id, 'after')) : null
  const changes = before && after ? await numstat(root, before, after) : []
  const now = iso()
  update((m) => ({
    ...m, status: null, ended: now, ...(changes.length ? { changes } : {}),
    subagents: m.subagents?.map((s) => (s.state === 'running' ? { ...s, state: 'failed', endedAt: now } : s)) ?? m.subagents
  }))
  r.planAnswer = null
  r.planWaiting = null
  r.running = false
  r.runningChat = null
  r.cards.clear() // the CLI isn't waiting on them any more
  await save(w, chat)
  emit('code:chat', { workspaceId: w.id, chat })
  publish(r)
}

/** A tool that needs your OK, allowed by a rule saved mid-turn, or a card in the transcript. */
function ask(r: Rec, w: Workspace, chat: Chat, reply: Message, request: PermissionRequest): void {
  const command = request.tool === 'Bash' && typeof request.input.command === 'string' ? request.input.command : ''
  if (command && allowed(command, r.rules)) return void agent.respondPermission(request.requestId, true)
  let title = request.title
  const sub = reply.subagents?.find((s) => s.agentID && s.agentID === request.agentID)
  if (sub) title = `${sub.name} wants to ${title.charAt(0).toLowerCase()}${title.slice(1).replaceAll('?', '')}` // "Explorer wants to run a command"
  const fields: Record<string, string> = { title, tool: request.tool }
  const input = JSON.stringify(sortKeys(request.input))
  if (input.length <= 20_000) fields.input = input
  const r2 = rule(command)
  if (command && r2) fields.rule = r2
  const card: Message = { id: uuid(), role: 'tool', text: request.detail, trace: [], date: iso(), action: { kind: 'permission', fields } }
  chat.messages.push(card)
  r.cards.set(card.id, request.requestId)
  emit('code:chat', { workspaceId: w.id, chat })
  publish(r)
}

/** Permissions.resolve / CodeAgent.alwaysAllow: answers a card; "Always allow" saves its rule on the Space first. */
export async function respond(w: Workspace, cardId: string, allow: boolean, always = false): Promise<void> {
  const r = await rec(w)
  const requestId = r.cards.get(cardId)
  const chat = r.chats.find((c) => c.messages.some((m) => m.id === cardId))
  if (!requestId || !chat) return
  r.cards.delete(cardId)
  const i = chat.messages.findIndex((m) => m.id === cardId)
  const ruleText = chat.messages[i].action?.fields.rule
  if (allow && always && ruleText) {
    const space = (await loadSpaces()).find((s) => s.slug === w.repo)
    if (space && !space.allowedCommands.includes(ruleText)) {
      space.allowedCommands = [...space.allowedCommands, ruleText]
      await saveSpace(space)
    }
    r.rules = [...r.rules, ruleText]
  }
  await agent.respondPermission(requestId, allow)
  chat.messages[i] = { ...chat.messages[i], approved: allow }
  emit('code:chat', { workspaceId: w.id, chat })
  publish(r)
  if (allow) {
    // Shows "Allowed" for a beat, then folds away; the trace keeps the record.
    setTimeout(() => {
      const j = chat.messages.findIndex((m) => m.id === cardId)
      if (j < 0) return
      chat.messages[j] = { ...chat.messages[j], dismissed: true }
      emit('code:chat', { workspaceId: w.id, chat })
      void save(w, chat)
    }, 1000)
  }
  await save(w, chat)
}

/** Approve runs the plan in this same turn; Revise sends your notes and it plans again. */
export async function answerPlan(w: Workspace, approve: boolean, feedback = ''): Promise<void> {
  const r = await rec(w)
  r.planAnswer?.(approve, feedback.trim() || 'The user wants changes to the plan.')
  r.planAnswer = null
  r.planWaiting = null
  publish(r)
}

/** CodeAgent.stop. */
export async function stop(id: string): Promise<void> {
  const r = recs.get(id)
  if (!r?.running) return
  r.stopped = true
  await agent.cancel(runKey(id))
}

/** An archived workspace's agent stops and is forgotten. */
export async function dropAgent(id: string): Promise<void> {
  await stop(id)
  recs.delete(id)
}
