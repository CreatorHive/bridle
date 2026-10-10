import { Children, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'

/** A white panel with a hairline border. */
export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`b-card ${className}`} {...rest} />
}

/** Grouped gray card, separators between rows inset 12px on the left. */
export function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="b-settings-card">{Children.toArray(children)}</div>
}

/** The gray title above a SettingsCard. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="b-section-label">{children}</div>
}

/** Label (and description) on the left, control on the right, ≥52px. */
export function SettingsRow({ label, description, children }: { label: string; description?: string; children?: ReactNode }) {
  return (
    <div className="b-settings-row">
      <div className="label">
        <span>{label}</span>
        {description && <span>{description}</span>}
      </div>
      {children}
    </div>
  )
}

/** A 202×32 gray text field. */
export function Field({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`b-field ${className}`} {...rest} />
}
