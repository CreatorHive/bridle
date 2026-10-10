import { spawnSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { keychain } from './keychain'
import { settings } from './settings'
import { cliEnv, run } from './util'

// One-shot completions with no tools, shared by chat titles and the watcher.

/** The `claude` binary, in the places Claude Code installs it. */
export function claudeBinary(): string | null {
  const home = homedir()
  // On Windows the native installer puts claude.exe in ~/.local/bin; a .cmd shim (npm) can't be spawned without a shell.
  const candidates = process.platform === 'win32'
    ? [join(home, '.local', 'bin', 'claude.exe'), ...whereExe('claude')]
    : [`${home}/.local/bin/claude`, '/opt/homebrew/bin/claude', '/usr/local/bin/claude', `${home}/.claude/local/claude`]
  for (const p of candidates) {
    try {
      accessSync(p, constants.X_OK)
      return p
    } catch {
      // next
    }
  }
  return null
}

/** OpenRouter or a local OpenAI-compatible server. */
export async function openAIBase(): Promise<{ base: string; key: string | null; model: string; local: boolean }> {
  const provider = await settings.get('provider')
  const local = provider === 'Local'
  return {
    base: local ? (await settings.get('localEndpoint')) || 'http://localhost:1234/v1' : 'https://openrouter.ai/api/v1',
    key: local ? null : await keychain.get('openrouter'),
    model: local ? await settings.get('localModel') : await settings.get('openRouterModel'),
    local
  }
}

/** The prompt's answer as text, from whichever provider Settings → Models uses. The Claude CLI
 *  runs with no tools, no MCP and no settings: it can only answer. The prompt goes on stdin. */
export async function complete(prompt: string, system = 'You triage a person\'s inbox. You answer with JSON only.'): Promise<string> {
  const provider = await settings.get('provider')
  if (provider === 'Mock') throw new Error('Pick a model in Settings → Models to get messages about what needs you')
  if (provider === 'Claude CLI') {
    const binary = claudeBinary()
    if (!binary) throw new Error('Claude CLI not found')
    const r = await run(binary, ['-p', '--model', 'haiku', '--output-format', 'text', '--tools', '', '--setting-sources', '',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands',
      '--no-session-persistence', '--system-prompt', system], { input: prompt, cwd: tmpdir(), env: cliEnv() })
    if (r.code !== 0) throw new Error(`The model check failed (claude exited ${r.code})`)
    return r.stdout
  }
  const { base, key, model, local } = await openAIBase()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (!local && key) headers.authorization = `Bearer ${key}`
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] })
  })
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return json.choices?.[0]?.message?.content ?? ''
}

/** Every `name`.exe on the PATH (Windows `where`). */
function whereExe(name: string): string[] {
  const r = spawnSync('where', [`${name}.exe`], { encoding: 'utf8', windowsHide: true })
  return r.status === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : []
}
