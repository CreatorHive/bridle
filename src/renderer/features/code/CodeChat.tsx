import { useEffect, useRef, useState, type DragEvent } from 'react'
import {
  ArrowUp, Check, ChevronRight, Circle, CircleCheck, CircleDot, CircleX, ClipboardList, Clock, Copy, Diff, FileText, Files,
  Globe, ListChecks, MoreHorizontal, Pencil, Plus, Search, ShieldCheck, Square, Terminal, Users, Wrench, X
} from 'lucide-react'
import type { Chat, CodeAgentState, DiffHunk, Message, Subagent, Workspace } from '../../../shared/types'
import { Avatar, Button, Markdown, Menu, Pill, ShimmerText, StreamingMarkdown, Swap } from '../../components'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import { AgentAvatar } from '../chat/Transcript'
import { Counts, DiffView } from './DiffView'
import { elapsed, glyphs, glyph, meta, planBlocks, ruleCommand, summary, totals, workingLabel, type Glyph } from './logic'
import { ModelPicker } from './ModelPicker'
import { closeTab, openTab, refreshChanges, sameTab, setBench, setPref, useCode, type Bench, type Tab } from './store'
import s from './code.module.css'

const GLYPHS: Record<Glyph, typeof FileText> = { read: FileText, edit: Pencil, bash: Terminal, search: Search, web: Globe, agent: Users, todo: ListChecks, tool: Wrench }
const base = (p: string) => p.split('/').pop() ?? p

/** A tab per chat (plus the diff, file and review tabs you open), the transcript, and the composer. */
export function CodeChat({ w, bench }: { w: Workspace; bench: Bench }) {
  const code = useCode()
  const chats = code.chats[w.id] ?? []
  const agent = code.agents[w.id]
  const chat = chats.find((c) => c.id === bench.chatId)

  // A plan waiting for you brings its chat forward.
  useEffect(() => {
    if (agent?.planWaiting && agent.runningChat) openTab(w.id, { kind: 'chat' }, agent.runningChat)
  }, [agent?.planWaiting, agent?.runningChat, w.id])

  const t = bench.tab
  return (
    <div className={s.center}>
      <TabStrip w={w} bench={bench} chats={chats} />
      {t.kind === 'chat' && (
        <>
          {chat ? <Transcript w={w} bench={bench} chat={chat} agent={agent} /> : <Welcome w={w} />}
          <Composer w={w} bench={bench} agent={agent} />
        </>
      )}
      {t.kind === 'diff' && <DiffTab w={w} path={t.path} />}
      {t.kind === 'file' && <FileTab path={t.path} />}
      {t.kind === 'review' && <ReviewTab w={w} />}
    </div>
  )
}

// MARK: Tabs

function TabStrip({ w, bench, chats }: { w: Workspace; bench: Bench; chats: Chat[] }) {
  const onChat = bench.tab.kind === 'chat'
  const chatOpen = chats.some((c) => c.id === bench.chatId)
  const title = (t: Tab) => (t.kind === 'review' ? 'Review' : t.kind === 'chat' ? '' : base(t.path))
  const icon = (t: Tab) => (t.kind === 'diff' ? <Diff size={12} /> : t.kind === 'review' ? <ListChecks size={12} /> : <FileText size={12} />)
  return (
    <div className={s.tabs}>
      {/* Oldest on the left, so a new chat lands beside "+". */}
      {[...chats].reverse().map((c) => (
        <Button key={c.id} cue="select" className={`${s.tab} ${onChat && bench.chatId === c.id ? s.on : ''}`} title={c.title}
          onClick={() => openTab(w.id, { kind: 'chat' }, c.id)}>
          {c.messages[c.messages.length - 1]?.status != null && <span className={s.spin} />}
          <span>{c.title || 'Untitled'}</span>
        </Button>
      ))}
      {!chatOpen && <Button cue="select" className={`${s.tab} ${onChat ? s.on : ''}`} onClick={() => openTab(w.id, { kind: 'chat' }, null)}><span>New chat</span></Button>}
      <Button className={s.iconButton} title="New chat" aria-label="New chat" onClick={() => openTab(w.id, { kind: 'chat' }, null)}><Plus size={14} /></Button>
      {bench.tabs.length > 0 && <span className={s.tabDivider} />}
      {bench.tabs.map((t) => {
        const on = sameTab(bench.tab, t)
        return (
          <Button key={t.kind + title(t) + ('path' in t ? t.path : '')} cue="select" className={`${s.tab} ${s.closable} ${on ? s.on : ''}`}
            title={'path' in t ? t.path : title(t)} onClick={() => openTab(w.id, t)}>
            {icon(t)}
            <span>{title(t)}</span>
            <span className={s.close} role="button" aria-label="Close tab" title="Close tab" onClick={(e) => {
              e.stopPropagation()
              play('close', { emphasis: 'subtle' })
              closeTab(w.id, t)
            }}><X size={9} strokeWidth={3} /></span>
          </Button>
        )
      })}
    </div>
  )
}

