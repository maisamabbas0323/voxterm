# VoxTerm — Progress

A premium, voice-ready terminal workspace for Linux (Electron + React + TypeScript).

**Status: complete and verified.** The app is a real, working Electron application
— not a mockup. It boots, creates genuine `node-pty` shells, persists validated
settings, mounts real xterm.js terminals, transcribes speech with ElevenLabs,
enhances prompts with Ollama/Google and shuts down cleanly. Voice controls live in
Settings; external tmux/screen sessions are discovered live and offered as
attachable tabs. Honest limitations are listed below.

---

## Milestone 2 — Dictation, Gemma providers and live external tabs (this change)

### Whisper removed; dictation now uses ElevenLabs
- Deleted `src/main/voice/whisper.ts` and the whisper-model test. The vendored
  `.deps/whisper.cpp` build and `scripts/setup-runtime.sh` are gone; the app no
  longer touches a local inference runtime.
- New `src/main/voice/elevenlabsStt.ts`: `POST https://api.elevenlabs.io/v1/speech-to-text`
  with `xi-api-key`, multipart `file` + `model_id` (`scribe_v1` default) and an
  optional `language_code`. Failures are returned as structured outcomes and the
  API key is scrubbed from every message. 11 unit tests cover it.
- `VoiceController` now derives readiness from the stored/environment key, exposes
  `VoiceStatus.stt`, and reports `not-configured` honestly when no key exists.
  `SystemInfo.whisper` became `SystemInfo.stt`.

### Voice moved out of its own page
- The **Voice nav tab and page were removed.** Voice controls now live in
  Settings → Voice (enable, terminal-only, hotkey, model, language, min length,
  auto-enhance, auto-insert). The review page and its store machinery were deleted.
- A finished capture is now: optional Gemma enhancement → insert into the active
  terminal (never executed) → toast. If auto-insert is off or there is no active
  session, the text is copied to the clipboard so it is never lost.
- The hotkey is only honoured on the Terminals view while `terminalOnly` is on
  (the default), so a stray press can never open the microphone elsewhere.

### Google uses the API key only; Ollama uses the user's setup
- OpenRouter was removed from schemas, types, providers, service, IPC and UI. The
  provider set is exactly `ollama` and `google`.
- Google **always** targets `https://generativelanguage.googleapis.com/v1beta`
  with `x-goog-api-key`; the base-URL field was removed from Settings. Ollama
  keeps its configurable base URL/model and uses whatever the user has running.
- Provider priority is chosen with two explicit "First/Second provider" selects.

### Credentials from `.env` auto-fill Settings
- `.env.example` documents `VOXTERM_GOOGLE_API_KEY`, `VOXTERM_ELEVENLABS_API_KEY`
  and the optional non-secret `VOXTERM_GOOGLE_MODEL`,
  `VOXTERM_ELEVENLABS_VOICE_ID`, `VOXTERM_ELEVENLABS_MODEL`.
- A tiny self-contained loader (`settings/loadEnv.ts`) reads `.env` in the main
  process only (no new dependency); the real environment always wins. `getSecret`
  and `secretsStatus` fall back to it, so the GUI shows those keys as configured,
  and non-secret defaults fill in when the setting is untouched.

### Ctrl+F is scoped to the terminal
- Find now only fires on the Terminals view. It is not consumed on any other page,
  and `Ctrl+Shift+F` no longer navigates from elsewhere. The old `Ctrl+F` voice
  toggle is gone; the default voice hotkey is `Ctrl+Alt+Space` (an existing
  `Ctrl+F` binding is migrated automatically).

### External sessions appear as tabs
- While the Terminals view is open, tmux/screen discovery runs on a 15 s poll and
  every attachable session is listed in a compact strip directly under the tabs —
  one click attaches using the exact multiplexer target, without opening a dialog.

### Settings migration
- `settings.json` version 2 turns on the Google provider, clears both local-only
  switches (so an explicitly configured cloud key is actually used) and moves an
  old `Ctrl+F` hotkey off the key now reserved for find.

---

## Milestone 1.2 — Brand refresh + UI/UX pass (this change)

