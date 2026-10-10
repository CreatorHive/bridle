// Code's live state (Spaces.shared, Workspaces.shared, CodeAgent.of, Bench.of, DevTools): module-level,
// not component state, so tabs, drafts, runs and replies survive switching sections. Main owns the
// truth and pushes `code:*` events; this keeps the latest copy and re-renders subscribers.
import { useSyncExternalStore } from 'react'
import {
  DEFAULT_CODE_PREFS,
  type ChangedFile, type Chat, type CodeAgentState, type CodePrefs, type DevToolsState, type Space, type Workspace
} from '../../../shared/types'
import { play } from '../../sound'
import { disposeTerminal } from './Terminal'

/** CodeTab: a chat (the open one), or a diff, file or review tab you opened. */
export type Tab = { kind: 'chat' } | { kind: 'diff'; path: string } | { kind: 'file'; path: string } | { kind: 'review' }

/** Bench: a workspace's open tabs, the chat on screen and the unsent draft. */
export interface Bench {
  tab: Tab
  /** The closable ones: diffs, files, review. */
  tabs: Tab[]
  /** null = a new chat. */
  chatId: string | null
  draft: string
  attachments: string[]
  /** The right panel's top half: Changes or All files. */
  showChanges: boolean
  bottom: 'setup' | 'run' | 'terminal'
  /** Terminal ids, and the one shown. */
  terms: string[]
  term: string | null
}

export interface CodeState {
  loaded: boolean
  spaces: Space[]
  workspaces: Workspace[]
  /** The open workspace (CodeScreen's workspaceID). */
  selected: string | null
  changes: Record<string, ChangedFile[]>
  chats: Record<string, Chat[]>
  agents: Record<string, CodeAgentState>
  tools: Record<string, DevToolsState>
  benches: Record<string, Bench>
  prefs: CodePrefs
}

let state: CodeState = {
  loaded: false, spaces: [], workspaces: [], selected: null, changes: {}, chats: {}, agents: {}, tools: {}, benches: {},
  prefs: DEFAULT_CODE_PREFS
}
const listeners = new Set<() => void>()

export function getState(): CodeState {
  return state
}

