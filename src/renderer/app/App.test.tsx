import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { App, Root } from './App'
import { SECTIONS, type AppState, type Section } from './store'

// Smoke test of the shell without Electron: server-render it in each state. Effects (and so
// window.bridle) don't run under renderToString.
const settings = { ...DEFAULT_SETTINGS, onboarded: true, userName: 'Sean' }
const render = (state: Partial<AppState>) => renderToString(<App initialState={{ settings, ...state }} />)

describe('shell', () => {
  it('renders every section with its screen and sidebar branch', () => {
    const expected: Record<Section, string[]> = {
      chat: ['New chat', 'Recent', 'Ask Bridle'],
      board: ['Views', 'All tasks', 'Backlog', 'Needs review'],
      calendar: ['Calendars'],
      meetings: ['No meetings coming up'],
      mail: ['Views', 'Inbox', 'Trash'],
      files: ['Library', 'Drive', 'Recent'],
      code: ['My workspaces']
    }
    for (const section of SECTIONS) {
      const html = render({ section })
      expect(html).toContain('Home')
      for (const text of expected[section]) expect(html, `${section}: ${text}`).toContain(text)
    }
  })

  it('lists recent chats but not Home, and titles the open chat', () => {
    const chats = [
      { id: 'h', title: 'Home', messages: [] },
      { id: 'a', title: 'Trip planning', messages: [] }
    ]
    const html = render({ chats, chatId: 'a' })
    expect(html).toContain('<h1>Trip planning</h1>')
    expect(html.match(/>Home</g)).toHaveLength(1) // only the pinned row
  })

  it('opens settings over the shell, never onboarding (that has its own window)', () => {
    expect(render({ settingsOpen: true, settingsPage: 'connections' })).toContain('<h2>Connections</h2>')
    expect(render({ settings: { ...settings, onboarded: false } })).not.toContain('Welcome to Bridle')
  })

  it('routes #onboarding to the onboarding alone, once settings are loaded', () => {
    const root = (hash: string, state: Partial<AppState>) => renderToString(<Root hash={hash} initialState={state} />)
    const onboarding = root('#onboarding', { settings: { ...settings, onboarded: false } })
    expect(onboarding).toContain('Welcome to Bridle')
    expect(onboarding).not.toContain('Recent')
    expect(root('#onboarding', { settings: null })).toBe('')
    expect(root('', { settings })).toContain('Recent')
  })
})
