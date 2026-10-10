import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { Chat, Message } from '../../shared/types'

// Code's logic, against temp folders and temp git repos only.
const ws = realpathSync(mkdtempSync(join(tmpdir(), 'bridle-code-ws-')))
vi.mock('electron', () => ({ app: { on: () => {} }, shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../services/settings', () => ({
  settings: { get: async (k: string) => ({ workspace: ws, approvalPolicy: 'Always ask', agentName: 'Bridle', userName: '' } as Record<string, unknown>)[k] },
  pref: async () => undefined,
  setPref: async () => {}
}))

const { CITIES, freeCity, freeSlug, addSpace, createWorkspace, archiveWorkspace, loadWorkspaces, changes, diff, revert, decodeSpace, parseRepos, listDir } = await import('./spaces')
const { parseChanges, parseNumstat, parseUnified, countLines, snapshot, numstat, snapshotRef, compareURL, git } = await import('./git')
const rc = await import('./runconfigs')
const { rule, allowed, codeAllows, fold, displayName, readChats, writeChat } = await import('./agent')
const { decodeChat, encodeChat } = await import('../services/workspace')
const tools = await import('./tools')

const sh = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })

function tempRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bridle-code-repo-')))
  sh(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(dir, '.gitignore'), '.env\n')
  writeFileSync(join(dir, '.env'), 'SECRET=1\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'first')
  return dir
}

describe('names (workspace cities, repo slugs)', () => {
  it('picks a city and numbers it while taken', async () => {
    expect(CITIES).toHaveLength(70)
    expect(await freeCity(async () => false, () => 0)).toBe('lisbon')
    const taken = new Set(['lisbon', 'lisbon-2'])
    expect(await freeCity(async (n) => taken.has(n), () => 0)).toBe('lisbon-3')
    expect(await freeCity(async () => false, () => 0.999)).toBe('austin')
  })

  it('slugs a repo folder and avoids clashes', () => {
    expect(freeSlug('My Repo', [])).toBe('my-repo')
    expect(freeSlug('My Repo', ['my-repo', 'my-repo-2'])).toBe('my-repo-3')
    expect(freeSlug('!!!', [])).toBe('space')
  })
})

describe('space.json and workspace.json', () => {
  it.skipIf(process.platform === 'win32')('reads a stored space with a file URL root', () => {
    const s = decodeSpace(JSON.parse('{"allowedCommands":["Bash(npm test:*)"],"engine":"claude","name":"lcb","root":"file:///Users/me/code/lcb%20x/","slug":"lcb","trusted":true}'))
    expect(s).toEqual({ slug: 'lcb', name: 'lcb', root: '/Users/me/code/lcb x', trusted: true, allowedCommands: ['Bash(npm test:*)'], engine: 'claude', setupScript: null })
  })
})

