// THE CONTRACT between the renderer and the main process.
//
// The renderer calls `window.bridle.<group>.<method>(...)`; the preload forwards each call
// as `ipcRenderer.invoke('<group>:<method>', ...args)` and the main process answers from
// src/main/ipc.ts, which maps every group to a service object typed by this interface.
// Push events (agent streaming, link progress, Home posts) come through `window.bridle.on`.
//
// Every value is plain JSON (see types.ts). Errors reject the promise; Electron prefixes
// the message with "Error invoking remote method '<channel>':".
//
// Compatibility: existing workspaces on disk must keep working. Never invent new on-disk
// formats here.

import type {
  Account,
  AgentAction,
  AgentEvent,
  CalendarEvent,
  Chat,
  FolderEntry,
  ISODate,
  LinearDetail,
  Loop,
  LinkProgress,
  LocalModel,
  McpServer,
  Mail,
  Mailbox,
  MemorySource,
  PhoneStatus,
  Message,
  Routine,
  RSVP,
  SearchHit,
  Service,
  SettingKey,
  Settings,
  TaskItem,
  TaskStatus,
  Toolkit,
  ViewerItem,
  WatcherStatus,
  WorkspaceFile
} from './types'
import type {
  ChangedFile, CodeAgentState, CodeMode, CodePrefs, DevToolsState, DiffHunk, DirEntry, GitHubRepo, Space, Workspace
} from './types'

export interface BridleAPI {
  /** The workspace folder (~/Bridle or the `workspace` setting): chats, files, uploads. */
  workspace: {
    /** Resolved absolute workspace path, created if missing. */
    path(): Promise<string>
    /** Every chat in chats/*.jsonl and goals/<slug>/chats/*.jsonl, newest file first. */
    loadChats(): Promise<Chat[]>
    /** Writes one chat to its JSONL file (turns with a live `status` are left out; empty chats are skipped). */
    saveChat(chat: Chat): Promise<void>
    /** Every file in the workspace, Bridle's own marked `system`, capped at 5,000. */
    listFiles(): Promise<WorkspaceFile[]>
    /** A file's contents: utf8 text, or base64 for binary previews. */
    readFile(path: string, encoding?: 'utf8' | 'base64'): Promise<string>
    /** Moves a file to the macOS Trash. */
    trashFile(path: string): Promise<void>
    /** Copies files into the workspace (default "user/files"), "name 2.ext" on a clash; files already in the
     *  workspace stay put. Returns the new absolute paths. */
    addFiles(paths: string[], folder?: string): Promise<string[]>
    /** Makes folder `name` in the workspace folder `parent` ("name 2" when taken); returns its absolute path. */
    createFolder(parent: string, name: string): Promise<string>
    /** Native open panel; returns chosen absolute paths ([] if cancelled). */
    pickFiles(options?: { prompt?: string; multiple?: boolean; directories?: boolean }): Promise<string[]>
    /** Opens a file in its default app. */
    openPath(path: string): Promise<void>
    /** Shows a file in Finder. */
    revealInFinder(path: string): Promise<void>
  }

  /** App preferences in the macOS defaults domain "Bridle" (`defaults read Bridle <key>`);
   *  unset keys fall back to DEFAULT_SETTINGS. */
  settings: {
    /** Every key at once, for the renderer's initial load. */
    all(): Promise<Settings>
    get<K extends SettingKey>(key: K): Promise<Settings[K]>
    set<K extends SettingKey>(key: K, value: Settings[K]): Promise<void>
  }

  /** Generic passwords in the login Keychain under service "Bridle" (accounts: "composio", "openrouter").
   *  Read: `security find-generic-password -s Bridle -a <account> -w`. */
  keychain: {
    /** null when missing. */
    get(account: string): Promise<string | null>
    /** Replaces the item; an empty value deletes it. */
    set(account: string, value: string): Promise<void>
  }

