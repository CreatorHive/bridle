import { useCallback, useEffect, useState } from 'react'
import type { McpServer } from '../../../shared/types'
import { ChoiceMenu, Field, Pill, SettingsCard, SettingsRow, Toggle } from '../../components'
import { play } from '../../sound'
import s from './settings.module.css'

const ASK = 'Ask each time'
const TRUST = "Don't ask"
const STATUS: Record<string, string> = { connected: 'Connected', failed: "Couldn't connect", 'needs-auth': 'Needs sign-in', pending: 'Connecting' }
const SAMPLE = '{ "command": "npx", "args": ["-y", "@upstash/context7-mcp"] }'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Settings → Tools → MCP servers: yours, in .bridle/mcp.json, for chats on the Claude CLI. */
export function McpServers() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [json, setJson] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => void window.bridle.mcp.list().then(setServers, () => {}), [])
  useEffect(reload, [reload])

  const add = async () => {
    try {
      await window.bridle.mcp.add(json, name)
      play('success')
      setAdding(false)
      setName('')
      setJson('')
      setError(null)
      reload()
    } catch (e) {
      play('error')
      setError(errorText(e))
    }
  }
  const set = (n: string, change: { enabled?: boolean; trust?: boolean }) => void window.bridle.mcp.set(n, change).then(reload, () => play('error'))

  return (
    <SettingsCard>
      {servers.map((m) => (
        <SettingsRow key={m.name} label={m.name}
          description={`${m.kind === 'command' ? m.target : `${m.kind.toUpperCase()} · ${m.target}`}${m.status ? ` · ${STATUS[m.status] ?? m.status}` : ''}`}>
          <div className={s.automationActions}>
            <ChoiceMenu label={`${m.name} approvals`} value={m.trust ? TRUST : ASK} options={[ASK, TRUST]}
              onChange={(v) => set(m.name, { trust: v === TRUST })} />
            <Pill onClick={() => void window.bridle.mcp.remove(m.name).then(reload)}>Remove</Pill>
            <Toggle label={`${m.name} on`} checked={m.enabled} onChange={(on) => set(m.name, { enabled: on })} />
          </div>
        </SettingsRow>
      ))}
      {adding ? (
        <div className={s.mcpForm}>
          <Field placeholder="Name, like context7" value={name} onChange={(e) => setName(e.target.value)} aria-label="Server name" />
          <textarea className={s.mcpJson} rows={5} spellCheck={false} placeholder={`${SAMPLE}\n\nOr paste a whole { "mcpServers": { … } } block from a README.`}
            value={json} onChange={(e) => setJson(e.target.value)} aria-label="Server JSON" />
          {error && <span className={s.mcpError}>{error}</span>}
          <div className={s.automationActions}>
            <Pill cue={null} onClick={() => { setAdding(false); setError(null) }}>Cancel</Pill>
            <Pill filled cue={null} disabled={!json.trim()} onClick={() => void add()}>Add</Pill>
          </div>
        </div>
      ) : (
        <SettingsRow label={servers.length ? 'Add another server' : 'No MCP servers yet'}
          description="Your own tools over the Model Context Protocol, for chats on the Claude CLI. Each call asks first unless you say otherwise.">
          <Pill onClick={() => setAdding(true)}>New MCP Server</Pill>
        </SettingsRow>
      )}
    </SettingsCard>
  )
}
