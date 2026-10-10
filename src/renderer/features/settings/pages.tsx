import { useEffect, useState, type ComponentType } from 'react'
import { McpServers } from './McpServers'
import { AutomationsPage } from './AutomationsPage'
import { Calendar, CircleCheck, CircleX, File as FileIcon, Folder, Globe, Key, Mail, Package, Search, Server, Smartphone, Sparkles, User } from 'lucide-react'
import { PROVIDERS, type ApprovalPolicy, type PhoneStatus, type Provider, type WorkspaceFile } from '../../../shared/types'
import { Avatar, Button, ChoiceMenu, Pill, SectionLabel, SettingsCard, SettingsRow, Toggle } from '../../components'
import { useApp, type SettingsPage } from '../../app/store'
import { play } from '../../sound'
import { byteCount } from '../files/logic'
import { viewer } from '../viewer'
import { ConnectionsPage } from './ConnectionsPage'
import { MemoryImportCard } from './MemoryImport'
import { SettingField, showSaved, ValueField } from './ValueField'
import s from './settings.module.css'

// Settings pages. Fields bound to a setting save on Return or when you leave them.

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

/** The agent's workspace, resolved once per page. */
function useWorkspace(): string {
  const [ws, setWs] = useState('')
  useEffect(() => {
    window.bridle.workspace.path().then(setWs, () => {})
  }, [])
  return ws
}

/** Opens one of the agent's markdown files in the file viewer (which closes Settings). */
function OpenFile({ name }: { name: string }) {
  const ws = useWorkspace()
  return <Pill cue={null} disabled={!ws} onClick={() => viewer.open(`${ws}/${name}`)}>{`Open ${name}`}</Pill>
}

function General() {
  const { state, setSetting, patch } = useApp()
  const [testWaiting, setTestWaiting] = useState(false)
  const s_ = state.settings

  // Test notification: banners show only while you're in another app, so the test waits until you leave
  // Bridle, then shows. Gives up after a minute; pressing again cancels.
  useEffect(() => {
    if (!testWaiting) return
    const fire = () => {
      setTestWaiting(false)
      void window.bridle.notify.post('Bridle', "Notifications are on. You'll hear from me when something needs you.")
    }
    if (!document.hasFocus()) return fire()
    const timeout = setTimeout(() => setTestWaiting(false), 60_000)
    window.addEventListener('blur', fire)
    return () => {
      clearTimeout(timeout)
      window.removeEventListener('blur', fire)
    }
  }, [testWaiting])

  if (!s_) return null
  const agent = s_.agentName || 'Bridle'
  return (
    <>
      <SettingsCard>
        <SettingsRow label="Workspace" description={`Everything ${agent} knows lives in this folder`}>
          <ValueField icon={<Folder size={14} />} value={s_.workspace} label="Workspace" />
        </SettingsRow>
        <SettingsRow label="Keep the index fresh" description="Re-index files as they change, for semantic search">
          <Toggle label="Keep the index fresh" checked={s_.autoIndex} onChange={(v) => setSetting('autoIndex', v)} />
        </SettingsRow>
      </SettingsCard>
      <SectionLabel>Notifications</SectionLabel>
      <SettingsCard>
        <SettingsRow label="Emails and invites" description="When mail or a calendar invite needs you">
          <Toggle label="Emails and invites" checked={s_.notifyMail} onChange={(v) => setSetting('notifyMail', v)} />
        </SettingsRow>
        <SettingsRow label="Approval requests" description={`When ${agent} needs you to approve a send or write`}>
          <Toggle label="Approval requests" checked={s_.notifyApprovals} onChange={(v) => setSetting('notifyApprovals', v)} />
        </SettingsRow>
        <SettingsRow label="Replies" description={`When ${agent} finishes answering`}>
          <Toggle label="Replies" checked={s_.notifyDone} onChange={(v) => setSetting('notifyDone', v)} />
        </SettingsRow>
        <SettingsRow label="Banners" description="Shown only while you're in another app">
          <Pill title={testWaiting ? 'The test shows when you leave Bridle. Click to cancel.' : undefined}
            onClick={() => setTestWaiting(!testWaiting)}>
            {testWaiting ? 'Switch to another app…' : 'Send test'}
          </Pill>
        </SettingsRow>
        <SettingsRow label="Interface sounds" description="Soft cues for presses, toggles and replies">
          <Toggle label="Interface sounds" checked={!s_.soundMuted} onChange={(on) => setSetting('soundMuted', !on)} />
        </SettingsRow>
      </SettingsCard>
      <PhoneSection />
      <SectionLabel>Onboarding</SectionLabel>
      <SettingsCard>
        <SettingsRow label="Replay onboarding" description="Meet your Router again and rename it">
          <Pill onClick={() => {
            patch({ settingsOpen: false })
            setSetting('onboarded', false)
            void window.bridle.onboarding.show()
          }}>Replay</Pill>
        </SettingsRow>
      </SettingsCard>
    </>
  )
}