describe('worktrees (create / refresh / diff / revert / archive)', () => {
  it('creates bridle/<city> in .bridle/worktrees, tracks changes, reverts and archives', async () => {
    const repo = tempRepo()
    const space = await addSpace(repo)
    expect(await addSpace(join(repo, 'a.txt'))).toEqual(space) // a file adds its folder, once
    const saved = JSON.parse(readFileSync(join(ws, 'spaces', space.slug, 'space.json'), 'utf8'))
    expect(saved.root).toBe(pathToFileURL(repo).href)

    const w = await createWorkspace(space)
    expect(CITIES).toContain(w.name)
    expect(w.branch).toBe(`bridle/${w.name}`)
    expect(w.base).toBe('main')
    expect(w.path).toBe(join(ws, '.bridle/worktrees', space.slug, w.name))
    expect(sh(w.path, 'branch', '--show-current').trim()).toBe(w.branch)
    expect(readFileSync(join(w.path, '.env'), 'utf8')).toBe('SECRET=1\n') // gitignored .env* copied in
    const record = JSON.parse(readFileSync(join(ws, 'spaces', space.slug, 'workspaces', w.name, 'workspace.json'), 'utf8'))
    expect(record).toMatchObject({ repo: space.slug, name: w.name, branch: w.branch, base: 'main', title: 'New workspace', path: pathToFileURL(w.path).href })
    expect((await loadWorkspaces()).map((x) => x.id)).toContain(w.id)

    // A second one never reuses the name or branch.
    const w2 = await createWorkspace(space)
    expect(w2.name).not.toBe(w.name)

    writeFileSync(join(w.path, 'a.txt'), 'one\n2\nthree\nfour\n')
    writeFileSync(join(w.path, 'new.txt'), 'x\ny\n')
    expect(await changes(w)).toEqual([
      { path: 'a.txt', status: 'M', added: 2, removed: 1 },
      { path: 'new.txt', status: 'U', added: 2, removed: 0 }
    ])
    const hunks = await diff(w, 'a.txt')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].lines.map((l) => l.kind[0] + l.text)).toEqual(['cone', 'rtwo', 'a2', 'cthree', 'afour'])
    expect((await diff(w, 'new.txt'))[0].lines.map((l) => l.text)).toEqual(['x', 'y'])

    await revert(w, 'a.txt')
    await revert(w, 'new.txt')
    expect(await changes(w)).toEqual([])
    expect(existsSync(join(w.path, 'new.txt'))).toBe(false)

    writeFileSync(join(w.path, 'a.txt'), 'dirty\n')
    await expect(archiveWorkspace(w, false)).rejects.toThrow('uncommitted changes')
    await archiveWorkspace(w, true)
    expect(existsSync(w.path)).toBe(false)
    expect(sh(repo, 'branch', '--list', w.branch).trim()).toContain(w.branch) // the branch stays
    expect((await loadWorkspaces()).map((x) => x.id)).not.toContain(w.id)
    await archiveWorkspace(w2, true)
  })

  it('lists a folder for the tree: folders first, no .git', async () => {
    const repo = tempRepo()
    mkdirSync(join(repo, 'src'))
    expect((await listDir(repo)).map((e) => `${e.folder ? 'd' : 'f'}:${e.name}`)).toEqual(['d:src', 'f:.env', 'f:.gitignore', 'f:a.txt'])
  })
})

