import { useEffect, useState, type MouseEvent } from 'react'
import { ChevronRight, File, FileText, FileType, Folder, FolderOpen, FolderPlus, Image, Plus, Presentation, Settings, Sheet, Trash2, Upload } from 'lucide-react'
import type { FileKind, FolderEntry, WorkspaceFile } from '../../../shared/types'
import { Button, Row, SidebarHeader, createStore } from '../../components'
import { play } from '../../sound'
import type { ContextItem } from '../tasks/ContextMenu'
import { KindIcon, fileItems, type Actions } from './FilesScreen'
import { KINDS, KIND_INFO, fileKind, kindCount } from './logic'
import s from './files.module.css'

// Files' sidebar and its Drive: the Library (recent files by kind) and the workspace's drive/ folder as a tree,
// like Comma's Drive. The agent reads, searches and organizes the same folder (its system prompt says so).

export const files = createStore({
  /** The workspace folder. */
  home: '',
  /** The open Drive folder; null = the Library. */
  dir: null as string | null,
  kind: null as FileKind | null,
  /** Bridle's own files instead of yours. */
  system: false,
  /** The Library's scan, for the sidebar's counts. */
  list: [] as WorkspaceFile[],
  /** Each loaded folder's entries, and the tree's open folders. */
  kids: {} as Record<string, FolderEntry[]>,
  expanded: [] as string[]
})

export const drivePath = (home: string): string => `${home}/drive`

/** Reads a folder into `kids`. ponytail: reloads on navigation and our own changes; the agent's edits show
 *  the next time a folder is opened. */
export function load(path: string): Promise<void> {
  return window.bridle.viewer.list(path).then(
    (list) => files.set((st) => ({ kids: { ...st.kids, [path]: list } })),
    () => files.set((st) => ({ kids: { ...st.kids, [path]: [] } })))
}

function useHome(): string {
  const { home } = files.use()
  useEffect(() => {
    if (!home) window.bridle.workspace.path().then((h) => files.set({ home: h }), () => {})
  }, [home])
  return home
}

export function openFolder(path: string): void {
  files.set((st) => ({ dir: path, expanded: st.expanded.includes(path) ? st.expanded : [...st.expanded, path] }))
  void load(path)
}

const KIND_ICON: Record<FileKind, JSX.Element> = {
  documents: <FileText size={16} />, spreadsheets: <Sheet size={16} />, presentations: <Presentation size={16} />,
  images: <Image size={16} />, pdfs: <FileType size={16} />, other: <File size={16} />
}