  /**
   * Composio (connected apps). Identity: user id = defaults "composioUserID",
   * tool-router session = defaults "composioSession", key = Keychain "composio", falling back to env
   * COMPOSIO_API_KEY or a .env file at the repo root (dev only). API base
   * https://backend.composio.dev/api/v3.1/.
   */
  composio: {
    /** Connected accounts grouped per identity (with whoAmI logins and photos). */
    accounts(): Promise<Account[]>
    /** Links `toolkits` one by one: gets a Connect Link, opens the browser, polls until ACTIVE.
     *  Progress streams as `composio:link` events; resolves when the flow ends (rejects on failure).
     *  `account` is the Account.id to add grants to, or null for a new account. */
    link(service: Service, toolkits: Toolkit[], account: string | null): Promise<void>
    /** Abandons the running link flow and deletes its half-made grant. */
    cancelLink(): Promise<void>
    /** Deletes every grant of the account. */
    disconnect(account: Account): Promise<void>
    /** Runs one Composio tool through the tool-router session; returns its `data` JSON.
     *  `grant` is the connected account id. */
    execute(tool: string, args: Record<string, unknown>, grant: string): Promise<unknown>
    /** Composio's MCP server for the agent, or null without a key or an active account. */
    mcpServer(): Promise<{ url: string; headers: Record<string, string> } | null>
  }

  /** Gmail over Composio. */
  gmail: {
    /** One mailbox (25 newest) for one Gmail address, or every connected one when `account` is null,
     *  newest first. */
    load(mailbox: Mailbox, account: string | null): Promise<Mail[]>
    /** Adds and removes labels on one message of `account` (archive = remove INBOX, read = remove UNREAD). */
    label(account: string, gmailID: string, add: string[], remove: string[]): Promise<void>
    /** Moves one message to the Trash. */
    trash(account: string, gmailID: string): Promise<void>
  }

  /** Google Calendar over Composio. */
  calendar: {
    /** Primary-calendar events of every connected account between two instants. */
    events(from: ISODate, to: ISODate): Promise<CalendarEvent[]>
    /** Your RSVP on one event. */
    rsvp(event: CalendarEvent, status: RSVP): Promise<void>
  }

  /** The task board: tasks/<id>.md plus Linear issues (cached in .bridle/linear.json). */
  tasks: {
    /** Yours (newest first) followed by the cached Linear issues. */
    list(): Promise<TaskItem[]>
    /** Creates tasks/<uuid>.md. */
    add(title: string, notes?: string, status?: TaskStatus, tags?: string[]): Promise<TaskItem>
    /** Saves edits (bumps `updated`). Linear items only update in memory. */
    update(task: TaskItem): Promise<TaskItem>
    /** Moves a card; a Linear issue moves in Linear too and rejects if that fails. */
    move(id: string, status: TaskStatus): Promise<TaskItem>
    /** Trashes one of your tasks (Linear items can't be deleted here). */
    delete(id: string): Promise<void>
    /** Turns one of your tasks into a Linear issue assigned to you; returns the issue. */
    sendToLinear(id: string): Promise<TaskItem>
    /** Re-fetches your assigned Linear issues and rewrites the cache. */
    syncLinear(): Promise<TaskItem[]>
    /** Description, comments and properties of a Linear issue (task id "linear:…"). */
    linearDetail(id: string): Promise<LinearDetail>
    /** Bridle works the task in its own chat until it marks it done or needs review (one of yours, not Linear's). */
    run(id: string): Promise<void>
  }

  /** The side chat window (src/main/sidechat.ts). */
  side: {
    /** Grows the bar upward from the Dock to `height` px, or back to just the composer with 0. */
    resize(height: number): Promise<void>
  }

  /** Your MCP servers (.bridle/mcp.json), given to the Claude CLI with Composio's. */
  mcp: {
    list(): Promise<McpServer[]>
    /** Adds what you pasted: one server's JSON (named `name`), or a whole `{ "mcpServers": … }`. Returns the names added. */
    add(json: string, name: string): Promise<string[]>
    remove(name: string): Promise<void>
    set(name: string, change: { enabled?: boolean; trust?: boolean }): Promise<void>
  }

  /** Routines (routines/*.md) and Loops (loops/<slug>/), run from main while Bridle is open. */
  automations: {
    routines(): Promise<Routine[]>
    loops(): Promise<Loop[]>
    /** Turns one on or off: writes `enabled` into its file. */
    setEnabled(kind: 'routine' | 'loop', slug: string, on: boolean): Promise<void>
    /** Approves the loop's check.sh as it is now; any later edit needs approving again. */
    approve(slug: string): Promise<void>
    /** Runs it now: a routine's prompt, or a loop's check (which wakes the agent only if the output changed). */
    runNow(kind: 'routine' | 'loop', slug: string): Promise<void>
  }

