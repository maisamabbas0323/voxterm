/**
 * Curated monospace families offered for the terminal. Each value is a full
 * CSS font stack so xterm falls back gracefully when a family is not installed
 * on the machine. This is a display catalogue only — nothing is bundled.
 *
 * NOTE: `TERMINAL_FONTS[0].stack` must stay identical to the `terminalFontFamily`
 * default in `src/shared/schemas.ts` so a fresh install selects a listed family
 * instead of falling back to "Custom stack".
 */
export interface TerminalFont {
  id: string
  /** Human label shown in the picker. */
  label: string
  /** Full CSS font-family stack applied to xterm. */
  stack: string
  /** Short note about the face, shown under the picker. */
  note: string
}

export const TERMINAL_FONTS: TerminalFont[] = [
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    stack: '"JetBrains Mono", "JetBrainsMono Nerd Font", "Fira Code", monospace',
    note: 'Tall x-height, ligatures, made for code.'
  },
  {
    id: 'fira-code',
    label: 'Fira Code',
    stack: '"Fira Code", "FiraCode Nerd Font", "JetBrains Mono", monospace',
    note: 'Warm, rounded, famous ligature set.'
  },
  {
    id: 'cascadia-code',
    label: 'Cascadia Code',
    stack: '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", monospace',
    note: 'Microsoft’s terminal-native coding face.'
  },
  {
    id: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    stack: '"IBM Plex Mono", "JetBrains Mono", monospace',
    note: 'Crisp, neutral, excellent at small sizes.'
  },
  {
    id: 'source-code-pro',
    label: 'Source Code Pro',
    stack: '"Source Code Pro", "JetBrains Mono", monospace',
    note: 'Clean and highly legible for long sessions.'
  },
  {
    id: 'victor-mono',
    label: 'Victor Mono',
    stack: '"Victor Mono", "JetBrains Mono", monospace',
    note: 'Distinctive semi-connected italics.'
  },
  {
    id: 'hack',
    label: 'Hack',
    stack: '"Hack", "DejaVu Sans Mono", monospace',
    note: 'Designed specifically for source code.'
  },
  {
    id: 'ubuntu-mono',
    label: 'Ubuntu Mono',
    stack: '"Ubuntu Mono", "DejaVu Sans Mono", monospace',
    note: 'Ubuntu’s friendly, compact mono.'
  },
  {
    id: 'roboto-mono',
    label: 'Roboto Mono',
    stack: '"Roboto Mono", "DejaVu Sans Mono", monospace',
    note: 'Balanced, modern, always readable.'
  },
  {
    id: 'space-mono',
    label: 'Space Mono',
    stack: '"Space Mono", "DejaVu Sans Mono", monospace',
    note: 'Quirky retro character, strong personality.'
  },
  {
    id: 'sf-mono',
    label: 'SF Mono',
    stack: '"SF Mono", "SFMono-Regular", ui-monospace, monospace',
    note: 'Apple’s system monospace.'
  },
  {
    id: 'menlo',
    label: 'Menlo',
    stack: 'Menlo, "DejaVu Sans Mono", monospace',
    note: 'The classic macOS terminal face.'
  },
  {
    id: 'consolas',
    label: 'Consolas',
    stack: 'Consolas, "DejaVu Sans Mono", monospace',
    note: 'The familiar Windows console font.'
  },
  {
    id: 'dejavu-sans-mono',
    label: 'DejaVu Sans Mono',
    stack: '"DejaVu Sans Mono", "Liberation Mono", monospace',
    note: 'Widely installed on Linux; safe default.'
  },
  {
    id: 'liberation-mono',
    label: 'Liberation Mono',
    stack: '"Liberation Mono", "DejaVu Sans Mono", monospace',
    note: 'Metric-compatible with Courier New.'
  },
  {
    id: 'system-mono',
    label: 'System monospace',
    stack: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "DejaVu Sans Mono", monospace',
    note: 'Whatever the operating system prefers.'
  }
]

/** The stack used when a stored value does not match any known entry. */
export const DEFAULT_FONT_STACK = TERMINAL_FONTS[0].stack

/** Resolve a stored family string back to a catalogue entry (or undefined). */
export function findTerminalFont(value: string): TerminalFont | undefined {
  return TERMINAL_FONTS.find((font) => font.stack === value)
}

/** The label to show for an arbitrary stored stack. */
export function fontLabelFor(value: string): string {
  return findTerminalFont(value)?.label ?? 'Custom'
}
