import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { play, type Cue } from '../sound'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Cue played on click: `tap` by default, null for silence. */
  cue?: Cue | null
}

/** A button with Tactile press feedback and a click cue. Base for everything clickable. */
export function Button({ cue = 'tap', className = '', onClick, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={`tactile ${className}`}
      onClick={(e) => {
        if (cue) play(cue)
        onClick?.(e)
      }}
      {...rest}
    />
  )
}

/** 30px capsule, white with a border, or black when `filled`. */
export function Pill({ filled = false, className = '', ...rest }: Props & { filled?: boolean }) {
  return <Button className={`b-pill ${filled ? 'filled' : ''} ${className}`} {...rest} />
}

/** Small round floating icon control. `label` is required for accessibility. */
export function IconButton({ label, size = 30, children, style, className = '', ...rest }:
  Props & { label: string; size?: number; children: ReactNode }) {
  return (
    <Button
      aria-label={label}
      title={label}
      className={`b-icon-button ${className}`}
      style={{ ['--size' as string]: `${size}px`, ...style }}
      {...rest}
    >
      {children}
    </Button>
  )
}