  /** The agent loop. */
  agent: {
    /**
     * Streams one reply. Events arrive as `agent:event` { chatId, event }; the promise resolves after the
     * final `done` (or rejects after `error`). The provider and model come from settings.
     */
    run(chatId: string, prompt: string, history: Message[],
        options?: { sessionID?: string | null; project?: string | null; context?: string | null }): Promise<void>
    /** Answers a `permission` event. */
    respondPermission(requestId: string, allow: boolean): Promise<void>
    /** Stops the chat's running reply. */
    cancel(chatId: string): Promise<void>
    /** Runs an approved action card (task → board; email/event still mocked). */
    perform(action: AgentAction): Promise<void>
    /** A 2–5 word Title Case name for a chat still titled with its first message, or null to keep it.
     *  The renderer applies and saves it. */
    chatTitle(chat: Chat): Promise<string | null>
  }

  /** "Bridle writes first": the background watcher, Home chat, briefing, meeting prep. */
  watcher: {
    status(): Promise<WatcherStatus>
    /** One pass now, skipping quiet hours. */
    checkNow(): Promise<WatcherStatus>
    /** Posts the morning briefing to Home now. */
    briefNow(): Promise<void>
    /** Writes a fresh prep note for a meeting (Prepare / Prepare again), saves it under meetings/, and returns it;
     *  null if it can't be made. */
    prepNote(event: CalendarEvent): Promise<string | null>
    /** The saved prep note (without its front matter), or null. */
    savedPrep(event: CalendarEvent): Promise<string | null>
    /** The Home chat's id, creating Home if needed. */
    homeChatId(): Promise<string>
  }

  /** Away: Home's messages as an iMessage to yourself when you're away from the Mac. */
  away: {
    /** Sends one iMessage (through Messages) to the `awayHandle` setting; Settings' "Send test" only.
     *  Resolves to an error message, or null when it went. */
    send(text: string): Promise<string | null>
  }

  /** macOS notifications. */
  notify: {
    /** Posts a banner unless Bridle is focused or the `when` setting is off; clicking it emits
     *  `notify:opened`. */
    post(title: string, body: string, chatId?: string | null,
         when?: 'notifyMail' | 'notifyApprovals' | 'notifyDone'): Promise<void>
  }

  /** ⌘K search and project context over the workspace index (.bridle/index-electron.sqlite):
   *  FTS5 for exact words, optional endpoint embeddings for meaning, fused by reciprocal rank. */
  search: {
    /** Brings the whole workspace (chats included) up to date; only changed files are read again. */
    refresh(): Promise<void>
    /** The best passages for `text` across the workspace, best first. */
    query(text: string, limit?: number): Promise<SearchHit[]>
  }

  /** The file viewer side panel's file access. */
  viewer: {
    /** What a path is and how to show it; rejects if it doesn't exist. */
    inspect(path: string): Promise<ViewerItem>
    /** A folder's visible contents, folders first, then by name (Finder order). */
    list(dir: string): Promise<FolderEntry[]>
    /** Writes text atomically. */
    save(path: string, text: string): Promise<void>
    /** The Finder icon as a PNG data URL (`NSWorkspace.icon(forFile:)`). */
    icon(path: string): Promise<string>
  }

  /** Bring memory from ChatGPT or Claude Code. */
  memory: {
    /** The prompt to paste into the other assistant. */
    prompt(source: MemorySource): Promise<string>
    /** Appends each "=== USER.md ===" / "=== MEMORY.md ===" section to that file under a dated heading;
     *  returns the files it added to. */
    apply(text: string, source: MemorySource): Promise<string[]>
  }

  /** The agent's picture, agent/avatar.png in the workspace (512px square). */
  avatar: {
    /** A data URL, or null when there's none (the avatar shows initials). */
    get(): Promise<string | null>
    /** Open panel for an image; saves it center-cropped to 512×512 PNG. Returns the new data URL, or null if cancelled. */
    choose(): Promise<string | null>
    remove(): Promise<void>
  }

  /** LM Studio's server (Settings → Models): src/main/services/lmstudio.ts. */
  lmStudio: {
    /** Its downloaded chat models, loaded first. Throws when the server isn't running. */
    models(): Promise<LocalModel[]>
  }

  /** Read-only facts Settings shows. */
  about: {
    /** The `claude` binary Bridle runs, or null (Settings → Models). */
    claudeBinary(): Promise<string | null>
    /** Where the Composio key comes from: the Keychain, the environment (COMPOSIO_API_KEY or a dev .env), or nowhere. */
    composioKeySource(): Promise<'keychain' | 'environment' | null>
  }

