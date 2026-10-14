import { mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LoggerOptions {
  directory: string
  enabled: boolean
  redact: boolean
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /(authorization|api[-_]?key|token|secret|bearer)["'\s:=]+[^\s"']+/gi
]

function redact(value: string): string {
  let output = value
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match) => `${match.slice(0, 4)}<redacted>`)
  }
  return output
}

/**
 * Minimal file logger. When disabled it becomes a no-op so nothing is written
 * to disk. Secrets are redacted before writing by default.
 */
export class Logger {
  private options: LoggerOptions
  private filePath: string

  constructor(options: LoggerOptions) {
    this.options = options
    try {
      mkdirSync(options.directory, { recursive: true })
    } catch {
      /* logging must never crash the app */
    }
    this.filePath = join(options.directory, 'voxterm.log')
  }

  configure(partial: Partial<LoggerOptions>): void {
    this.options = { ...this.options, ...partial }
  }

  private write(level: LogLevel, scope: string, message: string): void {
    if (!this.options.enabled) return
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${scope}: ${message}\n`
    const safe = this.options.redact ? redact(line) : line
    try {
      appendFileSync(this.filePath, safe, { mode: 0o600 })
    } catch {
      /* ignore write failures */
    }
  }

  debug(scope: string, message: string): void {
    this.write('debug', scope, message)
  }
  info(scope: string, message: string): void {
    this.write('info', scope, message)
  }
  warn(scope: string, message: string): void {
    this.write('warn', scope, message)
  }
  error(scope: string, message: string): void {
    this.write('error', scope, message)
  }
}
