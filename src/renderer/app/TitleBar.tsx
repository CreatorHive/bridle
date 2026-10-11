import { PanelLeft } from 'lucide-react'
import { Button } from '../components'
import { play } from '../sound'
import { useApp } from './store'

/** Shows or hides the section sidebar; ⌘\ does the same (Shell). */
export function toggleSidebar(hidden: boolean, setSetting: ReturnType<typeof useApp>['setSetting']): void {
  play('toggle', { direction: hidden ? 1 : -1 })
  setSetting('sidebarHidden', !hidden)
}

/** The 38px chrome strip: draggable, the window buttons over it (left on macOS, right elsewhere), the sidebar toggle
 *  beside them, the title centered. */
export function TitleBar({ title }: { title: string }) {
  const { state, setSetting } = useApp()
  const hidden = !!state.settings?.sidebarHidden
  return (
    <header className="titlebar">
      <Button cue={null} className="titlebar-toggle" title={`${hidden ? 'Show' : 'Hide'} sidebar (⌘\\)`}
        aria-label={hidden ? 'Show sidebar' : 'Hide sidebar'} aria-pressed={!hidden} onClick={() => toggleSidebar(hidden, setSetting)}>
        <PanelLeft size={16} />
      </Button>
      <h1>{title}</h1>
    </header>
  )
}
