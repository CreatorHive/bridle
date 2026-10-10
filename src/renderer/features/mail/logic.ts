import type { Mail, Mailbox } from '../../../shared/types'

// Pure mail logic: the inbox filter, sidebar counts, and Gmail sync's merge, looksLikeHTML, plainText, decodeEntities.

export type MailTab = 'All' | 'Unread' | 'Mentions' | 'Attachments'
export const MAIL_TABS: readonly MailTab[] = ['All', 'Unread', 'Mentions', 'Attachments']

/** MailScreen.inBox: the picked account's mail in the picked view (Starred is a flag, not a box). */
export function inBox(mail: Mail[], mailbox: Mailbox, account: string | null): Mail[] {
  return mail.filter((m) => {
    if (account !== null && m.account !== account) return false
    return mailbox === 'Starred' ? m.starred : m.mailbox === mailbox
  })
}

/** MailScreen.shown: inBox narrowed by the tab. */
export function byTab(mail: Mail[], tab: MailTab): Mail[] {
  switch (tab) {
    case 'Unread': return mail.filter((m) => m.unread)
    case 'Mentions': return mail.filter((m) => m.mention)
    case 'Attachments': return mail.filter((m) => m.attachment)
    default: return mail
  }
}

/** Sidebar count: unread Inbox, or Drafts, for the picked account; nil (no badge) elsewhere. */
export function viewCount(mail: Mail[], mailbox: Mailbox, account: string | null): number | null {
  const mine = mail.filter((m) => account === null || m.account === account)
  if (mailbox === 'Inbox') return mine.filter((m) => m.unread && m.mailbox === 'Inbox').length
  if (mailbox === 'Drafts') return mine.filter((m) => m.mailbox === 'Drafts').length
  return null
}

/** Sidebar unread: unread in one account's Inbox, or all of them. */
export function unreadCount(mail: Mail[], account: string | null): number {
  return mail.filter((m) => m.unread && m.mailbox === 'Inbox' && (account === null || m.account === account)).length
}

/** The boxes one load fetches: the view, plus the Inbox (for the badge) unless it's already there or fresh. */
export function boxesToLoad(mail: Mail[], mailbox: Mailbox, logins: string[], refreshInbox: boolean): Mailbox[] {
  const inboxLoaded = logins.every((l) => mail.some((m) => m.account === l && m.mailbox === 'Inbox'))
  return (inboxLoaded && !refreshInbox) || mailbox === 'Inbox' ? [mailbox] : [mailbox, 'Inbox']
}

/** GmailSync.load's merge: drop sample mail, re-fetched messages and the box's old contents for these
 *  accounts, then append the fetch newest first. */
export function mergeMail(mail: Mail[], fetched: Mail[], box: Mailbox, logins: string[]): Mail[] {
  const ids = new Set(fetched.map((m) => m.gmailID).filter(Boolean))
  const kept = mail.filter((m) =>
    !(m.account === '' || ids.has(m.gmailID ?? '') ||
      (logins.includes(m.account) && (box === 'Starred' ? m.starred : m.mailbox === box))))
  const sorted = [...fetched].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  return [...kept, ...sorted]
}

export function looksLikeHTML(s: string): boolean {
  const head = s.slice(0, 600).toLowerCase()
  return ['<html', '<!doctype', '<body', '<div', '<table'].some((t) => head.includes(t))
}

export function decodeEntities(s: string): string {
  const pairs: [string, string][] = [['&nbsp;', ' '], ['&#39;', "'"], ['&apos;', "'"], ['&quot;', '"'], ['&lt;', '<'],
    ['&gt;', '>'], ['&zwnj;', ''], ['&#8203;', ''], ['&amp;', '&']]
  return pairs.reduce((out, [from, to]) => out.split(from).join(to), s)
}

/** Readable text from an HTML email. ponytail: regex tag stripping. */
export function plainText(html: string): string {
  const s = html
    .replace(/<(head|style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*(\n\s*)+/g, '\n\n')
  return decodeEntities(s).trim()
}

/** What the reader shows: HTML in the sandboxed frame, or plain text. A body that is really HTML counts as HTML. */
export function bodyOf(mail: Pick<Mail, 'body' | 'html'>): { kind: 'html' | 'text'; content: string } {
  if (mail.html?.trim()) return { kind: 'html', content: mail.html }
  if (looksLikeHTML(mail.body)) return { kind: 'html', content: mail.body }
  return { kind: 'text', content: mail.body }
}

/** The row's two-line preview: Gmail's snippet, else the body, never raw HTML. */
export function preview(mail: Pick<Mail, 'body' | 'snippet'>): string {
  const s = mail.snippet?.trim() ? decodeEntities(mail.snippet) : looksLikeHTML(mail.body) ? plainText(mail.body) : mail.body
  return s.replace(/\s*\n\s*/g, ' ')
}

/** The srcdoc for an HTML email: links target a new window (blocked by the sandbox; the reader opens
 *  them in the browser) and the page doesn't scroll on its own. */
export function srcdoc(html: string): string {
  const head = '<base target="_blank"><style>html,body{margin:0;overflow-y:hidden;background:transparent}' +
    'body{font:15px/1.5 -apple-system,system-ui,sans-serif;color:#1a1b1e;word-wrap:break-word}</style>'
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html
}

/** Shown when no Gmail is connected (account '' marks it so a real load clears it). */
export function sampleMail(now = new Date()): Mail[] {
  const ago = (h: number) => new Date(now.getTime() - h * 3600_000)
  const time = (d: Date) => d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const make = (id: string, h: number, m: Partial<Mail> & Pick<Mail, 'from' | 'email' | 'subject' | 'body'>): Mail => ({
    id, time: time(ago(h)), date: ago(h).toISOString(), unread: false, starred: false, mention: false,
    attachment: false, mailbox: 'Inbox', account: '', ...m
  })
  return [
    make('sample-1', 1, {
      from: 'Ruby Park', email: 'ruby@northwind.co', subject: 'Launch checklist for Thursday', unread: true, mention: true,
      body: 'Hi!\n\nI pulled together the launch checklist for Thursday. Could you look over the pricing section and the press list before our sync?\n\nThanks,\nRuby'
    }),
    make('sample-2', 3, {
      from: 'Marcus Lee', email: 'marcus@studio.dev', subject: 'Design review notes', attachment: true, starred: true,
      body: 'Attached are the notes from today’s design review. The big open question is the onboarding flow; let’s decide by Friday.'
    }),
    make('sample-3', 26, {
      from: 'Linear', email: 'notifications@linear.app', subject: '3 issues assigned to you', unread: true,
      body: 'DUV-42 Sync calendar colors\nDUV-43 Mail reader toolbar\nDUV-44 Meeting prep notes'
    }),
    make('sample-4', 50, {
      from: 'Ana Souza', email: 'ana@fieldnotes.org', subject: 'Coffee next week?',
      body: 'Are you around next week? I’d love to catch up and hear how the new app is going.'
    }),
    make('sample-5', 72, {
      from: 'Ana Souza', email: 'ana@fieldnotes.org', subject: 'Re: Coffee next week?', mailbox: 'Drafts',
      body: 'Sounds great, how about Tuesday at 10?'
    })
  ]
}
