# Bridle

**An open-source personal agent for macOS that lives in a folder and writes first.**

Mail. Calendar. Meetings. Code. Tasks. Files. Search. Bridle reads what's new, tells you what needs you, and
drafts the next step. Nothing leaves your Mac without your OK.

- **Writes first.** Home is where Bridle tells you when someone is waiting on you, an invite needs an answer, or a
  check failed on your PR, with the reply already drafted. You also get a morning briefing and meeting prep.
- **Your workspace is just a folder.** `~/Bridle` holds the agent's persona and memory, your chats, tasks, notes
  and Drive as plain markdown and JSONL. Open it in Finder, grep it, git it.
- **Asks before it acts.** Edits inside the workspace are instant. Sending, scheduling, deleting, running commands
  and anything outside the workspace show a card you approve.
- **Works on its own when you ask.** Board tasks run until they're done or need you. Routines run on a schedule.
  Loops watch something with a small script and wake the agent only when it changes.
- **Code.** Agents work in parallel, each in its own git worktree, with diffs you can read and PRs you open.
- **Search, privately.** One ⌘K box over mail, files, meetings and calendar. OCR, transcription and embeddings run
  on your Mac.
- **Bring your own model and tools.** Claude through Claude Code by default, or any OpenAI-compatible endpoint
  (OpenRouter, Ollama, LM Studio). Gmail, Calendar, GitHub and Linear come through Composio. Add your own MCP servers.

## Requirements

- macOS (Apple silicon or Intel). The on-device features in `native/BridleHelper` need macOS 26 and Xcode 26.
- Node.js 20 or later.
- [Claude Code](https://claude.com/claude-code), signed in, for the default model. Or point Settings → Models at an
  OpenAI-compatible endpoint.
- Optional: a [Composio](https://composio.dev) API key for Gmail, Google Calendar, GitHub and Linear
  (Settings → Connections).

## Run it

There are no signed builds yet, so run it from source:

```sh
git clone https://github.com/creatorhive/bridle.git
cd bridle
npm install
npm run build:native   # optional: on-device search, OCR, transcription, dictation and the notch
npm run dev
```

Bridle creates `~/Bridle` on first launch and walks you through setup.

| Command | What |
|---|---|
| `npm run dev` | The app with hot reload for the window. Changes to `src/main` or `src/preload` need a restart. |
| `npm run build` | Builds `out/main`, `out/preload`, `out/renderer`. |
| `npm start` | Runs the built app. |
| `npm run typecheck` | `tsc` for main/preload/shared and for the renderer. |
| `npm test` | vitest. |
| `npm run build:native` | The Swift helpers: `bridle-helper` and `bridle-notch`. |
| `npm run rebuild` | Rebuilds `node-pty` for Electron (`postinstall` already tries). |

Logs go to `~/Library/Logs/Bridle/bridle.log`.

### Without the native helper

Everything still runs: search is by words only, images and audio aren't indexed until the helper is built, Files
shows kind icons instead of thumbnails, dictation explains how to build it, and there's no notch.

### Troubleshooting

`node-pty` didn't build: Code terminals fall back to `script(1)`. Run `npm run rebuild` (and again after an Electron
upgrade).

On Node 24, Electron's postinstall can stop before it finishes unzipping (`Electron failed to install correctly`):

```sh
Z=$(find ~/Library/Caches/electron -name 'electron-v33.4.11-darwin-*.zip' | head -1)
rm -rf node_modules/electron/dist && mkdir node_modules/electron/dist && unzip -q "$Z" -d node_modules/electron/dist
printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
```

## How it's built

Electron 33, electron-vite, React 18, TypeScript (strict) and vitest, with CSS modules and no UI kit. Runtime
dependencies are deliberately few: `cuelume` (interface sounds), `lucide-react` (icons), `node-sqlite3-wasm` (the
search index), and `node-pty` with `@xterm/xterm` (Code terminals). Two small Swift processes in
`native/BridleHelper` reach the Apple frameworks Electron can't.

The website is in `site/` (Next.js).

See [docs/architecture.md](docs/architecture.md) for the layout, the IPC contract and the on-disk formats.

## License

[MIT](LICENSE) © Sean Scott
