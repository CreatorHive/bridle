import { describe, expect, it } from 'vitest'
import type { TaskItem, TaskStatus } from '../../../shared/types'
import { capped, chipText, columnCards, errorText, filterTasks, fitChips, relative, tagColor, updatedLabel } from './logic'

const PALETTE = ['#1C9BEF', '#7C5CFF', '#F2711C', '#E64980', '#1E9E5A', '#E8A200']
const task = (id: string, status: TaskStatus, updated: string, linear = false): TaskItem => ({
  id, title: id, notes: '', status, tags: [], updated,
  linear: linear ? { id, identifier: 'DUV-1', url: 'https://linear.app', teamID: 't', team: 'T', state: 'Todo', grant: 'g' } : null
})

describe('tasks logic', () => {
  it('colors tags with a stable wrapping 64-bit hash', () => {
    const swift: Record<string, number> = {
      Bridle: 0, 'Duval Software': 1, a: 1, launch: 5,
      'A very long project name that overflows the hash': 2, 'émoji 🚀': 0
    }
    for (const [tag, i] of Object.entries(swift)) expect(tagColor(tag), tag).toBe(PALETTE[i])
  })

  it('truncates long tags at 21 characters', () => {
    expect(chipText('x'.repeat(22))).toBe('x'.repeat(22))
    expect(chipText('x'.repeat(23))).toBe('x'.repeat(21) + '…')
  })

  it('fits as many tags as the row allows, up to two', () => {
    expect(fitChips({ lead: 60, tags: [50, 50] }, 238)).toBe(2) // 60+6+50+6+50 = 172
    expect(fitChips({ lead: 60, tags: [120, 80] }, 238)).toBe(1) // 60+6+120 = 186; +86 too wide
    expect(fitChips({ lead: 60, tags: [200] }, 238)).toBe(0)
    expect(fitChips({ lead: 0, tags: [100, 100, 10] }, 238)).toBe(2)
    expect(fitChips({ lead: 0, tags: [] }, 238)).toBe(0)
  })

  it('sorts a column newest first and caps Done at six', () => {
    const done = Array.from({ length: 8 }, (_, i) => task(`d${i}`, 'done', `2026-10-0${i + 1}T00:00:00Z`))
    const cards = columnCards([...done, task('b', 'backlog', '2026-10-01T00:00:00Z')], 'done')
    expect(cards.map((c) => c.id)).toEqual(['d7', 'd6', 'd5', 'd4', 'd3', 'd2', 'd1', 'd0'])
    expect(capped(cards, 'done', false)).toMatchObject({ more: true })
    expect(capped(cards, 'done', false).shown).toHaveLength(6)
    expect(capped(cards, 'done', true).shown).toHaveLength(8)
    expect(capped(cards, 'backlog', false)).toEqual({ shown: cards, more: false })
  })

  it('filters mine and Linear', () => {
    const all = [task('a', 'backlog', ''), task('b', 'backlog', '', true)]
    expect(filterTasks(all, 'All tasks')).toHaveLength(2)
    expect(filterTasks(all, 'Mine').map((t) => t.id)).toEqual(['a'])
    expect(filterTasks(all, 'Linear').map((t) => t.id)).toEqual(['b'])
  })

  it('labels updates and relative dates', () => {
    const now = new Date('2026-10-09T12:00:00Z')
    expect(updatedLabel('2026-10-08T00:00:00Z', now)).toBe('Updated recently')
    expect(updatedLabel('2026-10-04T12:00:00Z', now)).toBe('Updated Oct 4')
    expect(relative('2026-10-08T12:00:00Z', now)).toBe('yesterday')
    expect(relative('2026-10-09T11:59:30Z', now)).toBe('now')
  })

  it('strips the IPC prefix from errors', () => {
    expect(errorText(new Error("Error invoking remote method 'tasks:move': Error: Linear: no state"))).toBe('Linear: no state')
    expect(errorText('plain')).toBe('plain')
  })
})
