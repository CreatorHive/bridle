import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dialog, nativeImage } from 'electron'
import type { BridleAPI } from '../../shared/api'
import type { MemorySource } from '../../shared/types'
import { iso } from './util'
import { workspaceRoot } from './workspace'

// Settings → Agent: memory import and the agent's picture.

export const MEMORY_FILES = ['USER.md', 'MEMORY.md'] as const

export function memoryPrompt(source: MemorySource): string {
  const ask = source === 'ChatGPT'
    ? "I'm moving my assistant to a new app called Bridle and want to bring what you know about me. Use your saved memories and anything else you remember about me from our chats."
    : "I'm moving to an assistant app called Bridle and want to bring my memory. Read what Claude Code knows about me: ~/.claude/CLAUDE.md, ~/.claude/rules/, and the memory files in ~/.claude/projects/*/memory/ (each MEMORY.md and the files it links to). Don't change any files. Skip instructions that only matter inside one codebase."
  return ask + `

Write it all out in exactly this format, inside one code block:

=== USER.md ===
- Who I am: name, work, where I'm based, the important people, projects and places in my life
- How I like to be helped: tone, length, formatting, things I dislike

=== MEMORY.md ===
- Lasting facts: ongoing projects and where they stand, decisions I've made, tools and accounts I use, routines, upcoming plans

One fact per bullet, in plain words. Only include what you actually know; don't guess. Leave out passwords, account numbers and anything else sensitive.`
}

/** The answer split into its files. Code fences are dropped; an answer without any `=== FILE ===` markers
 *  goes to MEMORY.md whole. */
export function memorySections(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  let current: string | null = null
  let loose = ''
  for (const line of text.split(/\r\n|\r|\n/)) {
    const t = line.trim()
    if (t.startsWith('```')) continue
    const file = t.startsWith('===') ? MEMORY_FILES.find((f) => t.toLowerCase().includes(f.toLowerCase())) : undefined
    if (file) {
      current = file
      continue
    }
    if (current) out[current] = (out[current] ?? '') + line + '\n'
    else loose += line + '\n'
  }
  if (Object.keys(out).length === 0) out['MEMORY.md'] = loose
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v))
}

/** Appends each section to <root>/<file> under "## Imported from <source> · <yyyy-MM-dd>"; returns the files added to.
 *  A missing file starts as "# User" / "# Memory". */
export async function applyMemory(root: string, text: string, source: MemorySource, date = new Date()): Promise<string[]> {
  const stamp = iso(date).slice(0, 10)
  const found = memorySections(text)
  const added: string[] = []
  for (const file of MEMORY_FILES) {
    const body = found[file]
    if (!body) continue
    const path = join(root, file)
    const name = file.slice(0, -3)
    const existing = await readFile(path, 'utf8').catch(() => `# ${name[0]}${name.slice(1).toLowerCase()}\n`)
    try {
      await writeFile(`${path}.tmp`, `${existing.trim()}\n\n## Imported from ${source} · ${stamp}\n\n${body}\n`, 'utf8')
      await rename(`${path}.tmp`, path)
      added.push(file)
    } catch {
      // a file that can't be written isn't reported
    }
  }
  return added
}

export const memory: BridleAPI['memory'] = {
  prompt: async (source) => memoryPrompt(source),
  apply: async (text, source) => applyMemory(await workspaceRoot(), text, source)
}

// MARK: The agent's picture

const pictureFile = async (): Promise<string> => join(await workspaceRoot(), 'agent', 'avatar.png')

export const avatar: BridleAPI['avatar'] = {
  async get() {
    const png = await readFile(await pictureFile()).catch(() => null)
    return png ? `data:image/png;base64,${png.toString('base64')}` : null
  },

  /** Center-cropped to a square and scaled to 512px, so a big photo doesn't land in the workspace as-is. */
  async choose() {
    const r = await dialog.showOpenDialog({
      buttonLabel: 'Choose', properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'heic', 'gif', 'webp', 'tiff', 'bmp'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const image = nativeImage.createFromPath(r.filePaths[0])
    const { width, height } = image.getSize()
    if (image.isEmpty() || !width || !height) return null
    const side = Math.min(width, height)
    const png = image
      .crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
      .resize({ width: 512, height: 512, quality: 'best' })
      .toPNG()
    const file = await pictureFile()
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(`${file}.tmp`, png)
    await rename(`${file}.tmp`, file)
    return `data:image/png;base64,${png.toString('base64')}`
  },

  async remove() {
    await rm(await pictureFile(), { force: true })
  }
}
