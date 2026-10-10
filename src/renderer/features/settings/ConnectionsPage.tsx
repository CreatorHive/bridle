import { useEffect, useLayoutEffect as useLayoutEffectReact, useRef, useState, type ReactNode } from 'react'
import {
  Calendar, Check, ChevronsUpDown, CodeXml, Contrast, Ellipsis, FileText, HardDrive, Key, ListChecks, Mail, MessageSquare,
  Presentation, Sheet, TriangleAlert, Video, type LucideIcon
} from 'lucide-react'
import { SERVICES, TOOLKITS, type Account, type LinkProgress, type Service, type Toolkit, type WatcherStatus } from '../../../shared/types'
import { Menu, Pill, SectionLabel, SettingsCard, SettingsRow, Toggle } from '../../components'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import { logos } from '../../theme'
import { currentStep, expiredOf, toolkitsOf, useConnections } from './connections'
import { SettingField, ValueField } from './ValueField'
import s from './settings.module.css'

/** useLayoutEffect in the app; quiet under server rendering (tests). */
const useLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffectReact

const TOOLKIT_ICON: Record<Toolkit, LucideIcon> = {
  gmail: Mail, googlecalendar: Calendar, googledrive: HardDrive, googledocs: FileText, googlesheets: Sheet,
  googleslides: Presentation, googlemeet: Video, googletasks: ListChecks, github: CodeXml, linear: Contrast
}
export const ORANGE = '#f08c00'

/** 32px circle at the head of a connection row: photo or initial with the service logo in the corner, or just the logo. */
export function ServiceBadge({ service, account }: { service: Service; account?: Account }) {
  if (!account) {
    return <span className={`${s.badge} ${s.logoBadge}`}><img src={logos[service]} alt="" width={20} height={20} /></span>
  }
  return (
    <span className={s.badge}>
      {account.photo ? (
        <img className={s.photo} src={account.photo} alt=""
          onError={(e) => { e.currentTarget.replaceWith(document.createTextNode(account.login.slice(0, 1).toUpperCase())) }} />
      ) : account.login.slice(0, 1).toUpperCase()}
      <img className={s.corner} src={logos[service]} alt="" width={12} height={12} />
    </span>
  )
}

/** Toolkit pill: tinted when linked, orange when it needs reconnecting. */
export function ToolkitChip({ toolkit, expired, checked, iconOnly, dim }: {
  toolkit: Toolkit
  expired?: boolean
  checked?: boolean
  iconOnly?: boolean
  dim?: boolean
}) {
  const tint = expired ? ORANGE : TOOLKITS[toolkit].tint
  const Icon = expired ? TriangleAlert : checked ? Check : TOOLKIT_ICON[toolkit]
  return (
    <span className={`${s.toolkit} ${dim ? s.dim : ''}`} title={expired ? `${TOOLKITS[toolkit].name} needs reconnecting` : TOOLKITS[toolkit].name}
      style={{ color: tint, background: `color-mix(in srgb, ${tint} 10%, transparent)` }}>
      <Icon size={10} strokeWidth={2.6} />
      {!iconOnly && TOOLKITS[toolkit].name}
    </span>
  )
}

/** SettingsRow geometry with a badge in front (a spinner while connecting). */
function ConnectionRow({ badge, title, detail, trailing }: { badge: ReactNode; title: string; detail: ReactNode; trailing: ReactNode }) {
  return (
    <div className={s.connectionRow}>
      {badge ?? <span className={s.badgeSpinner}><span className="b-spinner" /></span>}
      <div className={s.connectionText}>
        <span>{title}</span>
        {detail}
      </div>
      <div className={s.trailing}>{trailing}</div>
    </div>
  )
}

const Hint = ({ children, color }: { children: ReactNode; color?: string }) => <span className={s.hint} style={{ color }}>{children}</span>

/** Google's toolkit chips, named when they fit and icons only when they don't. */
function Chips({ account }: { account: Account }) {
  const row = useRef<HTMLDivElement>(null)
  const [iconOnly, setIconOnly] = useState(false)
  const kits = toolkitsOf(account)
  const expired = expiredOf(account)
  useLayoutEffect(() => setIconOnly(false), [kits.join()])
  useLayoutEffect(() => {
    const el = row.current
    if (el && !iconOnly && el.scrollWidth > el.clientWidth) setIconOnly(true)
  })
  return (
    <div ref={row} className={s.chips}>
      {kits.map((t) => <ToolkitChip key={t} toolkit={t} expired={expired.includes(t)} iconOnly={iconOnly} />)}
    </div>
  )
}

