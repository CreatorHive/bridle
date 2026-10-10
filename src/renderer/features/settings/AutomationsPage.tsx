import { useCallback, useEffect, useState } from 'react'
import type { Loop, Routine } from '../../../shared/types'
import { Pill, SectionLabel, SettingsCard, SettingsRow, Toggle } from '../../components'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import s from './settings.module.css'

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'never'

/** Settings → Automations: Routines (routines/*.md) and Loops (loops/<name>/). Ask the agent to make them
 *  ("every weekday at 8, tell me what's on"); here you turn them on, run them, and approve loop scripts. */
export function AutomationsPage() {
  const { go, patch } = useApp()
  const [routines, setRoutines] = useState<Routine[] | null>(null)
  const [loops, setLoops] = useState<Loop[] | null>(null)
  const [showing, setShowing] = useState<string | null>(null)

  const reload = useCallback(() => {
    window.bridle.automations.routines().then(setRoutines, () => setRoutines([]))
    window.bridle.automations.loops().then(setLoops, () => setLoops([]))
  }, [])
  useEffect(reload, [reload])

  const act = (p: Promise<unknown>) => p.then(reload, () => play('error'))
  const openChat = (chatId: string) => {
    patch({ settingsOpen: false })
    go('chat', chatId)
  }

  return (
    <>
      <SectionLabel>Routines</SectionLabel>
      <SettingsCard>
        {routines?.length === 0 && (
          <SettingsRow label="No routines yet"
            description={'Ask Bridle: "every weekday at 8, tell me what\'s on today". It writes routines/<name>.md.'} />
        )}
        {routines?.map((r) => (
          <SettingsRow key={r.slug} label={r.title}
            description={r.valid ? `${r.when} · last ran ${when(r.lastRun)}` : `"${r.when || 'no schedule'}" isn't a schedule, try "weekdays 08:00"`}>
            <div className={s.automationActions}>
              {r.chatId && <Pill cue={null} onClick={() => openChat(r.chatId!)}>Chat</Pill>}
              <Pill onClick={() => void act(window.bridle.automations.runNow('routine', r.slug))}>Run now</Pill>
              <Toggle label={`${r.title} on`} checked={r.enabled}
                onChange={(on) => void act(window.bridle.automations.setEnabled('routine', r.slug, on))} />
            </div>
          </SettingsRow>
        ))}
      </SettingsCard>

      <SectionLabel>Loops</SectionLabel>
      <SettingsCard>
        {loops?.length === 0 && (
          <SettingsRow label="No loops yet"
            description={'Ask Bridle: "watch my repo\'s releases and tell me when a new one ships". A loop runs a small script, no AI, and wakes Bridle only when its output changes.'} />
        )}
        {loops?.map((l) => (
          <div key={l.slug}>
            <SettingsRow label={l.title}
              description={!l.script ? 'No check.sh yet'
                : !l.approved ? 'Its script changed or is new: read it, then approve it to let it run'
                : `Every ${l.every} · last check ${when(l.lastRun)}`}>
              <div className={s.automationActions}>
                <Pill cue={null} onClick={() => setShowing(showing === l.slug ? null : l.slug)}>{showing === l.slug ? 'Hide script' : 'Script'}</Pill>
                {l.chatId && <Pill cue={null} onClick={() => openChat(l.chatId!)}>Chat</Pill>}
                {l.approved
                  ? <Pill onClick={() => void act(window.bridle.automations.runNow('loop', l.slug))}>Check now</Pill>
                  : l.script && <Pill filled onClick={() => void act(window.bridle.automations.approve(l.slug))}>Approve</Pill>}
                <Toggle label={`${l.title} on`} checked={l.enabled}
                  onChange={(on) => void act(window.bridle.automations.setEnabled('loop', l.slug, on))} />
              </div>
            </SettingsRow>
            {showing === l.slug && (
              <div className={s.script}>
                <pre>{l.script || '(empty)'}</pre>
                {l.lastOutput && <><span>Last output</span><pre>{l.lastOutput}</pre></>}
              </div>
            )}
          </div>
        ))}
      </SettingsCard>
    </>
  )
}
