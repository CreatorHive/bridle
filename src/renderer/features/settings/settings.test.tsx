import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Account } from '../../../shared/types'
import { AppProvider, SETTINGS_PAGES, type AppState } from '../../app/store'
import { FilesScreen } from '../files'
import { Onboarding } from '../onboarding'
import { TasksBoard } from '../tasks'
import { currentStep, expiredOf, toolkitsOf } from './connections'
import { PAGES, shares } from './pages'

const google: Account = {
  id: 'google:you@example.com', service: 'google', login: 'you@example.com', photo: null,
  grants: [
    { id: 'ca_3', toolkit: 'googledrive', ok: true },
    { id: 'ca_1', toolkit: 'gmail', ok: true },
    { id: 'ca_2', toolkit: 'googlecalendar', ok: false },
    { id: 'ca_4', toolkit: 'googlecalendar', ok: false }
  ]
}

describe('connections logic', () => {
  it('orders toolkits in TOOLKITS order and finds the expired ones', () => {
    expect(toolkitsOf(google)).toEqual(['gmail', 'googlecalendar', 'googledrive'])
    expect(expiredOf(google)).toEqual(['googlecalendar'])
    expect(expiredOf({ ...google, grants: [...google.grants, { id: 'ca_5', toolkit: 'googlecalendar', ok: true }] })).toEqual([])
  })

  it('names the step the browser is on', () => {
    const p = { service: 'google' as const, account: null, steps: ['gmail', 'googlecalendar'] as const, done: 1 }
    expect(currentStep({ ...p, steps: [...p.steps] })).toBe('googlecalendar')
    expect(currentStep({ ...p, steps: [...p.steps], done: 2 })).toBe('googlecalendar')
  })

  it('splits storage by top-level folder, largest first', () => {
    expect(shares([])).toEqual([1])
    expect(shares([{ rel: 'chats/a.jsonl', size: 10 }, { rel: 'user/files/b', size: 30 }, { rel: 'chats/c', size: 10 }]))
      .toEqual([0.6, 0.4])
  })
})

// Server-render each screen (effects, and so window.bridle, don't run) to catch render-time crashes.
const settings = { ...DEFAULT_SETTINGS, onboarded: true, userName: 'Sean' }
const render = (node: JSX.Element, state: Partial<AppState> = {}) =>
  renderToString(<AppProvider initialState={{ settings, accounts: [google], ...state }}>{node}</AppProvider>)

describe('screens render', () => {
  it('renders the board, files and onboarding', () => {
    const board = render(<TasksBoard />)
    for (const t of ['All tasks', 'Backlog', 'In progress', 'Needs review', 'Done', 'Nothing here']) expect(board).toContain(t)
    const files = render(<FilesScreen />)
    for (const t of ['Files', 'Search files…', 'Drop files here', 'Spreadsheets', 'Recent files', 'Last opened', 'No files yet']) {
      expect(files).toContain(t)
    }
    expect(render(<Onboarding />)).toContain('Welcome to Bridle')
  })

  it('renders every settings page', () => {
    const expected: Record<string, string[]> = {
      general: ['Workspace', 'Keep the index fresh', 'Send test', 'Replay onboarding'],
      profile: ['Time zone', 'Open USER.md'],
      agent: ['Saved to IDENTITY.md', 'Saved to agent/avatar.png', 'Choose…', 'Open SOUL.md', 'Open MEMORY.md',
        'Bring your memory from ChatGPT or Claude Code', 'Copy and open ChatGPT', 'Claude Code', '2. Paste its answer', 'Import'],
      models: ['Answer with', 'Claude Code', 'Claude Opus', 'Stored in your Keychain', 'LM Studio server', 'On-device'],
      connections: ['Google', 'you@example.com', 'Reconnect', 'Add another Google account', 'Connect GitHub', 'Connect Linear',
        'Message me first', '8:00 AM', 'Meeting prep', 'Last check', 'Check now', 'Project API key'],
      tools: ['Writes outside the workspace', 'Always ask', 'Sending, scheduling, changing and deleting always ask first', 'New MCP Server'],
      automations: ['Routines', 'Loops'],
      storage: ['Zero KB', 'Search files', 'The workspace is empty.']
    }
    for (const page of SETTINGS_PAGES) {
      const Page = PAGES[page]
      const html = render(<Page />)
      for (const t of expected[page]) expect(html, `${page}: ${t}`).toContain(t.replace(/'/g, '&#x27;'))
    }
  })
})
