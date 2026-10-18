<div align="center">

<img src="docs/logo.svg" width="120" alt="VoxTerm logo"/>

# VoxTerm

**Type less. Talk more. Ship code.**


[![GitHub release](https://img.shields.io/badge/version-0.1.0-60a5fa)](./package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-5eead4)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-linux%20%7C%20macOS%20%7C%20windows-a78bfa)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)]()
[![Electron](https://img.shields.io/badge/Electron-context--isolated-47848f?logo=electron&logoColor=white)]()
[![Hacktoberfest](https://img.shields.io/badge/Hacktoberfest-2026--Week%202-ff5f57?logo=digitalocean&logoColor=white)](https://hacktoberfest.com)
[![Tests](https://img.shields.io/badge/tests-95%20passing-28c840)](./tests)

</div>

---

> **VoxTerm is a premium, voice-ready terminal workspace for developers.** Real OS
> terminals, speech-to-text dictation, agent-agnostic CLI support and an explicit
> human-in-the-loop workflow — no placeholder buttons, no fabricated statistics,
> no fake AI badges.

## 🎯 What makes it different

| Feature | Status | What it really does |
| --- | :---: | --- |
| 🖥 **Real OS terminals** | ✅ | Genuine `node-pty` sessions (bash, zsh, fish…): input/output, resize, copy/paste, Unicode, stable session IDs, correct cleanup |
| 🎙 **Speech-to-text dictation** | ✅ | Microphone capture in the renderer → ElevenLabs transcription; text is inserted into the terminal (never executed for you) |
| 🌍 **Multilingual** | ✅ | Automatic language detection or explicit selection; English, Urdu, Hindi, Arabic, Spanish and more |
| 🤖 **Gemma enhancement** | ✅ | Real provider chain: **Ollama** → **Google AI Studio** with timeouts, fallback and honest per-provider status |
| 🔒 **Local-only privacy** | ✅ | One switch blocks every cloud request; use Ollama to keep all text on the machine |
| 🖧 **tmux / screen attach** | ✅ | Live discovery of sessions running outside VoxTerm; `$N`-id targeting for dotted/colon names; shared/busy caveats surfaced honestly |
| 🔊 **ElevenLabs announcements** | ✅ | Real text-to-speech for app events; never reads terminal contents or secrets aloud |
| 🧩 **Agent agnostic** | ✅ | Claude Code, OpenCode, Codex, Gemini CLI — plain installed-binary detection, nothing fabricated |

> Every control in the UI performs its advertised action — or tells you exactly
> why the capability is unavailable. That is the first rule of VoxTerm.

## ⌨️ Shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+F` | Find in terminal (Terminals view only) |
| `Ctrl+Alt+Space` | Global voice hotkey (configurable in Settings → Voice) |
| `Ctrl+Shift+T` / `W` | New / close terminal |
| `Ctrl+Tab` / `Ctrl+1–9` | Switch sessions |
| `Ctrl+=` `-` `0` | Terminal zoom |

## 🚀 Quick start

```bash
git clone https://github.com/maisamabbas0323/voxterm.git
cd voxterm
npm install                # also rebuilds node-pty against Electron
cp .env.example .env       # optional: add API keys here
npm run dev                # launch the desktop app
```

```bash
npm run build              # typecheck + production build
npm test                   # 95 automated tests
npm run lint               # eslint, zero-tolerance
npm run package            # AppImage / deb via electron-builder
```

### Configure it from `.env` (optional)

Copy `.env.example` to `.env` and fill in what you need — the app loads it at
startup and treats those credentials as already configured in Settings. A value
you type in the app always wins over the environment.

```bash
VOXTERM_GOOGLE_API_KEY=...      # hosted Gemma prompt enhancement
VOXTERM_ELEVENLABS_API_KEY=...  # speech-to-text + spoken announcements
VOXTERM_ELEVENLABS_VOICE_ID=... # optional announcement voice
```

### Enable the voice engine

1. Settings → **Voice** → enable voice input and pick your hotkey.
2. Add an **ElevenLabs** key (Settings → System & credentials, or
   `VOXTERM_ELEVENLABS_API_KEY` in `.env`).
3. Hold the hotkey on the **Terminals** view to record; the transcript is
   enhanced by Gemma (optional) and inserted into the active terminal.

> Dictation is sent to ElevenLabs for transcription. Prompt enhancement is
> opt-in per provider and additionally gated by Settings → Privacy → local-only
> mode. Choose **Ollama** to keep everything on your machine.

## 🏗 Architecture

```
src/
├── main/            # Electron main: terminals, voice, prompts, ipc, external
│   ├── terminals/   # node-pty SessionManager (stable ids, crash-safe)
│   ├── voice/       # ElevenLabs speech-to-text + global hotkey
│   ├── prompts/     # provider fallback chain (ollama → google)
│   ├── external/    # tmux / screen discovery + attach
│   ├── announcements/ # ElevenLabs TTS for app events
│   └── settings/    # zod-validated settings, secrets, .env loading
├── preload/         # typed contextBridge — no node in the renderer
├── renderer/        # React 19 + xterm.js, tokens, feature modules
└── shared/          # schemas (zod) + ipc contract, single source of truth
```

**Security posture:** context isolation on, renderer node-integration off,
zod-validated typed IPC, credentials in OS keychain (`safeStorage`) or read from
`.env` in the main process only, log redaction, per-session pty cleanup on exit.

## 🧪 Verification matrix

| Check | Linux | macOS | Windows |
| --- | :-: | :-: | :-: |
| typecheck · lint · 95 tests · build | ✅ | ⬜ needs runner | ⬜ needs runner |
| UI smoke (real Electron, CDP) | ✅ | ⬜ | ⬜ |
| node-pty rebuild + shell adapters | ✅ | ⬜ | ⬜ |

## 🤝 Hacktoberfest 2026 — Week 2

This repo is hackathon-first, issues-first. Great first contributions:

- Windows/macOS verification matrix (needs real runners or hardware)
- More TTS/announcement providers
- Speaker diarization or word-timestamp highlighting in the dictation flow
- Accessibility pass: keyboard-only voice review flow

Look for `good first issue` labels — keep PRs honest, tested and scoped.

## 👤 Author

**Maisam Abbas** — [github.com/@maisamabba0323](https://github.com/maisamabbas0323)



<div align="center"><sub><em>VoxTerm — where the prompt speaks before you type.</em></sub></div>
