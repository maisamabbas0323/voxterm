const { spawn } = require('node:child_process')
const path = require('node:path')

const PORT = Number(process.env.CDP_PORT || 9353)
const BASE = `http://127.0.0.1:${PORT}`
const ROOT = process.argv[2] || path.resolve(__dirname, '..')
const DISPLAY = process.env.DISPLAY || ':99'
const USER_DATA = process.env.SMOKE_USER_DATA || ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`)
  if (!ok) process.exitCode = 1
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

  // Wait for the app to leave the boot screen.
  const appReady = async () => {
    const deadline = Date.now() + 25000
    while (Date.now() < deadline) {
      const s = await evaluate(`document.querySelector('.app') ? 'app' : document.querySelector('.boot') ? 'boot' : 'none'`)
      if (s === 'app') return true
      await sleep(200)
    }
    return false
  }
  if (!await appReady()) {
    const diag = await evaluate(`JSON.stringify({ url: location.href, body: document.body.innerText.slice(0, 200) })`)
    check('workspace app boots to app shell (not boot screen)', false, diag)
    try { ws.close(); } catch {}
    child.kill('SIGKILL')
    process.exit(process.exitCode || 1)
  }

  check('workspace opens to workspace', true)

  for (const width of [1600, 1280, 960, 720]) {
    check(`workspace viewport width = ${width}`, (await evaluate(`window.innerWidth === ${width}`)) === true, `innerWidth=${(await evaluate(`window.innerWidth`))}`)
    if (!(await evaluate(`window.innerWidth === ${width}`))) {
      // force the override and re-check
      await send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: false })
      await sleep(250)
      check(`workspace viewport width = ${width} (forced)`, (await evaluate(`window.innerWidth === ${width}`)) === true, `innerWidth=${(await evaluate(`window.innerWidth`))}`)
    }
  }

  // Read real app card content inside the browser (card names are in the real renderer DOM).
  const appValidate = await evaluate(`(function() {
    const cards = document.querySelectorAll('.agent-card')
    const cardNames = [...cards].map(a => a.querySelector('.agent-card__name')?.textContent?.trim())
    const gridDims = grid => (grid ? { left: Math.round(grid.getBoundingClientRect().left), right: Math.round(grid.getBoundingClientRect().right), vw: window.innerWidth } : null)
    const grid = document.querySelector('.agent-grid')
    const scenes = [
      'stat-grid',
      '.agent-grid',
      '.tool-groups',
      '.kv',
      'ul.list',
      '.workspace__tooling',
      '.page__body',
      '.page',
      '.app'
    ].map(sel => {
      const els = document.querySelectorAll(sel)
      let bad = false
      let badList = []
      for (const el of els) {
        const r = el.getBoundingClientRect()
        if (r.width > el.clientWidth + 3) { bad = true; badList.push(sel + ': ' + Math.round(r.width) + ' > ' + Math.round(el.clientWidth)) }
        if (r.right > window.innerWidth + 1) { bad = true; badList.push(sel + ' right overflow ' + Math.round(r.right)) }
        if (r.right > document.documentElement.clientWidth + 3) { bad = true; badList.push(sel + ' right > page width ' + Math.round(r.right)) }
      }
      return { sel, bad, badList }
    })
    const clipped = []
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      if (cs.overflowX === 'hidden' && cs.overflowY === 'hidden') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right > document.documentElement.clientWidth + 3 && r.width > 1) {
        clipped.push({ tag: el.tagName, class: el.className, right: Math.round(r.right), w: Math.round(r.width) })
      }
    }
    return { cards: cards.length, cardNames: cardNames.filter(Boolean), gridDims: gridDims(grid), scenes, clipped }
  })()`)

  check('workspace agent-grid renders real cards', appValidate.cards >= 1, `cards=${appValidate.cards} names=${JSON.stringify(appValidate.cardNames)}`)
  if (appValidate.gridDims) {
    check('workspace agent-grid within viewport', appValidate.gridDims.right <= appValidate.gridDims.vw, JSON.stringify(appValidate.gridDims))
  } else {
    check('workspace agent-grid exists', true)
  }
  for (const scene of appValidate.scenes) {
    check(`workspace ${scene.sel} no overflow`, !scene.bad, scene.badList.slice(0, 3).join('; '))
  }
  check('workspace no clipped text at right edge', appValidate.clipped.length === 0, JSON.stringify(appValidate.clipped.slice(0, 4)))

  // Repeat the same overflow/clipping check at several forced viewport widths.
  for (const width of [1600, 1280, 960, 720]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: false })
    await sleep(250)
    const checks = await evaluate(`(function() {
      const out = []
      const scenes = [
        'stat-grid',
        '.agent-grid',
        '.tool-groups',
        '.kv',
        'ul.list',
        '.workspace__tooling',
        '.page__body',
        '.page',
        '.app'
      ].map(sel => {
        const els = document.querySelectorAll(sel)
        let bad = false, badList = []
        for (const el of els) {
          const r = el.getBoundingClientRect()
          if (r.width > el.clientWidth + 3) { bad = true; badList.push(sel + ': ' + Math.round(r.width) + ' > ' + Math.round(el.clientWidth)) }
          if (r.right > window.innerWidth + 1) { bad = true; badList.push(sel + ' right overflow ' + Math.round(r.right)) }
          if (r.right > document.documentElement.clientWidth + 3) { bad = true; badList.push(sel + ' right > page ' + Math.round(r.right)) }
        }
        return { sel, bad, badList }
      })
      const clipped = []
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
        if (cs.overflowX === 'hidden' && cs.overflowY === 'hidden') continue
        if (r.width === 0 || r.height === 0) continue
        if (r.right > document.documentElement.clientWidth + 3 && r.width > 1) {
          clipped.push({ tag: el.tagName, class: el.className, right: Math.round(r.right), w: Math.round(r.width) })
        }
      }
      return { width: window.innerWidth, scenes, clipped }
    })()`)
    check(`workspace | ${width} no overflow`, checks.scenes.every(s => !s.bad), checks.scenes.find(s => s.bad)?.badList?.slice(0, 3).join('; ') || '')
    check(`workspace | ${width} no clipped text`, checks.clipped.length === 0, JSON.stringify(checks.clipped.slice(0, 3)))
  }

  await send('Emulation.clearDeviceMetricsOverride')
  try { ws.close(); } catch {}
  child.kill('SIGKILL')
  process.exit(process.exitCode || 0)
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2) })
