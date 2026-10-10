import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowRight, ArrowUp, Volume2, VolumeX, X } from 'lucide-react'
import { useApp } from '../../app/store'
import { reducedMotion, spring, usePresence } from '../../components'
import { play, setMuted } from '../../sound'
import { logos } from '../../theme'
import { playAmbience, stopAmbience } from './ambience'
import { ConnectCard } from './ConnectCard'
import { DemoCard } from './Demos'
import { runScript, typingTime, type Demo, type Prompt } from './script'
import { Showcase } from './Showcase'
import s from './onboarding.module.css'

// The screen dims into blue light, the mark rises in with a welcome and Start, then travels up
// to head a conversation that names the agent and you, shows what it does, and connects your accounts.
// Sounds: the cuelume cue closest in job and shape to each designed one: tap (1.3 kHz FM blip) → tap; chirp
// (rising 1.2→1.5 kHz, a line arrived) → ready, subtle; toggleOff (falling 780→420 Hz) → toggle, direction -1;
// close (falling triangle) → close. Unmuting plays cuelume's toggle.

// The script's springs (duration = response, no bounce), as CSS vars for the stylesheet.
const SPRINGS = Object.fromEntries([['30', 0.3], ['35', 0.35], ['45', 0.45]].flatMap(([k, r]) => {
  const m = spring(r as number, 1)
  return [[`--e${k}`, m.easing], [`--d${k}`, `${m.duration}ms`]]
})) as CSSProperties

type Stage = 'dim' | 'welcome' | 'starting' | 'header'
interface Line {
  id: number
  sender: string | null // null = you
  text: string
  demo?: Demo
}

const MARK = 80
const HEADER_Y = 44
const STOP = Symbol('unmounted')
let nextLine = 0

// Light field gradients (fade / blend): eased alpha falloff with no visible band.
const CURVE: [number, number][] = [[0, 1], [0.19, 0.738], [0.34, 0.541], [0.47, 0.382], [0.565, 0.278], [0.65, 0.194],
  [0.73, 0.126], [0.802, 0.075], [0.861, 0.042], [0.91, 0.021], [0.952, 0.008], [0.982, 0.002], [1, 0]]
const rgba = (hex: string, a: number) => `rgb(${parseInt(hex.slice(1, 3), 16)} ${parseInt(hex.slice(3, 5), 16)} ${parseInt(hex.slice(5, 7), 16)} / ${a.toFixed(3)})`
const fade = (hex: string, hi: number, lo = 0, a = 0, b = 1) =>
  CURVE.map(([u, v]) => `${rgba(hex, lo + (hi - lo) * v)} ${((a + (b - a) * u) * 100).toFixed(2)}%`)
const blend = (x: string, y: string, a: number, b: number) =>
  [[0, 0], [0.25, 0.156], [0.5, 0.5], [0.75, 0.844]].map(([u, t]) =>
    `color-mix(in oklab, ${x}, ${y} ${(t * 100).toFixed(1)}%) ${((a + (b - a) * u) * 100).toFixed(2)}%`)
const C = { c25: '#E1F9FF', c100: '#8CBFFF', c200: '#619EFF', c300: '#3B7CFF', c800: '#041756' }
const VEIL = `linear-gradient(to bottom, ${fade(C.c800, 0.78, 0.34).join(', ')})`
const HORIZON = `radial-gradient(closest-side, ${[
  ...blend(rgba(C.c25, 0.95), rgba(C.c100, 0.75), 0, 0.3),
  ...blend(rgba(C.c100, 0.75), rgba(C.c300, 0.4), 0.3, 0.62),
  ...fade(C.c300, 0.4, 0, 0.62, 1)
].join(', ')})`
const BLOOM = `radial-gradient(closest-side, ${fade(C.c200, 0.55).join(', ')})`

/** Deep blue veil over the app, light welling up from the bottom edge, two softer blooms drifting in the corners. */
function LightField({ on }: { on: boolean }) {
  return (
    <div className={s.field} style={{ opacity: on ? 1 : 0 }} aria-hidden>
      <div className={s.veil} style={{ background: VEIL }} />
      <div className={s.horizon} style={{ background: HORIZON }} />
      <div className={`${s.bloom} ${s.bloomLeft}`} style={{ background: BLOOM }} />
      <div className={`${s.bloom} ${s.bloomRight}`} style={{ background: BLOOM }} />
    </div>
  )
}

/** The agent's mark: a lit sphere that breathes while it thinks. */
const Mark = ({ thinking, size }: { thinking: boolean; size: number }) => (
  <img src={logos.bridle} alt="" width={size} height={size} className={`${s.mark} ${thinking ? s.thinking : ''}`} />
)

