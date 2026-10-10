import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { shell } from 'electron'
import type { BridleAPI } from '../../shared/api'
import { TASK_STATUSES, type LinearDetail, type LinearRef, type TaskItem, type TaskStatus } from '../../shared/types'
import { connectedAccounts, execute } from './composio'
import { workspaceRoot } from './workspace'
import { iso } from './util'

// The task board: your tasks are tasks/<id>.md (front matter + "# Title" + notes);
// Linear issues assigned to you come through Composio, cached in .bridle/linear.json.

// MARK: Markdown files

/** Front matter (status, tags, updated) over a "# Title" and free-form notes. */
export function taskMarkdown(t: TaskItem): string {
  let md = `---\nstatus: ${t.status}\n`
  if (t.tags.length) md += `tags: ${t.tags.join(', ')}\n`
  md += `updated: ${iso(t.updated)}\n`
  if (t.chat) md += `chat: ${t.chat}\n`
  md += `---\n# ${t.title}\n`
  if (t.notes) md += `\n${t.notes}\n`
  return md
}

const STATUSES = TASK_STATUSES.map((s) => s.status)

export function parseTask(md: string, id: string, now = new Date()): TaskItem {
  const task: TaskItem = { id, title: id, notes: '', status: 'backlog', tags: [], updated: iso(now) }
  let lines = md.split('\n')
  if (lines[0] === '---') {
    lines = lines.slice(1)
    while (lines.length && lines[0] !== '---') {
      const line = lines.shift() as string
      const colon = line.indexOf(':')
      if (colon < 0) continue
      const key = line.slice(0, colon).trim()
      const value = line.slice(colon + 1).trim()
      if (!key || !value) continue
      if (key === 'status') task.status = STATUSES.includes(value as TaskStatus) ? (value as TaskStatus) : 'backlog'
      else if (key === 'tags') task.tags = value.split(',').map((s) => s.trim()).filter(Boolean)
      else if (key === 'updated' && !isNaN(Date.parse(value))) task.updated = iso(value)
      else if (key === 'chat') task.chat = value
    }
    lines = lines.slice(1)
  }
  const i = lines.findIndex((l) => l.startsWith('# '))
  if (i >= 0) {
    task.title = lines[i].slice(2)
    task.notes = lines.slice(i + 1).join('\n').trim()
  }
  return task
}

async function folder(): Promise<string> {
  return join(await workspaceRoot(), 'tasks')
}

/** tasks/<id>.md; an id is a file name, never a path (the phone bridge passes ids through). */
async function taskFile(id: string): Promise<string> {
  if (!id || id !== basename(id) || id === '.' || id === '..') throw new Error('No such task')
  return join(await folder(), `${id}.md`)
}

async function write(t: TaskItem): Promise<void> {
  const file = await taskFile(t.id)
  await mkdir(await folder(), { recursive: true })
  await writeFile(`${file}.tmp`, taskMarkdown(t), 'utf8')
  await rename(`${file}.tmp`, file)
}

async function readMine(): Promise<TaskItem[]> {
  const dir = await folder()
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.md'))
  const tasks = await Promise.all(names.map(async (n) => {
    try {
      return parseTask(await readFile(join(dir, n), 'utf8'), n.slice(0, -3))
    } catch {
      return null
    }
  }))
  return tasks.filter((t): t is TaskItem => t !== null).sort((a, b) => b.updated.localeCompare(a.updated))
}

// MARK: Linear issues (in memory, loaded from the cache once per workspace)

let fromLinear: { root: string; items: TaskItem[] } | null = null

async function linearItems(): Promise<TaskItem[]> {
  const root = await workspaceRoot()
  if (fromLinear?.root !== root) {
    let items: TaskItem[] = []
    try {
      items = JSON.parse(await readFile(join(root, '.bridle/linear.json'), 'utf8')) as TaskItem[]
    } catch {
      // no cache yet
    }
    fromLinear = { root, items }
  }
  return fromLinear.items
}

// MARK: LinearSync over Composio

class NotConnected extends Error {}

async function linearGrant(): Promise<string | null> {
  for (const a of await connectedAccounts()) {
    const g = a.grants.find((x) => x.toolkit === 'linear' && x.ok)
    if (g) return g.id
  }
  return null
}

