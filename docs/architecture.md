# Architecture

## Layout

| Path | What |
|---|---|
| `src/shared/types.ts`, `src/shared/api.ts` | Data types and **the contract** between main and the window |
| `src/preload/index.ts` | Builds `window.bridle` from `API_METHODS`; adding a method needs no change here |
| `src/main/index.ts`, `ipc.ts`, `events.ts`, `onboarding.ts` | Windows, IPC registration, `emit()`, the onboarding window (route `#onboarding`) |
| `src/main/services/` | Workspace files, settings, Keychain, Composio (Gmail, Calendar), tasks, the agent, MCP servers, LLM calls, memory import, workspace seed, the file viewer |
| `src/main/watch/` | The watcher: Home, the morning briefing, meeting prep |
| `src/main/automations.ts` | Routines, Loops and board task runs |
| `src/main/search/`, `src/main/native/` | The ⌘K index and the native helper client |
| `src/main/notch.ts`, `src/main/sidechat.ts` | The notch island and the ⌘⇧Space side chat (route `#side`) |
| `src/main/bridge.ts` | The phone bridge (HTTP over Tailscale) |
| `src/main/code/`, `src/renderer/features/code/` | Code: spaces, worktrees, agents, terminals, diffs, PRs |
| `src/renderer/app/` | Shell: `App`, `TitleBar`, `Rail`, `Sidebar`, `store.tsx` (`useApp`) |
| `src/renderer/components/` | Shared primitives (`Button`, `Row`, `Menu`, `SettingsRow`, `Toggle`…), motion, `createStore` |
| `src/renderer/theme/` | `tokens.css`, Geist fonts (OFL), logos |
| `src/renderer/sound/` | `play(cue, { emphasis, direction })` over cuelume |
| `src/renderer/features/*` | One folder per section: chat, tasks (Board), calendar, meetings, mail, files (and Drive), code, settings, search, viewer, onboarding |
| `native/BridleHelper/` | `bridle-helper` (embeddings, OCR, transcription, thumbnails, dictation) and `bridle-notch` |
| `site/` | The website |

Conventions: screens take no props and share UI state through `useApp()`; a sidebar and its screen share a small
`createStore`. Styles are CSS modules in the feature folder using the tokens in `theme/tokens.css` (the `b-` class
prefix belongs to `components/`). Every interactive control plays a cue; the `components` primitives already do.

## The contract

`src/shared/api.ts` defines `interface BridleAPI`. The window calls `window.bridle.<group>.<method>()`; each call is
`ipcRenderer.invoke('<group>:<method>', ...args)`, answered in `src/main/ipc.ts` by the service object for that
group. `API_METHODS` lists every method and is type-checked against the interface both ways, so adding a method
means: add it to `BridleAPI`, add it to `API_METHODS`, implement it in the service (typecheck fails until all three
agree). Push events go through `window.bridle.on(event, listener)`, which returns the unsubscribe; main sends them
with `emit(event, payload)`.

In development, the window hot-reloads but main and preload don't: after adding a method, restart `npm run dev`,
or the window calls a group that doesn't exist yet.

| Group | Methods |
|---|---|
| workspace | `path`, `loadChats`, `saveChat`, `listFiles`, `readFile`, `trashFile`, `addFiles`, `createFolder`, `pickFiles`, `openPath`, `revealInFinder` |
| settings | `all`, `get`, `set` |
| keychain | `get`, `set` |
| composio | `accounts`, `link`, `cancelLink`, `disconnect`, `execute`, `mcpServer` |
| gmail | `load` |
| calendar | `events`, `rsvp` |
| tasks | `list`, `add`, `update`, `move`, `delete`, `sendToLinear`, `syncLinear`, `linearDetail`, `run` |
| automations | `routines`, `loops`, `setEnabled`, `approve`, `runNow` |
| mcp | `list`, `add`, `remove`, `set` |
| agent | `run`, `respondPermission`, `cancel`, `perform`, `chatTitle` |
| watcher | `status`, `checkNow`, `briefNow`, `prepNote`, `savedPrep`, `homeChatId` |
| away, notify, search, viewer, memory, avatar, about, native, shell, onboarding, phone | see `api.ts` |
| code | spaces, workspaces, diffs, PRs, chats, run configs, terminals (see `api.ts`) |

Events: `agent:event`, `agent:start`, `tasks:changed`, `composio:link`, `watcher:home`, `notify:opened`,
`menu:command`, `onboarding:done`, `native:dictation`, `code:*`.

## Safety model

- The agent's own workspace is its to edit: file edits inside `~/Bridle` run without asking, except under
  `.bridle/`, which is Bridle's state (settings it shouldn't change itself, like MCP servers and loop approvals).
- Everything else asks: sending, scheduling, deleting, shell commands, edits outside the workspace, and MCP tool
  calls. The approval policy in Settings → Tools can loosen this; sudo, recursive deletes, pushes, piped installs
  and writes outside the workspace still ask.
- Text from mail, web pages and files is data, never instructions.
- A loop's `check.sh` runs only after you approve its exact text; any edit needs approving again.
- MCP servers live in `.bridle/mcp.json`; each call asks unless you mark the server "Don't ask".
- With the Claude CLI, the system prompt and MCP config (which carries keys) go through private 0600 temp files,
  never argv.

## Background work

