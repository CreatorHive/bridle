import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type ReactNode } from 'react'
import { reducedMotion } from './motion'

/** Keeps a view mounted for `exitMs` after `show` turns false, so it can play its removal transition
 *  Style the exit off `leaving`. */
export function usePresence(show: boolean, exitMs: number): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(show)
  useEffect(() => {
    if (show) return setMounted(true)
    const t = setTimeout(() => setMounted(false), reducedMotion() ? 0 : exitMs)
    return () => clearTimeout(t)
  }, [show, exitMs])
  return { mounted: show || mounted, leaving: !show && mounted }
}

/** One view trading places with the next whenever `k` changes, both drawn in one grid cell:
 *  `icon` scales from 0.6 with a fade (MOTION.iconSwap: copy → check, send → spinner);
 *  `rise` brings the new one up from 8 px below and sends the old one up and out, quicker
 *  (the working row's status label). The first view appears without a transition. */
export function Swap({ k, variant = 'icon', className = '', children }:
  { k: string | number; variant?: 'icon' | 'rise'; className?: string; children: ReactNode }) {
  const [shown, setShown] = useState(k)
  const [old, setOld] = useState<{ k: string | number; node: ReactNode } | null>(null)
  const changed = useRef(false)
  const last = useRef<ReactNode>(children)
  if (shown !== k) {
    changed.current = true
    setOld({ k: shown, node: last.current })
    setShown(k)
  }
  useEffect(() => { last.current = children })
  const done = (e: AnimationEvent) => e.target === e.currentTarget && setOld(null)
  return (
    <span className={`b-swap b-swap-${variant} ${className}`}>
      {old && old.k !== k && <span key={`o${old.k}`} className="b-swap-out" aria-hidden onAnimationEnd={done}>{old.node}</span>}
      <span key={`i${k}`} className={changed.current ? 'b-swap-in' : undefined}>{children}</span>
    </span>
  )
}

/** useLayoutEffect in the app, useEffect under server rendering (the tests), which has no layout. */
export const useLayoutEffectInBrowser = typeof window === 'undefined' ? useEffect : useLayoutEffect
