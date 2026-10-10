# Contributing to Bridle

Thanks for helping. Bug reports, fixes and small improvements are all welcome. For anything larger, open an issue
first so we can agree on the shape before you write it.

## Setup

You need macOS and Node.js 20 or later.

```sh
npm install
npm run dev
```

`npm run dev` hot-reloads the window. Optional: `npm run build:native` builds the Swift helpers (search by meaning,
OCR, transcription, dictation, the notch); it needs macOS 26 and Xcode 26. Everything else runs without it.

If `node-pty` or Electron fails to install, see [Troubleshooting](README.md#run-it) in the README.

## Before you open a pull request

These must pass:

```sh
npm run typecheck
npm test
```

CI runs both, plus `npm run build`, the Swift helpers build and the website build (`site/`). Tests sit next to the
code as `src/**/*.test.ts`; add one when you change logic.

## How the code is laid out

[docs/architecture.md](docs/architecture.md) covers the layout, the IPC contract, the safety model and the on-disk
formats. The rules that matter most:

- **Adding an IPC method** means three things: add it to `BridleAPI` and to `API_METHODS` in `src/shared/api.ts`, and
  implement it in the service. Typecheck fails until all three agree. The preload needs no change.
- **One folder per feature** under `src/renderer/features/`, with its screen, sidebar and styles together.
- **Styles** are CSS modules in the feature folder, using the tokens in `src/renderer/theme/tokens.css`. The `b-`
  class prefix belongs to `src/renderer/components/`.
- **Sound**: every interactive control plays a cue. The primitives in `src/renderer/components/` already do, so use
  them rather than raw elements.
- **Main and preload don't hot-reload.** After changing `src/main` or `src/preload`, restart `npm run dev`.

## Style

- Match the surrounding code.
- Keep pull requests small and focused on one thing.
- No new runtime dependencies without a reason stated in the PR. The list is short on purpose.
- Comments say why, briefly. Leave out what the code already says.

## Safety-sensitive changes

If your change touches any of these, say in the PR description how the [safety model](docs/architecture.md#safety-model)
still holds:

- approvals and the approval policy
- `workspaceEdit` and the protection of `.bridle/`
- loop script approval
- MCP servers and the "Don't ask" trust setting
- the phone bridge (`src/main/bridge.ts`, `PHONE_METHODS` / `PHONE_EVENTS`)

## Releases

Maintainers build a signed, notarized DMG and publish it on
[GitHub Releases](https://github.com/CreatorHive/bridle/releases):

```sh
APPLE_KEYCHAIN_PROFILE=<profile> npm run dist
```

The DMG lands in `dist/`. The tag-triggered workflow in `.github/workflows/release.yml` does the same once the signing
secrets are set in the repository.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