function AccountRow({ account, c }: { account: Account; c: ReturnType<typeof useConnections> }) {
  const linking = c.pending?.account === account.id ? c.pending : null
  const expired = expiredOf(account)
  const unlinked = SERVICES[account.service].all.filter((t) => !toolkitsOf(account).includes(t))
  const name = SERVICES[account.service].name
  return (
    <ConnectionRow
      badge={<ServiceBadge service={account.service} account={account} />}
      title={account.login}
      detail={linking ? (
        <span className={s.linking}><span className="b-spinner" /><Hint>Linking {TOOLKITS[currentStep(linking)].name}. Finish in your browser</Hint></span>
      ) : account.service === 'google' ? (
        <Chips account={account} />
      ) : expired.length === 0 ? <Hint>{name}</Hint> : <Hint color={ORANGE}>{name} · needs reconnecting</Hint>}
      trailing={<>
        {linking ? (
          <Pill onClick={c.cancel}>Cancel</Pill>
        ) : expired.length > 0 && (
          <Pill filled disabled={!!c.pending} onClick={() => void c.reconnect(account)}>Reconnect</Pill>
        )}
        <Menu label={`Options for ${account.login}`} trigger={<span className={s.ellipsis}><Ellipsis size={15} strokeWidth={2.6} /></span>}
          items={[
            ...unlinked.map((t) => {
              const Icon = TOOLKIT_ICON[t]
              return { label: `Link ${TOOLKITS[t].name}`, icon: <Icon size={14} />, disabled: !!c.pending, onSelect: () => void c.linkMore(t, account) }
            }),
            { label: `Disconnect ${account.login}`, destructive: true, onSelect: () => void c.disconnect(account) }
          ]} />
      </>}
    />
  )
}

/** A new account mid-consent: which toolkits are done, and which one the browser is on. */
function PendingRow({ link, cancel }: { link: LinkProgress; cancel: () => void }) {
  return (
    <ConnectionRow badge={null} title={`Connecting ${SERVICES[link.service].name}`}
      detail={link.steps.length > 1 ? (
        <span className={s.chips}>
          {link.steps.map((t, i) => <ToolkitChip key={t} toolkit={t} checked={i < link.done} dim={i > link.done} />)}
          <Hint>{TOOLKITS[currentStep(link)].name}: finish in your browser</Hint>
        </span>
      ) : <Hint>Finish signing in in your browser</Hint>}
      trailing={<Pill onClick={cancel}>Cancel</Pill>} />
  )
}

function AddRow({ service, another, c }: { service: Service; another: boolean; c: ReturnType<typeof useConnections> }) {
  const { name, blurb } = SERVICES[service]
  return (
    <ConnectionRow badge={<ServiceBadge service={service} />}
      title={another ? `Add another ${name} account` : `Connect ${name}`}
      detail={<Hint>{service === 'google' ? `${blurb}. More apps link when needed` : blurb}</Hint>}
      trailing={<Pill filled={!another} disabled={!!c.pending} onClick={() => void c.add(service)}>Connect</Pill>} />
  )
}

