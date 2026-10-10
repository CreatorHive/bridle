import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, shell: {}, dialog: {}, safeStorage: {}, BrowserWindow: { getAllWindows: () => [] } }))
const { cliOverrides, origin, parseModels } = await import('./lmstudio')
const { cliEnv } = await import('./util')

describe('lmstudio', () => {
  it('finds the server root from whatever endpoint was typed', () => {
    expect(origin('')).toBe('http://localhost:1234')
    expect(origin('http://localhost:1234/v1/')).toBe('http://localhost:1234')
    expect(origin(' http://box.local:5555 ')).toBe('http://box.local:5555')
  })

  it('lists chat models, loaded first, without embeddings', () => {
    const models = parseModels({ models: [
      { type: 'embedding', key: 'nomic', loaded_instances: [{ id: 'nomic' }] },
      { type: 'llm', key: 'b/zeta', display_name: 'Zeta', max_context_length: 131072, capabilities: { trained_for_tool_use: true }, loaded_instances: [] },
      { type: 'llm', key: 'a/alpha', display_name: 'Alpha', loaded_instances: [{ id: 'a/alpha', config: { context_length: 4096 } }] }
    ] })
    expect(models).toEqual([
      { id: 'a/alpha', name: 'Alpha', loaded: true, context: null, tools: false },
      { id: 'b/zeta', name: 'Zeta', loaded: false, context: 131072, tools: true }
    ])
    expect(parseModels(null)).toEqual([])
  })

  it('points the CLI at LM Studio, past the stray-key scrub', () => {
    const env = cliEnv(cliOverrides('http://localhost:1234', null, 'q/qwen'))
    expect(env.ANTHROPIC_BASE_URL).toBe('http://localhost:1234')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('lmstudio')
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('q/qwen')
    expect(cliEnv().ANTHROPIC_BASE_URL).toBeUndefined()
  })
})
