import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Code2, GitBranch, GitMerge, PanelRight, ShieldCheck } from 'lucide-react'
import type { Space, Workspace } from '../../../shared/types'
import { Button, Menu, Pill } from '../../components'
import { play } from '../../sound'
import { AddRepositoryMenu } from './AddRepository'
import { CodeChat } from './CodeChat'
import { prBase } from './logic'
import { useDrag, WorkspacePanel } from './Panel'
import { benchOf, getState, loadChats, refresh, refreshChanges, select, setPref, setState, useCode, wire } from './store'
import s from './code.module.css'

const clean = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, '')

/** Loads Code once, wherever it's first shown (screen or sidebar). */
export function useCodeLoaded(): void {
  useEffect(() => {
    wire()
    if (!getState().loaded) void refresh()
  }, [])
}

// MARK: Actions the sidebar shares (CodeScreen.newWorkspace / archive / removeRepository)

/** A new workspace in `space`. A folder that isn't a git repo is offered git init and a first commit (only on your OK). */
export async function newWorkspace(space: Space): Promise<Workspace | null> {
  if (!(await window.bridle.code.isRepo(space.root))) {
    play('attention')
    if (!window.confirm(`Initialize git in ${space.name}?\n\nWorkspaces are git worktrees, and ${space.root} isn't a git repository yet. Bridle can run git init and commit everything in it as “Initial commit”.`)) return null
    try {
      await window.bridle.code.initRepo(space.root)
    } catch (e) {
      play('error')
      window.alert(`Couldn't initialize git\n\n${clean(e)}`)
      return null
    }
  }
  try {
    play('loading')
    const w = await window.bridle.code.createWorkspace(space.slug)
    play('success', { emphasis: 'subtle' })
    await refresh()
    select(w.id)
    return w
  } catch (e) {
    play('error')
    window.alert(`Couldn't create a workspace\n\n${clean(e)}`)
    return null
  }
}

/** Archives `w`, asking first when it has uncommitted work. True if it's gone. */
export async function archive(w: Workspace): Promise<boolean> {
  try {
    await window.bridle.code.archiveWorkspace(w.id, false)
  } catch (e) {
    if (!clean(e).includes('uncommitted changes')) return failed(e)
    play('attention')
    if (!window.confirm(`Archive anyway?\n\n“${w.title}” has changes that aren't committed. Archiving removes its folder, and those changes with it.`)) return false
    try {
      await window.bridle.code.archiveWorkspace(w.id, true)
    } catch (e2) {
      return failed(e2)
    }
  }
  play('close', { emphasis: 'strong' })
  if (getState().selected === w.id) select(null)
  await refresh()
  return true

  function failed(e: unknown): false {
    play('error')
    window.alert(`Couldn't archive “${w.title}”\n\n${clean(e)}`)
    return false
  }
}

/** Forgets a repo: archives its workspaces (one confirmation naming any with uncommitted work), then its settings and chats go to the Trash. */
export async function removeRepository(space: Space): Promise<void> {
  const workspaces = getState().workspaces.filter((w) => w.repo === space.slug)
  const dirty = (await Promise.all(workspaces.map((w) => window.bridle.code.dirty(w.id).catch(() => false)))).filter(Boolean).length
  let detail = "Bridle forgets the repo and its chats. Your folder isn't touched."
  if (workspaces.length) {
    detail = `Its ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'} will be archived`
      + (dirty ? `, and ${dirty} ${dirty === 1 ? 'has' : 'have'} uncommitted changes that will be lost. ` : '. ') + detail
  }
  play('attention')
  if (!window.confirm(`Remove ${space.name}?\n\n${detail}`)) return
  try {
    await window.bridle.code.removeSpace(space.slug)
  } catch (e) {
    play('error')
    window.alert(`Couldn't remove ${space.name}\n\n${clean(e)}`)
    return
  }
  if (getState().selected?.startsWith(space.slug + '/')) select(null)
  play('close', { emphasis: 'strong' })
  await refresh()
}

// MARK: The screen

/** One workspace at a time. The header names repo › workspace with Create PR; the agent
 *  conversation is in the middle and the workspace's files, changes and terminals are on the right. */
