import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { FastForward } from 'lucide-react'
import { reducedMotion, spring } from '../../components'
import { play } from '../../sound'
import { CAPTION, CARDS, LAYERS, STAGGER, entrance, layout, schedule } from './burst'
import { BurstCard } from './BurstCards'
import o from './onboarding.module.css'
import s from './showcase.module.css'

// The feature burst (burst.ts has the layout and timing). Cards fly in from the screen edges on a spring, float in
// three depths with a little cursor parallax, a caption builds in the middle, then everything gathers into the
// column and the conversation carries on. A click or any key fast-forwards to the gather.

const FLY = spring(0.85, 0.8)
const GATHER = { duration: 620, step: 30, easing: 'cubic-bezier(0.76, 0, 0.24, 1)' } // tokens.css --ease-sweep
const REDUCED_HOLD = 3000

export function Showcase({ onDone }: { onDone: () => void }) {
  const reduce = reducedMotion()
  const [size, setSize] = useState(() => ({ W: window.innerWidth, H: window.innerHeight }))
  const { cards } = useMemo(() => layout(size.W, size.H), [size])
  const { words, gather } = useMemo(schedule, [])
  const [leaving, setLeaving] = useState(false)
  const [moving, setMoving] = useState(true)
  const root = useRef<HTMLDivElement>(null)
  const slots = useRef<(HTMLDivElement | null)[]>([])
  const layers = useRef<(HTMLDivElement | null)[]>([])
  const leave = useRef(() => {})
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const onResize = () => setSize({ W: window.innerWidth, H: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // In, hold, out.
  useEffect(() => {
    const { W, H } = size
    let left = false
    const timers: ReturnType<typeof setTimeout>[] = []
    play('open', { emphasis: 'subtle' })

    const flights = slots.current.map((el, i) => {
      if (!el) return null
      if (reduce) return el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-out', fill: 'backwards' })
      const from = entrance(cards[i], W, H)
      const turn = (i % 2 ? 1 : -1) * (3 + ((i * 7) % 5))
      return el.animate([
        { transform: `translate(${from.x}px, ${from.y}px) rotate(${turn}deg) scale(0.9)`, opacity: 0.3 },
        { transform: 'none', opacity: 1 }
      ], { duration: FLY.duration, easing: FLY.easing, delay: i * STAGGER, fill: 'backwards' })
    })
    Promise.all(flights.map((a) => a?.finished)).then(() => !left && setMoving(false), () => {})

    leave.current = () => {
      if (left) return
      left = true
      timers.forEach(clearTimeout)
      setLeaving(true)
      setMoving(true)
      play('close', { emphasis: 'subtle' })
      if (reduce) {
        root.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'ease-in', fill: 'forwards' })
        timers.push(setTimeout(() => done.current(), 300))
        return
      }
      const n = slots.current.length
      slots.current.forEach((el, i) => {
        const flight = flights[i]
        if (!el || !flight) return
        // Not off yet: it just doesn't come. Mid-flight: it turns around from where it is.
        if (Number(flight.currentTime ?? 0) < i * STAGGER) {
          flight.cancel()
          el.style.opacity = '0'
          return
        }
        flight.commitStyles()
        flight.cancel()
        const c = cards[i]
        const dx = (W / 2 - (c.x + c.w / 2)) * 0.92
        const dy = (H / 2 - (c.y + c.h / 2)) * 0.92
        el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(0.18)`, opacity: 0, filter: 'blur(10px)' }],
          { duration: GATHER.duration, easing: GATHER.easing, delay: (n - 1 - i) * GATHER.step, fill: 'forwards' })
      })
      timers.push(setTimeout(() => done.current(), GATHER.duration + (n - 1) * GATHER.step))
    }
    timers.push(setTimeout(() => leave.current(), reduce ? REDUCED_HOLD : gather))

    const onKey = (e: KeyboardEvent) => !e.repeat && leave.current()
    window.addEventListener('keydown', onKey)
    return () => {
      left = true
      timers.forEach(clearTimeout)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Cursor parallax: each layer eases toward the pointer, the near one furthest; frames only while it's moving.
  useEffect(() => {
    if (reduce) return
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0
    const tick = () => {
      x += (tx - x) * 0.07
      y += (ty - y) * 0.07
      layers.current.forEach((el, i) => {
        if (el) el.style.transform = `translate3d(${(-x * LAYERS[i].parallax).toFixed(2)}px, ${(-y * LAYERS[i].parallax).toFixed(2)}px, 0)`
      })
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(tick) : 0
    }
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth) * 2 - 1
      ty = (e.clientY / window.innerHeight) * 2 - 1
      if (!raf) raf = requestAnimationFrame(tick)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div ref={root} className={`${s.showcase} ${moving ? s.moving : ''}`} data-phase={leaving ? 'out' : 'in'} onClick={() => leave.current()}>
      <div aria-hidden>
        {([2, 1, 0] as const).map((layer) => (
          <div key={layer} ref={(el) => void (layers.current[layer] = el)} className={s.layer}>
            {cards.map((c, i) => c.layer === layer && (
              <div key={c.id} ref={(el) => void (slots.current[i] = el)} className={s.slot}
                style={{ left: c.x, top: c.y, width: c.w, height: c.h }}>
                <div className={reduce ? undefined : s.float} style={{
                  '--period': `${5.5 + ((i * 1.7) % 3)}s`,
                  '--phase': `${-((i * 1.3) % 6)}s`,
                  '--amp': `${4 + 2 * (2 - layer)}px`
                } as CSSProperties}>
                  <div className={`${s.card} ${s[`l${layer}`]}`} style={{
                    width: CARDS[i].w,
                    height: CARDS[i].h,
                    zoom: c.zoom,
                    opacity: LAYERS[layer].opacity,
                    filter: LAYERS[layer].blur ? `blur(${LAYERS[layer].blur / c.zoom}px)` : undefined,
                    '--land': `${reduce ? 0 : i * STAGGER + FLY.duration * 0.6}ms`
                  } as CSSProperties}>
                    <BurstCard id={c.id} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className={`${s.caption} ${leaving ? s.captionOut : ''}`}>
        {CAPTION.map((line, i) => (
          <p key={i} className={i ? s.last : undefined}>
            {line.map((w, j) => (
              <span key={j}>
                {j > 0 && ' '}
                <span className={reduce ? undefined : s.word} style={{ animationDelay: `${words[i][j]}ms` }}>{w}</span>
              </span>
            ))}
          </p>
        ))}
      </div>

      <button type="button" className={`${o.cornerButton} ${s.forward}`} aria-label="Skip ahead" title="Skip ahead"
        onClick={(e) => {
          e.stopPropagation()
          play('tap')
          leave.current()
        }}>
        <FastForward size={16} strokeWidth={2.4} />
      </button>
    </div>
  )
}
