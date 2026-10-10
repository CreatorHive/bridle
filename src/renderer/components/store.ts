import { useSyncExternalStore } from 'react'

/** A tiny shared store, for a sidebar and its screen: `use()` in components, `set` from anywhere. */
export function createStore<T extends object>(initial: T) {
  let state = initial
  const listeners = new Set<() => void>()
  const get = (): T => state
  const set = (patch: Partial<T> | ((s: T) => Partial<T>)): void => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
    listeners.forEach((l) => l())
  }
  const subscribe = (l: () => void) => {
    listeners.add(l)
    return () => void listeners.delete(l)
  }
  return { get, set, use: (): T => useSyncExternalStore(subscribe, get, get) }
}
