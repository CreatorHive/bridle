import type { BridleAPI } from '../../shared/api'
import type { LocalModel } from '../../shared/types'
import { keychain } from './keychain'
import { settings } from './settings'

// LM Studio (lmstudio.ai) as a provider. Its server speaks Anthropic's Messages API, so the Claude CLI runs against it
// as the full agent: tools, approvals, MCP. Its REST API (/api/v1/models) lists the models and loads one with
// enough context for that agent. An API token, if LM Studio requires one, is Keychain "lmstudio".

/** Claude Code's own prompt and tools take about 25K tokens; a model loaded with less can't hold a turn. */
export const MIN_CONTEXT = 32_768

/** The server's root: "http://localhost:1234/v1/" → "http://localhost:1234". */
export function origin(endpoint: string): string {
  return (endpoint.trim() || 'http://localhost:1234').replace(/\/+$/, '').replace(/\/v1$/, '')
}

interface Listed {
  type: string
  key: string
  display_name?: string
  max_context_length?: number | null
  loaded_instances?: { id: string; config?: { context_length?: number } }[]
  capabilities?: { trained_for_tool_use?: boolean }
}

/** GET /api/v1/models → the chat models, loaded first. */
export function parseModels(json: unknown): LocalModel[] {
  const listed = ((json as { models?: Listed[] })?.models ?? []).filter((m) => m.type === 'llm' && m.key)
  return listed
    .map((m) => ({
      id: m.key,
      name: m.display_name || m.key,
      loaded: !!m.loaded_instances?.length,
      context: m.max_context_length ?? null,
      tools: !!m.capabilities?.trained_for_tool_use
    }))
    .sort((a, b) => Number(b.loaded) - Number(a.loaded) || a.name.localeCompare(b.name))
}

async function server(): Promise<{ base: string; token: string | null; headers: Record<string, string> }> {
  const base = origin(await settings.get('localEndpoint'))
  const token = await keychain.get('lmstudio')
  return { base, token, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } }
}

async function call(path: string, body?: unknown): Promise<unknown> {
  const { base, headers } = await server()
  const res = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
    signal: body ? undefined : AbortSignal.timeout(3000) // a load takes as long as it takes
  }).catch(() => null)
  if (!res) throw new Error(`LM Studio isn't running at ${base}. Open it and start the server (Developer → Start server, or \`lms server start\`).`)
  if (res.status === 401) throw new Error('LM Studio wants an API token: add it in Settings → Models.')
  if (!res.ok) throw new Error(`LM Studio: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

export const lmStudio: BridleAPI['lmStudio'] = {
  async models() {
    return parseModels(await call('/api/v1/models'))
  }
}

/** The CLI environment that points Claude Code at LM Studio, every model tier (and subagents) on `model`. */
export function cliOverrides(base: string, token: string | null, model: string): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: base,
    ANTHROPIC_AUTH_TOKEN: token || 'lmstudio',
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
    CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
  }
}

/** Settings → Models' LM Studio model, loaded with room for the agent (reloaded if its context is too small),
 *  and the env for the Claude CLI. */
export async function lmStudioRun(status: (text: string) => void): Promise<{ model: string; env: Record<string, string> }> {
  const model = await settings.get('localModel')
  const listed = ((await call('/api/v1/models')) as { models?: Listed[] }).models ?? []
  const m = listed.find((x) => x.key === model)
  if (!m) throw new Error(model ? `LM Studio doesn't have ${model}. Download it there, or pick another model in Settings → Models.`
    : 'Pick an LM Studio model in Settings → Models.')
  const name = m.display_name || model
  if (m.max_context_length && m.max_context_length < MIN_CONTEXT)
    throw new Error(`${name} holds ${Math.round(m.max_context_length / 1024)}K tokens; Bridle's agent needs ${MIN_CONTEXT / 1024}K. Pick a model with a longer context.`)
  const instances = m.loaded_instances ?? []
  if (!instances.some((i) => (i.config?.context_length ?? 0) >= MIN_CONTEXT)) {
    // LM Studio would otherwise load it on demand at its default context, too small for the agent.
    status(`Loading ${name}`)
    for (const i of instances) await call('/api/v1/models/unload', { instance_id: i.id })
    await call('/api/v1/models/load', { model, context_length: MIN_CONTEXT })
  }
  const { base, token } = await server()
  return { model, env: cliOverrides(base, token, model) }
}