describe('snapshots', () => {
  it('commits the tree through a throwaway index and counts what a turn changed', async () => {
    const repo = tempRepo()
    const head = sh(repo, 'rev-parse', 'HEAD')
    const before = await snapshot(repo, snapshotRef('r/lisbon', 'ABC', 'before'))
    writeFileSync(join(repo, 'a.txt'), 'one\nTWO\nthree\nfour\n')
    writeFileSync(join(repo, 'b.txt'), 'new\n')
    const after = await snapshot(repo, snapshotRef('r/lisbon', 'ABC', 'after'))
    expect(before && after).toBeTruthy()
    expect(await numstat(repo, before!, after!)).toEqual([{ path: 'a.txt', added: 2, removed: 1 }, { path: 'b.txt', added: 1, removed: 0 }])
    expect(sh(repo, 'rev-parse', 'HEAD')).toBe(head) // HEAD, index and branches untouched
    expect(sh(repo, 'status', '--porcelain')).toBe(' M a.txt\n?? b.txt\n')
    expect((await git(['rev-parse', 'refs/bridle/r/lisbon/abc-after'], repo)).stdout.trim()).toBe(after)
  })

  it('parses numstat, name-status and unified diffs', () => {
    expect(parseNumstat('3\t1\ta b.txt\0-\t-\timg.png\0')).toEqual([{ path: 'a b.txt', added: 3, removed: 1 }, { path: 'img.png', added: 0, removed: 0 }])
    expect(parseChanges('1\t0\tz.txt\0', 'M\0z.txt\0D\0gone.txt\0', 'b.txt\0', () => 7)).toEqual([
      { path: 'b.txt', status: 'U', added: 7, removed: 0 },
      { path: 'gone.txt', status: 'D', added: 0, removed: 0 },
      { path: 'z.txt', status: 'M', added: 1, removed: 0 }
    ])
    expect(countLines('a\nb\n')).toBe(2)
    expect(countLines('a\nb')).toBe(2)
    expect(countLines('bin\0ary')).toBe(0)
    const h = parseUnified('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -2,2 +2,3 @@ fn\n a\n-b\n+c\n+d\n\\ No newline at end of file\n@@ -0,0 +1 @@\n+z\n')
    expect(h.map((x) => [x.oldStart, x.oldCount, x.newStart, x.newCount])).toEqual([[2, 2, 2, 3], [0, 0, 1, 1]])
    expect(h[0].lines).toEqual([
      { kind: 'context', old: 2, new: 2, text: 'a' }, { kind: 'removed', old: 3, new: null, text: 'b' },
      { kind: 'added', old: null, new: 3, text: 'c' }, { kind: 'added', old: null, new: 4, text: 'd' }
    ])
  })

  it('builds the GitHub compare page', () => {
    expect(compareURL('git@github.com:o/r.git', 'main', 'bridle/x')).toBe('https://github.com/o/r/compare/main...bridle/x?expand=1')
    expect(compareURL('https://user@github.com/o/r/', 'main', 'b')).toBe('https://github.com/o/r/compare/main...b?expand=1')
    expect(compareURL('ssh://git@github.com:22/o/r.git', 'dev', 'b')).toBe('https://github.com/o/r/compare/dev...b?expand=1')
    expect(compareURL('/local/path', 'main', 'b')).toBeNull()
  })

  it('reads GitHub repos wherever the list sits', () => {
    const repos = parseRepos({ data: { details: [{ full_name: 'o/r', name: 'r', private: true, pushed_at: '2026-10-01T00:00:00Z' }] } })
    expect(repos).toEqual([{ fullName: 'o/r', name: 'r', summary: null, isPrivate: true, cloneURL: 'https://github.com/o/r.git', sshURL: 'git@github.com:o/r.git', pushed: '2026-10-01T00:00:00Z' }])
    expect(parseRepos({ nothing: [] })).toEqual([])
  })
})

describe('run configurations', () => {
  it('parses each kind of project file', () => {
    expect(rc.npm('{"scripts":{"test":"x","start":"y","build":"z","dev":"w"}}', new Set(['pnpm-lock.yaml'])).map((c) => c.command))
      .toEqual(['pnpm run dev', 'pnpm run start', 'pnpm run build', 'pnpm run test'])
    expect(rc.npm('{"scripts":{"a":"x"}}', new Set(['bun.lock']))[0].command).toBe('bun run a')
    expect(rc.npm('not json', new Set())).toEqual([])
    expect(rc.makefile('.PHONY: all\nCC := gcc\nall: build\nbuild:\n\techo hi\ntest-x: \n')).toEqual([
      { name: 'make all', command: 'make all' }, { name: 'make build', command: 'make build' }, { name: 'make test-x', command: 'make test-x' }
    ])
    expect(rc.procfile('# comment\nweb: npm start\nworker:  node w.js \nbad\n')).toEqual([{ name: 'web', command: 'npm start' }, { name: 'worker', command: 'node w.js' }])
    expect(rc.pyproject('[project]\nname="x"\n[project.scripts]\n"serve" = "x:main"\n# c = d\n[tool.other]\nno = 1\n', new Set(['uv.lock'])))
      .toEqual([{ name: 'serve', command: 'uv run serve' }])
    expect(rc.swiftExecutables('.executable(name: "App", targets: ["App"]), .executableTarget(name: "Other")')).toEqual(['App'])
    expect(rc.swiftExecutables('.executableTarget(\n  name: "Other")')).toEqual(['Other'])
    expect(rc.userDefined('[{"name":"api","command":"go run ."},{"name":"bad"}]')).toEqual([{ name: 'api', command: 'go run .' }])
  })

  it('detects from a folder, .bridle/run.json first, names unique', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridle-code-run-'))
    mkdirSync(join(dir, '.bridle'))
    writeFileSync(join(dir, '.bridle/run.json'), '[{"name":"dev","command":"custom dev"}]')
    writeFileSync(join(dir, 'package.json'), '{"scripts":{"dev":"vite","lint":"eslint"}}')
    writeFileSync(join(dir, 'Cargo.toml'), '')
    writeFileSync(join(dir, 'Procfile'), 'web: rails s\n')
    expect(await rc.detect(dir)).toEqual([
      { name: 'dev', command: 'custom dev' }, { name: 'lint', command: 'npm run lint' },
      { name: 'cargo run', command: 'cargo run' }, { name: 'web', command: 'rails s' }
    ])
  })

  it('cleans output and finds the dev server (clean / serverURL)', () => {
    expect(rc.clean('\x1b[32mready\x1b[0m in 300ms')).toBe('ready in 300ms')
    expect(rc.clean('10%\r50%\r100%')).toBe('100%')
    expect(rc.serverURL('  ➜  Local:   http://localhost:5173/')).toBe('http://localhost:5173/')
    expect(rc.serverURL('listening on http://0.0.0.0:3000.')).toBe('http://localhost:3000')
    expect(rc.serverURL('see https://example.com:443')).toBeNull()
  })
})

