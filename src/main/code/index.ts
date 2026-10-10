import { app, shell } from 'electron'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { BridleAPI } from '../../shared/api'
import { DEFAULT_CODE_PREFS, type CodePrefs, type Space } from '../../shared/types'
import { emit } from '../events'
import { composio } from '../services/composio'
import { pref, setPref } from '../services/settings'
import { workspaceRoot } from '../services/workspace'
import { answerPlan, chats, dropAgent, respond, send, stop } from './agent'
import { git, isRepo } from './git'
import * as spaces from './spaces'
import * as tools from './tools'

// The `code` contract group. Registered in ipc.ts.

const changed = () => emit('code:workspaces', {})

/** The Space a workspace belongs to; a stand-in when its repo was forgotten. */
async function spaceFor(repo: string, root: string): Promise<Space> {
  return (await spaces.loadSpaces()).find((s) => s.slug === repo)
    ?? { slug: repo, name: repo, root, trusted: false, allowedCommands: [], engine: 'claude' }
}

const withTrust = async (s: Space): Promise<Space> => {
  const v = await pref(`spaceTrustAsked.${s.slug}`)
  return { ...s, trustAsked: v === true || v === 1 || v === '1' }
}

let quitHooked = false
/** Runs, setups and shells end with the app. */
function hookQuit(): void {
  if (quitHooked) return
  quitHooked = true
  app.on('before-quit', tools.stopAllTools)
}

export const code: BridleAPI['code'] = {
  async spaces() {
    return Promise.all((await spaces.loadSpaces()).map(withTrust))
  },

  async addSpace(root) {
    const s = await spaces.addSpace(root)
    changed()
    return withTrust(s)
  },

  async removeSpace(slug) {
    const s = await spaces.spaceOf(slug)
    for (const w of (await spaces.loadWorkspaces()).filter((w) => w.repo === slug)) {
      await spaces.archiveWorkspace(w, true)
      await dropAgent(w.id)
      tools.dropTools(w.id)
    }
    const dir = join(await workspaceRoot(), 'spaces', s.slug)
    await shell.trashItem(dir).catch(() => rm(dir, { recursive: true, force: true }))
    changed()
  },

  async trustSpace(slug, trusted) {
    await setPref(`spaceTrustAsked.${slug}`, true)
    const s = await spaces.spaceOf(slug)
    if (trusted && !s.trusted) await spaces.saveSpace({ ...s, trusted: true })
    changed()
    return withTrust({ ...s, trusted: s.trusted || trusted })
  },

  isRepo,

  async initRepo(path) {
    const steps = [['init'], ['add', '-A'], ['commit', '-m', 'Initial commit']]
    for (const args of steps) {
      const r = await git(args, path)
      if (!r.ok && args[0] !== 'add') throw new Error(r.stderr.trim() || `git ${args[0]} failed`)
    }
  },

  workspaces: () => spaces.loadWorkspaces(),

  async createWorkspace(slug) {
    const space = await spaces.spaceOf(slug)
    const w = await spaces.createWorkspace(space)
    changed()
    hookQuit()
    if (tools.autoSetup(space)) void tools.runSetup(space, w)
    return w
  },

  async archiveWorkspace(id, force) {
    const w = await spaces.workspaceOf(id)
    await spaces.archiveWorkspace(w, force)
    await dropAgent(id)
    tools.dropTools(id)
    changed()
  },

  async renameWorkspace(id, title) {
    await spaces.renameWorkspace(await spaces.workspaceOf(id), title)
    changed()
  },

  dirty: async (id) => spaces.dirty(await spaces.workspaceOf(id)),
  changes: async (id) => spaces.changes(await spaces.workspaceOf(id)),
  diff: async (id, path) => spaces.diff(await spaces.workspaceOf(id), path),
  revert: async (id, path) => spaces.revert(await spaces.workspaceOf(id), path),
  createPR: async (id, draft) => spaces.createPR(await spaces.workspaceOf(id), draft),
  pullRequest: async (id) => spaces.pullRequest(await spaces.workspaceOf(id)),
  listDir: (path) => spaces.listDir(path),

  chats: async (id) => chats(await spaces.workspaceOf(id)),

  async send(id, chatId, prompt, mode) {
    const w = await spaces.workspaceOf(id)
    return send(w, await spaceFor(w.repo, w.path), chatId, prompt, mode)
  },

  stop,
  answerPlan: async (id, approve, feedback) => answerPlan(await spaces.workspaceOf(id), approve, feedback),
  respond: async (id, cardId, allow, always) => respond(await spaces.workspaceOf(id), cardId, allow, always),

  async tools(id) {
    const w = await spaces.workspaceOf(id)
    return tools.state(await spaceFor(w.repo, w.path), w)
  },

  async run(id, name) {
    const w = await spaces.workspaceOf(id)
    const s = await tools.state(await spaceFor(w.repo, w.path), w)
    const c = s.configs.find((x) => x.name === name)
    if (!c) throw new Error(`No run configuration “${name}”`)
    hookQuit()
    await tools.runConfig(w, c)
  },

  stopRun: async (id) => tools.stopRun(id),
  clearOutput: async (id) => tools.clearOutput(id),

  async runSetup(id) {
    const w = await spaces.workspaceOf(id)
    hookQuit()
    await tools.runSetup(await spaceFor(w.repo, w.path), w)
  },

  async termOpen(id, cols, rows) {
    hookQuit()
    return tools.termOpen(await spaces.workspaceOf(id), cols, rows)
  },
  termWrite: async (termId, data) => void tools.termWrite(termId, data),
  termResize: async (termId, cols, rows) => void tools.termResize(termId, cols, rows),
  termClose: async (termId) => tools.termClose(termId),

  /** ponytail: the first 5 pages (500 repos); add paging on scroll if someone has more. */
  async githubRepos(grant) {
    const all = []
    for (let page = 1; page <= 5; page++) {
      const data = await composio.execute('GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER',
        { per_page: 100, page, sort: 'pushed', type: 'all' }, grant)
      const batch = spaces.parseRepos(data)
      all.push(...batch)
      if (batch.length < 100) break
    }
    return all
  },

  async clone(repo, parent) {
    const s = await spaces.addSpace(await spaces.cloneRepo(repo, parent))
    changed()
    return withTrust(s)
  },

  async prefs() {
    const out = { ...DEFAULT_CODE_PREFS } as Record<keyof CodePrefs, unknown>
    for (const key of Object.keys(DEFAULT_CODE_PREFS) as (keyof CodePrefs)[]) {
      const v = await pref(key)
      const d = DEFAULT_CODE_PREFS[key]
      if (v == null) continue
      out[key] = typeof d === 'boolean' ? v === true || v === 1 || v === '1' : typeof d === 'number' ? Number(v) || d : String(v)
    }
    return out as unknown as CodePrefs
  },

  async setPref(key, value) {
    if (!(key in DEFAULT_CODE_PREFS)) throw new Error(`not a Code preference: ${key}`)
    await setPref(key, value)
  }
}
