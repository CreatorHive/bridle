import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import type { BridleAPI } from '../../shared/api'
import type { AgentAction, AgentEvent, ApprovalPolicy, Message, TaskStatus } from '../../shared/types'
import { emit } from '../events'
import { LOOP_SCRIPT } from '../automations'
import { noteRun } from '../notch'
import { projectContext } from '../search/service'
import { composio } from './composio'
import { cliServers, recordMcpStatus, trustedMcp } from './mcp'
import { claudeBinary, complete, openAIBase } from './llm'
import { settings } from './settings'
import { tasks } from './tasks'
import { cliEnv, iso, sleep, sortKeys } from './util'
import { projectDir, workspaceRoot } from './workspace'

// The agent loop's model side: the Claude CLI headless in the workspace, OpenRouter /
// a local OpenAI-compatible server, or a canned Mock. Events stream as `agent:event` { chatId, event }.

type Input = Record<string, unknown>

// MARK: Approvals (ApprovalPolicy, readOnly, describe)

const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

/** Composio action slugs inside a tool call's input ("GITHUB_CREATE_ISSUE"…), however nested. */
export function composioSlugs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(composioSlugs)
  if (value && typeof value === 'object') {
    const d = value as Input
    return typeof d.tool_slug === 'string' ? [d.tool_slug] : Object.values(d).flatMap(composioSlugs)
  }
  return []
}

/** Composio calls that only read run without a card. ponytail: judged by the action's verb. */
export function readOnly(tool: string, input: Input): boolean {
  if (trustedMcp(tool)) return true // a server you marked "Don't ask" in Settings → Tools
  if (!tool.startsWith('mcp__composio__')) return false
  const slugs = composioSlugs(input)
  if (slugs.length === 0) return !tool.toLowerCase().includes('execute') // meta tools: search, schemas, connections
  const reads = ['_GET', '_LIST', '_FETCH', '_SEARCH', '_FIND', '_READ']
  return slugs.every((s) => reads.some((r) => s.toUpperCase().includes(r)))
}

const RISKY = [/\bsudo\b/, /\brm\s+(-\w*[rR]\w*|--recursive)\b/, /\bgit\s+push\b/, /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/]

/** What asks even under "Allow everything": sudo, recursive deletes, any push, piped installs, writes outside `folders`. */
export function alwaysAsk(tool: string, input: Input, folders: string[]): boolean {
  if (tool === 'Bash' && typeof input.command === 'string') return RISKY.some((r) => r.test(input.command as string))
  const path = input.file_path ?? input.notebook_path
  if (FILE_TOOLS.includes(tool) && typeof path === 'string') {
    const file = resolve(path)
    return !folders.some((f) => file.startsWith(resolve(f) + sep))
  }
  return false
}

export function allows(policy: ApprovalPolicy, tool: string, input: Input, folders: string[]): boolean {
  if (policy === 'Allow app actions') return tool.startsWith('mcp__composio__')
  if (policy === 'Allow everything') return !alwaysAsk(tool, input, folders)
  return false
}

/** realpath for paths that may not exist yet: the deepest existing ancestor, resolved, plus the rest. */
function real(path: string): string {
  const rest: string[] = []
  let p = path
  while (!existsSync(p) && dirname(p) !== p) {
    rest.unshift(basename(p))
    p = dirname(p)
  }
  try {
    return join(realpathSync(p), ...rest)
  } catch {
    return path
  }
}

/** A file edit inside the workspace (outside .bridle/), which runs without a card. Returns its workspace path. */
export function workspaceEdit(tool: string, input: Input, root: string): string | null {
  const path = input.file_path ?? input.notebook_path
  if (!FILE_TOOLS.includes(tool) || typeof path !== 'string') return null
  const base = real(root) + sep
  const target = real(resolve(root, path))
  if (!target.startsWith(base)) return null
  const file = target.slice(base.length).split(sep).join('/') // "memory/today.md" on Windows too
  return !file || file.startsWith('.bridle/') ? null : file
}