  /**
   * The Code section: Spaces (repos, spaces/<slug>/space.json) and their Workspaces (git worktrees
   * in .bridle/worktrees/<repo>/<name> on branch bridle/<name>, records and chats in spaces/<repo>/workspaces/<name>/).
   * Chats, the agent, setup/run output and terminals live in main; the renderer follows `code:*` events.
   */
  code: {
    /** Every Space, by name. */
    spaces(): Promise<Space[]>
    /** Adds a repo folder (a file adds its folder), or returns the Space it already has. */
    addSpace(root: string): Promise<Space>
    /** Archives its workspaces (forced) and trashes its settings and chats; the repo is never touched.
     *  Called after the user confirms. */
    removeSpace(slug: string): Promise<void>
    /** The trust card's answer, remembered in defaults "spaceTrustAsked.<slug>". */
    trustSpace(slug: string, trusted: boolean): Promise<Space>
    /** Whether a folder is inside a git work tree. */
    isRepo(path: string): Promise<boolean>
    /** git init, add -A and commit "Initial commit" (only after the user's OK). */
    initRepo(path: string): Promise<void>
    /** Active (not archived) workspaces, newest first. */
    workspaces(): Promise<Workspace[]>
    /** A new worktree on bridle/<city> from the default base; copies local files and starts setup. */
    createWorkspace(slug: string): Promise<Workspace>
    /** Removes the worktree, keeping the branch and record. Rejects with "uncommitted changes" unless `force`. */
    archiveWorkspace(id: string, force: boolean): Promise<void>
    renameWorkspace(id: string, title: string): Promise<void>
    /** `git status --porcelain` isn't empty. */
    dirty(id: string): Promise<boolean>
    /** Everything the branch changed since the merge-base: commits, edits, untracked files. */
    changes(id: string): Promise<ChangedFile[]>
    /** One file's unified diff against the merge-base. */
    diff(id: string, path: string): Promise<DiffHunk[]>
    /** Puts a file back as it was at the merge-base (deleting it if it didn't exist). */
    revert(id: string, path: string): Promise<void>
    /** Pushes the branch and opens a PR (gh), else returns the GitHub compare page. */
    createPR(id: string, draft: boolean): Promise<string>
    /** The branch's open PR URL via gh, or null. */
    pullRequest(id: string): Promise<string | null>
    /** One folder's entries for the file tree: folders first, Finder order, no .git. */
    listDir(path: string): Promise<DirEntry[]>
    /** The workspace's chats (newest file first) and its agent's state. */
    chats(id: string): Promise<{ chats: Chat[]; state: CodeAgentState }>
    /** Sends a turn (a new chat when `chatId` is null); resolves with the chat id once it's started. */
    send(id: string, chatId: string | null, prompt: string, mode: CodeMode): Promise<string>
    /** Stops the running turn. */
    stop(id: string): Promise<void>
    /** Approve runs the plan in the same turn; otherwise `feedback` goes back and it plans again. */
    answerPlan(id: string, approve: boolean, feedback?: string): Promise<void>
    /** Answers a permission card; `always` saves its rule on the Space first. */
    respond(id: string, cardId: string, allow: boolean, always?: boolean): Promise<void>
    /** Run configurations, the running command and output, and the setup log. */
    tools(id: string): Promise<DevToolsState>
    /** Runs a configuration (by name) in a login zsh, in its own process group. */
    run(id: string, name: string): Promise<void>
    /** SIGTERM to the group, SIGKILL 2 s later. */
    stopRun(id: string): Promise<void>
    clearOutput(id: string): Promise<void>
    /** Re-runs the setup script. */
    runSetup(id: string): Promise<void>
    /** Starts a login zsh in the worktree on a pty; returns its id. Output comes as `code:term`. */
    termOpen(id: string, cols: number, rows: number): Promise<string>
    termWrite(termId: string, data: string): Promise<void>
    termResize(termId: string, cols: number, rows: number): Promise<void>
    termClose(termId: string): Promise<void>
    /** Your GitHub repos through a Composio grant, most recently pushed first. */
    githubRepos(grant: string): Promise<GitHubRepo[]>
    /** Clones into `parent`/<name> (gh, then https, then ssh) and adds it. */
    clone(repo: GitHubRepo, parent: string): Promise<Space>
    /** Code's own keys in the "Bridle" defaults domain. */
    prefs(): Promise<CodePrefs>
    setPref<K extends keyof CodePrefs>(key: K, value: CodePrefs[K]): Promise<void>
  }