describe('permissions for code turns (saved rules + ApprovalPolicy)', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bridle-code-perm-'))
  const o = { cwd, planning: false, policy: 'Always ask' as const, rules: [] as string[] }

  it('derives "Always allow" rules, never for commits, pushes or chains', () => {
    expect(rule('swift test --filter X')).toBe('Bash(swift test:*)')
    expect(rule('npm run build')).toBe('Bash(npm run:*)')
    expect(rule('ls -la')).toBe('Bash(ls:*)')
    expect(rule('git commit -m x')).toBeNull()
    expect(rule('git push')).toBeNull()
    expect(rule('git -C x status')).toBeNull()
    expect(rule('make && rm -rf /')).toBeNull()
    expect(allowed('npm run build', ['Bash(npm run:*)'])).toBe(true)
    expect(allowed('npm runner', ['Bash(npm run:*)'])).toBe(false)
    expect(allowed('npm run build; curl x', ['Bash(npm run:*)'])).toBe(false)
  })

  it('lets worktree edits through (not while planning) and asks for everything outside', () => {
    expect(codeAllows('Edit', { file_path: join(cwd, 'src/a.ts') }, o)).toBe(true)
    expect(codeAllows('Write', { file_path: 'relative/b.ts' }, o)).toBe(true)
    expect(codeAllows('Edit', { file_path: join(cwd, 'src/a.ts') }, { ...o, planning: true })).toBe(false)
    expect(codeAllows('Edit', { file_path: '/etc/hosts' }, { ...o, policy: 'Allow everything' })).toBe(false)
    expect(codeAllows('Edit', { file_path: join(cwd, '../escape.ts') }, o)).toBe(false)
  })

  it('runs read-only and allowed commands; commits and pushes always ask', () => {
    expect(codeAllows('Bash', { command: 'git status' }, o)).toBe(true)
    expect(codeAllows('Bash', { command: 'npm test' }, o)).toBe(false)
    expect(codeAllows('Bash', { command: 'npm test' }, { ...o, rules: ['Bash(npm test:*)'] })).toBe(true)
    expect(codeAllows('Bash', { command: 'npm test' }, { ...o, policy: 'Allow everything' })).toBe(true)
    expect(codeAllows('Bash', { command: 'git commit -m x' }, { ...o, policy: 'Allow everything', rules: ['Bash(git commit:*)'] })).toBe(false)
    expect(codeAllows('Bash', { command: 'git push origin main' }, { ...o, policy: 'Allow everything' })).toBe(false)
    expect(codeAllows('WebFetch', { url: 'https://x' }, o)).toBe(false)
    expect(codeAllows('WebFetch', { url: 'https://x' }, { ...o, policy: 'Allow everything' })).toBe(true)
  })
})

