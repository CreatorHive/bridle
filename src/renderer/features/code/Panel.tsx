import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Eye, File, Folder, Play, Plus, RotateCw, Square, X } from 'lucide-react'
import type { ChangedFile, DirEntry, Workspace } from '../../../shared/types'
import { Button, Menu } from '../../components'
import { play } from '../../sound'
import { useContextMenu } from '../tasks/ContextMenu'
import { totals, splitPath, HEAVY_FOLDERS } from './logic'
import { loadTools, openTab, refreshChanges, setBench, setPref, useCode, type Bench } from './store'
import { openTerminal, TerminalView } from './Terminal'
import s from './code.module.css'

/** Drag a hairline to resize: calls `set` with the new size while dragging, `done` once on release. */
export function useDrag(size: number, set: (n: number) => void, done: (n: number) => void, axis: 'x' | 'y', sign: number, min: number, max: number) {
  return (e: ReactMouseEvent) => {
    e.preventDefault()
    const start = axis === 'x' ? e.clientX : e.clientY
    let last = size
    const move = (m: MouseEvent) => {
      last = Math.min(max, Math.max(min, size + sign * ((axis === 'x' ? m.clientX : m.clientY) - start)))
      set(last)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      done(last)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
}

/** All files | Changes over Setup | Run | Terminal. The bottom half resizes from the
 *  divider and collapses from its chevron; sizes persist. */
export function WorkspacePanel({ workspace: w, bench }: { workspace: Workspace; bench: Bench }) {
  const code = useCode()
  const changes = code.changes[w.id] ?? []
  const [height, setHeight] = useState(code.prefs.workspaceBottomHeight)
  const shown = code.prefs.workspaceBottomShown

  // Refreshes while the panel is on screen. ponytail: a fixed 3 s poll; fs.watch on the worktree if git status gets slow.
  useEffect(() => {
    void loadTools(w.id)
    void refreshChanges(w.id)
    const t = setInterval(() => void refreshChanges(w.id), 3000)
    return () => clearInterval(t)
  }, [w.id])

  const drag = useDrag(height, setHeight, (n) => setPref('workspaceBottomHeight', n), 'y', -1, 100, 700)
  return (
    <>
      <div className={s.panelBar}>
        <PanelTab title="All files" on={!bench.showChanges} onClick={() => setBench(w.id, { showChanges: false })} />
        <PanelTab title={changes.length ? `Changes ${changes.length}` : 'Changes'} on={bench.showChanges} onClick={() => setBench(w.id, { showChanges: true })} />
        <span className={s.spacer} />
        <Button className={s.outline} title="Review all changes" onClick={() => openTab(w.id, { kind: 'review' })}><Eye size={13} />Review</Button>
        <Button className={s.iconButton} title="Refresh" aria-label="Refresh" onClick={() => {
          void refreshChanges(w.id)
          void loadTools(w.id)
        }}><RotateCw size={14} /></Button>
      </div>
      <div className={s.rule} />
      <div className={s.top}>
        {bench.showChanges ? <ChangesList w={w} changes={changes} /> : <FileTree root={w.path} selected={bench.tab.kind === 'file' ? bench.tab.path : null} w={w} />}
      </div>
      {shown ? <div className={s.hsplit} onMouseDown={drag} /> : <div className={s.rule} />}
      <BottomTabs w={w} bench={bench} shown={shown} />
      {shown && (
        <div className={s.bottom} style={{ height }}>
          <BottomContent w={w} bench={bench} />
        </div>
      )}
    </>
  )
}

function PanelTab({ title, on, onClick }: { title: string; on: boolean; onClick: () => void }) {
  return <Button cue="select" className={`${s.pill} ${on ? s.on : ''}`} onClick={onClick}>{title}</Button>
}

// MARK: Changes

function ChangesList({ w, changes }: { w: Workspace; changes: ChangedFile[] }) {
  const menu = useContextMenu()
  const t = totals(changes)
  const revert = (f: ChangedFile) => {
    play('open')
    const isNew = f.status === 'A' || f.status === 'U'
    const ok = window.confirm(`Revert ${splitPath(f.path)[1]}?\n\n${isNew ? `${f.path} is new in this workspace. Reverting deletes it.` : `Your changes to ${f.path} will be lost. This can't be undone.`}`)
    if (!ok) return play('close')
    play('close', { emphasis: 'strong' })
    void window.bridle.code.revert(w.id, f.path).then(() => refreshChanges(w.id))
  }
  if (!changes.length) return <div className={s.overlayNote}>No changes yet</div>
  return (
    <>
      <div className={s.changesHead}>
        <span>{changes.length} {changes.length === 1 ? 'file' : 'files'} changed</span>
        <span className={s.added}>+{t.added}</span>
        <span className={s.removed}>−{t.removed}</span>
      </div>
      {changes.map((f) => {
        const [folder, name] = splitPath(f.path)
        return (
          <Button key={f.path} cue="select" className={s.changeRow} title={f.path}
            onClick={() => openTab(w.id, { kind: 'diff', path: f.path })}
            onContextMenu={(e) => menu.open(e, [
              { label: 'Revert File…', cue: null, onSelect: () => revert(f) },
              {
                label: 'Show in Finder', divider: true, cue: 'tap',
                onSelect: () => void window.bridle.workspace.revealInFinder(`${w.path}/${f.status === 'D' ? folder : f.path}`)
              },
              { label: 'Copy Path', cue: null, onSelect: () => { void navigator.clipboard.writeText(f.path); play('success', { emphasis: 'subtle' }) } }
            ])}>
            <span className={s.changeName}><span><span className={s.dimText}>{folder}</span>{name}</span></span>
            <span className={s.mono}><span className={s.added}>+{f.added}</span><span className={s.removed}>−{f.removed}</span></span>
            <span className={`${s.status} ${s[f.status] ?? s.M}`}>{f.status}</span>
          </Button>
        )
      })}
      {menu.element}
    </>
  )
}

// MARK: File tree

/** The worktree as an expanding tree: only expanded folders are listed (each again when expanded). */
function FileTree({ root, selected, w }: { root: string; selected: string | null; w: Workspace }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({})

  useEffect(() => {
    setExpanded(new Set())
    void window.bridle.code.listDir(root).then((entries) => setChildren({ [root]: entries }))
  }, [root])

  const tap = async (e: DirEntry) => {
    if (!e.folder) {
      play('select')
      return openTab(w.id, { kind: 'file', path: e.path })
    }
    const next = new Set(expanded)
    if (next.delete(e.path)) {
      play('close')
    } else {
      play('open')
      const entries = await window.bridle.code.listDir(e.path)
      setChildren((c) => ({ ...c, [e.path]: entries }))
      next.add(e.path)
    }
    setExpanded(next)
  }

  const rows: { e: DirEntry; depth: number }[] = []
  const add = (folder: string, depth: number) => {
    for (const e of children[folder] ?? []) {
      rows.push({ e, depth })
      if (e.folder && expanded.has(e.path)) add(e.path, depth + 1)
    }
  }
  add(root, 0)
  return (
    <>
      {rows.map(({ e, depth }) => (
        <Button key={e.path} cue={null} title={e.path} style={{ paddingLeft: 6 + depth * 14 }}
          className={`${s.treeRow} ${expanded.has(e.path) ? s.open : ''} ${e.path === selected ? s.on : ''} ${HEAVY_FOLDERS.has(e.name) || e.name.startsWith('.') ? s.heavy : ''}`}
          onClick={() => void tap(e)}>
          <ChevronRight size={11} strokeWidth={2.5} style={{ opacity: e.folder ? 1 : 0 }} />
          {e.folder ? <Folder size={14} /> : <File size={14} />}
          <span>{e.name}</span>
        </Button>
      ))}
    </>
  )
}

// MARK: Setup | Run | Terminal

function BottomTabs({ w, bench, shown }: { w: Workspace; bench: Bench; shown: boolean }) {
  const tools = useCode().tools[w.id]
  const tab = (title: string, t: Bench['bottom']) => (
    <PanelTab title={title} on={shown && bench.bottom === t} onClick={() => {
      setBench(w.id, { bottom: t })
      if (!shown) setPref('workspaceBottomShown', true)
    }} />
  )
  const newTerminal = async () => {
    const id = await openTerminal(w.id)
    setBench(w.id, (b) => ({ terms: [...b.terms, id], term: id }))
  }
  return (
    <div className={s.bottomBar}>
      {tab('Setup', 'setup')}
      {tab('Run', 'run')}
      {tab('Terminal', 'terminal')}
      <span className={s.spacer} />
      {shown && bench.bottom === 'setup' && (tools?.settingUp ? <span className={s.spin} title="Setting up…" />
        : tools?.hasSetup ? <Button cue="loading" className={s.wash} onClick={() => void window.bridle.code.runSetup(w.id)}>Re-run setup</Button> : null)}
      {shown && bench.bottom === 'run' && tools && <RunControls w={w} />}
      {shown && bench.bottom === 'terminal' && (
        <>
          {bench.terms.length > 1 && (
            <Menu label="Terminals"
              trigger={<span className={s.termPicker}>{bench.terms.indexOf(bench.term ?? '') + 1}/{bench.terms.length}<ChevronDown size={9} /></span>}
              items={bench.terms.map((t, i) => ({ label: `${i + 1}: zsh`, checked: t === bench.term, onSelect: () => setBench(w.id, { term: t }) }))} />
          )}
          <Button className={s.iconButton} title="New terminal" aria-label="New terminal" onClick={() => void newTerminal()}><Plus size={14} /></Button>
          {bench.term && (
            <Button cue="close" className={s.iconButton} title="Close terminal" aria-label="Close terminal" onClick={() => {
              const id = bench.term!
              void window.bridle.code.termClose(id)
              setBench(w.id, (b) => {
                const i = b.terms.indexOf(id)
                const terms = b.terms.filter((t) => t !== id)
                return { terms, term: terms[i] ?? terms[terms.length - 1] ?? null }
              })
            }}><X size={14} /></Button>
          )}
        </>
      )}
      <Button cue={null} className={s.iconButton} title={shown ? 'Hide panel' : 'Show panel'} aria-label={shown ? 'Hide panel' : 'Show panel'} onClick={() => {
        play(shown ? 'close' : 'open')
        setPref('workspaceBottomShown', !shown)
      }}>{shown ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</Button>
    </div>
  )
}

function BottomContent({ w, bench }: { w: Workspace; bench: Bench }) {
  const tools = useCode().tools[w.id]
  const opening = useRef(false)
  // The first shell starts when the tab is first shown, not with the workspace.
  useEffect(() => {
    if (bench.bottom !== 'terminal' || bench.terms.length || opening.current) return
    opening.current = true
    void openTerminal(w.id).then((id) => setBench(w.id, (b) => ({ terms: [...b.terms, id], term: id }))).finally(() => (opening.current = false))
  }, [bench.bottom, bench.terms.length, w.id])

  if (bench.bottom === 'terminal') {
    return bench.term ? <div className={s.terminal}><TerminalView key={bench.term} termId={bench.term} /></div> : <div className={s.terminalEmpty} />
  }
  if (!tools) return <div className={s.placeholder} />
  if (bench.bottom === 'setup') {
    if (tools.setupLog) return <Log text={tools.setupLog} />
    return <div className={s.placeholder}>{tools.settingUp ? 'Setting up…' : tools.hasSetup ? "Setup hasn't run in this workspace yet."
      : 'Add a setup script in .bridle/setup.sh (runs in every new workspace; BRIDLE_ROOT_PATH points at the main checkout)'}</div>
  }
  if (!tools.output && !tools.running) {
    return <div className={s.placeholder}>{tools.configs.length ? `Run ${tools.configs[0].command} from the Run button.`
      : 'Nothing to run. Add commands to .bridle/run.json as [{"name", "command"}].'}</div>
  }
  return <Log text={tools.output} />
}

/** LogText: monospaced, selectable output that follows its end as it grows. */
function Log({ text }: { text: string }) {
  const el = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const p = el.current
    if (p) p.scrollTop = p.scrollHeight
  }, [text])
  return <pre ref={el} className={s.log}>{text}</pre>
}

/** "▶ Run ▾" with a menu of configurations; "■ Stop" while running, plus "Open" once a dev server prints its address. */
function RunControls({ w }: { w: Workspace }) {
  const tools = useCode().tools[w.id]!
  const next = tools.last ?? tools.configs[0]
  return (
    <>
      {tools.serverURL && (
        <Button className={s.openURL} title={tools.serverURL} onClick={() => void window.bridle.shell.openExternal(tools.serverURL!)}>Open</Button>
      )}
      <span className={`${s.run} ${tools.running ? s.running : ''}`}>
        <Button disabled={!tools.running && !next} title={tools.running ? `Stop ${tools.running.command}` : next?.command ?? 'Nothing to run'} onClick={() => {
          if (tools.running) void window.bridle.code.stopRun(w.id)
          else if (next) void window.bridle.code.run(w.id, next.name)
        }}>
          {tools.running ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
          {tools.running ? 'Stop' : 'Run'}
        </Button>
        <span className={s.runMenu}>
          <Menu label="Run configurations" trigger={<span className={`${s.chev}`} style={{ display: 'inline-flex', width: 18, justifyContent: 'center' }}><ChevronDown size={9} /></span>}
            items={[
              ...tools.configs.map((c) => ({ label: `${c.name}  —  ${c.command}`, onSelect: () => void window.bridle.code.run(w.id, c.name) })),
              ...(tools.output ? [{ label: 'Clear Output', onSelect: () => void window.bridle.code.clearOutput(w.id) }] : []),
              ...(tools.configs.length ? [] : [{ label: 'No run configurations', onSelect: () => {} }])
            ]} />
        </span>
      </span>
    </>
  )
}