const APP_NAMES: Record<string, string> = { GITHUB: 'GitHub', GMAIL: 'Gmail', GOOGLECALENDAR: 'Google Calendar', LINEAR: 'Linear' }

/** What a permission card says for a tool call. */
export function describe(tool: string, input: Input, root: string): { title: string; detail: string } {
  const short = (s: string): string => s.split(root + '/').join('')
  const slugs = composioSlugs(input)
  if (tool.startsWith('mcp__composio__') && slugs.length) {
    // "GITHUB_CREATE_ISSUE" → "GitHub: create issue"
    const readable = slugs.map((s) => {
      const [first = '', ...rest] = s.split('_').filter(Boolean)
      const app = APP_NAMES[first] ?? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
      return `${app}: ${rest.join(' ').toLowerCase()}`
    })
    const json = JSON.stringify(sortKeys(input), null, 2)
    return {
      title: readable.length === 1 ? readable[0].charAt(0).toUpperCase() + readable[0].slice(1) + '?' : `Use ${readable.length} app actions?`,
      detail: json.slice(0, 600)
    }
  }
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  switch (tool) {
    case 'Bash': return { title: 'Run a command?', detail: str(input.command) }
    case 'Write': return { title: 'Create a file?', detail: short(str(input.file_path)) }
    case 'Edit': case 'MultiEdit': case 'NotebookEdit':
      return { title: 'Edit a file?', detail: short(str(input.file_path) || str(input.notebook_path)) }
    case 'WebFetch': return { title: 'Open a web page?', detail: str(input.url) }
    case 'WebSearch': return { title: 'Search the web?', detail: str(input.query) }
    default: {
      // "mcp__context7__query-docs" → "Use context7: query-docs?"
      const m = tool.match(/^mcp__(.+?)__(.+)$/)
      return { title: m ? `Use ${m[1]}: ${m[2]}?` : `Use ${tool}?`, detail: JSON.stringify(sortKeys(input)).slice(0, 300) }
    }
  }
}

/** Tool → working-row label. */
export function label(name: string): string {
  if (['Read', 'Glob', 'Grep', 'LS'].includes(name)) return 'Reading files'
  if (FILE_TOOLS.includes(name)) return 'Editing files'
  return ({ Bash: 'Running a command', WebSearch: 'Searching the web', WebFetch: 'Reading web pages', Task: 'Bringing in a Worker',
    Agent: 'Bringing in a Worker', TodoWrite: 'Updating the task' } as Record<string, string>)[name] ?? 'Working'
}

export function trace(name: string, input: Input, root: string): string {
  const detail = ['file_path', 'pattern', 'command', 'query', 'url', 'description', 'path'].map((k) => input[k]).find((v) => typeof v === 'string') as string | undefined
  const short = (detail ?? '').split(root + '/').join('')
  return `${name.toLowerCase()} ${short.length > 80 ? short.slice(0, 79) + '…' : short}`
}

// MARK: The system prompt

/** Linked folders: the "- /path" lines of goals/<dir>/SOURCES.md. */
export function links(root: string, dir: string): string[] {
  try {
    return readFileSync(join(root, 'goals', dir, 'SOURCES.md'), 'utf8').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2))
  } catch {
    return []
  }
}

/** The workspace plus every project's linked folders. */
function folders(root: string): string[] {
  let dirs: string[] = []
  try {
    dirs = readdirSync(join(root, 'goals'))
  } catch {
    // no projects
  }
  return [root, ...dirs.flatMap((d) => links(root, d))]
}

/** The project's display name: GOAL.md's "# " heading, else what we were given. */
function projectName(root: string, dir: string, given: string): string {
  try {
    const heading = readFileSync(join(root, 'goals', dir, 'GOAL.md'), 'utf8').split('\n').find((l) => l.startsWith('# '))
    return heading ? heading.slice(2) : given
  } catch {
    return given
  }
}

