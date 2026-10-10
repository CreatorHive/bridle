import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Chat, TaskItem } from '../../shared/types'

// Pure logic. No network, no CLI, no defaults/Keychain.
vi.mock('electron', () => ({ app: {}, shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] } }))

const { decodeChat, encodeChat, encodeTurn, freeName, isSystem, projectDir, scan, slug, swiftUUID, walksInto, within } = await import('./workspace')
const { parseTask, taskMarkdown, linearStatus, targetState, issueItem, linearDetail } = await import('./tasks')
const { parseSender, plainText, findPart, toMail, toEvent, tidy, group, decodeEntities } = await import('./composio')
const { alwaysAsk, allows, readOnly, describe: describeTool, workspaceEdit, trace, cleanTitle, bootstrap } = await import('./agent')
const { coerce } = await import('./settings')
const { dotenv } = await import('./keychain')

describe('chat JSONL', () => {
  // Lines exactly as stored on disk (sorted keys, unescaped slashes, ISO-8601 dates).
  const swiftFile = [
    '{"id":"E5CD3195-118D-455B-B5AA-02543553417B","session_id":"897975cf-7a42-4f8a-96a4-f12f87560edb","title":"what up bridle"}',
    '{"content":"what up bridle","created_at":"2026-10-09T20:22:08Z","files":["file:///Users/me/Bridle/user/files/My%20Notes.pdf"],"role":"user","trace":[],"turn_id":"8F601DA5-C34F-4026-BA81-697B87012ED7"}',
    '{"content":"Hey! See https://example.com/a/b","created_at":"2026-10-09T20:22:15Z","files":[],"role":"assistant","source":"mail","trace":["read USER.md","bash ls"],"turn_id":"1A2B3C4D-0000-4000-8000-000000000001"}',
    '{"action":{"fields":{"subject":"Hi","to":"Alex <a@b.c>"},"kind":"email"},"approved":true,"confirm":"Send","content":"","created_at":"2026-10-09T20:22:16Z","files":[],"icon":"envelope","role":"tool","title":"Send this email?","trace":[],"turn_id":"1A2B3C4D-0000-4000-8000-000000000002"}',
    ''
  ].join('\n')

  it.skipIf(process.platform === 'win32')('reads a stored chat file and writes it back byte for byte', () => {
    const chat = decodeChat(swiftFile) as Chat
    expect(chat.id).toBe('E5CD3195-118D-455B-B5AA-02543553417B')
    expect(chat.sessionID).toBe('897975cf-7a42-4f8a-96a4-f12f87560edb')
    expect(chat.messages).toHaveLength(3)
    expect(chat.messages[0].files).toEqual(['/Users/me/Bridle/user/files/My Notes.pdf'])
    expect(chat.messages[2].action?.fields.to).toBe('Alex <a@b.c>')
    expect(encodeChat(chat)).toBe(swiftFile)
  })

  it('writes the on-disk format: uppercase UUIDs, whole-second dates, no live-only fields, no nils', () => {
    const line = encodeTurn({
      id: 'abcdef01-2345-4678-89ab-cdef01234567', role: 'assistant', text: 'a/b', date: '2026-10-09T14:03:11.456Z',
      workers: ['x'], title: null, dismissed: undefined, approved: false
    })
    expect(line).toBe('{"approved":false,"content":"a/b","created_at":"2026-10-09T14:03:11Z","files":[],"role":"assistant","trace":[],"turn_id":"ABCDEF01-2345-4678-89AB-CDEF01234567"}')
  })

  it('skips turns still being written, drops undecodable lines, and makes non-UUID ids valid', () => {
    const chat: Chat = {
      id: 'chat-1', title: 'T', messages: [
        { id: 'm1', role: 'user', text: 'hi', date: '2026-10-09T14:03:11Z' },
        { id: 'm2', role: 'assistant', text: '', date: '2026-10-09T14:03:12Z', status: 'Thinking' }
      ]
    }
    const text = encodeChat(chat)
    expect(text.trim().split('\n')).toHaveLength(2)
    expect(swiftUUID('chat-1')).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-A[0-9A-F]{3}-[0-9A-F]{12}$/)
    expect(swiftUUID('chat-1')).toBe(swiftUUID('chat-1'))
    expect(decodeChat(text + '{"broken\n')?.messages).toHaveLength(1)
    expect(decodeChat('not json')).toBeNull()
  })

  it('keeps a project inside goals/: an existing folder by name, never a path', () => {
    expect(projectDir('/', 'tmp')).toBe('tmp') // /goals/tmp doesn't exist: slugged
    expect(projectDir('/tmp', '..')).toBe('')
    expect(projectDir('/tmp/x', '../..')).toBe('')
  })

  it('slugs names to lowercase-hyphenated', () => {
    expect(slug('Launch Bridle v0.1')).toBe('launch-bridle-v0-1')
    expect(slug('  Café — Plans!  ')).toBe('café-plans')
  })
})

