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
// One cue per action. Never per streamed token, per tool call, or on hover.

export type Cue = SoundName
export type Emphasis = 'subtle' | 'normal' | 'strong'

/** Follows the `soundMuted` / `soundVolume` settings (the shell keeps these in sync). */
export function setMuted(muted: boolean): void {
  setEnabled(!muted)
}

export function setSoundVolume(volume: number): void {
  setVolume(volume)
}

/** Plays `cue`, with optional emphasis and pitch direction. */
export function play(cue: Cue, options: { emphasis?: Emphasis; direction?: number } = {}): void {
  const d = options.direction ?? 0
  cuelume(cue, { emphasis: options.emphasis, direction: d > 0 ? 'forward' : d < 0 ? 'back' : undefined })
}
