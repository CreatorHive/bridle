import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Archive, ChevronLeft, ChevronRight, ChevronUp, CircleCheck, Clock, Ellipsis, Forward, Mail as MailIcon, MailOpen,
  Reply, ReplyAll, Send, Sparkles, Star, Tag, Trash2
} from 'lucide-react'
import type { Mail } from '../../../shared/types'
import { useApp } from '../../app/store'
import { Avatar, Button, ShimmerText, StreamingMarkdown, Swap } from '../../components'
import { play, type Cue } from '../../sound'
import { logos } from '../../theme'
import { message } from '../calendar'
import { bodyOf, plainText, srcdoc } from './logic'
import css from './mail.module.css'

/** Initials on a gradient seeded by the sender, so each sender keeps a color. */
export function SenderAvatar({ name, size = 42 }: { name: string; size?: number }) {
  return <Avatar name={name} seed={name} size={size} />
}

/** A 28px icon button. */
export function ActionButton({ label, cue = 'tap', onClick, children }:
  { label: string; cue?: Cue | null; onClick: () => void; children: ReactNode }) {
  return (
    <Button cue={cue} className={css.action} aria-label={label} title={label} onClick={onClick}>{children}</Button>
  )
}

type Mode = 'draft' | 'summary'

/** ponytail: snooze is local only; Gmail's API has no snooze. Archive, delete, read and star write to Gmail. */
export function MailReader({ mail, update, previous, next, remove }: {
  mail: Mail
  update: (change: Partial<Mail>) => void
  previous: () => void
  next: () => void
  remove: (archive: boolean) => void
}) {
  const { state } = useApp()
  const agentName = state.settings?.agentName || 'Bridle'
  const userName = state.settings?.userName ?? ''
  const [card, setCard] = useState<Mode | null>(mail.draft ? 'draft' : null)
  const [cardText, setCardText] = useState(mail.draft ?? '')
  const [working, setWorking] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sent, setSent] = useState(false)
  const run = useRef<string | null>(null)

  // Leaving the message stops its stream.
  useEffect(() => () => { if (run.current) void window.bridle.agent.cancel(run.current) }, [])

  /** Streams a draft or a summary from the agent into the card. */
  const ask = async (mode: Mode) => {
    setCard(mode)
    setCardText('')
    setCollapsed(false)
    setEditing(false)
    setSent(false)
    setWorking('Thinking')
    const me = userName || 'me'
    const body = mail.body || (mail.html ? plainText(mail.html) : '')
    const prompt = mode === 'draft'
      ? `Draft a short, friendly email reply from ${me} to this message. Reply with only the email text.\n\nFrom: ${mail.from}\nSubject: ${mail.subject}\n\n${body}`
      : `Summarize this email in two or three short bullet points. Reply with only the bullets.\n\nFrom: ${mail.from}\nSubject: ${mail.subject}\n\n${body}`
    const chatId = `mail-${crypto.randomUUID()}`
    run.current = chatId
    let text = ''
    const off = window.bridle.on('agent:event', ({ chatId: id, event }) => {
      if (id !== chatId) return
      if (event.type === 'status' && !text) setWorking(event.status)
      if (event.type === 'text') setCardText((text += event.text))
    })
    try {
      await window.bridle.agent.run(chatId, prompt, [])
      play('ready', { emphasis: 'subtle' })
    } catch (e) {
      setCardText((text = `⚠️ ${message(e)}`))
      play('error')
    } finally {
      off()
      if (run.current === chatId) run.current = null
    }
    setWorking(null)
    if (mode === 'draft') update({ draft: text })
  }

  const startDraft = () => {
    if (mail.draft) {
      setCard('draft')
      setCardText(mail.draft)
      setCollapsed(false)
    } else void ask('draft')
  }

  const body = bodyOf(mail)

  return (
    <section className={css.reader}>
      <div className={css.toolbar}>
        <ActionButton label="Previous" cue={null} onClick={previous}><ChevronLeft size={15} /></ActionButton>
        <ActionButton label="Next" cue={null} onClick={next}><ChevronRight size={15} /></ActionButton>
        <span className={css.spacer} />
        <ActionButton label="Archive" cue="close" onClick={() => remove(true)}><Archive size={14} /></ActionButton>
        <ActionButton label="Delete" cue={null} onClick={() => { play('close', { emphasis: 'strong' }); remove(false) }}>
          <Trash2 size={14} />
        </ActionButton>
        <ActionButton
          label={mail.unread ? 'Mark read' : 'Mark unread'}
          cue={null}
          onClick={() => { play('toggle', { direction: mail.unread ? -1 : 1 }); update({ unread: !mail.unread }) }}
        >
          {mail.unread ? <MailOpen size={14} /> : <MailIcon size={14} />}
        </ActionButton>
        <ActionButton label="Snooze" onClick={() => update({ mailbox: 'Snoozed' })}><Clock size={14} /></ActionButton>
        <ActionButton label="Label" onClick={() => {}}><Tag size={14} /></ActionButton>
        <ActionButton label="More" onClick={() => {}}><Ellipsis size={14} /></ActionButton>
      </div>

      <div className={css.readerScroll}>
        <div className={css.readerBody}>
          <div className={css.subjectLine}>
            <h2>{mail.subject}</h2>
            <span className={css.boxPill}>{mail.mailbox}&nbsp;&nbsp;›</span>
          </div>

          <div className={css.sender}>
            <SenderAvatar name={mail.from} size={46} />
            <div className={css.senderText}>
              <div><strong>{mail.from}</strong><span>{mail.email}</span></div>
              <span>to me</span>
            </div>
            <span className={css.time}>{mail.time}</span>
            <ActionButton
              label={mail.starred ? 'Unstar' : 'Star'}
              cue={null}
              onClick={() => { play('toggle', { direction: mail.starred ? -1 : 1 }); update({ starred: !mail.starred }) }}
            >
              <Swap k={mail.starred ? 'on' : 'off'}>
                <Star size={14} fill={mail.starred ? 'currentColor' : 'none'} className={mail.starred ? css.starred : ''} />
              </Swap>
            </ActionButton>
            <ActionButton label="Reply" onClick={startDraft}><Reply size={14} /></ActionButton>
          </div>

          {body.kind === 'html' ? <HTMLMail html={body.content} /> : <div className={css.text}>{body.content}</div>}

          <div className={css.hr} />

          <div>
            <div className={css.quickLabel}>Quick actions</div>
            <div className={css.quick}>
              <QuickAction icon={<Reply size={14} />} title="Reply" onClick={startDraft} />
              <QuickAction icon={<ReplyAll size={14} />} title="Reply all" onClick={startDraft} />
              <QuickAction icon={<Forward size={14} />} title="Forward" onClick={() => {}} />
              <QuickAction icon={<Sparkles size={14} className={css.purple} />} title="Summarize" onClick={() => void ask('summary')} />
              <QuickAction icon={<img src={logos.bridle} alt="" />} title={`Ask ${agentName}`} filled onClick={() => void ask('draft')} />
            </div>
          </div>

          {card && (
            <div className={css.card}>
              {/* A plain button: no press dip. */}
              <button
                type="button"
                className={css.cardHead}
                aria-expanded={!collapsed}
                onClick={() => { play(collapsed ? 'open' : 'close'); setCollapsed(!collapsed) }}
              >
                <span className={css.sparkle}><Sparkles size={12} strokeWidth={2.5} /></span>
                <span>{card === 'summary' ? `Summary from ${agentName}` : `Draft a reply with ${agentName}?`}</span>
                <ChevronUp size={13} className={`${css.chevron} ${collapsed ? css.collapsed : ''}`} />
              </button>
              {/* Folds with MOTION.send: height and opacity together. */}
              <div className={`${css.fold} ${collapsed ? css.folded : ''}`} aria-hidden={collapsed || undefined}>
                <div className={css.foldInner}><div className={css.cardBody}>
                  {working && !cardText ? (
                    <div className={css.working}>
                      <Swap k={working} variant="rise"><ShimmerText>{working}</ShimmerText></Swap>
                    </div>
                  ) : editing ? (
                    <textarea className={css.editor} value={cardText} onChange={(e) => setCardText(e.target.value)} autoFocus />
                  ) : (
                    <StreamingMarkdown text={cardText} fromStart={!!working} />
                  )}
                  {card === 'draft' && !working && (
                    <div className={css.cardActions}>
                      {sent ? (
                        <span className={css.sent}><CircleCheck size={15} />Sent</span>
                      ) : (
                        <>
                          <Button className={css.pill} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</Button>
                          {/* Sending leaves the workspace: this press is the approval. ponytail: local only. */}
                          <Button cue="success" className={css.send} onClick={() => { update({ draft: cardText }); setSent(true) }}>
                            <Send size={14} />Send
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function QuickAction({ icon, title, filled, onClick }: { icon: ReactNode; title: string; filled?: boolean; onClick: () => void }) {
  return (
    <Button className={`${css.quickButton} ${filled ? css.filled : ''}`} onClick={onClick}>
      {icon}{title}
    </Button>
  )
}

/**
 * An HTML email, rendered as Mail.app would: no JavaScript from the message (sandbox without
 * allow-scripts), links open in your browser, and the frame grows to its content so the reader
 * scrolls it with the header. allow-same-origin lets this side measure it and catch link clicks;
 * <base target=_blank> makes any click we miss a popup the sandbox blocks, never a navigation.
 * ponytail: remote https images load (the page CSP allows them); add a "Load images" bar if tracking pixels matter.
 */
function HTMLMail({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(300)
  const observer = useRef<ResizeObserver | null>(null)

  useEffect(() => () => observer.current?.disconnect(), [])

  const onLoad = () => {
    const doc = frame.current?.contentDocument
    if (!doc) return
    const measure = () => {
      const h = Math.max(doc.documentElement.offsetHeight, doc.body?.scrollHeight ?? 0)
      if (h > 0) setHeight(h)
    }
    measure()
    observer.current?.disconnect()
    observer.current = new ResizeObserver(measure)
    observer.current.observe(doc.documentElement)
    if (doc.body) observer.current.observe(doc.body)
    doc.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      e.preventDefault()
      if (/^(https?|mailto):/i.test(a.href)) {
        play('tap')
        void window.bridle.shell.openExternal(a.href)
      }
    })
  }

  return (
    <iframe
      ref={frame}
      title="Message"
      className={css.html}
      sandbox="allow-same-origin"
      srcDoc={srcdoc(html)}
      style={{ height }}
      onLoad={onLoad}
    />
  )
}