Routines, Loops and task runs start ordinary chat turns: main emits `agent:start` and the main window sends it
through the same path as a message you type, so it streams, asks for approvals and saves the same way. They run
while Bridle is open.

- **Routines**: `routines/<name>.md`, front matter `when: weekdays 08:00` (`daily`, `weekends`, `mon, thu`…), then
  `# Title` and the prompt. A missed run still goes out if Bridle opens within three hours.
- **Loops**: `loops/<name>/LOOP.md` (front matter `every: 15m`, `# Title`, what to do) and `check.sh`. The script runs
  with no model; when its output changes, the agent wakes with it. The first run only records the output.
- **Task runs**: a board task worked in its own chat until the agent sets `status: done` or `needs review`; still in
  progress after three turns goes to Needs review.
- State: `.bridle/automations.json`.

## Native helpers (`native/BridleHelper`)

`bridle-helper` is one long-lived process speaking JSON lines over stdin/stdout, spawned on first use:
`embed` (NLContextualEmbedding, 512-d), `ocr` (Vision), `transcribe` (SpeechAnalyzer), `thumbnail`
(QLThumbnailGenerator) and `dictate` (live dictation, streamed as `native:dictation`). `bridle-notch` is a small
AppKit process that draws the notch island from scenes main sends it. `npm run build:native` builds both into
`native/BridleHelper/.build/release/`; a packaged app looks in `Contents/Resources/`. Packaging and permission notes
are in `native/BridleHelper/README.md`.

## Phone bridge (`src/main/bridge.ts`)

The phone apps call the same contract over HTTP. Settings → General → Phone turns it on; it listens on this Mac's
Tailscale IPv4 only, port 47811 (Tailscale's WireGuard encrypts the hop).

- Every request carries `Authorization: Bearer <token>` (Settings → Pair a phone; Keychain `phone`). Wrong or none → 401.
- `POST /v1/<group>/<method>`, body = the arguments as a JSON array → `200 { "result": … }`, or `{ "error": "…" }`
  with 400 (bad body), 404 (not allowed), 413 (over 8 MB) or 500 (the method threw).
- `GET /v1/events` → Server-Sent Events for `agent:event` and `watcher:home`, with a `: ping` every 25 s. A new token
  drops every open stream.
- Allowed: `PHONE_METHODS` / `PHONE_EVENTS` in `api.ts`. No settings writes, Keychain, raw Composio, Code or Mac UI;
  `workspace.readFile` is limited to the workspace.

## On disk

**Workspace**: `defaults read Bridle workspace`, default `~/Bridle` (created if missing).

**Chats**: `chats/<id-lowercase>.jsonl`, or `goals/<slug>/chats/<id>.jsonl`.
- Line 1, the header: `{"id","session_id","title"}` (`id` an uppercase UUID; `session_id` omitted when null).
- Then one turn per line: `turn_id` (uppercase UUID), `role` (`user|assistant|tool`), `content`, `created_at`,
  `files` (`file://` URL strings), `trace`, `title`, `icon`, `confirm`, `action` (`{"kind","fields"}`), `approved`,
  `dismissed`, `source`, `changes`, `plan`, `todos`, `subagents`, `ended`. Omit null optionals, but always write
  `turn_id`, `role`, `content`, `created_at`, `files` and `trace` (possibly `[]`).
- Dates are ISO-8601 without fractional seconds (`2026-10-09T14:03:11Z`). Keys sorted, slashes unescaped.
- Live-only fields (`workers`, `status`) are never written; turns still carrying a `status` are skipped. Empty chats
  aren't saved. Recent order is file mtime, newest first. The Home chat is titled "Home".

**Tasks**: `tasks/<lowercase-uuid>.md`:
```
---
status: backlog | in progress | needs review | done
tags: a, b            (only when there are tags)
updated: 2026-10-09T14:03:11Z
chat: <chat id>       (once Bridle has worked on it)
---
# Title

notes…
```
Linear issues are cached in `.bridle/linear.json`, an array of TaskItem (`id` = `linear:<issue id>`).

**Watcher**: `.bridle/watch.json` = `{seen, baselined, notified, chatID, briefed, prepped}`. Its **dates are
numbers, seconds since 2001-01-01** (Apple's reference date; add 978307200 for Unix seconds), and `chatID` is an
uppercase UUID. `.bridle/watch.lock` (`{"pid","app","at"}`) keeps two running copies of Bridle from checking at once.

**Meetings**: prep notes in `meetings/<yyyy-MM-dd>-<slug(title)>.md`.

**Search index**: `.bridle/index-electron.sqlite`: files plus FTS5 chunks, and a meta row naming the embedder.

**Code**: worktrees in `.bridle/worktrees/<repo>/<name>/` on branch `bridle/<name>`.

**Uploads**: `user/files/<name>`, `name 2.ext` on clashes; files already in the workspace stay put. **Drive**: `drive/`.

**Preferences**: the macOS defaults domain `Bridle` (`defaults read Bridle <key>`); keys and defaults are `Settings`
and `DEFAULT_SETTINGS` in `src/shared/types.ts`. Booleans are stored as 0/1.

**Keys**: login Keychain, service `Bridle`: account `composio` (then env `COMPOSIO_API_KEY`, then a `.env` at the repo
root in development), `openrouter`, `phone`. Composio identity: defaults `composioUserID` and `composioSession`.
