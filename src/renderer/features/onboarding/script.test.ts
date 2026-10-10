import { describe, expect, it } from 'vitest'
import { SKIP, connectReply, runScript, stepDelay, typingTime, type Prompt } from './script'

/** Runs the script against scripted answers, recording what it says and asks. */
async function play(answers: string[]) {
  const log: string[] = []
  const saved: Record<string, string> = {}
  await runScript({
    say: async (text, demo) => void log.push(demo ? `say[${demo}]: ${text}` : `say: ${text}`),
    showcase: async () => void log.push('showcase'),
    ask: async (p: Prompt) => {
      log.push(`ask: ${p.type}${p.type === 'text' ? ` (${p.placeholder})` : p.type === 'choices' ? ` ${p.options.join('|')}` : ''}`)
      return answers.shift()!
    },
    setAgentName: (n) => void (saved.agentName = n),
    setUserName: (n) => void (saved.userName = n)
  })
  return { log, saved }
}

describe('onboarding script', () => {
  it('asks both names, shows three demos with Next, connects, and ends on "Let\'s go"', async () => {
    const { log, saved } = await play(['Robin', 'Sean', 'Next', 'Next', 'Next', 'Skip for now', "Let's go"])
    expect(saved).toEqual({ agentName: 'Robin', userName: 'Sean' })
    expect(log).toEqual([
      "say: Hi, I'm the agent in Bridle.",
      'say: I work across your mail, calendar and code, and I write first when something needs you.',
      'say: What would you like to call me?',
      'ask: text (Give me a name)',
      'say: And what should I call you?',
      'ask: text (Your name)',
      "say: Good to meet you, Sean. Here's what I do.",
      'showcase',
      "say: Here's a closer look.",
      "say[mail]: Mail. When someone's waiting on you, I tell you in Home and draft the reply. Nothing sends until you say so.",
      'ask: next',
      'say[calendar]: Calendar. I watch your week across accounts and answer invites when you ask.',
      'ask: next',
      "say[code]: Code. Open a repo and I'll work on each task in its own branch, run it, and fix what breaks. Every change shows up for review, and I ask before running commands.",
      'ask: next',
      "say: Connect your accounts and I'll get started.",
      'ask: connect',
      'say: No problem. You can connect them anytime in Settings.',
      'say: Everything I learn stays in plain files in your workspace, so you can read or edit any of it.',
      "ask: choices Let's go"
    ])
  })

  it('bursts the features between "Here\'s what I do." and the Mail demo', async () => {
    const { log } = await play(['B', 'S', 'Next', 'Next', 'Next', SKIP, "Let's go"])
    const at = log.indexOf('showcase')
    expect(log.filter((l) => l === 'showcase')).toHaveLength(1)
    expect(log[at - 1]).toBe("say: Good to meet you, S. Here's what I do.")
    expect(log.findIndex((l) => l.startsWith('say[mail]'))).toBe(at + 2)
    expect(log.findIndex((l) => l.startsWith('say['))).toBeGreaterThan(at)
  })

  it('answers a connection differently from a skip', async () => {
    const { log } = await play(['B', 'S', 'Next', 'Next', 'Next', connectReply(['Google', 'Linear']), "Let's go"])
    expect(log).toContain("say: You're set. I'll write in Home when something needs you.")
    expect(connectReply([])).toBe('Skip for now')
    expect(connectReply(['Google', 'GitHub', 'Linear'])).toBe('Connected Google, GitHub, and Linear')
  })

  it('paces typing and demo steps', () => {
    expect(typingTime('Hi')).toBe(316)
    expect(typingTime('x'.repeat(200))).toBe(1000)
    expect([1, 2, 3].map((s) => stepDelay('mail', s))).toEqual([350, 1100, 1100])
    expect(stepDelay('code', 4)).toBe(650)
  })
})
