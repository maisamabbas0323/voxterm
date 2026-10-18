import { app } from 'electron'
import { release, hostname } from 'node:os'
import type { SttRuntimeInfo, SystemInfo, ToolAvailability } from '@shared/types'
import type { Settings } from '@shared/schemas'
import { resolveShell } from '../terminals/shell'
import { detectToolVersion, findExecutable } from '../util/exec'
import { DEFAULT_STT_MODEL } from '../voice/elevenlabsStt'
import { BUILTIN_AGENT_PROFILES } from '@shared/agents'

export interface SystemInfoDeps {
  resolvePath: () => Promise<string>
  getSettings: () => Settings
  /** Whether an ElevenLabs key is available (stored or from the environment). */
  hasSttKey: () => boolean
}

async function toolAvailability(name: string, path: string, versionArgs: string[] = ['--version']): Promise<ToolAvailability> {
  const resolved = await findExecutable(name, path)
  const version = resolved ? await detectToolVersion(resolved, versionArgs) : null
  return { name, path: resolved, available: Boolean(resolved), version }
}

function ptyStatus(): { ok: boolean; version: string | null; error?: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('node-pty')
    let version: string | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      version = (require('node-pty/package.json') as { version?: string }).version ?? null
    } catch {
      version = null
    }
    return { ok: true, version }
  } catch (error) {
    return { ok: false, version: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Assemble a truthful snapshot of the environment VoxTerm is running in. */
export async function buildSystemInfo(deps: SystemInfoDeps): Promise<SystemInfo> {
  const pathValue = await deps.resolvePath()
  const settings = deps.getSettings()

  const [bash, zsh, sh, fish] = await Promise.all([
    toolAvailability('bash', pathValue, ['--version']),
    toolAvailability('zsh', pathValue, ['--version']),
    toolAvailability('sh', pathValue),
    toolAvailability('fish', pathValue, ['--version'])
  ])
  const resolvedShell = await resolveShell(settings.terminal.defaultShell, pathValue)

  const [tmux, screen] = await Promise.all([
    toolAvailability('tmux', pathValue, ['-V']),
    toolAvailability('screen', pathValue, ['--version'])
  ])

  const agents = await Promise.all(
    BUILTIN_AGENT_PROFILES.map(async (profile) => {
      const resolved = await findExecutable(profile.command, pathValue)
      const version = resolved ? await detectToolVersion(resolved, ['--version']) : null
      return { name: profile.name, path: resolved, available: Boolean(resolved), version }
    })
  )

  // Speech-to-text readiness comes from the same source the voice controller
  // uses, so System Info and Settings can never disagree.
  const stt: SttRuntimeInfo = {
    provider: 'elevenlabs',
    configured: deps.hasSttKey(),
    modelId: settings.voice.sttModelId.trim() || DEFAULT_STT_MODEL,
    detail: deps.hasSttKey()
      ? 'ElevenLabs speech-to-text is configured.'
      : 'No ElevenLabs API key is configured.'
  }

  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osRelease: `${process.platform} ${release()}`,
    hostname: hostname(),
    defaultShell: resolvedShell.path,
    shells: [bash, zsh, sh, fish].filter((shell) => shell.available),
    tmux,
    screen,
    agents,
    stt,
    terminalBackend: (() => {
      const status = ptyStatus()
      return { nodePty: status.ok, ptyVersion: status.version, error: status.error }
    })()
  }
}