export function setState(patch: Partial<CodeState> | ((s: CodeState) => Partial<CodeState>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The whole state, re-rendering on every change. ponytail: one store, no selectors; fine at this size. */
export function useCode(): CodeState {
  return useSyncExternalStore(subscribe, getState, getState)
}

export const NEW_BENCH: Bench = { tab: { kind: 'chat' }, tabs: [], chatId: null, draft: '', attachments: [], showChanges: true, bottom: 'setup', terms: [], term: null }

export const benchOf = (s: CodeState, id: string): Bench => s.benches[id] ?? { ...NEW_BENCH, chatId: s.chats[id]?.[0]?.id ?? null }

export function setBench(id: string, patch: Partial<Bench> | ((b: Bench) => Partial<Bench>)): void {
  setState((s) => {
    const b = benchOf(s, id)
    return { benches: { ...s.benches, [id]: { ...b, ...(typeof patch === 'function' ? patch(b) : patch) } } }
  })
}

export const sameTab = (a: Tab, b: Tab): boolean =>
  a.kind === b.kind && (a.kind !== 'diff' && a.kind !== 'file' ? true : a.path === (b as { path: string }).path)

/** Bench.open: a chat switches the chat on screen; anything else opens (or focuses) its tab. */
export function openTab(id: string, t: Tab, chatId?: string | null): void {
  setBench(id, (b) => ({
    tab: t,
    tabs: t.kind === 'chat' || b.tabs.some((x) => sameTab(x, t)) ? b.tabs : [...b.tabs, t],
    ...(chatId !== undefined ? { chatId } : {})
  }))
}

/** Bench.close: the tab beside it (or the chat) takes its place. */
export function closeTab(id: string, t: Tab): void {
  setBench(id, (b) => {
    const i = b.tabs.findIndex((x) => sameTab(x, t))
    if (i < 0) return {}
    const tabs = b.tabs.filter((_, j) => j !== i)
    return { tabs, tab: sameTab(b.tab, t) ? tabs[Math.max(0, i - 1)] ?? { kind: 'chat' } : b.tab }
  })
}

// MARK: Loading

const api = () => window.bridle.code

/** Spaces and workspaces, then their changes (CodeSidebar's .task). */
export async function refresh(): Promise<void> {
  const [spaces, workspaces, prefs] = await Promise.all([api().spaces(), api().workspaces(), state.loaded ? state.prefs : api().prefs()])
  setState((s) => ({ loaded: true, spaces, workspaces, prefs, selected: s.selected && workspaces.some((w) => w.id === s.selected) ? s.selected : null }))
  for (const w of workspaces) void refreshChanges(w.id)
}

export async function refreshChanges(id: string): Promise<void> {
  const files = await api().changes(id).catch(() => null)
  if (files) setState((s) => ({ changes: { ...s.changes, [id]: files } }))
}

export async function loadChats(id: string): Promise<void> {
  const { chats, state: agent } = await api().chats(id)
  setState((s) => ({ chats: { ...s.chats, [id]: chats }, agents: { ...s.agents, [id]: agent } }))
}

export async function loadTools(id: string): Promise<void> {
  const tools = await api().tools(id).catch(() => null)
  if (tools) setState((s) => ({ tools: { ...s.tools, [id]: tools } }))
}

export function setPref<K extends keyof CodePrefs>(key: K, value: CodePrefs[K]): void {
  setState((s) => ({ prefs: { ...s.prefs, [key]: value } }))
  void api().setPref(key, value).catch(() => {})
}

export function select(id: string | null): void {
  setState({ selected: id })
}

// MARK: Events from main

function upsertChat(list: Chat[] = [], chat: Chat): Chat[] {
  return list.some((c) => c.id === chat.id) ? list.map((c) => (c.id === chat.id ? chat : c)) : [chat, ...list]
}

const agentName = () => window.bridle.settings.get('agentName').then((n) => n || 'Bridle', () => 'Bridle')
const notify = (body: string) => void agentName().then((n) => window.bridle.notify.post(n, body, null, 'notifyApprovals')).catch(() => {})

/** Sounds and banners follow the agent's state, as CodeAgent.turn plays and posts them. */
function agentChanged(before: CodeAgentState | undefined, after: CodeAgentState): void {
  if (!before) return
  if (after.planWaiting && after.planWaiting !== before.planWaiting) {
    play('attention')
    notify('Plan ready for review')
  }
  if (after.pending.some((p) => !before.pending.includes(p))) {
    play('attention')
    const chats = state.chats[after.workspaceId] ?? []
    const card = chats.flatMap((c) => c.messages).find((m) => m.id === after.pending[after.pending.length - 1])
    notify(`Needs your OK: ${card?.action?.fields.title ?? 'a command'}`)
  }
  if (before.running && !after.running) {
    const reply = (state.chats[after.workspaceId] ?? []).find((c) => c.id === before.runningChat)?.messages.filter((m) => m.role === 'assistant').pop()
    if (reply?.text.includes('⚠️')) play('error')
    else play('ready', { emphasis: 'subtle' })
    void refreshChanges(after.workspaceId)
  }
}

let wired = false
/** Subscribes to main's events once (window.bridle exists only in the app). */
export function wire(): void {
  if (wired || typeof window === 'undefined' || !window.bridle?.on) return
  wired = true
  const on = window.bridle.on
  on('code:workspaces', () => void refresh())
  on('notify:opened', (p) => { if ('workspaceId' in p) select(p.workspaceId) }) // a notch row
  on('code:chat', ({ workspaceId, chat }) => setState((s) => ({ chats: { ...s.chats, [workspaceId]: upsertChat(s.chats[workspaceId], chat) } })))
  on('code:message', ({ workspaceId, chatId, message }) => setState((s) => ({
    chats: {
      ...s.chats,
      [workspaceId]: (s.chats[workspaceId] ?? []).map((c) => (c.id !== chatId ? c : {
        ...c, messages: c.messages.some((m) => m.id === message.id) ? c.messages.map((m) => (m.id === message.id ? message : m)) : [...c.messages, message]
      }))
    }
  })))
  on('code:agent', (a) => {
    const before = state.agents[a.workspaceId]
    setState((s) => ({ agents: { ...s.agents, [a.workspaceId]: a } }))
    agentChanged(before, a)
  })
  on('code:tools', (t) => setState((s) => {
    const old = s.tools[t.workspaceId]
    if (old?.running && !t.running && t.exitCode != null) play(t.exitCode === 0 ? 'success' : 'error', { emphasis: 'subtle' })
    return { tools: { ...s.tools, [t.workspaceId]: { ...(old ?? { output: '', setupLog: '' }), ...t } } }
  }))
  // A shell that exits makes way for the one beside it (DevTools.forget).
  on('code:term', ({ termId, exited }) => {
    if (!exited) return
    disposeTerminal(termId)
    for (const [id, b] of Object.entries(state.benches)) {
      const i = b.terms.indexOf(termId)
      if (i < 0) continue
      const terms = b.terms.filter((t) => t !== termId)
      setBench(id, { terms, term: b.term === termId ? terms[i] ?? terms[terms.length - 1] ?? null : b.term })
    }
  })
  on('code:output', ({ workspaceId, kind, text, reset }) => setState((s) => {
    const old = s.tools[workspaceId]
    if (!old) return {}
    const key = kind === 'run' ? 'output' : 'setupLog'
    return { tools: { ...s.tools, [workspaceId]: { ...old, [key]: reset ? text : (old[key] + text).slice(-250_000) } } }
  }))
}