describe('files and uploads', () => {
  it('classifies system files', () => {
    expect(isSystem('chats/x.jsonl')).toBe(true)
    expect(isSystem('goals/p/chats/x.txt')).toBe(true)
    expect(isSystem('.bridle/linear.json')).toBe(true)
    expect(isSystem('memory/2026-10-09.md')).toBe(true)
    expect(isSystem('USER.md')).toBe(true)
    expect(isSystem('goals/p/GOAL.md')).toBe(true)
    expect(isSystem('user/files/log.jsonl')).toBe(true)
    expect(isSystem('user/files/report.pdf')).toBe(false)
    expect(isSystem('goals/p/files/notes-draft.md')).toBe(false)
  })

  it('walks the right folders and caps the scan', async () => {
    expect(walksInto('node_modules')).toBe(false)
    expect(walksInto('.git')).toBe(false)
    expect(walksInto('.cache')).toBe(false)
    expect(walksInto('.bridle')).toBe(true)
    expect(walksInto('Deck.key')).toBe(false)
    const root = mkdtempSync(join(tmpdir(), 'bridle-scan-'))
    for (const p of ['user/files/a.pdf', 'chats/c.jsonl', 'node_modules/x/y.js', '.git/HEAD', '.bridle/watch.json', '.DS_Store', 'USER.md']) {
      mkdirSync(join(root, p, '..'), { recursive: true })
      writeFileSync(join(root, p), 'x')
    }
    const files = await scan(root)
    expect(files.map((f) => [f.name, f.system, f.kind]).sort()).toEqual([
      ['USER.md', true, 'documents'], ['a.pdf', false, 'pdfs'], ['c.jsonl', true, 'other'], ['watch.json', true, 'other']
    ])
    expect(await scan(root, 2)).toHaveLength(2)
  })

  it('names uploads "name 2.ext" on a clash', () => {
    const taken = new Set([join('/w/f', 'a.pdf'), join('/w/f', 'a 2.pdf')])
    expect(freeName('/w/f', '/src/a.pdf', (p) => taken.has(p))).toBe(join('/w/f', 'a 3.pdf'))
    expect(freeName('/w/f', '/src/b', (p) => taken.has(p))).toBe(join('/w/f', 'b'))
  })
})

