import { describe, expect, it } from 'vitest'
import type { Mail } from '../../../shared/types'
import { bodyOf, boxesToLoad, byTab, inBox, mergeMail, plainText, preview, srcdoc, unreadCount, viewCount } from './logic'

const mail = (id: string, m: Partial<Mail> = {}): Mail => ({
  id, from: 'A', email: 'a@x.co', subject: 's', body: 'b', time: '', unread: false, starred: false, mention: false,
  attachment: false, mailbox: 'Inbox', account: 'me@x.co', gmailID: id, ...m
})

describe('mail filtering and counts', () => {
  const all = [
    mail('1', { unread: true }), mail('2', { account: 'work@x.co', unread: true, starred: true, mailbox: 'Archive' }),
    mail('3', { mailbox: 'Drafts' }), mail('4', { account: 'work@x.co', unread: true, mention: true }), mail('5', { attachment: true })
  ]

  it('filters by mailbox and account; Starred is a flag', () => {
    expect(inBox(all, 'Inbox', null).map((m) => m.id)).toEqual(['1', '4', '5'])
    expect(inBox(all, 'Inbox', 'me@x.co').map((m) => m.id)).toEqual(['1', '5'])
    expect(inBox(all, 'Starred', null).map((m) => m.id)).toEqual(['2'])
    expect(inBox(all, 'Drafts', 'work@x.co')).toEqual([])
  })

  it('narrows by tab', () => {
    const box = inBox(all, 'Inbox', null)
    expect(byTab(box, 'All')).toHaveLength(3)
    expect(byTab(box, 'Unread').map((m) => m.id)).toEqual(['1', '4'])
    expect(byTab(box, 'Mentions').map((m) => m.id)).toEqual(['4'])
    expect(byTab(box, 'Attachments').map((m) => m.id)).toEqual(['5'])
  })

  it('counts unread Inbox and Drafts like the sidebar', () => {
    expect(viewCount(all, 'Inbox', null)).toBe(2)
    expect(viewCount(all, 'Inbox', 'work@x.co')).toBe(1)
    expect(viewCount(all, 'Drafts', null)).toBe(1)
    expect(viewCount(all, 'Sent', null)).toBeNull()
    expect(unreadCount(all, null)).toBe(2)
    expect(unreadCount(all, 'me@x.co')).toBe(1)
  })
})

describe('loading', () => {
  it('fetches the Inbox too until it is loaded for every account, or on Sync', () => {
    const loaded = [mail('1')]
    expect(boxesToLoad(loaded, 'Sent', ['me@x.co'], false)).toEqual(['Sent'])
    expect(boxesToLoad(loaded, 'Sent', ['me@x.co'], true)).toEqual(['Sent', 'Inbox'])
    expect(boxesToLoad(loaded, 'Sent', ['me@x.co', 'work@x.co'], false)).toEqual(['Sent', 'Inbox'])
    expect(boxesToLoad([], 'Inbox', ['me@x.co'], true)).toEqual(['Inbox'])
  })

  it('merges: drops sample mail, refetched ids and the old box contents, appends newest first', () => {
    const before = [
      mail('sample', { account: '' }), mail('old'), mail('kept', { mailbox: 'Sent' }),
      mail('other', { account: 'work@x.co' }), mail('dup', { mailbox: 'Archive' })
    ]
    const fetched = [mail('a', { date: '2026-10-01T00:00:00Z' }), mail('dup', { date: '2026-10-02T00:00:00Z' })]
    expect(mergeMail(before, fetched, 'Inbox', ['me@x.co']).map((m) => m.id)).toEqual(['kept', 'other', 'dup', 'a'])
    // Starred replaces the starred ones, wherever they live.
    const starred = [mail('s', { starred: true, mailbox: 'Archive' }), mail('i')]
    expect(mergeMail(starred, [], 'Starred', ['me@x.co']).map((m) => m.id)).toEqual(['i'])
  })
})

describe('bodies', () => {
  it('renders HTML when there is HTML, or when the body is HTML', () => {
    expect(bodyOf({ body: 'hi', html: '<p>hi</p>' }).kind).toBe('html')
    expect(bodyOf({ body: '<div>hi</div>', html: null })).toEqual({ kind: 'html', content: '<div>hi</div>' })
    expect(bodyOf({ body: 'a < b and c > d', html: '  ' })).toEqual({ kind: 'text', content: 'a < b and c > d' })
  })

  it('previews never show raw HTML', () => {
    expect(preview({ body: '<html><style>p{}</style><p>Hello&nbsp;there</p><p>Bye</p></html>' })).toBe('Hello there Bye')
    expect(preview({ body: 'x', snippet: 'Tom &amp; Jerry' })).toBe('Tom & Jerry')
    expect(preview({ body: 'line one\n\nline two' })).toBe('line one line two')
  })

  it('strips tags to text like GmailSync.plainText', () => {
    expect(plainText('<div>a<br>b</div><script>x()</script><div>c &lt;3</div>')).toBe('a\nb\nc <3')
  })

  it('injects a base target and no-scroll style into the srcdoc', () => {
    expect(srcdoc('<html><head><title>t</title></head></html>')).toMatch(/^<html><head><base target="_blank"><style>/)
    expect(srcdoc('<p>x</p>')).toMatch(/^<base target="_blank">.*<p>x<\/p>$/)
  })
})
