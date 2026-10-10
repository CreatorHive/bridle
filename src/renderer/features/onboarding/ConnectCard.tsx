import { useEffect } from 'react'
import { CircleCheck, TriangleAlert } from 'lucide-react'
import { SERVICES, TOOLKITS, type Service } from '../../../shared/types'
import { Button } from '../../components'
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

  useEffect(() => {
    void c.refresh()
  }, [])

  // Signing in happens in the browser, which would otherwise sit under the onboarding window.
  useEffect(() => {
    void window.bridle.onboarding.stepAside(!!c.pending)
  }, [!!c.pending])

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
        <Button cue={null} className={`${s.choice} ${connected.length ? s.primary : ''}`}
          onClick={() => {
            if (c.pending) c.cancel()
            onDone(connectReply(connected.map((sv) => SERVICES[sv].name)))
          }}>
          {connected.length ? 'Continue' : 'Skip for now'}
        </Button>
      </div>
    </div>
  )
}
