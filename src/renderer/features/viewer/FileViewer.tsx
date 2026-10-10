import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, Eye, File as FileIcon, Folder, FolderOpen, Pencil, SquareArrowOutUpRight, X } from 'lucide-react'
import type { FolderEntry, ViewerItem } from '../../../shared/types'
import { Button, Markdown, MOTION, Pill, usePresence } from '../../components'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import { useViewer, viewer } from './store'
import s from './viewer.module.css'

// A 480px panel on the right. Folders list their contents, markdown renders
// (and edits), text and code show monospace (and edit), images and PDFs preview, anything else shows
// its Finder icon with "Open in default app".

const tilde = (p: string): string => p.replace(/^\/Users\/[^/]+/, '~')
const parent = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/'

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif'
}
const mime = (name: string): string => MIME[name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream'

/** The panel, or nothing while no file is open. Mount it beside the content. */
export function FileViewer() {
  const { path, history } = useViewer()
  const { state, patch } = useApp()

  // Opening a file closes Settings (RootView: onChange(of: viewer.url)).
  useEffect(() => {
    if (path && state.settingsOpen) patch({ settingsOpen: false })
  }, [path])

  // Slides in from the trailing edge, fading, on MOTION.send, both ways.
  const last = useRef(path)
  if (path) last.current = path
  const { mounted, leaving } = usePresence(!!path, MOTION.send.duration)
  const shown = path ?? last.current
  if (!mounted || !shown) return null
  return (
    <aside className={`${s.panel} ${leaving ? s.leaving : ''}`} aria-label="File viewer" aria-hidden={leaving || undefined}>
      <Pane key={shown} path={shown} canGoBack={!leaving && history.length > 0} />
    </aside>
  )
}

function Pane({ path, canGoBack }: { path: string; canGoBack: boolean }) {
  const [item, setItem] = useState<ViewerItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [icon, setIcon] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [src, setSrc] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const name = path.split('/').pop() || path
  const isText = item?.kind === 'markdown' || item?.kind === 'text'

  useEffect(() => {
    let url: string | null = null
    let live = true
    window.bridle.viewer.icon(path).then((i) => live && setIcon(i), () => {})
    window.bridle.viewer.inspect(path).then(async (it) => {
      if (it.kind === 'markdown' || it.kind === 'text') {
        const t = await window.bridle.workspace.readFile(path, 'utf8')
        if (live) setText(t)
      } else if (it.kind === 'image') {
        const b64 = await window.bridle.workspace.readFile(path, 'base64')
        if (live) setSrc(`data:${mime(it.name)};base64,${b64}`)
      } else if (it.kind === 'pdf') {
        // Chromium's own PDF viewer, from a blob: no file:// URL reaches the page.
        const b64 = await window.bridle.workspace.readFile(path, 'base64')
        url = URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'application/pdf' }))
        if (live) setSrc(url)
      } else if (it.kind === 'other') {
        // Quick Look's picture (Office, HEIC, movies…) through the native helper; null keeps the icon.
        const thumb = await window.bridle.native.thumbnail(path, 480).catch(() => null)
        if (live) setSrc(thumb)
      }
      if (live) setItem(it)
    }).catch((e: Error) => live && setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])

  const save = async (): Promise<void> => {
    try {
      await window.bridle.viewer.save(path, text)
      setDirty(false)
      play('success')
    } catch {
      play('error')
    }
  }

  // ⌘S saves while editing.
  useEffect(() => {
    if (!editing || !dirty) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const openOutside = () => void window.bridle.workspace.openPath(path).catch(() => play('error', { emphasis: 'subtle' }))

  return (
    <>
      <header className={s.header}>
        {canGoBack && <Action label="Back" cue={null} onClick={() => viewer.back()}><ChevronLeft size={16} /></Action>}
        {icon ? <img className={s.icon} src={icon} alt="" /> : <span className={s.icon} />}
        <div className={s.title}>
          <span>{name}</span>
          <span>{tilde(parent(path))}</span>
        </div>
        {isText && editing && dirty && <Action label="Save (⌘S)" cue={null} onClick={() => void save()}><Check size={15} /></Action>}
        {isText && (
          <Action label={editing ? 'Preview' : 'Edit'} onClick={() => {
            if (editing && dirty) void save()
            setEditing(!editing)
          }}>
            {editing ? <Eye size={15} /> : <Pencil size={14} />}
          </Action>
        )}
        <Action label="Open in default app" onClick={openOutside}><SquareArrowOutUpRight size={14} /></Action>
        <Action label="Show in Finder" onClick={() => void window.bridle.workspace.revealInFinder(path)}><FolderOpen size={15} /></Action>
        <Action label="Close" cue={null} onClick={() => viewer.close()}><X size={15} /></Action>
      </header>
      <div className={s.body}>
        {error ? (
          <div className={s.empty}>{error}</div>
        ) : !item ? null : item.kind === 'folder' ? (
          <FolderList dir={path} />
        ) : isText && editing ? (
          <textarea className={s.editor} value={text} spellCheck={false} autoFocus aria-label={`Edit ${name}`}
            onChange={(e) => {
              setText(e.target.value)
              setDirty(true)
            }} />
        ) : item.kind === 'markdown' ? (
          <div className={s.scroll}><Markdown text={text} className={s.document} /></div>
        ) : item.kind === 'text' ? (
          <div className={s.scroll}><pre className={s.code}>{text}</pre></div>
        ) : item.kind === 'image' && src ? (
          <div className={s.media}><img src={src} alt={name} /></div>
        ) : item.kind === 'pdf' && src ? (
          <iframe className={s.pdf} src={src} title={name} />
        ) : item.kind === 'other' && src ? (
          <div className={s.media} onDoubleClick={openOutside}><img src={src} alt={name} /></div>
        ) : (
          <div className={s.other}>
            {icon && <img src={icon} alt="" width={64} height={64} />}
            <span>No preview for this file</span>
            <Pill onClick={openOutside}>Open in default app</Pill>
          </div>
        )}
      </div>
    </>
  )
}

function Action({ label, cue = 'tap', onClick, children }: { label: string; cue?: 'tap' | null; onClick: () => void; children: ReactNode }) {
  return <Button cue={cue} className={s.action} aria-label={label} title={label} onClick={onClick}>{children}</Button>
}

/** An item's Finder icon, the generic glyph until it loads. */
function FinderIcon({ path, folder }: { path: string; folder: boolean }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    window.bridle.viewer.icon(path).then((i) => live && setSrc(i), () => {})
    return () => { live = false }
  }, [path])
  if (src) return <img src={src} alt="" width={16} height={16} />
  return folder ? <Folder size={16} /> : <FileIcon size={16} />
}

/** A folder's contents, folders first. Opening an item keeps the folder for Back. */
function FolderList({ dir }: { dir: string }) {
  const [items, setItems] = useState<FolderEntry[] | null>(null)
  useEffect(() => {
    window.bridle.viewer.list(dir).then(setItems, () => setItems([]))
  }, [dir])
  if (!items) return null
  return (
    <div className={`${s.scroll} ${s.folder}`}>
      {items.length === 0 && <div className={s.empty}>This folder is empty.</div>}
      {items.map((it) => (
        <Button key={it.path} cue={null} className={s.item} onClick={() => viewer.open(it.path, dir)}>
          <FinderIcon path={it.path} folder={it.folder} />
          <span>{it.name}</span>
          {it.folder && <ChevronRight size={12} strokeWidth={2.6} />}
        </Button>
      ))}
    </div>
  )
}
