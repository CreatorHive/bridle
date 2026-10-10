import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
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
          <div className={s.effortLabel}>Effort</div>
          <div className={s.efforts}>
            {EFFORTS.map(([v, name]) => (
              <Button key={v} cue="select" className={`${s.effort} ${v === effort ? s.on : ''}`} onClick={() => setPref('codeEffort', v)}>{name}</Button>
            ))}
          </div>
          <div className={s.pickerFoot}><kbd>⌘⇧/</kbd>Cycle effort</div>
        </div>
      )}
    </div>
  )
}
