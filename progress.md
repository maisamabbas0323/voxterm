# VoxTerm — Progress

A premium, voice-ready terminal workspace for Linux (Electron + React + TypeScript).

**Status: complete and verified.** The app is a real, working Electron application
— not a mockup. It boots, creates genuine `node-pty` shells, persists validated
settings, mounts real xterm.js terminals and shuts down cleanly. Voice, prompt
generation and spoken announcements remain intentionally scaffolded-only (honest
limitations below).

---

## Milestone 1 — Electron foundation

- Single-instance lock, `whenReady` bootstrap, graceful close flow with a
  renderer-driven confirm prompt when sessions are running.
- Frameless window with a custom title bar and IPC window controls (min 880×560).
- `TerminalSessionManager` (main) owns every `node-pty` instance; one real shell is
  auto-created on first launch. Stable UUID session ids, output buffering until the
  renderer subscribes, xterm instances cached by session id across StrictMode
  remounts.
- Coding agents are ordinary CLI programs typed into a real shell, with honest
  executable detection on the user's login-shell PATH.
- One Zod settings schema with section-scoped recovery, atomic `0600` writes and a
  separate secrets file (presence only over IPC).
- Bounded activity log (non-sensitive metadata only) with a filterable page.
- Hardened process model: `contextIsolation`, `nodeIntegration:false`,
  `sandbox:true`, a narrow typed preload bridge, Zod-validated IPC, CSP via
  `onHeadersReceived`, denied permissions/navigation, `execFile` only.

## Milestone 1.1 — Refactor pass (this change)

### External terminal sessions removed entirely
The "external sessions" feature (tmux/screen attach, desktop-terminal discovery)
was removed at the user's request. This was a **comprehensive** removal, not a UI
hide — no dead code was left behind:

- Deleted `src/main/external/**` (registry, base provider, tmux/screen/
  desktop-terminals providers), `src/main/ipc/external.ts`,
  `src/renderer/src/features/terminals/ExternalPanel.tsx` and
  `tests/providers.test.ts`.
- Removed the external surface from `shared/types.ts`, `schemas.ts`, `ipc.ts` and
  `api.ts`; dropped the preload bridge for it; removed the `ExternalProvider`
  context and discovery bookkeeping from `src/main/index.ts`.
- `TerminalSessionManager` sessions no longer carry an `origin`/`providerId`/
  `externalSessionId`; `CreateSessionContext` is now just `{ cwd }`.
- `ActivityCategory` dropped `'external'`; `SystemInfo` dropped
  `externalDiscovery`; the Settings `external` section was removed from both the
  schema and `SETTINGS_SECTIONS`.
- **Managed-only close semantics.** Closing a tab now *is* terminating its
  process group. `CloseSessionMode`/the `terminate` channel were removed and
  `CloseSessionResult` simplified to `{ id, terminated, message? }`.
- tmux/screen **detection** is retained for the informational "Detected tooling"
  panel on the Workspace page — detection is honest, and nothing pretends to attach.
- `openExternal` (opening a URL) is unrelated to external sessions and is unchanged.

Legacy settings files that still contain an `external` key load fine: the Zod
schema strips unknown keys, so the section disappears on the next write.

### Sidebar-collapse icon bug fixed
Root cause: in compact mode the nav label used `opacity: 0` while still occupying
its full text width, so `justify-content: center` pushed the icon outside the
clipped rail. Fixed by removing the label from layout in compact mode
(`max-width: 0; overflow: hidden`) and zeroing the row gap. Verified at runtime
(all five icons visible, inside the 56 px rail and centred).

### Brand mark
- New `components/Logo.tsx`: a bold gradient "V" monogram with bevelled arms, a
  soft glow, a small audio waveform resting in the mouth of the V and a bright
  vertex node. Inline SVG only, with `useId()`-derived gradient ids so multiple
  instances never collide. Used in the title bar and the boot splash.
- `resources/icon.svg` mirrors the geometry; `resources/make-icon.py` rasterises
  `resources/icon.png` (512²) for packaging using numpy + PIL, so the build needs
  no SVG rasteriser. `electron-builder.yml` points Linux packaging at it.

### UI/UX pass across every page
- **Workspace** — three stat cards, an agents list using status dots (no badges),
  side-by-side System + Recent-activity panels, and a Detected-tooling panel with
  chips that drops away on narrow windows.
- **Terminals** — removed the external panel; added a real toolbar (status dot,
  title, cwd, shell, pid, find/scroll/clear/copy-cwd/new-in-cwd), a proper empty
  state and an "exited" notice. Tabs got a cleaner look, a context menu and
  middle-click close.
- **Voice** — honest configuration view plus local-transcription readiness and
  planned-flow steps; explicitly states the pipeline is not active yet.
- **Activity** — chip filters (no more external category) plus a search box.
- **Settings** — external section removed; **terminal font family is now a
  dropdown** (`lib/fonts.ts`, 16 curated stacks) with a live preview instead of a
  free-text field; "Google AI API key" corrected to "Google API key"; the
  "saved automatically" pill replaced with an honest caption.
- Global responsive rules: ≤1020 px collapses two-up `.split` grids and hides the
  Workspace tooling panel; ≤860 px stacks the Settings rail into a horizontal
  scroller and page headers; ≤640 px hides `.hide-sm` details and single-columns
  `stat-grid`/`kv`. No horizontal overflow at any of these widths.
