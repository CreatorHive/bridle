import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Account, type Chat, type Mail, type Message } from '../../../shared/types'
import {
  cardInfo, cleanError, contactsLine, extractActions, greeting, leaves, mergeChat, modelChoice, needsTitle,
  now, relativePath, mentionedFiles, sortedJSON, traceTarget, trimDiff, uuid, watcherTurn
} from './logic'

const msg = (role: Message['role'], text: string, extra: Partial<Message> = {}): Message =>
  ({ id: uuid(), role, text, date: '2026-10-09T08:00:00Z', ...extra })

describe('watcherTurn', () => {
  it('quotes watcher posts since your last turn and summarizes their sources', () => {
    const history = [
      msg('user', 'old'),
      msg('assistant', 'reply to old'),
      msg('assistant', 'Dana asked about the deck. Want me to reply?', { source: 'gmail: Dana, "Deck"' }),
      msg('assistant', 'Standup in 10 min.', { source: 'calendar: Standup' })
    ]
    const { turn, alert } = watcherTurn(history, 'yeah')
    expect(turn).toBe('[Earlier in this chat, you (Bridle) wrote to the user first:\n'
      + '«Dana asked about the deck. Want me to reply?»\n\n«Standup in 10 min.»\n\n'
      + 'The user\'s reply below answers that.]\n\nyeah')
    expect(alert).toBe('You (Bridle) messaged the user first about:\n- gmail: Dana, "Deck"\n- calendar: Standup\n'
      + 'Their message answers yours. Take the next step you offered, using the Composio tools. '
      + 'Anything that sends or changes something goes through an approval card.')
  })

  it('ignores posts you already answered, and plain replies', () => {
    const history = [msg('assistant', 'w', { source: 's' }), msg('user', 'ok'), msg('assistant', 'done')]
    expect(watcherTurn(history, 'next')).toEqual({ turn: 'next', alert: null })
    expect(watcherTurn([], 'hi')).toEqual({ turn: 'hi', alert: null })
  })
})

describe('extractActions', () => {
  it('pulls bridle blocks out of the reply as actions', () => {
    const text = 'Here you go.\n\n```bridle:email\n{"to": "Alex <a@x.com>", "subject": "Hi", "body": "Yo", "n": 2}\n```\n'
      + '```bridle:task\n{"title": "Ship it", "linear": true}\n```'
    const { text: clean, actions } = extractActions(text)
    expect(clean).toBe('Here you go.')
    expect(actions).toEqual([
      { kind: 'email', fields: { to: 'Alex <a@x.com>', subject: 'Hi', body: 'Yo', n: '2' } },
      { kind: 'task', fields: { title: 'Ship it', linear: 'true' } }
    ])
  })

  it('hides a half-streamed block and drops malformed ones', () => {
    expect(extractActions('Sure.\n```bridle:event\n{"title": "Lun')).toEqual({ text: 'Sure.', actions: [] })
    expect(extractActions('A ```bridle:email\nnot json\n``` B')).toEqual({ text: 'A  B', actions: [] })
    expect(extractActions('plain')).toEqual({ text: 'plain', actions: [] })
  })
})

describe('cardInfo', () => {
  it('titles and rows per kind', () => {
    const email = cardInfo(msg('tool', 'body', { action: { kind: 'email', fields: { to: 'Alex Kim <a@x.com>', subject: 'S', from: 'b@y.com' } } }), ['me@x.com'])
    expect(email.title).toBe('Send email to Alex?')
    expect(email.rows).toEqual([['To', 'Alex Kim <a@x.com>'], ['Subject', 'S']])
    expect(email.sender).toBe('me@x.com') // not one of yours → your first Gmail
    expect([email.confirm, email.done]).toEqual(['Send', 'Sent'])

    const task = cardInfo(msg('tool', '', { action: { kind: 'task', fields: { title: 'Fix', status: 'In Progress', linear: 'yes' } } }), [])
    expect(task.title).toBe('Add “Fix” as a task?')
    expect(task.rows).toEqual([['Column', 'In progress'], ['Linear', 'Also create an issue assigned to you']])
    expect([task.confirm, task.done]).toEqual(['Add task', 'Added'])

    const event = cardInfo(msg('tool', '', { action: { kind: 'event', fields: { title: 'Lunch', start: '12:00', end: '13:00' } } }), [])
    expect(event.rows).toEqual([['When', '12:00 – 13:00']])

    const perm = cardInfo(msg('tool', 'ls', { action: { kind: 'permission', fields: { title: 'Run a command?', tool: 'Bash' } } }), [])
    expect([perm.title, perm.confirm, perm.done, perm.rows.length]).toEqual(['Run a command?', 'Allow', 'Allowed', 0])
    expect(cardInfo(msg('tool', 'x'), []).title).toBe('Approve this?')
  })
})

