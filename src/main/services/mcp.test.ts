import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] } }))
const { parseServers } = await import('./mcp')
const { describe: describeTool, trace, resultText } = await import('./agent')

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

describe('tool calls in the trace', () => {
  it('names MCP tools by server, and the app tools Composio ran', () => {
    expect(trace('mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS' }, { tool_slug: 'GMAIL_GET_PROFILE' }] }, '/r'))
      .toBe('composio gmail_fetch_emails, gmail_get_profile')
    expect(trace('mcp__docs__search', {}, '/r')).toBe('docs search')
    expect(trace('Read', { file_path: '/r/notes/x.md' }, '/r')).toBe('read notes/x.md')
  })

  it('reads a tool result as text, JSON indented', () => {
    expect(resultText('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(resultText([{ type: 'text', text: 'hi' }, { type: 'image' }])).toBe('hi\n[image]')
    expect(resultText(undefined)).toBe('')
  })
})
