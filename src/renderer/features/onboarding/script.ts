// The onboarding conversation, with the UI behind a small interface so it can be tested.

export type Demo = 'mail' | 'calendar' | 'code'

export type Prompt =
  | { type: 'text'; placeholder: string }
  | { type: 'choices'; options: string[] }
  | { type: 'connect' }
  /** After a demo: you move on when you've read it; leaves no bubble. */
  | { type: 'next' }

export interface ScriptIO {
  /** Typing, then a bubble from the agent (with an illustrated card under it). */
  say(text: string, demo?: Demo): Promise<void>
  /** The feature burst (Showcase.tsx); resolves once it has gathered back in. */
  showcase(): Promise<void>
  /** Waits for your answer. */
  ask(prompt: Prompt): Promise<string>
  /** Saves agentName; later bubbles come from this name. */
  setAgentName(name: string): void
  setUserName(name: string): void
}

export const SKIP = 'Skip for now'

export async function runScript(io: ScriptIO): Promise<void> {
  await io.say("Hi, I'm the agent in Bridle.")
  await io.say('I work across your mail, calendar and code, and I write first when something needs you.')
  await io.say('What would you like to call me?')
  io.setAgentName(await io.ask({ type: 'text', placeholder: 'Give me a name' }))
  await io.say('And what should I call you?')
  const userName = await io.ask({ type: 'text', placeholder: 'Your name' })
  io.setUserName(userName)
  await io.say(`Good to meet you, ${userName}. Here's what I do.`)
  await io.showcase()
  await io.say("Here's a closer look.")
  await io.say("Mail. When someone's waiting on you, I tell you in Home and draft the reply. Nothing sends until you say so.", 'mail')
  await io.ask({ type: 'next' })
  await io.say('Calendar. I watch your week across accounts and answer invites when you ask.', 'calendar')
  await io.ask({ type: 'next' })
  await io.say("Code. Open a repo and I'll work on each task in its own branch, run it, and fix what breaks. Every change shows up for review, and I ask before running commands.", 'code')
  await io.ask({ type: 'next' })
  await io.say("Connect your accounts and I'll get started.")
  if ((await io.ask({ type: 'connect' })) === SKIP) {
    await io.say('No problem. You can connect them anytime in Settings.')
  } else {
    await io.say("You're set. I'll write in Home when something needs you.")
  }
  await io.say('Everything I learn stays in plain files in your workspace, so you can read or edit any of it.')
  await io.ask({ type: 'choices', options: ["Let's go"] })
}

/** ConnectCard's reply: "Skip for now", or "Connected Google and Linear". */
export const connectReply = (connected: string[]): string =>
  connected.length ? `Connected ${new Intl.ListFormat('en', { type: 'conjunction' }).format(connected)}` : SKIP

/** Steps per demo card, and the delay before each (ms). */
export const DEMO_STEPS: Record<Demo, number> = { mail: 3, calendar: 3, code: 6 }
export const stepDelay = (demo: Demo, step: number): number => (step === 1 ? 350 : demo === 'code' ? 650 : 1100)

/** say(): typing time grows with the line, 300–1000 ms. */
export const typingTime = (text: string): number => 300 + Math.min(text.length * 8, 700)
