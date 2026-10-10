import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BookMarked, Folder, Lock, Search } from 'lucide-react'
import { SERVICES, type GitHubRepo, type Space } from '../../../shared/types'
import { Button, Menu, Pill } from '../../components'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import { logos } from '../../theme'
import { setPref, useCode } from './store'
import s from './code.module.css'

const clean = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, '')

/** CodeScreen.addRepository: asks for a repo folder and adds it. Null if cancelled. */
export async function addFolder(): Promise<Space | null> {
  const [path] = await window.bridle.workspace.pickFiles({ prompt: 'Add', multiple: false, directories: true }).catch(() => [] as string[])
  return path ? window.bridle.code.addSpace(path) : null
}

/** AddRepositoryMenu: the + menu wherever a repository can be added, GitHub (logo) or a folder. */
export function AddRepositoryMenu({ trigger, added }: { trigger: ReactNode; added: (s: Space) => void }) {
  const [cloning, setCloning] = useState(false)
  return (
    <>
      <Menu label="Add repository" trigger={trigger} items={[
        { label: 'Clone from GitHub…', icon: <img src={logos.github} alt="" width={14} height={14} />, onSelect: () => setCloning(true) },
        { label: 'Open Folder…', icon: <Folder size={14} />, onSelect: () => void addFolder().then((sp) => sp && added(sp)) }
      ]} />
      {cloning && createPortal(<CloneSheet done={(sp) => {
        setCloning(false)
        if (sp) added(sp)
      }} />, document.body)}
    </>
  )
}

/** "3 days ago". */
function relative(iso: string): string {
  const s = (new Date(iso).getTime() - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, sec] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]] as const) {
    if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), unit)
  }
  return rtf.format(Math.round(s), 'second')
}

/** CloneSheet: pick one of your GitHub repos (through the GitHub connection) and where to clone it. */
function CloneSheet({ done }: { done: (s: Space | null) => void }) {
  const app = useApp()
  const folder = useCode().prefs.cloneFolder
  const grants = useMemo(() => app.state.accounts.filter((a) => a.service === 'github').flatMap((a) => {
    const g = a.grants.find((x) => x.toolkit === 'github' && x.ok)
    return g ? [{ login: a.login, id: g.id }] : []
  }), [app.state.accounts])
  const [grant, setGrant] = useState<string | null>(null)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<GitHubRepo | null>(null)
  const [loading, setLoading] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!grant && grants[0]) setGrant(grants[0].id)
  }, [grants, grant])

  useEffect(() => {
    if (!grant) return
    let live = true
    setLoading(true)
    window.bridle.code.githubRepos(grant).then(
      (r) => live && (setRepos(r), setError(null)),
      (e) => live && setError(clean(e))
    ).finally(() => live && setLoading(false))
    return () => { live = false }
  }, [grant])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (play('close'), done(null))
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [done])

  const shown = query ? repos.filter((r) => `${r.fullName} ${r.summary ?? ''}`.toLowerCase().includes(query.toLowerCase())) : repos

  const connect = async () => {
    setLinking(true)
    try {
      await window.bridle.composio.link('github', SERVICES.github.core, null)
      app.patch({ accounts: await window.bridle.composio.accounts() })
    } catch (e) {
      setError(clean(e))
    }
    setLinking(false)
  }

  const clone = async (repo = picked) => {
    if (!repo || cloning) return
    setCloning(true)
    setError(null)
    try {
      const space = await window.bridle.code.clone(repo, folder)
      play('success')
      done(space)
    } catch (e) {
      play('error')
      setError(clean(e))
    }
    setCloning(false)
  }

  const chooseFolder = async () => {
    play('open')
    const [path] = await window.bridle.workspace.pickFiles({ prompt: 'Clone Here', multiple: false, directories: true }).catch(() => [] as string[])
    if (path) setPref('cloneFolder', path)
  }

  return (
    <div className={s.fixedBackdrop} onMouseDown={(e) => e.target === e.currentTarget && (play('close'), done(null))}>
      <div className={s.sheet} role="dialog" aria-label="Clone from GitHub">
        <div className={s.sheetHead}>
          <div className={s.sheetTitle}>
            <img src={logos.github} alt="" />
            <h2>Clone from GitHub</h2>
            {grants.length > 1 ? (
              <Menu label="GitHub account" trigger={<span>{grants.find((g) => g.id === grant)?.login ?? ''} ▾</span>}
                items={grants.map((g) => ({ label: g.login, checked: g.id === grant, onSelect: () => setGrant(g.id) }))} />
            ) : grants[0] && <span>{grants[0].login}</span>}
          </div>
          {grants.length > 0 && (
            <label className={s.search}>
              <Search size={14} />
              <input autoFocus value={query} placeholder="Search your repositories" onChange={(e) => setQuery(e.target.value)} />
            </label>
          )}
        </div>
        {!grants.length ? (
          <div className={s.sheetCenter}>
            <img src={logos.github} alt="" width={28} height={28} />
            <strong>Connect GitHub</strong>
            <span>{linking ? 'Finish signing in in your browser…' : 'Bridle lists your repositories through your GitHub connection.'}</span>
            {linking ? <span className={s.spin} /> : <Pill filled cue="open" onClick={() => void connect()}>Connect GitHub</Pill>}
          </div>
        ) : loading && !repos.length ? (
          <div className={s.sheetCenter}><span className={s.spin} /></div>
        ) : error && !repos.length ? (
          <div className={s.sheetCenter}><strong>Couldn't load your repositories</strong><span>{error}</span></div>
        ) : (
          <div className={s.sheetBody}>
            {shown.map((r) => {
              const [owner] = r.fullName.split('/')
              return (
                <Button key={r.fullName} cue="select" className={`${s.repo} ${picked?.fullName === r.fullName ? s.on : ''}`}
                  onClick={() => setPicked(r)} onDoubleClick={() => { setPicked(r); void clone(r) }}>
                  {r.isPrivate ? <Lock size={13} /> : <BookMarked size={13} />}
                  <span className={s.repoText}>
                    <span><span className={s.dimText}>{owner} / </span><b>{r.name}</b></span>
                    {r.summary && <span>{r.summary}</span>}
                  </span>
                  {r.pushed && <span className={s.pushed}>{relative(r.pushed)}</span>}
                </Button>
              )
            })}
            {!shown.length && <div className={s.sheetCenter}>{query ? `No repositories match “${query}”.` : 'No repositories.'}</div>}
          </div>
        )}
        <div className={s.sheetFoot}>
          {cloning ? (
            <><span className={s.spin} /><span className={s.dimText}>Cloning {picked?.name}…</span></>
          ) : error && repos.length ? (
            <span className={s.warn}>{error}</span>
          ) : (
            <>
              <span className={s.dimText}>Clone to</span>
              <code title={folder}><bdi>{folder}</bdi></code>
              <Button cue={null} className={s.link} onClick={() => void chooseFolder()}>Change…</Button>
            </>
          )}
          <span className={s.spacer} />
          <Pill cue="close" onClick={() => done(null)}>Cancel</Pill>
          <Pill cue={null} filled disabled={!picked || cloning} onClick={() => void clone()}>Clone</Pill>
        </div>
      </div>
    </div>
  )
}
