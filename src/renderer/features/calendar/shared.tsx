import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlignLeft, Check, CircleHelp, MapPin, SquareArrowOutUpRight, Users, Video, X } from 'lucide-react'
import type { CalendarEvent, RSVP, Toolkit } from '../../../shared/types'
import { useApp } from '../../app/store'
import { Avatar, Button } from '../../components'
import { play } from '../../sound'
import { guestSummary, linkify, longNotes, myStatus, tidy, when } from './logic'
import css from './calendar.module.css'

/** The logins with a working `toolkit` grant. Re-reads Connections once when none are known yet; `checked` is false until that answers. */
export function useConnected(toolkit: Toolkit): { logins: string[]; checked: boolean } {
  const { state, patch } = useApp()
  const key = state.accounts
    .filter((a) => a.grants.some((g) => g.toolkit === toolkit && g.ok))
    .map((a) => a.login)
    .join('\n')
  const logins = useMemo(() => (key ? key.split('\n') : []), [key])
  const [checked, setChecked] = useState(logins.length > 0)
  useEffect(() => {
    if (logins.length) return setChecked(true)
    let live = true
    window.bridle.composio.accounts()
      .then((accounts) => live && accounts.length && patch({ accounts }), () => {})
      .finally(() => live && setChecked(true))
    return () => { live = false }
    // Once per mount; a later account change re-renders through `key`.
  }, [])
  return { logins, checked }
}

/** A link that opens in the browser. */
export function OutLink({ href, className, children, title, cue = 'tap' }:
  { href: string; className?: string; children: ReactNode; title?: string; cue?: 'tap' | 'open' }) {
  return (
    <a
      href={href}
      className={className}
      title={title}
      onClick={(e) => {
        e.preventDefault()
        play(cue)
        void window.bridle.shell.openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

/** Plain text with its URLs clickable. */
export function Linkified({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((r, i) => (r.href ? <OutLink key={i} href={r.href} className={css.link}>{r.text}</OutLink> : r.text))}
    </>
  )
}

/** SenderAvatar with the RSVP badge in its corner. */
export function GuestAvatar({ name, status, size = 26 }: { name: string; status?: string; size?: number }) {
  const badge = status === 'accepted' ? [<Check key="i" size={7} strokeWidth={4} />, 'var(--green)']
    : status === 'declined' ? [<X key="i" size={7} strokeWidth={4} />, 'var(--red)']
      : status === 'tentative' ? [<CircleHelp key="i" size={8} strokeWidth={3} />, 'var(--orange)'] : null
  return (
    <span className={css.guestAvatar}>
      <Avatar name={name} seed={name} size={size} />
      {badge && <span className={css.badge} style={{ background: badge[1] as string }}>{badge[0]}</span>}
    </span>
  )
}

const ANSWERS: [string, RSVP][] = [['Yes', 'accepted'], ['No', 'declined'], ['Maybe', 'tentative']]

/** Going? Yes / No / Maybe. */
export function Going({ mine, respond, compact = false }: { mine: string; respond: (s: RSVP) => void; compact?: boolean }) {
  return (
    <div className={`${css.going} ${compact ? css.compact : ''}`}>
      <span>Going?</span>
      {!compact && <span className={css.grow} />}
      {ANSWERS.map(([label, status]) => (
        <Button
          key={status}
          cue={mine === status ? 'tap' : 'select'}
          className={`${css.answer} ${mine === status ? css.on : ''}`}
          aria-pressed={mine === status}
          onClick={() => respond(status)}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

/** Google Calendar's event popover, simplified. */
export function EventCard({ event, color, respond }: { event: CalendarEvent; color: string; respond: (s: RSVP) => void }) {
  const [allGuests, setAllGuests] = useState(false)
  const [allNotes, setAllNotes] = useState(false)
  const notes = event.notes ? tidy(event.notes) : ''
  const mine = myStatus(event)
  const guests = allGuests ? event.guests : event.guests.slice(0, 5)
  const toggle = (on: boolean, set: (v: boolean) => void) => () => {
    play(on ? 'close' : 'open')
    set(!on)
  }

  return (
    <div className={css.card}>
      <div className={css.cardScroll}>
        <div className={css.cardHead}>
          <span className={css.swatch} style={{ background: color }} />
          <div className={css.cardTitles}>
            <h3>{event.title}</h3>
            <span>{when(event)}</span>
            <span className={css.tertiary}>{event.account}</span>
          </div>
          {event.link && (
            <OutLink href={event.link} className={css.iconLink} title="Open in Google Calendar">
              <SquareArrowOutUpRight size={14} />
            </OutLink>
          )}
        </div>

        {event.meeting && (
          <Detail icon={<Video size={15} />}>
            <OutLink href={event.meeting.url} className={`${css.join} tactile`}>Join {event.meeting.name}</OutLink>
            {event.meeting.code && <div className={`${css.small} ${css.selectable}`}>{event.meeting.code}</div>}
          </Detail>
        )}

        {event.location && (
          <Detail icon={<MapPin size={15} />}><span className={css.selectable}><Linkified text={event.location} /></span></Detail>
        )}

        {event.guests.length > 0 && (
          <Detail icon={<Users size={15} />}>
            <div className={css.guestHead}>
              <strong>{event.guests.length} guest{event.guests.length === 1 ? '' : 's'}</strong>
              <span>{guestSummary(event)}</span>
            </div>
            {guests.map((g) => (
              <div key={g.email} className={css.guest}>
                <GuestAvatar name={g.name ?? g.email} status={g.status} />
                <div>
                  <div className={css.ellipsis}>{g.name ?? g.email}</div>
                  {(g.organizer || g.me) && <div className={css.role}>{g.organizer ? 'Organizer' : 'You'}</div>}
                </div>
              </div>
            ))}
            {event.guests.length > 5 && (
              <Button cue={null} className={css.more} onClick={toggle(allGuests, setAllGuests)}>
                {allGuests ? 'Show fewer' : `Show all ${event.guests.length}`}
              </Button>
            )}
          </Detail>
        )}

        {notes && (
          <Detail icon={<AlignLeft size={15} />}>
            <div className={`${css.notes} ${allNotes ? '' : css.clamped}`}><Linkified text={notes} /></div>
            {longNotes(notes) && (
              <Button cue={null} className={css.more} onClick={toggle(allNotes, setAllNotes)}>
                {allNotes ? 'Show less' : 'Show more'}
              </Button>
            )}
          </Detail>
        )}
      </div>
      {mine && <div className={css.goingBar}><Going mine={mine} respond={respond} /></div>}
    </div>
  )
}

function Detail({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className={css.detail}>
      <span className={css.detailIcon}>{icon}</span>
      <div className={css.detailBody}>{children}</div>
    </div>
  )
}
