import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Chat } from '../../../shared/types'
import { AppProvider, type AppState } from '../../app/store'
import { ChatScreen } from '.'

// Server-renders the screen (effects, and so window.bridle, don't run).
const settings = { ...DEFAULT_SETTINGS, onboarded: true, userName: 'Sean', agentName: 'Ruby' }
const render = (state: Partial<AppState>) =>
  renderToString(<AppProvider initialState={{ settings, ...state }}><ChatScreen /></AppProvider>)

describe('ChatScreen', () => {
  it('greets on a new chat, with the model and policy caption', () => {
    const html = render({ chatId: null })
    expect(html).toMatch(/Good (morning|afternoon|evening), Sean/)
    expect(html).toContain('Ask Ruby…')
    expect(html).toContain('Claude Opus')
    expect(html).toContain('Writes outside your workspace need approval.')
  })

  it('renders every kind of turn', () => {
    const d = '2026-10-09T08:00:00Z'
    const chat: Chat = {
      id: 'c', title: 'Plan', messages: [
        { id: '1', role: 'user', text: 'email Alex', files: ['/w/user/files/notes.pdf'], date: d },
        { id: '2', role: 'assistant', text: 'Drafted **it**.', trace: ['read notes/x.md'], date: d },
        { id: '3', role: 'tool', text: 'Hi Alex', date: d, action: { kind: 'email', fields: { to: 'Alex Kim <a@x.com>', subject: 'Hi' } } },
        { id: '4', role: 'tool', text: 'rm x', date: d, action: { kind: 'permission', fields: { title: 'Run a command?', tool: 'Bash', input: '{"command":"rm x"}' } } },
        { id: '5', role: 'tool', text: '', date: d, approved: true, action: { kind: 'task', fields: { title: 'Ship' } } },
        { id: '6', role: 'tool', text: 'gone', date: d, dismissed: true, approved: true, action: { kind: 'permission', fields: { title: 'Hidden?' } } },
        { id: '7', role: 'assistant', text: '', status: 'Reading files', date: d }
      ]
    }
    const html = render({ chats: [chat], chatId: 'c' })
    for (const text of ['email Alex', 'notes.pdf', '<strong>it</strong>', 'read notes/x.md', 'Send email to Alex?',
      'No Gmail connected', 'Run a command?', 'rm x', 'Expired', 'Added', 'Reading files']) expect(html, text).toContain(text)
    expect(html).not.toContain('Hidden?')
  })
})
