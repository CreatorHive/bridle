import { describe, expect, it } from 'vitest'
import { parseBlocks, parseInline } from './parseMarkdown'

describe('markdown', () => {
  it('parses blocks', () => {
    const blocks = parseBlocks('# Title\n\nSome **bold** text\nnext line\n\n- one\n- two\n\n1. a\n2. b\n\n```ts\nconst x = 1\n```\n> quoted\n\n---')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'code', 'quote', 'rule'])
    expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ text: 'one' }], [{ text: 'two' }]] })
    expect(blocks[3]).toMatchObject({ ordered: true, start: 1 })
    expect(blocks[4]).toEqual({ type: 'code', lang: 'ts', text: 'const x = 1' })
  })

  it('parses inline marks and links', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.dev) snake_case_name')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'italic', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://x.dev', children: [{ type: 'text', text: 'e' }] },
      { type: 'text', text: ' snake_case_name' }
    ])
  })

  it('keeps unsafe links as text and autolinks bare URLs', () => {
    expect(parseInline('[x](javascript:alert(1))')[0]).toEqual({ type: 'text', text: 'x' })
    expect(parseInline('see https://github.com/a/b.')[1]).toMatchObject({ type: 'link', href: 'https://github.com/a/b' })
  })

  it('tolerates a fence still streaming', () => {
    expect(parseBlocks('```\npartial')).toEqual([{ type: 'code', lang: '', text: 'partial' }])
  })
})
