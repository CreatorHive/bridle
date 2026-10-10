import { useEffect, useState } from 'react'
import { CircleCheck, KeyRound, TriangleAlert } from 'lucide-react'
import { SERVICES, TOOLKITS, type Service } from '../../../shared/types'
import { Button } from '../../components'
import { play } from '../../sound'
import { errorText } from '../tasks/logic'
import { logos } from '../../theme'
import { currentStep, useConnections } from '../settings/connections'
import { connectReply } from './script'
import s from './onboarding.module.css'

const ALL: Service[] = ['google', 'github', 'linear']

/** One row per service, each running the real Connect Link flow.
 *  `onDone` gets the reply shown as your message. */
export function ConnectCard({ onDone }: { onDone: (reply: string) => void }) {
  const c = useConnections()
  const connected = ALL.filter((sv) => c.accounts.some((a) => a.service === sv))
  // Connecting runs through Composio, which needs a project key; a fresh install has none (undefined: still checking).
  const [hasKey, setHasKey] = useState<boolean>()
  const [key, setKey] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.bridle.about.composioKeySource().then((source) => {
      setHasKey(source !== null)
      if (source) void c.refresh()
    }, () => setHasKey(false))
  }, [])

  /** Saves the key, then checks it against Composio; a key Composio refuses is taken back out. */
  const saveKey = async () => {
    const value = key.trim()
    if (!value || saving) return play('error', { emphasis: 'subtle' })
    setSaving(true)
    setKeyError(null)
    try {
      await window.bridle.keychain.set('composio', value)
      await window.bridle.composio.accounts()
      play('success', { emphasis: 'subtle' })
      setHasKey(true)
      void c.refresh()
    } catch (e) {
      await window.bridle.keychain.set('composio', '').catch(() => {})
      setKeyError(errorText(e))
      play('error')
    }
    setSaving(false)
  }

  // Signing in happens in the browser, which would otherwise sit under the onboarding window.
  useEffect(() => {
    void window.bridle.onboarding.stepAside(!!c.pending)
  }, [!!c.pending])

  const skip = (
    <Button cue={null} className={`${s.choice} ${connected.length ? s.primary : ''}`}
      onClick={() => {
        if (c.pending) c.cancel()
        onDone(connectReply(connected.map((sv) => SERVICES[sv].name)))
      }}>
      {connected.length ? 'Continue' : 'Skip for now'}
    </Button>
  )

  if (hasKey === false) {
    return (
      <div className={s.connect}>
        <div className={s.connectRows}>
          <div className={s.connectRow}>
            <KeyRound size={22} className={s.keyIcon} />
            <div className={s.connectText}>
              <strong>Connections run through Composio</strong>
              <span>A free project key lets me reach Google, GitHub and Linear for you.</span>
            </div>
            <Button className={s.cancel} onClick={() => void window.bridle.shell.openExternal('https://platform.composio.dev')}>Get a key ↗</Button>
          </div>
          <form className={s.connectRow} onSubmit={(e) => { e.preventDefault(); void saveKey() }}>
            <input className={s.keyInput} type="password" value={key} placeholder="Paste your Composio API key" aria-label="Composio API key"
              spellCheck={false} autoFocus onChange={(e) => setKey(e.target.value)} />
            {saving ? <span className="b-spinner" /> : <Button type="submit" className={s.connectButton} disabled={!key.trim()}>Save</Button>}
          </form>
        </div>
        <div className={s.connectFoot}>
          {keyError && <span className={s.connectError}><TriangleAlert size={12} />{keyError}</span>}
          <span className={s.spacer} />
          {skip}
        </div>
      </div>
    )
  }

  return (
    <div className={s.connect}>
      <div className={s.connectRows}>
        {ALL.map((service) => {
          const accounts = c.accounts.filter((a) => a.service === service)
          const pending = c.pending?.service === service ? c.pending : null
          return (
            <div key={service} className={s.connectRow}>
              <img src={logos[service]} alt="" width={28} height={28} />
              <div className={s.connectText}>
                <strong>{SERVICES[service].name}</strong>
                <span>
                  {pending
                    ? pending.steps.length > 1
                      ? `${TOOLKITS[currentStep(pending)].name} (${pending.done + 1} of ${pending.steps.length}): finish in your browser`
                      : 'Finish signing in in your browser'
                    : accounts.length > 1 ? `${accounts[0].login} and ${accounts.length - 1} more`
                    : accounts[0]?.login ?? SERVICES[service].blurb}
                </span>
              </div>
              {pending ? (
                <>
                  <span className="b-spinner" />
                  <Button cue="close" className={s.cancel} onClick={c.cancel}>Cancel</Button>
                </>
              ) : accounts.length ? (
                <CircleCheck size={20} color="#fff" fill="#34C759" aria-label="Connected" />
              ) : (
                <Button className={s.connectButton} disabled={!!c.pending} onClick={() => void c.add(service)}>Connect</Button>
              )}
            </div>
          )
        })}
      </div>
      <div className={s.connectFoot}>
        {c.error && <span className={s.connectError}><TriangleAlert size={12} />{c.error}</span>}
        <span className={s.spacer} />
        {skip}
      </div>
    </div>
  )
}