- Removed the now-unused `Pill` primitive and its CSS instead of leaving dead code.

### Verification tooling
- Added `scripts/verify-ui.cjs` (+ `npm run verify:ui`): boots the built app with
  the real main process and IPC, attaches over the Chrome DevTools Protocol and
  asserts runtime-only properties (see below). No new dependencies — it uses
  Node 22's global `fetch`/`WebSocket`.

---

## Verification evidence

All commands run from the repo root on Kali (Linux), Oct 2026.

| Check             | Command                  | Result                                        |
| ----------------- | ------------------------ | --------------------------------------------- |
| Types             | `npm run typecheck`      | PASS (node + web, no errors)                  |
| Lint              | `npm run lint`           | PASS — 0 errors, 3 `react-refresh` warnings    |
| Unit tests        | `npm test`               | PASS — 19 tests / 3 files                     |
| Production build  | `npm run build`          | PASS — `out/{main,preload,renderer}` produced |
| Runtime UI        | `npm run verify:ui`      | PASS — 25/25 checks                           |
| PTY under Electron| `scripts/verify-pty.cjs` | PASS                                          |
| Env discovery     | `scripts/verify-env.cjs` | PASS                                          |

Test files: `tests/settings.test.ts` (schema + section recovery),
`tests/agents.test.ts` (launch-command/arg/env validation),
`tests/ipc-schemas.test.ts` (IPC payload validation & clamping).

The only lint output is three benign `react-refresh/only-export-components`
warnings (files that intentionally export a component plus a helper) with **0
errors**.

### Runtime verification (`scripts/verify-ui.cjs`, headless under Xvfb)

25/25 checks pass against the **built** app with a fresh user-data directory:

- app boots past the loading screen; **no renderer console errors**;
- sidebar is compact (56 px) and all five nav icons stay **visible, inside the
  rail and centred** — the collapsed-icon bug is fixed;
- the branded "V" logo renders in the title bar;
- every nav item is clickable and no page shows external-session wording, and
  Settings has no "External sessions" section and no "AI" label tags;
- the terminal font is a dropdown (16 curated families) with a preview, and a
  fresh install's stored value resolves to a listed family ("JetBrains Mono"), not
  "Custom stack";
- **no horizontal overflow** on any page at desktop width *or* at 560 px;
- the Detected-tooling panel is hidden at 560 px and returns at desktop width;
- the Terminals page mounts a real xterm surface (real `node-pty` shell).

`scripts/verify-pty.cjs` spawns a real PTY shell under Electron and waits for the
`VOXTERM_PTY_OK:` marker; `scripts/verify-env.cjs` prints a JSON snapshot of
versions, shells, tmux/screen and coding-agent availability.

---

## Known limitations (honest)

1. **Voice is not runtime-active.** No microphone capture, no transcription, no
   announcement playback. The settings, `SystemInfo.whisper` readiness probes and
   the Voice page exist so the next milestone can drop a real pipeline in. The
   Voice page states this explicitly — it does not pretend to work.
2. **Prompt generation is not runtime-active.** `prompts` settings (provider
   priority, `localOnly`) are persisted and validated but nothing consumes them yet.
3. **"Detected tooling" is informational only.** tmux/screen presence is reported
   on the Workspace page; VoxTerm no longer attaches to or manages anything outside
   its own sessions.
4. **Sandbox caveat in this environment.** The app was launched here under Xvfb
   with `--no-sandbox` (`VOXTERM_DISABLE_CHROMIUM_SANDBOX=1`) because the Chromium
   SUID sandbox is not configured in this container. `webPreferences.sandbox:true`
   is retained, and on a normal desktop install the Chromium sandbox should be left
   enabled; this path has not been re-tested under a standard display session.
5. **Font catalogue is a display list.** The 16 families are CSS stacks, not
   bundled fonts; xterm falls back gracefully when a family is not installed. A
   settings value that matches no entry is shown as "Custom stack".
6. **`npm audit` reports 8 moderate transitive vulnerabilities** (tooling chain,
   likely electron-builder). Not addressed in this milestone; no runtime-facing
   advisories were identified.
7. **Renderer bundle is ~1.4 MB** (zod + xterm + react). Fine for a desktop app;
   flagged in case startup regresses later.
8. **Packaging (`npm run package`) was not executed** in this environment (it
   produces AppImage/deb via electron-builder and requires additional system
   tooling). The config is in place (`electron-builder.yml`, with the new icon),
   and the build step it depends on passes.

## Note on dependencies

An unrelated third-party coding-agent CLI (`freebuff`, `@CodebuffAI/freebuff-private`)
had been injected into `package.json` + the lockfile. It is unrelated to VoxTerm
and was **removed**. No secrets, `.env` files or user data are committed; the
userData directory (`~/.config/voxterm`) is not part of the repo.

## Next milestones

- Prompt 2+: real voice capture → local Whisper transcription → prompt review →
  send to the active session; announcement playback for configured event categories.
- Prompt-generation pipeline honouring `localOnly` and provider priority.
- Per-agent adapters enabling `promptInjection` / `structuredEvents`.
- Optional: a packaging/release pass.

See `agent.md` for architecture, the security model and extension points.
