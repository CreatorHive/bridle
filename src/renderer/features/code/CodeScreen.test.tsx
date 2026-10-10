import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Chat, type Space, type Workspace } from '../../../shared/types'
import { AppProvider } from '../../app/store'
import { setState } from './store'
import { CodeScreen, CodeSidebar } from '.'

// Server-renders the screens (effects, and so window.bridle, don't run).
const settings = { ...DEFAULT_SETTINGS, onboarded: true, agentName: 'Ruby' }
const render = (node: JSX.Element) => renderToString(<AppProvider initialState={{ settings, section: 'code' }}>{node}</AppProvider>).replaceAll('<!-- -->', '')

const space: Space = { slug: 'bridle', name: 'Bridle', root: '/r/bridle', trusted: true, allowedCommands: [], engine: 'claude', trustAsked: true }
const w: Workspace = { id: 'bridle/lisbon', repo: 'bridle', name: 'lisbon', branch: 'bridle/lisbon', base: 'origin/main', title: 'Fix the tests', path: '/w/.bridle/worktrees/bridle/lisbon', created: '2026-10-09T08:00:00Z' }
const d = '2026-10-09T08:00:00Z'
const chat: Chat = {
  id: 'C1', title: 'Fix the tests', messages: [
    { id: 'u', role: 'user', text: 'fix the failing test', date: d },
    {
      id: 'a', role: 'assistant', text: 'Fixed **it**.', date: d, ended: '2026-10-09T08:01:05Z', trace: ['read a.ts', 'edit a.ts', 'bash npm test'],
      plan: '# Plan\nChange the assert', changes: [{ path: 'src/a.ts', added: 3, removed: 1 }],
      todos: [{ title: 'Find it', status: 'completed' }, { title: 'Fix it', status: 'in_progress' }],
      subagents: [{ id: 's1', name: 'Explorer', description: 'Look around', state: 'done', trace: [], startedAt: d, endedAt: d }]
    },
    { id: 'p', role: 'tool', text: 'npm test', date: d, action: { kind: 'permission', fields: { title: 'Run a command?', tool: 'Bash', input: '{"command":"npm test"}', rule: 'Bash(npm test:*)' } } },
    { id: 'r', role: 'assistant', text: '', date: d, status: 'Reading files' }
  ]
}

describe('Code screens', () => {
  it('asks for a repository first', () => {
    setState({ loaded: true, spaces: [], workspaces: [], selected: null })
    expect(render(<CodeScreen />)).toContain('Add a repository')
  })

  it('lays out a workspace: header, chat with every card, panel', () => {
    setState({
      loaded: true, spaces: [space], workspaces: [w], selected: w.id, chats: { [w.id]: [chat] },
      changes: { [w.id]: [{ path: 'src/a.ts', status: 'M', added: 3, removed: 1 }] },
      agents: { [w.id]: { workspaceId: w.id, running: true, runningChat: 'C1', planWaiting: null, pending: ['p'] } },
      benches: { [w.id]: { tab: { kind: 'chat' }, tabs: [{ kind: 'review' }], chatId: 'C1', draft: '', attachments: [], showChanges: true, bottom: 'setup', terms: [], term: null } }
    })
    const html = render(<CodeScreen />)
    for (const text of ['Bridle', 'Fix the tests', 'bridle/lisbon', 'Create PR', 'fix the failing test', '3 tool calls, 1 subagent',
      '<strong>it</strong>', 'Plan', 'Change the assert', 'Find it', '1 file changed', 'Run a command?', 'npm test', 'Always allow npm test',
      'Reading files', 'Review', 'Changes 1', 'Setup', 'Terminal', 'Opus']) expect(html, text).toContain(text)
  })

  it('lists repos and workspaces with their counts', () => {
    const html = render(<CodeSidebar />)
    for (const text of ['My workspaces', 'Bridle', 'Fix the tests', '+3', '−1']) expect(html, text).toContain(text)
  })
})
