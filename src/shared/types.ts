// Data types shared by main, preload and renderer. Everything here is
// plain JSON: dates are ISO-8601 strings, URLs and paths are strings, so values cross
// IPC and land on disk unchanged.
//
// Where the keys on disk differ from these field names (chat JSONL, watch.json), the
// on-disk shape is documented on the type; the main-process services translate.

/** ISO-8601 timestamp, e.g. "2026-10-09T14:03:11Z" (no fractional seconds). */
export type ISODate = string

// MARK: Chat

export type Role = 'user' | 'assistant' | 'tool'

/** Something the agent wants done outside the workspace, pending approval.
 *  `kind` is "email" | "event" | "task"; fields are the ```bridle:<kind>``` JSON block, stringified. */
export interface AgentAction {
  kind: string
  fields: Record<string, string>
}

export interface FileChange {
  path: string
  added: number
  removed: number
}

export interface Todo {
  title: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface Subagent {
  id: string
  name: string
  description: string
  state: 'running' | 'done' | 'failed'
  trace: string[]
  startedAt: ISODate
  endedAt?: ISODate | null
  agentID?: string | null
  activity?: string | null
}

/**
 * One turn of a chat.
 *
 * On disk (one JSONL line, sorted keys, no escaped slashes):
 *   id → "turn_id" (UUID, UPPERCASE), text → "content", date → "created_at",
 *   files → "files" as file:// URL strings, the rest under their own names.
 *   `workers` and `status` are live-only and never written; turns with a `status` are skipped on save.
 *   Always write turn_id, role, content, created_at, files and trace: a line missing any of them is invalid.
 */
export interface Message {
  id: string
  role: Role
  text: string
  /** user: attachments (absolute paths), copied into user/files/. */
  files?: string[]
  /** What the agent did: "searched workspace · 6 results". */
  trace?: string[]
  /** tool: the confirm card's question. */
  title?: string | null
  /** tool: SF Symbol name for the card (map to an icon in the renderer). */
  icon?: string | null
  /** tool: the confirm button's label. */
  confirm?: string | null
  /** tool: what the agent wants done, pending approval. */
  action?: AgentAction | null
  /** tool: an allowed permission card that folded away. */
  dismissed?: boolean | null
  approved?: boolean | null
  date: ISODate
  /** Live only: worker ids shown in the avatar stack while working. */
  workers?: string[]
  /** Live only: non-null while the agent is working ("Thinking", "Reading files"). */
  status?: string | null
  /** assistant, from the watcher: what it messaged you about, for the agent. */
  source?: string | null
  changes?: FileChange[] | null
  plan?: string | null
  todos?: Todo[] | null
  subagents?: Subagent[] | null
  ended?: ISODate | null
  /** The tool calls behind `trace` lines (`step` is the line's index), so a line opens to what it sent and got back. */
  calls?: ToolCall[] | null
}

/** One tool call, its input and result as text, each capped at CALL_TEXT_LIMIT characters. */
export interface ToolCall {
  /** The CLI's tool_use id. */
  id: string
  step: number
  tool: string
  input: string
  result?: string | null
  error?: boolean | null
}

export const CALL_TEXT_LIMIT = 4000

/**
 * On disk: chats/<id lowercased>.jsonl, or goals/<slug>/chats/<id>.jsonl for a
 * chat filed under a project. Line 1 is the header {"id","title","session_id"}, then one Message per line.
 */
export interface Chat {
  id: string
  title: string
  messages: Message[]
  /** Claude CLI session, resumed on the next turn (header "session_id"). */
  sessionID?: string | null
  /** Derived from the file's location, not stored: the goals/<slug> it lives in, so saveChat writes it back there. */
  project?: string | null
  /** File mtime, for "Recent" ordering before any message dates exist. */
  modified?: ISODate
}

// MARK: Mail

export type Mailbox = 'Inbox' | 'Starred' | 'Snoozed' | 'Sent' | 'Drafts' | 'Archive' | 'Trash'

export const MAILBOXES: readonly Mailbox[] = ['Inbox', 'Starred', 'Snoozed', 'Sent', 'Drafts', 'Archive', 'Trash']

export interface Mail {
  /** The gmailID when there is one. */
  id: string
  from: string
  email: string
  subject: string
  /** Plain text; `html` is rendered in the reader when present. */
  body: string
  /** "4:50 PM" today, else "Oct 4". */
  time: string
  /** The message timestamp, for sorting. */
  date?: ISODate
  unread: boolean
  starred: boolean
  mention: boolean
  attachment: boolean
  mailbox: Mailbox
  /** A reply the agent already drafted. */
  draft?: string | null
  /** The Gmail address it belongs to. */
  account: string
  gmailID?: string | null
  html?: string | null
  /** Gmail's one-line preview. */
  snippet?: string | null
}

// MARK: Connections

export type Toolkit =
  | 'gmail' | 'googlecalendar' | 'googledrive' | 'googledocs' | 'googlesheets'
  | 'googleslides' | 'googlemeet' | 'googletasks' | 'github' | 'linear'

export type Service = 'google' | 'github' | 'linear'

/** Toolkit display names and tints. */
export const TOOLKITS: Record<Toolkit, { name: string; tint: string }> = {
  gmail: { name: 'Gmail', tint: '#D93025' },
  googlecalendar: { name: 'Calendar', tint: '#1A73E8' },
  googledrive: { name: 'Drive', tint: '#188038' },
  googledocs: { name: 'Docs', tint: '#1A73E8' },
  googlesheets: { name: 'Sheets', tint: '#188038' },
  googleslides: { name: 'Slides', tint: '#E37400' },
  googlemeet: { name: 'Meet', tint: '#00796B' },
  googletasks: { name: 'Tasks', tint: '#1A73E8' },
  github: { name: 'GitHub', tint: '#1A1B1E' },
  linear: { name: 'Linear', tint: '#5E6AD2' }
}

/** Each service: name, blurb, `core` (linked on Add), `all` (linkable later). */
export const SERVICES: Record<Service, { name: string; blurb: string; core: Toolkit[]; all: Toolkit[] }> = {
  google: {
    name: 'Google',
    blurb: 'Gmail, Calendar and Drive',
    core: ['gmail', 'googlecalendar', 'googledrive'],
    all: ['gmail', 'googlecalendar', 'googledrive', 'googledocs', 'googlesheets', 'googleslides', 'googlemeet', 'googletasks']
  },
  github: { name: 'GitHub', blurb: 'Repos, issues and pull requests', core: ['github'], all: ['github'] },
  linear: { name: 'Linear', blurb: 'Issues, projects and cycles', core: ['linear'], all: ['linear'] }
}

/** One Composio connected account. */
export interface Grant {
  /** Composio connected account ID (ca_…). */
  id: string
  toolkit: Toolkit
  /** ACTIVE and not disabled. */
  ok: boolean
}

/** Every grant for one sign-in identity, grouped by displayName. */
export interface Account {
  /** "<service>:<login>" */
  id: string
  service: Service
  /** Composio's displayName: the address or username. */
  login: string
  grants: Grant[]
  /** Profile photo URL (cached in defaults "googlePhotos"). */
  photo?: string | null
}

/** A running link's progress, streamed as `composio:link` events while a link runs. */
export interface LinkProgress {
  service: Service
  /** null when adding a new account. */
  account: string | null
  steps: Toolkit[]
  done: number
  /** Set when the flow ends: 'done', 'cancelled', or an error message. */
  finished?: 'done' | 'cancelled' | { error: string }
}

// MARK: Calendar

export interface Guest {
  email: string
  name?: string | null
  /** accepted | declined | tentative | needsAction */
  status: string
  organizer: boolean
  me: boolean
}

export interface CalendarEvent {
  /** Google event id. Meetings key events as `${account}|${id}`. */
  id: string
  /** The Google address it came from. */
  account: string
  /** Composio grant id used to fetch (and RSVP to) it. */
  grant: string
  title: string
  start: ISODate
  end: ISODate
  allDay: boolean
  location?: string | null
  notes?: string | null
  meeting?: { url: string; name: string; code?: string | null } | null
  /** The event in Google Calendar. */
  link?: string | null
  guests: Guest[]
}

export type RSVP = 'accepted' | 'declined' | 'tentative'

// MARK: Tasks

/** Task statuses, exactly as written to front matter. */
export type TaskStatus = 'backlog' | 'in progress' | 'needs review' | 'done'

export const TASK_STATUSES: readonly { status: TaskStatus; title: string; tint: string }[] = [
  { status: 'backlog', title: 'Backlog', tint: '#7F8286' },
  { status: 'in progress', title: 'In progress', tint: '#4A4C50' },
  { status: 'needs review', title: 'Needs review', tint: '#E8A200' },
  { status: 'done', title: 'Done', tint: '#1E9E5A' }
]

/** Present on issues synced from Linear. */
export interface LinearRef {
  id: string
  /** DUV-42 */
  identifier: string
  url: string
  teamID: string
  /** Team name, shown as a tag. */
  team: string
  /** Linear's own state name. */
  state: string
  /** Composio connected account. */
  grant: string
}

/**
 * A task. Yours: tasks/<id>.md (front matter status/tags/updated, then "# Title", then notes).
 * Linear's: cached in .bridle/linear.json as a JSON array of TaskItem (iso8601 dates).
 */
export interface TaskItem {
  /** A lowercase UUID for yours, "linear:<issue id>" for Linear's. */
  id: string
  title: string
  notes: string
  status: TaskStatus
  tags: string[]
  updated: ISODate
  linear?: LinearRef | null
  /** The chat Bridle works the task in (front matter `chat`), once it has run. */
  chat?: string | null
}

/** What the task detail panel shows for a Linear issue. */
export interface LinearDetail {
  description: string
  priority?: string | null
  assignee?: string | null
  creator?: string | null
  project?: string | null
  cycle?: string | null
  due?: string | null
  created?: ISODate | null
  labels: string[]
  comments: { author: string; body: string; date: ISODate }[]
}

// MARK: Files

export type FileKind = 'documents' | 'spreadsheets' | 'presentations' | 'images' | 'pdfs' | 'other'

export interface WorkspaceFile {
  /** Absolute path. */
  path: string
  name: string
  kind: FileKind
  size: number
  modified: ISODate
  opened: ISODate
  /** Bridle's own: persona and memory, chats, tasks, notes, .bridle state. */
  system: boolean
}

// MARK: MCP (src/main/services/mcp.ts)

/** One of your MCP servers in .bridle/mcp.json. */
export interface McpServer {
  name: string
  kind: 'command' | 'http' | 'sse'
  /** The command line, or the URL. */
  target: string
  enabled: boolean
  /** Its tools run without asking. */
  trust: boolean
  /** What the Claude CLI last reported ("connected", "failed", "needs-auth"…); null until a chat has used it. */
  status: string | null
}

// MARK: Automations (src/main/automations.ts)

/** routines/<slug>.md: a prompt the agent runs on a schedule, in its own chat. */
export interface Routine {
  slug: string
  title: string
  /** As written: "weekdays 08:00", "daily 7:30", "mon, thu 16:00". */
  when: string
  /** The schedule parses. */
  valid: boolean
  enabled: boolean
  lastRun: ISODate | null
  chatId: string | null
}

/** loops/<slug>/: check.sh runs every `every`; when its output changes, the agent wakes with LOOP.md's instructions. */
export interface Loop {
  slug: string
  title: string
  every: string
  enabled: boolean
  /** The script as it is now; it runs only once you've approved this exact text. */
  script: string
  approved: boolean
  lastRun: ISODate | null
  /** The last check's output or error, for Settings. */
  lastOutput: string | null
  chatId: string | null
}

// MARK: Agent

/** Approval policies (settings key "approvalPolicy"). */
export type ApprovalPolicy = 'Always ask' | 'Allow app actions' | 'Allow everything'

/** Providers (settings key "provider"). */
export type Provider = 'Claude CLI' | 'LM Studio' | 'OpenRouter' | 'Local' | 'Mock'

/** What each provider offers and the setting holding its choice.
 *  LM Studio and Local share the `localModel` setting; LM Studio lists its models live (lmStudio.models). */
export const PROVIDERS: Record<Provider, { models: string[]; modelKey: 'model' | 'openRouterModel' | 'localModel' | null }> = {
  'Claude CLI': { models: ['Claude Opus', 'Claude Sonnet', 'Claude Haiku'], modelKey: 'model' },
  'LM Studio': { models: [], modelKey: 'localModel' },
  OpenRouter: {
    models: ['anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5',
      'openai/gpt-5.6-luna', 'google/gemini-3.8-flash', 'deepseek/deepseek-v4.1-flash', 'x-ai/grok-4.7'],
    modelKey: 'openRouterModel'
  },
  Local: { models: [], modelKey: 'localModel' },
  Mock: { models: ['Mock'], modelKey: null }
}

/** A model LM Studio has downloaded (Settings → Models). */
export interface LocalModel {
  /** Its key, e.g. "openai/gpt-oss-20b". */
  id: string
  name: string
  loaded: boolean
  /** The most context it can hold, in tokens. */
  context: number | null
  /** Trained for tool calls: the agent works best with these. */
  tools: boolean
}

/** A permission request: answer with `agent.respondPermission(requestId, allow)`. */
export interface PermissionRequest {
  requestId: string
  tool: string
  /** "Run a command?" */
  title: string
  /** The command, file, or URL. */
  detail: string
  /** The tool's arguments, for the card's per-tool layout. */
  input: Record<string, unknown>
  /** Set when a subagent asks (the CLI's task id). */
  agentID?: string | null
}

/** One event of a streaming reply; `done` / `error` end the stream. */
export type AgentEvent =
  | { type: 'session'; session: string }
  | { type: 'status'; status: string }
  | { type: 'trace'; line: string; call?: { id: string; tool: string; input: string } }
  | { type: 'result'; id: string; result: string; error: boolean }
  | { type: 'worker'; worker: string }
  | { type: 'text'; text: string }
  | { type: 'permission'; request: PermissionRequest }
  | { type: 'done' }
  | { type: 'error'; message: string }

// MARK: Watcher

/**
 * The watcher's state, .bridle/watch.json. CAUTION on disk: every Date is a number of seconds since
 * 2001-01-01 (Apple's reference date), not ISO. `chatID` is an uppercase UUID. Services convert to/from ISODate here.
 */
export interface WatchState {
  seen: Record<string, ISODate>
  baselined: string[]
  notified: ISODate[]
  chatID?: string | null
  /** The day ("2026-10-09") the morning briefing went out. */
  briefed?: string | null
  /** event id → when its prep note went out. */
  prepped: Record<string, ISODate>
}

/** What Settings → Connections shows about the watcher. */
export interface WatcherStatus {
  enabled: boolean
  checking: boolean
  lastChecked?: ISODate | null
  lastResult?: string | null
  homeChatID?: string | null
}

/** The phone bridge (Settings → General → Phone). */
export interface PhoneStatus {
  enabled: boolean
  /** Where a paired phone reaches this Mac (http://<Tailscale IPv4>:47811), while it's listening. */
  url: string | null
  /** A pairing token exists. */
  paired: boolean
  /** Why it isn't listening although enabled (no Tailscale, port taken). */
  error: string | null
}

// MARK: Settings (defaults domain "Bridle")

/** Every app preference, by its key in the macOS defaults domain "Bridle". */
export interface Settings {
  workspace: string
  onboarded: boolean
  userName: string
  userEmail: string
  agentName: string
  provider: Provider
  /** Claude CLI model: "Claude Opus" | "Claude Sonnet" | "Claude Haiku". */
  model: string
  openRouterModel: string
  localModel: string
  localEndpoint: string
  embeddings: string
  approvalPolicy: ApprovalPolicy
  soundMuted: boolean
  soundVolume: number
  /** A soft key tick while a reply streams in. */
  soundStreaming: boolean
  /** The section sidebar folded away (titlebar toggle, ⌘\). */
  sidebarHidden: boolean
  autoIndex: boolean
  notifyApprovals: boolean
  notifyDone: boolean
  notifyMail: boolean
  watchEnabled: boolean
  briefingEnabled: boolean
  briefingHour: number
  prepEnabled: boolean
  awayEnabled: boolean
  awayHandle: string
}

export type SettingKey = keyof Settings

/** Defaults when a key was never set. */
export const DEFAULT_SETTINGS: Settings = {
  workspace: '~/Bridle',
  onboarded: false,
  userName: '',
  userEmail: '',
  agentName: 'Bridle',
  provider: 'Claude CLI',
  model: 'Claude Opus',
  openRouterModel: 'anthropic/claude-sonnet-5.5',
  localModel: 'llama3',
  localEndpoint: '',
  embeddings: 'On-device',
  approvalPolicy: 'Always ask',
  soundMuted: false,
  soundVolume: 0.5,
  soundStreaming: false,
  sidebarHidden: false,
  autoIndex: true,
  notifyApprovals: true,
  notifyDone: true,
  notifyMail: true,
  watchEnabled: true,
  briefingEnabled: true,
  briefingHour: 8,
  prepEnabled: true,
  awayEnabled: false,
  awayHandle: ''
}

// MARK: Search, viewer, memory

/** One search passage, with the absolute path of its file and its first line (1-based). */
export interface SearchHit {
  path: string
  line: number
  text: string
}

/** How the file viewer shows a path (folder list, markdown/text, else Quick Look). */
export type ViewerKind = 'folder' | 'markdown' | 'text' | 'image' | 'pdf' | 'other'

export interface ViewerItem {
  path: string
  name: string
  kind: ViewerKind
  size: number
}

/** One row of the viewer's folder list. */
export interface FolderEntry {
  path: string
  name: string
  folder: boolean
  /** Bytes (0 for a folder) and the ISO time it last changed. */
  size?: number
  modified?: string
}

/** Where imported memory comes from. */
export type MemorySource = 'ChatGPT' | 'Claude Code'

// MARK: Code

/** A repo you work on in Code. On disk spaces/<slug>/space.json, with `root` as a file:// URL string;
 *  here it's an absolute path. */
export interface Space {
  slug: string
  name: string
  /** The repo folder. */
  root: string
  /** Its .claude settings, CLAUDE.md and hooks may load (asked on first open). */
  trusted: boolean
  /** "Always allow" rules, e.g. "Bash(swift test:*)". */
  allowedCommands: string[]
  engine: string
  /** Runs in each new workspace (else the repo's .bridle/setup.sh). */
  setupScript?: string | null
  /** From defaults "spaceTrustAsked.<slug>": the trust card was answered. */
  trustAsked?: boolean
}

/** One task, a git worktree on branch bridle/<name>.
 *  On disk spaces/<repo>/workspaces/<name>/workspace.json (`path` as a file:// URL, `created` ISO). */
export interface Workspace {
  /** "repo/name" */
  id: string
  /** Space slug. */
  repo: string
  /** "lisbon": the worktree folder and branch suffix. */
  name: string
  branch: string
  /** What it branched from and diffs against: "origin/main" or "main". */
  base: string
  /** "New workspace" until the first message names it. */
  title: string
  /** The worktree folder. */
  path: string
  created: ISODate
}

/** A file changed vs. the merge-base: status "M" | "A" | "D" | "U" (untracked) | "R". */
export interface ChangedFile {
  path: string
  status: string
  added: number
  removed: number
}

/** One diff line (1-based line numbers, null on the side a line isn't on). */
export interface DiffLine {
  kind: 'context' | 'removed' | 'added'
  old: number | null
  new: number | null
  text: string
}

export interface DiffHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
}

