# VoxTerm — Engineering Guide

> A premium, voice-ready terminal workspace for Linux, built on Electron + React +
> TypeScript. This document is the working guide for anyone (human or agent)
> continuing development. It covers architecture, the security model, conventions
> and the extension points that later milestones plug into.

Prompt 1 of 5 delivered the **Electron foundation**: a real desktop app with real
OS terminals, honest session/external-integration semantics, validated settings
persistence, an activity log and a hardened process model. Voice capture,
prompt generation and spoken announcements are **scaffolded but not runtime-active**
(see `progress.md` for the honest status).

---

## 1. Stack

| Layer            | Choice                                                        |
| ---------------- | ------------------------------------------------------------- |
| Runtime          | Electron `44.7.2` (Chromium + Node, CJS main/preload)         |
| Build            | electron-vite `5.0.0` + Vite `7.3.7`                          |
| UI               | React `19.3.0`, TypeScript `5.9.3` (strict)                   |
| Terminal         | `@xterm/xterm` `6.0.0` (+ fit, search, web-links, webgl addons) |
| PTY              | `node-pty` `1.1.0` (native, rebuilt for the Electron ABI)     |
| Validation       | Zod `4.6.7` (settings, IPC payloads, agent profiles)          |
| Icons            | `lucide-react` `1.56.0` (SVG only)                            |
| Test             | Vitest `5.0.4`                                               |
| Lint             | ESLint `10.12.0` + typescript-eslint + react-hooks            |
| Packaging        | electron-builder `26.15.3` (AppImage + deb)                   |

`package.json` intentionally has **no** `"type": "module"`: the main and preload
bundles are emitted as CommonJS, which is what Electron expects here. `node-pty`
lives in `dependencies` (not devDependencies) because it is a runtime native
module; the `postinstall` script runs `electron-builder install-app-deps` to
rebuild it against the pinned Electron version.

## 2. Running it

```bash
npm install          # triggers postinstall → rebuilds node-pty for Electron
npm run dev          # electron-vite dev (HMR renderer, live main/preload reload)
npm run build        # typecheck + electron-vite build → out/{main,preload,renderer}
npm test             # vitest run
npm run typecheck    # tsc --noEmit for node + web projects
npm run lint         # eslint .
npm run package      # build + electron-builder --linux (AppImage + deb)
npm run package:dir  # unpacked directory build (faster smoke test)
```

Headless / CI notes (Linux):

```bash
# node-pty + Electron runtime smoke checks
xvfb-run -a npx electron scripts/verify-pty.cjs     # real PTY output under Electron
xvfb-run -a npx electron scripts/verify-env.cjs     # versions, PATH, tool discovery

# In constrained containers the Chromium SUID sandbox may be unavailable:
VOXTERM_DISABLE_CHROMIUM_SANDBOX=1 npm run dev
# (this appends --no-sandbox; the renderer sandbox stays enabled)
```

`VOXTERM_DISABLE_CHROMIUM_SANDBOX=1` is an escape hatch, **not** the default. On a
normal Kali/desktop install the sandbox works and should be left on.

## 3. Process model

```
┌──────────────────────────── Main process (Node, trusted) ────────────────────────────┐
│  index.ts        bootstrap, single-instance lock, lifecycle, graceful shutdown        │
│  window.ts       BrowserWindow creation, navigation hardening, CSP                    │
│  settings/       SettingsStore  + JsonStore (atomic, owner-only perms)                │
│  activity/       ActivityLog (bounded, non-sensitive events)                          │
│  terminals/      TerminalSessionManager (owns every node-pty instance)                │
│  agents/         AgentProfileStore + real executable detection                        │
│  external/       ExternalSessionRegistry + providers (tmux, screen, desktop-terms)    │
│  ipc/            One handler module per domain; every payload Zod-validated           │
│  system/         SystemInfo aggregation (versions, PATH tools, whisper readiness)     │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                    contextBridge (typed, narrow) │ ipcRenderer.invoke / .on
┌───────────────────────────────────────────┴───────────────────────────────────────────┐
│  Preload (src/preload/index.ts)   exposes window.voxterm only — no Node primitives     │
├───────────────────────────────────────────────────────────────────────────────────────┤
│  Renderer (React, sandboxed, contextIsolated)                                          │
│    state/store.tsx        app store: settings, sessions, external, agents, activity    │
│    features/terminals/    xterm controller registry + surfaces + tabs + external panel │
│    pages/                 Workspace · Terminals · Voice · Activity · Settings          │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

**PTYs never live in the renderer.** The renderer sends input/resize and receives
data over IPC; all process ownership stays in main. This is both a security and a
correctness requirement (tab switching must not restart shells).

### Directory map

```
src/
  main/       Node/Electron-only code
  preload/    the contextBridge surface (imports shared types only)
  renderer/   React UI (no Node imports allowed)
  shared/     types.ts · schemas.ts · ipc.ts · api.ts · agents.ts
              (zero Node/Electron imports — safe to bundle both sides)
