// A small markdown parser for agent replies and notes: headings, bullet and numbered lists,
// fenced code, quotes, rules, paragraphs; inline bold, italic, code, links and bare URLs.
// Parses to plain data; Markdown.tsx renders it as React elements (never as raw HTML).
// ponytail: no tables, images or nested-list structure (indented items flatten into their list);
// swap in a real parser if replies start needing them.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'bold' | 'italic'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] }

export type Block =
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; children: Inline[] }
  | { type: 'rule' }

const FENCE = /^\s*```\s*(\S*)/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const ITEM = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || ITEM.test(line) || QUOTE.test(line)
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = line.match(FENCE)
    if (fence) {
      const body: string[] = []
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i])
      i++ // the closing fence, if it has arrived yet
      out.push({ type: 'code', lang: fence[1], text: body.join('\n') })
      continue
    }
    const heading = line.match(HEADING)
    if (heading) {
      out.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) })
      i++
      continue
    }
    if (RULE.test(line)) {
      out.push({ type: 'rule' })
      i++
      continue
    }
    const first = line.match(ITEM)
    if (first) {
      const ordered = first[1] !== undefined
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(ITEM)
        if (m && (m[1] !== undefined) === ordered) items.push(m[2])
        else if (lines[i].trim() && !startsBlock(lines[i]) && items.length) items[items.length - 1] += ' ' + lines[i].trim()
        else break
        i++
      }
      out.push({ type: 'list', ordered, start: ordered ? Number(first[1]) : 1, items: items.map(parseInline) })
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      for (; i < lines.length && QUOTE.test(lines[i]); i++) body.push(lines[i].match(QUOTE)![1])
      out.push({ type: 'quote', children: parseInline(body.join('\n')) })
      continue
    }
    const body: string[] = []
    for (; i < lines.length && lines[i].trim() && (body.length === 0 || !startsBlock(lines[i])); i++) body.push(lines[i])
    out.push({ type: 'paragraph', children: parseInline(body.join('\n')) })
  }
  return out
}

// In priority order: code, bold, link, italic, bare URL.
const INLINE =
  /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\[([^\]]+)\]\(([^)\s]+)\)|\*(?!\s)(.+?)\*|(?<!\w)_(?!\s)(.+?)_(?!\w)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/gs

/** Only web and mail links become clickable; anything else stays text. */
export function safeHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href) ? href : null
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    const [, code, bold1, bold2, linkText, linkHref, italic1, italic2, url] = m
    if (code !== undefined) out.push({ type: 'code', text: code })
    else if (bold1 ?? bold2) out.push({ type: 'bold', children: parseInline(bold1 ?? bold2) })
    else if (linkText !== undefined) {
      const href = safeHref(linkHref)
      out.push(href ? { type: 'link', href, children: parseInline(linkText) } : { type: 'text', text: linkText })
    } else if (italic1 ?? italic2) out.push({ type: 'italic', children: parseInline(italic1 ?? italic2) })
    else out.push({ type: 'link', href: url, children: [{ type: 'text', text: url }] })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}
