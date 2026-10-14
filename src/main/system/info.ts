import { app } from 'electron'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { hostname, release } from 'node:os'
import type { ExternalProviderInfo, SystemInfo, ToolAvailability } from '@shared/types'
import type { Settings } from '@shared/schemas'
import { expandHome, resolveShell } from '../terminals/shell'
import { detectToolVersion, findExecutable } from '../util/exec'
import { BUILTIN_AGENT_PROFILES } from '@shared/agents'

export interface SystemInfoDeps {
  resolvePath: () => Promise<string>
  getSettings: () => Settings
  getProviders: () => ExternalProviderInfo[]
}

async function toolAvailability(name: string, path: string, versionArgs: string[] = ['--version']): Promise<ToolAvailability> {
  const resolved = await findExecutable(name, path)
  const version = resolved ? await detectToolVersion(resolved, versionArgs) : null
  return { name, path: resolved, available: Boolean(resolved), version }
}

async function fileExists(path: string): Promise<boolean> {
  if (!path) return false
  try {
    await access(expandHome(path), constants.F_OK)
    return true
  } catch {
    return false
  }
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

  const [tmux, screen, whisperBinary] = await Promise.all([
    toolAvailability('tmux', pathValue, ['-V']),
    toolAvailability('screen', pathValue, ['--version']),
    findExecutable('whisper.cpp', pathValue).then(async (cpp) => cpp ?? (await findExecutable('whisper', pathValue)))
  ])

  const agents = await Promise.all(
    BUILTIN_AGENT_PROFILES.map(async (profile) => {
      const resolved = await findExecutable(profile.command, pathValue)
      const version = resolved ? await detectToolVersion(resolved, ['--version']) : null
      return { name: profile.name, path: resolved, available: Boolean(resolved), version }
    })
  )

  const modelPath = settings.voice.whisperModelPath.trim()
  const modelPresent = await fileExists(modelPath)

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
    whisper: {
      provider: settings.voice.transcriptionProvider,
      binaryPath: whisperBinary,
      modelPath: modelPath || null,
      modelPresent,
      // Transcription is not implemented until the next milestone; readiness
      // reflects only whether the underlying pieces are present.
      available: Boolean(whisperBinary) && modelPresent
    },
    terminalBackend: (() => {
      const status = ptyStatus()
      return { nodePty: status.ok, ptyVersion: status.version, error: status.error }
    })(),
    externalDiscovery: {
      enabled: settings.external.discoveryEnabled,
      providers: deps.getProviders()
    }
  }
}
