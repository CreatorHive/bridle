import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Calendar, CodeXml, FileText, Mail } from 'lucide-react'
import { reducedMotion } from '../../components'
import { logos } from '../../theme'
import { DEMO_STEPS, stepDelay, type Demo } from './script'
import s from './onboarding.module.css'

// What Bridle does with your mail, calendar and code, played a step at a time
// (each step a 0.45 s spring). Sample content only.

const RED = '#ff3b30' // macOS system red

const BLUE = '#1A73E8'
const PURPLE = '#8E44D9'
const BLOCKS: { color: string; height: number; invite?: boolean }[][] = [
  [{ color: BLUE, height: 14 }, { color: PURPLE, height: 24 }],
  [{ color: BLUE, height: 26, invite: true }, { color: BLUE, height: 12 }],
  [{ color: PURPLE, height: 18 }],
  [{ color: BLUE, height: 12 }, { color: BLUE, height: 12 }, { color: PURPLE, height: 16 }],
  [{ color: PURPLE, height: 30 }]
]
const LINES: [string, string][] = [
  ['$ swift test', 'rgba(255,255,255,0.85)'],
  ['✗ parsesGmailSenders: quoted names', '#FF6B6B'],
  ['  fixed parse() in Connections.swift', 'rgba(255,255,255,0.6)'],
  ['$ swift test', 'rgba(255,255,255,0.85)'],
  ['✓ 16 tests passed', '#51CF66']
]

/** `glow`: the step's point of attention, with a soft blue ring. */
export const pill = (title: string, filled: boolean, o: { small?: boolean; glow?: boolean } = {}) => (
  <span className={`${s.dPill} ${filled ? s.dFilled : ''} ${o.small ? s.dSmall : ''} ${o.glow ? s.dGlow : ''}`}>{title}</span>
)

export const source = (icon: ReactNode, title: string, when?: string) => (
  <div className={s.dSource}>{icon}<span>{title}</span><span className={s.spacer} />{when && <span className={s.dWhen}>{when}</span>}</div>
)

export function DemoCard({ demo }: { demo: Demo }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (reducedMotion()) return setStep(DEMO_STEPS[demo])
    let at = 0
    const timers = Array.from({ length: DEMO_STEPS[demo] }, (_, i) => {
      at += stepDelay(demo, i + 1)
      return setTimeout(() => setStep(i + 1), at)
    })
    return () => timers.forEach(clearTimeout)
  }, [demo])

  return (
    <div className={s.demo}>
      {demo === 'mail' && (
        <>
          {source(<img src={logos.google} alt="" className={s.dIcon} />, 'Gmail · you@work.com', '2m')}
          <p className={s.dText}>Russell is waiting on the zip file for the site signup. <span style={{ color: BLUE }}>Open email</span></p>
          {step >= 2 && (
            <div className={`${s.dPanel} ${s.stepIn}`}>
              <div className={s.dPanelTitle}><Mail size={14} />Send this email?</div>
              <div className={s.dField}><span>To</span>Russell Johnson</div>
              <div className={s.dField}><span>Subject</span>Re: Site setup</div>
              <p className={s.dBody}>Hi Russell, the zip is attached. Setup takes about ten minutes…</p>
              <div className={s.dPills}>
                {pill('Send', true, { glow: step >= 3 })}
                {pill('Edit', false)}
                {step >= 3 && <span className={`${s.dNote} ${s.stepFade}`}>Nothing sends until you press it</span>}
              </div>
            </div>
          )}
        </>
      )}

      {demo === 'calendar' && (
        <>
          {source(<Calendar className={s.dIcon} />, 'Google Calendar · this week')}
          <div className={s.week}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, i) => (
              <div key={day} className={s.day}>
                <span style={{ color: i === 1 ? RED : undefined }}>{day}</span>
                {BLOCKS[i].map((b, j) => (!b.invite || step >= 2) && (
                  <span key={j} className={`${s.block} ${b.invite ? s.grow : ''}`} style={{
                    height: `calc(${b.height}px * var(--k))`,
                    '--c': b.color,
                    background: `color-mix(in srgb, ${b.color} ${b.invite && step < 3 ? 8 : 18}%, transparent)`,
                    outlineColor: `color-mix(in srgb, ${b.color} ${b.invite && step < 3 ? 70 : 0}%, transparent)`
                  } as CSSProperties} />
                ))}
              </div>
            ))}
          </div>
          {step >= 2 && (
            <div className={`${s.dPanel} ${s.dInvite} ${s.stepIn}`}>
              <div className={s.dInviteText}>
                <strong>Phase 1 Kickoff</strong>
                <span key={step >= 3 ? 'going' : 'from'} className={step >= 3 ? s.stepFade : undefined}
                  style={{ color: step >= 3 ? '#1E9E5A' : undefined }}>{step >= 3 ? "Tue 10:00 · you're going" : 'Tue 10:00 · from Brooke'}</span>
              </div>
              <span className={s.spacer} />
              {pill('Yes', step >= 3, { small: true, glow: step >= 3 })}
              {pill('No', false, { small: true })}
              {pill('Maybe', false, { small: true })}
            </div>
          )}
        </>
      )}

      {demo === 'code' && (
        <>
          <div className={s.dSource}>
            <CodeXml className={s.dIcon} />
            <span>Bridle Code · bridle</span>
            <span className={s.branch}>bridle/naples</span>
          </div>
          <div className={s.terminal}>
            {LINES.map(([text, color], i) => step > i && <div key={i} className={s.slide} style={{ color }}>{text}</div>)}
            {step <= LINES.length && <span className={s.cursor} />}
          </div>
          {step >= 6 && (
            <div className={`${s.change} ${s.stepIn}`}>
              <FileText className={s.dIcon} />
              <span className={s.mono}>Connections.swift</span>
              <span className={s.diff}><span style={{ color: '#1E9E5A' }}>+3</span> <span style={{ color: RED }}>−1</span></span>
              <span className={s.spacer} />
              {pill('Review', true, { small: true, glow: true })}
              {pill('Undo', false, { small: true })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
