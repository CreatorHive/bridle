import { useEffect, useState, type ReactNode } from 'react'
import type { SettingKey, Settings } from '../../../shared/types'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import s from './settings.module.css'

export const SAVED = 'bridle:settings-saved'

/** SettingsModal.showSaved: the "Saved" toast for about 2 s, with the subtle success cue. */
export function showSaved(): void {
  play('success', { emphasis: 'subtle' })
  window.dispatchEvent(new Event(SAVED))
}

/** A 202×32 gray field with an icon, showing a value or editing one. */
export function ValueField({ icon, value, onChange, onCommit, placeholder, secure, muted, label }: {
  icon?: ReactNode
  value: string
  onChange?: (v: string) => void
  /** Return (and leaving the field, for edits that save live). */
  onCommit?: () => void
  placeholder?: string
  secure?: boolean
  muted?: boolean
  label: string
}) {
  return (
    <label className={`${s.valueField} ${muted ? s.mutedField : ''}`} title={onChange ? undefined : value}>
      {icon && <span className={s.fieldIcon}>{icon}</span>}
      {onChange ? (
        <input type={secure ? 'password' : 'text'} value={value} placeholder={placeholder} aria-label={label} spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onCommit?.()} />
      ) : (
        <span className={s.fieldValue}>{value}</span>
      )}
    </label>
  )
}

/** A ValueField bound to one string setting: saved on Return (with the "Saved" cue) or when you leave the field. */
export function SettingField({ setting, icon, placeholder, label }: {
  setting: { [K in SettingKey]: Settings[K] extends string ? K : never }[SettingKey]
  icon?: ReactNode
  placeholder?: string
  label: string
}) {
  const { state, setSetting } = useApp()
  const saved = state.settings?.[setting] ?? ''
  const [value, setValue] = useState(saved)
  useEffect(() => setValue(saved), [saved])
  const commit = (cue: boolean) => {
    if (value === saved) return
    setSetting(setting, value)
    if (cue) showSaved()
  }
  return (
    <span onBlur={() => commit(false)}>
      <ValueField icon={icon} value={value} onChange={setValue} onCommit={() => commit(true)} placeholder={placeholder} label={label} />
    </span>
  )
}
