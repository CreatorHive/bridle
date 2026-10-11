import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AppWindow, ChevronDown, Copy, Ellipsis, File, FileText, FileType, Folder, Image, Plus, Presentation, Search, Settings,
  Sheet, Sparkles, SquareArrowOutUpRight, Trash2, Upload, type LucideIcon
} from 'lucide-react'
import type { FileKind, WorkspaceFile } from '../../../shared/types'
import { Button, Menu, MOTION, usePresence, type MenuItem } from '../../components'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import { useContextMenu, type ContextItem } from '../tasks/ContextMenu'
import {
  KIND_INFO, SORTS, byteCount, canTrash, excerpt, folder, imageMime, kindCount, lowercasedFirst, previewKind,
  related, shownFiles, thumbnailable, when, type Sort
} from './logic'
import { useViewer, viewer } from '../viewer'
import { DriveView, drivePath, files as nav, load } from './DriveView'
import s from './files.module.css'

const KIND_ICON: Record<FileKind, LucideIcon> = {
  documents: FileText, spreadsheets: Sheet, presentations: Presentation, images: Image, pdfs: FileType, other: File
}

/** Dropped files' paths, folders skipped (link those to a project instead). */
const droppedPaths = (dt: DataTransfer): string[] =>
  [...dt.items].filter((i) => i.kind === 'file' && !i.webkitGetAsEntry()?.isDirectory)
    .map((i) => window.bridle.pathForFile(i.getAsFile()!)).filter(Boolean)

/** An image file as a data: URL (the CSP blocks file://), or a Quick Look thumbnail for PDFs, Office files,
 *  HEIC and movies; cached per path. Big images and files without a thumbnail get the kind icon. */
const images = new Map<string, Promise<string | null>>()
function useImage(f: WorkspaceFile | undefined, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const image = !!f && f.size < 8_000_000 && previewKind(f.name) === 'image'
  const key = enabled && f && (image || thumbnailable(f.name)) ? `${f.path}|${f.modified}` : null
  useEffect(() => {
    setUrl(null)
    if (!key || !f) return
    let alive = true
    if (!images.has(key)) {
      images.set(key, image
        ? window.bridle.workspace.readFile(f.path, 'base64').then((b64) => `data:${imageMime(f.name)};base64,${b64}`, () => null)
        : window.bridle.native.thumbnail(f.path, 320).catch(() => null))
    }
    void images.get(key)!.then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [key])
  return url
}

/** The kind's symbol on a tinted rounded square, or a real thumbnail for images and Quick Look files (loaded once scrolled into view). */
export function KindIcon({ kind, file, size = 40 }: { kind: FileKind; file?: WorkspaceFile; size?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (!file || !(kind === 'images' || thumbnailable(file.name)) || !ref.current) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true))
    io.observe(ref.current)
    return () => io.disconnect()
  }, [kind, file])
  const thumb = useImage(file, seen)
  const tint = KIND_INFO[kind].tint
  const Icon = KIND_ICON[kind]
  return (
    <span ref={ref} className={`${s.kindIcon} ${thumb ? s.thumb : ''}`}
      style={{ width: size, height: size, borderRadius: size * 0.25, color: tint, background: `color-mix(in srgb, ${tint} 10%, transparent)` }}>
      {thumb ? <img src={thumb} alt="" /> : <Icon size={Math.round(size * 0.42)} fill="currentColor" fillOpacity={0.15} />}
    </span>
  )
}

export interface Actions {
  open(f: WorkspaceFile): void
  ask(f: WorkspaceFile): void
  trash(f: WorkspaceFile): void
}

/** A file's menu items: Open, Ask about this file, Show in Finder, Copy Path, and Move to Trash for your own files.
 *  Cues: open (viewer.open), tap (ask), select (Finder), success subtle (copied), close strong (trash).
 *  ponytail: components/Menu ignores `cue` and plays select for every item; the context menu honors it. */
export function fileItems(f: WorkspaceFile, a: Actions): (MenuItem & ContextItem)[] {
  return [
    { label: 'Open', icon: <AppWindow size={14} />, cue: null, onSelect: () => a.open(f) },
    { label: 'Ask about this file', icon: <Sparkles size={14} />, cue: 'tap', onSelect: () => a.ask(f) },
    { label: 'Show in Finder', icon: <Folder size={14} />, onSelect: () => void window.bridle.workspace.revealInFinder(f.path) },
    { label: 'Copy Path', icon: <Copy size={14} />, cue: null, onSelect: () => {
      play('success', { emphasis: 'subtle' })
      void navigator.clipboard.writeText(f.path)
    } },
    ...(canTrash(f) ? [{ label: 'Move to Trash', icon: <Trash2 size={14} />, destructive: true, divider: true, onSelect: () => a.trash(f) }] : [])
  ]
}

function FileMenu({ file, actions }: { file: WorkspaceFile; actions: Actions }) {
  return (
    <span className={s.more} onClick={(e) => e.stopPropagation()}>
      <Menu label={`Options for ${file.name}`} trigger={<span className={s.moreIcon}><Ellipsis size={16} strokeWidth={2.6} /></span>}
        items={fileItems(file, actions)} />
    </span>
  )
}

