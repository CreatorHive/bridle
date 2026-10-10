import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, BrowserWindow: { getAllWindows: () => [] }, Notification: {} }))
const { every, frontMatter, parseWhen, routineDue, withField } = await import('./automations')

describe('automations', () => {
  it('reads schedules', () => {
    expect(parseWhen('weekdays 08:00')).toEqual({ days: [1, 2, 3, 4, 5], minutes: 480 })
    expect(parseWhen('daily 7:30 pm')).toEqual({ days: [0, 1, 2, 3, 4, 5, 6], minutes: 1170 })
    expect(parseWhen('Mon, Thu 16:05')).toEqual({ days: [1, 4], minutes: 965 })
    expect(parseWhen('08:00')?.days.length).toBe(7)
    expect(parseWhen('sometimes 8')).toBeNull()
    expect(parseWhen('blursday 08:00')).toBeNull()
    expect(every('15m')).toBe(900_000)
    expect(every('2 hours')).toBe(7_200_000)
    expect(every('soon')).toBe(900_000)
  })

  it('runs a routine once per slot, catching up within three hours', () => {
    const fri9 = new Date(2026, 9, 9, 9, 0) // Friday
    expect(routineDue('weekdays 08:00', null, fri9)).toBe(true)
    expect(routineDue('weekdays 08:00', new Date(2026, 9, 9, 8, 0).toISOString(), fri9)).toBe(false)
    expect(routineDue('weekdays 08:00', new Date(2026, 9, 8, 8, 0).toISOString(), fri9)).toBe(true)
    expect(routineDue('weekdays 05:00', null, fri9)).toBe(false) // missed by four hours
    expect(routineDue('weekends 08:00', null, fri9)).toBe(false)
  })

  it('edits front matter', () => {
    const md = '---\nwhen: daily 08:00\nenabled: true\n---\n# Brief\nDo it'
    expect(frontMatter(md)).toEqual({ fields: { when: 'daily 08:00', enabled: 'true' }, body: '# Brief\nDo it' })
    expect(withField(md, 'enabled', 'false')).toBe('---\nwhen: daily 08:00\nenabled: false\n---\n# Brief\nDo it')
    expect(withField('# Brief', 'enabled', 'false')).toBe('---\nenabled: false\n---\n# Brief')
  })
})
