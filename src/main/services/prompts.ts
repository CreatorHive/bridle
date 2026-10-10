import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { frontMatter } from '../automations'
import { workspaceRoot } from './workspace'

// prompts/<name>.md: the instructions of the agent's own jobs, as files the user and the agent can edit. Code keeps the
// framing, the data and the safety lines; the file says what to write and how. A missing or empty file uses the built-in.

export const PROMPTS = {
  briefing: `Short and warm, under 120 words, in this shape:
One sentence on how the day looks.
**Today**, then one line per event: "- 10:00 Title, with Name". Skip this part if there are none.
**Needs you**, then up to 3 lines, each naming who or what and why now. Only things they must act on; skip FYI, newsletters and notices.
End with one question offering the first concrete step you can take for them.
No URLs.`,
  'meeting-prep': `Under 90 words, in this shape:
**Prep: {{title}}** · {{when}} · with {{people}}
Then 2 to 4 bullets: what it's about (from the invite), anything recent with these people (from the emails), and one thing to raise or decide if the data suggests one.
End with one short question offering help, like drafting talking points.
No URLs.`,
  dreams: `- Fold what lasts into MEMORY.md (facts, decisions, where projects stand) and USER.md (who the user is and how they like to be helped). Merge with what's there, and replace what's outdated instead of adding a contradiction. Leave out what only mattered that day.
- Keep both files short and true, and don't drop entries that are still true. Don't edit the logs.
- Write dreams/{{day}}.md: a short list of what you added, changed or removed, and why.`
}

export type PromptName = keyof typeof PROMPTS

/** prompts/<name>.md, or the built-in; {{key}} filled in from `vars`. */
export async function promptText(name: PromptName, vars: Record<string, string> = {}): Promise<string> {
  const own = (await readFile(join(await workspaceRoot(), 'prompts', `${name}.md`), 'utf8').catch(() => '')).trim()
  return (own || PROMPTS[name]).replace(/\{\{(\w+)\}\}/g, (m, key: string) => vars[key] ?? m)
}

/** agents/<name>.md → the Claude CLI's --agents: front matter `description` (needed), `tools` (comma-separated),
 *  `model`; the body is the worker's prompt. */
export function workerDefinitions(files: Record<string, string>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [file, md] of Object.entries(files)) {
    const name = file.replace(/\.md$/, '')
    const { fields, body } = frontMatter(md)
    if (!/^[\w-]+$/.test(name) || !fields.description || !body.trim()) continue
    out[name] = {
      description: fields.description,
      prompt: body.trim(),
      ...(fields.tools ? { tools: fields.tools.split(',').map((t) => t.trim()).filter(Boolean) } : {}),
      ...(fields.model ? { model: fields.model } : {})
    }
  }
  return out
}

export async function workers(root: string): Promise<Record<string, Record<string, unknown>>> {
  const dir = join(root, 'agents')
  const files: Record<string, string> = {}
  for (const n of (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.md'))) {
    files[n] = await readFile(join(dir, n), 'utf8').catch(() => '')
  }
  return workerDefinitions(files)
}
