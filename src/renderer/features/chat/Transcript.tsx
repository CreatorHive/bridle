import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, Copy, FileText, Volume2, X } from 'lucide-react'
import type { Message, ToolCall } from '../../../shared/types'
import { Avatar, Button, ShimmerText, StreamingMarkdown, Swap } from '../../components'
import { play } from '../../sound'
import { basename, extractActions, isImage, mentionedFiles, traceTarget, absolutePath } from './logic'
import { deniedNow, workspaceRoot } from './session'
import { ToolCard } from './ToolCard'
import { viewer } from '../viewer'
import s from './chat.module.css'

/** Every turn, newest at the bottom (column-reverse keeps the scroll pinned there).
 *  Turns already there when the chat opens just show; turns added while it's open play their transition
 *  (sendEntry for yours, replyEntry for the agent's and its cards). */
export function Transcript({ chatId, messages, agentName, working = false, enter = false }:
  { chatId: string; messages: Message[]; agentName: string; working?: boolean; enter?: boolean }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the turns present when this chat opened
  const opened = useMemo(() => new Set(messages.map((m) => m.id)), [chatId])
  return (
    <div className={`${s.scroll} ${enter ? s.scrollEnter : ''}`}>
      <div className={s.transcript}>
        {messages.map((m) => (
          <MessageRow key={m.id} chatId={chatId} message={m} agentName={agentName} fresh={!opened.has(m.id)} working={working} />
        ))}
      </div>
    </div>
  )
}

function MessageRow({ chatId, message, agentName, fresh, working }:
  { chatId: string; message: Message; agentName: string; fresh: boolean; working: boolean }) {
  switch (message.role) {
    case 'user':
      return (
        <div className={`${s.user} ${fresh ? 'b-send-entry' : ''}`}>
          {!!message.files?.length && (
            <div className={s.files}>
              {message.files.map((f) => (
                <Button key={f} cue={null} className={s.chipButton} onClick={() => open(f)}>
                  <AttachmentChip path={f} />
                </Button>
              ))}
            </div>
          )}
          {message.text && <div className={s.bubble}>{message.text}</div>}
        </div>
      )
    case 'assistant':
      return <AgentMessage message={message} agentName={agentName} fresh={fresh} live={fresh && working} />
    case 'tool':
      // Dismissed cards, and ones denied before this session, are only in the trace now.
      return message.dismissed || (message.approved === false && !deniedNow.has(message.id))
        ? null : <ToolCard chatId={chatId} message={message} fresh={fresh} />
  }
}

/** Opens a file in the viewer side panel (Viewer.open plays `open`, so the buttons stay silent). */
const open = (path: string) => void workspaceRoot().then((ws) => viewer.open(absolutePath(path, ws)))

/** Which of `paths` (workspace-relative or absolute) exist, each with its absolute path. */
function useFound(paths: string[]): Map<string, string> {
  const [found, setFound] = useState<Map<string, string>>(new Map())
  const key = paths.join('\n')
  useEffect(() => {
    let live = true
    void workspaceRoot().then((ws) => Promise.all(paths.map((p) =>
      window.bridle.viewer.inspect(absolutePath(p, ws)).then(() => [p, absolutePath(p, ws)] as const, () => null))))
      .then((hits) => live && setFound(new Map(hits.filter((h) => !!h))))
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- paths is a fresh array each render
  return found
}

let picture: Promise<string | null> | null = null
/** AgentPicture: agent/avatar.png in the workspace, or initials without one. */
function useAgentPicture(): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    picture ??= window.bridle.avatar.get().catch(() => null)
    let live = true
    void picture.then((p) => live && setSrc(p))
    return () => { live = false }
  }, [])
  return src
}

/** Your picture for the agent, else the indigo sphere (lettered unless `plain`).
 *  While thinking it breathes to 1.05× (easeInOut 0.9 s, forever). */