// MARK: Transcript

function Welcome({ w }: { w: Workspace }) {
  const name = useApp().state.settings?.agentName || 'Bridle'
  return (
    <div className={s.welcome}>
      <AgentAvatar name={name} size={36} />
      <h3>What should we do in {w.title === 'New workspace' ? 'this workspace' : w.title}?</h3>
      <p>The agent works on its own branch, {w.branch}, so your checkout stays as it is. Turn on Plan to agree on the approach first.</p>
    </div>
  )
}

function Transcript({ w, bench, chat, agent }: { w: Workspace; bench: Bench; chat: Chat; agent?: CodeAgentState }) {
  const first = chat.messages.find((m) => m.role === 'assistant')?.id
  const notes = bench.draft.trim()
  return (
    <div className={s.scroll}>
      <div className={s.transcript}>
        {chat.messages.map((m) => {
          if (m.role === 'user') return <UserBubble key={m.id} w={w} message={m} />
          if (m.role === 'tool') return m.dismissed ? null : <PermissionCard key={m.id} w={w} message={m} pending={!!agent?.pending.includes(m.id)} />
          const waiting = agent?.planWaiting === m.id
          return (
            <CodeReply key={m.id} w={w} message={m} first={m.id === first} planWaiting={waiting}
              approve={() => void window.bridle.code.answerPlan(w.id, true)}
              revise={notes ? () => {
                void window.bridle.code.answerPlan(w.id, false, notes)
                setBench(w.id, { draft: '' })
              } : null} />
          )
        })}
      </div>
    </div>
  )
}

/** Your message, Conductor style: a compact gray block on the right, attachments as small pills inside it. */
function UserBubble({ w, message }: { w: Workspace; message: Message }) {
  return (
    <div className={s.user}>
      <div className={s.bubble}>
        {!!message.files?.length && (
          <div className={s.chips} style={{ marginBottom: 8 }}>
            {message.files.map((f) => (
              <Button key={f} cue="open" className={s.chip} title={base(f)} onClick={() => openTab(w.id, { kind: 'file', path: f })}>
                <FileText size={12} /><span>{base(f)}</span>
              </Button>
            ))}
          </div>
        )}
        {message.text}
      </div>
    </div>
  )
}

/** CodeReply: folded tool activity, the text, a plan to approve, the checklist, what it changed, then time and copy. */
function CodeReply({ w, message: m, first, planWaiting, approve, revise }: {
  w: Workspace; message: Message; first: boolean; planWaiting: boolean; approve: () => void; revise: (() => void) | null
}) {
  const name = useApp().state.settings?.agentName || 'Bridle'
  const [copied, setCopied] = useState(false)
  const trace = m.trace ?? []
  const subagents = m.subagents ?? []
  const changes = m.changes ?? []
  const copy = () => {
    void navigator.clipboard.writeText(m.text)
    play('success', { emphasis: 'subtle' })
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className={s.reply}>
      {first && <div className={s.replyHead}><AgentAvatar name={name} size={20} thinking={m.status != null} />{name}</div>}
      {(trace.length > 0 || subagents.length > 0) && <Activity trace={trace} subagents={subagents} />}
      {m.text && <div className={s.replyText}>{m.status != null || !m.ended ? <StreamingMarkdown text={m.text} /> : <Markdown text={m.text} />}</div>}
      {m.plan != null && <PlanCard text={m.plan} waiting={planWaiting} approve={approve} revise={revise} />}
      {!!m.todos?.length && <Checklist todos={m.todos} />}
      {changes.length > 0 && (
        <Button cue="navigate" className={s.cardButton} title={changes.map((c) => c.path).join('\n')} onClick={() => openTab(w.id, { kind: 'review' })}>
          <Files size={13} />
          <strong>{changes.length} file{changes.length === 1 ? '' : 's'} changed</strong>
          <Counts {...totals(changes)} />
          <ChevronRight size={12} strokeWidth={2.5} />
        </Button>
      )}
      {m.status != null ? (
        <WorkingLine status={m.status} running={subagents.filter((x) => x.state === 'running')} avatar={!first} name={name} />
      ) : m.text ? (
        <div className={s.footer}>
          <span className={s.meta}>{meta(m.date, m.ended)}</span>
          <Button cue={null} className={s.iconButton} title="Copy" aria-label="Copy" onClick={copy}>
            <Swap k={copied ? 'y' : 'n'}>{copied ? <Check size={14} /> : <Copy size={14} />}</Swap>
          </Button>
          <Menu label="More" trigger={<span className={s.iconButton}><MoreHorizontal size={14} /></span>} items={[
            { label: 'Copy', icon: <Copy size={13} />, onSelect: copy },
            ...(changes.length ? [{ label: 'Review changes', icon: <ListChecks size={13} />, onSelect: () => openTab(w.id, { kind: 'review' }) }] : [])
          ]} />
        </div>
      ) : null}
    </div>
  )
}

