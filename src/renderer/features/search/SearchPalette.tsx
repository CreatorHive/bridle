import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CalendarDays, FileText, ListChecks, Mail, MessageSquare, Search, type LucideIcon } from 'lucide-react'
import type { TaskItem } from '../../../shared/types'
import { useApp } from '../../app/store'
import { usePresence } from '../../components'
import { play } from '../../sound'
import { viewer } from '../viewer'
import { hitResults, linearResults, mailResults, type Result, type ResultKind } from './logic'
import s from './search.module.css'

// ⌘K, one box over chats, notes, tasks, meeting prep and files (the workspace
// index, words and meaning), plus loaded mail and Linear issues. Opening it brings the index up to date.

let open = false
const subscribers = new Set<() => void>()
const setOpen = (v: boolean): void => {
  open = v
  subscribers.forEach((f) => f())
}
const subscribe = (f: () => void) => {
  subscribers.add(f)
  return () => void subscribers.delete(f)
}

/** Opens the palette (the sidebar's Search button; ⌘K is handled by the palette itself). */
export function openSearch(): void {
  if (open) return
  play('open')
  setOpen(true)
}

const ICONS: Record<ResultKind, LucideIcon> = { chat: MessageSquare, task: ListChecks, meeting: CalendarDays, file: FileText, mail: Mail }

/** Mount once inside AppProvider; renders nothing while closed and listens for ⌘K. */
export function SearchPalette() {
  const isOpen = useSyncExternalStore(subscribe, () => open, () => open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // In and out on timingCurve(0.16, 1, 0.3, 1, 0.25): the backdrop fades, the panel scales from the top.
  const { mounted, leaving } = usePresence(isOpen, 250)
  return mounted ? <Palette leaving={leaving} /> : null
}

function Palette({ leaving }: { leaving: boolean }) {
  const { state, go, patch } = useApp()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(true)
  const [version, setVersion] = useState(0)
  const [root, setRoot] = useState('')
  const [linear, setLinear] = useState<TaskItem[]>([])
  const list = useRef<HTMLDivElement>(null)

  // Bring the index up to date (only changed files are read), then search again with fresh passages.
  useEffect(() => {
    let live = true
    window.bridle.workspace.path().then(setRoot, () => {})
    window.bridle.tasks.list().then((t) => live && setLinear(t.filter((x) => x.linear)), () => {})
    window.bridle.search.refresh().catch(() => {}).finally(() => {
      if (!live) return
      setBusy(false)
      setVersion((v) => v + 1)
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const text = query.trim()
    if (!text) {
      setResults([])
      return
    }
    let live = true
    const timer = setTimeout(async () => {
      const hits = await window.bridle.search.query(text, 30).catch(() => [])
      if (!live) return
      setResults([...hitResults(hits, text, root, state.chats), ...linearResults(linear, text), ...mailResults(state.mail, text)])
      setSelected(0)
    }, 180)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, version, root, linear])

  useEffect(() => {
    list.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const close = (): void => {
    play('close', { emphasis: 'subtle' })
    setOpen(false)
  }

  const choose = (r: Result): void => {
    setOpen(false)
    if (r.kind === 'chat' && r.chatId) {
      play('navigate')
      go('chat', r.chatId)
    } else if (r.kind === 'mail' && r.mail) {
      play('navigate')
      patch({ section: 'mail', mailbox: r.mail.mailbox })
    } else if (r.kind === 'task') {
      play('navigate')
      go('board')
    } else if (r.path) {
      viewer.open(r.path)
    }
  }

  const empty = query.trim() !== '' && results.length === 0

  return (
    <div className={`${s.backdrop} ${leaving ? s.leaving : ''}`} aria-hidden={leaving || undefined} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={s.panel} role="dialog" aria-label="Search">
        <div className={s.field}>
          <Search size={15} />
          <input autoFocus value={query} placeholder="Search chats, notes and files" aria-label="Search" spellCheck={false}
            role="combobox" aria-expanded={results.length > 0} aria-controls="search-results"
            aria-activedescendant={results.length ? `search-result-${selected}` : undefined}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelected((i) => Math.min(i + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelected((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter' && results[selected]) {
                e.preventDefault()
                choose(results[selected])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                close()
              }
            }} />
          {busy && <span className="b-spinner" title="Updating the index…" />}
        </div>
        {empty && <div className={s.empty}>{busy ? 'Indexing your workspace…' : 'No matches'}</div>}
        {results.length > 0 && (
          <div className={s.results} ref={list} role="listbox" id="search-results">
            {results.map((r, i) => {
              const Icon = ICONS[r.kind]
              return (
                <div key={r.key} id={`search-result-${i}`} data-index={i} role="option" aria-selected={i === selected}
                  className={`${s.row} ${i === selected ? s.selected : ''}`}
                  onMouseMove={() => i !== selected && setSelected(i)} onClick={() => choose(r)}>
                  <Icon size={14} />
                  <div className={s.text}>
                    <div className={s.line}>
                      <span className={s.title}>{r.title}</span>
                      <span className={s.detail}>{r.detail}</span>
                    </div>
                    {r.snippet && <div className={s.snippet}>{r.snippet}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
