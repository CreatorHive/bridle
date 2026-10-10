import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../shared/types'
import { AppProvider, type AppState } from '../../app/store'
import { CalendarScreen } from '../calendar'
import { MeetingsScreen, MeetingsSidebar } from '../meetings'
import { MailScreen } from '.'
import { sampleMail } from './logic'

// Server-render the mail, calendar and meetings screens (effects, and so window.bridle, don't run).
const render = (node: JSX.Element, state: Partial<AppState> = {}) =>
  renderToString(<AppProvider initialState={{ settings: { ...DEFAULT_SETTINGS, onboarded: true }, ...state }}>{node}</AppProvider>).replace(/<!-- -->/g, "")
const gmail = { id: 'google:me@x.co', service: 'google' as const, login: 'me@x.co', grants: [{ id: 'ca_1', toolkit: 'gmail' as const, ok: true }] }

describe('screens render', () => {
  it('mail: list header, tabs, rows with previews, no selection yet', () => {
    const html = render(<MailScreen />, { mail: sampleMail(), accounts: [gmail] })
    for (const s of ['Inbox', '2 unread · 4 total · all inboxes', 'Attachments', 'Ruby Park', 'Launch checklist', 'No message selected']) {
      expect(html).toContain(s)
    }
  })

  it('mail: empty view says so', () => {
    expect(render(<MailScreen />, { mailbox: 'Trash' })).toContain('Nothing here.')
  })

  it('calendar waits for accounts; meetings start empty', () => {
    expect(render(<CalendarScreen />)).toContain('b-spinner')
    expect(render(<MeetingsSidebar />)).toContain('No meetings coming up')
    expect(render(<MeetingsScreen />)).toBe('')
  })
})