/** One GraphQL call through Composio; returns `data`. */
async function graphQL(query: string, variables: Record<string, unknown> = {}): Promise<{ data: Record<string, any>; grant: string }> {
  const grant = await linearGrant()
  if (!grant) throw new NotConnected('Connect Linear in Settings → Connections first.')
  const wrapper = (await execute('LINEAR_RUN_QUERY_OR_MUTATION', { query_or_mutation: query, variables }, grant)) as
    { data?: Record<string, any>; errors?: { message?: string }[] }
  const first = wrapper.errors?.[0]?.message
  if (first) throw new Error(`Linear: ${first}`)
  return { data: wrapper.data ?? {}, grant }
}

const ISSUE_FIELDS = 'id identifier title description url updatedAt state { name type } team { id name } labels { nodes { name } } project { name }'

/** Linear's state type picks the column; a started state named like "In Review" is Needs review. */
export function linearStatus(type: string, name: string): TaskStatus {
  if (type === 'completed') return 'done'
  if (type === 'started') return name.toLowerCase().includes('review') ? 'needs review' : 'in progress'
  return 'backlog'
}

export interface LinearState {
  id: string
  name: string
  type: string
  position: number
}

/** The team's state for a column: first of the matching type; Needs review prefers a started "review" state. */
export function targetState(states: LinearState[], status: TaskStatus): LinearState | undefined {
  const sorted = [...states].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const review = (s: LinearState): boolean => s.name.toLowerCase().includes('review')
  switch (status) {
    case 'backlog': return sorted.find((s) => s.type === 'unstarted') ?? sorted.find((s) => s.type === 'backlog')
    case 'in progress': return sorted.find((s) => s.type === 'started' && !review(s))
    case 'needs review': return sorted.find((s) => s.type === 'started' && review(s)) ?? sorted.find((s) => s.type === 'started')
    case 'done': return sorted.find((s) => s.type === 'completed')
  }
}

export function issueItem(n: Record<string, any>, grant: string): TaskItem | null {
  if (typeof n.id !== 'string' || typeof n.title !== 'string' || typeof n.url !== 'string' || typeof n.team?.id !== 'string') return null
  const stateName: string = n.state?.name ?? ''
  const labels: string[] = (n.labels?.nodes ?? []).map((l: { name?: string }) => l.name).filter(Boolean)
  const project: string | undefined = n.project?.name
  const updated = n.updatedAt && !isNaN(Date.parse(n.updatedAt)) ? iso(n.updatedAt) : iso()
  const linear: LinearRef = { id: n.id, identifier: n.identifier ?? '', url: n.url, teamID: n.team.id, team: n.team.name ?? '', state: stateName, grant }
  return {
    id: `linear:${n.id}`,
    title: n.title,
    notes: n.description ?? '',
    status: linearStatus(n.state?.type ?? '', stateName),
    tags: [...(project ? [project] : []), ...labels],
    updated,
    linear
  }
}

/** Your open issues, plus those finished in the last two weeks. */
async function assigned(): Promise<TaskItem[]> {
  const since = iso(Date.now() - 14 * 86400_000)
  const { data, grant } = await graphQL(`query($since: DateTimeOrDuration) { viewer { assignedIssues(first: 100, orderBy: updatedAt, filter: {
  state: { type: { nin: ["canceled", "duplicate"] } },
  or: [{ state: { type: { neq: "completed" } } }, { completedAt: { gte: $since } }]
}) { nodes { ${ISSUE_FIELDS} } } } }`, { since })
  return ((data.viewer?.assignedIssues?.nodes ?? []) as Record<string, any>[]).flatMap((n) => issueItem(n, grant) ?? [])
}

async function createIssue(title: string, notes: string): Promise<TaskItem> {
  const { data: who } = await graphQL('query { viewer { id } teams(first: 1) { nodes { id } } }')
  const me: string | undefined = who.viewer?.id
  const team: string | undefined = who.teams?.nodes?.[0]?.id
  if (!me || !team) throw new Error('Linear: no team to add the issue to')
  const { data, grant } = await graphQL(`mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { ${ISSUE_FIELDS} } } }`,
    { input: { teamId: team, title, description: notes, assigneeId: me } })
  const issue = data.issueCreate?.issue ? issueItem(data.issueCreate.issue, grant) : null
  if (!issue) throw new Error("Linear didn't return the new issue")
  return issue
}

