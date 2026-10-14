/**
 * Prints a JSON snapshot of the ecosystem VoxTerm relies on inside the
 * Electron runtime: versions, shell detection, tmux availability and the
 * availability of common coding-agent executables.
 *
 * Run with:  xvfb-run -a npx electron scripts/verify-env.cjs
 */
const { app } = require('electron')
const { execFileSync } = require('node:child_process')

function which(command) {
  try {
    const out = execFileSync('sh', ['-lc', `command -v ${command}`], { encoding: 'utf8' }).trim()
    return out || null
  } catch {
    return null
  }
}

app.whenReady().then(() => {
  const report = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    modules: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
    os: `${process.getSystemVersion ? process.getSystemVersion() : ''}`,
    shells: {
      default: process.env.SHELL || null,
      bash: which('bash'),
      zsh: which('zsh'),
      sh: which('sh'),
      fish: which('fish')
    },
    tmux: which('tmux'),
    screen: which('screen'),
    agents: {
      opencode: which('opencode'),
      claude: which('claude'),
      codex: which('codex'),
      gemini: which('gemini'),
      aider: which('aider')
    },
    windowTools: {
      xdotool: which('xdotool'),
      wmctrl: which('wmctrl'),
      xprop: which('xprop')
    },
    pty: (() => {
      try {
        require('node-pty')
        return 'ok'
      } catch (error) {
        return `error: ${error.message}`
      }
    })()
  }
  console.log('VOXTERM_ENV_REPORT_BEGIN')
  console.log(JSON.stringify(report, null, 2))
  console.log('VOXTERM_ENV_REPORT_END')
  app.exit(0)
})
