# VoxTerm — Engineering Guide

> A premium, voice-ready terminal workspace for Linux, built on Electron + React +
> TypeScript. This document is the working guide for anyone (human or agent)
> continuing development. It covers architecture, the security model, conventions
> and the extension points that later milestones plug into.

Prompt 1 of 5 delivered the **Electron foundation**: a real desktop app with real
OS terminals, honest session semantics, validated settings persistence, an
activity log and a hardened process model. A follow-up pass removed the
external-session integrations entirely, fixed the collapsed-sidebar icon bug,
introduced the "V" brand mark, and made every page responsive. Voice capture,
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
│  ipc/            One handler module per domain; every payload Zod-validated           │
│  system/         SystemInfo aggregation (versions, PATH tools, whisper readiness)     │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                    contextBridge (typed, narrow) │ ipcRenderer.invoke / .on
┌───────────────────────────────────────────┴───────────────────────────────────────────┐
│  Preload (src/preload/index.ts)   exposes window.voxterm only — no Node primitives     │
├───────────────────────────────────────────────────────────────────────────────────────┤
│  Renderer (React, sandboxed, contextIsolated)                                          │
│    state/store.tsx        app store: settings, sessions, agents, activity, nav, toasts  │
│    features/terminals/    xterm controller registry + surfaces + tabs                  │
│    components/            TitleBar · Sidebar · Logo · Modal · Toasts · primitives       │
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
scripts/      standalone Electron smoke checks (verify-pty, verify-env, verify-ui)
resources/    packaging resources (icon.svg + generated icon.png)
```

Path aliases: `@shared/*` → `src/shared/*`, `@renderer/*` → `src/renderer/src/*`
(configured in `tsconfig.base.json` **and** `electron.vite.config.ts` /
`vitest.config.ts` — keep all three in sync).

## 4. Session lifecycle semantics

VoxTerm owns every terminal it shows; there is no external/multiplexer
integration any more. Closing a tab and terminating the process are therefore
the same operation.

| Action            | Effect on VoxTerm | Effect on the process                          |
| ----------------- | ----------------- | ---------------------------------------------- |
| **Close tab**     | removes the tab   | terminates the session's process group         |
| **Terminate**     | removes + kills   | SIGTERM → (1.5 s) → SIGKILL on the process group |
| **Shell exits**   | tab stays, marked `exited` | nothing left to signal               |

Managed sessions are keyed by a stable UUID (`TerminalSessionInfo.id`), never by
tab index. `TerminalSessionManager` buffers PTY output until the renderer calls
`terminal:subscribe` (which returns the buffer), then streams live — so no output
is lost between spawn and first paint.

Termination signals the **process group** (`process.kill(-pid, …)`) because
`forkpty` puts each child in its own session; the fallback is `pty.kill`.
Escalation is SIGTERM → (1.5 s) → SIGKILL. `terminate()` never signals unrelated
processes.

Only a real OS session can be closed, and only a running one prompts
(`terminal.confirmBeforeTerminate`); exited tabs close immediately.

Graceful app close (`index.ts`): if running sessions exist and
`terminal.confirmBeforeAppClose` is set, the renderer gets an `app:close-requested`
prompt; otherwise it closes immediately. On quit, `privacy.sessionCleanupOnExit`
decides between terminating the shells and releasing them so they survive.

## 5. Renderer UI, brand and responsiveness

The renderer is a plain, tokenised React app — no component library, no chat/agent
chrome. Structure worth knowing:

- **Design tokens** live in `styles/tokens.css` (colour, spacing, radii, motion,
  z-index scale); all component styles are in the single `styles/global.css`. New
  UI should reuse tokens and existing primitives (`Field`, `Notice`,
  `EmptyState`, `Switch`, `StatusDot`) rather than introducing one-off values.
- **Brand mark** — `components/Logo.tsx` renders the "V" monogram as inline SVG
  (gradient arms, bevelled highlight, a small audio waveform in the mouth of the V
  and a bright vertex node). It is used in the title bar and the boot splash. The
  same geometry is the source for `resources/icon.svg`, and
  `resources/make-icon.py` rasterises `resources/icon.png` for packaging (no SVG
  rasteriser is required in the build).
- **Terminal font** is a curated dropdown (`lib/fonts.ts` → `TERMINAL_FONTS`), each
  entry a full CSS stack with a live preview. `TERMINAL_FONTS[0].stack` **must**
  equal the `terminalFontFamily` default in `shared/schemas.ts`, otherwise a fresh
  install shows "Custom stack".
- **Responsive rules** (end of `global.css`) are deliberately few and meaningful:
  ≤1020 px collapses two-up `.split` grids and hides the Workspace
  "Detected tooling" panel; ≤860 px stacks the Settings rail into a horizontal
  scroller, stacks page headers and drops secondary terminal metadata; ≤640 px
  hides `.hide-sm` details and single-columns `stat-grid`/`kv`. Every page is
  expected to stay free of horizontal overflow at all of these widths.
- **Sidebar collapse**: in compact mode the nav labels are removed from layout
  (`max-width: 0; overflow: hidden`) so `justify-content: center` centres the icon
  inside the 56 px rail instead of pushing it out of the clipped area. This was a
  real bug — verify it with `scripts/verify-ui.cjs` if you touch the sidebar CSS.


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
  no chatbot chrome. Labels are plain product language ("Google API key", not
  "Google AI"), and provider wording is reserved for the *prompt/transcription*
  providers that genuinely exist.
- **Every page is responsive.** Prefer `.page__header`, `.split`, `.stat-grid`,
  `.chip-row` and the utilities (`.row`, `.col`, `.grow`, `.truncate`, `.hide-sm`)
  over bespoke layout CSS; the breakpoints live in one block at the end of
  `global.css`. Two-up layouts collapse, the Settings rail becomes a horizontal
  scroller and the Workspace tooling panel is dropped on narrow windows.
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

## 12. Verifying a change

```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run verify:ui        # needs a display: xvfb-run -a npm run verify:ui
```

All four static checks must pass. Lint currently reports **0 errors** (3 benign
`react-refresh/only-export-components` warnings for files that export a component
plus a helper).

`scripts/verify-ui.cjs` is the runtime check. It boots the **built** app with the
real main process and IPC, attaches over the Chrome DevTools Protocol and asserts
what unit tests cannot: the app leaves the boot screen, every collapsed-sidebar
nav icon is still visible and centred, the "V" logo renders, no external-session
wording or "AI" labels remain, the terminal font is a dropdown whose stored value
resolves to a listed family, and **no page overflows horizontally at either
desktop width or 560 px** (where the Detected-tooling panel must be hidden). It
exits non-zero on any failure. See `progress.md` for the latest verified results
and known limitations.
