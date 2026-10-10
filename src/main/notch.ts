import { app, BrowserWindow } from 'electron'
import type { BridleEvents } from '../shared/api'
import type { CodeAgentState } from '../shared/types'
import { emit, onEmit } from './events'
import { Helper, helperPath } from './native/helper'
import { loadWorkspaces } from './code/spaces'

// The notch (native/BridleHelper/Sources/bridle-notch): one row per chat or Code workspace whose agent is
// working or waiting on you, plus "New in Home". Fed from the event bus; a click opens that chat or workspace.

export interface NotchItem {
  key: string
  title: string
  detail?: string
  waiting: boolean
}

const clip = (s: string, n = 60): string => {
  const line = s.split('\n').find((l) => l.trim())?.trim() ?? ''
  return line.length > n ? `${line.slice(0, n - 1)}…` : line
}

/** Which rows the notch shows, from the events it hears. `pulse` counts arrivals that want your eyes. */
export class NotchState {
  items = new Map<string, NotchItem>()
  pulse = 0
  private titles = new Map<string, string>()

  /** agent.run's prompt names the chat's row. */
  run(chatId: string, prompt: string): void {
    this.titles.set(chatId, clip(prompt) || 'Replying')
  }

  hear(event: keyof BridleEvents, payload: unknown, workspaceTitle: (id: string) => string): void {
    if (event === 'agent:event') {
      const { chatId, event: e } = payload as BridleEvents['agent:event']
      const key = `chat:${chatId}`
      const title = this.titles.get(chatId) ?? 'Replying'
      if (e.type === 'done' || e.type === 'error') {
        this.items.delete(key)
        this.titles.delete(chatId)
      } else if (e.type === 'permission') {
        this.items.set(key, { key, title: e.request.title, detail: e.request.detail, waiting: true })
        this.pulse++
      } else if (e.type === 'status') {
        this.items.set(key, { key, title, detail: e.status, waiting: false })
      } else if (this.items.get(key)?.waiting !== false) {
        // Any other event means it's working, including after a permission was answered.
        this.items.set(key, { key, title, waiting: false })
      }
    } else if (event === 'code:agent') {
      const a = payload as CodeAgentState
      const key = `code:${a.workspaceId}`
      const detail = a.planWaiting ? 'Plan ready to review' : a.pending.length ? 'Needs your approval' : a.running ? 'Working' : null
      if (!detail) return void this.items.delete(key)
      const waiting = detail !== 'Working'
      if (waiting && !this.items.get(key)?.waiting) this.pulse++
      this.items.set(key, { key, title: workspaceTitle(a.workspaceId), detail, waiting })
    } else if (event === 'watcher:home') {
      const { chatId } = payload as BridleEvents['watcher:home']
      for (const k of this.items.keys()) if (k.startsWith('home:')) this.items.delete(k)
      this.items.set(`home:${chatId}`, { key: `home:${chatId}`, title: 'New in Home', detail: 'Bridle wrote to you', waiting: true })
      this.pulse++
    }
  }

  /** Bridle's window came forward: Home's news has been seen. */
  seen(): void {
    for (const k of this.items.keys()) if (k.startsWith('home:')) this.items.delete(k)
  }
}

const state = new NotchState()
const notch = new Helper(() => {
  const path = helperPath('bridle-notch')
  return path ? { command: path } : null
})
const workspaceTitles = new Map<string, string>()
let sent = '[]'

/** Called by agent.run, so a chat's row is named after what you asked. */
export const noteRun = (chatId: string, prompt: string): void => state.run(chatId, prompt)

function publish(): void {
  const items = [...state.items.values()]
  const json = JSON.stringify(items)
  if (json === sent || !notch.available()) return
  sent = json
  notch.request('scene', { items, pulse: state.pulse }).catch((e: Error) => console.warn('[notch]', e.message))
}

function open(key: string): void {
  app.focus({ steal: true })
  BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('#'))?.show() // the main window
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
  if (kind === 'code') emit('notify:opened', { workspaceId: id })
  else emit('notify:opened', { chatId: id })
}

/** macOS only; a missing bridle-notch (not built) just means no notch. */
export function startNotch(): void {
  if (process.platform !== 'darwin') return
  onEmit((event, payload) => {
    if (event === 'code:agent') {
      // Name the row now; the workspace's title arrives a moment later if it isn't cached yet.
      const id = (payload as CodeAgentState).workspaceId
      if (!workspaceTitles.has(id)) {
        void loadWorkspaces().then((ws) => {
          for (const w of ws) workspaceTitles.set(w.id, w.title === 'New workspace' ? w.name : w.title)
          const item = state.items.get(`code:${id}`)
          if (item && workspaceTitles.has(id)) item.title = workspaceTitles.get(id)!
          publish()
        }, () => {})
      }
    }
    state.hear(event, payload, (id) => workspaceTitles.get(id) ?? id.split('/').pop() ?? id)
    publish()
  })
  notch.onEvent((e) => {
    if (e.event === 'open' && typeof e.key === 'string') open(e.key)
    if (e.event === 'exit') sent = '[]' // the next change starts it again with the whole scene
  })
  app.on('browser-window-focus', () => {
    state.seen()
    publish()
  })
  app.on('before-quit', () => notch.stop())
}
