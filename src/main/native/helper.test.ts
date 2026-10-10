import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, BrowserWindow: { getAllWindows: () => [] } }))
const { Helper, NOT_BUILT, helperPath } = await import('./helper')

// A fake bridle-helper in Node: answers out of order, fails "boom", streams dictation events, exits on "die",
// and never answers "hang".
const dir = mkdtempSync(join(tmpdir(), 'bridle-helper-'))
const fake = join(dir, 'fake.js')
writeFileSync(fake, `
const rl = require('readline').createInterface({ input: process.stdin })
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
rl.on('line', (line) => {
  const r = JSON.parse(line)
  if (r.cmd === 'ping') setTimeout(() => send({ id: r.id, ok: { version: 1, pid: process.pid } }), 30)
  else if (r.cmd === 'embed') send({ id: r.id, ok: { dimension: 2, vectors: r.texts.map(() => [0.6, 0.8]) } })
  else if (r.cmd === 'boom') send({ id: r.id, error: 'it broke' })
  else if (r.cmd === 'dictate') {
    send({ event: 'dictation', text: 'hel', final: false })
    send({ event: 'dictation', text: 'hello', final: true })
    send({ id: r.id, ok: {} })
  } else if (r.cmd === 'die') process.exit(3)
})
`)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const make = () => new Helper(() => ({ command: process.execPath, args: [fake] }))

describe('Helper (JSON lines client)', () => {
  it('matches answers to requests by id, out of order', async () => {
    const h = make()
    const [ping, embed] = await Promise.all([
      h.request<{ version: number }>('ping'),
      h.request<{ vectors: number[][] }>('embed', { texts: ['a', 'b'] })
    ])
    expect(ping.version).toBe(1)
    expect(embed.vectors).toEqual([[0.6, 0.8], [0.6, 0.8]])
    h.stop()
  })

  it('rejects with the helper error, and keeps going', async () => {
    const h = make()
    await expect(h.request('boom')).rejects.toThrow('it broke')
    await expect(h.request('ping')).resolves.toMatchObject({ version: 1 })
    h.stop()
  })

  it('streams events before the answer', async () => {
    const h = make()
    const seen: unknown[] = []
    const off = h.onEvent((e) => seen.push(e))
    await h.request('dictate', { action: 'start' })
    expect(seen).toEqual([
      { event: 'dictation', text: 'hel', final: false },
      { event: 'dictation', text: 'hello', final: true }
    ])
    off()
    h.stop()
  })

  it('times out a call that gets no answer', async () => {
    const h = make()
    await expect(h.request('hang', {}, 0.1)).rejects.toThrow('hang timed out')
    h.stop()
  })

  it('fails pending calls when the helper quits, then starts a new one', async () => {
    const h = make()
    const first = await h.request<{ pid: number }>('ping')
    const exits: unknown[] = []
    h.onEvent((e) => exits.push(e))
    await expect(h.request('die')).rejects.toThrow('bridle-helper quit (code 3)')
    expect(exits).toEqual([{ event: 'exit', why: 'quit (code 3)' }])
    const second = await h.request<{ pid: number }>('ping')
    expect(second.pid).not.toBe(first.pid)
    h.stop()
  })
})

describe('without the helper', () => {
  it('rejects every call with how to build it', async () => {
    const h = new Helper(() => null)
    expect(h.available()).toBe(false)
    await expect(h.request('ping')).rejects.toThrow(NOT_BUILT)
  })

  it('reports a binary that fails to start', async () => {
    const h = new Helper(() => ({ command: join(dir, 'missing-binary') }))
    await expect(h.request('ping')).rejects.toThrow(/failed to start/)
  })

  it('finds no binary outside Electron', () => {
    expect(helperPath()).toBeNull()
  })

  it('degrades: thumbnails are null, dictation explains, images throw for a later retry', async () => {
    const { native, nativeText } = await import('./index')
    await expect(native.thumbnail('/x.pdf', 64)).resolves.toBeNull()
    await expect(native.dictate('start')).rejects.toThrow(NOT_BUILT)
    await expect(nativeText('/x.png')).rejects.toThrow(NOT_BUILT)
  })
})

// The real Swift helper, when `npm run build:native` has run: 512-dimension unit vectors.
const real = join(__dirname, '../../../native/BridleHelper/.build/release/bridle-helper')
describe.skipIf(!existsSync(real))('bridle-helper (built)', () => {
  it('embeds texts as 512-d unit vectors', async () => {
    const h = new Helper(() => ({ command: real }))
    const r = await h.request<{ dimension: number; vectors: number[][] }>('embed', { texts: ['tax summary', 'banana bread'] })
    expect(r.dimension).toBe(512)
    expect(Math.hypot(...r.vectors[0])).toBeCloseTo(1, 4)
    h.stop()
  }, 60_000)
})
