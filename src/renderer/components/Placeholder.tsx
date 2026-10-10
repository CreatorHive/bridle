import type { ReactNode } from 'react'

/** Centered "not built yet" message used by stub screens. */
export function Placeholder({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="b-placeholder">
      <strong>{title}</strong>
      {children}
    </div>
  )
}