  /** Apple frameworks through the bundled Swift helper (native/BridleHelper). Without it (not built yet),
   *  thumbnails are null and dictation rejects with how to build it. */
  native: {
    /** A Quick Look thumbnail (PDFs, Office, HEIC, movies…) about `size` CSS px square, as a PNG data URL;
     *  null when the file has none (QLThumbnailGenerator). */
    thumbnail(path: string, size: number): Promise<string | null>
    /** Live microphone dictation (SpeechAnalyzer). `start` resolves once listening (rejects if the microphone
     *  or speech model isn't available); text streams as `native:dictation`; `stop` resolves after the last
     *  final text, `cancel` drops what's pending. PLAN.md "Voice → Dictation". */
    dictate(action: 'start' | 'stop' | 'cancel'): Promise<void>
  }

  shell: {
    /** Opens an http(s)/mailto URL in the default app. */
    openExternal(url: string): Promise<void>
  }

  /** OnboardingWindow: the first run in its own full-screen window over the desktop. */
  onboarding: {
    /** Replay: clears `onboarded` and opens the window (no-op while it's open). */
    show(): Promise<void>
    /** Sets `onboarded`, closes the window, brings the main window forward. The page fades itself out first. */
    finish(): Promise<void>
    /** OnboardingWindow.stepAside: drop below other apps while a browser sign-in runs; false restores and refocuses. */
    stepAside(aside: boolean): Promise<void>
  }

  /** Absolute path of a dropped/picked File (Electron 32+ has no File.path). Synchronous, preload only:
   *  `webUtils.getPathForFile`. Returns "" for files that aren't on disk. */
  pathForFile(file: File): string

  /** The phone bridge (src/main/bridge.ts): PHONE_METHODS over HTTP for the iPhone and Android apps. */
  phone: {
    status(): Promise<PhoneStatus>
    /** Turns it on or off; remembered across launches (defaults "phoneBridge"). */
    setEnabled(on: boolean): Promise<PhoneStatus>
    /** A new pairing token (Keychain "phone"); the old one stops working and open phone streams drop. */
    newToken(): Promise<string>
  }

  /** Subscribes to a push event from main; returns the unsubscribe function. */
  on<E extends keyof BridleEvents>(event: E, listener: (payload: BridleEvents[E]) => void): () => void
}

/** Push events, main → renderer (`webContents.send(event, payload)`). */
export interface BridleEvents {
  /** One AgentEvent of a running reply. */
  'agent:event': { chatId: string; event: AgentEvent }
  /** Progress of composio.link. */
  'composio:link': LinkProgress
  /** The watcher posted to Home: reload that chat. */
  'watcher:home': { chatId: string }
  /** A notification or notch row was clicked: open this chat or Code workspace. */
  'notify:opened': { chatId: string } | { workspaceId: string }
  /** A menu command: File → Open… picked `path`, Mute Interface Sounds. */
  'menu:command': { command: 'open'; path: string } | { command: 'mute'; muted: boolean }
  /** Onboarding finished: settings it wrote (names, onboarded) are fresh, re-read them. */
  'onboarding:done': Record<string, never>
  /** Code: a workspace chat changed (a turn started or ended, a card came or went). */
  'code:chat': { workspaceId: string; chat: Chat }
  /** Code: one message changed (streaming text, trace, todos, subagents). */
  'code:message': { workspaceId: string; chatId: string; message: Message }
  /** Code: a workspace agent's state. */
  'code:agent': CodeAgentState
  /** Code: dev tools state (output text arrives separately as `code:output`). */
  'code:tools': Omit<DevToolsState, 'output' | 'setupLog'>
  /** Code: appended setup or run output; `reset` replaces what was there. */
  'code:output': { workspaceId: string; kind: 'setup' | 'run'; text: string; reset?: boolean }
  /** Code: workspaces or spaces changed (created, archived, renamed). */
  'code:workspaces': Record<string, never>
  /** Code: terminal output, or its exit. */
  'code:term': { termId: string; data?: string; exited?: boolean }
  /** Main asks the main window to send `text` in chat `chatId` (made, titled `title`, if new): routines, loops, task runs. */
  'agent:start': { chatId: string; title: string; text: string }
  /** Tasks changed outside the board (a task run): reload them. */
  'tasks:changed': Record<string, never>
  /** Dictation: `text` is the current partial (final false) or a committed piece (final true); `error` ends it. */
  'native:dictation': { text?: string; final?: boolean; error?: string }
}

