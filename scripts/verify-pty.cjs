/**
 * Verifies that node-pty loads and produces real output inside the Electron
 * runtime (not plain Node.js, which uses a different ABI).
 *
 * Run with:  xvfb-run -a npx electron scripts/verify-pty.cjs
 */
const { app } = require('electron')
const os = require('node:os')

function fail(message, code) {
  console.error(`VOXTERM_PTY_CHECK_FAIL: ${message}`)
  app.exit(code || 1)
}

app.whenReady().then(() => {
  let pty
  try {
    pty = require('node-pty')
  } catch (error) {
    fail(`require('node-pty') threw: ${error && error.message}`)
    return
  }

  const shell = process.env.SHELL || '/bin/bash'
  let buffer = ''
  let child

  try {
    child = pty.spawn(shell, ['-lc', 'printf "VOXTERM_PTY_OK:%s\\n" "$(uname -s)"; exit 0'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color' }
    })
  } catch (error) {
    fail(`pty.spawn threw: ${error && error.message}`)
    return
  }

  const timer = setTimeout(() => {
    fail(`timeout waiting for output. received=${JSON.stringify(buffer)}`)
  }, 10000)

  child.onData((data) => {
    buffer += data
    if (buffer.includes('VOXTERM_PTY_OK:')) {
      clearTimeout(timer)
      const line = buffer.split(/\r?\n/).find((entry) => entry.includes('VOXTERM_PTY_OK:'))
      console.log(`VOXTERM_PTY_CHECK_PASS: ${line.trim()}`)
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      app.exit(0)
    }
  })

  child.onExit(({ exitCode }) => {
    clearTimeout(timer)
    if (buffer.includes('VOXTERM_PTY_OK:')) {
      console.log('VOXTERM_PTY_CHECK_PASS')
      app.exit(0)
    } else {
      fail(`process exited (code=${exitCode}) without expected output: ${JSON.stringify(buffer)}`)
    }
  })
})
