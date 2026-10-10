import { useEffect, useState } from 'react'
import { ArrowUpRight, CalendarPlus, ChevronsUpDown, CircleCheck, CircleX, Clock, FileText, Globe, ListChecks, Search, ShieldCheck, Terminal } from 'lucide-react'
import type { Message } from '../../../shared/types'
import { Button, Menu, MOTION, Pill } from '../../components'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import { logos } from '../../theme'
import { absolutePath, cardInfo, cleanError, gmailLogins, leaves, relativePath, trimDiff } from './logic'
import { deniedNow, editMessage, pendingPermissions, saveChat, workspaceRoot } from './session'
import { viewer } from '../viewer'
import s from './chat.module.css'

/** The agent waits until you decide. Email, event, task and permission cards. */
export function ToolCard({ chatId, message, fresh = false }: { chatId: string; message: Message; fresh?: boolean }) {
  const { state } = useApp()
  const gmails = gmailLogins(state.accounts)
  const card = cardInfo(message, gmails)
  const { action, isPermission, isEmail, isEvent, isTask } = card
  const [running, setRunning] = useState(false)
  const [folding, setFolding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (patch: Partial<Message>) => {
    editMessage(chatId, message.id, (m) => ({ ...m, ...patch }))
    saveChat(chatId)
  }
  const answer = (allow: boolean) => {
    const request = pendingPermissions.get(message.id)
    pendingPermissions.delete(message.id)
    if (request) window.bridle.agent.respondPermission(request, allow).catch((e) => console.warn('respondPermission:', cleanError(e)))
  }

  /** Shows the outcome for a beat, then folds the card away; the trace keeps the record. */
  const foldAway = (after: number) => {
    setTimeout(() => {
      play('close', { emphasis: 'subtle' })
      setFolding(true)
    }, after)
    setTimeout(() => set({ dismissed: true }), after + MOTION.fold.duration)
  }

  const deny = () => {
    play('close', { emphasis: 'strong' })
    if (isPermission) answer(false)
    deniedNow.add(message.id)
    set({ approved: false })
    foldAway(900) // "Denied" stays just under a second, like Comma, then the card leaves
  }

  /** Your press is the approval; only then does the action run. */
  const approve = async () => {
    if (isPermission) {
      play('success')
      answer(true)
      set({ approved: true })
      foldAway(700)
      return
    }
    if (!action) {
      play('success')
      return set({ approved: true })
    }
    setRunning(true)
    setError(null)
    // Send from the account shown.
    const pending = isEmail && card.sender ? { ...action, fields: { ...action.fields, from: card.sender } } : action
    try {
      await window.bridle.agent.perform(pending)
      play('success')
      set({ approved: true })
    } catch (e) {
      play('error')
      setError(cleanError(e))
    }
    setRunning(false)
  }

  const expired = message.approved == null && isPermission && !pendingPermissions.has(message.id)
  const icon = isEmail ? <img src={logos.google} alt="" width={22} height={22} />
    : isPermission ? (action?.fields.tool === 'Bash' ? <Terminal size={19} /> : <ShieldCheck size={19} />)
      : isEvent ? <CalendarPlus size={19} /> : isTask ? <ListChecks size={19} /> : <ShieldCheck size={19} />

  return (
    // Arrives with replyEntry; an allowed request folds away (fade, slight shrink from the top, its space closing).
    <div className={`${s.toolCard} ${isPermission ? '' : s.divided} ${fresh ? 'b-reply-entry' : ''} ${folding ? s.folding : ''}`}>
      <div className={s.cardBox}>
        <span className={s.cardIcon}>{icon}</span>
        <div className={s.cardMain}>
          <div className={s.cardTitle}>{card.title}</div>
          {card.rows.length > 0 && (
            <div className={s.rows}>
              {isEmail && (
                <div className={s.rowLine}>
                  <span className={s.rowLabel}>From</span>
                  {card.sender ? (
                    gmails.length > 1 && message.approved == null ? (
                      <Menu
                        label="Send from"
                        trigger={<span className={s.from}><img src={logos.google} alt="" />{card.sender}<ChevronsUpDown size={10} /></span>}
                        items={gmails.map((g) => ({
                          label: g, checked: g === card.sender,
                          onSelect: () => set({ action: { ...action!, fields: { ...action!.fields, from: g } } })
                        }))}
                      />
                    ) : <span className={s.from}><img src={logos.google} alt="" />{card.sender}</span>
                  ) : <span className={s.warn}>No Gmail connected — add one in Settings → Connections</span>}
                </div>
              )}
              {card.rows.map(([label, value]) => (
                <div key={label} className={s.rowLine}>
                  <span className={s.rowLabel}>{label}</span>
                  <span className={s.selectable}>{value}</span>
                </div>
              ))}
            </div>
          )}
          {isPermission ? (
            <PermissionDetail tool={action?.fields.tool ?? ''} inputJSON={action?.fields.input} fallback={message.text} />
          ) : (
            <div className={s.cardText}>{isEvent || isTask ? action?.fields.notes ?? '' : message.text}</div>
          )}
          <div className={s.cardButtons}>
            {error && <span className={s.cardError}>{error}</span>}
            {message.approved === true ? (
              <span className={s.done}><CircleCheck size={16} />{card.done}</span>
            ) : message.approved === false ? (
              <span className={s.denied}><CircleX size={16} />Denied</span>
            ) : expired ? (
              // From an earlier run: the agent isn't waiting any more.
              <span className={s.denied}><Clock size={16} />Expired</span>
            ) : (
              <>
                <Pill cue={null} className={s.bigPill} disabled={running} onClick={deny}>Deny</Pill>
                <Pill cue={null} filled className={s.bigPill} disabled={running || (isEmail && !card.sender)} onClick={() => void approve()}>
                  {running ? '…' : card.confirm}
                </Pill>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Exactly what will run, laid out for the tool. */
function PermissionDetail({ tool, inputJSON, fallback }: { tool: string; inputJSON?: string; fallback: string }) {
  let input: Record<string, unknown> = {}
  try { input = inputJSON ? JSON.parse(inputJSON) : {} } catch { /* cards saved before inputs were kept */ }
  const str = (key: string) => (typeof input[key] === 'string' && input[key] ? (input[key] as string) : undefined)

  switch (tool) {
    case 'Bash':
      return (
        <div className={s.command}>
          {str('description') && <div className={s.note}>{str('description')}</div>}
          <pre><span>$</span>{str('command') ?? fallback}</pre>
        </div>
      )
    case 'Write':
      return (
        <div className={s.stack}>
          <FileLine path={str('file_path') ?? fallback} badge="New file" />
          {str('content') && <DiffLines added={str('content')!} />}
        </div>
      )
    case 'Edit':
      return (
        <div className={s.stack}>
          <FileLine path={str('file_path') ?? fallback} badge={input.replace_all === true ? 'Every match' : undefined} />
          <DiffLines removed={str('old_string')} added={str('new_string') ?? ''} />
        </div>
      )
    case 'MultiEdit':
    case 'NotebookEdit': {
      const n = Array.isArray(input.edits) ? input.edits.length : undefined
      return <FileLine path={str('file_path') ?? str('notebook_path') ?? fallback} badge={n === undefined ? undefined : n === 1 ? '1 change' : `${n} changes`} />
    }
    case 'WebFetch':
      return <LinkLine url={str('url') ?? fallback} />
    case 'WebSearch':
      return <div className={s.search}><Search size={14} />{str('query') ?? fallback}</div>
    default:
      if (tool.startsWith('mcp__composio__')) {
        return (
          <div className={s.rows}>
            {leaves(input).filter((p) => p.key !== 'tool_slug').slice(0, 12).map((p, i) => (
              <div key={i} className={s.rowLine}>
                <span className={s.argKey}>{p.key.replaceAll('_', ' ')}</span>
                <span className={`${s.selectable} ${s.clamp}`}>{p.value}</span>
              </div>
            ))}
          </div>
        )
      }
      return <div className={s.mono}>{fallback}</div>
  }
}

/** FileLine: the file a change touches (its Finder icon), workspace-relative, opening it on click when it exists. */
function FileLine({ path, badge }: { path: string; badge?: string }) {
  const [ws, setWs] = useState('')
  const [icon, setIcon] = useState<string | null>(null) // set only when the file exists
  const full = absolutePath(path, ws)
  useEffect(() => void workspaceRoot().then(setWs), [])
  useEffect(() => {
    if (!ws) return
    let live = true
    window.bridle.viewer.inspect(full).then(() => window.bridle.viewer.icon(full)).then((i) => live && setIcon(i), () => {})
    return () => { live = false }
  }, [full, ws])
  return (
    <div className={s.fileLine}>
      {icon ? <img src={icon} alt="" width={16} height={16} /> : <FileText size={15} />}
      <Button cue={null} className={`${s.filePath} ${icon ? '' : s.missing}`} disabled={!icon}
        title={icon ? `Open ${path.split('/').pop()}` : undefined} onClick={() => viewer.open(full)}>
        {ws ? relativePath(full, ws) : path}
      </Button>
      {badge && <span className={s.badge}>{badge}</span>}
    </div>
  )
}

const CAP = 24

/** DiffLines: removed lines in red, added in green, each capped; unchanged ends trimmed. */
function DiffLines({ removed, added }: { removed?: string; added: string }) {
  const [old, next] = trimDiff(removed?.split('\n') ?? [], added.split('\n'))
  const lines = (all: string[], sign: string, cls: string) => (
    <>
      {all.slice(0, CAP).map((line, i) => (
        <div key={sign + i} className={`${s.diffLine} ${cls}`}><span>{sign}</span><code>{line || ' '}</code></div>
      ))}
      {all.length > CAP && <div className={`${s.diffLine} ${s.more} ${cls}`}>… {all.length - CAP} more lines</div>}
    </>
  )
  return <div className={s.diff}>{lines(old, '−', s.removed)}{lines(next, '+', s.added)}</div>
}

/** LinkLine: the site in bold, the full address under it, openable in your browser. */
function LinkLine({ url }: { url: string }) {
  let host = url
  try { host = new URL(url).host } catch { /* not a URL */ }
  return (
    <div className={s.link}>
      <Globe size={15} />
      <span className={s.linkText}><strong>{host}</strong><span>{url}</span></span>
      <Button className={s.actionButton} title="Open in your browser" aria-label="Open in your browser"
        onClick={() => window.bridle.shell.openExternal(url).catch(() => play('error', { emphasis: 'subtle' }))}>
        <ArrowUpRight size={14} />
      </Button>
    </div>
  )
}