export type InvokeAPI = Omit<BridleAPI, 'on' | 'pathForFile'>
export type GroupName = keyof InvokeAPI

/**
 * Every invokable method, by group. Typed so that adding a method to BridleAPI without listing it
 * here (or listing one that doesn't exist) fails typecheck. Preload and main both walk this.
 */
export const API_METHODS: { [G in GroupName]: { [M in keyof InvokeAPI[G]]: true } } = {
  workspace: {
    path: true, loadChats: true, saveChat: true, listFiles: true, readFile: true, trashFile: true,
    addFiles: true, pickFiles: true, openPath: true, revealInFinder: true, createFolder: true
  },
  settings: { all: true, get: true, set: true },
  keychain: { get: true, set: true },
  composio: { accounts: true, link: true, cancelLink: true, disconnect: true, execute: true, mcpServer: true },
  gmail: { load: true, label: true, trash: true },
  calendar: { events: true, rsvp: true },
  tasks: {
    list: true, add: true, update: true, move: true, delete: true,
    sendToLinear: true, syncLinear: true, linearDetail: true, run: true
  },
  mcp: { list: true, add: true, remove: true, set: true },
  side: { resize: true },
  automations: { routines: true, loops: true, setEnabled: true, approve: true, runNow: true },
  agent: { run: true, respondPermission: true, cancel: true, perform: true, chatTitle: true },
  watcher: { status: true, checkNow: true, briefNow: true, prepNote: true, savedPrep: true, homeChatId: true },
  away: { send: true },
  notify: { post: true },
  search: { refresh: true, query: true },
  viewer: { inspect: true, list: true, save: true, icon: true },
  memory: { prompt: true, apply: true },
  avatar: { get: true, choose: true, remove: true },
  lmStudio: { models: true },
  about: { claudeBinary: true, composioKeySource: true },
  code: {
    spaces: true, addSpace: true, removeSpace: true, trustSpace: true, isRepo: true, initRepo: true,
    workspaces: true, createWorkspace: true, archiveWorkspace: true, renameWorkspace: true, dirty: true,
    changes: true, diff: true, revert: true, createPR: true, pullRequest: true, listDir: true,
    chats: true, send: true, stop: true, answerPlan: true, respond: true,
    tools: true, run: true, stopRun: true, clearOutput: true, runSetup: true,
    termOpen: true, termWrite: true, termResize: true, termClose: true,
    githubRepos: true, clone: true, prefs: true, setPref: true
  },
  native: { thumbnail: true, dictate: true },
  shell: { openExternal: true },
  onboarding: { show: true, finish: true, stepAside: true },
  phone: { status: true, setEnabled: true, newToken: true }
}

/** What a paired phone may call through the bridge. Not here: settings writes (the approval policy),
 *  the Keychain, raw Composio, Code (terminals), the Mac's own UI (pickers, Finder, onboarding). */
export const PHONE_METHODS: { [G in GroupName]?: readonly (keyof InvokeAPI[G])[] } = {
  workspace: ['path', 'loadChats', 'saveChat', 'listFiles', 'readFile'], // readFile: workspace files only
  settings: ['all', 'get'],
  composio: ['accounts'],
  gmail: ['load'],
  calendar: ['events', 'rsvp'],
  tasks: ['list', 'add', 'update', 'move', 'delete', 'sendToLinear', 'syncLinear', 'linearDetail'],
  agent: ['run', 'respondPermission', 'cancel', 'perform', 'chatTitle'],
  watcher: ['status', 'checkNow', 'briefNow', 'prepNote', 'savedPrep', 'homeChatId'],
  search: ['query'],
  avatar: ['get']
}

/** What a paired phone hears on GET /v1/events. */
export const PHONE_EVENTS: readonly (keyof BridleEvents)[] = ['agent:event', 'watcher:home']

/** The IPC channel for one method: "workspace:loadChats". */
export const channel = (group: string, method: string): string => `${group}:${method}`

declare global {
  interface Window {
    bridle: BridleAPI
  }
}
