import { useEffect, useSyncExternalStore } from 'react'
import { SERVICES, TOOLKITS, type Account, type LinkProgress, type Service, type Toolkit } from '../../../shared/types'
import { useApp } from '../../app/store'
import { play } from '../../sound'
import { errorText } from '../tasks/logic'

// Connections, renderer side: the one link flow in progress and the last error,
// shared by Settings → Connections and onboarding's ConnectCard. Accounts live in the app store.

/** Toolkits in TOOLKITS order. */
const ORDER = Object.keys(TOOLKITS) as Toolkit[]

/** Linked toolkits in Toolkit order. */
export const toolkitsOf = (a: Account): Toolkit[] => ORDER.filter((t) => a.grants.some((g) => g.toolkit === t))

/** Linked but with no working grant left (revoked or expired) → Reconnect. */
export const expiredOf = (a: Account): Toolkit[] => toolkitsOf(a).filter((t) => !a.grants.some((g) => g.toolkit === t && g.ok))

/** The toolkit the browser is on. */
export const currentStep = (p: LinkProgress): Toolkit => p.steps[Math.min(p.done, p.steps.length - 1)]

interface State {
  pending: LinkProgress | null
  error: string | null
}
let state: State = { pending: null, error: null }
let flow: object | null = null // the running link flow; a cancelled one doesn't touch state again
const subscribers = new Set<() => void>()
const set = (p: Partial<State>) => {
  state = { ...state, ...p }
  subscribers.forEach((f) => f())
}
const subscribe = (f: () => void) => {
  subscribers.add(f)
  return () => void subscribers.delete(f)
}
const snapshot = () => state

export function useConnections() {
  const { state: app, patch } = useApp()
  const { pending, error } = useSyncExternalStore(subscribe, snapshot, snapshot)

  // Link progress from main.
  useEffect(() => window.bridle.on('composio:link', (p) => {
    if (state.pending && !p.finished && p.service === state.pending.service) set({ pending: { ...state.pending, steps: p.steps, done: p.done } })
  }), [])

  const refresh = async () => {
    try {
      patch({ accounts: await window.bridle.composio.accounts() })
      set({ error: null })
    } catch (e) {
      set({ error: errorText(e) })
    }
  }

  /** Per toolkit: a Connect Link in the browser, polled until active (main does the work). */
  const link = async (service: Service, steps: Toolkit[], account: string | null) => {
    if (state.pending || !steps.length) return
    const me = {}
    flow = me
    set({ error: null, pending: { service, account, steps, done: 0 } })
    try {
      await window.bridle.composio.link(service, steps, account)
      if (flow === me) play('success')
    } catch (e) {
      if (flow !== me) return
      set({ error: errorText(e) })
      play('error')
    }
    if (flow !== me) return
    await refresh()
    flow = null
    set({ pending: null })
  }

  return {
    accounts: app.accounts,
    pending,
    error,
    refresh,
    /** A new account with the service's core toolkits. */
    add: (service: Service) => link(service, SERVICES[service].core, null),
    /** One more toolkit on an existing account. */
    linkMore: (t: Toolkit, a: Account) => link(a.service, [t], a.id),
    reconnect: (a: Account) => link(a.service, expiredOf(a), a.id),
    /** The menu item plays close (strong) for it. */
    disconnect: async (a: Account) => {
      patch({ accounts: app.accounts.filter((x) => x.id !== a.id) })
      await window.bridle.composio.disconnect(a).catch((e) => set({ error: errorText(e) }))
      await refresh()
    },
    /** Abandons the running flow (main deletes the half-made grant). */
    cancel: () => {
      flow = null
      set({ pending: null })
      window.bridle.composio.cancelLink().catch(() => {})
    }
  }
}
