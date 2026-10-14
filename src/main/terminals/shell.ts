import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, resolve } from 'node:path'
import { findExecutable } from '../util/exec'

export interface ResolvedShell {
  path: string
  name: string
}

const FALLBACK_CANDIDATES = ['/bin/bash', '/usr/bin/bash', '/bin/zsh', '/usr/bin/zsh', '/bin/sh', '/usr/bin/sh']

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    const info = await stat(path)
    return info.isFile()
  } catch {
    return false
  }
}

/** Expand a leading `~` to the user's home directory. */
export function expandHome(input: string): string {
  if (!input) return input
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2))
  return input
}

/**
 * Decide which shell to launch. Preference order:
 *   1. an explicitly configured shell (settings or per-session override)
 *   2. the user's `$SHELL`
 *   3. well-known bash/zsh/sh locations
 *   4. `/bin/sh`
 */
export async function resolveShell(
  preferred: string | undefined,
  pathValue?: string
): Promise<ResolvedShell> {
  if (preferred && preferred.trim()) {
    const candidate = expandHome(preferred.trim())
    if (isAbsolute(candidate) || candidate.includes('/')) {
      if (await isExecutableFile(candidate)) {
        return { path: candidate, name: basename(candidate) }
      }
    } else {
      const found = await findExecutable(candidate, pathValue)
      if (found) return { path: found, name: basename(found) }
    }
  }

  const envShell = process.env.SHELL
  if (envShell && (await isExecutableFile(envShell))) {
    return { path: envShell, name: basename(envShell) }
  }

  for (const candidate of FALLBACK_CANDIDATES) {
    if (await isExecutableFile(candidate)) {
      return { path: candidate, name: basename(candidate) }
    }
  }

  return { path: '/bin/sh', name: 'sh' }
}

/**
 * Resolve a startup directory. Returns the home directory when the requested
 * path is empty, missing or not a directory.
 */
export async function resolveStartupDirectory(requested: string | undefined, fallback: string): Promise<string> {
  const base = fallback && fallback.trim() ? fallback : homedir()
  if (!requested || !requested.trim()) {
    return (await isDirectory(base)) ? base : homedir()
  }
  const expanded = expandHome(requested.trim())
  if (await isDirectory(expanded)) return expanded
  if (await isDirectory(base)) return base
  return homedir()
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}
