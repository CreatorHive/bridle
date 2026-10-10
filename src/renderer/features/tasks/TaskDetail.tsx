import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, ChevronDown, ListChecks, MessageSquare, Play, SquareArrowOutUpRight, Trash2, TriangleAlert, X } from 'lucide-react'
import { TASK_STATUSES, type LinearDetail, type TaskItem, type TaskStatus } from '../../../shared/types'
import { Avatar, Button, Markdown, Menu, Shimmer, ShimmerText } from '../../components'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import { logos } from '../../theme'
import { errorText, relative } from './logic'
import { StatusIcon, statusInfo } from './status'
import s from './tasks.module.css'

const longDate = (d: string) => new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
const shortDate = (d: string) => new Date(d).toLocaleDateString('en-US', { dateStyle: 'medium' })

/** A Linear issue's properties, description and comments (fetched live),
 *  or editable title and notes for one of yours. */
export function TaskDetail({ task, hasLinear, leaving = false, onClose, onMove, onUpdate, onDelete, onSendToLinear }: {
  task: TaskItem
  hasLinear: boolean
  /** Closed: sliding out (inert). */
  leaving?: boolean
  onClose: () => void
  onMove: (status: TaskStatus) => void
  onUpdate: (task: TaskItem) => void
  onDelete: () => void
  onSendToLinear: () => void
}) {
  const [detail, setDetail] = useState<LinearDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const { state, go } = useApp()
  const working = !!task.chat && state.working.includes(task.chat)
  const [runError, setRunError] = useState<string | null>(null)
  const runIt = () => {
    save()
    setRunError(null)
    window.bridle.tasks.run(task.id).catch((e) => {
      setRunError(errorText(e))
      play('error')
    })
  }

  useEffect(() => {
    if (!task.linear) return
    let alive = true
    window.bridle.tasks.linearDetail(task.id).then(
      (d) => alive && setDetail(d),
      (e) => alive && setLoadError(errorText(e))
    )
    return () => {
      alive = false
    }
  }, [task.id])

  // Saved on blur and when the panel goes away (onDisappear).
  const latest = useRef({ task, title, notes, onUpdate })
  latest.current = { task, title, notes, onUpdate }
  const save = () => {
    const { task, title, notes, onUpdate } = latest.current
    if (task.linear) return
    const t = title.trim()
    if (!((t && t !== task.title) || notes !== task.notes)) return
    onUpdate({ ...task, title: t || task.title, notes })
  }
  useEffect(() => save, [])

  const iconButton = (label: string, icon: ReactNode, action: () => void) => (
    <Button cue={null} className={s.roundButton} title={label} aria-label={label}
      onClick={() => {
        play(label === 'Close' ? 'close' : 'open')
        action()
      }}>
      {icon}
    </Button>
  )

  const property = (label: string, value: ReactNode) => (
    <div className={s.property}>
      <span>{label}</span>
      {typeof value === 'string' ? <span className={s.value}>{value}</span> : value}
    </div>
  )

  return (
    <aside className={`${s.detail} ${leaving ? s.leaving : ''}`} aria-label="Task" aria-hidden={leaving || undefined}>
      <div className={s.detailHead}>
        {task.linear ? (
          <><img src={logos.linear} alt="" width={14} height={14} /><span>{task.linear.identifier}</span></>
        ) : (
          <><ListChecks size={13} color="var(--tertiary)" /><span>Your task</span></>
        )}
        <span className={s.spacer} />
        {task.linear && iconButton('Open in Linear', <SquareArrowOutUpRight size={13} strokeWidth={2.4} />,
          () => void window.bridle.shell.openExternal(task.linear!.url))}
        {iconButton('Close', <X size={13} strokeWidth={2.6} />, onClose)}
      </div>

      <div className={s.detailScroll}>
        {task.linear ? (
          <h2 className={s.detailTitle}>{task.title}</h2>
        ) : (
          <textarea className={`${s.detailTitle} ${s.titleField}`} rows={1} value={title} placeholder="Title" aria-label="Title"
            ref={(el) => {
              if (el) {
                el.style.height = 'auto'
                el.style.height = `${el.scrollHeight}px`
              }
            }}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                save()
              }
            }} />
        )}

        <div className={s.properties}>
          {property('Status', (
            <Menu label="Status" trigger={
              <span className={s.statusTrigger}>
                <StatusIcon status={task.status} size={13} />
                {task.linear?.state ?? statusInfo(task.status).title}
                <ChevronDown size={11} strokeWidth={2.6} color="var(--tertiary)" />
              </span>
            } items={TASK_STATUSES.map((x) => ({
              label: x.title,
              icon: <StatusIcon status={x.status} size={13} />,
              onSelect: () => onMove(x.status)
            }))} />
          ))}
          {detail?.priority && property('Priority', detail.priority)}
          {detail && property('Assignee', detail.assignee ?? 'Unassigned')}
          {detail?.project && property('Project', detail.project)}
          {detail?.cycle && property('Cycle', detail.cycle)}
          {detail?.due && property('Due', detail.due)}
          {detail && detail.labels.length > 0 && property('Labels', detail.labels.join(', '))}
          {task.linear && property('Team', task.linear.team)}
          {!task.linear && task.tags.length > 0 && property('Tags', task.tags.join(', '))}
          {property('Updated', longDate(task.updated))}
          {detail?.created && property('Created', shortDate(detail.created) + (detail.creator ? ` by ${detail.creator}` : ''))}
        </div>

        {task.linear ? (
          loadError ? (
            <div className={s.loadError}><TriangleAlert size={13} />{loadError}</div>
          ) : detail ? (
            <>
              {detail.description
                ? <Markdown text={detail.description} className={s.description} />
                : <div className={s.muted}>No description</div>}
              {detail.comments.length > 0 && (
                <div className={s.activity}>
                  <div className={s.activityTitle}>Activity</div>
                  {detail.comments.map((c, i) => (
                    <div key={i} className={s.comment}>
                      <Avatar name={c.author} seed={c.author} size={24} />
                      <div>
                        <div className={s.commentHead}><strong>{c.author}</strong><span>{relative(c.date)}</span></div>
                        <Markdown text={c.body} className={s.commentBody} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className={s.placeholder} aria-label="Loading">
              {[0, 1, 2, 3].map((i) => <Shimmer key={i} height={10} width={i === 3 ? 180 : '100%'} style={{ borderRadius: 99 }} />)}
            </div>
          )
        ) : (
          <div className={s.notes}>
            <div className={s.activityTitle}>Notes</div>
            <textarea value={notes} aria-label="Notes" onChange={(e) => setNotes(e.target.value)} onBlur={save} />
            <div className={s.savedTo}>Saved to tasks/{task.id}.md</div>
          </div>
        )}
      </div>

      {!task.linear && (
        <div className={s.detailFoot}>
          {/* Bridle works it in its own chat until it marks it done or needs review. */}
          {working ? (
            <span className={s.footButton}><ShimmerText>Working on it…</ShimmerText></span>
          ) : task.status !== 'done' && (
            <Button cue="open" className={`${s.footButton} ${s.runButton}`} onClick={runIt}
              title={runError ?? 'Bridle plans it, does it and checks it, then marks it done or asks you'}>
              <Play size={14} />{task.chat ? 'Run again' : 'Run with Bridle'}
            </Button>
          )}
          {task.chat && (
            <Button className={s.footButton} onClick={() => go('chat', task.chat!)}><MessageSquare size={14} />Open chat</Button>
          )}
          {runError && <span className={s.loadError} title={runError}><TriangleAlert size={13} /></span>}
          {hasLinear && (
            <Button className={s.footButton} onClick={onSendToLinear}><ArrowUpRight size={14} />Add to Linear</Button>
          )}
          <span className={s.spacer} />
          <Button cue={null} className={`${s.footButton} ${s.delete}`}
            onClick={() => {
              play('close', { emphasis: 'strong' })
              onDelete()
            }}>
            <Trash2 size={14} />Delete
          </Button>
        </div>
      )}
    </aside>
  )
}