/** The phone bridge: the iPhone and Android apps reach this Mac over Tailscale with a pairing token. */
function PhoneSection() {
  const [status, setStatus] = useState<PhoneStatus | null>(null)
  const [token, setToken] = useState<string | null>(null) // shown once, right after it's made
  useEffect(() => {
    window.bridle.phone.status().then(setStatus, () => {})
  }, [])
  if (!status) return null
  const pair = async () => {
    setToken(await window.bridle.phone.newToken())
    setStatus(await window.bridle.phone.status())
  }
  const where = status.error ?? (status.url ? `Phones reach this Mac at ${status.url}` : 'Off')
  return (
    <>
      <SectionLabel>Phone</SectionLabel>
      <SettingsCard>
        <SettingsRow label="Phone app" description={status.enabled ? where : 'Use Bridle from the iPhone or Android app, over Tailscale'}>
          <Toggle label="Phone app" checked={status.enabled}
            onChange={(on) => void window.bridle.phone.setEnabled(on).then(setStatus, () => play('error', { emphasis: 'subtle' }))} />
        </SettingsRow>
        {status.enabled && (
          <SettingsRow label="Pairing token"
            description={token ? 'Enter it in the phone app. It is shown only once' : status.paired ? 'A new token signs out every phone' : 'Make one, then enter it in the phone app'}>
            {token
              ? (
                <div className={s.phoneToken}>
                  <ValueField icon={<Smartphone size={14} />} value={token} label="Pairing token" />
                  <Pill cue={null} onClick={() => void navigator.clipboard.writeText(token).then(showSaved, () => play('error', { emphasis: 'subtle' }))}>Copy</Pill>
                </div>
              )
              : <Pill onClick={() => void pair()}>{status.paired ? 'New token' : 'Pair a phone'}</Pill>}
          </SettingsRow>
        )}
      </SettingsCard>
    </>
  )
}

function Profile() {
  return (
    <>
      <SectionLabel>You</SectionLabel>
      <SettingsCard>
        <SettingsRow label="Name" description="What your agent calls you">
          <SettingField setting="userName" icon={<User size={14} />} placeholder="Your name" label="Name" />
        </SettingsRow>
        <SettingsRow label="Email">
          <SettingField setting="userEmail" icon={<Mail size={14} />} placeholder="you@example.com" label="Email" />
        </SettingsRow>
        <SettingsRow label="Time zone">
          <ValueField icon={<Globe size={14} />} value={Intl.DateTimeFormat().resolvedOptions().timeZone} muted label="Time zone" />
        </SettingsRow>
      </SettingsCard>
      <SectionLabel>About you</SectionLabel>
      <SettingsCard>
        <SettingsRow label="USER.md" description="Notes your agent keeps about you; edit them anytime">
          <OpenFile name="USER.md" />
        </SettingsRow>
      </SettingsCard>
    </>
  )
}

