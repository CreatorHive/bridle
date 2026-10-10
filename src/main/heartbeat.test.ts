import { expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { on: () => {} }, shell: {}, dialog: {}, nativeImage: {}, powerMonitor: { on: () => {} }, BrowserWindow: { getAllWindows: () => [] } }))

const { beat, inHours, silent } = await import('./heartbeat')

it('reads its settings and checklist from HEARTBEAT.md', () => {
  const b = beat('---\nevery: 2h\nhours: 22:00-02:00\n---\n# Heartbeat\n\nRubric.\n\n## Check each time\n- Log\n* Tasks\n\n## Notes\n- not this\n')
  expect(b).toEqual({ every: 2 * 3600_000, hours: [22 * 60, 2 * 60], enabled: true, checklist: ['- Log', '* Tasks'] })
  expect(beat('# Heartbeat\n\nNo list.\n')).toMatchObject({ every: 30 * 60_000, hours: [480, 1260], checklist: [] })
  expect(beat('---\nenabled: off\n---\n## Checks\n- x\n').enabled).toBe(false)
})

it('runs only in active hours, wrapping past midnight', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 10, h, m)
  expect(inHours([480, 1260], at(8))).toBe(true)
  expect(inHours([480, 1260], at(21))).toBe(false)
  expect(inHours([1320, 120], at(23, 30))).toBe(true)
  expect(inHours([1320, 120], at(1))).toBe(true)
  expect(inHours([1320, 120], at(12))).toBe(false)
})

it('stays quiet on NO_REPLY at either end of a short reply', () => {
  expect(silent(' NO_REPLY\n')).toBe(true)
  expect(silent('Nothing new. NO_REPLY')).toBe(true)
  expect(silent('')).toBe(true)
  expect(silent('Ana is waiting on the contract; want me to draft a reply?')).toBe(false)
  expect(silent('x'.repeat(301) + ' NO_REPLY')).toBe(false)
})

it('dreaming: undoes a pass that drops over a quarter of a file', async () => {
  const { lost } = await import('./dreams')
  const four = '# Memory\n\n- a\n- b\n- c\n'
  expect(lost(four, '# Memory\n- a\n- b\n- c (merged)\n')).toBe(false)
  expect(lost(four, '# Memory\n- a\n')).toBe(true)
})

it('reads workers from agents/<name>.md, skipping ones without a description or prompt', async () => {
  const { workerDefinitions } = await import('./services/prompts')
  expect(workerDefinitions({
    'researcher.md': '---\ndescription: Looks things up\ntools: Read, WebSearch\nmodel: haiku\n---\nYou research.\n',
    'plain.md': '---\ndescription: Writes\n---\nYou write.',
    'nodesc.md': 'Just a prompt',
    'bad name.md': '---\ndescription: x\n---\ny'
  })).toEqual({
    researcher: { description: 'Looks things up', prompt: 'You research.', tools: ['Read', 'WebSearch'], model: 'haiku' },
    plain: { description: 'Writes', prompt: 'You write.' }
  })
})
