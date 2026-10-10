import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The index on temp dirs only; never the real workspace.
vi.mock('electron', () => ({ app: {}, shell: {}, dialog: {}, nativeImage: {}, BrowserWindow: { getAllWindows: () => [] } }))

const { chunks, chatText, files, ftsQuery, fuse, isChat, ProjectIndex, SKIP_DIRS, WORKSPACE_TAG } = await import('./index')
type Embedder = import('./index').Embedder

const temps: string[] = []
const temp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'bridle-index-'))
  temps.push(d)
  return d
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('chunks', () => {
  it('keeps short text as one passage starting at line 1, and drops blank text', () => {
    expect(chunks('a\nb')).toEqual([{ line: 1, text: 'a\nb' }])
    expect(chunks('\n  \n')).toEqual([])
  })

  it('splits about every 1,500 characters on line boundaries, overlapping about 300', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${String(i).padStart(3, '0')} ${'x'.repeat(90)}`) // 100 chars each
    const out = chunks(lines.join('\n'))
    expect(out.length).toBeGreaterThan(5)
    expect(out[0].line).toBe(1)
    expect(out[0].text.split('\n')).toHaveLength(15) // 15 × 101 ≥ 1500
    // The next passage starts 3 lines back (3 × 101 ≥ 300).
    expect(out[1].line).toBe(13)
    expect(out[1].text.startsWith('line 012')).toBe(true)
    expect(out.at(-1)!.text.endsWith('line 099 ' + 'x'.repeat(90))).toBe(true)
  })

  it('caps one huge line at 4,000 characters', () => {
    expect(chunks('y'.repeat(10_000))[0].text).toHaveLength(4000)
  })
})

describe('ftsQuery (FTS escaping)', () => {
  it('quotes words over two characters and ORs them', () => {
    expect(ftsQuery('Launch the Bridle v0.1 plan')).toBe('"launch" OR "the" OR "bridle" OR "plan"')
  })

  it('never lets FTS syntax through', () => {
    expect(ftsQuery('"quoted" AND NOT foo* (bar) col:baz ^qux')).toBe('"quoted" OR "and" OR "not" OR "foo" OR "bar" OR "col" OR "baz" OR "qux"')
    expect(ftsQuery('a b " * :')).toBeNull()
    expect(ftsQuery('café 東京大学')).toBe('"café" OR "東京大学"')
  })
})

describe('fuse (reciprocal rank fusion)', () => {
  it('adds weight / (60 + rank) across lists', () => {
    // 1: 1/60 + 0.5/61; 2: 1/61 + 0.5/60; 3: 0.5/62
    expect(fuse([{ ids: [1, 2], weight: 1 }, { ids: [2, 1, 3], weight: 0.5 }], 10)).toEqual([1, 2, 3])
    // Meaning alone can't beat a word match at the same rank.
    expect(fuse([{ ids: [7], weight: 1 }, { ids: [8], weight: 0.5 }], 10)).toEqual([7, 8])
    expect(fuse([{ ids: [1, 2, 3], weight: 1 }], 2)).toEqual([1, 2])
    expect(fuse([], 5)).toEqual([])
  })
})

describe('chats', () => {
  it('reads a chat as what was said', () => {
    const jsonl = [
      '{"id":"E5CD3195-118D-455B-B5AA-02543553417B","title":"Launch plan"}',
      '{"content":"when do we ship?","role":"user","turn_id":"A"}',
      '{"content":"Friday.","role":"assistant","turn_id":"B"}',
      '{"content":"","role":"tool","turn_id":"C"}',
      'not json'
    ].join('\n')
    expect(chatText(jsonl)).toBe('# Launch plan\nYou: when do we ship?\nAgent: Friday.')
    expect(isChat('/w/chats/e5cd.jsonl')).toBe(true)
    expect(isChat('/w/goals/x/chats/e5cd.jsonl')).toBe(true)
    expect(isChat('/w/notes/e5cd.jsonl')).toBe(false)
  })
})

describe('ProjectIndex', () => {
  /** A toy embedder: one dimension per known word, counting calls. */
  const vocab = ['cat', 'dog', 'kitten', 'puppy', 'invoice']
  const toy = (): Embedder & { calls: number } => {
    const e = {
      id: 'toy',
      calls: 0,
      async embed(texts: string[]) {
        e.calls++
        return texts.map((t) => {
          const v = Float32Array.from(vocab, (w) => (t.toLowerCase().includes(w) ? 1 : 0))
          if (t.toLowerCase().includes('kitten')) v[0] = 1 // kittens mean cats
          const n = Math.hypot(...v) || 1
          return v.map((x) => x / n)
        })
      }
    }
    return e
  }

  it('walks files, skipping hidden, dependency and lock files', async () => {
    const root = temp()
    mkdirSync(join(root, 'node_modules/x'), { recursive: true })
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, 'notes'))
    writeFileSync(join(root, 'node_modules/x/a.md'), 'no')
    writeFileSync(join(root, '.git/HEAD'), 'no')
    writeFileSync(join(root, 'package-lock.json'), '{}')
    writeFileSync(join(root, 'app.min.js'), 'no')
    writeFileSync(join(root, '.hidden.md'), 'no')
    writeFileSync(join(root, 'notes/a.md'), 'yes')
    expect((await files(root, SKIP_DIRS)).map((f) => f.path)).toEqual([join(root, 'notes/a.md')])
  })

  it('finds exact words, and refreshes only what changed', async () => {
    const root = temp()
    const db = join(temp(), 'index.sqlite')
    mkdirSync(join(root, 'notes'))
    mkdirSync(join(root, 'chats'))
    writeFileSync(join(root, 'notes/plan.md'), '# Plan\n\nShip the invoice exporter on Friday.')
    writeFileSync(join(root, 'notes/other.md'), 'Groceries: milk.')
    writeFileSync(join(root, 'code.ts'), 'export function invoiceTotal() {}')
    writeFileSync(join(root, 'blob.bin'), Buffer.from([1, 0, 2, 0]))
    writeFileSync(join(root, 'chats/e5cd3195-118d-455b-b5aa-02543553417b.jsonl'),
      '{"id":"E5CD3195-118D-455B-B5AA-02543553417B","title":"Billing"}\n{"content":"invoice question","role":"user"}\n')
    const embedder = toy()
    const index = new ProjectIndex(db, embedder)
    const skip = new Set([...SKIP_DIRS].filter((d) => d !== 'chats'))

    await index.refresh(WORKSPACE_TAG, [root], skip)
    expect(index.counts(WORKSPACE_TAG)).toEqual({ files: 5, passages: 4 }) // blob.bin has no text
    const hits = await index.search(WORKSPACE_TAG, 'invoice')
    // Word matches first; meaning (the top 30 vectors with no floor) only trails behind.
    expect(hits.slice(0, 2).map((h) => h.path).sort()).toEqual([join(root, 'chats/e5cd3195-118d-455b-b5aa-02543553417b.jsonl'), join(root, 'notes/plan.md')].sort())
    expect(hits.find((h) => h.path.endsWith('plan.md'))).toMatchObject({ line: 1 })
    expect((await index.search(WORKSPACE_TAG, 'invoiceTotal'))[0].path).toBe(join(root, 'code.ts')) // code: words only
    expect(await index.search('other-tag', 'invoice')).toEqual([])

    // Nothing changed: nothing is read or embedded again.
    const calls = embedder.calls
    await index.refresh(WORKSPACE_TAG, [root], skip)
    expect(embedder.calls).toBe(calls)

    // A changed file is re-read; a deleted one disappears.
    writeFileSync(join(root, 'notes/plan.md'), 'Moved to Monday.')
    utimesSync(join(root, 'notes/plan.md'), new Date(), new Date(Date.now() + 5000))
    rmSync(join(root, 'notes/other.md'))
    await index.refresh(WORKSPACE_TAG, [root], skip)
    expect(embedder.calls).toBe(calls + 1)
    expect((await index.search(WORKSPACE_TAG, 'monday'))[0].path).toBe(join(root, 'notes/plan.md'))
    expect((await index.search(WORKSPACE_TAG, 'groceries')).some((h) => h.path.endsWith('other.md'))).toBe(false)
    expect(index.counts(WORKSPACE_TAG).files).toBe(4)
    index.close()

    // Persisted: a new connection sees the same passages.
    const again = new ProjectIndex(db, embedder)
    expect(index === again).toBe(false)
    expect((await again.search(WORKSPACE_TAG, 'monday'))[0].path).toBe(join(root, 'notes/plan.md'))
    again.close()
  })

  it('finds meaning when no word matches, and falls back to words when the embedder fails', async () => {
    const root = temp()
    writeFileSync(join(root, 'pets.md'), 'We adopted a cat last spring.')
    writeFileSync(join(root, 'work.md'), 'Quarterly numbers are due.')
    const index = new ProjectIndex(join(temp(), 'i.sqlite'), toy())
    await index.refresh('p', [root])
    expect((await index.search('p', 'kitten'))[0].path).toBe(join(root, 'pets.md'))
    index.close()

    const broken: Embedder = { id: 'broken', embed: () => Promise.reject(new Error('down')) }
    const words = new ProjectIndex(join(temp(), 'j.sqlite'), broken)
    await words.refresh('p', [root])
    expect((await words.search('p', 'quarterly')).map((h) => h.path)).toEqual([join(root, 'work.md')])
    expect(await words.search('p', 'kitten')).toEqual([])
    words.close()
  })

  it('rebuilds when the embedder changes', async () => {
    const root = temp()
    writeFileSync(join(root, 'a.md'), 'cat')
    const db = join(temp(), 'i.sqlite')
    const index = new ProjectIndex(db, null)
    await index.refresh('p', [root])
    expect(index.counts('p').files).toBe(1)
    index.useEmbedder(toy())
    expect(index.counts('p')).toEqual({ files: 0, passages: 0 })
    index.close()
  })
})
