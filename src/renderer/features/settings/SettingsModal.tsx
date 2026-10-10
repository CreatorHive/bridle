import { useEffect, useState } from 'react'
import { CircleCheck, CircleUserRound, Cpu, HardDrive, Link, Repeat, Settings, Sparkles, Wrench, X, type LucideIcon } from 'lucide-react'
import { Button, MOTION, usePresence } from '../../components'
import { play } from '../../sound'
import { SETTINGS_PAGES, useApp, type SettingsPage } from '../../app/store'
import { PAGES } from './pages'
import { SAVED } from './ValueField'

const ICONS: Record<SettingsPage, LucideIcon> = {
  general: Settings, profile: CircleUserRound, agent: Sparkles, models: Cpu,
  connections: Link, tools: Wrench, automations: Repeat, storage: HardDrive
}

const label = (p: SettingsPage) => p[0].toUpperCase() + p.slice(1)

/** An 871×614 panel over a 20% black backdrop; a rail of pages, a fixed title
 *  row over a scrolling page. Enters from 0.85× / transparent / 8 px blur and leaves the same way on
 *  timingCurve(0.16, 1, 0.3, 1, 0.3 s). Closes on Esc, the ✕ or the backdrop. */
export function SettingsModal() {
  const { state, patch } = useApp()
  const { mounted, leaving } = usePresence(state.settingsOpen, MOTION.modal.duration)
  const page = state.settingsPage
  const Page = PAGES[page]
  const [scrolled, setScrolled] = useState(false)
  const [saved, setSaved] = useState(false)

  const close = () => {
    play('close')
    patch({ settingsOpen: false })
  }

  useEffect(() => {
    if (!state.settingsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => setScrolled(false), [page])

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const show = () => {
      setSaved(true)
      clearTimeout(t)
      t = setTimeout(() => setSaved(false), 2000)
    }
    window.addEventListener(SAVED, show)
    return () => {
      window.removeEventListener(SAVED, show)
      clearTimeout(t)
    }
  }, [])

  if (!mounted) return null
  return (
    <div className={`modal-backdrop ${leaving ? 'leaving' : ''}`} onMouseDown={(e) => !leaving && e.target === e.currentTarget && close()}>
      <div className="settings" role="dialog" aria-modal aria-label="Settings">
        <nav className="settings-rail">
          <div className="heading">Settings</div>
          {SETTINGS_PAGES.map((p) => {
            const Icon = ICONS[p]
            return (
              <Button key={p} cue="select" className={`settings-rail-item ${p === page ? 'selected' : ''}`}
                aria-current={p === page || undefined} onClick={() => patch({ settingsPage: p })}>
                <span className="icon"><Icon size={16} /></span>
                {label(p)}
              </Button>
            )
          })}
        </nav>
        <div className="settings-main">
          <div className="settings-title">
            <h2>{label(page)}</h2>
            <Button cue={null} className="settings-close" aria-label="Close settings" onClick={close}>
              <X size={11} strokeWidth={3} />
            </Button>
          </div>
          <div className="settings-scroll">
            <div className="settings-page" key={page} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}>
              <Page />
            </div>
            {/* Content dissolves under the title row once scrolled. */}
            <div className={`settings-fade ${scrolled ? 'shown' : ''}`} />
          </div>
        </div>
        {/* "Saved", half in and half out of the panel's bottom edge. */}
        <div className={`settings-toast ${saved ? 'shown' : ''}`} aria-live="polite">
          <CircleCheck size={15} fill="var(--green)" color="#fff" />
          Saved
        </div>
      </div>
    </div>
  )
}
