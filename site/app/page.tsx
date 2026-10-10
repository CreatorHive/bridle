"use client";

import { useEffect, useState } from "react";

// ponytail: no remote yet; point this at the repo once it's public.
const GITHUB = "https://github.com/creatorhive/bridle";

// The working row's labels, as the agent moves through a request.
const STATUSES = ["Thinking", "Searching project files", "Reading files", "Drafting email"];

// Worker avatar palettes (light, accent, dark), as in the app.
const WORKERS = [
  ["#A5B4FC", "#6366F1", "#3730A3"],
  ["#99F6E4", "#14B8A6", "#115E59"],
  ["#FED7AA", "#F97316", "#C2410C"],
];

const FEATURES = [
  {
    icon: "📁",
    title: "Files are the source of truth",
    body: "Your workspace is a normal folder of markdown and JSONL. Open it in Finder, grep it, git it. The search index rebuilds from it.",
  },
  {
    icon: "⚡",
    title: "Private by design",
    body: "Search, OCR and transcription run on your Mac through Apple's own frameworks. Nothing is sent anywhere to be indexed.",
  },
  {
    icon: "✋",
    title: "Asks before it acts",
    body: "Reading and writing your workspace is instant. Sending mail, adding events or deleting anything shows a card you approve.",
  },
  {
    icon: "⌘",
    title: "Search everything",
    body: "⌘K searches chats, notes, PDFs, OCR'd screenshots and transcripts. On-device embeddings, hybrid BM25 + vector ranking.",
  },
  {
    icon: "🧠",
    title: "It remembers",
    body: "A persona in IDENTITY.md and SOUL.md, daily memory logs, and a curated MEMORY.md that you can read and edit.",
  },
  {
    icon: "🔌",
    title: "Bring your own model",
    body: "Your Claude subscription, OpenRouter, or a local model through Ollama or LM Studio. Gmail, Calendar, GitHub and Linear via Composio.",
  },
];

