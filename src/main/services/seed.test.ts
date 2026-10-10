import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

// Agent files live at the workspace root and are read each turn, on a temp workspace only.
vi.mock('electron', () => ({ app: {}, shell: {}, dialog: {}, nativeImage: {}, BrowserWindow: { getAllWindows: () => [] } }))

const { seedWorkspace } = await import('./seed')
const { BOOT_FILES, bootstrap } = await import('./agent')

let ws = ''
afterEach(() => rmSync(ws, { recursive: true, force: true }))

it('moves agent/ files to the root without overwriting, and reads them each turn', async () => {
  ws = mkdtempSync(join(tmpdir(), 'bridle-seed-'))
  mkdirSync(join(ws, 'agent'))
  writeFileSync(join(ws, 'agent/USER.md'), '# User\n\n- Loves tea\n')
  writeFileSync(join(ws, 'SOUL.md'), '# Soul\n\nMine.\n')

  await seedWorkspace(ws, { agent: 'Zephyr', user: 'Sean' })
  expect(existsSync(join(ws, 'agent/USER.md'))).toBe(false)
  expect(readFileSync(join(ws, 'USER.md'), 'utf8')).toContain('Loves tea')
  expect(readFileSync(join(ws, 'SOUL.md'), 'utf8')).toBe('# Soul\n\nMine.\n')
  expect(readFileSync(join(ws, 'IDENTITY.md'), 'utf8')).toContain('- Name: Zephyr')
  for (const file of BOOT_FILES) expect(existsSync(join(ws, file)), file).toBe(true)
  expect(existsSync(join(ws, 'user/media_library/image'))).toBe(true)

  const today = new Date().toISOString().slice(0, 10)
  writeFileSync(join(ws, `memory/${today}.md`), '- Prefers mornings\n')
  const boot = bootstrap(ws)
  expect(boot).toContain('<file path="USER.md">')
  expect(boot).toContain('Loves tea')
  expect(boot).toContain(`memory/${today}.md`)
  expect(boot).toContain('Prefers mornings')
  expect(boot).toContain('<file path="AGENTS.md">')
})