export function CodeScreen() {
  useCodeLoaded()
  const code = useCode()
  const w = code.workspaces.find((x) => x.id === code.selected)
  const space = w && code.spaces.find((x) => x.slug === w.repo)
  const [width, setWidth] = useState(code.prefs.codePanelWidth)
  useEffect(() => setWidth(code.prefs.codePanelWidth), [code.prefs.codePanelWidth])

  // Opening a workspace loads its chats and changes.
  useEffect(() => {
    if (!w) return
    if (!getState().chats[w.id]) void loadChats(w.id)
    void refreshChanges(w.id)
  }, [w?.id])

  const togglePanel = () => {
    play(getState().prefs.codePanelShown ? 'close' : 'open')
    setPref('codePanelShown', !getState().prefs.codePanelShown)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.altKey && e.code === 'KeyB') {
        e.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const drag = useDrag(width, setWidth, (n) => setPref('codePanelWidth', n), 'x', -1, 280, 600)

  if (!w) {
    return (
      <div className={s.screen}>
        {!code.loaded ? null : !code.spaces.length ? (
          <div className={s.empty}>
            <Code2 size={26} />
            <h2>Add a repository</h2>
            <p>Each task gets its own workspace: a copy of the repo on a new branch, so the agent never touches your checkout.</p>
            <AddRepositoryMenu added={(sp) => void newWorkspace(sp)} trigger={<span className="b-pill filled">Add repository…</span>} />
          </div>
        ) : (
          <div className={s.empty}>
            <GitBranch size={26} />
            <h2>No workspace open</h2>
            <p>Start a workspace for a task, or pick one in the sidebar.</p>
            <div className={s.emptyActions}>
              {code.spaces.slice(0, 3).map((sp) => (
                <Pill key={sp.slug} filled cue={null} onClick={() => void newWorkspace(sp)}>
                  {code.spaces.length === 1 ? 'New workspace' : `New workspace in ${sp.name}`}
                </Pill>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const bench = benchOf(code, w.id)
  return (
    <div className={s.screen}>
      <div className={s.header}>
        <span className={s.repoName}>{space?.name ?? w.repo}</span>
        <ChevronRight size={11} strokeWidth={2.6} className={s.crumb} />
        <span className={s.title}>{w.title}</span>
        <span className={s.branch} title={`${w.branch}, from ${w.base}\n${w.path}`}><GitBranch size={11} />{w.branch}</span>
        <span className={s.spacer} />
        <CreatePRButton w={w} />
        <Button cue={null} className={s.iconButton} title={code.prefs.codePanelShown ? 'Hide panel (⌥⌘B)' : 'Show panel (⌥⌘B)'}
          aria-label="Toggle panel" onClick={togglePanel}><PanelRight size={15} /></Button>
      </div>
      <div className={s.body}>
        <CodeChat w={w} bench={bench} />
        {code.prefs.codePanelShown && (
          <>
            <div className={s.vsplit} onMouseDown={drag} />
            <div className={s.panel} style={{ width }}><WorkspacePanel workspace={w} bench={bench} /></div>
          </>
        )}
      </div>
      {space && !space.trusted && !space.trustAsked && <TrustCard space={space} />}
    </div>
  )
}

/** SpaceTrust: asked the first time a repo opens; either answer is remembered, so it asks once. */
function TrustCard({ space }: { space: Space }) {
  const answer = async (trusted: boolean) => {
    const updated = await window.bridle.code.trustSpace(space.slug, trusted)
    setState((st) => ({ spaces: st.spaces.map((x) => (x.slug === updated.slug ? updated : x)) }))
  }
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (play('close'), void answer(false))
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  })
  return (
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && (play('close'), void answer(false))}>
      <div className={s.trust} role="dialog" aria-label={`Trust ${space.name}?`}>
        <span className={s.shield}><ShieldCheck size={18} /></span>
        <h2>Trust {space.name}?</h2>
        <p>Trusting lets this repo's own CLAUDE.md, .claude settings and hooks load for the agent. Hooks run commands on your Mac, so only trust code you know.</p>
        <code title={space.root}>{space.root}</code>
        <div className={s.trustButtons}>
          <Pill cue="close" onClick={() => void answer(false)}>Don't trust</Pill>
          <Pill cue="success" filled onClick={() => void answer(true)}>Trust</Pill>
        </div>
      </div>
    </div>
  )
}

/** "⑂ Create PR ▾". Pushing leaves the Mac, so every path to it asks first. */
function CreatePRButton({ w }: { w: Workspace }) {
  const [asking, setAsking] = useState<null | { draft: boolean }>(null)
  const [creating, setCreating] = useState(false)
  const [existing, setExisting] = useState<string | null>(null)
  const root = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let live = true
    setExisting(null)
    void window.bridle.code.pullRequest(w.id).then((url) => live && setExisting(url), () => {})
    return () => { live = false }
  }, [w.id])

  useEffect(() => {
    if (!asking) return
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setAsking(null)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (play('close'), setAsking(null))
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [asking])

  const ask = (draft: boolean) => {
    play('open')
    setAsking({ draft })
  }

  const create = async () => {
    const draft = !!asking?.draft
    setAsking(null)
    setCreating(true)
    play('loading')
    try {
      const url = await window.bridle.code.createPR(w.id, draft)
      setExisting(url)
      play('success')
      await window.bridle.shell.openExternal(url)
    } catch (e) {
      play('error')
      window.alert(`Couldn't create the pull request\n\n${clean(e)}`)
    }
    setCreating(false)
  }

  return (
    <span className={s.anchor} ref={root}>
      <span className={s.split}>
        <Button cue={null} disabled={creating} onClick={() => ask(false)}>
          {creating ? <span className={s.spin} /> : <GitMerge size={12} />}Create PR
        </Button>
        <span />
        <Menu label="Pull request" trigger={<span className={s.chev}><ChevronDown size={10} /></span>} items={[
          { label: 'Create PR', onSelect: () => ask(false) },
          { label: 'Create Draft PR', onSelect: () => ask(true) },
          { label: 'Copy Branch Name', onSelect: () => { void navigator.clipboard.writeText(w.branch); play('success', { emphasis: 'subtle' }) } },
          ...(existing ? [{ label: 'Open on GitHub', onSelect: () => void window.bridle.shell.openExternal(existing) }] : [])
        ]} />
      </span>
      {asking && (
        <div className={s.popover} role="dialog">
          <h3>{asking.draft ? 'Create a draft pull request?' : 'Create a pull request?'}</h3>
          <div>Push <strong>{w.branch}</strong> to origin and open a {asking.draft ? 'draft ' : ''}pull request into <strong>{prBase(w.base)}</strong>?</div>
          <div className={s.popoverButtons}>
            <Pill cue="close" onClick={() => setAsking(null)}>Cancel</Pill>
            <Pill cue={null} filled autoFocus onClick={() => void create()}>Create</Pill>
          </div>
        </div>
      )}
    </span>
  )
}