export function AgentAvatar({ name, size = 36, thinking = false, plain = false }: { name: string; size?: number; thinking?: boolean; plain?: boolean }) {
  const image = useAgentPicture()
  return (
    <span className={`${s.agentAvatar} ${thinking ? s.thinking : ''}`}>
      <Avatar name={name} image={image} size={size} lettered={!plain} />
    </span>
  )
}

/** AgentMessage: avatar and name, then the reply (or the working row while it runs), what the agent did,
 *  and copy / read-aloud on hover. */
function AgentMessage({ message, agentName, fresh, live }: { message: Message; agentName: string; fresh: boolean; live: boolean }) {
  const [copied, setCopied] = useState(false)
  const trace = message.trace ?? []
  const text = extractActions(message.text).text
  const working = message.status != null
  const files = useFound(working ? [] : mentionedFiles(text))
  return (
    <div className={`${s.agent} ${fresh ? 'b-reply-entry' : ''}`} onMouseLeave={() => setCopied(false)}>
      <AgentAvatar name={agentName} thinking={working} />
      <div className={s.agentBody}>
        <div className={s.agentName}>{agentName}</div>
        {working && !text ? (
          <WorkingRow status={message.status!} workers={message.workers ?? []} />
        ) : (
          <>
            {/* An action block streams in as raw JSON; hide it until it becomes a card. A reply that
                arrives while you watch fades in character by character from its first chunk. */}
            <StreamingMarkdown text={text} fromStart={live} />
            {/* Files the reply names, as the cards attachments get; a card opens its file. */}
            {files.size > 0 && (
              <div className={`${s.files} ${s.mentioned}`}>
                {[...files].map(([rel, path]) => (
                  <Button key={rel} cue={null} className={s.chipButton} onClick={() => open(path)}>
                    <AttachmentChip path={path} />
                  </Button>
                ))}
              </div>
            )}
            {trace.length > 0 && <Trace trace={trace} calls={message.calls ?? []} />}
            {/* Still going after its first words (a tool running): the working row under what it did so far. */}
            {working ? <WorkingRow status={message.status!} workers={message.workers ?? []} /> : <div className={s.actions}>
              <Button cue={null} className={s.actionButton} title="Copy" aria-label="Copy" onClick={() => {
                void navigator.clipboard.writeText(message.text)
                play('success', { emphasis: 'subtle' })
                setCopied(true)
              }}>
                <Swap k={copied ? 'check' : 'copy'}>{copied ? <Check size={14} /> : <Copy size={14} />}</Swap>
              </Button>
              <Button className={s.actionButton} title="Read aloud" aria-label="Read aloud" onClick={() => speak(message.text)}>
                <Volume2 size={14} />
              </Button>
            </div>}
          </>
        )}
      </div>
    </div>
  )
}

/** Speech.toggle: the system voice; pressing again stops it. */
function speak(text: string) {
  if (speechSynthesis.speaking) return speechSynthesis.cancel()
  speechSynthesis.speak(new SpeechSynthesisUtterance(text.replaceAll('_', '')))
}

/** What the agent did, one line per step (12.5pt mono). A step naming a file that exists opens it (no cue);
 *  a step with a recorded tool call opens to what it sent and got back. */