describe('permission helpers', () => {
  it('leaves flattens nested Composio arguments by their last key', () => {
    expect(leaves({ tool_slug: 'GITHUB_CREATE_ISSUE', arguments: { repo: 'bridle', labels: ['a', 'b'], n: 3 } }))
      .toEqual([{ key: 'labels', value: 'a, b' }, { key: 'n', value: '3' }, { key: 'repo', value: 'bridle' }, { key: 'tool_slug', value: 'GITHUB_CREATE_ISSUE' }])
    expect(leaves({ tools: [{ a: 1 }, { a: 2 }] })).toEqual([{ key: 'a', value: '1' }, { key: 'a', value: '2' }])
  })

  it('trimDiff keeps only the changed middle', () => {
    expect(trimDiff(['a', 'b', 'c', 'd'], ['a', 'x', 'y', 'd'])).toEqual([['b', 'c'], ['x', 'y']])
    expect(trimDiff([], ['new'])).toEqual([[], ['new']])
    expect(trimDiff(['same'], ['same'])).toEqual([[], []])
  })

  it('sortedJSON sorts keys at every level', () => {
    expect(sortedJSON({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 2 } })).toBe('{"a":{"c":2,"d":[{"y":2,"z":1}]},"b":1}')
  })
})

describe('small helpers', () => {
  it('greets by time of day', () => {
    expect(greeting(3, 'Sean')).toBe('Good evening, Sean')
    expect(greeting(9, '')).toBe('Good morning')
    expect(greeting(14, 'Sean')).toBe('Good afternoon, Sean')
    expect(greeting(20, '')).toBe('Good evening')
  })

  it('labels the model from the provider settings', () => {
    expect(modelChoice(DEFAULT_SETTINGS).label).toBe('Claude Opus')
    const or = modelChoice({ ...DEFAULT_SETTINGS, provider: 'OpenRouter' })
    expect([or.key, or.value, or.label]).toEqual(['openRouterModel', 'anthropic/claude-sonnet-5.5', 'claude-sonnet-5.5'])
    expect(modelChoice({ ...DEFAULT_SETTINGS, provider: 'Local', localModel: 'qwen' }).models).toEqual(['qwen'])
    expect(modelChoice({ ...DEFAULT_SETTINGS, provider: 'Mock' }).key).toBeNull()
  })

  it('lists inbox contacts once and your Gmail accounts', () => {
    const mail = (from: string, email: string, mailbox: Mail['mailbox'] = 'Inbox') => ({ from, email, mailbox }) as Mail
    const accounts = [{ login: 'me@x.com', grants: [{ id: 'ca', toolkit: 'gmail', ok: true }] }] as Account[]
    expect(contactsLine([mail('Dana', 'd@x.com'), mail('Dana', 'd@x.com'), mail('Sent', 's@x.com', 'Sent')], accounts))
      .toBe('Contacts: Dana <d@x.com>\nThe user\'s Gmail accounts (for "from"): me@x.com')
    expect(contactsLine([], [])).toBe('Contacts: ')
  })

  it('paths, trace targets, errors, ids', () => {
    expect(relativePath('/Users/s/Bridle/user/files/a.pdf', '/Users/s/Bridle')).toBe('user/files/a.pdf')
    expect(relativePath('/tmp/a.pdf', '/Users/s/Bridle')).toBe('/tmp/a.pdf')
    expect(traceTarget('read notes/x.md')).toBe('notes/x.md')
    expect(mentionedFiles('It\'s `user/files/A Doc.docx` (41 KB), in `goals/x/` beside `SOURCES.md` and `user/files/A Doc.docx`'))
      .toEqual(['user/files/A Doc.docx', 'SOURCES.md'])
    expect(traceTarget('searched workspace · 6 results')).toBeNull()
    expect(cleanError(new Error("Error invoking remote method 'agent:run': Error: not implemented: agent.run"))).toBe('not implemented: agent.run')
    expect(uuid()).toMatch(/^[0-9A-F-]{36}$/)
    expect(now()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
  })

  it('needsTitle only while titled with an answered first message', () => {
    const chat: Chat = { id: 'c', title: 'what is unidesk', messages: [msg('user', 'what is unidesk'), msg('assistant', 'A tool.')] }
    expect(needsTitle(chat)).toBe(true)
    expect(needsTitle({ ...chat, title: 'UniDesk' })).toBe(false)
    expect(needsTitle({ ...chat, messages: chat.messages.slice(0, 1) })).toBe(false)
  })

  it('mergeChat keeps the live copy and adds turns only the disk has', () => {
    const live = msg('assistant', '', { status: 'Thinking' })
    const posted = msg('assistant', 'FYI', { source: 's' })
    const ours: Chat = { id: 'h', title: 'Home', messages: [live] }
    expect(mergeChat(ours, { id: 'h', title: 'Home', messages: [posted] }).messages).toEqual([live, posted])
  })
})

describe('chatFilePath', () => {
  it('finds the JSONL a chat is saved to', async () => {
    const { chatFilePath } = await import('./logic')
    const id = 'A1B2C3D4-0000-4000-8000-00000000000F'
    expect(chatFilePath({ id, title: 'x', messages: [] }, '/w/')).toBe('/w/chats/a1b2c3d4-0000-4000-8000-00000000000f.jsonl')
    expect(chatFilePath({ id, title: 'x', messages: [], project: 'launch' }, '/w')).toBe('/w/goals/launch/chats/a1b2c3d4-0000-4000-8000-00000000000f.jsonl')
    expect(chatFilePath({ id: 'c', title: 'x', messages: [] }, '/w')).toBeNull()
  })
})