/** The Files sidebar: Library views with counts, then the Drive tree. */
export function FilesSidebar() {
  const { dir, kind, system, list, kids, expanded } = files.use()
  const home = useHome()
  const drive = home && drivePath(home)
  useEffect(() => {
    if (drive) for (const p of [drive, ...expanded]) void load(p)
  }, [drive])

  const library = (k: FileKind | null, sys = false) => files.set({ dir: null, kind: k, system: sys })
  const on = (k: FileKind | null, sys = false) => dir === null && kind === k && system === sys
  const toggle = (path: string) =>
    files.set((st) => ({ expanded: st.expanded.includes(path) ? st.expanded.filter((p) => p !== path) : [...st.expanded, path] }))

  const branch = (path: string, name: string, depth: number): JSX.Element[] => {
    const sub = kids[path]?.filter((e) => e.folder)
    const open = expanded.includes(path) || path === drive
    return [
      <Button key={path} cue="select" className={`b-row ${s.treeRow} ${dir === path ? 'selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}
        aria-current={dir === path || undefined} onClick={() => openFolder(path)}>
        <span className={`${s.chev} ${open ? s.chevOpen : ''}`} style={sub && !sub.length || path === drive ? { visibility: 'hidden' } : undefined}
          onClick={(e) => {
            e.stopPropagation()
            toggle(path)
            void load(path)
          }}>
          <ChevronRight size={12} strokeWidth={2.4} />
        </span>
        <span className="icon">{open && sub?.length ? <FolderOpen size={16} /> : <Folder size={16} />}</span>
        <span className="title">{name}</span>
      </Button>,
      ...(open ? (sub ?? []).flatMap((e) => branch(e.path, e.name, depth + 1)) : [])
    ]
  }

  return (
    <>
      <SidebarHeader title="Library" divider={false} />
      <Row title="Recent" icon={<File size={16} />} selected={on(null)} onClick={() => library(null)} />
      {KINDS.filter((k) => k !== 'other').map((k) => (
        <Row key={k} title={KIND_INFO[k].title} icon={KIND_ICON[k]} selected={on(k)} badge={kindCount(list, k) || null}
          onClick={() => library(k)} />
      ))}
      <Row title="Bridle's files" icon={<Settings size={16} />} selected={on(null, true)} onClick={() => library(null, true)}
        help="The agent's persona and memory, chats, tasks, notes and app state" />
      <SidebarHeader title="Drive" divider={false} />
      {drive && branch(drive, 'Drive', 0)}
    </>
  )
}

const asFile = (e: FolderEntry): WorkspaceFile =>
  ({ path: e.path, name: e.name, kind: fileKind(e.name), size: 0, modified: '', opened: '', system: false })

/** Drive → dir, as [path, name] pairs for the breadcrumb. */
function crumbs(drive: string, dir: string): [string, string][] {
  const out: [string, string][] = [[drive, 'Drive']]
  let path = drive
  for (const part of dir.slice(drive.length).split('/').filter(Boolean)) out.push([(path = `${path}/${part}`), part])
  return out
}

/** The open Drive folder: breadcrumb, New folder, Add files, and its entries. */
export function DriveView({ dir, choose, actions, contextMenu }: {
  dir: string
  choose(): void
  actions: Actions
  contextMenu(e: MouseEvent, items: ContextItem[]): void
}) {
  const { home, kids } = files.use()
  const [selected, setSelected] = useState<string | null>(null)
  const [naming, setNaming] = useState(false)
  useEffect(() => {
    setSelected(null)
    void load(dir)
  }, [dir])

  const create = async (name: string) => {
    setNaming(false)
    if (!name.trim()) return
    try {
      const path = await window.bridle.workspace.createFolder(dir, name)
      play('success')
      await load(dir)
      setSelected(path)
    } catch {
      play('error')
    }
  }

  const trash = (path: string) => window.bridle.workspace.trashFile(path).then(() => load(dir), () => play('error'))
  const folderItems = (e: FolderEntry): ContextItem[] => [
    { label: 'Open', icon: <FolderOpen size={14} />, onSelect: () => openFolder(e.path) },
    { label: 'Show in Finder', icon: <Folder size={14} />, onSelect: () => void window.bridle.workspace.revealInFinder(e.path) },
    { label: 'Move to Trash', icon: <Trash2 size={14} />, destructive: true, divider: true, onSelect: () => void trash(e.path) }
  ]
  const fileActions: Actions = { ...actions, trash: (f) => void trash(f.path) }

  const entries = kids[dir]
  return (
    <div className={s.drive}>
      <div className={s.bar}>
        <nav className={s.crumbs} aria-label="Folder">
          {crumbs(drivePath(home), dir).map(([path, name], i, all) => (
            <span key={path}>
              {i > 0 && <ChevronRight size={12} />}
              {i === all.length - 1 ? <strong>{name}</strong> : <button onClick={() => openFolder(path)}>{name}</button>}
            </span>
          ))}
        </nav>
        <Button cue={null} className={s.add} onClick={() => setNaming(true)}><FolderPlus size={15} />New folder</Button>
        <Button cue={null} className={`${s.add} ${s.primary}`} onClick={choose}><Plus size={15} />Add files</Button>
      </div>

      <div className={s.entries} role="list">
        {naming && (
          <div className={`${s.entry} ${s.entryOn}`}>
            <span className={s.folderIcon}><Folder size={18} /></span>
            <input className={s.nameInput} autoFocus defaultValue="New folder" aria-label="Folder name"
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create(e.currentTarget.value)
                if (e.key === 'Escape') setNaming(false)
              }}
              onBlur={(e) => void create(e.currentTarget.value)} />
          </div>
        )}
        {entries?.map((e) => (
          <div key={e.path} role="listitem" className={`${s.entry} ${selected === e.path ? s.entryOn : ''}`}
            onClick={(ev) => {
              if (ev.detail === 2) return e.folder ? openFolder(e.path) : actions.open(asFile(e))
              play('select')
              setSelected(e.path)
            }}
            onContextMenu={(ev) => contextMenu(ev, e.folder ? folderItems(e) : fileItems(asFile(e), fileActions))}>
            {e.folder ? <span className={s.folderIcon}><Folder size={18} fill="currentColor" fillOpacity={0.15} /></span>
              : <KindIcon kind={fileKind(e.name)} file={asFile(e)} size={30} />}
            <span className={s.name}>{e.name}</span>
          </div>
        ))}
        {entries?.length === 0 && !naming && (
          <div className={s.driveEmpty}>
            <FolderOpen size={22} strokeWidth={1.6} />
            <strong>Folder is empty</strong>
            <span>New folders and files you add show up here,<br />and Bridle can read and organize them.</span>
            <Button cue={null} className={`${s.add} ${s.primary}`} onClick={choose}><Upload size={15} />Add files</Button>
          </div>
        )}
      </div>
    </div>
  )
}