export async function systemPrompt(root: string, project: string | null): Promise<string> {
  const name = (await settings.get('agentName')) || 'Bridle'
  const user = (await settings.get('userName')) || 'the user'
  let prompt = `You are ${name}, ${user}'s personal agent inside Bridle, a desktop app. Your workspace is the current folder. Be concise and warm. drive/ is ${user}'s Drive, their own folders and files: read, search and organize it freely, and ask before deleting from it. To do something on a schedule, write routines/<name>.md: front matter \`when: weekdays 08:00\` (or daily, weekends, mon, thu…), then a # Title and what to do. To watch something without spending tokens, write loops/<name>/LOOP.md (front matter \`every: 15m\`, a # Title, what to do when it fires) and loops/<name>/${LOOP_SCRIPT}, a ${LOOP_SCRIPT.endsWith('.ps1') ? 'PowerShell' : 'shell'} script whose output changes when something needs attention; ${user} approves each script in Settings → Automations before it runs.`
  if (project) {
    const dir = projectDir(root, project)
    prompt += ` This chat belongs to the project "${projectName(root, dir, project)}"; its files live in goals/${dir}/.`
    const linked = links(root, dir)
    if (linked.length) prompt += ' Its linked folders (read them for context): ' + linked.join(', ') + '.'
  }
  return prompt
}

/** The agent's own files at the workspace root, in the order they're read each turn. */
export const BOOT_FILES = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'MEMORY.md', 'HEARTBEAT.md']

/** Its files, then yesterday's and today's logs. Capped at 20k characters a file, 60k in all. */
export function bootstrap(root: string, now = new Date()): string {
  const day = (offset: number): string => `memory/${iso(now.getTime() + offset * 86400_000).slice(0, 10)}.md`
  let budget = 60_000
  const parts: string[] = []
  for (const file of [...BOOT_FILES, day(-1), day(0)]) {
    if (budget <= 0) break
    let text: string
    try {
      text = readFileSync(join(root, file), 'utf8')
    } catch {
      continue
    }
    const body = text.trim().slice(0, Math.min(20_000, budget))
    if (!body) continue
    budget -= body.length
    parts.push(`<file path="${file}">\n${body}\n</file>`)
  }
  if (!parts.length) return ''
  return '\n\nYour workspace is your operating system. These are your own files, read at the start of every turn; edit them to change how you work or what you remember:\n' + parts.join('\n')
}

/** How the agent proposes email, events and tasks as approval cards. */
export const GUIDE = `

Actions outside the workspace (sending an email, adding a calendar event) always need the user's approval. Never claim you did one. Instead, after your message, write each action as a fenced block; Bridle shows it to the user as an approval card with Send/Deny, so don't ask them to confirm in text:

\`\`\`bridle:email
{"to": "Name <address>", "subject": "…", "body": "…", "from": "one of the user's Gmail addresses (optional)"}
\`\`\`
\`\`\`bridle:event
{"title": "…", "start": "2026-10-10 14:00", "end": "2026-10-10 15:00", "notes": "…"}
\`\`\`

When the conversation turns up a to-do for the user (something they or you agreed needs doing later), offer to put it on their task board with:
\`\`\`bridle:task
{"title": "short, starts with a verb", "notes": "what done looks like, links, context", "status": "backlog | in progress | needs review", "tags": "comma-separated, optional", "linear": "yes to also create it as a Linear issue assigned to them (optional)"}
\`\`\``

const COMPOSIO_NOTE = "\n\nThe user's connected apps (GitHub, Gmail, Google Calendar, Linear…) are available through the Composio tools (mcp__composio__*). Use them instead of shell commands like gh. When the user has several accounts for an app, pass the right `account`; Composio's tools list which accounts exist."

// MARK: Runs

interface RunState {
  cancelled: boolean
  child?: ChildProcessWithoutNullStreams
  abort: AbortController
}

const runs = new Map<string, RunState>()
const permissions = new Map<string, { chatId: string; respond: (allow: boolean) => void }>()

type Send = (event: AgentEvent) => void

/** What a Code turn adds to a run:
 *  the worktree as cwd, the CLI's permission mode and rules, every stream line, the plan, and `decide`, which answers
 *  a tool request in place of the workspace/approval-policy rules (true runs it, false shows a card). */
