import { useSyncExternalStore } from 'react'
import { play } from '../../sound'

// Which file the side panel shows, and where Back goes while browsing inside it.
// Any feature opens a file with `viewer.open(absolutePath)`.

export interface ViewerState {
  path: string | null
  history: string[]
}

let state: ViewerState = { path: null, history: [] }
const subscribers = new Set<() => void>()
const set = (next: ViewerState): void => {
  state = next
  subscribers.forEach((f) => f())
}
const subscribe = (f: () => void) => {
  subscribers.add(f)
  return () => void subscribers.delete(f)
}
const snapshot = (): ViewerState => state

export const viewer = {
  /** Opens a file or folder; `from` is the folder it was opened from inside the viewer, so Back returns there. */
  open(path: string, from?: string): void {
    play('open')
    set({ path, history: from ? [...state.history, from] : [] })
  },
  back(): void {
    const previous = state.history.at(-1)
    if (!previous) return
    play('tap')
    set({ path: previous, history: state.history.slice(0, -1) })
  },
  close(): void {
    play('close')
    set({ path: null, history: [] })
  },
  /** Opens a workspace-relative path ("notes/ideas.md"), if it exists. */
  async openWorkspacePath(rel: string): Promise<void> {
    const path = `${(await window.bridle.workspace.path()).replace(/\/$/, '')}/${rel.replace(/^\//, '')}`
    if (await window.bridle.viewer.inspect(path).then(() => true, () => false)) viewer.open(path)
  },
  get state(): ViewerState {
    return state
  }
}

export function useViewer(): ViewerState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
