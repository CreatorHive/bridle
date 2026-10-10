import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Rocket, Search } from 'lucide-react'
import { DEFAULT_SETTINGS, PROVIDERS } from '../../../shared/types'
import { Button } from '../../components'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import { logos } from '../../theme'
import { setPref, useCode } from './store'
import s from './code.module.css'

/** ModelPicker.efforts: "" = the CLI's default. */
export const EFFORTS: [string, string][] = [['', 'Default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']]
const MODELS = PROVIDERS['Claude CLI'].models
const short = (m: string) => m.replace('Claude ', '')

/** A popover with search, the Claude models (⌃⌘1…3) and the effort (⌘⇧/ cycles it). */
export function ModelPicker() {
  const { state, setSetting } = useApp()
  const { prefs } = useCode()
  const model = state.settings?.model ?? DEFAULT_SETTINGS.model
  const effort = prefs.codeEffort
  const effortName = EFFORTS.find(([v]) => v === effort)?.[1] ?? 'Default'
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)

  const pick = (m: string) => {
    play('select')
    setSetting('model', m)
    setOpen(false)
  }

  // ⌃⌘1…3 pick a model and ⌘⇧/ cycles effort, with or without the popover open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key)
      if (e.ctrlKey && e.metaKey && n >= 1 && n <= MODELS.length) {
        e.preventDefault()
        pick(MODELS[n - 1])
      } else if (e.metaKey && e.shiftKey && (e.key === '/' || e.key === '?')) {
        e.preventDefault()
        const i = EFFORTS.findIndex(([v]) => v === effort)
        setPref('codeEffort', EFFORTS[(i + 1) % EFFORTS.length][0])
        play('toggle', { emphasis: 'subtle' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const shown = MODELS.filter((m) => !query || m.toLowerCase().includes(query.toLowerCase()))
  return (
    <div ref={root} style={{ position: 'relative' }}>
      <Button cue={null} className={s.modelButton} title="Model and effort" onClick={() => {
        play(open ? 'close' : 'open', { emphasis: 'subtle' })
        setQuery('')
        setOpen(!open)
      }}>
        <span>{short(model)}</span>
        {effort && <span className={s.dim}>{effortName}</span>}
        <ChevronDown size={11} className={s.dim} />
      </Button>
      {open && (
        <div className={s.picker} role="dialog" aria-label="Model and effort">
          <label className={s.pickerSearch}>
            <Search size={14} />
            <input autoFocus value={query} placeholder="Search models" onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className={s.pickerList}>
            {shown.map((m) => (
              <button key={m} type="button" className={s.pickerRow} onClick={() => pick(m)}>
                <img src={logos.claude} alt="" />
                <span>{short(m)}</span>
                {m === model && effort && <span className={s.dim}>{effortName}</span>}
                <span className={s.grow} />
                {m === model ? <Check size={13} /> : <kbd>⌃⌘{MODELS.indexOf(m) + 1}</kbd>}
              </button>
            ))}
            {!shown.length && <div className={s.note}>No models match</div>}
          </div>
          <EffortSlider effort={effort} />
          <div className={s.pickerFoot}><kbd>⌘⇧/</kbd>Cycle effort</div>
        </div>
      )}
    </div>
  )
}

/** Effort as a six-stop slider. Reaching Max launches a rocket off the thumb, and the track burns while it stays there. */
function EffortSlider({ effort }: { effort: string }) {
  const at = Math.max(0, EFFORTS.findIndex(([v]) => v === effort))
  const last = EFFORTS.length - 1
  const max = at === last
  // Bumped each time Max is reached, so the launch replays (and doesn't play when the picker opens on Max).
  const [launches, setLaunches] = useState(0)
  const set = (i: number) => {
    if (i === at) return
    setPref('codeEffort', EFFORTS[i][0])
    if (i === last) {
      setLaunches((n) => n + 1)
      play('success', { emphasis: 'strong' })
    } else play('select', { direction: i - at })
  }
  return (
    <div className={`${s.effortBox} ${max ? s.effortMax : ''}`} style={{ ['--at' as string]: at / last }}>
      <div className={s.effortHead}>
        <span>Effort</span>
        <span className={s.effortName}>{max && <Rocket size={12} className={s.effortRocket} />}{EFFORTS[at][1]}</span>
      </div>
      <div className={s.effortTrack}>
        <div className={s.effortRail} />
        <div className={s.effortStops} aria-hidden>{EFFORTS.map(([v], i) => <span key={v} className={i <= at ? s.passed : ''} />)}</div>
        <input type="range" min={0} max={last} step={1} value={at} aria-label="Effort" aria-valuetext={EFFORTS[at][1]}
          onChange={(e) => set(Number(e.target.value))} />
        {launches > 0 && max && (
          <span key={launches} className={s.launch} aria-hidden>
            <Rocket size={16} strokeWidth={2.2} />
            <i /><i /><i />
          </span>
        )}
      </div>
      <div className={s.effortEnds}><span>Default</span><span>Max</span></div>
    </div>
  )
}
