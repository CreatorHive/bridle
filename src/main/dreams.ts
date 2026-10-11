import { copyFile, mkdir, readdir, readFile, stat, writeFile, appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { powerMonitor } from 'electron'
import { agent, unattended } from './services/agent'
import { promptText } from './services/prompts'
import { iso } from './services/util'
import { workspaceRoot } from './services/workspace'

// Dreaming (after OpenClaw's): once a day after 3 AM, while you're away from the Mac, the agent reads the daily logs
// written since the last pass and folds what lasts into MEMORY.md and USER.md. Both are copied to dreams/backup/<day>/
// first, and a pass that drops more than a quarter of either file's lines is undone. Its notes: dreams/<day>.md.

const FILES = ['MEMORY.md', 'USER.md']

const lines = (s: string): number => s.split('\n').filter((l) => l.trim()).length

/** The pass threw away too much of a file. */
export const lost = (before: string, after: string): boolean => lines(after) < lines(before) * 0.75

/** Local "2026-10-10". */
const localDay = (d: Date): string => d.toLocaleDateString('en-CA')

/** The steps are prompts/dreams.md. */
export async function dreamPrompt(logs: string[], day: string): Promise<string> {
  return `Memory upkeep, not from the user. Read these daily logs: ${logs.join(', ')}. Then:
${await promptText('dreams', { day })}
Then reply NO_REPLY.`
}

const ID = 'dreams'
let dreaming = false

async function tick(now = new Date()): Promise<void> {
  const day = localDay(now)
  if (dreaming || now.getHours() < 3) return
  // Away from the Mac for 10 minutes, or still before 7 AM: it doesn't compete with you.
  if (now.getHours() >= 7 && powerMonitor.getSystemIdleTime() < 600) return
  const root = await workspaceRoot()
  const stateFile = join(root, '.bridle', 'dreams.json')
  const last = (JSON.parse(await readFile(stateFile, 'utf8').catch(() => '{}')) as { lastRun?: string }).lastRun
  if (last && localDay(new Date(last)) === day) return
  dreaming = true
  try {
    await mkdir(dirname(stateFile), { recursive: true })
    await writeFile(stateFile, JSON.stringify({ lastRun: iso(now) }))
    // The logs written since the last pass (the last week the first time).
    const since = last ? new Date(last).getTime() : now.getTime() - 7 * 86400_000
    const logs: string[] = []
    for (const name of (await readdir(join(root, 'memory')).catch(() => [] as string[])).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}.*\.md$/.test(name)) continue
      const s = await stat(join(root, 'memory', name)).catch(() => null)
      if (s && s.mtimeMs > since && lines(await readFile(join(root, 'memory', name), 'utf8')) > 1) logs.push(`memory/${name}`)
    }
    if (!logs.length) return // nothing new, nothing spent

    const backup = join(root, 'dreams', 'backup', day)
    await mkdir(backup, { recursive: true })
    const before: Record<string, string> = {}
    for (const f of FILES) {
      before[f] = await readFile(join(root, f), 'utf8').catch(() => '')
      if (before[f]) await copyFile(join(root, f), join(backup, f))
    }
    const stop = setTimeout(() => void agent.cancel(ID), 15 * 60_000)
    await unattended(ID, await dreamPrompt(logs, day)).finally(() => clearTimeout(stop))
    for (const f of FILES) {
      const after = await readFile(join(root, f), 'utf8').catch(() => '')
      if (!before[f] || !lost(before[f], after)) continue
      await writeFile(join(root, f), before[f])
      await appendFile(join(root, 'dreams', `${day}.md`), `\n- Undone: the pass cut ${f} from ${lines(before[f])} lines to ${lines(after)}; the earlier copy is back.\n`)
    }
  } catch (e) {
    console.warn('[dreams]', e)
  } finally {
    dreaming = false
  }
}

export function startDreams(): void {
  setInterval(() => void tick(), 10 * 60_000)
}
