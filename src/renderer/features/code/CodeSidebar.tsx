import { GitBranch, GitPullRequest, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Space, Workspace } from '../../../shared/types'
import { Button } from '../../components'
import { play } from '../../sound'
import { useContextMenu } from '../tasks/ContextMenu'
import { AddRepositoryMenu } from './AddRepository'
import { archive, newWorkspace, removeRepository, useCodeLoaded } from './CodeScreen'
import { compact, totals } from './logic'
import { select, useCode } from './store'
import s from './code.module.css'

/** Pinned workspaces, then each repo and its workspaces: +/− counts, a PR icon once a PR is open,
 *  a spinner while the agent works. */
export function CodeSidebar() {
  useCodeLoaded()
  const code = useCode()
  const menu = useContextMenu()
  const [pins, togglePin] = usePins()
  const pinned = code.workspaces.filter((w) => pins.includes(w.id))
  const row = (w: Workspace, inPinned = false) => (
    <WorkspaceRow key={w.id} w={w} space={inPinned ? code.spaces.find((sp) => sp.slug === w.repo) : undefined}
      selected={code.selected === w.id} running={!!code.agents[w.id]?.running}
      counts={totals(code.changes[w.id] ?? [])} pinned={pins.includes(w.id)} togglePin={togglePin} open={menu.open} />
  )
  return (
    <>
      {pinned.length > 0 && (
        <>
          <div className={s.sideLabel}><span>Pinned</span></div>
          {pinned.map((w) => row(w, true))}
          <div className={s.gap} />
        </>
      )}
      <div className={s.sideLabel}>
        <span>My workspaces</span>
        <AddRepositoryMenu added={(sp) => void newWorkspace(sp)}
          trigger={<span className={s.repoPlus} title="Add repository: clone from GitHub or open a folder"><Plus size={14} strokeWidth={2.2} /></span>} />
      </div>
      {code.spaces.map((sp) => (
        <div key={sp.slug}>
          <RepoRow space={sp} open={menu.open} />
          {code.workspaces.filter((w) => w.repo === sp.slug && !pins.includes(w.id)).map((w) => row(w))}
          <div className={s.gap} />
        </div>
      ))}
      {menu.element}
    </>
  )
}

type Open = ReturnType<typeof useContextMenu>['open']

/** A repo's mark: its initial on a dark tile. */
function RepoMark({ space, size }: { space: Space; size: number }) {
  return <span className={s.repoMark} style={{ width: size, height: size, fontSize: size * 0.55 }} aria-hidden>{space.name.charAt(0).toUpperCase()}</span>
}

function RepoRow({ space, open }: { space: Space; open: Open }) {
  return (
    <div className={s.repoRow} title={space.root} onContextMenu={(e) => open(e, [
      { label: 'New Workspace', cue: 'tap', onSelect: () => void newWorkspace(space) },
      { label: 'Show in Finder', cue: 'tap', onSelect: () => void window.bridle.workspace.revealInFinder(space.root) },
      { label: 'Remove Repository…', destructive: true, divider: true, cue: null, onSelect: () => void removeRepository(space) }
    ])}>
      <RepoMark space={space} size={20} />
      <span>{space.name}</span>
      <Button className={s.repoPlus} title={`New workspace in ${space.name}`} aria-label={`New workspace in ${space.name}`}
        onClick={() => void newWorkspace(space)}><Plus size={14} strokeWidth={2.2} /></Button>
    </div>
  )
}

function WorkspaceRow({ w, space, selected, running, counts, pinned, togglePin, open }: {
  w: Workspace; space?: Space; selected: boolean; running: boolean; counts: { added: number; removed: number }
  pinned: boolean; togglePin: (id: string) => void; open: Open
}) {
  const pr = usePullRequest(w.id)
  return (
    <Button cue="select" className={`${s.wsRow} ${space ? s.pinnedRow : ''} ${selected ? s.on : ''}`}
      title={pr ? `${w.branch} · PR open` : w.branch} aria-current={selected || undefined}
      onClick={() => select(w.id)}
      onContextMenu={(e) => open(e, [
        { label: pinned ? 'Unpin' : 'Pin', cue: 'toggle', onSelect: () => togglePin(w.id) },
        ...(pr ? [{ label: 'Open Pull Request', cue: 'tap' as const, onSelect: () => window.open(pr) }] : []),
        { label: 'Show in Finder', cue: 'tap', divider: true, onSelect: () => void window.bridle.workspace.revealInFinder(w.path) },
        { label: 'Copy Branch Name', cue: null, onSelect: () => { void navigator.clipboard.writeText(w.branch); play('success', { emphasis: 'subtle' }) } },
        { label: 'Archive', destructive: true, divider: true, cue: null, onSelect: () => void archive(w) }
      ])}>
      {space && <RepoMark space={space} size={16} />}
      {pr ? <GitPullRequest size={14} className={s.prIcon} /> : <GitBranch size={14} />}
      <span className={s.wsTitle}>{w.title}</span>
      {running && <span className={s.spin} title="Working…" />}
      {counts.added > 0 && <span className={s.added}>+{compact(counts.added)}</span>}
      {counts.removed > 0 && <span className={s.removed}>−{compact(counts.removed)}</span>}
    </Button>
  )
}

const PINS = 'code.pinned'

/** Pinned workspace ids. ponytail: this viewer's localStorage; move to the workspace store if pins should sync. */
function usePins(): [string[], (id: string) => void] {
  const [pins, setPins] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(PINS) ?? '[]') as string[] } catch { return [] }
  })
  const toggle = (id: string) => setPins((p) => {
    const next = p.includes(id) ? p.filter((x) => x !== id) : [...p, id]
    try { localStorage.setItem(PINS, JSON.stringify(next)) } catch { /* not kept; still pinned this session */ }
    return next
  })
  return [pins, toggle]
}

/** Each workspace's open PR URL, asked once per workspace per launch.
 *  ponytail: one `gh` call per workspace; batch it in main if repos get many workspaces. */
const prs = new Map<string, Promise<string | null>>()

function usePullRequest(id: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (!prs.has(id)) prs.set(id, window.bridle.code.pullRequest(id).catch(() => null))
    void prs.get(id)!.then((u) => live && setUrl(u))
    return () => { live = false }
  }, [id])
  return url
}
