import { Archive, Clock, File, House, Inbox, Search, Send, SquarePen, Star, Trash2, Mails } from 'lucide-react'
import type { Mailbox } from '../../shared/types'
import { Button, IconButton, Row, SidebarHeader } from '../components'
import { CalendarSidebar } from '../features/calendar'
import { CodeSidebar } from '../features/code'
import { FilesSidebar } from '../features/files'
import { MeetingsSidebar } from '../features/meetings'
import { BoardSidebar } from '../features/tasks'
import { openSearch } from '../features/search'
import { logos } from '../theme'
import { HOME_TITLES, homeChat, useApp } from './store'

const VIEWS: [Mailbox, typeof Inbox][] = [
  ['Inbox', Inbox], ['Starred', Star], ['Snoozed', Clock], ['Sent', Send],
  ['Drafts', File], ['Archive', Archive], ['Trash', Trash2]
]

/** Logo + new chat, the pinned Home row, then a branch per section. */
export function Sidebar() {
  const app = useApp()
  const { state, patch } = app
  const home = homeChat(state)
  const agentName = state.settings?.agentName || 'Bridle'

  const openHome = async () => {
    if (home) return patch({ section: 'chat', chatId: home.id })
    // Home is made on first open (the watcher's ensureHome).
    const id = await window.bridle.watcher.homeChatId().catch(() => null)
    if (id) await app.reloadChats()
    patch({ section: 'chat', chatId: id, homeChatId: id })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <img src={logos.bridle} alt="" />
        <span>Bridle</span>
        <IconButton label="New chat" onClick={() => patch({ section: 'chat', chatId: null })}>
          <SquarePen size={15} />
        </IconButton>
      </div>
      {/* Search everything (⌘K); openSearch plays `open`. */}
      <Button cue={null} className="sidebar-search" title="Search everything (⌘K)" onClick={openSearch}>
        <Search size={15} />
        <span>Search</span>
        <kbd>⌘ K</kbd>
      </Button>
      <div className="sidebar-scroll">
        <Row
          title="Home"
          icon={<House size={16} />}
          selected={state.section === 'chat' && !!home && state.chatId === home.id}
          dot={!!home?.messages.length && home.messages[home.messages.length - 1].role !== 'user'}
          help={`Where ${agentName} writes when something needs you`}
          onClick={openHome}
        />
        <div className="sidebar-gap" />
        {/* Each section's own branch; recent chats only in Chat. */}
        {{ chat: <RecentBranch />, board: <BoardSidebar />, calendar: <CalendarSidebar />, meetings: <MeetingsSidebar />,
          mail: <MailBranch />, files: <FilesSidebar />, code: <CodeSidebar /> }[state.section]}
      </div>
    </aside>
  )
}

/** Every chat but Home, newest first. */
function RecentBranch() {
  const { state, patch } = useApp()
  const last = (c: (typeof state.chats)[number]) => c.messages[c.messages.length - 1]?.date ?? c.modified ?? ''
  const chats = state.chats.filter((c) => !HOME_TITLES.includes(c.title)).sort((a, b) => last(b).localeCompare(last(a)))
  return (
    <>
      <SidebarHeader title="Recent" divider={false} />
      {chats.map((c) => (
        <Row
          key={c.id}
          title={c.title}
          selected={state.section === 'chat' && state.chatId === c.id}
          working={state.working.includes(c.id)}
          onClick={() => patch({ section: 'chat', chatId: c.id })}
        />
      ))}
    </>
  )
}

/** Mail: Accounts (when Gmail is connected) and Views, with unread / draft counts. */
function MailBranch() {
  const { state, patch } = useApp()
  const gmails = state.accounts.filter((a) => a.grants.some((g) => g.toolkit === 'gmail' && g.ok))
  const mine = state.mail.filter((m) => state.mailAccount === null || m.account === state.mailAccount)
  const unread = (account: string | null) =>
    state.mail.filter((m) => m.unread && m.mailbox === 'Inbox' && (account === null || m.account === account)).length
  const count = (box: Mailbox) =>
    box === 'Inbox' ? mine.filter((m) => m.unread && m.mailbox === 'Inbox').length
      : box === 'Drafts' ? mine.filter((m) => m.mailbox === 'Drafts').length
        : null

  return (
    <>
      {gmails.length > 0 && (
        <>
          <SidebarHeader title="Accounts" divider={false} />
          <Row title="All inboxes" icon={<Mails size={16} />} selected={state.mailAccount === null}
            badge={unread(null)} onClick={() => patch({ mailAccount: null })} />
          {gmails.map((a) => (
            <Row key={a.id} title={a.login} image={a.photo ?? logos.google} selected={state.mailAccount === a.login}
              badge={unread(a.login)} onClick={() => patch({ mailAccount: a.login })} />
          ))}
        </>
      )}
      <SidebarHeader title="Views" divider={gmails.length > 0} />
      {VIEWS.map(([name, Icon]) => (
        <Row key={name} title={name} icon={<Icon size={16} />} selected={state.mailbox === name}
          badge={count(name)} onClick={() => patch({ mailbox: name })} />
      ))}
    </>
  )
}