export interface CodeRun {
  cwd: string
  permissionMode?: string
  settingSources?: string
  allowedTools?: string[]
  effort?: string
  env?: Record<string, string>
  onLine?: (event: Record<string, any>) => void
  onPlan?: (plan: string, respond: (approved: boolean, feedback: string) => void) => void
  decide?: (tool: string, input: Input) => boolean
}

/** The Claude CLI over stream-json, isolated from the user's own Claude Code setup. */
async function claudeCLI(chatId: string, state: RunState, prompt: string, session: string | null, system: string,
  dirs: string[], root: string, send: Send, codeRun?: CodeRun): Promise<void> {
  const binary = claudeBinary()
  if (!binary) throw new Error('Claude CLI not found. Install Claude Code, or pick another provider in Settings → Models.')
  const alias = ({ 'Claude Opus': 'opus', 'Claude Sonnet': 'sonnet', 'Claude Haiku': 'haiku' } as Record<string, string>)[await settings.get('model')] ?? 'sonnet'
  const temp: string[] = []
  try {
    // Connected apps come in as Composio's MCP server. Its header is the project key: a private 0600 file, not argv.
    // Your own servers (Settings → Tools) come along; their env and headers may hold secrets too.
    let mcpConfig = '{"mcpServers":{}}'
    const servers: Record<string, Record<string, unknown>> = await cliServers().catch(() => ({}))
    const server = await composio.mcpServer().catch(() => null)
    if (server) {
      servers.composio = { type: 'http', url: server.url, headers: server.headers }
      system += COMPOSIO_NOTE
    }
    const yours = Object.keys(servers).filter((n) => n !== 'composio')
    if (yours.length) system += `\n\nThe user's own MCP servers are connected too: ${yours.map((n) => `${n} (mcp__${n}__*)`).join(', ')}.`
    if (Object.keys(servers).length) {
      const file = join(tmpdir(), `bridle-mcp-${randomUUID().toUpperCase()}.json`)
      await writeFile(file, JSON.stringify({ mcpServers: servers }), { mode: 0o600 })
      temp.push(file)
      mcpConfig = file
    }
    // The system prompt carries the agent's files (USER.md, MEMORY.md…): a private file, not argv.
    const promptFile = join(tmpdir(), `bridle-prompt-${randomUUID().toUpperCase()}.md`)
    await writeFile(promptFile, system, { mode: 0o600 })
    temp.push(promptFile)

    // Never --dangerously-skip-permissions: tools that need approval are asked of Bridle over stdio.
    const args = ['-p', '--input-format', 'stream-json', '--permission-prompt-tool', 'stdio',
      '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--model', alias, '--append-system-prompt-file', promptFile,
      '--setting-sources', codeRun?.settingSources ?? '', '--strict-mcp-config', '--mcp-config', mcpConfig,
      '--disable-slash-commands', ...dirs.flatMap((d) => ['--add-dir', d])]
    if (codeRun?.permissionMode) args.push('--permission-mode', codeRun.permissionMode)
    if (codeRun?.allowedTools?.length) args.push('--allowedTools', ...codeRun.allowedTools)
    if (codeRun?.effort) args.push('--effort', codeRun.effort)
    if (session) {
      args.push('--resume', session)
    } else {
      const id = randomUUID().toLowerCase()
      args.push('--session-id', id)
      send({ type: 'session', session: id })
    }

    const child = spawn(binary, args, { cwd: codeRun?.cwd ?? root, env: cliEnv(codeRun?.env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    state.child = child
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    child.stdin.on('error', () => {})
    const exited = new Promise<number>((r) => child.on('close', (code) => r(code ?? -1)))
    const spawned = new Promise<void>((ok, fail) => {
      child.once('spawn', ok)
      child.once('error', fail)
    })
    await spawned

    const write = (o: unknown): void => {
      if (child.stdin.writable) child.stdin.write(JSON.stringify(o) + '\n')
    }
    const allow = (id: string, input: Input): void =>
      write({ type: 'control_response', response: { subtype: 'success', request_id: id, response: { behavior: 'allow', updatedInput: input } } })
    write({ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } })
    write({ type: 'user', message: { role: 'user', content: prompt } })

    let finished = false
    let wroteText = false
    const policy = await settings.get('approvalPolicy')
    for await (const line of createInterface({ input: child.stdout })) {
      let event: Record<string, any>
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      codeRun?.onLine?.(event)
      if (event.type === 'system' && event.subtype === 'init' && Array.isArray(event.mcp_servers)) {
        for (const m of event.mcp_servers as { name?: unknown; status?: unknown }[]) {
          if (typeof m.name === 'string' && typeof m.status === 'string') recordMcpStatus(m.name, m.status)
        }
      }
      switch (event.type) {
        case 'stream_event': {
          const e = event.event ?? {}
          const block = e.content_block
          if (e.delta?.type === 'text_delta' && typeof e.delta.text === 'string') {
            send({ type: 'text', text: e.delta.text })
            wroteText = true
          } else if (block?.type === 'text') {
            if (wroteText) send({ type: 'text', text: '\n\n' }) // a new text block after a tool call
          } else if (block?.type === 'tool_use' && typeof block.name === 'string') {
            send({ type: 'status', status: label(block.name) })
            if ((block.name === 'Task' || block.name === 'Agent') && typeof block.id === 'string') send({ type: 'worker', worker: block.id })
          }
          break
        }
        case 'assistant': {
          // In a Code turn a subagent's own calls go to its row instead (parent_tool_use_id).
          if (codeRun?.onLine && typeof event.parent_tool_use_id === 'string') break
          for (const b of (event.message?.content ?? []) as Record<string, any>[]) {
            if (b.type === 'tool_use') send({ type: 'trace', line: trace(b.name ?? 'tool', b.input ?? {}, codeRun?.cwd ?? root) })
          }
          break
        }
        case 'control_request': {
          const id: string = event.request_id ?? ''
          const request = event.request ?? {}
          if (request.subtype !== 'can_use_tool') {
            write({ type: 'control_response', response: { subtype: 'error', request_id: id, error: 'Not supported by Bridle' } })
            break
          }
          const tool: string = request.tool_name ?? 'tool'
          const input: Input = request.input ?? {}
          if (tool === 'ExitPlanMode' && codeRun?.onPlan) { // the plan, for Approve / Revise
            send({ type: 'status', status: 'Waiting for your approval' })
            codeRun.onPlan(typeof input.plan === 'string' ? input.plan : '', (approved, feedback) => {
              if (approved) allow(id, input)
              else write({ type: 'control_response', response: { subtype: 'success', request_id: id, response: { behavior: 'deny', message: feedback } } })
              // Approved: the same turn carries on as Build, edits without asking.
              if (approved) write({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'set_permission_mode', mode: 'acceptEdits' } })
            })
            break
          }
          if (codeRun?.decide) {
            if (codeRun.decide(tool, input)) {
              allow(id, input)
              break
            }
          } else {
            const file = workspaceEdit(tool, input, root) // the workspace is the agent's own
            if (file) {
              send({ type: 'trace', line: `edited ${file}` })
              allow(id, input)
              break
            }
            const read = readOnly(tool, input) // looking things up in your apps needs no card
            if (read || allows(policy, tool, input, folders(root))) {
              if (!read) send({ type: 'trace', line: `ran without asking · ${describe(tool, input, root).title}` })
              allow(id, input)
              break
            }
          }
          const { title, detail } = describe(tool, input, codeRun?.cwd ?? root)
          const requestId = randomUUID()
          permissions.set(requestId, {
            chatId,
            respond: (ok) => {
              if (ok) allow(id, input)
              else write({ type: 'control_response', response: { subtype: 'success', request_id: id, response: { behavior: 'deny', message: 'The user declined this in Bridle.' } } })
            }
          })
          send({ type: 'status', status: 'Waiting for your approval' })
          send({ type: 'permission', request: { requestId, tool, title, detail, input, agentID: request.agent_id ?? null } })
          break
        }
        case 'result':
          finished = true
          child.stdin.end() // lets the CLI exit
          if (event.is_error === true) throw new Error(typeof event.result === 'string' ? event.result : 'Claude CLI reported an error.')
          break
      }
    }
    const code = await exited
    if (!finished && !state.cancelled) throw new Error(stderr.trim() || `Claude CLI exited with status ${code}.`)
  } finally {
    if (state.child?.exitCode === null) state.child.kill() // cancelled, or it failed mid-stream
    await Promise.all(temp.map((f) => rm(f, { force: true })))
  }
}

/** OpenRouter or a local server: OpenAI-compatible streaming chat completions. */
async function openAI(state: RunState, prompt: string, history: Message[], system: string, send: Send): Promise<void> {
  const { base, key, model, local } = await openAIBase()
  if (!local && !key) throw new Error('Add your OpenRouter key in Settings → Models.')
  const messages = [{ role: 'system', content: system }]
  for (const m of history) if (m.text && m.role !== 'tool') messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })
  messages.push({ role: 'user', content: prompt })
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Title': 'Bridle' }
  if (key) headers.Authorization = `Bearer ${key}`
  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers, signal: state.abort.signal, body: JSON.stringify({ model, stream: true, messages })
  })
  if (res.status !== 200 || !res.body) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`)
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '')
      if (!line.startsWith('data: ')) continue // skips ": OPENROUTER PROCESSING" keep-alives
      const payload = line.slice(6)
      if (payload === '[DONE]') return
      let json: Record<string, any>
      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }
      if (json.error) throw new Error(json.error.message ?? 'The provider returned an error.')
      const delta = json.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta) send({ type: 'text', text: delta })
    }
  }
}

/** Canned run for UI work. */
async function mock(state: RunState, send: Send): Promise<void> {
  const name = (await settings.get('agentName')) || 'Bridle'
  const wait = async (ms: number): Promise<void> => {
    await sleep(ms)
    if (state.cancelled) throw new Error('cancelled')
  }
  send({ type: 'status', status: 'Thinking' })
  await wait(1000)
  send({ type: 'worker', worker: 'research' })
  send({ type: 'worker', worker: 'calendar' })
  send({ type: 'status', status: `${name} and 2 workers are thinking` })
  await wait(1100)
  send({ type: 'status', status: 'Reading files' })
  send({ type: 'trace', line: 'searched workspace · 3 results' })
  send({ type: 'trace', line: 'read notes/bridle-ideas.md' })
  await wait(1100)
  const reply = `_(mock)_ Here's where a real answer streams in. I can also send Alex a quick update — approve it below.