/** "▸ 9 tool calls, 2 subagents  📄 ✎ ⌘", opening to the trace lines and subagent rows. */
function Activity({ trace, subagents }: { trace: string[]; subagents: Subagent[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={s.activity}>
      <Button cue={null} className={`${s.activityToggle} ${open ? s.open : ''}`} onClick={() => {
        play(open ? 'close' : 'open')
        setOpen(!open)
      }}>
        <ChevronRight size={10} strokeWidth={3} />
        {summary(trace.length, subagents.length)}
        <span className={s.glyphs}>{glyphs(trace).map((g) => { const I = GLYPHS[g]; return <I key={g} size={11} /> })}</span>
      </Button>
      {open && (
        <>
          <Steps lines={trace} withGlyphs />
          {subagents.length > 0 && (
            <div className={s.subagents}>{subagents.map((x) => <SubagentRow key={x.id} sub={x} />)}</div>
          )}
        </>
      )}
    </div>
  )
}

function Steps({ lines, withGlyphs = false }: { lines: string[]; withGlyphs?: boolean }) {
  return (
    <ul className={s.steps}>
      {lines.map((step, i) => {
        const I = withGlyphs ? GLYPHS[glyph(step)] : ChevronRight
        return <li key={i}><I size={withGlyphs ? 11 : 8} /><span title={step}>{step}</span></li>
      })}
    </ul>
  )
}

/** A subagent: avatar, name and task, then a timer (or what it's doing), ✓ when done; opens to its own steps. */
function SubagentRow({ sub }: { sub: Subagent }) {
  const [expanded, setExpanded] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => {
    if (sub.state !== 'running') return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [sub.state])
  return (
    <div className={s.subagent}>
      <Button cue={null} className={s.subRow} disabled={!sub.trace.length} onClick={() => {
        play(expanded ? 'close' : 'open')
        setExpanded(!expanded)
      }}>
        <Avatar name={sub.name} seed={sub.id} size={22} />
        <span className={s.subText}><strong>{sub.name}</strong><span>{sub.description}</span></span>
        <span className={s.subStatus}>
          {sub.state === 'running' && <><span className={s.spin} /><span>{sub.activity ? sub.activity + '…' : elapsed(sub.startedAt)}</span></>}
          {sub.state === 'done' && <><Check size={12} />{elapsed(sub.startedAt, sub.endedAt ?? new Date())}</>}
          {sub.state === 'failed' && <><X size={12} />Stopped</>}
        </span>
      </Button>
      {expanded && <div className={s.subSteps}><Steps lines={sub.trace} /></div>}
    </div>
  )
}

/** The working row: running subagents stacked (or the agent), then what's happening, shimmering. */
function WorkingLine({ status, running, avatar, name }: { status: string; running: Subagent[]; avatar: boolean; name: string }) {
  const label = workingLabel(status, running)
  return (
    <div className={s.working}>
      {running.length > 0 ? (
        <span className={s.stack}>{running.slice(0, 4).map((x) => <Avatar key={x.id} name={x.name} seed={x.id} size={20} />)}</span>
      ) : avatar ? <AgentAvatar name={name} size={20} thinking /> : null}
      <Swap k={label} variant="rise"><ShimmerText>{label}</ShimmerText></Swap>
    </div>
  )
}

/** ✓ circles: done, doing (half), to do (empty). */
function Checklist({ todos }: { todos: NonNullable<Message['todos']> }) {
  return (
    <div className={s.checklist}>
      {todos.map((t, i) => (
        <div key={i} className={`${s.todo} ${t.status === 'pending' ? s.pending : ''}`}>
          <Swap k={t.status}>{t.status === 'completed' ? <CircleCheck size={14} /> : t.status === 'in_progress' ? <CircleDot size={14} /> : <Circle size={14} />}</Swap>
          <span>{t.title}</span>
        </div>
      ))}
    </div>
  )
}

/** The plan inline in its reply; while it waits, Approve builds it and Revise sends the composer's notes. */
function PlanCard({ text, waiting, approve, revise }: { text: string; waiting: boolean; approve: () => void; revise: (() => void) | null }) {
  return (
    <div className={s.plan}>
      <div className={s.planDoc}>
        {planBlocks(text).map((b, i) =>
          b.kind === 'heading' ? <h4 key={i} className={b.level === 1 ? s.h1 : ''}>{b.text}</h4>
            : b.kind === 'code' ? <pre key={i}>{b.text}</pre>
              : <Markdown key={i} text={b.text} />)}
      </div>
      {waiting && (
        <div className={s.planBar}>
          <span>{revise ? 'Revise sends your notes; it plans again.' : 'Approve to build it, or write what to change below.'}</span>
          <Pill cue="tap" disabled={!revise} onClick={() => revise?.()}>Revise</Pill>
          <Pill cue="success" filled onClick={approve}>Approve</Pill>
        </div>
      )}
    </div>
  )
}

// MARK: Permission card (for a Code turn, plus "Always allow")

function PermissionCard({ w, message: m, pending }: { w: Workspace; message: Message; pending: boolean }) {
  const f = m.action?.fields ?? {}
  const [folding, setFolding] = useState(false)
  let input: Record<string, unknown> = {}
  try { input = f.input ? JSON.parse(f.input) : {} } catch { /* cards saved before inputs were kept */ }
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const answer = (allow: boolean, always = false) => {
    if (allow) {
      play('success')
      setTimeout(() => {
        play('close', { emphasis: 'subtle' })
        setFolding(true)
      }, 700)
    } else play('close', { emphasis: 'strong' })
    void window.bridle.code.respond(w.id, m.id, allow, always)
  }
  const shortPath = (p: string) => (p.startsWith(w.path + '/') ? p.slice(w.path.length + 1) : p)
  const expired = m.approved == null && !pending
  return (
    <div className={`${s.permission} ${folding ? s.folding : ''}`}>
      <div className={s.permCard}>
        <span className={s.permIcon}>{f.tool === 'Bash' ? <Terminal size={16} /> : <ShieldCheck size={16} />}</span>
        <div className={s.permMain}>
          <h4>{f.title ?? 'Allow this?'}</h4>
          {f.tool === 'Bash' ? (
            <>
              {str('description') && <div className={s.permNote}>{str('description')}</div>}
              <pre className={s.permDetail}><span className={s.dollar}>$</span>{str('command') || m.text}</pre>
            </>
          ) : f.tool === 'Edit' || f.tool === 'Write' || f.tool === 'MultiEdit' ? (
            <>
              <div className={s.permNote}><FileText size={12} /> {shortPath(str('file_path') || m.text)}</div>
              {(str('new_string') || str('content')) && (
                <div className={s.diff}><div className={s.diffBody}>
                  {(str('old_string') ? str('old_string').split('\n').slice(0, 24) : []).map((l, i) => (
                    <div key={'o' + i} className={`${s.line} ${s.del}`}><span /><span /><span>−</span><span>{l || ' '}</span></div>
                  ))}
                  {(str('new_string') || str('content')).split('\n').slice(0, 24).map((l, i) => (
                    <div key={'n' + i} className={`${s.line} ${s.add}`}><span /><span /><span>+</span><span>{l || ' '}</span></div>
                  ))}
                </div></div>
              )}
            </>
          ) : <pre className={s.permDetail}>{m.text}</pre>}
          <div className={s.permButtons}>
            {m.approved === true ? <span className={s.permDone}><CircleCheck size={15} />Allowed</span>
              : m.approved === false ? <span className={s.permDenied}><CircleX size={15} />Denied</span>
                : expired ? <span className={s.permDenied}><Clock size={15} />Expired</span>
                  : (
                    <>
                      <Pill cue={null} onClick={() => answer(false)}>Deny</Pill>
                      <Pill cue={null} filled onClick={() => answer(true)}>Allow</Pill>
                    </>
                  )}
          </div>
        </div>
      </div>
      {m.approved == null && pending && f.rule && (
        <Pill cue={null} title={`Run ${f.rule} without asking in this repo`} onClick={() => answer(true, true)}>
          Always allow {ruleCommand(f.rule)}
        </Pill>
      )}
    </div>
  )
}

// MARK: Composer

/** CodeComposer: the draft, then model, Plan, attach and send / stop. Return sends, ⇧Return is a new line; dropped files attach. */
function Composer({ w, bench, agent }: { w: Workspace; bench: Bench; agent?: CodeAgentState }) {
  const { prefs } = useCode()
  const plan = prefs.codePlanMode
  const input = useRef<HTMLTextAreaElement>(null)
  const [dropping, setDropping] = useState(false)
  const working = !!agent?.running && !agent.planWaiting
  const empty = !bench.draft.trim() && !bench.attachments.length
  useEffect(() => input.current?.focus(), [w.id])

  const submit = async () => {
    if (empty || working) return play('error', { emphasis: 'subtle' })
    const text = bench.attachments.length ? `${bench.draft}\n\nAttached: ${bench.attachments.join(', ')}` : bench.draft
    setBench(w.id, { draft: '', attachments: [] })
    play('tap')
    if (agent?.planWaiting) return void window.bridle.code.answerPlan(w.id, false, text) // writing while a plan waits = Revise
    try {
      const chatId = await window.bridle.code.send(w.id, bench.chatId, text, plan ? 'plan' : 'build')
      openTab(w.id, { kind: 'chat' }, chatId)
    } catch (e) {
      play('error')
      setBench(w.id, { draft: text })
      window.alert(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, ''))
    }
  }

  const attach = async () => {
    const picked = (await window.bridle.workspace.pickFiles({ prompt: 'Attach', multiple: true }).catch(() => [] as string[]))
      .filter((p) => !bench.attachments.includes(p))
    if (!picked.length) return
    play('select')
    setBench(w.id, (b) => ({ attachments: [...b.attachments, ...picked] }))
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDropping(false)
    const paths = [...e.dataTransfer.files].map((f) => window.bridle.pathForFile(f)).filter((p) => p && !bench.attachments.includes(p))
    if (!paths.length) return
    play('select')
    setBench(w.id, (b) => ({ attachments: [...b.attachments, ...paths] }))
  }

  return (
    <div className={s.composerWrap}>
      <div className={`${s.composer} ${dropping ? s.dropping : ''}`} onClick={() => input.current?.focus()}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }}
        onDragLeave={() => setDropping(false)} onDrop={onDrop}>
        {bench.attachments.length > 0 && (
          <div className={s.chips}>
            {bench.attachments.map((p) => (
              <span key={p} className={s.chip} title={p}>
                <FileText size={12} /><span>{base(p)}</span>
                <Button cue={null} className={s.close} style={{ opacity: 1 }} aria-label={`Remove ${base(p)}`} onClick={(e) => {
                  e.stopPropagation()
                  play('close', { emphasis: 'subtle' })
                  setBench(w.id, (b) => ({ attachments: b.attachments.filter((a) => a !== p) }))
                }}><X size={9} strokeWidth={3} /></Button>
              </span>
            ))}
          </div>
        )}
        <textarea ref={input} rows={2} value={bench.draft} onChange={(e) => setBench(w.id, { draft: e.target.value })}
          placeholder={agent?.planWaiting ? 'Write what to change in the plan…' : 'Ask to make changes, @mention files, run /commands'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }} />
        <div className={s.composerRow}>
          <ModelPicker />
          <Button cue={null} className={`${s.planToggle} ${plan ? s.on : ''}`}
            title={plan ? 'Plan first: it proposes, you approve, then it builds' : 'Builds right away; turn on Plan to agree on a plan first'}
            onClick={() => {
              play('toggle', { direction: plan ? -1 : 1 })
              setPref('codePlanMode', !plan)
            }}>
            <ClipboardList size={12} />Plan
          </Button>
          <span className={s.spacer} />
          <Button className={s.iconButton} title="Attach files" aria-label="Attach files" onClick={() => void attach()}><Plus size={15} /></Button>
          <Button cue={null} className={`${s.send} ${empty && !working ? s.idle : ''}`} title={working ? 'Stop' : 'Send ↩ · New line ⇧↩'} aria-label={working ? 'Stop' : 'Send'}
            onClick={() => {
              if (!working) return void submit()
              play('close')
              void window.bridle.code.stop(w.id)
            }}>
            <Swap k={working ? 'stop' : 'send'}>{working ? <Square size={10} fill="currentColor" /> : <ArrowUp size={14} strokeWidth={2.6} />}</Swap>
          </Button>
        </div>
      </div>
    </div>
  )
}

