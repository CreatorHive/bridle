import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { CalendarScreen } from '../features/calendar'
import { ChatScreen } from '../features/chat'
import { CodeScreen } from '../features/code'
import { FilesScreen } from '../features/files'
import { MailScreen } from '../features/mail'
import { MeetingsScreen } from '../features/meetings'
import { Onboarding } from '../features/onboarding'
import { SearchPalette } from '../features/search'
import { SettingsModal } from '../features/settings'
import { TasksBoard } from '../features/tasks'
import { useCode } from '../features/code/store'
import { FileViewer, viewer } from '../features/viewer'
import { play } from '../sound'
import { Rail, SECTION_INFO } from './Rail'
import { Sidebar } from './Sidebar'
import { useBackgroundTurns } from '../features/chat/background'
import { AppProvider, useApp, type AppState } from './store'
import { TitleBar } from './TitleBar'
import './app.css'

/** main.tsx's route: the onboarding window (src/main/onboarding.ts) loads `#onboarding` and gets only Onboarding. */
export function Root({ hash, initialState }: { hash: string; initialState?: Partial<AppState> }) {
  if (hash === '#side') return <SideChat initialState={initialState} />
  if (hash !== '#onboarding') return <App initialState={initialState} />
  return (
    <AppProvider initialState={initialState}>
      <OnboardingRoute />
    </AppProvider>
  )
}

/** The side chat window (src/main/sidechat.ts): a fresh chat and nothing else; Esc closes it. */
function SideChat({ initialState }: { initialState?: Partial<AppState> }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) window.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <AppProvider initialState={{ section: 'chat', chatId: null, ...initialState }}>
      <Guard>
        <div className="side-chat">
          <div className="side-chat-head">Bridle</div>
          <main className="content"><ChatScreen /></main>
        </div>
      </Guard>
    </AppProvider>
  )
}

/** Waits for settings, so the ambience knows whether it's muted. */
function OnboardingRoute() {
  return useApp().state.settings ? <Onboarding /> : null
}

export function App({ initialState }: { initialState?: Partial<AppState> }) {
  return (
    <AppProvider initialState={initialState}>
      <Guard>
        <Shell />
      </Guard>
    </AppProvider>
  )
}

function Shell() {
  const { state, openSettings, setSetting } = useApp()
  useBackgroundTurns()

  // The app menu's commands.
  useEffect(() => window.bridle.on('menu:command', (c) => {
    if (c.command === 'open') viewer.open(c.path)
    else setSetting('soundMuted', c.muted)
  }), [setSetting])

  // ⌘, opens Settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ',') {
        e.preventDefault()
        play('open')
        openSettings()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSettings])

  const title = state.section === 'chat'
    ? state.chats.find((c) => c.id === state.chatId)?.title ?? 'New chat'
    : SECTION_INFO[state.section].title

  return (
    <div className="app">
      {state.section === 'code' ? <CodeTitleBar /> : <TitleBar title={title} />}
      <div className="app-body">
        <Rail />
        <div className="panel">
          <Sidebar />
          <main className="content">
            {state.section === 'chat' && <ChatScreen />}
            {state.section === 'board' && <TasksBoard />}
            {state.section === 'calendar' && <CalendarScreen />}
            {state.section === 'meetings' && <MeetingsScreen />}
            {state.section === 'mail' && <MailScreen />}
            {state.section === 'files' && <FilesScreen />}
            {state.section === 'code' && <CodeScreen />}
          </main>
          {/* The viewer: 480 px from the trailing edge, the content making room (MOTION.send). */}
          {state.section !== 'code' && <div className="viewer-slot"><FileViewer /></div>}
        </div>
      </div>
      <SettingsModal />
      <SearchPalette />
    </div>
  )
}

/** If drawing throws, show what broke (and log it) instead of an empty window. */
class Guard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Render error:', error.stack ?? error.message, info.componentStack) }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div style={{ padding: 40, display: 'grid', gap: 12, maxWidth: 640 }}>
        <h2 style={{ margin: 0 }}>Something broke</h2>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--secondary)' }}>{error.stack ?? error.message}</pre>
        <div><button className="tactile b-pill filled" onClick={() => this.setState({ error: null })}>Try again</button></div>
      </div>
    )
  }
}

/** Code names the open workspace, re-rendering only the title on Code's store changes. */
function CodeTitleBar() {
  const code = useCode()
  return <TitleBar title={code.workspaces.find((w) => w.id === code.selected)?.title ?? 'Code'} />
}