tests/        Vitest unit tests
scripts/      standalone Electron smoke checks (verify-pty, verify-env)
resources/    packaging resources
```

Path aliases: `@shared/*` → `src/shared/*`, `@renderer/*` → `src/renderer/src/*`
(configured in `tsconfig.base.json` **and** `electron.vite.config.ts` /
`vitest.config.ts` — keep all three in sync).

## 4. Session lifecycle semantics

These four operations are deliberately distinct. Do not collapse them.

| Action                    | Effect on VoxTerm | Effect on the process |
| ------------------------- | ----------------- | --------------------- |
| **Close tab**             | removes the tab   | managed → terminate; external → detach (per `external.onClosePolicy` / prompt) |
| **Terminate session**     | removes + kills   | sends signal to the process group |
| **Detach external**       | removes the tab   | multiplexer client exits, underlying session **keeps running** |
| **Terminate shared session** | removes + kills | `tmux kill-session` / `screen -S … -X quit` |

Managed sessions are keyed by a stable UUID (`TerminalSessionInfo.id`), never by
tab index. `TerminalSessionManager` buffers PTY output until the renderer calls
`terminal:subscribe` (which returns the buffer), then streams live — so no output
is lost between spawn and first paint.

Termination signals the **process group** (`process.kill(-pid, …)`) because
`forkpty` puts each child in its own session; the fallback is `pty.kill`.
Escalation is SIGTERM → (1.5 s) → SIGKILL. `SIGHUP` is used specifically to
detach multiplexer clients. `terminate()` never signals unrelated processes.

Graceful app close (`index.ts`): if running sessions exist and
`terminal.confirmBeforeAppClose` is set, the renderer gets an `app:close-requested`
prompt; otherwise it closes immediately. On quit, `privacy.sessionCleanupOnExit`
decides between terminating managed shells and releasing them.

## 5. External integration architecture

Every integration implements `ExternalProvider` (`src/main/external/provider.ts`):

```ts
probe(ctx)            // is the underlying tool actually present?
info()                // provider metadata + capabilities + absence reason
discover(ctx)         // list sessions owned by the tool
attach(externalId)    // open a real client (only where genuinely possible)
detach(externalId)    // leave it running, drop our client
terminate(externalId) // end the session via the tool itself
getStatus(externalId) // authoritative current state
```

States (`ExternalSessionState`) are explicit so the UI can never imply a
connection that does not exist: `detected`, `attachable`, `connected`,
`detached`, `exited`, `unsupported`, `attach_failed`.

`ExternalSessionRegistry` isolates failures: each probe/discovery runs under a
timeout, a hang or error in one provider never blocks or crashes the others, and
refresh is single-flight. Composite ids are `${providerId}:${externalId}`.

Shipped providers:

- **tmux** — genuine integration. Attach spawns `tmux attach-session` **as the PTY
  command** (`origin: 'external'`), so VoxTerm and an external terminal can share
  one session. Detach kills the client PTY with SIGHUP. Terminate uses
  `tmux kill-session`.
- **screen** — same shape via `screen -list` / `screen -r` / `screen -S … -X quit`.
- **desktop-terminals** — Linux `/proc` scan of terminal emulators and interactive
  shells. **Detection only**: `capabilities.attach === false`. Linux exposes no
  portable way to attach to another process's controlling terminal, and the UI
  says so rather than faking it. VoxTerm's own sessions are excluded
  (they carry `VOXTERM_SESSION_ID`).

Adding a provider: implement `ExternalProvider` (extend `BaseExternalProvider` for
the default unsupported responses), register it in `index.ts`, and it appears in
`getProviders()`/the External panel automatically. Never advertise a capability
you cannot honour.

## 6. Coding agents

Agents are **ordinary CLI programs typed into a real shell** — never a hidden
runtime, never a fake chat UI. `AgentProfileStore` holds built-ins (opencode,
claude, codex, gemini, aider) plus user-defined profiles. Availability is
detected honestly by resolving the executable on the user's real login-shell PATH
(`resolveUserPath`, which runs `$SHELL -lic 'printf %s "$PATH"'` once and caches
it — GUI-launched Electron often inherits a minimal PATH).

Launch flow (`WorkspacePage` → `terminalRegistry.queueCommand`): create a real
terminal session, queue `command + args`, and after the terminal is hydrated the
renderer types the command + `\r` into the PTY. The user sees exactly what runs.

Guardrails:

- Launch command must match `^[A-Za-z0-9_./@:+-]+$` — a single executable token,
  never shell syntax.
- Args may not contain newlines; env keys must match `^[A-Za-z_][A-Za-z0-9_]*$`.
- Built-in profiles cannot be modified or deleted.
- `AgentCapabilities` (`promptInjection`, `structuredEvents`) are `false` today:
  later milestones flip them on per-agent via modular adapters. Do not assume an
  agent can accept injected prompts until its adapter says so.

## 7. Settings, secrets and the activity log

- Settings are a single Zod schema (`shared/schemas.ts`) with defaults on **every**
  field. `parseSettings` recovers **section-scoped**: valid sections are kept, an
  invalid section is reset to defaults — a bad value never nukes the whole file.
  Corrupted JSON is backed up (`.invalid-<ts>.bak`), not deleted.
- Updates go through `deepMerge` (prototype-pollution keys rejected) then
  re-validation; invalid patches are rejected and the previous settings are kept.
- Writes are **atomic** (temp file + rename) and files are `0600` in a `0700`
  directory (`util/jsonStore.ts`).
- **Secrets** (`openrouter`, `google`, `elevenlabs`) live in a separate
  `secrets.json`. Only their *presence* (`SecretsStatus`) crosses IPC — values
  are never returned to the renderer, never logged, and are read in main only via
  `getSecret()`.
- The activity log stores **small, non-sensitive metadata only**: never terminal
  output, never environment variables, never secrets. Retention is bounded
  (default 500, max 5000).

Settings live under `app.getPath('userData')` → `~/.config/voxterm/` on Linux:
`settings.json`, `secrets.json`, `agents.json`, `activity.json`, `logs/`.

## 8. Security model

| Control                     | Implementation                                                    |
| --------------------------- | ----------------------------------------------------------------- |
| Context isolation           | `contextIsolation: true`                                          |
| Node in renderer            | `nodeIntegration: false`                                          |
| Renderer sandbox            | `webPreferences.sandbox: true`                                    |
| Preload surface             | narrow, typed `window.voxterm` (`shared/api.ts`) — exposes only `ipcRenderer.invoke/on` for known channels |
| IPC validation              | every handler validates its payload with a Zod schema (`main/ipc/schemas.ts`) |
| CSP                         | set via `onHeadersReceived` (production: `script-src 'self'`, no inline script; dev adds HMR) |
| Navigation                  | `will-navigate`, `setWindowOpenHandler`, `will-attach-webview` all deny/redirect |
| Permissions                 | all `setPermissionRequestHandler` requests denied                  |
| Clipboard                   | routed through main IPC (sandboxed renderer needs no clipboard access) |
| External URLs               | only `http(s)` may be opened, and only via `shell.openExternal`    |
| Shell execution             | `execFile` only, never `shell: true`; user strings never interpolated |
| Secrets                     | main-only, separate `0600` file, status-only over IPC              |

If you add a feature: validate its IPC input, keep Node out of the renderer, and
prefer adding one more narrow method to the preload bridge over widening the API.

## 9. UI / design conventions

- Deep-black, premium, *human-designed*. Charcoal sidebar, restrained accent,
  design tokens in `styles/tokens.css`; component styles in `styles/global.css`.
- **SVG icons only** (`lucide-react`), no emojis, no robot avatars, no AI badges,
  no chatbot chrome.
- **No fake buttons, dead controls or placeholder session data.** If something is
  not wired up, disable it and label it honestly (see the Voice page notice).
- No horizontal overflow; the window is frameless with a custom title bar
  (`components/TitleBar.tsx`) and window controls over IPC.
- Keyboard shortcuts: `Ctrl+Shift+T` new terminal, `Ctrl+Shift+W` close tab,
  `Ctrl+Shift+F` find, `Ctrl+Tab`/`Ctrl+Shift+Tab` cycle, `Ctrl+1..9` jump.
  `App.tsx` dispatches window `CustomEvent`s (`voxterm:find`,
  `voxterm:close-active`) after navigating so the terminals page can react.

## 10. Conventions & gotchas

- `src/shared/**` must never import `node:*` or `electron` — it is bundled into
  the renderer.
- Keep `@shared`/`@renderer` aliases in sync across `tsconfig.base.json`,
  `electron.vite.config.ts`, `vitest.config.ts`.
- xterm instances are cached **by session id** in `features/terminals/registry.ts`
  and survive React StrictMode remounts; only explicit dispose releases them, so
  scrollback is never lost on tab switches.
- Never key UI state on tab index — always the session UUID.
- When killing Electron/Xvfb during testing, avoid `pkill -f "<pattern>"` if the
  pattern appears in your own command line (it self-matches and kills the shell).
  Use `pkill -x electron` / `pkill -x Xvfb` or the `electron[-]vite` bracket trick.
- The default detected shell on this machine is **zsh**; userData is
  `~/.config/voxterm`.
- The renderer production bundle is ~1.4 MB (zod + xterm + react). Acceptable for
  a desktop app; revisit if startup cost ever regresses.

## 11. Extension points for later milestones

- **Voice (prompt 2+):** `voice`/`announcements` settings, `SystemInfo.whisper`
  readiness, and the Voice page already exist. Wire a real capture → local Whisper
  → prompt-review → send-to-session pipeline. Keep everything local unless the
  user explicitly enables a cloud provider.
- **Prompts:** `prompts` settings define provider priority (ollama → openrouter →
  google) and a `localOnly` default. Prompt generation should honour it.
- **Agent adapters:** flip `AgentCapabilities` per agent and add adapters in the
  `agents/` module. Launch stays "type it into the shell" — adapters only add
  prompt/event handling on top.
- **More external providers:** implement `ExternalProvider` and register it. Be
  honest about capabilities.

## 12. Verifying a change

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

All four must pass. Lint currently reports **0 errors** (3 benign
`react-refresh/only-export-components` warnings for files that export a component
plus a helper). See `progress.md` for the latest verified results and known
limitations.