export function Onboarding() {
  const { state, setSetting } = useApp()
  const muted = state.settings?.soundMuted ?? false
  const reduce = reducedMotion()

  const [height, setHeight] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight))
  const [stage, setStage] = useState<Stage>('dim')
  const [fieldOn, setFieldOn] = useState(false)
  const [markIn, setMarkIn] = useState(false)
  const [titleIn, setTitleIn] = useState(false)
  const [startIn, setStartIn] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [typing, setTyping] = useState(false)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [input, setInput] = useState('')
  const [speaker, setSpeaker] = useState('Bridle')
  const [closing, setClosing] = useState(false)
  const [showcase, setShowcase] = useState(false)
  const showcaseDone = useRef<(() => void) | null>(null)
  // The prompt slides back down as you answer (its removal transition), so the last one stays drawn a moment.
  const lastPrompt = useRef<Prompt | null>(null)
  if (prompt) lastPrompt.current = prompt
  const promptShown = usePresence(!!prompt, 350)
  const shownPrompt = prompt ?? (promptShown.leaving ? lastPrompt.current : null)

  const begin = useRef<(() => void) | null>(null)
  const answer = useRef<((text: string) => void) | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const thread = useRef<HTMLDivElement>(null)

  // Hiding: the page fades out over 0.6 s, then main sets `onboarded` and closes the window.
  const finish = () => {
    if (closing) return
    play('close')
    stopAmbience()
    setClosing(true)
    setTimeout(() => void window.bridle.onboarding.finish(), reduce ? 0 : 600)
  }

  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // The intro, then the script. Every pause stops the run if the screen went away.
  useEffect(() => {
    let alive = true
    let who = 'Bridle'
    const sleep = (s: number) => new Promise<void>((res, rej) => setTimeout(() => (alive ? res() : rej(STOP)), s * 1000))
    if (!muted) playAmbience()

    const intro = async () => {
      setFieldOn(true)
      await sleep(0.8)
      setStage('welcome')
      setMarkIn(true)
      await sleep(0.3)
      setTitleIn(true)
      await sleep(0.15)
      setStartIn(true)
      await sleep(0.15)
      setThinking(true)
      // Start, or Start left alone for a while.
      await Promise.race([new Promise<void>((res) => (begin.current = res)), sleep(2)])
      begin.current = null
      setStage('starting')
      setThinking(false)
      await sleep(0.2)
      setStage('header')
      await sleep(0.7)
    }

    const run = async () => {
      await intro()
      await runScript({
        say: async (text, demo) => {
          setTyping(true)
          await sleep(typingTime(text) / 1000)
          setTyping(false)
          setLines((l) => [...l, { id: nextLine++, sender: who, text, demo }])
          play('ready', { emphasis: 'subtle' })
          await sleep(0.15)
        },
        showcase: async () => {
          await sleep(0.5)
          await new Promise<void>((res) => {
            showcaseDone.current = res
            setShowcase(true)
          })
        },
        ask: (p) => new Promise<string>((res) => {
          answer.current = res
          setPrompt(p)
        }),
        setAgentName: (name) => {
          who = name
          setSpeaker(name)
          setSetting('agentName', name)
        },
        setUserName: (name) => setSetting('userName', name)
      })
      if (alive) finish()
    }
    run().catch((e) => {
      if (e !== STOP) throw e
    })
    return () => {
      alive = false
      stopAmbience()
    }
  }, [])

  /** `echo: false` answers without a bubble of yours (Next after a demo). */
  const reply = (raw: string, echo = true) => {
    const text = raw.trim()
    const resolve = answer.current
    if (!text || !resolve) return
    play('tap')
    if (echo) setLines((l) => [...l, { id: nextLine++, sender: null, text }])
    setPrompt(null)
    setInput('')
    answer.current = null
    resolve(text)
  }

  const pressStart = () => {
    if (stage !== 'welcome' || !begin.current) return
    play('tap')
    begin.current()
  }

  // Return: Start, or Next after a demo (their keyboardShortcut(.defaultAction)).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || (e.target as HTMLElement).tagName === 'INPUT') return
      if (stage === 'welcome') pressStart()
      else if (prompt?.type === 'next') reply('Next', false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Keep the newest line in view, also while a demo card grows.
  useEffect(() => {
    const el = scroller.current
    const content = thread.current
    if (!el || !content) return
    const toBottom = () => el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' })
    toBottom()
    const ro = new ResizeObserver(toBottom)
    ro.observe(content)
    return () => ro.disconnect()
  }, [stage === 'header'])

  // The intro column (mark, 24, title 60, 32, Start 44) sits a little above the middle.
  const markY = 32 + (height - 64 - 0.06 * height - 240) / 2 + MARK / 2
  const header = stage === 'header'
  const leaving = stage === 'starting'
  const arrive = (shown: boolean) => `${s.part} ${shown && !leaving ? s.shown : ''} ${leaving ? s.leaving : ''}`

  return (
    <div className={`${s.onboarding} ${closing ? s.closing : ''}`} style={SPRINGS} role="dialog" aria-modal aria-label="Welcome to Bridle">
      <LightField on={fieldOn} />

      {!header && (
        <div className={s.intro} style={{ top: markY - MARK / 2 }}>
          <div style={{ height: MARK }} />
          <h1 className={arrive(titleIn)}>Welcome to Bridle</h1>
          <button type="button" className={`${s.start} ${arrive(startIn)}`} disabled={stage !== 'welcome'} onClick={pressStart}>Start</button>
        </div>
      )}

      {header && (
        <div className={`${s.thread} ${showcase ? s.receded : ''}`}>
          <div ref={scroller} className={s.scroll}>
            <div ref={thread} className={s.column}>
              {lines.map((line, i) => {
                const mine = line.sender === null
                const newGroup = i === 0 || lines[i - 1].sender !== line.sender
                const lastInGroup = i === lines.length - 1 ? !typing : lines[i + 1].sender !== line.sender
                return (
                  <div key={line.id} className={`${s.line} ${mine ? s.mine : ''} ${newGroup ? s.newGroup : ''}`}>
                    {newGroup && !mine && <span className={s.sender}>{line.sender}</span>}
                    <div className={s.bubbleRow}>
                      {!mine && <span style={{ opacity: lastInGroup ? 1 : 0 }}><Mark thinking={false} size={16} /></span>}
                      <div className={s.bubble}>{line.text}</div>
                    </div>
                    {line.demo && <div className={s.demoWrap}><DemoCard demo={line.demo} /></div>}
                  </div>
                )
              })}
              {typing && (
                <div className={s.typing} style={{ paddingTop: lines[lines.length - 1]?.sender === speaker ? 0 : 14 }} aria-label="Typing">
                  <Mark thinking={false} size={16} />
                  <span className={s.dots}><i /><i /><i /></span>
                </div>
              )}
            </div>
          </div>

          <div className={`${s.inputArea} ${prompt ? '' : s.promptLeaving}`} style={{ height: prompt?.type === 'connect' ? 236 : 56 }}>
            {shownPrompt?.type === 'text' && (
              <form key={shownPrompt.placeholder} className={`${s.textPrompt} ${s.rise}`} onSubmit={(e) => {
                e.preventDefault()
                reply(input)
              }}>
                <input autoFocus value={input} placeholder={shownPrompt.placeholder} aria-label={shownPrompt.placeholder}
                  onChange={(e) => setInput(e.target.value)} />
                <button type="submit" className={`${s.send} ${input ? '' : s.sendEmpty}`} aria-label="Send">
                  <ArrowUp size={15} strokeWidth={2.6} />
                </button>
              </form>
            )}
            {shownPrompt?.type === 'choices' && (
              <div className={`${s.choices} ${s.rise}`}>
                {shownPrompt.options.map((o, i) => (
                  <button key={o} type="button" className={`${s.choice} ${i === 0 ? s.primary : ''}`} onClick={() => reply(o)}>{o}</button>
                ))}
              </div>
            )}
            {shownPrompt?.type === 'next' && (
              <div className={`${s.choices} ${s.rise}`}>
                <button type="button" className={`${s.choice} ${s.primary}`} onClick={() => reply('Next', false)}>
                  <ArrowRight size={14} strokeWidth={2.4} />Next
                </button>
              </div>
            )}
            {shownPrompt?.type === 'connect' && <div className={s.rise}><ConnectCard onDone={(r) => reply(r)} /></div>}
          </div>
        </div>
      )}

      {showcase && <Showcase onDone={() => {
        setShowcase(false)
        showcaseDone.current?.()
        showcaseDone.current = null
      }} />}

      <div className={s.markHolder} style={{
        top: (header ? HEADER_Y : markY + (markIn || reduce ? 0 : 8)) - MARK / 2,
        opacity: markIn ? 1 : 0,
        transform: `translateX(-50%) scale(${header ? 0.4 : markIn || reduce ? 1 : 0.96})`,
        transition: header
          ? reduce
            ? 'top 250ms cubic-bezier(0.16, 1, 0.3, 1), transform 250ms cubic-bezier(0.16, 1, 0.3, 1)'
            : 'top 500ms cubic-bezier(0.4, 0, 0.2, 1), transform 500ms cubic-bezier(0.4, 0, 0.2, 1)'
          : 'top 600ms cubic-bezier(0.33, 1, 0.68, 1), transform 600ms cubic-bezier(0.33, 1, 0.68, 1), opacity 600ms cubic-bezier(0.33, 1, 0.68, 1)'
      }}>
        <Mark thinking={thinking || typing} size={MARK} />
      </div>

      <div className={s.corner}>
        <button type="button" className={s.cornerButton} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}
          onClick={() => {
            if (!muted) play('toggle', { direction: -1 })
            setSetting('soundMuted', !muted)
            if (muted) {
              setMuted(false)
              play('toggle')
              playAmbience()
            } else stopAmbience()
          }}>
          {muted ? <VolumeX size={16} strokeWidth={2.4} /> : <Volume2 size={16} strokeWidth={2.4} />}
        </button>
        <button type="button" className={s.cornerButton} aria-label="Skip onboarding" title="Skip onboarding" onClick={finish}>
          <X size={16} strokeWidth={2.6} />
        </button>
      </div>
    </div>
  )
}
