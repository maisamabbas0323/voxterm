import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'

export interface ExecResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  /** Present when the process failed to spawn or timed out. */
  error?: string
  timedOut: boolean
}

export interface ExecOptions {
  timeoutMs?: number
  cwd?: string
  env?: NodeJS.ProcessEnv
  maxBuffer?: number
}

/**
 * Run an executable directly (no shell interpolation) and capture its output.
 * Never pass user-controlled strings through `shell: true`.
 */
export function execFileSafe(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  const { timeoutMs = 5000, cwd, env, maxBuffer = 4 * 1024 * 1024 } = options
  return new Promise((resolve) => {
    let settled = false
    const child = execFile(
      command,
      args,
      { timeout: timeoutMs, cwd, env, maxBuffer, windowsHide: true, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (settled) return
        settled = true
        const code = (error as NodeJS.ErrnoException & { code?: number | string })?.code
        resolve({
          ok: !error,
          code: typeof code === 'number' ? code : error ? 1 : 0,
          stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
          stderr: typeof stderr === 'string' ? stderr : String(stderr ?? ''),
          error: error ? error.message : undefined,
          timedOut: Boolean(error && (error as { killed?: boolean }).killed)
        })
      }
    )
    child.on('error', (error) => {
      if (settled) return
      settled = true
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: error.message, timedOut: false })
    })
  })
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve an executable without invoking a shell. Supports absolute paths,
 * relative paths containing a separator, and bare names looked up on PATH.
 */
export async function findExecutable(name: string, pathValue?: string): Promise<string | null> {
  if (!name) return null
  if (isAbsolute(name) || name.includes('/')) {
    return (await isExecutable(name)) ? name : null
  }
  const path = pathValue ?? process.env.PATH ?? ''
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (await isExecutable(candidate)) return candidate
  }
  return null
}

let cachedUserPath: string | null = null
let userPathPromise: Promise<string> | null = null

/**
 * Determine the PATH a user's interactive login shell would see. GUI-launched
 * Electron processes on Linux often start with a minimal PATH, which would
 * hide tools such as coding agents. This resolves the shell PATH once and
 * caches it. Falls back to the process PATH on failure.
 */
export function resolveUserPath(): Promise<string> {
  if (cachedUserPath !== null) return Promise.resolve(cachedUserPath)
  if (userPathPromise) return userPathPromise
  userPathPromise = (async () => {
    const shell = process.env.SHELL || '/bin/bash'
    const result = await execFileSafe(shell, ['-lic', 'printf "%s" "$PATH"'], {
      timeoutMs: 4000,
      maxBuffer: 256 * 1024
    })
    if (result.ok && result.stdout.trim()) {
      const lines = result.stdout.trim().split(/\r?\n/)
      const candidate = lines[lines.length - 1]?.trim()
      if (candidate && candidate.includes('/')) {
        cachedUserPath = candidate
        return candidate
      }
    }
    cachedUserPath = process.env.PATH ?? ''
    return cachedUserPath
  })()
  return userPathPromise
}

/** Reset the cached login-shell PATH (used after settings changes). */
export function resetUserPathCache(): void {
  cachedUserPath = null
  userPathPromise = null
}

/** First non-empty line of a tool's `--version` output. */
export async function detectToolVersion(
  path: string | null,
  args: string[] = ['--version']
): Promise<string | null> {
  if (!path) return null
  const result = await execFileSafe(path, args, { timeoutMs: 3000 })
  const text = (result.stdout || result.stderr).trim()
  if (!text) return null
  return text.split(/\r?\n/)[0].slice(0, 160)
}