/** Header, kind tiles, the recent list, and the inspector; or the open Drive folder.
 *  The sidebar (FilesSidebar) picks the kind, Bridle's files, or a Drive folder. */
export function FilesScreen() {
  const { patch } = useApp()
  const root = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('Last opened')
  const [selected, setSelected] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const menu = useContextMenu()
  const { kind, system, dir, home } = nav.use()
  useEffect(() => nav.set({ list: files }), [files])
  const inDrive = dir !== null && !!home

  const shown = shownFiles(files, { kind, system, query, sort })
  const latest = useRef({ kind, system, query, sort, shown, selected })
  latest.current = { kind, system, query, sort, shown, selected }

  const refresh = useCallback(async (select?: string) => {
    const scanned = await window.bridle.workspace.listFiles().catch(() => [] as WorkspaceFile[])
    setFiles(scanned)
    const keep = select ?? latest.current.selected
    setSelected(keep && scanned.some((f) => f.path === keep) ? keep : shownFiles(scanned, latest.current)[0]?.path ?? null)
  }, [])

  useEffect(() => {
    void refresh()
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [refresh])

  /** Copies files into user/files, or the open Drive folder. */
  const add = async (paths: string[]) => {
    if (!paths.length) return
    try {
      const added = await window.bridle.workspace.addFiles(paths, inDrive && !system ? dir.slice(home.length + 1) : undefined)
      play('success')
      if (inDrive && !system) void load(dir)
      await refresh(added[0])
    } catch {
      play('error')
    }
  }

  const choose = async () => {
    play('open')
    await add(await window.bridle.workspace.pickFiles({ prompt: 'Add', multiple: true }).catch(() => []))
  }

  const actions: Actions = {
    // The viewer side panel (Viewer.open plays `open`).
    open: (f) => viewer.open(f.path),
    /** Starts a new chat with the file waiting in the composer. */
    ask: (f) => patch({ askAbout: f.path, section: 'chat', chatId: null }),
    trash: (f) => {
      window.bridle.workspace.trashFile(f.path).then(() => {
        setFiles((fs) => fs.filter((x) => x.path !== f.path))
        if (latest.current.selected === f.path) setSelected(latest.current.shown.find((x) => x.path !== f.path)?.path ?? null)
      }, () => play('error'))
    }
  }

  const compact = width < 640
  const file = files.find((f) => f.path === selected)
  // The inspector needs room, and steps aside while the viewer shows a file.
  const viewing = useViewer().path !== null
  const showInspector = width >= 920 && !viewing && !!file && !inDrive
  const lastFile = useRef(file)
  if (showInspector) lastFile.current = file
  const inspector = usePresence(showInspector, MOTION.state.duration)
  const inspected = showInspector ? file : lastFile.current
  const pick = (k: FileKind | null) => nav.set({ kind: k, system: false })

  return (
    <div ref={root} className={s.screen}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropping(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        void add(droppedPaths(e.dataTransfer))
      }}>
      <div className={`${s.content} ${inDrive ? s.fill : ''}`}>
        <div className={s.header}>
          <div className={s.titles}>
            <h1>{system ? "Bridle's files" : inDrive ? 'Drive' : kind ? KIND_INFO[kind].title : 'Files'}</h1>
            <p>{system ? "Its operating system: persona, memory, prompts, workers and routines. Edits change how it works."
              : inDrive ? 'Your folders. Bridle can read, search and organize them.' : 'Work with your files, ask questions, and take action.'}</p>
          </div>
          <div className={s.actions}>
            {!inDrive && (
              <>
                <Button cue={null} className={s.add} title="Add files to your workspace" onClick={() => void choose()}>
                  <Plus size={15} />Add
                </Button>
                <label className={s.search}>
                  <Search size={14} />
                  <input placeholder="Search files…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search files" />
                </label>
              </>
            )}
          </div>
        </div>

        {inDrive ? (
          <DriveView root={system ? home : drivePath(home)} label={system ? 'Bridle' : 'Drive'} system={system} dir={dir}
            choose={() => void choose()} actions={actions} contextMenu={(e, items) => menu.open(e, items)} />
        ) : (<>

        <div className={`${s.tiles} ${compact ? s.compact : ''}`}>
          <Button cue={null} className={`${s.drop} ${dropping ? s.dropping : ''}`} onClick={() => void choose()}>
            {compact ? (
              <><Upload size={15} />Drop files or add</>
            ) : (
              <>
                <span className={s.dropIcon}><Upload size={16} /></span>
                <strong>Drop files here</strong>
                <span>PDF, DOCX, XLSX, PNG<br />and more</span>
              </>
            )}
          </Button>
          {(['documents', 'spreadsheets', 'presentations', 'images'] as const).map((k) => {
            const count = kindCount(files, k)
            return (
              <Button key={k} cue="select" className={`${s.tile} ${kind === k ? s.ring : ''}`} aria-pressed={kind === k}
                style={kind === k ? { boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${KIND_INFO[k].tint} 60%, transparent)` } : undefined}
                onClick={() => pick(kind === k ? null : k)}>
                <KindIcon kind={k} size={compact ? 30 : 40} />
                {compact ? (
                  <><span className={s.tileTitle}>{KIND_INFO[k].title}</span><span className={s.tileCount}>{count}</span></>
                ) : (
                  <span className={s.tileText}>
                    <span className={s.tileTitle}>{KIND_INFO[k].title}</span>
                    <span className={s.tileCount}>{count} file{count === 1 ? '' : 's'}</span>
                  </span>
                )}
              </Button>
            )
          })}
        </div>

        <div className={s.listHead}>
          <h2>{query ? 'Results' : 'Recent files'}</h2>
          <Menu label="Sort" trigger={<span className={s.sort}>{sort}<ChevronDown size={11} strokeWidth={2.6} /></span>}
            items={SORTS.map((x) => ({ label: x, checked: x === sort, onSelect: () => setSort(x) }))} />
        </div>

        {shown.length === 0 && (
          <div className={s.empty}>{files.length === 0 ? 'No files yet. Drop some here, or press Add.' : 'No files match.'}</div>
        )}
        <div className={s.list} role="list">
          {shown.map((f) => (
            <div key={f.path} role="listitem" className={`${s.row} ${f.path === selected ? s.selected : ''}`}
              onClick={(e) => {
                if (e.detail === 2) return actions.open(f)
                play('select')
                setSelected(f.path)
              }}
              onContextMenu={(e) => menu.open(e, fileItems(f, actions))}>
              <KindIcon kind={f.kind} file={f} />
              <div className={s.rowText}>
                <span className={s.name}>{f.name}</span>
                <span className={s.folder}>{folder(f.path)}</span>
              </div>
              <div className={s.rowMeta}>
                <span>{when(f.opened)}</span>
                <span>{byteCount(f.size)}</span>
              </div>
              <FileMenu file={f} actions={actions} />
            </div>
          ))}
        </div>
        </>)}
      </div>

      {/* The inspector needs room; it slides in from the trailing edge and back out (MOTION.state). */}
      {inspector.mounted && inspected && (
        <Inspector file={inspected} related={related(files, inspected)} actions={actions} leaving={inspector.leaving}
          select={(r) => setSelected(r.path)} />
      )}
      {menu.element}
    </div>
  )
}

/** FileInspector: the selected file, a preview, Open, Ask about this file, and related files. */
function Inspector({ file, related, actions, select, leaving }: {
  file: WorkspaceFile
  related: WorkspaceFile[]
  actions: Actions
  select: (f: WorkspaceFile) => void
  leaving: boolean
}) {
  const preview = previewKind(file.name)
  const image = useImage(file, true)
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    setText(null)
    if (preview !== 'text' || file.size > 512_000) return
    let alive = true
    window.bridle.workspace.readFile(file.path, 'utf8').then((t) => alive && setText(excerpt(t)), () => {})
    return () => {
      alive = false
    }
  }, [file.path, file.modified])

  return (
    <aside className={`${s.inspector} ${leaving ? s.leaving : ''}`} aria-label="File" aria-hidden={leaving || undefined}>
      <div className={s.card}>
        <div className={s.inspectorHead}>
          <KindIcon kind={file.kind} file={file} size={44} />
          <div className={s.rowText}>
            <span className={s.inspectorName}>{file.name}</span>
            <span className={s.meta}>{byteCount(file.size)} · Modified {lowercasedFirst(when(file.modified))}</span>
            {file.system && <span className={s.bridleFile}><Settings size={11} />Bridle file: edits change how Bridle behaves</span>}
          </div>
          <FileMenu file={file} actions={actions} />
        </div>
        <div className={s.divider} />
        {/* Keyed, so a newly selected file's preview fades in (Thumbnail's .id(file.url)). */}
        <div key={file.path} className={s.preview} onDoubleClick={() => actions.open(file)}>
          {image ? <img src={image} alt="" /> : text !== null ? <pre>{text}</pre> : <KindIcon kind={file.kind} size={72} />}
        </div>
        <div className={s.buttons}>
          <Button cue={null} className={s.open} onClick={() => actions.open(file)}>
            <SquareArrowOutUpRight size={14} />Open
          </Button>
          <Button className={s.ask} onClick={() => actions.ask(file)}>
            <Sparkles size={14} />Ask about this file
          </Button>
        </div>
      </div>

      {related.length > 0 && (
        <>
          <h3 className={s.relatedTitle}>Related</h3>
          {related.map((r) => (
            <Button key={r.path} cue="select" className={s.related} onClick={() => select(r)}>
              <KindIcon kind={r.kind} file={r} size={36} />
              <span className={s.rowText}>
                <span className={s.relatedName}>{r.name}</span>
                <span className={s.folder}>{folder(r.path)}</span>
              </span>
            </Button>
          ))}
        </>
      )}
    </aside>
  )
}
