import { play } from '../sound'

/** A small switch that plays `toggle` (falling when switched off). */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="b-toggle"
      onClick={() => {
        play('toggle', { direction: checked ? -1 : 1 })
        onChange(!checked)
      }}
    />
  )
}
