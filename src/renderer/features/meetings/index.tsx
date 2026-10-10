import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { FileText, Sparkles, SquareArrowOutUpRight, TriangleAlert, Users, Video } from 'lucide-react'
import type { CalendarEvent, RSVP } from '../../../shared/types'
import { Button, Markdown, Pill, Placeholder, Row, ShimmerText, SidebarHeader } from '../../components'
import { play } from '../../sound'
import { Going, GuestAvatar, Linkified, OutLink, message, useConnected } from '../calendar'
import { accountColor, dayLabel, myStatus, start, end, tidy, time, withStatus } from '../calendar/logic'
import { byDay, meetingKey, meetingsFrom, past, prepBody, prepPath, STATUS_LABELS, upcoming } from './logic'
import { viewer } from '../viewer'
import css from './meetings.module.css'

// Your calls and meetings with other people, from every connected Google Calendar.
// The sidebar and the screen share this small store.

interface State {
  events: CalendarEvent[]
  /** meetingKey of the open meeting; null = the next one. */
  selected: string | null
  loading: boolean
  error: string | null
}

let snapshot: State = { events: [], selected: null, loading: false, error: null }
const listeners = new Set<() => void>()
const set = (p: Partial<State>) => {
  snapshot = { ...snapshot, ...p }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const useMeetings = () => useSyncExternalStore(subscribe, () => snapshot, () => snapshot)

const DAY = 86_400_000

/** The last week and the next two. */
async function refresh() {
  if (snapshot.loading) return
  set({ loading: true })
  try {
    const now = Date.now()
    const all = await window.bridle.calendar.events(new Date(now - 7 * DAY).toISOString(), new Date(now + 14 * DAY).toISOString())
    set({ events: meetingsFrom(all), error: null })
  } catch (e) {
    set({ error: message(e) })
  } finally {
    set({ loading: false })
  }
}

/** Optimistic RSVP, rolled back if Google refuses. */
function respond(e: CalendarEvent, status: RSVP) {
  const before = myStatus(e)
  if (!before) return
  set({ events: withStatus(snapshot.events, e, status) })
  window.bridle.calendar.rsvp(e, status).catch((err: unknown) => {
    set({ error: message(err), events: withStatus(snapshot.events, e, before) })
    play('error')
  })
}

const current = (s: State) => s.events.find((e) => meetingKey(e) === s.selected) ?? upcoming(s.events)[0]

/** Loads meetings once a Google Calendar is known. */
function useLoad() {
  const { logins, checked } = useConnected('googlecalendar')
  useEffect(() => {
    if (logins.length) void refresh()
  }, [logins.length])
  return { connected: logins.length > 0, checked, logins }
}

/** What's coming, by day, and the last few that happened. */
export function MeetingsSidebar() {
  const state = useMeetings()
  useLoad()
  const now = new Date()
  const groups = byDay(upcoming(state.events, now))
  const earlier = past(state.events, now)
  const open = current(state)
  const row = (e: CalendarEvent, muted = false) => (
    <Row
      key={meetingKey(e)}
      title={`${time(start(e))}  ${e.title}`}
      icon={e.meeting ? <Video size={16} /> : <Users size={16} />}
      selected={!!open && meetingKey(open) === meetingKey(e)}
      muted={muted}
      dot={myStatus(e) === 'needsAction'}
      onClick={() => set({ selected: meetingKey(e) })}
    />
  )
  return (
    <>
      {groups.length === 0 && <SidebarHeader title={state.loading ? 'Loading meetings…' : 'No meetings coming up'} divider={false} />}
      {groups.map((g) => (
        <Fragment key={g.day.getTime()}>
          <SidebarHeader title={dayLabel(g.day, now)} divider={false} />
          {g.events.map((e) => row(e))}
        </Fragment>
      ))}
      {earlier.length > 0 && (
        <>
          <SidebarHeader title="Earlier" divider={false} />
          {earlier.map((e) => row(e, true))}
        </>
      )}
    </>
  )
}

/** One meeting, with Join, RSVP, a prep note, people, about and where. */
export function MeetingsScreen() {
  const state = useMeetings()
  const { connected, checked, logins } = useLoad()
  const e = current(state)

  if (!connected && !state.loading) {
    return checked
      ? <Placeholder title="No calendar connected">Connect Google in Settings → Connections to see your meetings here.</Placeholder>
      : null
  }
  if (!e) return <Placeholder title={state.loading ? 'Loading…' : 'No meetings coming up'} />
  return (
    <div className={css.scroll} key={meetingKey(e)}>
      <Detail event={e} color={accountColor(e.account, logins)} error={state.error} />
    </div>
  )
}

function Detail({ event: e, color, error }: { event: CalendarEvent; color: string; error: string | null }) {
  const [prep, setPrep] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const file = useRef<string | null>(null)
  const mine = myStatus(e)
  const notes = e.notes ? tidy(e.notes) : ''

  // The saved note, if Bridle already wrote one.
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        file.current = prepPath(await window.bridle.workspace.path(), e)
        const text = await window.bridle.workspace.readFile(file.current)
        if (live) setPrep(prepBody(text))
      } catch { /* none yet */ }
    })()
    return () => { live = false }
  }, [])

  const prepare = async () => {
    setPreparing(true)
    const note = await window.bridle.watcher.prepNote(e).catch(() => null)
    if (note) setPrep(note)
    else play('error')
    setPreparing(false)
  }

  return (
    <div className={css.detail}>
      <div className={css.head}>
        <div className={css.when}>
          <i style={{ background: color }} />
          {dayLabel(start(e))} · {time(start(e))} – {time(end(e))} · {e.account}
        </div>
        <h2>{e.title}</h2>
        {error && <div className={css.error}><TriangleAlert size={12} />{error}</div>}
      </div>

      <div className={css.actions}>
        {e.meeting && (
          <OutLink href={e.meeting.url} className={`${css.join} tactile`} cue="open"><Video size={15} fill="currentColor" />Join {e.meeting.name}</OutLink>
        )}
        {e.link && (
          <OutLink href={e.link} className={`${css.outline} tactile`} cue="open"><SquareArrowOutUpRight size={14} />Open in Google Calendar</OutLink>
        )}
        <span className={css.grow} />
        {mine && <Going mine={mine} respond={(s) => respond(e, s)} compact />}
      </div>
      {e.meeting?.code && <div className={css.code}>{e.meeting.code}</div>}

      <Section title="Prep">
        {preparing ? (
          <span className={css.muted}><ShimmerText>Reading the invite and your recent mail with them…</ShimmerText></span>
        ) : prep ? (
          <div className={css.appear}><Markdown text={prep} /></div>
        ) : (
          <span className={css.muted}>
            A short brief from the invite and your recent email with these people. Bridle also posts one in Home before the meeting.
          </span>
        )}
        <div className={css.buttons}>
          <Button className={css.prepare} disabled={preparing} onClick={() => void prepare()}>
            <Sparkles size={13} />{prep ? 'Prepare again' : 'Prepare'}
          </Button>
          {prep && file.current && (
            <Pill cue={null} className={css.small} onClick={() => viewer.open(file.current!)}>
              <FileText size={13} />Open note
            </Pill>
          )}
        </div>
      </Section>

      {e.guests.length > 0 && (
        <Section title={`People · ${e.guests.length}`}>
          {e.guests.map((g) => (
            <div key={g.email} className={css.person}>
              <GuestAvatar name={g.name ?? g.email} size={28} />
              <div>
                <span>{g.name ?? g.email}</span>
                <span>{[g.organizer && 'Organizer', g.me && 'You', STATUS_LABELS[g.status]].filter(Boolean).join(' · ')}</span>
              </div>
            </div>
          ))}
        </Section>
      )}

      {notes && <Section title="About"><div className={css.text}><Linkified text={notes} /></div></Section>}
      {e.location && <Section title="Where"><div className={css.text}><Linkified text={e.location} /></div></Section>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={css.section}>
      <h3>{title}</h3>
      {children}
    </section>
  )
}