/** Accounts per service, "Needs you" (the watcher), and the Composio key. */
export function ConnectionsPage() {
  const c = useConnections()
  const { state, setSetting } = useApp()
  const [composioKey, setComposioKey] = useState('')
  const [status, setStatus] = useState<WatcherStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [awayTest, setAwayTest] = useState<string | null>(null)
  const [keySource, setKeySource] = useState<'keychain' | 'environment' | null>(null)

  useEffect(() => {
    void c.refresh()
    window.bridle.keychain.get('composio').then((k) => setComposioKey(k ?? ''), () => {})
    window.bridle.about.composioKeySource().then(setKeySource, () => {})
    const poll = () => window.bridle.watcher.status().then(setStatus, () => {})
    void poll()
    const timer = setInterval(poll, 5000)
    return () => clearInterval(timer)
  }, [])

  const settings = state.settings
  if (!settings) return null

  const section = (service: Service) => {
    const accounts = c.accounts.filter((a) => a.service === service)
    return [
      ...accounts.map((a) => <AccountRow key={a.id} account={a} c={c} />),
      c.pending && c.pending.service === service && c.pending.account === null && <PendingRow key="pending" link={c.pending} cancel={c.cancel} />,
      <AddRow key={`add-${service}`} service={service} another={accounts.length > 0} c={c} />
    ].filter(Boolean)
  }

  const checkNow = async () => {
    setChecking(true)
    try {
      setStatus(await window.bridle.watcher.checkNow())
    } catch {
      play('error', { emphasis: 'subtle' })
    }
    setChecking(false)
  }

  const sendAwayTest = async () => {
    setAwayTest('Sending…')
    const error = await window.bridle.away.send("From Bridle: this is how I'll reach you when you're away from your Mac.")
      .catch((e: Error) => e.message)
    setAwayTest(error ? `Couldn't send: ${error}` : 'Sent. Check your phone.')
    play(error ? 'error' : 'success', { emphasis: 'subtle' })
  }

  const isChecking = checking || !!status?.checking
  const lastCheck = status?.lastChecked
    ? `${new Date(status.lastChecked).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ${status.lastResult ?? ''}`
    : 'Checks every 5 minutes while Bridle is open, and when you switch back to it'
  const hour = (h: number) => `${h}:00 AM`

  return (
    <>
      {c.error && <div className={s.error}><TriangleAlert size={13} />{c.error}</div>}
      <SectionLabel>Google</SectionLabel>
      <SettingsCard>{section('google')}</SettingsCard>
      <SectionLabel>Developer</SectionLabel>
      <SettingsCard>{[...section('github'), ...section('linear')]}</SettingsCard>

      <SectionLabel>Needs you</SectionLabel>
      <SettingsCard>
        <SettingsRow label="Message me first" description="When new mail or an invite needs you, say so in chat with a next step. Up to 5 a day, never 9 PM–8 AM">
          <Toggle label="Message me first" checked={settings.watchEnabled} onChange={(v) => setSetting('watchEnabled', v)} />
        </SettingsRow>
        <SettingsRow label="Morning briefing" description="What's on today, what needs you, and the first step, in Home">
          <span className={s.inline}>
            <span className={settings.briefingEnabled ? undefined : s.disabled}>
              <Menu label="Briefing time" trigger={<span className={s.compactMenu}>{hour(settings.briefingHour)}<ChevronsUpDown size={11} /></span>}
                items={[6, 7, 8, 9, 10, 11].map((h) => ({
                  label: hour(h), checked: h === settings.briefingHour, onSelect: () => setSetting('briefingHour', h)
                }))} />
            </span>
            <Toggle label="Morning briefing" checked={settings.briefingEnabled} onChange={(v) => setSetting('briefingEnabled', v)} />
          </span>
        </SettingsRow>
        <SettingsRow label="Meeting prep" description="A short brief in Home 5–20 minutes before meetings with other people">
          <Toggle label="Meeting prep" checked={settings.prepEnabled} onChange={(v) => setSetting('prepEnabled', v)} />
        </SettingsRow>
        <SettingsRow label="Text me when I'm away" description="After 5 idle minutes, Home's messages also go to your phone as an iMessage">
          <Toggle label="Text me when I'm away" checked={settings.awayEnabled} onChange={(v) => setSetting('awayEnabled', v)} />
        </SettingsRow>
        {settings.awayEnabled && (
          <SettingsRow label="Your iMessage" description={awayTest ?? 'The phone number or Apple ID email your iPhone gets iMessages on'}>
            <span className={s.inline}>
              <SettingField setting="awayHandle" icon={<MessageSquare size={14} />} placeholder="+1 555 0100 or you@icloud.com" label="Your iMessage" />
              <Pill disabled={!settings.awayHandle} onClick={() => void sendAwayTest()}>Send test</Pill>
            </span>
          </SettingsRow>
        )}
        <SettingsRow label="Last check" description={lastCheck}>
          <span className={s.inline}>
            <Pill disabled={isChecking || !settings.watchEnabled}
              onClick={() => void window.bridle.watcher.briefNow().catch(() => play('error', { emphasis: 'subtle' }))}>Brief me now</Pill>
            <Pill disabled={isChecking || !settings.watchEnabled} onClick={() => void checkNow()}>{isChecking ? 'Checking…' : 'Check now'}</Pill>
          </span>
        </SettingsRow>
      </SettingsCard>

      <SectionLabel>Composio</SectionLabel>
      <SettingsCard>
        <SettingsRow label="Project API key"
          description={composioKey ? 'Saved in your Keychain. Press Return after changing it'
            : keySource === 'environment' ? 'Using COMPOSIO_API_KEY from the environment' : 'From your Composio project. Saved in your Keychain'}>
          <ValueField icon={<Key size={14} />} value={composioKey} onChange={setComposioKey} secure placeholder="ak_…" label="Composio project API key"
            onCommit={() => {
              window.bridle.keychain.set('composio', composioKey).then(() => {
                play('success', { emphasis: 'subtle' })
                void c.refresh()
                window.bridle.about.composioKeySource().then(setKeySource, () => {})
              }, () => play('error', { emphasis: 'subtle' }))
            }} />
        </SettingsRow>
      </SettingsCard>
    </>
  )
}