// MARK: Diff, file and review tabs

function useDiff(w: Workspace, path: string, reload: unknown): DiffHunk[] | null {
  const [hunks, setHunks] = useState<DiffHunk[] | null>(null)
  useEffect(() => {
    let live = true
    void window.bridle.code.diff(w.id, path).then((h) => live && setHunks(h), () => live && setHunks([]))
    return () => { live = false }
  }, [w.id, path, reload])
  return hunks
}

function DiffTab({ w, path }: { w: Workspace; path: string }) {
  const [reload, setReload] = useState(0)
  const hunks = useDiff(w, path, reload)
  return (
    <div className={s.page}>
      <DiffView path={path} hunks={hunks} onRevert={() => {
        play('tap')
        void window.bridle.code.revert(w.id, path).then(() => {
          void refreshChanges(w.id)
          setReload((n) => n + 1)
        })
      }} />
    </div>
  )
}

/** A file, read-only: its text in monospace, or Open for anything else. ponytail: cut at 200k characters. */
function FileTab({ path }: { path: string }) {
  const [text, setText] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    setText(undefined)
    void window.bridle.workspace.readFile(path).then((t) => live && setText(t.includes('\0') ? null : t.slice(0, 200_000)), () => live && setText(null))
    return () => { live = false }
  }, [path])
  if (text === undefined) return <div className={s.page} />
  if (text === null) {
    return (
      <div className={s.empty}>
        <FileText size={22} />
        <h2>{base(path)}</h2>
        <Pill cue="open" onClick={() => void window.bridle.workspace.openPath(path)}>Open</Pill>
      </div>
    )
  }
  return <div className={s.page} style={{ padding: 0 }}><pre className={s.fileText}>{text}</pre></div>
}

