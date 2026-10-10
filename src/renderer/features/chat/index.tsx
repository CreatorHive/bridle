import { useEffect, useRef, useState, type DragEvent, type Ref } from 'react'
import { flushSync } from 'react-dom'
import { ChevronDown, Ellipsis } from 'lucide-react'
import type { Chat } from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/types'
import { flip, Menu, MOTION, reducedMotion, type Box, useLayoutEffectInBrowser } from '../../components'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import { Composer } from './Composer'
import { basename, chatFilePath, contactsLine, greeting, modelChoice, POLICY_CAPTION, uuid } from './logic'
import { cancel, editChat, insertChat, isRunning, saveChat, send, sync, upload, workspaceRoot } from './session'
import { AgentAvatar, Transcript } from './Transcript'
import s from './chat.module.css'

/** Where the new-chat page's pieces were just before a new chat starts, so they can glide. */
interface Glide { composer: Box; caption: Box; header: Box | null }

/** The new-chat page (greeting over a centered composer) gliding into a transcript once you send. */
export function ChatScreen() {
  const { state, patch, upsertChat, setSetting } = useApp()
  const settings = state.settings ?? DEFAULT_SETTINGS
  const agentName = settings.agentName || 'Bridle'
  const chat = state.chats.find((c) => c.id === state.chatId)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [renaming, setRenaming] = useState(false)

  useEffect(() => sync(state.chats, upsertChat, (working) => patch({ working })), [state.chats, upsertChat, patch])
  useEffect(() => setRenaming(false), [chat?.id])
  // On LM Studio the model menu lists what it has downloaded.
  const [lmModels, setLmModels] = useState<string[]>([])
  useEffect(() => {
    if (settings.provider === 'LM Studio') window.bridle.lmStudio.models().then((ms) => setLmModels(ms.map((m) => m.id)), () => setLmModels([]))
  }, [settings.provider])

  // "Ask about this file" (Files) hands its file to the composer.
  useEffect(() => {
    const file = state.askAbout
    if (!file) return
    patch({ askAbout: null })
    setAttachments((a) => (a.includes(file) ? a : [...a, file]))
  }, [state.askAbout, patch])

  const options = () => ({ agentName, contacts: contactsLine(state.mail, state.accounts) })

  /** Takes the draft and its attachments (copied into the workspace) and clears the composer. */
  const take = async () => {
    play('tap')
    const text = draft
    const files = await upload(attachments)
    setDraft('')
    setAttachments([])
    return { text, files }
  }

  const reply = async (target: Chat) => {
    const { text, files } = await take()
    void send({ chatId: target.id, text, files, ...options() })
  }

  // The composer and caption keep their DOM across the switch; FLIP stands in for matchedGeometryEffect.
  const screen = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const captionRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const glide = useRef<Glide | null>(null)
  const [ghost, setGhost] = useState<Box | null>(null)
  const [entering, setEntering] = useState(false)

  const newChat = async () => {
    const first = attachments[0]
    const { text, files } = await take()
    const fresh: Chat = { id: uuid(), title: text || (first ? basename(first) : ''), messages: [] }
    const base = screen.current?.getBoundingClientRect()
    const rect = (el: HTMLElement | null): Box | null => {
      if (!el || !base) return null
      const r = el.getBoundingClientRect()
      return { left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height }
    }
    if (!reducedMotion() && composerRef.current && captionRef.current) {
      glide.current = {
        composer: composerRef.current.getBoundingClientRect(),
        caption: captionRef.current.getBoundingClientRect(),
        header: rect(headerRef.current)
      }
    }
    flushSync(() => {
      insertChat(fresh)
      patch({ chatId: fresh.id })
    })
    // "Thinking" waits until the composer has settled, so the two motions don't overlap.
    void send({ chatId: fresh.id, text, files, thinkingDelay: 350, ...options() })
  }

  // MOTION.settle: the centered composer glides (and shrinks from 1.04×) to the bottom, the
  // greeting lifts away, the glow fades and the transcript fades in.
  useLayoutEffectInBrowser(() => {
    const g = glide.current
    glide.current = null
    if (!g || !chat) return
    if (composerRef.current) flip(composerRef.current, g.composer, MOTION.settle)
    if (captionRef.current) flip(captionRef.current, g.caption, MOTION.settle)
    setGhost(g.header)
    setEntering(true)
  }, [chat?.id])

  // Files dropped anywhere on the chat wait in the composer until you send.
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const paths = [...e.dataTransfer.files].map(pathOf).filter((p) => p && !attachments.includes(p))
    if (!paths.length) return
    play('select')
    setAttachments([...attachments, ...paths])
  }

  /** Rename / Move / Delete from the "…" menu. */
  const rename = (title: string) => {
    setRenaming(false)
    const t = title.trim()
    if (!chat || !t || t === chat.title) return
    play('success', { emphasis: 'subtle' })
    editChat(chat.id, (c) => ({ ...c, title: t }))
    saveChat(chat.id)
  }
  const remove = async () => {
    if (!chat) return
    if (isRunning(chat.id)) cancel(chat.id)
    const path = chatFilePath(chat, await workspaceRoot())
    // An unsaved (empty) chat has no file; it just goes.
    if (path) await window.bridle.workspace.trashFile(path).catch(() => {})
    patch({ chats: state.chats.filter((c) => c.id !== chat.id), chatId: null })
  }

  const working = !!chat && state.working.includes(chat.id)
  const centered = !chat
  const model = modelChoice(settings)
  if (settings.provider === 'LM Studio' && lmModels.length) model.models = lmModels
  return (
    <div ref={screen} className={s.screen} onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()} onDrop={onDrop}>
      {/* HomeGlow: the new-chat page sits on a faint light rising from the bottom. */}
      <div className={`${s.glow} ${centered ? '' : s.glowOff}`} />
      <div className={s.topBar}>
        {renaming && chat ? (
          <RenameField title={chat.title} onDone={rename} />
        ) : (
          <div className={s.modelMenu} title={`Answering with ${settings.provider}`}>
            <Menu
              label="Model"
              trigger={<span className={s.modelLabel}>{model.label}<ChevronDown size={11} strokeWidth={2.8} /></span>}
              items={[
                ...model.models.map((m) => ({
                  label: m,
                  checked: m === model.value,
                  onSelect: () => model.key && setSetting(model.key, m)
                })),
                { label: `Answering with ${settings.provider}`, disabled: true, separator: true }
              ]}
            />
          </div>
        )}
        {chat && (
          <span className={s.topRight}>
            <Menu
              label="More"
              trigger={<span className={s.more} title="More"><Ellipsis size={17} strokeWidth={2.4} /></span>}
              items={[
                { label: 'Rename', onSelect: () => setRenaming(true) },
                // ponytail: Projects aren't ported, so there's nowhere to move a chat yet.
                { label: 'Move to Goal…', disabled: true },
                { label: 'Delete', destructive: true, separator: true, onSelect: () => void remove() }
              ]}
            />
          </span>
        )}
      </div>
      {chat ? <Transcript chatId={chat.id} messages={chat.messages} agentName={agentName} working={working} enter={entering} /> : <div className={s.spacerTop} />}
      {centered ? <HomeHeader boxRef={headerRef} userName={settings.userName} agentName={agentName} /> : null}
      <div className={`${s.footer} ${centered ? s.centered : ''}`}>
        <div ref={composerRef} className={s.composerWrap}>
          <Composer
            draft={draft} setDraft={setDraft}
            attachments={attachments} setAttachments={setAttachments}
            working={working} agentName={agentName}
            onSend={() => void (chat ? reply(chat) : newChat())}
            onStop={() => chat && cancel(chat.id)}
          />
        </div>
        <div ref={captionRef} className={s.caption}>{POLICY_CAPTION[settings.approvalPolicy] ?? POLICY_CAPTION['Always ask']}</div>
      </div>
      {centered ? <div className={s.spacerBottom} /> : null}
      {ghost && !centered && (
        // The greeting leaving: .opacity + .offset(y: -14) + .scale(0.97) on the settle spring.
        <div className={s.headerGhost} style={{ left: ghost.left, top: ghost.top, width: ghost.width }} aria-hidden
          onAnimationEnd={() => { setGhost(null); setEntering(false) }}>
          <HomeHeader userName={settings.userName} agentName={agentName} />
        </div>
      )}
    </div>
  )
}

