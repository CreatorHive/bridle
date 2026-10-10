import type { ReactNode } from 'react'
import { Button } from './Button'

export interface RowProps {
  title: string
  /** An icon element (lucide-react, 16px). */
  icon?: ReactNode
  /** Drawn round in place of `icon`: a logo or a profile photo URL. */
  image?: string | null
  selected?: boolean
  muted?: boolean
  /** Blue unread dot. */
  dot?: boolean
  /** A reply is running here: a small spinner on the right. */
  working?: boolean
  badge?: number | null
  /** A chat nested under its project. */
  indent?: boolean
  help?: string
  onClick?: () => void
}

/** Sidebar row with hover + selection highlight; plays `select`. */
export function Row({ title, icon, image, selected, muted, dot, working, badge, indent, help, onClick }: RowProps) {
  const cls = ['b-row', selected && 'selected', muted && 'muted', indent && 'indent'].filter(Boolean).join(' ')
  return (
    <Button cue="select" className={cls} title={help} aria-current={selected || undefined} onClick={onClick}>
      {image ? <span className="icon"><img src={image} alt="" /></span> : icon ? <span className="icon">{icon}</span> : null}
      <span className="title">{title}</span>
      {working && <span className="b-spinner" title="Working…" />}
      {dot && <span className="dot" />}
      {badge ? <span className="badge">{badge}</span> : null}
    </Button>
  )
}

/** Sidebar header: uppercase label, optionally under a divider. */
export function SidebarHeader({ title, divider = true }: { title: string; divider?: boolean }) {
  return <div className={`b-section-header ${divider ? 'divider' : ''}`}>{title}</div>
}
