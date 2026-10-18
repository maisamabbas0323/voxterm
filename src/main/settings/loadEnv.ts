import { existsSync, readFileSync } from 'node:fs'

/**
 * Minimal `.env` loader.
 *
 * The app deliberately ships no dotenv dependency, so this parses the small
 * subset of the format users actually write: `KEY=value` lines, `#` comments,
 * an optional leading `export`, blank lines, and single- or double-quoted
 * values. For unquoted values a trailing ` # comment` is stripped.
 *
 * Like dotenv — and crucially for security — a variable that is already set in
 * the real environment is never overwritten, so an exported value always wins
 * over the file.
 *
 * @returns true when a file existed and was read (even if it set nothing).
 */
export function loadEnvFile(path: string): boolean {
  if (!existsSync(path)) return false

  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return false
  }

  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice('export '.length).trim()

    const eq = line.indexOf('=')
    if (eq <= 0) continue

    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue

    let value = line.slice(eq + 1).trim()
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    if (quoted) {
      value = value.slice(1, -1)
    } else {
      const comment = value.search(/\s#/)
      if (comment >= 0) value = value.slice(0, comment).trim()
    }

    if (process.env[key] === undefined) process.env[key] = value
  }

  return true
}
