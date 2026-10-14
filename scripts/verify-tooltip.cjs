const { spawn } = require('node:child_process')
const path = require('node:path')

const PORT = Number(process.env.CDP_PORT || 9341)
const BASE = `http://127.0.0.1:${PORT}`
const ROOT = process.argv[2] || path.resolve(__dirname, '..')
const USER_DATA = process.env.SMOKE_USER_DATA || ''
const DISPLAY = process.env.DISPLAY || ':99'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, ok, detail) {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`)
}

async function waitForPage(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {}
    await sleep(250)
  }
  throw new Error('DevTools target never appeared')
}

async function main() {
  const child = spawn(
    `${ROOT}/node_modules/electron/dist/electron`,
    ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox', ...(USER_DATA ? [`--user-data-dir=${USER_DATA}`] : [])],
    { cwd: ROOT, env: { ...process.env, DISPLAY, VOXTERM_DISABLE_CHROMIUM_SANDBOX: '1' }, stdio: 'ignore' }
  )
  const page = await waitForPage()
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)))
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed')
    return r.result?.result?.value
  }
  await send('Runtime.enable')
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    if ((await evaluate(`document.querySelector('.app') ? 1 : 0`)) === 1) break
    await sleep(300)
  }

  // Hover the second nav icon (Terminals) via mouse events, then check tooltip.
  for (const width of [1280, 720]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(250)
    // Leave whatever the pointer was over, then hover the second nav icon.
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 600 })
    await sleep(100)
    await send('Runtime.evaluate', { expression: `(function(){
      const target = [...document.querySelectorAll('.nav-item')][1]
      const r = target.getBoundingClientRect()
      window.__tt = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()` })
    const { x, y } = (await send('Runtime.evaluate', { expression: 'window.__tt', returnByValue: true })).result.result.value
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await sleep(500)
    const out = await evaluate(`(async () => {
      const target = [...document.querySelectorAll('.nav-item')][1]
      const r = target.getBoundingClientRect()
      const tip = document.querySelector('.tooltip')
      const res = {}
      if (tip) {
        const tr = tip.getBoundingClientRect()
        res.text = tip.textContent
        res.rect = { l: Math.round(tr.left), r: Math.round(tr.right), t: Math.round(tr.top), b: Math.round(tr.bottom) }
        res.insideViewport = tr.left >= 0 && tr.right <= window.innerWidth && tr.top >= 0 && tr.bottom <= window.innerHeight
        res.rightOfAnchor = tr.left >= r.right
        res.oneLine = getComputedStyle(tip).whiteSpace === 'nowrap'
        res.role = tip.getAttribute('role')
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await new Promise(r2 => setTimeout(r2, 80))
      res.hiddenAfterEscape = !document.querySelector('.tooltip')
      return res
    })()`)
    check(
      `tooltip(${width}px) appears next to the icon, inside viewport, one line`,
      out && out.rect && out.insideViewport && out.rightOfAnchor && out.oneLine && out.role === 'tooltip',
      JSON.stringify(out)
    )
    check(`tooltip(${width}px) hides on Escape`, out.hiddenAfterEscape)
  }
  await send('Emulation.clearDeviceMetricsOverride')
  try { ws.close() } catch {}
  child.kill('SIGKILL')
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2) })