describe('tasks', () => {
  const task: TaskItem = { id: 'abc', title: 'Ship it', notes: 'Line one\n\nLine two', status: 'needs review', tags: ['a', 'b'], updated: '2026-10-09T14:03:11Z' }

  it('writes front matter in the stored format', () => {
    expect(taskMarkdown(task)).toBe('---\nstatus: needs review\ntags: a, b\nupdated: 2026-10-09T14:03:11Z\n---\n# Ship it\n\nLine one\n\nLine two\n')
    expect(taskMarkdown({ ...task, tags: [], notes: '' })).toBe('---\nstatus: needs review\nupdated: 2026-10-09T14:03:11Z\n---\n# Ship it\n')
  })

  it('parses what it writes, and tolerates junk', () => {
    expect(parseTask(taskMarkdown(task), 'abc')).toEqual(task)
    const now = new Date('2026-01-01T00:00:00Z')
    expect(parseTask('just text', 'x', now)).toEqual({ id: 'x', title: 'x', notes: '', status: 'backlog', tags: [], updated: '2026-01-01T00:00:00Z' })
    expect(parseTask('---\nstatus: weird\nnope\n---\n# T\nbody', 'x', now).status).toBe('backlog')
  })

  it('maps Linear states to columns and back', () => {
    expect(linearStatus('completed', 'Done')).toBe('done')
    expect(linearStatus('started', 'In Review')).toBe('needs review')
    expect(linearStatus('started', 'In Progress')).toBe('in progress')
    expect(linearStatus('unstarted', 'Todo')).toBe('backlog')
    const states = [
      { id: 'b', name: 'Backlog', type: 'backlog', position: 0 },
      { id: 't', name: 'Todo', type: 'unstarted', position: 1 },
      { id: 'r', name: 'In Review', type: 'started', position: 3 },
      { id: 'p', name: 'In Progress', type: 'started', position: 2 },
      { id: 'd', name: 'Done', type: 'completed', position: 4 }
    ]
    expect(targetState(states, 'backlog')?.id).toBe('t')
    expect(targetState(states, 'in progress')?.id).toBe('p')
    expect(targetState(states, 'needs review')?.id).toBe('r')
    expect(targetState(states, 'done')?.id).toBe('d')
    expect(targetState(states.filter((s) => s.id !== 'r'), 'needs review')?.id).toBe('p')
  })

  it('turns an issue into a TaskItem and a detail', () => {
    const item = issueItem({
      id: 'i1', identifier: 'DUV-42', title: 'Fix', description: 'd', url: 'https://linear.app/x', updatedAt: '2026-10-09T14:03:11.123Z',
      state: { name: 'In Review', type: 'started' }, team: { id: 'tm', name: 'Duval' }, labels: { nodes: [{ name: 'bug' }] }, project: { name: 'Bridle' }
    }, 'ca_1')
    expect(item).toMatchObject({ id: 'linear:i1', status: 'needs review', tags: ['Bridle', 'bug'], updated: '2026-10-09T14:03:11Z' })
    expect(item?.linear).toEqual({ id: 'i1', identifier: 'DUV-42', url: 'https://linear.app/x', teamID: 'tm', team: 'Duval', state: 'In Review', grant: 'ca_1' })
    const d = linearDetail({ priorityLabel: 'No priority', cycle: { number: 3 }, comments: { nodes: [
      { body: 'b', createdAt: '2026-10-02T00:00:00Z', user: { name: 'B' } }, { body: 'a', createdAt: '2026-10-01T00:00:00Z' }] } })
    expect(d.priority).toBeNull()
    expect(d.cycle).toBe('Cycle 3')
    expect(d.comments.map((c) => c.author)).toEqual(['Someone', 'B'])
  })
})

describe('gmail + calendar', () => {
  it('parses senders', () => {
    expect(parseSender('"Alex Carter" <alex@carta.dev>')).toEqual({ name: 'Alex Carter', email: 'alex@carta.dev' })
    expect(parseSender('<a@b.c>')).toEqual({ name: 'a@b.c', email: 'a@b.c' })
    expect(parseSender('a@b.c')).toEqual({ name: 'a@b.c', email: 'a@b.c' })
  })

  it('reads MIME parts and plain text', () => {
    const payload = { mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/plain', body: { data: Buffer.from('Hi there').toString('base64url') } },
      { mimeType: 'text/html', body: { data: Buffer.from('<p>Hi&nbsp;<b>there</b></p>').toString('base64url') } }] }
    expect(findPart(payload, 'text/html')).toBe('<p>Hi&nbsp;<b>there</b></p>')
    expect(plainText('<html><head><style>x{}</style></head><body><div>A &amp; B</div><div>C</div></body></html>')).toBe('A & B\nC')
    expect(decodeEntities('&lt;a&gt; &amp;amp;')).toBe('<a> &amp;')
    const mail = toMail({ messageId: 'm1', sender: 'Al <al@x.com>', subject: '', messageText: '<div>html only</div>', messageTimestamp: '2026-10-08T10:00:00Z',
      labelIds: ['UNREAD', 'STARRED', 'SENT'], preview: { body: 'it&#39;s' } }, 'Starred', 'me@x.com', new Date('2026-10-09T12:00:00Z'))
    expect(mail).toMatchObject({ id: 'm1', from: 'Al', subject: '(no subject)', body: 'html only', html: '<div>html only</div>', unread: true,
      starred: true, mailbox: 'Sent', time: 'Oct 8', snippet: "it's", date: '2026-10-08T10:00:00Z' })
  })

  it('decodes calendar events', () => {
    expect(toEvent({ id: 'x', status: 'cancelled', start: { dateTime: '2026-10-09T10:00:00Z' }, end: { dateTime: '2026-10-09T11:00:00Z' } }, 'a', 'g')).toBeNull()
    const e = toEvent({
      id: 'e1', summary: 'Sync', start: { dateTime: '2026-10-09T10:00:00-04:00' }, end: { dateTime: '2026-10-09T10:30:00-04:00' },
      description: 'Agenda<br>____<br><br><br>Notes', hangoutLink: 'https://meet.google.com/abc',
      conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://zoom.us/j/1', meetingCode: '1', passcode: '2' }], conferenceSolution: { name: 'Zoom' } },
      attendees: [{ email: 'me@x.com', self: true, responseStatus: 'accepted' }, { displayName: 'no email' }]
    }, 'me@x.com', 'g1')
    expect(e).toMatchObject({ start: '2026-10-09T14:00:00Z', end: '2026-10-09T14:30:00Z', allDay: false, notes: 'Agenda\n\nNotes',
      meeting: { url: 'https://zoom.us/j/1', name: 'Zoom', code: 'ID 1 · Passcode 2' } })
    expect(e?.guests).toEqual([{ email: 'me@x.com', name: null, status: 'accepted', organizer: false, me: true }])
    const allDay = toEvent({ id: 'd', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } }, 'a', 'g')
    expect(allDay?.allDay).toBe(true)
    expect(new Date(allDay!.start).getDate()).toBe(9)
    expect(tidy('a\n----\n\n\n\nb')).toBe('a\n\nb')
  })

  it('groups grants into accounts', () => {
    const accounts = group([
      { id: 'g1', status: 'ACTIVE', toolkit: { slug: 'gmail' }, state: { val: { displayName: 'me@x.com' } } },
      { id: 'g2', status: 'ACTIVE', toolkit: { slug: 'googlecalendar' }, alias: 'me@x.com' },
      { id: 'g3', status: 'EXPIRED', toolkit: { slug: 'googledrive' }, alias: 'me@x.com' },
      { id: 'g4', status: 'INITIATED', toolkit: { slug: 'github' } },
      { id: 'g5', status: 'ACTIVE', toolkit: { slug: 'slack' } },
      { id: 'g6', status: 'ACTIVE', toolkit: { slug: 'linear' }, is_disabled: true }
    ])
    expect(accounts).toEqual([
      { id: 'google:me@x.com', service: 'google', login: 'me@x.com', grants: [
        { id: 'g1', toolkit: 'gmail', ok: true }, { id: 'g2', toolkit: 'googlecalendar', ok: true }, { id: 'g3', toolkit: 'googledrive', ok: false }] },
      { id: 'linear:g6', service: 'linear', login: 'g6', grants: [{ id: 'g6', toolkit: 'linear', ok: false }] }
    ])
  })
})