/** A run configuration: `name` is what the Run menu shows (and its identity). */
export interface RunConfig {
  name: string
  command: string
}

export interface GitHubRepo {
  /** "owner/name" */
  fullName: string
  name: string
  summary?: string | null
  isPrivate: boolean
  cloneURL: string
  sshURL: string
  pushed?: ISODate | null
}

/** CodeComposer's Plan toggle: plan → `--permission-mode plan`, build → acceptEdits. */
export type CodeMode = 'plan' | 'build'

/** The code agent's state, per workspace. */
export interface CodeAgentState {
  workspaceId: string
  running: boolean
  /** The chat the running turn belongs to. */
  runningChat: string | null
  /** The reply whose plan awaits Approve / Revise. */
  planWaiting: string | null
  /** Permission cards (message ids) the agent is waiting on. */
  pending: string[]
}

/** Run and setup state, per workspace. Output arrives as `code:output` deltas. */
export interface DevToolsState {
  workspaceId: string
  configs: RunConfig[]
  running: RunConfig | null
  last: RunConfig | null
  serverURL: string | null
  /** How the last run ended on its own; null while running or after Stop. */
  exitCode: number | null
  output: string
  setupLog: string
  settingUp: boolean
  /** A setup script exists (Space.setupScript or .bridle/setup.sh). */
  hasSetup: boolean
}

/** One FileTree row. */
export interface DirEntry {
  path: string
  name: string
  folder: boolean
}

/** Code-only preferences in the "Bridle" defaults domain (CodeScreen, WorkspacePanel, ModelPicker, CloneSheet). */
export interface CodePrefs {
  codeEffort: string
  codePlanMode: boolean
  cloneFolder: string
  codePanelWidth: number
  codePanelShown: boolean
  workspaceBottomHeight: number
  workspaceBottomShown: boolean
}

export const DEFAULT_CODE_PREFS: CodePrefs = {
  codeEffort: '',
  codePlanMode: false,
  cloneFolder: '~/Developer',
  codePanelWidth: 360,
  codePanelShown: true,
  workspaceBottomHeight: 260,
  workspaceBottomShown: true
}
