# Security policy

## Supported versions

Only the [latest release](https://github.com/CreatorHive/bridle/releases/latest) gets security fixes. If you run from
source, update to `main`.

## Reporting a vulnerability

Please don't open a public issue for a vulnerability.

- Use GitHub's private vulnerability reporting: on
  [CreatorHive/bridle](https://github.com/CreatorHive/bridle), go to **Security** → **Report a vulnerability**.
- Or email Sean Scott at [sean@sscott.dev](mailto:sean@sscott.dev).

Include the Bridle version, your macOS version, and steps to reproduce. You can expect an acknowledgement within a few
days.

## Threat model

Bridle is an agent that reads your mail, calendar, files and the web, and can act on your behalf. The full rules are
in the [safety model](docs/architecture.md#safety-model) and the
[phone bridge](docs/architecture.md#phone-bridge-srcmainbridgets) sections of the architecture doc. In short:

- **Actions that leave the Mac need approval.** Sending, scheduling, deleting, shell commands and MCP tool calls wait
  for you to approve a card. The approval policy in Settings → Tools can loosen this, but sudo, recursive deletes,
  pushes, piped installs and writes outside the workspace still ask.
- **The agent edits only its workspace freely.** File edits inside `~/Bridle` run without asking; edits anywhere else
  ask.
- **`.bridle/` is protected.** It holds Bridle's own state (MCP servers, loop approvals, settings), and the agent must
  ask before changing it.
- **Text the agent reads is data.** Content from mail, web pages and files is never treated as instructions.
- **Loop scripts need exact-text approval.** A loop's `check.sh` runs only after you approve its exact text; any edit
  needs approving again.
- **MCP calls ask** unless you mark that server "Don't ask".
- **Secrets stay out of argv.** API keys live in the login Keychain. With the Claude CLI, the system prompt and the MCP
  config (which carries keys) are passed through private 0600 temp files, not command-line arguments.
- **The phone bridge is narrow.** It is off by default, listens only on this Mac's Tailscale address, requires a bearer
  token on every request, and serves only the methods and events in the `PHONE_METHODS` / `PHONE_EVENTS` allowlist (no
  settings writes, Keychain, raw Composio, Code or Mac UI; file reads limited to the workspace).

### In scope

- Bypassing an approval: getting an action that should ask to run without a card, or with a card that misstates it.
- Escaping the workspace: a file edit outside `~/Bridle` or under `.bridle/` that runs without asking.
- Getting a command, loop script or MCP call run without the user's consent, including through prompt injection in
  mail, web pages or files.
- Leaking keys or tokens (Keychain values, the phone token, Composio or model keys) to disk, logs, argv or the network.
- Reaching the phone bridge without a valid token, from outside Tailscale, or calling a method outside the allowlist.

### Out of scope

- Actions the user explicitly approved, or allowed by loosening the approval policy or trusting an MCP server.
- A Mac, user account or Tailscale account that is already compromised.
- Model mistakes that still went through an approval card (a bad draft, a wrong summary).
- Vulnerabilities in third-party services or tools Bridle calls (Claude Code, Composio, MCP servers you add), unless
  Bridle's handling of them makes things worse.
