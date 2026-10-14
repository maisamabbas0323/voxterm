# VoxTerm — Progress

Prompt 1 of 5: Electron foundation, black human-designed UI, real OS terminals,
tab/session management, settings persistence, external-session discovery
architecture, activity log and Electron security.

**Status: complete and verified.** The app is a real, working Electron application
— not a mockup. It boots, creates genuine `node-pty` shells, persists validated
settings, discovers external sessions and shuts down cleanly. Voice, prompt
generation and spoken announcements are intentionally scaffolded-only in this
milestone (honest limitations below).

---

## What is implemented

### Electron foundation & lifecycle
- Single-instance lock, `whenReady` bootstrap, `window-all-closed` quit.
- Graceful close flow: prompts before quitting when sessions are running (if
  `terminal.confirmBeforeAppClose`), otherwise closes immediately.
- Shutdown honours `privacy.sessionCleanupOnExit`: `terminate-managed` kills
  managed shells, `keep-managed` detaches external clients and releases managed
  shells so they survive.
- Frameless window with custom title bar and IPC-driven window controls
  (min 880×560, default 1320×860).

### Real terminals
- `TerminalSessionManager` (main) owns every `node-pty` instance; one real
  terminal (zsh on this machine) is auto-created on first launch.
- Stable UUID session ids (never tab index); switching tabs never restarts a
  shell.
- Output buffering until the renderer subscribes, then live streaming — no lost
  output between spawn and first paint.
- xterm.js instances cached by session id across React StrictMode remounts;
  scrollback preserved until explicit dispose.
- Tabs: create, close (with confirm), rename, reorder-free stable identity, cycle
  shortcuts, `Ctrl+1..9` jump, find (search addon), copy/paste via main clipboard.
- Real shell resolution + login-shell PATH discovery so agents are visible.
- Correct signal handling: process-group kill, SIGTERM → SIGKILL escalation,
  SIGHUP for detaching multiplexer clients.

### External session integration
- Provider interface (`probe/info/discover/attach/detach/terminate/getStatus`) with
  explicit capabilities and honest states.
- **tmux**: genuine discovery, attach (real `tmux attach-session` as the PTY),
  detach (client SIGHUP, session persists), terminate (`tmux kill-session`).
- **screen**: discovery + attach/detach/terminate via `screen`.
- **desktop-terminals**: Linux `/proc` detection of terminal emulators and shells
  — **detection only**, since Linux has no portable attach API. UI explains why,
  and never shows detected windows as connected.
- Registry isolates provider failures with timeouts and single-flight refresh;
  periodic discovery + on-demand "Rescan".

### Coding agents
- Built-in profiles (opencode, claude, codex, gemini, aider) + custom profiles.
- Real availability detection: resolves the executable on the login-shell PATH and
  reads its `--version` (cached 30 s).
- Launch = create a real terminal and type the command into the shell
  (`terminalRegistry.queueCommand`); the user sees exactly what runs.
- Hardened validation of launch commands, args and env keys; built-ins immutable.

### Settings, secrets, activity
- One Zod schema with defaults everywhere; section-scoped recovery from invalid
  files; corrupted files backed up, never deleted.
- Atomic `0600` writes in a `0700` directory.
- Secrets in a separate owner-only file; only presence crosses IPC.
- Bounded activity log (default 500, max 5000) with non-sensitive metadata only;
  Activity page with filters and clear.

### UI
- Deep-black premium theme with design tokens; charcoal sidebar; lucide SVG icons
  only; no emojis, robot avatars, AI badges or chatbot chrome.
- Pages: Workspace (stats, agents, system, recent activity, tooling), Terminals
  (tabs + toolbar + find + external panel), Voice (honest "not active" notice +
  config), Activity, Settings (all sections incl. credential slots).
- No horizontal overflow; disabled controls are labelled, not fake.

