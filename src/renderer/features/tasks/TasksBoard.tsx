import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { ArrowUpRight, LayoutList, Plus, RefreshCw, SquareArrowOutUpRight, Trash2, TriangleAlert, User } from 'lucide-react'
import { TASK_STATUSES, type TaskItem, type TaskStatus } from '../../../shared/types'
import { Button, MOTION, Row, ShimmerText, SidebarHeader, createStore, usePresence, useLayoutEffectInBrowser } from '../../components'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import { logos } from '../../theme'
import { useContextMenu, type ContextItem } from './ContextMenu'
import {
  FILTERS, capped, chipText, columnCards, errorText, filterTasks, fitChips, linearGrant, tagColor, updatedLabel, type Filter
} from './logic'
import { StatusIcon, statusInfo } from './status'
import { TaskDetail } from './TaskDetail'
import s from './tasks.module.css'

const DRAG_TYPE = 'application/x-bridle-task'
const openLinear = (url: string) => {
  play('open')
  void window.bridle.shell.openExternal(url)
}

// The sidebar and the board share the filter, the open task, and (for counts) the tasks.
const board = createStore({ filter: 'All tasks' as Filter, open: null as string | null, tasks: [] as TaskItem[] })
const setFilter = (filter: Filter) => board.set({ filter })
const setOpen = (open: string | null) => board.set({ open })

const FILTER_ICON: Record<Filter, JSX.Element> = {
  'All tasks': <LayoutList size={16} />, Mine: <User size={16} />, Linear: <img src={logos.linear} alt="" width={14} height={14} />
}

/** The Board's sidebar: the views with their counts, then what changed lately. */
export function BoardSidebar() {
  const { filter, open, tasks } = board.use()
  const recent = [...tasks].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 8)
  return (
    <>
      <SidebarHeader title="Views" divider={false} />
      {FILTERS.map((f) => (
        <Row key={f} title={f} icon={FILTER_ICON[f]} selected={filter === f} badge={filterTasks(tasks, f).length || null}
          onClick={() => setFilter(f)} />
      ))}
      {recent.length > 0 && <SidebarHeader title="Recently updated" divider={false} />}
      {recent.map((t) => (
        <Row key={t.id} title={t.title} icon={<StatusIcon status={t.status} size={15} />} selected={open === t.id}
          onClick={() => setOpen(open === t.id ? null : t.id)} />
      ))}
    </>
  )
}