function Agent() {
  const { state } = useApp()
  const [picture, setPicture] = useState<string | null>(null)
  useEffect(() => {
    window.bridle.avatar.get().then(setPicture, () => {})
  }, [])
  if (!state.settings) return null
  return (
    <>
      <SectionLabel>Identity</SectionLabel>
      <SettingsCard>
        <SettingsRow label="Name" description="Saved to IDENTITY.md">
          <SettingField setting="agentName" icon={<Sparkles size={14} />} placeholder="Name" label="Agent name" />
        </SettingsRow>
        <SettingsRow label="Picture" description="Shown in chat and on the home screen. Saved to agent/avatar.png">
          <span className={s.inline}>
            <Avatar name={state.settings.agentName || 'Bridle'} image={picture} size={32} />
            {picture && (
              <Pill onClick={() => window.bridle.avatar.remove().then(() => {
                setPicture(null)
                showSaved()
              }, () => play('error', { emphasis: 'subtle' }))}>Remove</Pill>
            )}
            <Pill onClick={() => window.bridle.avatar.choose().then((p) => {
              if (!p) return
              setPicture(p)
              showSaved()
            }, () => play('error', { emphasis: 'subtle' }))}>Choose…</Pill>
          </span>
        </SettingsRow>
        <SettingsRow label="Personality" description="Tone, boundaries and how it works with you">
          <OpenFile name="SOUL.md" />
        </SettingsRow>
        <SettingsRow label="Operating rules" description="Tool policy and how it uses memory">
          <OpenFile name="AGENTS.md" />
        </SettingsRow>
      </SettingsCard>
      <SectionLabel>Memory</SectionLabel>
      <SettingsCard>
        <SettingsRow label="Long-term memory" description="Curated facts it carries between chats">
          <OpenFile name="MEMORY.md" />
        </SettingsRow>
        <SettingsRow label="Daily logs" description="memory/YYYY-MM-DD.md, searched on demand">
          <ValueField icon={<Calendar size={14} />} value="memory/" muted label="Daily logs" />
        </SettingsRow>
      </SettingsCard>
      <SectionLabel>Bring your memory from ChatGPT or Claude Code</SectionLabel>
      <MemoryImportCard />
    </>
  )
}

function Models() {
  const { state, setSetting } = useApp()
  const [key, setKey] = useState('')
  const [openAIKey, setOpenAIKey] = useState('')
  const [claude, setClaude] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    window.bridle.keychain.get('openrouter').then((k) => setKey(k ?? ''), () => {})
    window.bridle.keychain.get('openai').then((k) => setOpenAIKey(k ?? ''), () => {})
    window.bridle.about.claudeBinary().then(setClaude, () => setClaude(null))
  }, [])
  const s_ = state.settings
  if (!s_) return null
  return (
    <>
      <SectionLabel>Provider</SectionLabel>
      <SettingsCard>
        <SettingsRow label="Answer with" description="Where your agent's replies come from">
          <ChoiceMenu label="Provider" value={s_.provider} options={Object.keys(PROVIDERS)} onChange={(v) => setSetting('provider', v as Provider)} />
        </SettingsRow>
      </SettingsCard>
      <SectionLabel>Claude CLI</SectionLabel>
      <SettingsCard>
        <SettingsRow label="Claude Code" description="Runs `claude -p` in your workspace on your subscription">
          <ValueField icon={claude === null ? <CircleX size={14} /> : <CircleCheck size={14} />} muted label="Claude Code"
            value={claude === undefined ? '' : claude ? tilde(claude) : 'Not installed'} />
        </SettingsRow>
        <SettingsRow label="Model">
          <ChoiceMenu label="Claude CLI model" value={s_.model} options={PROVIDERS['Claude CLI'].models} onChange={(v) => setSetting('model', v)} />
        </SettingsRow>
      </SettingsCard>
      <SectionLabel>OpenRouter</SectionLabel>
      <SettingsCard>
        <SettingsRow label="API key" description="Stored in your Keychain">
          <ValueField icon={<Key size={14} />} value={key} onChange={setKey} secure placeholder="sk-or-…" label="OpenRouter API key"
            onCommit={() => window.bridle.keychain.set('openrouter', key).then(
              showSaved, () => play('error', { emphasis: 'subtle' }))} />
        </SettingsRow>
        <SettingsRow label="Model" description="Any id from openrouter.ai/models">
          <SettingField setting="openRouterModel" icon={<Package size={14} />} placeholder="anthropic/claude-sonnet-5.5" label="OpenRouter model" />
        </SettingsRow>
      </SettingsCard>
      <SectionLabel>Local</SectionLabel>
      <SettingsCard>
        <SettingsRow label="Endpoint" description="Ollama, LM Studio or any OpenAI-compatible server">
          <SettingField setting="localEndpoint" icon={<Server size={14} />} placeholder="http://localhost:1234/v1" label="Local endpoint" />
        </SettingsRow>
        <SettingsRow label="Model">
          <SettingField setting="localModel" icon={<Package size={14} />} placeholder="llama3" label="Local model" />
        </SettingsRow>
      </SettingsCard>
      <SectionLabel>Search</SectionLabel>
      <SettingsCard>
        <SettingsRow label="Embeddings" description="On-device stays private; endpoints search better">
          <ChoiceMenu label="Embeddings" value={s_.embeddings} options={['On-device', 'Local endpoint', 'OpenAI']} onChange={(v) => setSetting('embeddings', v)} />
        </SettingsRow>
        {s_.embeddings === 'OpenAI' && (
          <SettingsRow label="OpenAI key" description="For embeddings only. Stored in your Keychain">
            <ValueField icon={<Key size={14} />} value={openAIKey} onChange={setOpenAIKey} secure placeholder="sk-…" label="OpenAI API key"
              onCommit={() => window.bridle.keychain.set('openai', openAIKey).then(
                showSaved, () => play('error', { emphasis: 'subtle' }))} />
          </SettingsRow>
        )}
      </SettingsCard>
    </>
  )
}

