import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BridleAPI } from '../../shared/api'
import type { McpServer } from '../../shared/types'
import { workspaceRoot } from './workspace'

// Your own MCP servers (Settings → Tools), handed to the Claude CLI beside Composio's. The file is the
// format MCP READMEs and Claude Code use, plus two fields of Bridle's (stripped before the CLI sees it):
//   .bridle/mcp.json  { "mcpServers": { "<name>": { "command", "args", "env" } | { "type": "http" | "sse", "url", "headers" },
//                                       … "disabled": true, "trust": true } }
// It's in .bridle/ on purpose: the agent edits the workspace freely but asks before touching .bridle/, so it
// can't add a server (a command that would run) or trust one by itself.
// ponytail: secrets in env/headers sit in this 0600 file; move them to the Keychain if that's not enough.

type Config = Record<string, unknown> & { command?: unknown; url?: unknown; type?: unknown; disabled?: unknown; trust?: unknown }

const RESERVED = new Set(['composio'])
const NAME = /^[A-Za-z0-9_-]{1,40}$/

async function file(): Promise<string> {
  return join(await workspaceRoot(), '.bridle', 'mcp.json')
}

async function load(): Promise<Record<string, Config>> {
  try {
    const json = JSON.parse(await readFile(await file(), 'utf8')) as { mcpServers?: Record<string, Config> }
    return json.mcpServers && typeof json.mcpServers === 'object' ? json.mcpServers : {}
  } catch {
    return {}
  }
}

async function save(servers: Record<string, Config>): Promise<void> {
  const path = await file()
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify({ mcpServers: servers }, null, 2), { mode: 0o600 })
  await chmod(path, 0o600)
}

/** A server config that names a command, or an http(s) URL. */
export function validServer(c: unknown): c is Config {
  if (!c || typeof c !== 'object') return false
  const s = c as Config
  if (typeof s.command === 'string') return s.command.trim().length > 0
  return typeof s.url === 'string' && /^https?:\/\//.test(s.url)
}

/** What you pasted: a whole `{ "mcpServers": {…} }`, a `{ "<name>": {…} }` map, or one server under `name`. */
export function parseServers(json: string, name: string): Record<string, Config> {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new Error("That isn't valid JSON")
  }
  const v = value as Record<string, unknown>
  const map = validServer(v) ? { [name.trim()]: v } : (v?.mcpServers as Record<string, unknown> | undefined) ?? v
  if (!map || typeof map !== 'object' || !Object.keys(map).length) throw new Error('No servers in it')
  const out: Record<string, Config> = {}
  for (const [n, c] of Object.entries(map)) {
    if (!NAME.test(n)) throw new Error(n ? `"${n}": use letters, numbers, - and _` : 'Give the server a name')
    if (RESERVED.has(n)) throw new Error(`"${n}" is Bridle's own; pick another name`)
    if (!validServer(c)) throw new Error(`"${n}" needs a "command" or an http(s) "url"`)
    out[n] = c
  }
  return out
}

/** The last status the CLI reported per server ("connected", "failed", "needs-auth"…), this run of the app. */
const statuses = new Map<string, string>()
/** Servers whose tools run without a card; refreshed every time the CLI config is built. */
let trusted = new Set<string>()

export const recordMcpStatus = (name: string, status: string): void => void statuses.set(name, status)
export const trustedMcp = (tool: string): boolean => [...trusted].some((n) => tool.startsWith(`mcp__${n}__`))

/** The enabled servers as the CLI's `mcpServers`, without Bridle's fields. */
export async function cliServers(): Promise<Record<string, Record<string, unknown>>> {
  const servers = await load()
  const out: Record<string, Record<string, unknown>> = {}
  trusted = new Set()
  for (const [name, c] of Object.entries(servers)) {
    if (c.disabled === true || !validServer(c) || RESERVED.has(name)) continue
    const { disabled: _d, trust, ...rest } = c
    if (trust === true) trusted.add(name)
    out[name] = rest
  }
  return out
}

export const mcp: BridleAPI['mcp'] = {
  async list() {
    return Object.entries(await load()).map(([name, c]): McpServer => {
      const http = typeof c.url === 'string'
      return {
        name,
        kind: http ? (c.type === 'sse' ? 'sse' : 'http') : 'command',
        target: http ? String(c.url) : [c.command, ...(Array.isArray(c.args) ? c.args : [])].join(' '),
        enabled: c.disabled !== true,
        trust: c.trust === true,
        status: statuses.get(name) ?? null
      }
    })
  },

  async add(json, name) {
    const added = parseServers(json, name)
    await save({ ...(await load()), ...added })
    return Object.keys(added)
  },

  async remove(name) {
    const servers = await load()
    delete servers[name]
    await save(servers)
  },

  async set(name, change) {
    const servers = await load()
    const c = servers[name]
    if (!c) throw new Error('No such server')
    if (change.enabled !== undefined) c.disabled = !change.enabled
    if (change.trust !== undefined) c.trust = change.trust
    await save(servers)
  }
}