/** Four columns with drag and drop, and the detail panel; the views are in the sidebar. */
export function TasksBoard() {
  const { state } = useApp()
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const { filter, open } = board.use()
  useEffect(() => board.set({ tasks }), [tasks])
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<TaskStatus | null>(null)
  const [target, setTarget] = useState<TaskStatus | null>(null)
  const [allDone, setAllDone] = useState(false)
  const syncingRef = useRef(false)
  const menu = useContextMenu()
  const hasLinear = !!linearGrant(state.accounts)

  const replace = (t: TaskItem) => setTasks((ts) => ts.map((x) => (x.id === t.id ? t : x)))
  const fail = (e: unknown) => setError(errorText(e))

  const sync = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    try {
      const issues = await window.bridle.tasks.syncLinear()
      setTasks((ts) => [...ts.filter((t) => !t.linear), ...issues])
      setError(null)
    } catch (e) {
      fail(e)
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }, [])

  // Load, sync on open and every 5 minutes.
  useEffect(() => {
    let alive = true
    window.bridle.tasks.list()
      .then((t) => alive && setTasks(t), (e) => alive && fail(e))
      .then(() => { if (alive) void sync() })
    const timer = setInterval(() => void sync(), 300_000)
    // A task run moved a card or the agent edited its file.
    const off = window.bridle.on('tasks:changed', () =>
      void window.bridle.tasks.list().then((t) => alive && setTasks(t), () => {}))
    return () => {
      alive = false
      clearInterval(timer)
      off()
    }
  }, [sync])

  // Esc closes the detail panel (not while Settings is over the board).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !state.settingsOpen) {
        play('close')
        setOpen(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, state.settingsOpen])

  /** A Linear issue moves in Linear too, and snaps back if that fails. */
  const move = (id: string, status: TaskStatus) => {
    const before = tasks.find((t) => t.id === id)
    if (!before || before.status === status) return
    replace({ ...before, status, updated: new Date().toISOString() })
    window.bridle.tasks.move(id, status).then(replace, (e) => {
      fail(e)
      play('error')
      replace(before)
    })
  }

  const add = (title: string, status: TaskStatus) => {
    window.bridle.tasks.add(title, '', status).then((t) => setTasks((ts) => [t, ...ts]), fail)
  }

  // The detail panel saves as it closes; a task deleted or sent to Linear meanwhile stays gone.
  const live = useRef(tasks)
  live.current = tasks
  const update = (task: TaskItem) => {
    if (!live.current.some((t) => t.id === task.id)) return
    replace({ ...task, updated: new Date().toISOString() })
    window.bridle.tasks.update(task).then(replace, fail)
  }

  const remove = (task: TaskItem) => {
    if (task.linear) return
    setTasks((ts) => ts.filter((t) => t.id !== task.id))
    if (open === task.id) setOpen(null)
    window.bridle.tasks.delete(task.id).catch((e) => {
      fail(e)
      setTasks((ts) => [task, ...ts])
    })
  }

  const sendToLinear = async (task: TaskItem) => {
    try {
      const issue = await window.bridle.tasks.sendToLinear(task.id)
      setTasks((ts) => [issue, ...ts.filter((t) => t.id !== task.id)])
      play('success', { emphasis: 'subtle' })
    } catch (e) {
      fail(e)
    }
  }

  // A card's right-click menu. ContextMenu plays each item's cue: select (Move to), open, tap, close + strong (Delete).
  const contextItems = (task: TaskItem): ContextItem[] => [
    { label: 'Move to', items: TASK_STATUSES.filter((x) => x.status !== task.status).map((x) => ({
      label: x.title, icon: <StatusIcon status={x.status} />, onSelect: () => move(task.id, x.status)
    })) },
    ...(task.linear
      ? [{ label: 'Open in Linear', icon: <SquareArrowOutUpRight size={14} />, cue: 'open' as const,
          onSelect: () => void window.bridle.shell.openExternal(task.linear!.url) }]
      : [
          ...(hasLinear ? [{ label: 'Add to Linear', icon: <ArrowUpRight size={14} />, cue: 'tap' as const, onSelect: () => void sendToLinear(task) }] : []),
          { label: 'Delete', icon: <Trash2 size={14} />, destructive: true, divider: true, onSelect: () => remove(task) }
        ])
  ]

  const shown = filterTasks(tasks, filter)
  const openTask = tasks.find((t) => t.id === open)
  // The panel slides out (MOTION.send) after it closes, still showing the task it had.
  const lastTask = useRef(openTask)
  if (openTask) lastTask.current = openTask
  const panel = usePresence(!!openTask, MOTION.send.duration)
  const panelTask = openTask ?? lastTask.current

  return (
    <div className={s.board}>
      <div className={s.toolbar}>
        <h1 className={s.boardTitle}>{filter}</h1>
        <span className={s.spacer} />
        {error && <span className={s.error} title={error}><TriangleAlert size={12} />{error}</span>}
        {syncing ? (
          <span className={s.syncing}><ShimmerText>Syncing Linear…</ShimmerText></span>
        ) : hasLinear && (
          <Button className={s.sync} title="Sync Linear" aria-label="Sync Linear" onClick={() => void sync()}>
            <RefreshCw size={13} strokeWidth={2.5} />
          </Button>
        )}
      </div>

      <div className={s.body}>
        <div className={s.columns}>
          {TASK_STATUSES.map(({ status, title }) => {
            const cards = columnCards(shown, status)
            const { shown: visible, more } = capped(cards, status, allDone)
            return (
              <section key={status} className={`${s.column} ${target === status ? s.target : ''}`} aria-label={title}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (target !== status) setTarget(status)
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTarget((t) => (t === status ? null : t))
                }}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData(DRAG_TYPE)
                  setTarget(null)
                  if (!id) return
                  e.preventDefault()
                  play('select')
                  move(id, status)
                }}>
                <header className={s.columnHead}>
                  <StatusIcon status={status} />
                  <span className={s.columnTitle}>{title}</span>
                  <span className={s.count}>{cards.length}</span>
                  <span className={s.spacer} />
                  <Button cue="open" className={s.plus} title="New task" aria-label={`New task in ${title}`}
                    onClick={() => setAdding(status)}>
                    <Plus size={14} strokeWidth={2.5} />
                  </Button>
                </header>

                {adding === status && (
                  <NewTask
                    onDone={(t) => {
                      if (t) {
                        play('success', { emphasis: 'subtle' })
                        add(t, status)
                      }
                      setAdding(null)
                    }}
                  />
                )}

                <div className={s.cards}>
                  {visible.map((t) => (
                    <TaskCard key={t.id} task={t} selected={open === t.id}
                      onSelect={() => {
                        play(open === t.id ? 'close' : 'open')
                        setOpen(open === t.id ? null : t.id)
                      }}
                      onContextMenu={(e) => menu.open(e, contextItems(t))} />
                  ))}
                  {more && (
                    <button type="button" className={s.showAll} onClick={() => {
                      play(allDone ? 'close' : 'open')
                      setAllDone(!allDone)
                    }}>
                      {allDone ? 'Show fewer' : `Show all ${cards.length}`}
                    </button>
                  )}
                  {cards.length === 0 && adding !== status && <div className={s.empty}>Nothing here</div>}
                </div>
              </section>
            )
          })}
        </div>

        {panel.mounted && panelTask && (
          <TaskDetail key={panelTask.id} task={panelTask} hasLinear={hasLinear} leaving={panel.leaving}
            onClose={() => setOpen(null)}
            onMove={(st) => move(panelTask.id, st)}
            onUpdate={update}
            onDelete={() => remove(panelTask)}
            onSendToLinear={async () => {
              await sendToLinear(panelTask)
              setOpen(null)
            }} />
        )}
      </div>
      {menu.element}
    </div>
  )
}

