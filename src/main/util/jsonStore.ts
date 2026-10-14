import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync, copyFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface JsonReadResult<T> {
  data: T | null
  /** True when a file existed but could not be parsed. */
  corrupted: boolean
  /** Path to a backup copy made when the file was corrupted. */
  backupPath?: string
  error?: string
}

/**
 * Small JSON persistence helper. Writes are atomic (temp file + rename) and
 * files are created with owner-only permissions. Corrupted files are backed up
 * rather than deleted so unrelated user data is never silently destroyed.
 */
export class JsonStore<T> {
  constructor(private readonly filePath: string) {}

  get path(): string {
    return this.filePath
  }

  read(): JsonReadResult<T> {
    if (!existsSync(this.filePath)) {
      return { data: null, corrupted: false }
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      if (!raw.trim()) return { data: null, corrupted: false }
      return { data: JSON.parse(raw) as T, corrupted: false }
    } catch (error) {
      const backupPath = `${this.filePath}.invalid-${Date.now()}.bak`
      try {
        copyFileSync(this.filePath, backupPath)
      } catch {
        /* ignore backup failures */
      }
      return {
        data: null,
        corrupted: true,
        backupPath,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  write(data: T): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
    const temp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`
    writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, this.filePath)
    try {
      chmodSync(this.filePath, 0o600)
    } catch {
      /* best effort */
    }
  }
}