/** HomeHeader: the agent's avatar (breathing) and a time-of-day greeting with today's date. */
function HomeHeader({ userName, agentName, boxRef }: { userName: string; agentName: string; boxRef?: Ref<HTMLDivElement> }) {
  const today = new Date()
  return (
    <div ref={boxRef} className={s.homeHeader}>
      <span className={s.homeAvatar}><AgentAvatar name={agentName} size={52} plain /></span>
      <div>
        <h2>{greeting(today.getHours(), userName)}</h2>
        <p>{today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </div>
    </div>
  )
}

/** Rename: the chat's title in the top bar's capsule; Return saves, Escape cancels. */
function RenameField({ title, onDone }: { title: string; onDone: (title: string) => void }) {
  const [value, setValue] = useState(title)
  const done = useRef(false)
  const finish = (t: string) => {
    if (done.current) return
    done.current = true
    onDone(t)
  }
  return (
    <input
      className={`${s.modelMenu} ${s.rename}`}
      aria-label="Chat title"
      autoFocus
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') {
          e.stopPropagation()
          finish(title)
        }
      }}
    />
  )
}

/** A dropped file's path (Electron 32+ dropped File.path; the preload exposes webUtils.getPathForFile). */
const pathOf = (file: File): string => window.bridle.pathForFile(file)