/** Every changed file's diff, stacked, each with Revert; Revert all asks first. */
function ReviewTab({ w }: { w: Workspace }) {
  const files = useCode().changes[w.id] ?? []
  const [diffs, setDiffs] = useState<Record<string, DiffHunk[]>>({})
  const key = files.map((f) => `${f.path}:${f.added}:${f.removed}`).join('|')
  useEffect(() => {
    let live = true
    void (async () => {
      for (const f of files) {
        const h = await window.bridle.code.diff(w.id, f.path).catch(() => [])
        if (!live) return
        setDiffs((d) => ({ ...d, [f.path]: h }))
      }
    })()
    return () => { live = false }
  }, [key, w.id])

  const revert = async (paths: string[]) => {
    for (const p of paths) await window.bridle.code.revert(w.id, p)
    await refreshChanges(w.id)
    play('success', { emphasis: 'subtle' })
  }

  if (!files.length) {
    return (
      <div className={s.empty}>
        <CircleCheck size={20} />
        <h2>No changes</h2>
        <p>Files changed on {w.branch} since {w.base} show here.</p>
      </div>
    )
  }
  return (
    <div className={s.page}>
      <div className={s.review}>
        <div className={s.reviewHead}>
          <strong>{files.length} file{files.length === 1 ? '' : 's'} changed</strong>
          <Counts {...totals(files)} />
          <span className={s.spacer} />
          <Pill cue="attention" onClick={() => {
            if (window.confirm(`Revert all ${files.length} files?\n\nEvery change in this workspace goes back to ${w.base}. This can't be undone.`)) void revert(files.map((f) => f.path))
          }}>Revert all</Pill>
        </div>
        {files.map((f) => <DiffView key={f.path} path={f.path} hunks={diffs[f.path] ?? null} onRevert={() => void revert([f.path])} />)}
      </div>
    </div>
  )
}
