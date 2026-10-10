// Motion values and math (MOTION, tactile press, the chat's settle). CSS reads the same
// values from tokens.css (motion.test.ts keeps the two in sync); JS (FLIP, WAAPI) reads them here.

export interface Motion {
  /** A CSS easing: cubic-bezier() or, for springs, linear() sampled from the spring. */
  easing: string
  /** ms */
  duration: number
}

/** A spring (response: undamped period in s; damping: fraction of critical) from rest to 1, at time t (s).
 *  Mass 1, no initial velocity. */
export function springAt(response: number, damping: number, t: number): number {
  const w0 = (2 * Math.PI) / response
  if (damping >= 1) return 1 - (1 + w0 * t) * Math.exp(-w0 * t)
  const wd = w0 * Math.sqrt(1 - damping * damping)
  const decay = Math.exp(-damping * w0 * t)
  return 1 - decay * (Math.cos(wd * t) + ((damping * w0) / wd) * Math.sin(wd * t))
}

/** A spring as a CSS linear() easing and the time it takes to settle within 0.1%. */
export function spring(response: number, damping: number): Motion {
  let settle = 0
  for (let t = 0; t <= 5; t += 0.001) if (Math.abs(1 - springAt(response, damping, t)) > 0.001) settle = t
  const duration = Math.round(settle * 1000)
  const n = 40
  const points = Array.from({ length: n + 1 }, (_, i) =>
    i === n ? '1' : String(Math.round(springAt(response, damping, (settle * i) / n) * 1000) / 1000))
  return { easing: `linear(${points.join(', ')})`, duration }
}

/** The shared motion set, plus the few one-off curves the screens share. */
export const MOTION = {
  /** Hover and state changes. */
  state: { easing: 'ease-in-out', duration: 150 },
  /** An icon trading places with another (copy → check). */
  iconSwap: { easing: 'ease-in-out', duration: 250 },
  /** Your message springing up from the composer. */
  send: spring(0.44, 0.99),
  /** The agent's reply arriving: quick, strong ease-out. */
  reply: { easing: 'cubic-bezier(0.23, 1, 0.32, 1)', duration: 160 },
  /** The composer growing or shrinking by a line. */
  composerLines: spring(0.3, 0.9),
  /** Settle: the centered composer gliding down when a new chat starts. */
  settle: spring(0.5, 0.86),
  /** An allowed request's card folding away. */
  fold: spring(0.45, 0.9),
  /** Modals and popovers: timingCurve(0.16, 1, 0.3, 1, 0.3). */
  modal: { easing: 'cubic-bezier(0.16, 1, 0.3, 1)', duration: 300 }
} satisfies Record<string, Motion>

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface Box { left: number; top: number; width: number; height: number }

/** FLIP "invert": the transform that puts a box laid out at `last` back where it was at `first`
 *  (uniform scale about the center, so text never stretches). */
export function invert(first: Box, last: Box): { x: number; y: number; scale: number } {
  return {
    x: first.left + first.width / 2 - (last.left + last.width / 2),
    y: first.top + first.height / 2 - (last.top + last.height / 2),
    scale: last.width ? first.width / last.width : 1
  }
}

/** FLIP "play": animates `el` from `first` (measured before the layout change) to where it is now. */
export function flip(el: Element, first: Box, motion: Motion = MOTION.settle): Animation | null {
  if (reducedMotion() || typeof el.animate !== 'function') return null
  const { x, y, scale } = invert(first, el.getBoundingClientRect())
  if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && Math.abs(scale - 1) < 0.001) return null
  return el.animate(
    [{ transform: `translate(${x}px, ${y}px) scale(${scale})`, transformOrigin: 'center' }, { transform: 'none', transformOrigin: 'center' }],
    { duration: motion.duration, easing: motion.easing }
  )
}