function NewTask({ onDone }: { onDone: (title: string | null) => void }) {
  const [title, setTitle] = useState('')
  return (
    <input autoFocus className={s.newTask} placeholder="Task name" value={title} aria-label="Task name"
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => onDone(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(title.trim() || null)
        if (e.key === 'Escape') {
          e.stopPropagation()
          onDone(null)
        }
      }} />
  )
}

function TaskCard({ task, selected, onSelect, onContextMenu }: {
  task: TaskItem
  selected: boolean
  onSelect: () => void
  onContextMenu: (e: MouseEvent) => void
}) {
  // A Linear card also takes a double click (open in Linear), so its single click waits to see
  // whether a second follows; one action, one cue.
  const pending = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(pending.current), [])
  return (
    <div role="button" tabIndex={0} draggable className={`${s.card} ${selected ? s.selected : ''}`} aria-pressed={selected}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, task.id)
        e.dataTransfer.setData('text/plain', task.title)
        e.dataTransfer.effectAllowed = 'move'
        // .draggable's preview: just the title on a small white card.
        const ghost = document.createElement('div')
        ghost.className = s.dragPreview
        ghost.textContent = task.title
        document.body.append(ghost)
        e.dataTransfer.setDragImage(ghost, 14, 14)
        setTimeout(() => ghost.remove())
      }}
      onClick={(e) => {
        clearTimeout(pending.current)
        if (!task.linear) return onSelect()
        if (e.detail === 2) return openLinear(task.linear.url)
        if (e.detail === 1) pending.current = setTimeout(onSelect, 250)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      onContextMenu={onContextMenu}>
      <div className={s.cardHead}>
        <StatusIcon status={task.status} />
        <div className={s.cardTitles}>
          <div className={s.cardTitle}>{task.title}</div>
          {task.linear && task.linear.state !== statusInfo(task.status).title && <div className={s.state}>{task.linear.state}</div>}
        </div>
      </div>
      {(task.tags.length > 0 || task.linear) && <Chips tags={task.tags} identifier={task.linear?.identifier} />}
      <div className={s.updated}>{updatedLabel(task.updated)}</div>
    </div>
  )
}

/** The identifier, then as many tags (up to 2) as fit. Never a row of "Duva…" stubs. */
function Chips({ tags, identifier }: { tags: string[]; identifier?: string }) {
  const row = useRef<HTMLDivElement>(null)
  const candidates = tags.slice(0, 2)
  const [n, setN] = useState(candidates.length)

  useLayoutEffectInBrowser(() => {
    const el = row.current
    if (!el) return
    const kids = [...el.children] as HTMLElement[]
    const lead = identifier ? kids.shift()!.offsetWidth : 0
    setN(fitChips({ lead, tags: kids.map((k) => k.offsetWidth) }, el.clientWidth))
  }, [candidates.join('\n'), identifier])

  return (
    <div ref={row} className={s.chips}>
      {identifier && (
        <span className={s.chip}><img src={logos.linear} alt="" width={11} height={11} />{identifier}</span>
      )}
      {candidates.map((t, i) => (
        <span key={t} className={`${s.chip} ${i >= n ? s.unfit : ''}`} aria-hidden={i >= n || undefined}>
          <span className={s.dot} style={{ background: tagColor(t) }} />
          {chipText(t)}
        </span>
      ))}
    </div>
  )
}
