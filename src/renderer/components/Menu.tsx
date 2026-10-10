import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight, ChevronsUpDown } from 'lucide-react'
import { play, type Cue } from '../sound'
import { usePresence } from './Presence'

export interface MenuItem {
  label: string
  icon?: ReactNode
  checked?: boolean
  destructive?: boolean
  disabled?: boolean
  /** Cue on pick: `select` by default, `close` (strong) when destructive; null when the action plays its own. */
  cue?: Cue | null
  /** Draws a divider above this item. */
  separator?: boolean
  /** A submenu: opens beside the item on hover (or click / →); its items do the work. */
  items?: MenuItem[]
  onSelect?: () => void
}

/** A popover menu under `trigger`. Closes on outside click and Escape; items play select (close, strong, when destructive).
 *  Appears like a native menu (a quick pop) and fades out when dismissed. */
export function Menu({ trigger, items, label }: { trigger: ReactNode; items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false)
  const { mounted, leaving } = usePresence(open, 120)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc, true)
    }
  }, [open])

  return (
    <div className="b-menu" ref={root}>
      {/* A plain button: no press dip. */}
      <button
        type="button"
        className="b-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        // Menus open silently; the item you pick plays its cue.
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {mounted && <MenuList items={items} leaving={leaving} close={() => setOpen(false)} />}
    </div>
  )
}

function MenuList({ items, leaving = false, sub = false, close }: { items: MenuItem[]; leaving?: boolean; sub?: boolean; close: () => void }) {
  const [openSub, setOpenSub] = useState<string | null>(null)
  return (
    <ul className={`b-menu-list ${sub ? 'sub' : ''} ${leaving ? 'leaving' : ''}`} role="menu">
      {items.map((item) => (
        <li key={item.label} role="none" className={item.separator ? 'separated' : undefined}
          onMouseEnter={() => setOpenSub(item.items ? item.label : null)}>
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            aria-haspopup={item.items ? 'menu' : undefined}
            aria-expanded={item.items ? openSub === item.label : undefined}
            className={`b-menu-item ${item.destructive ? 'destructive' : ''}`}
            onKeyDown={(e) => item.items && e.key === 'ArrowRight' && setOpenSub(item.label)}
            onClick={() => {
              if (item.items) return setOpenSub(openSub === item.label ? null : item.label)
              if (item.cue !== null) play(item.cue ?? (item.destructive ? 'close' : 'select'), item.destructive && !item.cue ? { emphasis: 'strong' } : {})
              close()
              item.onSelect?.()
            }}
          >
            {item.checked !== undefined && <span className="check">{item.checked && <Check size={14} />}</span>}
            {item.icon}
            <span className="label">{item.label}</span>
            {item.items && <ChevronRight size={12} className="chevron" />}
          </button>
          {item.items && openSub === item.label && <MenuList items={item.items} sub close={close} />}
        </li>
      ))}
    </ul>
  )
}

/** A 202px field showing the current choice, opening the options. */
export function ChoiceMenu({ value, options, onChange, label }:
  { value: string; options: string[]; onChange: (v: string) => void; label: string }) {
  return (
    <Menu
      label={label}
      trigger={<span className="b-menu-trigger"><span>{value}</span><ChevronsUpDown size={12} /></span>}
      items={options.map((o) => ({ label: o, checked: o === value, onSelect: () => onChange(o) }))}
    />
  )
}
