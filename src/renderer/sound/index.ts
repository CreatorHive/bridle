import { play as cuelume, setEnabled, setVolume, type SoundName } from 'cuelume'

// Interface sounds: cuelume's default theme.
// Pick the cue by its job, never by its sound:
//   tap        buttons and links: send, save, open-in
//   select     rows, menu options, tabs (direction: +1 later, -1 earlier)
//   toggle     switches, star, read/unread (direction: -1 for switching off)
//   open/close dialogs, popovers, disclosures; close + strong for delete and deny
//   navigate   routes and pages;  type: keystrokes;  count: a number animating
//   success    done (subtle for saved or copied);  warning: done, needs a look
//   error      failed or refused (subtle for blocked or invalid input)
//   loading    slow work started;  ready: a result arrived (subtle for a chat reply)
//   attention  blocked until the user answers (an approval card)
// One cue per action. Never per tool call or on hover, and never per streamed token except
// streamTick(): opt-in (Settings → Streaming text), subtle, throttled, silent in the background.

export type Cue = SoundName
export type Emphasis = 'subtle' | 'normal' | 'strong'

/** Follows the `soundMuted` / `soundVolume` settings (the shell keeps these in sync). */
export function setMuted(muted: boolean): void {
  setEnabled(!muted)
}

export function setSoundVolume(volume: number): void {
  setVolume(volume)
}

let streaming = false
let lastTick = 0

export function setStreamSound(on: boolean): void {
  streaming = on
}

/** Settings → Interface sounds → Streaming text: a quiet key tick as a reply's text arrives.
 *  The one exception to "never per token": opt-in, subtle, at most ~8 a second, and silent in the background. */
export function streamTick(): void {
  const now = performance.now()
  if (!streaming || document.hidden || now - lastTick < 120) return
  lastTick = now
  play('type', { emphasis: 'subtle' })
}

/** Plays `cue`, with optional emphasis and pitch direction. */
export function play(cue: Cue, options: { emphasis?: Emphasis; direction?: number } = {}): void {
  const d = options.direction ?? 0
  cuelume(cue, { emphasis: options.emphasis, direction: d > 0 ? 'forward' : d < 0 ? 'back' : undefined })
}