\`\`\`bridle:email
{"to": "Alex Carter <alex@carta.dev>", "subject": "Bridle launch status", "body": "Hey Alex — quick update on the Bridle launch. Onboarding polish and semantic search are both in progress. Docs site is still to do. I'll keep you posted as things move forward."}
\`\`\``
  for (const word of reply.split(' ')) {
    send({ type: 'text', text: word + ' ' })
    await wait(25)
  }
}

/** Adds the task to the board, and to Linear when the card says so. */
async function addTask(f: Record<string, string>): Promise<void> {
  if (!f.title) throw new Error('The task has no title')
  const status = (f.status ?? '').toLowerCase() as TaskStatus
  const task = await tasks.add(f.title, f.notes ?? '',
    ['backlog', 'in progress', 'needs review', 'done'].includes(status) ? status : 'backlog',
    (f.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean))
  if (['yes', 'true'].includes((f.linear ?? '').toLowerCase())) await tasks.sendToLinear(task.id)
}

/** A Code turn: the Claude CLI in a worktree, outside the chat loop. Cancel it with `agent.cancel(key)`; its cards are
 *  answered with `agent.respondPermission`. Resolves when the CLI is done (or cancelled). */
export async function runClaude(key: string, prompt: string, session: string | null, system: string, send: Send, code: CodeRun): Promise<void> {
  await agent.cancel(key)
  const state: RunState = { cancelled: false, abort: new AbortController() }
  runs.set(key, state)
  try {
    await claudeCLI(key, state, prompt, session, system, [], await workspaceRoot(), (e) => {
      if (!state.cancelled) send(e)
    }, code)
  } finally {
    if (runs.get(key) === state) runs.delete(key)
    for (const [id, p] of permissions) if (p.chatId === key && !runs.has(key)) permissions.delete(id)
  }
}