function Trace({ trace, calls }: { trace: string[]; calls: ToolCall[] }) {
  const found = useFound([...new Set(trace.map(traceTarget).filter((p): p is string => !!p))])
  const [shown, setShown] = useState<number | null>(null)
  return (
    <ul className={s.trace}>
      {trace.map((step, i) => {
        const path = traceTarget(step)
        const call = calls.find((c) => c.step === i)
        const toggle = () => setShown(shown === i ? null : i)
        return (
          <li key={i}>
            <div className={s.traceRow}>
              {call ? (
                <Button cue={null} className={`${s.traceToggle} ${shown === i ? s.traceOpen : ''}`} aria-expanded={shown === i}
                  aria-label={shown === i ? 'Hide details' : 'Show details'} onClick={toggle}>
                  <ChevronRight size={10} strokeWidth={3} />
                </Button>
              ) : <ChevronRight size={10} strokeWidth={3} />}
              {path && found.has(path) ? (
                <Button cue={null} className={s.traceLink} title={`Open ${path}`} onClick={() => open(path)}>{step}</Button>
              ) : call ? (
                <Button cue={null} className={`${s.traceLink} ${s.traceCall}`} title={call.tool} onClick={toggle}>{step}</Button>
              ) : <span>{step}</span>}
            </div>
            {call && shown === i && <CallDetail call={call} />}
          </li>
        )
      })}
    </ul>
  )
}

/** A tool call opened from the trace: its full name, what it was given, and what came back. */
function CallDetail({ call }: { call: ToolCall }) {
  return (
    <div className={s.callDetail}>
      <span className={s.callTool}>{call.tool}</span>
      <span className={s.callLabel}>Input</span>
      <pre>{call.input}</pre>
      <span className={`${s.callLabel} ${call.error ? s.callError : ''}`}>{call.error ? 'Error' : 'Result'}</span>
      <pre>{call.result ?? (call.result === undefined ? 'Waiting…' : '')}</pre>
    </div>
  )
}

/** The worker stack and the shimmering status label. A new label rises in
 *  from 8 px below while the old one leaves upward, quicker. */
function WorkingRow({ status, workers }: { status: string; workers: string[] }) {
  return (
    <div className={s.working}>
      {workers.length > 0 && (
        <span className={s.workers} style={{ width: 24 + (workers.length - 1) * 16 }}>
          {workers.map((w, i) => (
            <span key={w} style={{ left: 4 + i * 16 }}><Avatar name="" seed={w} size={16} lettered={false} /></span>
          ))}
        </span>
      )}
      <Swap k={status} variant="rise" className={s.status}><ShimmerText>{status}</ShimmerText></Swap>
    </div>
  )
}

/** AttachmentChip: images as a square thumbnail, anything else as a card with its first page (Quick Look,
 *  through the native helper) over its Finder icon and name. With `remove`, ✕ on hover. */
export function AttachmentChip({ path, remove }: { path: string; remove?: () => void }) {
  const image = isImage(path)
  const [thumb, setThumb] = useState<string | null>(null)
  const [icon, setIcon] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setThumb(null)
    // Without the helper (null), images still load themselves.
    window.bridle.native.thumbnail(path, 200).catch(() => null)
      .then((t) => t ?? (image ? window.bridle.workspace.readFile(path, 'base64').then((b64) => `data:${mime(path)};base64,${b64}`) : null))
      .then((t) => live && setThumb(t), () => {})
    if (!image) window.bridle.viewer.icon(path).then((i) => live && setIcon(i), () => {})
    return () => { live = false }
  }, [path, image])

  return (
    <span className={`${s.chip} ${image ? s.chipImage : ''}`} title={basename(path)}>
      {image ? (
        <span className={s.preview}>{thumb && <img src={thumb} alt="" />}</span>
      ) : (
        <>
          <span className={s.preview}>{thumb ? <img src={thumb} alt="" /> : <FileText size={34} strokeWidth={1.2} />}</span>
          <span className={s.chipName}>{icon ? <img src={icon} alt="" /> : <FileText size={14} />}<span>{basename(path)}</span></span>
        </>
      )}
      {remove && (
        <Button cue={null} className={s.chipRemove} aria-label={`Remove ${basename(path)}`} title="Remove" onClick={(e) => {
          e.stopPropagation()
          play('close', { emphasis: 'subtle' })
          remove()
        }}>
          <X size={10} strokeWidth={3} />
        </Button>
      )}
    </span>
  )
}

function mime(path: string): string {
  const ext = path.split('.').pop()!.toLowerCase()
  return ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
}