### Security
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Narrow typed preload bridge; no Node/Electron primitives in the renderer.
- Every IPC payload Zod-validated; all permission requests denied; CSP via
  `onHeadersReceived`; navigation/webview/window-open hardened; clipboard via IPC;
  external URLs restricted to `http(s)`; `execFile` only (never `shell: true`).

---

## Verification evidence

All commands run from the repo root on Kali (Linux), Oct 2026.

| Check                | Command             | Result                                            |
| -------------------- | ------------------- | ------------------------------------------------- |
| Types                | `npm run typecheck` | PASS (node + web, no errors)                      |
| Lint                 | `npm run lint`      | PASS — 0 errors, 3 `react-refresh` warnings        |
| Unit tests           | `npm test`          | PASS — 24 tests / 4 files                         |
| Production build     | `npm run build`     | PASS — `out/{main,preload,renderer}` produced     |
| PTY under Electron   | `scripts/verify-pty.cjs` | PASS (see below)                             |
| Env discovery        | `scripts/verify-env.cjs` | PASS                                        |

Test files: `tests/settings.test.ts` (schema + section recovery),
`tests/agents.test.ts` (launch-command/arg/env validation),
`tests/ipc-schemas.test.ts` (IPC payload validation & clamping),
`tests/providers.test.ts` (tmux/screen parsing).

The only lint output is three benign `react-refresh/only-export-components`
warnings (files that intentionally export a component plus a helper) with **0
errors**.

### Runtime verification (headless under Xvfb)
- App boots and the React renderer runs.
- A real `zsh` process is spawned as a child of the Electron main process,
  confirming genuine `node-pty` integration inside the Electron ABI.
- `~/.config/voxterm/settings.json` is written with validated defaults.
- `~/.config/voxterm/activity.json` records `app.started`, two `terminal.created`
  events (zsh, cwd `/home/maisamabbas`) and `external.discovered` events.
- Genuine tmux discovery confirmed against a real `tmux:voxterm_probe` session
  (state `attachable`); desktop-terminals discovery returned 14 detected sessions.
- All test processes (electron, Xvfb, tmux probe) were cleaned up afterwards.

`scripts/verify-pty.cjs` spawns a real PTY shell under Electron and waits for the
`VOXTERM_PTY_OK:` marker; `scripts/verify-env.cjs` prints a JSON snapshot of
versions, shells, tmux/screen and coding-agent availability.

---

## Known limitations (honest)

1. **Voice is not runtime-active.** No microphone capture, no transcription, no
   announcement playback. The settings, `SystemInfo.whisper` readiness probes and
   the Voice page exist so the next milestone can drop a real pipeline in.
   The Voice page states this explicitly — it does not pretend to work.
2. **Prompt generation is not runtime-active.** `prompts` settings (provider
   priority, `localOnly`) are persisted and validated but nothing consumes them yet.
3. **desktop-terminals is detection-only.** Attaching to another process's
   controlling terminal has no portable Linux API. tmux/screen are the only
   genuinely attachable external sources. The UI labels detected-only entries.
4. **Sandbox caveat in this environment.** The app was launched here under Xvfb
   with `--no-sandbox` (`VOXTERM_DISABLE_CHROMIUM_SANDBOX=1`) because the Chromium
   SUID sandbox is not configured in this container. `webPreferences.sandbox:true`
   is retained, and on a normal desktop install the Chromium sandbox should be
   left enabled; this path has not been re-tested under a standard display session.
5. **`npm audit` reports 8 moderate transitive vulnerabilities** (tooling chain,
   likely electron-builder). Not addressed in this milestone; no runtime-facing
   advisories were identified.
6. **Renderer bundle is ~1.4 MB** (zod + xterm + react). Fine for a desktop app;
   flagged in case startup regresses later.
7. **Packaging (`npm run package`) was not executed** in this environment (it
   produces AppImage/deb via electron-builder and requires additional system
   tooling). The config is in place (`electron-builder.yml`), and the build step it
   depends on passes.

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
- Optional: additional external providers, and a packaging/release pass.

See `agent.md` for architecture, the security model and extension points.
