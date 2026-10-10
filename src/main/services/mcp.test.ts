import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] } }))
const { parseServers } = await import('./mcp')
const { describe: describeTool } = await import('./agent')

describe('mcp', () => {
  it('takes one server, a map, or a whole mcpServers block', () => {
    expect(parseServers('{"command":"npx","args":["-y","x"]}', 'docs')).toEqual({ docs: { command: 'npx', args: ['-y', 'x'] } })
    expect(Object.keys(parseServers('{"mcpServers":{"a":{"url":"https://a.dev/mcp"},"b":{"command":"b"}}}', ''))).toEqual(['a', 'b'])
    expect(() => parseServers('{"command":"x"}', '')).toThrow('Give the server a name')
    expect(() => parseServers('{"composio":{"command":"x"}}', '')).toThrow("Bridle's own")
    expect(() => parseServers('{"a":{"url":"file:///etc"}}', '')).toThrow('needs a "command"')
    expect(() => parseServers('nope', 'a')).toThrow('valid JSON')
  })

  it('names MCP calls on permission cards', () => {
    expect(describeTool('mcp__context7__query-docs', {}, '/w').title).toBe('Use context7: query-docs?')
  })
})