/** What each ApprovalPolicy means. */
export const APPROVAL_DETAIL: Record<ApprovalPolicy, string> = {
  'Always ask': 'Sending, scheduling, changing and deleting always ask first',
  'Allow app actions': 'Connected apps can send, post and delete without asking. Commands and files still ask',
  'Allow everything': 'Nothing asks, except sudo, rm -r, git push, piped installs and writes outside your folders'
}

function Tools() {
  const { state, setSetting } = useApp()
  if (!state.settings) return null
  const policy = state.settings.approvalPolicy in APPROVAL_DETAIL ? state.settings.approvalPolicy : 'Always ask'
  return (
    <>
      <SectionLabel>Approvals</SectionLabel>
      <SettingsCard>
        <SettingsRow label="Writes outside the workspace" description={APPROVAL_DETAIL[policy]}>
          <ChoiceMenu label="Approval policy" value={policy} options={Object.keys(APPROVAL_DETAIL)}
            onChange={(v) => setSetting('approvalPolicy', v as ApprovalPolicy)} />
        </SettingsRow>
      </SettingsCard>
      <SectionLabel>MCP servers</SectionLabel>
      <McpServers />
    </>
  )
}

/** Share of space by top-level folder, largest first. */
export function shares(files: { rel: string; size: number }[]): number[] {
  const total = files.reduce((a, f) => a + f.size, 0)
  if (!total) return [1]
  const byTop = new Map<string, number>()
  for (const f of files) {
    const top = f.rel.split('/')[0]
    byTop.set(top, (byTop.get(top) ?? 0) + f.size)
  }
  return [...byTop.values()].sort((a, b) => b - a).map((v) => v / total)
}

function Storage() {
  const ws = useWorkspace()
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<(WorkspaceFile & { rel: string })[]>([])

  useEffect(() => {
    if (!ws) return
    window.bridle.workspace.listFiles().then((all) => setFiles(all
      .map((f) => ({ ...f, rel: f.path.slice(ws.length + 1) }))
      .filter((f) => !f.rel.split('/').some((p) => p.startsWith('.'))) // skip hidden files
      .sort((a, b) => b.modified.localeCompare(a.modified))), () => {})
  }, [ws])

  const total = files.reduce((a, f) => a + f.size, 0)
  const shown = files.filter((f) => !query || f.rel.toLowerCase().includes(query.toLowerCase()))
  const colors = ['var(--brand-400)', 'var(--brand-200)', 'var(--brand-100)', 'var(--border)']

  return (
    <>
      <div className={s.storageHead}>
        <div className={s.storageLine}>
          <span>{files.length} files · {byteCount(total)}</span>
          <Button className={s.wsPath} title="Open in Finder" onClick={() => void window.bridle.workspace.openPath(ws)}>{tilde(ws)}</Button>
        </div>
        <div className={s.shareBar}>
          {shares(files).map((share, i) => <span key={i} style={{ flexGrow: share, background: colors[Math.min(i, 3)] }} />)}
        </div>
      </div>
      <label className={s.storageSearch}>
        <Search size={14} />
        <input placeholder="Search files" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search files" />
      </label>
      <SettingsCard>
        {shown.length === 0 && <SettingsRow label={files.length === 0 ? 'The workspace is empty.' : 'No files match your search.'} />}
        {shown.map((f) => (
          <Button key={f.path} cue={null} className={s.storageRow} onClick={() => viewer.open(f.path)}>
            <FileIcon size={18} color="var(--tertiary)" />
            <span className={s.storageText}>
              <span>{f.name}</span>
              <span>{f.rel}</span>
            </span>
            <span className={s.storageSize}>{byteCount(f.size)}</span>
          </Button>
        ))}
      </SettingsCard>
    </>
  )
}

export const PAGES: Record<SettingsPage, ComponentType> = {
  general: General,
  profile: Profile,
  agent: Agent,
  models: Models,
  connections: ConnectionsPage,
  tools: Tools,
  automations: AutomationsPage,
  storage: Storage
}
