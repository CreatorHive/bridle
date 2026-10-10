import { useCallback, useEffect, useRef, useState } from 'react'
import { ListFilter, Mail as MailIcon, Paperclip, RotateCw, SquarePen, Star, TriangleAlert } from 'lucide-react'
import type { Mail } from '../../../shared/types'
import { useApp } from '../../app/store'
import { Button, Menu, ShimmerText, spring } from '../../components'
import { play } from '../../sound'
import { message, useConnected } from '../calendar'
import { boxesToLoad, byTab, inBox, MAIL_TABS, mergeMail, preview, sampleMail, type MailTab } from './logic'
import { ActionButton, MailReader, SenderAvatar } from './Reader'
import css from './mail.module.css'

/** The inbox column beside the reader. The shell's sidebar shows Accounts and
 *  Views from useApp().state (mailbox, mailAccount, mail); this screen keeps state.mail filled. */
export function MailScreen() {
  const { state, patch } = useApp()
  const { mailbox, mailAccount: account } = state
  const { logins, checked } = useConnected('gmail')
  const [mailId, setMailId] = useState<string | null>(null)
  const [tab, setTab] = useState<MailTab>('All')
  const [loads, setLoads] = useState(0) // in flight; switching views cancels one load while the next starts
  const [syncs, setSyncs] = useState(0) // Sync presses; each one reloads the view
  const syncedThrough = useRef(0)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = loads > 0

  // The store only merges patches, so read-modify-write goes through the latest mail.
  const mailRef = useRef(state.mail)
  mailRef.current = state.mail
  const tabRef = useRef(tab)
  tabRef.current = tab
  const setMail = useCallback((change: (mail: Mail[]) => Mail[]) => {
    mailRef.current = change(mailRef.current)
    patch({ mail: mailRef.current })
  }, [patch])

  const box = inBox(state.mail, mailbox, account)
  const shown = byTab(box, tab)
  const firstShown = () => byTab(inBox(mailRef.current, mailbox, account), tabRef.current)[0]?.id ?? null

  // No Gmail: the sample inbox (a real load replaces it).
  useEffect(() => {
    if (!checked || logins.length || mailRef.current.length) return
    setMail(() => sampleMail())
    setMailId(firstShown())
  }, [checked, logins.length, setMail])

  useEffect(() => setMailId(firstShown()), [mailbox, account])

  useEffect(() => {
    if (!logins.length) return
    const picked = logins.filter((l) => account === null || l === account)
    if (!picked.length) return
    let cancelled = false
    const refreshInbox = syncs > syncedThrough.current // a Sync press re-reads the Inbox (badge) too
    syncedThrough.current = syncs
    setLoads((n) => n + 1)
    setError(null)
    void (async () => {
      try {
        for (const b of boxesToLoad(mailRef.current, mailbox, picked, refreshInbox)) {
          const fetched = await window.bridle.gmail.load(b, account)
          if (cancelled) return
          setMail((mail) => mergeMail(mail, fetched, b, picked))
        }
        setLastSynced(new Date())
      } catch (e) {
        if (!cancelled) setError(message(e))
      } finally {
        setLoads((n) => n - 1)
        if (!cancelled) {
          const ids = byTab(inBox(mailRef.current, mailbox, account), tabRef.current).map((m) => m.id)
          setMailId((id) => (id && ids.includes(id) ? id : ids[0] ?? null))
        }
      }
    })()
    return () => { cancelled = true }
  }, [mailbox, account, syncs, logins.join('\n'), setMail])

  const canSync = !loading && logins.length > 0
  const sync = () => {
    if (!canSync) return
    play('tap')
    setSyncs((n) => n + 1)
  }

  // ⌘R syncs.
  const syncRef = useRef(sync)
  syncRef.current = sync
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        syncRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const local = (id: string, change: Partial<Mail>) => setMail((mail) => mail.map((m) => (m.id === id ? { ...m, ...change } : m)))
  /** Read and star changes go to Gmail too; if Gmail says no, the message goes back as it was. */
  const update = (id: string, change: Partial<Mail>) => {
    const m = mailRef.current.find((x) => x.id === id)
    local(id, change)
    if (!m?.gmailID) return
    const add: string[] = []
    const remove: string[] = []
    if (change.unread !== undefined && change.unread !== m.unread) (change.unread ? add : remove).push('UNREAD')
    if (change.starred !== undefined && change.starred !== m.starred) (change.starred ? add : remove).push('STARRED')
    if (add.length || remove.length) window.bridle.gmail.label(m.account, m.gmailID, add, remove).catch((e) => fail(e, () => local(id, m)))
  }
  const fail = (e: unknown, undo: () => void) => {
    undo()
    setError(message(e))
    play('error', { emphasis: 'subtle' })
  }
  const open = (id: string) => {
    setMailId(id)
    update(id, { unread: false })
  }
  const step = (by: number) => {
    const i = shown.findIndex((m) => m.id === mailId)
    if (i < 0 || !shown[i + by]) return
    play('select', { direction: by })
    open(shown[i + by].id)
  }
  /** Archive (out of the Inbox) or Trash, in Gmail; a failure puts the message back. */
  const remove = (id: string, archive: boolean) => {
    const m = mailRef.current.find((x) => x.id === id)
    if (!m) return
    step(1)
    setMail((mail) => mail.map((x) => (x.id === id ? { ...x, mailbox: archive ? 'Archive' as const : 'Trash' as const } : x)))
    if (!m.gmailID) return
    const write = archive ? window.bridle.gmail.label(m.account, m.gmailID, [], ['INBOX']) : window.bridle.gmail.trash(m.account, m.gmailID)
    write.catch((e) => fail(e, () => local(id, m)))
  }

  const selected = state.mail.find((m) => m.id === mailId)
  const unread = box.filter((m) => m.unread).length

  return (
    <div className={css.screen}>
      <section className={css.list}>
        <div className={css.head}>
          <div className={css.titles}>
            <h2 className={css.title}>{mailbox}</h2>
            <div className={css.status}>
              {error ? (
                <span className={css.error}><TriangleAlert size={12} />{error}</span>
              ) : loading && box.length === 0 ? (
                <ShimmerText>Syncing {account ?? 'your inboxes'}…</ShimmerText>
              ) : (
                <span>{unread} unread · {box.length} total{logins.length ? ` · ${account ?? 'all inboxes'}` : ''}</span>
              )}
              {loading && <span className="b-spinner" />}
            </div>
          </div>
          {/* The sort menu does nothing yet. */}
          <Menu label="Sort and filter" trigger={<span className={css.action}><ListFilter size={15} /></span>}
            items={[{ label: 'Newest first', onSelect: () => {} }, { label: 'Unread first', onSelect: () => {} }]} />
          <Button
            cue={null}
            className={css.action}
            disabled={!canSync}
            onClick={sync}
            aria-label="Sync mail"
            title={lastSynced ? `Sync mail (⌘R) · last synced ${lastSynced.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Sync mail (⌘R)'}
          >
            <RotateCw size={14} className={loading ? css.spin : ''} />
          </Button>
          <ActionButton label="Compose" cue="open" onClick={() => {}}><SquarePen size={14} /></ActionButton>
        </div>

        <MailTabs selection={tab} onSelect={setTab} />

        <div className={css.rows}>
          {shown.map((m, i) => (
            <div key={m.id}>
              <MailRow mail={m} selected={m.id === mailId} onClick={() => open(m.id)} />
              {i < shown.length - 1 && <div className={css.divider} />}
            </div>
          ))}
          {shown.length === 0 && (loading
            ? Array.from({ length: 7 }, (_, i) => <SkeletonRow key={i} />)
            : <div className={css.empty}>Nothing here.</div>)}
        </div>
      </section>

      {selected ? (
        <MailReader
          key={selected.id}
          mail={selected}
          update={(change) => update(selected.id, change)}
          previous={() => step(-1)}
          next={() => step(1)}
          remove={(archive) => remove(selected.id, archive)}
        />
      ) : (
        <div className={css.noSelection}><MailIcon size={28} strokeWidth={1.5} />No message selected</div>
      )}
    </div>
  )
}

/** MailTabs thumb: spring(response 0.3, damping 0.85). */
const THUMB = spring(0.3, 0.85)

/** All / Unread / Mentions / Attachments, a pill with a sliding white thumb. Plain buttons (no press dip). */
function MailTabs({ selection, onSelect }: { selection: MailTab; onSelect: (t: MailTab) => void }) {
  const move = `${THUMB.duration}ms ${THUMB.easing}`
  return (
    <div className={css.tabs} role="tablist" style={{ ['--thumb' as string]: move }}>
      <span className={css.thumb} style={{ transform: `translateX(${MAIL_TABS.indexOf(selection) * 100}%)` }} />
      {MAIL_TABS.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={selection === t}
          className={css.tab}
          onClick={() => { play('select'); onSelect(t) }}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

function MailRow({ mail, selected, onClick }: { mail: Mail; selected: boolean; onClick: () => void }) {
  return (
    <Button cue="select" className={`${css.row} ${selected ? css.selected : ''}`} onClick={onClick} aria-current={selected || undefined}>
      <SenderAvatar name={mail.from} />
      <div className={css.rowMain}>
        <div className={css.rowTop}>
          <span className={css.from}>{mail.from}</span>
          <span className={css.time}>{mail.time}</span>
        </div>
        <div className={css.rowBottom}>
          <div className={css.rowMain}>
            <span className={`${css.subject} ${mail.unread ? css.unread : ''}`}>{mail.subject}</span>
            <span className={css.snippet}>{preview(mail)}</span>
          </div>
          <div className={css.marks}>
            {mail.unread && <span className={css.dot} aria-label="Unread" />}
            {mail.starred && <Star size={10} fill="currentColor" className={css.starred} aria-label="Starred" />}
            {mail.attachment && <Paperclip size={10} color="var(--tertiary)" aria-label="Attachment" />}
          </div>
        </div>
      </div>
    </Button>
  )
}

/** A placeholder in the shape of a MailRow while the mailbox syncs; one highlight sweeps the whole row
 *  (SkeletonSweep). White on the white list is invisible, so only the wash shapes light up: no mask needed. */
function SkeletonRow() {
  return (
    <div className={css.skeleton} aria-hidden>
      <span className={css.bone} style={{ width: 42, height: 42 }} />
      <div className={css.skeletonLines}>
        <div className={css.skeletonTop}>
          <span className={css.bone} style={{ width: 120, height: 11 }} />
          <span className={css.bone} style={{ width: 40, height: 9 }} />
        </div>
        <span className={css.bone} style={{ width: 210, height: 10 }} />
        <span className={css.bone} style={{ height: 9 }} />
      </div>
    </div>
  )
}
