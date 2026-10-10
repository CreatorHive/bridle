import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { usePresence } from '../../components'
import { play, type Cue } from '../../sound'

// A right-click menu in the look and sound of components/Menu, with real submenus ("Move to").
// Used by tasks and files.

export interface ContextItem {
  label: string
  icon?: ReactNode
  destructive?: boolean
  /** A divider above this item. */
  divider?: boolean
  /** A submenu, opened beside the item on hover, click or →. */
  items?: ContextItem[]
  /** The cue the item plays: `select` by default, `close` (strong) for destructive items, null for none. */
  cue?: Cue | null
  onSelect?: () => void
}

function List({ items, close, sub = false, leaving = false, style }: {
  items: ContextItem[]
  close: () => void
  sub?: boolean
  leaving?: boolean
  style?: CSSProperties
}) {
  const [openSub, setOpenSub] = useState<string | null>(null)
  return (
    <ul className={`b-menu-list ${sub ? 'sub' : ''} ${leaving ? 'leaving' : ''}`} role="menu" style={style}
      onMouseDown={(e) => e.stopPropagation()}>
      {items.map((item) => (
        <li key={item.label} role="none" className={item.divider ? 'separated' : undefined}
          onMouseEnter={() => setOpenSub(item.items ? item.label : null)}>
          <button type="button" role="menuitem" className={`b-menu-item ${item.destructive ? 'destructive' : ''}`}
            aria-haspopup={item.items ? 'menu' : undefined}
            aria-expanded={item.items ? openSub === item.label : undefined}
            onKeyDown={(e) => item.items && e.key === 'ArrowRight' && setOpenSub(item.label)}
            onClick={() => {
              if (item.items) return setOpenSub(openSub === item.label ? null : item.label)
              const cue = item.cue === undefined ? (item.destructive ? 'close' : 'select') : item.cue
              if (cue) play(cue, cue === 'close' && item.destructive ? { emphasis: 'strong' } : {})
              close()
              item.onSelect?.()
            }}>
            {item.icon}
            <span className="label">{item.label}</span>
            {item.items && <ChevronRight size={12} className="chevron" />}
          </button>
          {item.items && openSub === item.label && <List items={item.items} close={close} sub />}
        </li>
      ))}
    </ul>
  )
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null)
  // The last menu, drawn while it fades out.
  const last = useRef(menu)
  if (menu) last.current = menu
  const { mounted, leaving } = usePresence(!!menu, 120)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    document.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      document.removeEventListener('keydown', esc, true)
    }
  }, [menu])

  const open = (e: MouseEvent, items: ContextItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    // Native context menus open silently; the item you pick plays its cue.
    // Keep it (and a submenu beside it) on screen.
    const x = Math.min(e.clientX, window.innerWidth - 380)
    const y = Math.min(e.clientY, window.innerHeight - items.length * 32 - 16)
    setMenu({ x, y, items })
  }

  const shown = menu ?? last.current
  const element = mounted && shown && createPortal(
    <List items={shown.items} close={() => setMenu(null)} leaving={leaving}
      style={{ position: 'fixed', left: shown.x, top: shown.y, right: 'auto', minWidth: 180, zIndex: 300 }} />,
    document.body
  )

  return { open, element }
}