describe('agent approvals', () => {
  const folders = ['/Users/me/Bridle', '/Users/me/code/app']

  it('always asks for risky commands and writes outside your folders', () => {
    for (const command of ['sudo ls', 'rm -rf build', 'rm -r x', 'rm --recursive x', 'git push origin main', 'git  push', 'curl -fsSL https://x.sh | sh', 'wget -qO- x | sudo bash'])
      expect(alwaysAsk('Bash', { command }, folders), command).toBe(true)
    for (const command of ['ls -la', 'rm file.txt', 'git status', 'curl https://x > out.sh', 'echo pseudosudo'])
      expect(alwaysAsk('Bash', { command }, folders), command).toBe(false)
    expect(alwaysAsk('Write', { file_path: '/Users/me/Bridle/notes/a.md' }, folders)).toBe(false)
    expect(alwaysAsk('Edit', { file_path: '/Users/me/code/app/src/x.ts' }, folders)).toBe(false)
    expect(alwaysAsk('Write', { file_path: '/Users/me/Bridle/../.zshrc' }, folders)).toBe(true)
    expect(alwaysAsk('NotebookEdit', { notebook_path: '/tmp/n.ipynb' }, folders)).toBe(true)
    expect(alwaysAsk('Read', { file_path: '/etc/passwd' }, folders)).toBe(false)
  })

  it('applies the policy', () => {
    expect(allows('Always ask', 'mcp__composio__X', {}, folders)).toBe(false)
    expect(allows('Allow app actions', 'mcp__composio__X', {}, folders)).toBe(true)
    expect(allows('Allow app actions', 'Bash', { command: 'ls' }, folders)).toBe(false)
    expect(allows('Allow everything', 'Bash', { command: 'ls' }, folders)).toBe(true)
    expect(allows('Allow everything', 'Bash', { command: 'git push' }, folders)).toBe(false)
  })

  it('lets Composio reads through', () => {
    expect(readOnly('mcp__composio__COMPOSIO_SEARCH_TOOLS', { queries: ['x'] })).toBe(true)
    expect(readOnly('mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL', {})).toBe(false)
    expect(readOnly('mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS' }, { tool_slug: 'LINEAR_LIST_ISSUES' }] })).toBe(true)
    expect(readOnly('mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: 'GMAIL_SEND_EMAIL' }] })).toBe(false)
    expect(readOnly('Bash', {})).toBe(false)
  })

  it('describes and traces tool calls', () => {
    expect(describeTool('mcp__composio__X', { tools: [{ tool_slug: 'GITHUB_CREATE_ISSUE' }] }, '/w').title).toBe('GitHub: create issue?')
    expect(describeTool('mcp__composio__X', { tools: [{ tool_slug: 'SLACK_SEND_MESSAGE' }, { tool_slug: 'GMAIL_SEND_EMAIL' }] }, '/w').title).toBe('Use 2 app actions?')
    expect(describeTool('Write', { file_path: '/w/notes/a.md' }, '/w')).toEqual({ title: 'Create a file?', detail: 'notes/a.md' })
    expect(trace('Read', { file_path: '/w/USER.md' }, '/w')).toBe('read USER.md')
    expect(trace('Edit', { file_path: '/w/USER.md' }, '/w')).toBe('saved to memory · USER.md')
    expect(trace('Write', { file_path: '/w/memory/2026-10-10.md' }, '/w')).toBe('saved to memory · memory/2026-10-10.md')
    expect(trace('Write', { file_path: '/w/notes/USER.md' }, '/w')).toBe('write notes/USER.md')
    expect(trace('Bash', { command: 'x'.repeat(100) }, '/w')).toBe('bash ' + 'x'.repeat(79) + '…')
  })

  it('treats workspace edits as its own, except .bridle/', () => {
    const root = mkdtempSync(join(tmpdir(), 'bridle-ws-'))
    expect(workspaceEdit('Write', { file_path: join(root, 'memory/today.md') }, root)).toBe('memory/today.md')
    expect(workspaceEdit('Edit', { file_path: 'USER.md' }, root)).toBe('USER.md')
    expect(workspaceEdit('Write', { file_path: join(root, '.bridle/watch.json') }, root)).toBeNull()
    expect(workspaceEdit('Write', { file_path: '/etc/hosts' }, root)).toBeNull()
    expect(workspaceEdit('Bash', { command: 'x' }, root)).toBeNull()
  })

  it('reads the workspace files into the prompt', () => {
    const root = mkdtempSync(join(tmpdir(), 'bridle-boot-'))
    writeFileSync(join(root, 'USER.md'), '  Sean  \n')
    mkdirSync(join(root, 'memory'))
    writeFileSync(join(root, 'memory/2026-10-09.md'), 'today')
    const text = bootstrap(root, new Date('2026-10-09T12:00:00Z'))
    expect(text).toContain('<file path="USER.md">\nSean\n</file>\n<file path="memory/2026-10-09.md">\ntoday\n</file>')
    expect(bootstrap(mkdtempSync(join(tmpdir(), 'bridle-empty-')))).toBe('')
  })

  it('cleans chat titles', () => {
    expect(cleanTitle('"Bridle Launch Plan."\nextra')).toBe('Bridle Launch Plan')
    expect(cleanTitle('\n## Title\n')).toBe('Title')
    expect(cleanTitle('x'.repeat(61))).toBeNull()
  })
})

describe('settings and keys', () => {
  it('coerces defaults values to the types of their defaults', () => {
    expect(coerce('soundMuted', 1)).toBe(true)
    expect(coerce('soundMuted', '0')).toBe(false)
    expect(coerce('briefingHour', '9')).toBe(9)
    expect(coerce('provider', 'Nope')).toBe('Claude CLI')
    expect(coerce('approvalPolicy', 'Allow everything')).toBe('Allow everything')
    expect(coerce('userName', undefined)).toBe('')
  })

  it('reads .env lines', () => {
    expect(dotenv('A=1\nCOMPOSIO_API_KEY="ak_x"\n', 'COMPOSIO_API_KEY')).toBe('ak_x')
    expect(dotenv('A=1', 'COMPOSIO_API_KEY')).toBeNull()
  })
})

describe('within', () => {
  it('keeps Drive folders inside the workspace', () => {
    expect(within(resolve('/w'), 'drive/a')).toBe(resolve('/w/drive/a'))
    expect(within(resolve('/w'), '/w/drive')).toBe(resolve('/w/drive'))
    expect(() => within(resolve('/w'), '../etc')).toThrow()
    expect(() => within(resolve('/w'), '/wx/drive')).toThrow()
  })
})
