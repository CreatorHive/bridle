import { describe, expect, it, vi } from 'vitest'
import type { Chat, Mail, SearchHit, TaskItem } from '../../../shared/types'
import { chatFileId, hitResults, kindOf, linearResults, mailResults, matches, snippet } from './logic'

vi.mock('../../sound', () => ({ play: vi.fn() }))
const { viewer } = await import('../viewer/store')
const { FileViewer } = await import('../viewer')
const { openSearch, SearchPalette } = await import('.')
const { renderToString } = await import('react-dom/server')
const { AppProvider } = await import('../../app/store')
const { DEFAULT_SETTINGS } = await import('../../../shared/types')

const root = '/Users/me/Bridle'
const chat: Chat = { id: 'E5CD3195-118D-455B-B5AA-02543553417B', title: 'Launch plan', messages: [] }

describe('search results', () => {
  it('routes hits by where they live', () => {
    expect(chatFileId(`${root}/chats/e5cd3195-118d-455b-b5aa-02543553417b.jsonl`)).toBe('e5cd3195-118d-455b-b5aa-02543553417b')
    expect(kindOf(`${root}/goals/x/chats/a.jsonl`, root)).toBe('chat')
    expect(kindOf(`${root}/tasks/0f3c.md`, root)).toBe('task')
    expect(kindOf(`${root}/tasks/sub/x.md`, root)).toBe('file')
    expect(kindOf(`${root}/meetings/2026-10-09-sync.md`, root)).toBe('meeting')
    expect(kindOf(`${root}/notes/a.md`, root)).toBe('file')
  })

  it('keeps the best passage per file, names chats and tasks, and caps at ten', () => {
    const hits: SearchHit[] = [
      { path: `${root}/chats/e5cd3195-118d-455b-b5aa-02543553417b.jsonl`, line: 1, text: '# Launch plan\nYou: ship it' },
      { path: `${root}/notes/a.md`, line: 1, text: 'first' },
      { path: `${root}/notes/a.md`, line: 40, text: 'second' },
      { path: `${root}/tasks/0f3c.md`, line: 1, text: '---\nstatus: backlog\n---\n# Write the docs\n' },
      { path: `${root}/chats/unknown.jsonl`, line: 1, text: 'x' },
      { path: '/Users/me/code/app/main.ts', line: 3, text: 'linked' },
      ...Array.from({ length: 12 }, (_, i) => ({ path: `${root}/n${i}.md`, line: 1, text: '' }))
    ]
    const out = hitResults(hits, 'ship', root, [chat])
    expect(out).toHaveLength(10)
    expect(out[0]).toMatchObject({ kind: 'chat', title: 'Launch plan', detail: 'Chat', chatId: chat.id })
    expect(out[1]).toMatchObject({ kind: 'file', title: 'a.md', detail: 'notes/a.md', snippet: 'first' })
    expect(out[2]).toMatchObject({ kind: 'task', title: 'Write the docs', detail: 'Task' })
    expect(out[3]).toMatchObject({ kind: 'file', title: 'unknown.jsonl' })
    expect(out[4]).toMatchObject({ detail: '~/code/app/main.ts' })
  })

  it('matches mail and Linear issues on every word', () => {
    expect(matches('Quarterly invoice from Acme', 'acme invoice')).toBe(true)
    expect(matches('Quarterly invoice', 'acme invoice')).toBe(false)
    expect(matches('anything', ' ')).toBe(false)
    const mail = { id: 'm1', from: 'Alex', email: 'a@x.com', subject: 'Invoice', body: 'Acme owes', mailbox: 'Inbox' } as Mail
    expect(mailResults([mail], 'acme invoice')).toMatchObject([{ kind: 'mail', title: 'Invoice', detail: 'Alex', mail }])
    const issue = { id: 'linear:1', title: 'Fix login', notes: '', linear: { identifier: 'DUV-42' } } as TaskItem
    const mine = { id: 'abc', title: 'Fix login too', notes: '' } as TaskItem
    expect(linearResults([issue, mine], 'duv-42 login')).toMatchObject([{ key: 'linear:1', detail: 'DUV-42 · Linear' }])
  })

  it('cuts the snippet around the first matching word', () => {
    const s = snippet('a'.repeat(100) + ' needle ' + 'b'.repeat(300), 'the needle')
    expect(s.startsWith('…')).toBe(true)
    expect(s).toContain('needle')
    expect(s).toHaveLength(221)
    expect(snippet('one\ntwo', 'zzz')).toBe('one two')
  })
})

describe('viewer store', () => {
  it('keeps Back history only while browsing inside the viewer', () => {
    viewer.open('/w/notes')
    viewer.open('/w/notes/sub', '/w/notes')
    viewer.open('/w/notes/sub/a.md', '/w/notes/sub')
    expect(viewer.state).toEqual({ path: '/w/notes/sub/a.md', history: ['/w/notes', '/w/notes/sub'] })
    viewer.back()
    expect(viewer.state).toEqual({ path: '/w/notes/sub', history: ['/w/notes'] })
    viewer.open('/w/other.md') // opened from outside: history resets
    expect(viewer.state.history).toEqual([])
    viewer.back() // nothing to go back to
    expect(viewer.state.path).toBe('/w/other.md')
    viewer.close()
    expect(viewer.state).toEqual({ path: null, history: [] })
  })
})

describe('mounted components render', () => {
  const render = (node: JSX.Element) => renderToString(<AppProvider initialState={{ settings: DEFAULT_SETTINGS }}>{node}</AppProvider>)
  it('render nothing until opened, then the palette and the panel', () => {
    expect(render(<><SearchPalette /><FileViewer /></>)).toBe('')
    openSearch()
    expect(render(<SearchPalette />)).toContain('Search chats, notes and files')
    viewer.open('/w/notes/a.md')
    const panel = render(<FileViewer />)
    for (const t of ['a.md', '/w/notes', 'Open in default app', 'Show in Finder', 'Close']) expect(panel).toContain(t)
    viewer.close()
  })
})
