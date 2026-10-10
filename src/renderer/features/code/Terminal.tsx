import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// One interactive login zsh (node-pty in main) drawn by xterm.js. Sessions
// outlive the view: xterm instances are kept per terminal id and re-attached, so switching tabs, hiding
// the panel or changing workspace never restarts a shell.

interface Session {
  term: XTerm
  fit: FitAddon
  host: HTMLDivElement
}

const sessions = new Map<string, Session>()
/** Output that arrived before its view was made (the shell's first prompt). */
const early = new Map<string, string>()
let wired = false

function wire(): void {
  if (wired) return
  wired = true
  window.bridle.on('code:term', ({ termId, data, exited }) => {
    const s = sessions.get(termId)
    if (!s) return void (data && early.set(termId, (early.get(termId) ?? '') + data))
    if (data) s.term.write(data)
    if (exited) s.term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n')
  })
}

function session(termId: string): Session {
  let s = sessions.get(termId)
  if (s) return s
  wire()
  const term = new XTerm({
    fontFamily: "'Geist Mono', ui-monospace, Menlo, monospace",
    fontSize: 12,
    cursorBlink: true,
    allowProposedApi: false,
    theme: { background: '#121214', foreground: '#e6e6e6', cursor: '#d9d9d9' }
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const host = document.createElement('div')
  host.style.height = '100%'
  term.open(host)
  term.write(early.get(termId) ?? '')
  early.delete(termId)
  term.onData((d) => void window.bridle.code.termWrite(termId, d))
  term.onResize(({ cols, rows }) => void window.bridle.code.termResize(termId, cols, rows))
  s = { term, fit, host }
  sessions.set(termId, s)
  return s
}

/** TerminalSession.init: a new login zsh in the workspace. */
export function openTerminal(workspaceId: string): Promise<string> {
  wire()
  return window.bridle.code.termOpen(workspaceId, 80, 24)
}

/** Forgets a closed terminal's view. */
export function disposeTerminal(termId: string): void {
  sessions.get(termId)?.term.dispose()
  sessions.delete(termId)
}

/** Shows a terminal; its xterm moves into this container and fits it. */
export function TerminalView({ termId }: { termId: string }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const s = session(termId)
    el.appendChild(s.host)
    const fit = () => {
      try {
        s.fit.fit()
      } catch { /* hidden */ }
    }
    fit()
    s.term.focus()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => {
      observer.disconnect()
      s.host.remove()
    }
  }, [termId])
  return <div ref={box} />
}