### New hand-crafted mark, all gradients retired
- Assets live in `assets/brand/`: `logo-mark.svg` (64-grid, `currentColor`),
  `logo-mark-accent.svg` (tallest bar #6C8CFF, rest #F2F4F8), `app-icon.svg`
  (black rounded plate, mark ≈55% width), `wordmark.svg` (mark at cap height
  beside "VoxTerm" outlines extracted from Lato Semibold — no font needed to
  render it), and `favicon-{16,32,48,256}.png`. `logo-preview.html` shows
  every size and surface before use.
- The mark: a **terminal chevron plus three rounded voice bars (short, tall,
  medium)** — “Vox” and “Term” in one stroke-built gesture. Round caps, two
  stroke weights (6.5 / 6 on a 64-unit grid), one flat accent colour, no
  gradients, no glow, no letter V.
- PNG exports are geometric, not SVG-rasterised: `scripts/make-favicons.py`
  mirrors the mark coordinates with PIL (8× supersample) and produces the
  favicons plus `resources/icon.png` (512²) used by electron-builder and now
  passed to the BrowserWindow (`main/window.ts` resolves it from the app
  path, falling back to `process.resourcesPath`).
- `scripts/make-wordmark.py` extracts real glyph outlines from Lato Semibold
  so the committed `wordmark.svg` is pure paths.
- In-app: `components/Logo.tsx` renders the new mark (strokes follow
  `currentColor`, accent bar picks up `--accent`); boot splash and title bar
  use it.

### Design system + shell polish
- Tokens refreshed: surfaces sit on a deliberate near-black tonal ladder,
  borders one step apart from surfaces, text contrast raised, and the theme
  accent unified on the brand blue `#6C8CFF` (terminal theme follows).
- Page titles use the display size; subtitles are capped in measure length.
- Stat cards are compact (smaller padding/type scale) — information density
  over dashboard sprawl; the redundant “Terminal backend” card was folded
  into the System panel (which always reflected the real node-pty check).
- Activity rows get an explicit repeat-count pill; coalesced events now show
  e.g. “Settings updated: appearance x6”.
- Toasts and overlays pick up restrained backdrop blur; active tabs get a
  2px accent underline; helper text everywhere uses the raised muted value.

### Voice page, told honestly
- One hero status row (off / runtime-not-ready / ready) backed by real
  checks: whisper-server binary on PATH, GGML model on disk, language,
  hotkey and review preference. A four-step flow (capture → transcribe →
  review → send) explains the intended pipeline, and the page states plainly
  that capture/transcription is not active in this build. No decorative
  waveform, no fake states. (Capture pipelines are still future work.)

### Verification
- `npm run typecheck`, `npm run lint` (0 errors, 4 warnings),
  `npm test` (19/19), `npm run build`, and `npm run verify:ui` (25/25):
  all pass, including no horizontal overflow at 1320px and 560px on every
  page, and the nav rail still renders correctly with tooltips attached.
- Note: `verify:ui` needs an isolated profile when a dev instance holds the
  single-instance lock: `SMOKE_USER_DATA=/tmp/x CDP_PORT=9333 xvfb-run -a
  node scripts/verify-ui.cjs`.
- Not performed here: real visual inspection on macOS/Windows (Linux Xvfb
  only), and eyeballing the SVG renders — geometry was validated
  programmatically (pixel sampling) rather than by eye.

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
| Unit tests        | `npm test`               | PASS — 105 tests / 8 files                    |
| Production build  | `npm run build`          | PASS — `out/{main,preload,renderer}` produced |
| Runtime UI        | `npm run verify:ui`      | PASS — 27/27 checks                           |
| PTY under Electron| `scripts/verify-pty.cjs` | PASS                                          |
| Env discovery     | `scripts/verify-env.cjs` | PASS                                          |

Test files: `tests/settings.test.ts` (schema + section recovery + migration),
`tests/agents.test.ts` (launch-command/arg/env validation),
`tests/ipc-schemas.test.ts` (IPC payload validation & clamping),
`tests/prompts.test.ts` (Ollama/Google provider chain, redaction, local-only),
`tests/elevenlabsStt.test.ts` (speech-to-text client), `tests/external.test.ts`
(tmux/screen parsing and attach targeting), `tests/announcements.test.ts`
(announcement routing and TTS request shape), `tests/env.test.ts`
(`.env` secret mapping and file loader).

The only lint output is three benign `react-refresh/only-export-components`
warnings (files that intentionally export a component plus a helper) with **0
errors**.

### Runtime verification (`scripts/verify-ui.cjs`, headless under Xvfb)

27/27 checks pass against the **built** app with a fresh user-data directory:

- app boots past the loading screen; **no renderer console errors**;
- sidebar is compact (60 px) and all four nav icons stay **visible, inside the
  rail and centred** — the collapsed-icon bug is fixed;
- the branded "V" logo renders in the title bar;
- the standalone **Voice nav item is gone** and every remaining nav item is
  clickable;
- the Terminals page exposes a real **attach control** and a terminal-scoped
  **find control**, and Settings carries the "External sessions" section;
- the terminal font is a dropdown (16 curated families) with a preview, and a
  fresh install's stored value resolves to a listed family ("JetBrains Mono"), not
  "Custom stack";
- **no horizontal overflow** on any page at desktop width *or* at 560 px;
- the Detected-tooling panel is hidden at 560 px and returns at desktop width;
- the Terminals page mounts a real xterm surface (real `node-pty` shell).

`scripts/verify-pty.cjs` spawns a real PTY shell under Electron and waits for the
`VOXTERM_PTY_OK:` marker; `scripts/verify-env.cjs` prints a JSON snapshot of
versions, shells, tmux/screen and coding-agent availability.

### Live provider checks (real keys, 2026-10-18)

Run ad-hoc against the configured credentials (never printed, never committed):

- **Google (hosted Gemma):** `GET /v1beta/models?pageSize=1000` returned 200 with
  46 usable models including `gemma-4-31b-it` and `gemma-4-26b-a4b-it`, and
  `:generateContent` answered on both (one transient HTTP 500 succeeded on
  retry). The Google path is verified end to end with the API key alone.
- **Voice settings migration:** a profile holding the previous `settings.json`
  (version 1) was loaded and rewritten as version 2 — `Ctrl+f` hotkey moved to
  `Ctrl+Alt+Space`, the removed `whisper*`/`transcriptionProvider` keys dropped,
  Google enabled and local-only cleared — exactly as documented above.
- **ElevenLabs TTS:** a real synthesis request succeeded (16 kHz PCM returned).
- **ElevenLabs STT:** the request reached the API and authenticated, but the
  stored key is **missing the `speech_to_text` permission**, so transcription is
  refused with `The API key you used is missing the permission speech_to_text`.
  This is a credential-scope issue, not a code issue — our client surfaced the
  message (with the key scrubbed). Grant the key the `speech_to_text` scope in
  the ElevenLabs dashboard to enable dictation.

---

## Known limitations (honest)

1. **Dictation requires an ElevenLabs key with the `speech_to_text` scope.** The
   key configured here can synthesize speech but is refused for transcription
   (`missing the permission speech_to_text`) — grant that scope in the ElevenLabs
   dashboard to enable dictation. With no key at all the UI says so and refuses to
   record. There is no offline transcription path, and transcript text is never
   written to the activity log.
2. **Prompt enhancement requires a provider.** Ollama runs against whatever the
   user has at its configured base URL (calls fail fast with a clear message when
   nothing is listening); Google needs a key and respects local-only mode.
3. **External sessions are attach-only.** tmux/screen discovery is live, but
   VoxTerm never terminates a session it did not create, and closing an attached
   tab only detaches.
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

## Milestone update — verification pass (2026-10-17)

All checks now run green and were verified in this session:

- **typecheck** (`npm run typecheck`) — clean.
- **tests** (`npm test`) — 81 passed / 6 files. Fixed 4 stale `tests/external.test.ts`
  expectations: `ExternalSession` now carries the real `target`/`busy` fields the
  attach flow depends on, and the tmux parser surfaces the documented
  `"."`/`":"`-name targeting caveat via `reason`.
- **lint** (`npm run lint`) — 0 errors / 3 fast-refresh warnings. Fixed:
  `.deps/**` (vendored whisper.cpp checkout) added to eslint ignores so lint no
  longer scans upstream sources; conditional `useState`/`useEffect` moved above
  the early return in `SettingsPage`; `capture.ts` errors now preserve `cause`;
  removed a useless expression in `capture.ts` teardown.
- **build** (`npm run build`) — production build passes (~1.46 MB renderer).
- **Runtime UI harnesses** (real Electron under Xvfb, CDP-attached):
  `scripts/verify-ui.cjs` 25/25, `verify-tooltip.cjs` 4/4, `verify-workspace.cjs`
  all checks passed. Two harness expectations were updated to match the shipped
  feature set: the external-sessions section now exists in Settings, so the harness
  asserts its presence (with real controls) instead of absence. `verify-ui.cjs`
  also surfaces captured Electron stderr on failure to make CI debuggable.
- **Whisper end-to-end (Linux)**: vendored `.deps/whisper.cpp/build/bin/whisper-cli` +
  auto-discovered `~/Downloads/ggml-base.bin` (147 MB, magic-validated) performed a
  real offline transcription of a generated wav (single 1.9 s segment). The
  handler records the real path/duration/source and does not fabricate results.

## Next milestones

- Per-agent adapters enabling `promptInjection` / `structuredEvents`.
- Optional: a packaging/release pass, and a real macOS/Windows verification run.

See `agent.md` for architecture, the security model and extension points.
