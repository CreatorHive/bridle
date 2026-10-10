import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import type { CalendarEvent, RSVP } from '../../../shared/types'
import { Button, Row, ShimmerText, SidebarHeader, createStore, usePresence, useLayoutEffectInBrowser } from '../../components'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import {
  accountColor, addDays, place, allDayOn, end, hourLabel, hours, layout, myStatus, sameDay, sampleWeek, start, time,
  timedOn, weekDays, weekStart, withStatus
} from './logic'
import { EventCard, useConnected } from './shared'
import css from './calendar.module.css'

export { EventCard, Going, GuestAvatar, Linkified, OutLink, useConnected } from './shared'

const HOUR = 48

// The sidebar's month picks the week the screen shows.
const cal = createStore({ week: weekStart(new Date()) })
const setWeek = (week: Date) => cal.set({ week })
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** The Calendar's sidebar: a month to jump to any week, and the calendars shown. */
export function CalendarSidebar() {
  const { week } = cal.use()
  const { logins, checked } = useConnected('googlecalendar')
  const { patch } = useApp()
  const [month, setMonth] = useState(() => new Date(week.getFullYear(), week.getMonth(), 1))
  // Follow the screen's week across months (Today, the arrows).
  useEffect(() => setMonth(new Date(week.getFullYear(), week.getMonth(), 1)), [week.getTime()])
  const first = weekStart(month)
  const today = new Date()
  const turn = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))
  return (
    <>
      <div className={css.mini}>
        <div className={css.miniHead}>
          <strong>{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</strong>
          <Button className={css.miniNav} aria-label="Previous month" onClick={() => turn(-1)}><ChevronLeft size={14} /></Button>
          <Button className={css.miniNav} aria-label="Next month" onClick={() => turn(1)}><ChevronRight size={14} /></Button>
        </div>
        <div className={css.miniGrid}>
          {DOW.map((d, i) => <span key={i} className={css.miniDow}>{d}</span>)}
          {Array.from({ length: 42 }, (_, i) => addDays(first, i)).map((d) => {
            const cls = [css.miniDay, d.getMonth() !== month.getMonth() && css.out, sameDay(d, today) && css.miniToday,
              weekStart(d).getTime() === week.getTime() && css.inWeek].filter(Boolean).join(' ')
            return <Button key={d.getTime()} cue="select" className={cls} onClick={() => setWeek(weekStart(d))}>{d.getDate()}</Button>
          })}
        </div>
      </div>
      <SidebarHeader title="Calendars" divider={false} />
      {logins.map((l) => (
        <Row key={l} title={l} icon={<i className={css.swatch} style={{ background: accountColor(l, logins) }} />} />
      ))}
      {checked && !logins.length && (
        <Row title="Connect Google Calendar" muted help="Settings → Connections"
          onClick={() => patch({ settingsOpen: true, settingsPage: 'connections' })} />
      )}
    </>
  )
}

