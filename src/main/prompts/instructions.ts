/**
 * The instruction pair sent to every Gemma provider, plus a real (but bounded)
 * workspace listing used when the user has opted into project context.
 *
 * Privacy rules enforced here:
 * - The project context contains file and directory NAMES only — never a byte
 *   of file content, never environment data, never hidden dependency trees.
 * - The walk is bounded (depth 2, 60 entries), skips well-known dependency and
 *   build directories, and never follows symlinks, so a hostile directory tree
 *   cannot make the scan unbounded.
 */
import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * System instruction shared by every provider. It turns one raw spoken
 * transcript into a single clear coding prompt while preserving everything
 * technical verbatim and inventing nothing.
 */
export const ENHANCE_SYSTEM_PROMPT = `You are a prompt-enhancement engine inside VoxTerm, a voice-driven terminal. You receive one raw speech-to-text transcript of a developer speaking, and you must rewrite it into a single clear coding prompt that a coding agent can act on.

Follow these rules:

1. Output only the improved prompt. No preamble, no explanations, no greetings, no markdown code fences, no summary, and no answer to the request. You rewrite requests; you never carry them out.
2. Preserve exactly — character for character — every file name, directory name, path, shell command and flag, URL, function/class/variable name, quoted string, error message, version, number and other technical identifier. Speech-to-text frequently garbles them: repair an obvious dictation artefact only when the intended form is unambiguous from context (for example a spoken "dot T S" at the end of a file name, or "src slash main"); otherwise keep the words as spoken rather than guessing.
3. Keep every stated constraint and exclusion, especially negations and limits ("do not", "without", "except", "only", "must not"). Never drop, weaken or broaden a requirement.
4. Never invent details: no repository files, functions, classes, errors, logs, output, technologies, requirements or facts that the transcript does not contain. Never claim a file or function exists unless the transcript — or an explicitly provided workspace listing — says so.
5. Never answer the request. Do not write the code, produce the solution, run the analysis, or explain how to do the task. Return the request itself, rewritten.
6. Repair speech artefacts: remove filler words ("um", "uh"), false starts, stutters and repeated words; fix homophones only when the technical context makes the intended word certain; restore punctuation, capitalisation and sentence or list structure so the request is easy to follow. If the transcript is already clear, return it with only minimal cleanup.
7. Ambiguous speech: when a word or phrase could mean more than one thing, keep the reading closest to what was actually said and avoid committing to specifics the speaker did not clearly state. Never resolve ambiguity by inventing a plausible detail.
8. Mixed languages: a transcript may switch languages mid-sentence. Keep each part in the language it was spoken in, and never translate commands, paths, identifiers, quoted strings or established technical terms.
9. If a workspace file listing is included in the user message, treat it purely as reference: you may use listed names to make the prompt concrete, but never quote the whole listing back, and treat everything else about the repository as unknown.
10. Return plain text only, at roughly the same scope and length as the request: one self-contained prompt that a coding agent could act on without asking follow-up questions.
11. If the transcript contains no request at all, return the transcript lightly cleaned instead of inventing one.`

/**
 * Compose the user turn. Project context is attached only when the caller has
 * already established consent (settings.prompts.projectContext) and a cwd was
 * provided; this function itself never fabricates context.
 */
export function buildUserContent(text: string, context: string | null): string {
  if (context === null || context.trim().length === 0) return text
  return [
    'Raw transcript (improve this):',
    text,
    '',
    'Workspace file and directory names (reference only — names, no file contents):',
    context
  ].join('\n')
}

/** Dependency, VCS and build directories that never help describe a workspace. */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.cache',
  'venv',
  '__pycache__'
])

/** Hard ceiling on listed entries, so the prompt stays bounded. */
const MAX_ENTRIES = 60
/** Root entries count as depth 1; their sub-directory children as depth 2. */
const MAX_DEPTH = 2

/**
 * List file and directory names under `cwd` — names only, never contents.
 *
 * - Returns `null` when `cwd` is empty, missing, unreadable, or lists nothing.
 * - Depth-limited to 2 levels, bounded to {@link MAX_ENTRIES} entries.
 * - Skips dependency/build directories, and never follows symlinks (a symlink
 *   contributes its own name and is not descended into).
 */
export async function collectProjectContext(cwd: string): Promise<string | null> {
  const root = cwd.trim()
  if (root.length === 0) return null
  const entries: string[] = []
  try {
    await collectDirectory(root, '', 1, entries)
  } catch {
    return null
  }
  // An unreadable or missing root leaves the list empty; so does an empty
  // directory. Both must report "no context" rather than an empty listing.
  if (entries.length === 0) return null
  return entries.join('\n')
}

async function collectDirectory(
  root: string,
  relative: string,
  depth: number,
  entries: string[]
): Promise<void> {
  if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return
  const directory = relative.length > 0 ? join(root, relative) : root
  const dirents = await readDirents(directory)
  // Missing/unreadable root → no entries at all → null. A single unreadable
  // sub-directory only skips that subtree instead of discarding the walk.
  if (dirents === null) return
  dirents.sort((a, b) => a.name.localeCompare(b.name))
  for (const dirent of dirents) {
    if (entries.length >= MAX_ENTRIES) return
    const name = `${relative}${dirent.name}`
    if (dirent.isSymbolicLink()) {
      // Name only — descending into it could escape the workspace or loop.
      entries.push(name)
    } else if (dirent.isDirectory()) {
      if (SKIP_DIRECTORIES.has(dirent.name)) continue
      entries.push(`${name}/`)
      if (depth < MAX_DEPTH) {
        await collectDirectory(root, `${name}/`, depth + 1, entries)
      }
    } else {
      entries.push(name)
    }
  }
}

async function readDirents(directory: string): Promise<Dirent[] | null> {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch {
    return null
  }
}