export default function Home() {
  return (
    <>
      <section className="hero">
        <LightField />
        <nav className="nav">
          <a className="brand" href="#">
            <img src="/logo.png" alt="" width={28} height={28} />
            Bridle
          </a>
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#workspace">Workspace</a>
            <a className="pill glass" href={GITHUB}>GitHub</a>
          </div>
        </nav>

        <div className="hero-copy">
          <img className="hero-mark arrive" src="/logo.png" alt="Bridle" width={88} height={88} />
          <h1 className="arrive" style={{ animationDelay: "120ms" }}>An agent that lives in a folder.</h1>
          <p className="arrive" style={{ animationDelay: "220ms" }}>
            Bridle is an open-source, native macOS agent harness for one person. Chat, goals, a board,
            notes, calendar and mail, all plain files you own.
          </p>
          <div className="ctas arrive" style={{ animationDelay: "320ms" }}>
            <a className="pill start" href={GITHUB}>Get Bridle for macOS</a>
            <a className="pill glass" href="#features">How it works</a>
          </div>
        </div>

        <AppWindow />
      </section>

      <section id="features" className="section">
        <h2>Calm by default. Yours by design.</h2>
        <p className="lede">Everything the agent knows is a file you can open. Everything it does outside that folder, you approve.</p>
        <div className="grid">
          {FEATURES.map((f) => (
            <div className="card" key={f.title}>
              <div className="card-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="workspace" className="section split">
        <div>
          <h2>Your workspace is just a folder.</h2>
          <p className="lede">
            Modeled on OpenClaw and Muse. The persona, memory, goals, kanban boards and chats are markdown and
            JSONL in <code>~/Bridle</code>. Delete the index and it rebuilds.
          </p>
        </div>
        <pre className="tree">
{`~/Bridle/
  agent/
    IDENTITY.md        `}<i># name, emoji, vibe</i>{`
    SOUL.md            `}<i># persona, tone</i>{`
    MEMORY.md          `}<i># long-term memory</i>{`
    memory/2026-10-09.md
  goals/atlas-box/
    GOAL.md
    BOARD.md           `}<i># ## To Do / Doing / Done</i>{`
    chats/<id>.jsonl
  notes/
  user/files/
  .bridle/index.sqlite `}<i># derived, rebuildable</i>
        </pre>
      </section>

      <footer className="footer">
        <LightField />
        <div className="footer-copy">
          <img src="/logo.png" alt="" width={56} height={56} />
          <h2>Welcome to Bridle</h2>
          <a className="pill start" href={GITHUB}>Start</a>
          <small>Open source · MIT · macOS 26</small>
        </div>
      </footer>
    </>
  );
}

/** Deep blue veil with light welling up from the bottom and two drifting blooms, as in onboarding. */
function LightField() {
  return (
    <div className="field" aria-hidden>
      <div className="horizon" />
      <div className="bloom left" />
      <div className="bloom right" />
    </div>
  );
}

/** The chat screen: sidebar, model pill, your message, the agent's reply, a working row, an approval card and the composer. */
function AppWindow() {
  const [status, setStatus] = useState(0);
  const [approved, setApproved] = useState<boolean | null>(null);

  useEffect(() => {
    const t = setInterval(() => setStatus((s) => (s + 1) % STATUSES.length), 2300);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="window">
      <div className="chrome">
        <span /><span /><span />
      </div>
      <div className="window-body">
        <aside className="sidebar">
          <div className="side-item active">💬 Chat</div>
          <div className="side-item">🎯 Goals</div>
          <div className="side-item">▦ Board</div>
          <div className="side-item">📝 Notes</div>
          <div className="side-item">📅 Calendar</div>
          <div className="side-item">✉️ Mail</div>
          <div className="side-label">Goals</div>
          <div className="side-item">Atlas Box</div>
          <div className="side-item">Q3 taxes</div>
        </aside>

        <main className="chat">
          <div className="topbar glass-solid">
            <span className="model">claude-opus-5.5 <small>⌄</small></span>
            <span className="divider" />
            <span className="project">📁 Atlas Box</span>
          </div>

          <div className="transcript">
            <div className="user-row">
              <div className="bubble">Can you tell Alex the prototype ships Friday? Pull the date from the board.</div>
            </div>

            <div className="agent">
              <div className="avatar"><img src="/logo.png" alt="" /></div>
              <div className="agent-body">
                <div className="agent-name">Bridle</div>
                <p>
                  The board has <b>Ship prototype</b> under Doing, due Friday Oct 16. I drafted a short note to Alex
                  below. Nothing goes out until you send it.
                </p>
                <div className="trace">
                  <span>› read goals/atlas-box/BOARD.md</span>
                  <span>› searched project files · 3 passages</span>
                </div>
              </div>
            </div>

            <div className="approval">
              <div className="approval-icon"><img src="/google.png" alt="" /></div>
              <div className="approval-main">
                <div className="approval-title">Send email to Alex?</div>
                <div className="fields">
                  <div><span>From</span>you@work.com</div>
                  <div><span>To</span>Alex Rivera &lt;alex@atlas.co&gt;</div>
                  <div><span>Subject</span>Prototype ships Friday</div>
                </div>
                <p className="approval-text">Hi Alex, quick heads-up: the Atlas Box prototype is on track to ship this Friday, Oct 16.</p>
                <div className="approval-actions">
                  {approved === null ? (
                    <>
                      <button className="pill outline" onClick={() => setApproved(false)}>Deny</button>
                      <button className="pill filled" onClick={() => setApproved(true)}>Send</button>
                    </>
                  ) : approved ? (
                    <span className="done ok">✓ Sent</span>
                  ) : (
                    <span className="done">✕ Denied</span>
                  )}
                </div>
              </div>
            </div>

            <div className="agent">
              <div className="avatar"><img className="breathe" src="/logo.png" alt="" /></div>
              <div className="agent-body">
                <div className="agent-name">Bridle</div>
                <div className="working">
                  <span className="workers">
                    {WORKERS.map(([l, a, d], i) => (
                      <i key={i} style={{ background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,.7), transparent 30%), linear-gradient(145deg, ${l}, ${a} 48%, ${d})` }} />
                    ))}
                  </span>
                  <span key={status} className="status">{STATUSES[status]}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="footer-composer">
            <div className="composer">
              <button className="round glass-solid" aria-label="Add files">＋</button>
              <span className="placeholder">Ask Bridle…</span>
              <button className="round glass-solid" aria-label="Dictate">🎙</button>
              <button className="round send" aria-label="Send">↗</button>
            </div>
            <div className="caption">Writes outside your workspace need approval.</div>
          </div>
        </main>
      </div>
    </div>
  );
}