/** The week across every connected Google Calendar; the sample week when none is connected. */
export function CalendarScreen() {
  const { logins, checked } = useConnected('googlecalendar')
  const sample = checked && logins.length === 0
  const { week } = cal.use()
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<{ key: string; anchor: DOMRect } | null>(null)
  const [now, setNow] = useState(() => new Date())
  const close = useCallback(() => setOpen(null), [])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (sample) return setEvents(sampleWeek())
    if (!logins.length) return
    let cancelled = false
    setLoading(true)
    window.bridle.calendar.events(week.toISOString(), addDays(week, 7).toISOString()).then(
      (fetched) => { if (!cancelled) { setEvents(fetched); setError(null) } },
      (e: unknown) => { if (!cancelled) setError(message(e)) }
    ).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [week.getTime(), logins.length, sample])

  // Optimistic, rolled back if Google refuses. The sample week only changes here.
  const respond = (e: CalendarEvent, status: RSVP) => {
    const before = myStatus(e)
    if (!before) return
    setEvents((list) => withStatus(list, e, status))
    if (sample) return
    window.bridle.calendar.rsvp(e, status).catch((err: unknown) => {
      setError(message(err))
      play('error')
      setEvents((list) => withStatus(list, e, before))
    })
  }

  if (!checked) return <div className={css.center}><span className="b-spinner" /></div>

  const days = weekDays(week)
  const color = (e: CalendarEvent) => accountColor(e.account, logins)
  const allDay = days.map((d) => allDayOn(events, d))
  const shift = (n: number) => setWeek(addDays(week, 7 * n))
  const key = (e: CalendarEvent) => `${e.account}|${e.id}`
  const opened = open && events.find((e) => key(e) === open.key)

  const chip = (e: CalendarEvent, body: JSX.Element, style?: CSSProperties) => {
    const mine = myStatus(e)
    const cls = [css.chip, mine === 'needsAction' && css.pending, mine === 'declined' && css.declined].filter(Boolean).join(' ')
    return (
      <Button
        key={key(e)}
        cue="open"
        className={cls}
        style={{ ['--c' as string]: color(e), ...style }}
        onClick={(ev) => setOpen({ key: key(e), anchor: ev.currentTarget.getBoundingClientRect() })}
      >
        {body}
      </Button>
    )
  }

  return (
    <div className={css.screen}>
      <div className={css.header}>
        <div className={css.titles}>
          <h2>{week.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2>
          <div className={css.subtitle}>
            {error ? (
              <span className={css.error}><TriangleAlert size={13} />{error}</span>
            ) : (
              <>
                <span>
                  Week of {week.toLocaleDateString([], { month: 'short', day: 'numeric' })} ·{' '}
                  {sample ? 'Sample week, connect Google in Settings → Connections' : 'Google Calendar'}
                </span>
                {loading && <ShimmerText>Syncing…</ShimmerText>}
              </>
            )}
          </div>
        </div>
        <div className={css.nav}>
          <Button className={css.navButton} title="This week" onClick={() => setWeek(weekStart(new Date()))}>Today</Button>
          <Button className={`${css.navButton} ${css.icon}`} title="Previous week" aria-label="Previous week" onClick={() => shift(-1)}>
            <ChevronLeft size={14} />
          </Button>
          <Button className={`${css.navButton} ${css.icon}`} title="Next week" aria-label="Next week" onClick={() => shift(1)}>
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>

      <div className={css.days}>
        <span className={css.gutter} />
        {days.map((d) => (
          <div key={d.getTime()} className={`${css.dayName} ${sameDay(d, now) ? css.today : ''}`}>
            {d.toLocaleDateString([], { weekday: 'short' })} <b>{d.getDate()}</b>
          </div>
        ))}
      </div>

      {allDay.some((l) => l.length) && (
        <div className={css.allDay}>
          <span className={css.allDayLabel}>all-day</span>
          {allDay.map((list, i) => (
            <div key={i} className={css.allDayCell}>{list.map((e) => chip(e, <strong>{e.title}</strong>))}</div>
          ))}
        </div>
      )}
      <div className={css.rule} />

      <HourGrid>
        {days.map((d) => (
          <div key={d.getTime()} className={css.column}>
            {layout(timedOn(events, d)).map(({ event: e, lane, lanes }) => {
              const length = (end(e).getTime() - start(e).getTime()) / 3_600_000
              return chip(e, (
                <>
                  <strong>{e.title}</strong>
                  {length >= 0.75 && <small>{time(start(e))}</small>}
                </>
              ), {
                top: hours(start(e)) * HOUR,
                height: Math.max(18, length * HOUR - 2),
                left: `calc(3px + ${lane} * (100% - 6px) / ${lanes})`,
                width: `calc((100% - 6px) / ${lanes} - 2px)`
              })
            })}
            {sameDay(d, now) && <div className={css.now} style={{ top: hours(now) * HOUR }} />}
          </div>
        ))}
      </HourGrid>

      <Popover anchor={open && opened ? open.anchor : null} onClose={close}>
        {opened ? <EventCard event={opened} color={color(opened)} respond={(s) => respond(opened, s)} /> : null}
      </Popover>
    </div>
  )
}

/** The scrolling 24-hour grid, opened at 7 AM. */
function HourGrid({ children }: { children: JSX.Element[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffectInBrowser(() => {
    if (ref.current) ref.current.scrollTop = 7 * HOUR
  }, [])
  return (
    <div className={css.scroll} ref={ref}>
      <div className={css.grid}>
        <div className={css.hours}>
          {Array.from({ length: 24 }, (_, h) => <div key={h} className={css.hour}>{hourLabel(h)}</div>)}
        </div>
        {children}
      </div>
    </div>
  )
}

/** A popover: a card beside its anchor with an arrow pointing at it, centered on
 *  the anchor and kept on screen (flipping to the left when there's no room). Grows from the arrow, fades out
 *  when dismissed; closes on an outside click or Escape. Keeps its last content while it fades. */
function Popover({ anchor, onClose, children }: { anchor: DOMRect | null; onClose: () => void; children: JSX.Element | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const { mounted, leaving } = usePresence(!!anchor, 150)
  const last = useRef<{ anchor: DOMRect; children: JSX.Element } | null>(null)
  if (anchor && children) last.current = { anchor, children }
  const [height, setHeight] = useState(0)

  useLayoutEffectInBrowser(() => {
    if (mounted && ref.current) setHeight(ref.current.offsetHeight)
  })

  useEffect(() => {
    if (!anchor) return
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // Deferred so the click that opened it doesn't close it.
    const t = setTimeout(() => document.addEventListener('mousedown', away))
    document.addEventListener('keydown', esc)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [anchor, onClose])

  if (!mounted || !last.current) return null
  const pos = place(last.current.anchor, 380, height, window.innerWidth, window.innerHeight)
  return (
    <div
      ref={ref}
      className={`${css.popover} ${pos.side === 'left' ? css.flipped : ''} ${leaving ? css.leaving : ''}`}
      style={{ left: pos.x, top: pos.y, ['--arrow-y' as string]: `${pos.arrowY}px`, visibility: height ? undefined : 'hidden' }}
    >
      {last.current.children}
    </div>
  )
}

/** Electron prefixes rejections with "Error invoking remote method '…': Error: ". */
export function message(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
