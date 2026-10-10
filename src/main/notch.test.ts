import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, BrowserWindow: { getAllWindows: () => [] } }))
const { NotchState } = await import('./notch')

const title = (id: string): string => `ws ${id}`

describe('NotchState', () => {
  it('follows a chat from working to waiting to done, and Code and Home rows', () => {
    const n = new NotchState()
    const chat = (event: unknown): void => n.hear('agent:event', { chatId: 'c1', event }, title)
    n.run('c1', '\n  Fix the build please\nmore')
    chat({ type: 'session', session: 's' })
    chat({ type: 'status', status: 'Reading files' })
    chat({ type: 'text', text: 'hi' })
    expect(n.items.get('chat:c1')).toEqual({ key: 'chat:c1', title: 'Fix the build please', detail: 'Reading files', waiting: false })

    chat({ type: 'permission', request: { requestId: 'r', tool: 'Bash', title: 'Run a command?', detail: 'npm test', input: {}, agentID: null } })
    expect(n.items.get('chat:c1')).toMatchObject({ title: 'Run a command?', waiting: true })
    chat({ type: 'trace', line: 'ran' })
    expect(n.items.get('chat:c1')).toMatchObject({ title: 'Fix the build please', waiting: false })
    chat({ type: 'done' })
    expect(n.items.has('chat:c1')).toBe(false)

    const code = (a: object): void => n.hear('code:agent', { workspaceId: 'r/x', running: false, runningChat: null, planWaiting: null, pending: [], ...a }, title)
    code({ running: true })
    expect(n.items.get('code:r/x')).toMatchObject({ title: 'ws r/x', detail: 'Working', waiting: false })
    code({ running: true, pending: ['m'] })
    expect(n.items.get('code:r/x')).toMatchObject({ detail: 'Needs your approval', waiting: true })
    code({})
    expect(n.items.has('code:r/x')).toBe(false)

    n.hear('watcher:home', { chatId: 'h' }, title)
    expect(n.items.get('home:h')?.waiting).toBe(true)
    n.seen()
    expect(n.items.size).toBe(0)
    expect(n.pulse).toBe(3) // the permission, the Code approval, Home
  })
})
