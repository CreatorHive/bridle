import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import type { Account, Chat, Mail, Mailbox, SettingKey, Settings } from '../../shared/types'
import { play, setMuted, setSoundVolume } from '../sound'

// App-wide UI state. Small on purpose:
// features keep their own data in their folder and only share what the shell must show
// (titles, sidebar rows, badges). Read it with useApp().

/** A section, as offered by the rail. */
export type Section = 'chat' | 'board' | 'calendar' | 'meetings' | 'mail' | 'files' | 'code'
export const SECTIONS: readonly Section[] = ['chat', 'board', 'calendar', 'meetings', 'mail', 'files', 'code']

export type SettingsPage = 'general' | 'profile' | 'agent' | 'models' | 'connections' | 'tools' | 'automations' | 'storage'
export const SETTINGS_PAGES: readonly SettingsPage[] = ['general', 'profile', 'agent', 'models', 'connections', 'tools', 'automations', 'storage']

/** Names the Home chat has gone by. */
export const HOME_TITLES = ['Home', 'Needs you']

export interface AppState {
  section: Section
  /** The open chat; null = a new, unsaved chat. */
  chatId: string | null
  settingsOpen: boolean
  settingsPage: SettingsPage
  /** Every chat (Recent + project chats), as loaded from the workspace. Chat feature keeps it current. */
  chats: Chat[]
  /** Chats with a reply still running (sidebar spinner). */
  working: string[]
  homeChatId: string | null
  /** Connected accounts (mail sidebar Accounts, photos). */
  accounts: Account[]
  /** Loaded mail, for the sidebar badges; the mail feature fills it. */
  mail: Mail[]
  mailbox: Mailbox
  /** null = all inboxes. */
  mailAccount: string | null
  /** A file "Ask about this file" hands to the next new chat's composer (absolute path). */
  askAbout: string | null
  /** null until loaded. */
  settings: Settings | null
}

const MAIL_KEY = 'bridle.mail'

/** The last real mail, so a fresh window shows it while Gmail refreshes (sample mail, account '', isn't kept). */
function savedMail(): Mail[] {
  try {
    return JSON.parse(localStorage.getItem(MAIL_KEY) ?? '[]') as Mail[]
  } catch {
    return []
  }
}

const initial: AppState = {
  section: 'chat',
  chatId: null,
  settingsOpen: false,
  settingsPage: 'general',
  chats: [],
  working: [],
  homeChatId: null,
  accounts: [],
  mail: savedMail(),
  mailbox: 'Inbox',
  mailAccount: null,
  askAbout: null,
  settings: null
}

type Action =
  | { type: 'patch'; patch: Partial<AppState> }
  | { type: 'chat'; chat: Chat }
  | { type: 'reload'; chats: Chat[] }
  | { type: 'setting'; key: SettingKey; value: unknown }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch }
    case 'chat': {
      const i = state.chats.findIndex((c) => c.id === action.chat.id)
      const chats = i < 0 ? [action.chat, ...state.chats] : state.chats.map((c, j) => (j === i ? action.chat : c))
      return { ...state, chats }
    }
    // Disk wins, but a chat that's only in memory (just started, not saved yet) stays put.
    case 'reload': {
      const onDisk = new Set(action.chats.map((c) => c.id))
      return { ...state, chats: [...state.chats.filter((c) => !onDisk.has(c.id)), ...action.chats] }
    }
    case 'setting':
      return state.settings ? { ...state, settings: { ...state.settings, [action.key]: action.value } } : state
  }
}

export interface App {
  state: AppState
  /** Merge any UI state (section, mailbox, working…). */
  patch(patch: Partial<AppState>): void
  /** Insert or replace one chat in `chats` (doesn't save; call window.bridle.workspace.saveChat). */
  upsertChat(chat: Chat): void
  /** Go to a section, optionally opening a chat. */
  go(section: Section, chatId?: string | null): void
  openSettings(page?: SettingsPage): void
  /** Optimistically sets a preference and persists it through window.bridle.settings. */
  setSetting<K extends SettingKey>(key: K, value: Settings[K]): void
  /** Re-reads chats from the workspace. */
  reloadChats(): Promise<void>
}

const Context = createContext<App | null>(null)

export function useApp(): App {
  const app = useContext(Context)
  if (!app) throw new Error('useApp outside <AppProvider>')
  return app
}

/** The Home chat: the watcher's id, else by title. */
export function homeChat(state: AppState): Chat | undefined {
  return state.chats.find((c) => c.id === state.homeChatId) ?? state.chats.find((c) => HOME_TITLES.includes(c.title))
}

/** `initialState` seeds the store (tests, previews); the app passes nothing. */
export function AppProvider({ children, initialState }: { children: ReactNode; initialState?: Partial<AppState> }) {
  const [state, dispatch] = useReducer(reducer, { ...initial, ...initialState })

  const patch = useCallback((p: Partial<AppState>) => dispatch({ type: 'patch', patch: p }), [])
  const reloadChats = useCallback(async () => {
    dispatch({ type: 'reload', chats: await window.bridle.workspace.loadChats() })
  }, [])

  useEffect(() => {
    const api = window.bridle
    api.settings.all().then((settings) => patch({ settings }))
    void reloadChats()
    api.composio.accounts().then((accounts) => patch({ accounts }), () => {})
    api.watcher.homeChatId().then((homeChatId) => patch({ homeChatId }), () => {})
    const offs = [
      api.on('notify:opened', (p) => patch('chatId' in p ? { section: 'chat', chatId: p.chatId, settingsOpen: false } : { section: 'code', settingsOpen: false })),
      // The onboarding window wrote names and flags through settings: pick them up.
      api.on('onboarding:done', () => void api.settings.all().then((settings) => patch({ settings }))),
      api.on('watcher:home', ({ chatId }) => {
        patch({ homeChatId: chatId })
        play('attention') // Watcher.postHome: something in Home needs you
        void reloadChats()
      })
    ]
    return () => offs.forEach((off) => off())
  }, [patch, reloadChats])

  useEffect(() => {
    try {
      localStorage.setItem(MAIL_KEY, JSON.stringify(state.mail.filter((m) => m.account !== '')))
    } catch {
      // over quota: the next window just syncs from scratch
    }
  }, [state.mail])

  // Sound follows the settings.
  useEffect(() => {
    if (!state.settings) return
    setMuted(state.settings.soundMuted)
    setSoundVolume(state.settings.soundVolume)
  }, [state.settings?.soundMuted, state.settings?.soundVolume])

  const app = useMemo<App>(() => ({
    state,
    patch,
    reloadChats,
    upsertChat: (chat) => dispatch({ type: 'chat', chat }),
    go: (section, chatId) => patch(chatId === undefined ? { section } : { section, chatId }),
    openSettings: (page) => patch(page ? { settingsOpen: true, settingsPage: page } : { settingsOpen: true }),
    setSetting: (key, value) => {
      dispatch({ type: 'setting', key, value })
      void window.bridle.settings.set(key, value)
    }
  }), [state, patch, reloadChats])

  return <Context.Provider value={app}>{children}</Context.Provider>
}