/** Stops every running reply (app quit). */
export function stopAll(): void {
  for (const chatId of runs.keys()) void agent.cancel(chatId)
}

export const agent: BridleAPI['agent'] = {
  async run(chatId, prompt, history, options) {
    await agent.cancel(chatId) // one reply per chat
    noteRun(chatId, prompt)
    const state: RunState = { cancelled: false, abort: new AbortController() }
    runs.set(chatId, state)
    const send: Send = (event) => {
      if (!state.cancelled) emit('agent:event', { chatId, event })
    }
    try {
      const root = await workspaceRoot()
      const project = options?.project ?? null
      // In a project, the passages of its files that best match the message come along.
      let context = options?.context ?? ''
      if (project) {
        send({ type: 'status', status: 'Searching project files' })
        const found = await projectContext(prompt, project).catch(() => null)
        if (found) {
          context = [context, found.text].filter(Boolean).join('\n\n')
          send({ type: 'trace', line: `searched project files · ${found.count} passages` })
        }
      }
      const system = (await systemPrompt(root, project)) + bootstrap(root) + GUIDE + (context ? '\n\n' + context : '')
      const provider = await settings.get('provider')
      if (provider === 'Claude CLI') {
        const dirs = project ? links(root, projectDir(root, project)) : []
        await claudeCLI(chatId, state, prompt, options?.sessionID ?? null, system, dirs, root, send)
      } else if (provider === 'Mock') {
        await mock(state, send)
      } else {
        await openAI(state, prompt, history, system, send)
      }
      send({ type: 'done' })
    } catch (e) {
      if (state.cancelled) return
      const message = e instanceof Error ? e.message : String(e)
      send({ type: 'error', message })
      throw e
    } finally {
      if (runs.get(chatId) === state) runs.delete(chatId)
      for (const [id, p] of permissions) if (p.chatId === chatId && !runs.has(chatId)) permissions.delete(id)
    }
  },

  async respondPermission(requestId, allow) {
    const p = permissions.get(requestId)
    if (!p) return
    permissions.delete(requestId)
    p.respond(allow)
  },

  async cancel(chatId) {
    const state = runs.get(chatId)
    if (!state) return
    state.cancelled = true
    state.abort.abort()
    state.child?.kill()
    runs.delete(chatId)
    for (const [id, p] of permissions) if (p.chatId === chatId) permissions.delete(id)
    emit('agent:event', { chatId, event: { type: 'done' } })
  },

  async perform(action: AgentAction) {
    if (action.kind === 'task') await addTask(action.fields)
    else await sleep(400) // ponytail: email and event sends are still mocked
  },

  /** Names a chat after its first exchange, if it's still titled with its first message. */
  async chatTitle(chat) {
    const first = chat.messages.find((m) => m.role === 'user')
    const reply = chat.messages.find((m) => m.role === 'assistant' && m.text)
    if (!first?.text || chat.title !== first.text || !reply) return null
    const prompt = `Name this chat in 2 to 5 words, in Title Case, like a short document title. No quotes, no ending punctuation.

User: ${first.text.slice(0, 600)}
Assistant: ${reply.text.slice(0, 600)}`
    try {
      return cleanTitle(await complete(prompt, 'You name chats. Reply with the name only.'))
    } catch {
      return null
    }
  }
}

/** The model's first line, trimmed of quotes and markdown; null if empty or over 60 characters. */
export function cleanTitle(raw: string): string | null {
  const line = (raw.split('\n').find((l) => l.length > 0) ?? '').replace(/^[\s"'`*#.]+|[\s"'`*#.]+$/g, '')
  return line && line.length <= 60 ? line : null
}