describe('folding stream lines', () => {
  const base: Message = { id: 'R', role: 'assistant', text: '', date: '2026-10-09T14:00:00Z', trace: [] }
  const t = '2026-10-09T14:00:05Z'

  it('adds subagents, their steps, and ends them', () => {
    let m = fold({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { subagent_type: 'Explore', description: 'Find calc' } }] } }, base, '/r', t)
    expect(m.subagents).toEqual([{ id: 'tu1', name: 'Explorer', description: 'Find calc', state: 'running', trace: [], startedAt: t }])
    m = fold({ type: 'system', subtype: 'task_started', tool_use_id: 'tu1', task_id: 'task9' }, m, '/r', t)
    m = fold({ type: 'assistant', parent_tool_use_id: 'tu1', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/r/calc.py' } }] } }, m, '/r', t)
    m = fold({ type: 'system', subtype: 'task_progress', tool_use_id: 'tu1', description: 'Reading calc.py' }, m, '/r', t)
    expect(m.subagents?.[0]).toMatchObject({ agentID: 'task9', trace: ['read calc.py'], activity: 'Reading calc.py' })
    m = fold({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1' }] } }, m, '/r', t)
    expect(m.subagents?.[0]).toMatchObject({ state: 'done', endedAt: t, activity: null })
    expect(fold({ type: 'stream_event' }, m, '/r')).toBe(m)
  })

  it('keeps the checklist from TodoWrite and TaskCreate / TaskUpdate', () => {
    let m = fold({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'A', status: 'completed' }, { content: 'B' }] } }] } }, base, '/r')
    expect(m.todos).toEqual([{ title: 'A', status: 'completed' }, { title: 'B', status: 'pending' }])
    m = fold({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TaskCreate', input: { subject: 'C' } }] } }, m, '/r')
    m = fold({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TaskUpdate', input: { taskId: '3', status: 'in_progress' } }] } }, m, '/r')
    m = fold({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TaskUpdate', input: { taskId: '1', status: 'deleted' } }] } }, m, '/r')
    expect(m.todos).toEqual([{ title: 'B', status: 'pending' }, { title: 'C', status: 'in_progress' }])
    expect(displayName('general-purpose')).toBe('Worker')
    expect(displayName('code-reviewer')).toBe('Code Reviewer')
  })
})

describe('workspace chat JSONL (same format as main chats)', () => {
  // A Code reply as stored on disk: changes, plan, todos, subagents, ended.
  const swiftFile = [
    '{"id":"9BEB291C-0B28-4457-AFEB-A31D5C6E90A2","session_id":"ecbcc294-e1de-477b-b76b-e128d2750e02","title":"add a test"}',
    '{"content":"add a test","created_at":"2026-10-09T20:25:54Z","files":[],"role":"user","trace":[],"turn_id":"685F4082-669B-4CA3-8EA0-AE0616C546B2"}',
    '{"changes":[{"added":12,"path":"Tests/a.swift","removed":0}],"content":"Done.","created_at":"2026-10-09T20:25:54Z","ended":"2026-10-09T20:26:01Z","files":[],"plan":"# Plan\\n1. Add it","role":"assistant","subagents":[{"agentID":"t1","description":"Look around","endedAt":"2026-10-09T20:25:58Z","id":"toolu_1","name":"Explorer","startedAt":"2026-10-09T20:25:55Z","state":"done","trace":["read a.swift"]}],"todos":[{"status":"completed","title":"Write the test"}],"trace":["edit Tests/a.swift"],"turn_id":"704FE5F0-B7B5-42DB-89F6-0ABAB649D97D"}',
    '{"action":{"fields":{"rule":"Bash(swift test:*)","title":"Run a command?","tool":"Bash"},"kind":"permission"},"approved":true,"content":"swift test","created_at":"2026-10-09T20:25:59Z","dismissed":true,"files":[],"role":"tool","trace":[],"turn_id":"1A2B3C4D-0000-4000-8000-000000000002"}',
    ''
  ].join('\n')

  it('round-trips a stored workspace chat byte for byte, through its chats folder', async () => {
    const chat = decodeChat(swiftFile) as Chat
    expect(chat.messages[1].changes).toEqual([{ path: 'Tests/a.swift', added: 12, removed: 0 }])
    expect(chat.messages[1].subagents?.[0].state).toBe('done')
    expect(encodeChat(chat)).toBe(swiftFile)
    const dir = join(ws, 'spaces/r/workspaces/lisbon/chats')
    await writeChat(dir, chat)
    expect(readFileSync(join(dir, '9beb291c-0b28-4457-afeb-a31d5c6e90a2.jsonl'), 'utf8')).toBe(swiftFile)
    const [back] = await readChats(dir)
    expect(encodeChat(back)).toBe(swiftFile)
  })

  it('never writes a running reply', async () => {
    const chat = decodeChat(swiftFile) as Chat
    chat.messages.push({ id: 'C0FFEE00-0000-4000-8000-000000000000', role: 'assistant', text: '', date: '2026-10-09T20:30:00Z', status: 'Thinking' })
    expect(encodeChat(chat)).toBe(swiftFile)
  })
})

describe('dev tools (run / stop, setup script)', () => {
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 50))
  }

  it('runs a configuration in its own group, finds the dev server, and stops it', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bridle-code-tools-')))
    const w = { id: 't/run', repo: 't', name: 'run', branch: 'bridle/run', base: 'main', title: '', path: dir, created: '2026-10-09T00:00:00Z' }
    const space = { slug: 't', name: 't', root: dir, trusted: false, allowedCommands: [], engine: 'claude' }
    const state = await tools.state(space, w)
    await tools.runConfig(w, { name: 'dev', command: 'printf "\\033[32mready\\033[0m\\nLocal: http://0.0.0.0:5173/\\n"; sleep 30' })
    await until(() => !!state.serverURL)
    expect(state.output).toContain('$ printf')
    expect(state.output).toContain('ready\n')
    expect(state.serverURL).toBe('http://localhost:5173/')
    expect(state.running?.name).toBe('dev')
    tools.stopRun(w.id)
    expect(state.running).toBeNull()

    await tools.runConfig(w, { name: 'fail', command: 'exit 3' })
    await until(() => state.exitCode !== null)
    expect(state.exitCode).toBe(3)
  })

  it.skipIf(process.platform === 'win32')('runs the setup script in the worktree with BRIDLE_ROOT_PATH', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bridle-code-setup-root-')))
    const path = realpathSync(mkdtempSync(join(tmpdir(), 'bridle-code-setup-wt-')))
    mkdirSync(join(root, '.bridle'))
    writeFileSync(join(root, '.bridle/setup.sh'), 'echo "root=$BRIDLE_ROOT_PATH name=$BRIDLE_WORKSPACE_NAME pwd=$(pwd)"\n')
    const w = { id: 't/setup', repo: 't', name: 'setup', branch: 'bridle/setup', base: 'main', title: '', path, created: '2026-10-09T00:00:00Z' }
    const space = { slug: 't', name: 't', root, trusted: false, allowedCommands: [], engine: 'claude' }
    const state = await tools.state(space, w)
    expect(state.hasSetup).toBe(true)
    await tools.runSetup(space, w)
    await until(() => !state.settingUp)
    expect(state.setupLog).toContain(`root=${root} name=setup pwd=${path}`)
    expect(state.setupLog).toContain('Setup finished.')
  })
})

describe('setup', () => {
  it("runs a repo's own setup.sh by itself only once the repo is trusted", async () => {
    const { autoSetup } = await import('./tools')
    const space = { slug: 'r', name: 'r', root: '/r', trusted: false, allowedCommands: [], engine: 'claude', setupScript: null }
    expect(autoSetup(space)).toBe(false)
    expect(autoSetup({ ...space, trusted: true })).toBe(true)
    expect(autoSetup({ ...space, setupScript: 'npm ci' })).toBe(true)
  })

  it('never reverts outside the workspace', async () => {
    const w = { id: 'r/x', repo: 'r', name: 'x', branch: 'bridle/x', base: 'HEAD', title: 't', path: join(ws, 'nowhere'), created: '' }
    await expect(revert(w, '../escape')).rejects.toThrow()
  })
})
