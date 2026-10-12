import { createElement, Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { reducedMotion } from './motion'
import { useLayoutEffectInBrowser } from './Presence'
import { parseBlocks, type Block, type Inline } from './parseMarkdown'
import { charKeyframes, FADE, graphemeCount, graphemes, pace, renderedCount, settled } from './stream'

/** Rendered characters from `from` on fade in, each starting at `at(k)` (ms, document time). */
interface Reveal { from: number; at: (k: number) => number }

/** Renders blocks, numbering drawn characters in reading order so a reveal can pick them out. */
function renderBlocks(blocks: Block[], reveal?: Reveal): ReactNode[] {
  let k = 0
  const text = (s: string, key: number): ReactNode => {
    const start = k
    k += graphemeCount(s)
    if (!reveal || k <= reveal.from) return s
    const parts = graphemes(s)
    const cut = Math.max(0, reveal.from - start)
    return (
      <Fragment key={key}>
        {parts.slice(0, cut).join('')}
        {parts.slice(cut).map((c, j) => {
          const n = start + cut + j
          return <span key={n} className="b-char" data-at={reveal.at(n)}>{c}</span>
        })}
      </Fragment>
    )
  }
  const inline = (nodes: Inline[]): ReactNode[] => nodes.map((n, i) => {
    switch (n.type) {
      case 'text': return text(n.text, i)
      case 'code': return <code key={i}>{text(n.text, 0)}</code>
      case 'bold': return <strong key={i}>{inline(n.children)}</strong>
      case 'italic': return <em key={i}>{inline(n.children)}</em>
      case 'link':
        return (
          <a
            key={i}
            href={n.href}
            onClick={(e) => {
              e.preventDefault()
              void window.bridle.shell.openExternal(n.href)
            }}
          >
            {inline(n.children)}
          </a>
        )
    }
  })
  return blocks.map((b, i) => {
    switch (b.type) {
      case 'heading': return createElement(`h${b.level}`, { key: i }, inline(b.children))
      case 'paragraph': return <p key={i}>{inline(b.children)}</p>
      case 'list': {
        const items = b.items.map((it, j) => <li key={j}>{inline(it)}</li>)
        return b.ordered ? <ol key={i} start={b.start}>{items}</ol> : <ul key={i}>{items}</ul>
      }
      case 'code': return <pre key={i}><code>{text(b.text, 0)}</code></pre>
      case 'quote': return <blockquote key={i}>{inline(b.children)}</blockquote>
      case 'rule': return <hr key={i} />
    }
  })
}

/** Renders markdown as React elements: headings, lists, code, quotes, bold, italic, links (opened in the browser). */
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return <div className={`b-markdown ${className}`}>{renderBlocks(parseBlocks(text))}</div>
}

const animated = new WeakSet<Element>()

/** Markdown whose new characters fade in as the text grows, at the rate the text arrives
 *  (≥ 90/s; never more than half a second behind), each from a soft violet through pink into
 *  the text color over 0.9 s. Text present on mount shows at once unless `fromStart` (a reply that is
 *  still arriving, whose first chunk should fade in too). Settled characters fold back into plain text
 *  nodes, so only the ~80 characters mid-fade are spans. Reduced motion: plain Markdown. */
export function StreamingMarkdown({ text, fromStart = false, className = '' }: { text: string; fromStart?: boolean; className?: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text])
  const total = renderedCount(blocks)
  const clock = useRef<{ baseline: number; arrivals: number[]; chunk: number | null } | null>(null)
  clock.current ??= { baseline: fromStart ? 0 : total, arrivals: [], chunk: null }
  const { baseline, arrivals } = clock.current
  const now = performance.now()
  // Idempotent: only characters without an arrival yet are scheduled, over the time since the last chunk.
  const backlog = total - baseline - arrivals.length
  if (backlog > 0) {
    pace(arrivals, backlog, now, clock.current.chunk === null ? Infinity : now - clock.current.chunk)
    clock.current.chunk = now
  }

  const motion = !reducedMotion()
  const done = settled(arrivals, now)
  const reveal: Reveal | undefined = motion && done < arrivals.length
    ? { from: baseline + done, at: (n) => arrivals[n - baseline] ?? now }
    : undefined

  // Each fading character runs on the document timeline from its own arrival time, so re-renders
  // (a new chunk) never restart it.
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffectInBrowser(() => {
    const chars = root.current?.querySelectorAll<HTMLElement>('.b-char')
    if (!chars?.length) return
    const keyframes = charKeyframes(getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#1a1b1e')
    chars.forEach((el) => {
      if (animated.has(el) || typeof el.animate !== 'function') return
      animated.add(el)
      el.animate(keyframes, { duration: FADE, fill: 'both' }).startTime = Number(el.dataset.at)
    })
  })

  // Once the last character settles, render again so every span folds back into plain text.
  const [, tick] = useState(0)
  const end = arrivals.length ? arrivals[arrivals.length - 1] + FADE : 0
  const fading = !!reveal
  useEffect(() => {
    if (!fading) return
    const t = setTimeout(() => tick((x) => x + 1), Math.max(0, end - performance.now()) + 50)
    return () => clearTimeout(t)
  }, [end, fading])

  return <div ref={root} className={`b-markdown ${className}`}>{renderBlocks(blocks, reveal)}</div>
}