async function moveIssue(issue: LinearRef, status: TaskStatus): Promise<void> {
  const { data } = await graphQL('query($team: String!) { team(id: $team) { states { nodes { id name type position } } } }', { team: issue.teamID })
  const target = targetState((data.team?.states?.nodes ?? []) as LinearState[], status)
  if (!target) throw new Error(`Linear: this team has no state for ${TASK_STATUSES.find((s) => s.status === status)?.title ?? status}`)
  await graphQL('mutation($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }', { id: issue.id, state: target.id })
}

// MARK: Store

async function all(): Promise<TaskItem[]> {
  return [...(await readMine()), ...(await linearItems())]
}

async function update(task: TaskItem): Promise<TaskItem> {
  const t = { ...task, updated: iso() }
  if (t.linear) {
    const items = await linearItems()
    const i = items.findIndex((x) => x.id === t.id)
    if (i >= 0) items[i] = t
  } else {
    await write(t)
  }
  return t
}

export const tasks: BridleAPI['tasks'] = {
  list: all,

  async add(title, notes = '', status = 'backlog', tags = []) {
    const task: TaskItem = { id: randomUUID().toLowerCase(), title, notes, status, tags, updated: iso() }
    await write(task)
    return task
  },

  update,

  async move(id, status) {
    const task = (await all()).find((t) => t.id === id)
    if (!task) throw new Error('No such task')
    if (task.status === status) return task
    const moved = await update({ ...task, status })
    if (!moved.linear) return moved
    try {
      await moveIssue(moved.linear, status)
    } catch (e) {
      await update(task) // snaps back
      throw e
    }
    return moved
  },

  async delete(id) {
    if (id.startsWith('linear:')) return
    await shell.trashItem(await taskFile(id))
  },

  async sendToLinear(id) {
    const task = (await readMine()).find((t) => t.id === id)
    if (!task) throw new Error('No such task')
    const issue = await createIssue(task.title, task.notes)
    await tasks.delete(id)
    ;(await linearItems()).unshift(issue)
    return issue
  },

  async syncLinear() {
    const root = await workspaceRoot()
    let issues: TaskItem[]
    try {
      issues = await assigned()
    } catch (e) {
      if (!(e instanceof NotConnected)) throw e
      issues = []
    }
    fromLinear = { root, items: issues }
    await mkdir(join(root, '.bridle'), { recursive: true })
    await writeFile(join(root, '.bridle/linear.json'), JSON.stringify(issues), 'utf8')
    return issues
  },

  async linearDetail(id) {
    const linear = (await linearItems()).find((t) => t.id === id)?.linear
    const issueID = linear?.id ?? id.replace(/^linear:/, '')
    const { data } = await graphQL(`query($id: String!) { issue(id: $id) { description priorityLabel dueDate createdAt
  project { name } cycle { name number } assignee { name } creator { name } labels { nodes { name } }
  comments(first: 50) { nodes { body createdAt user { name } } } } }`, { id: issueID })
    return linearDetail(data.issue ?? {})
  },

  run: (id) => import('../automations').then((m) => m.runTask(id)) // lazily: automations imports this file
}

export function linearDetail(i: Record<string, any>): LinearDetail {
  const when = (s: unknown): string | null => (typeof s === 'string' && !isNaN(Date.parse(s)) ? iso(s) : null)
  const comments = ((i.comments?.nodes ?? []) as Record<string, any>[])
    .map((c) => ({ author: c.user?.name ?? 'Someone', body: c.body ?? '', date: when(c.createdAt) ?? iso() }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const priority: string | null = i.priorityLabel ?? null
  return {
    description: i.description ?? '',
    priority: priority === 'No priority' ? null : priority,
    assignee: i.assignee?.name ?? null,
    creator: i.creator?.name ?? null,
    project: i.project?.name ?? null,
    cycle: i.cycle ? (i.cycle.name ?? `Cycle ${i.cycle.number ?? 0}`) : null,
    due: i.dueDate ?? null,
    created: when(i.createdAt),
    labels: ((i.labels?.nodes ?? []) as { name?: string }[]).flatMap((l) => (l.name ? [l.name] : [])),
    comments
  }
}
