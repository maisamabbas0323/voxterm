/**
 * Runtime UI verification for VoxTerm (headless-friendly).
 *
 * Launches the built app (real main process + real IPC), attaches over the
 * Chrome DevTools Protocol and asserts the things that can only be checked at
 * runtime: the sidebar-collapse icon fix, the logo, absence of external-session
 * UI, the terminal-font dropdown, and horizontal-overflow freedom at both wide
 * and narrow viewport widths.
 *
 * Usage (Linux, no Node deps beyond Node 22's global fetch/WebSocket):
 *
 *   npm run build
 *   xvfb-run -a node scripts/verify-ui.cjs
 *
 * Exits non-zero if any check fails. Set CDP_PORT to avoid clashing with an
 * existing debugging session; set SMOKE_USER_DATA to test a fresh profile.
 */
const { spawn } = require('node:child_process')
const path = require('node:path')

const PORT = Number(process.env.CDP_PORT || 9222)
const BASE = `http://127.0.0.1:${PORT}`
const ROOT = process.argv[2] || path.resolve(__dirname, '..')
const DISPLAY = process.env.DISPLAY || process.env.SMOKE_DISPLAY || ':99'
const USER_DATA = process.env.SMOKE_USER_DATA || ''

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail })
}

async function waitForPage(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('DevTools target never appeared')
}

async function main() {
  const child = spawn(
    `${ROOT}/node_modules/electron/dist/electron`,
    ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox', ...(USER_DATA ? [`--user-data-dir=${USER_DATA}`] : [])],
    {
      cwd: ROOT,
      env: { ...process.env, DISPLAY, VOXTERM_DISABLE_CHROMIUM_SANDBOX: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d.toString()))
  child.stdout.on('data', (d) => (stderr += d.toString()))

  const page = await waitForPage()

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  let msgId = 0
  const pending = new Map()
  const consoleErrors = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(
        msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'exception'
      )
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++msgId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.exception?.description || 'eval failed')
    }
    return res.result?.result?.value
  }

  await send('Runtime.enable')

  // Wait for the app to leave the boot screen.
  const deadline = Date.now() + 25000
  let booted = false
  let lastStatus = 'none'
  while (Date.now() < deadline) {
    lastStatus = await evaluate(
      `document.querySelector('.app') ? 'ready' : document.querySelector('.boot') ? 'boot' : 'none'`
    )
    if (lastStatus === 'ready') {
      booted = true
      break
    }
    await sleep(300)
  }
  if (booted) {
    check('app boots past the loading screen', true)
  } else {
    const diag = await evaluate(
      `JSON.stringify({ url: location.href, body: document.body.innerHTML.slice(0, 300), root: document.getElementById('root') ? document.getElementById('root').innerHTML.slice(0,300) : null })`
    )
    check('app boots to the workspace', false, `status=${lastStatus} ${diag}`)
  }

  const nav = (label) =>
    `(() => { const item = [...document.querySelectorAll('.nav-item')].find(b => (b.getAttribute('aria-label')||'').toLowerCase() === '${label}'); if(!item) return false; item.click(); return true })()`

  if (booted) {
    // --- Sidebar collapse fix -------------------------------------------------
    const sidebar = await evaluate(`(() => {
      const sb = document.querySelector('.sidebar');
      const r = sb.getBoundingClientRect();
      const icons = [...document.querySelectorAll('.nav-item')].map(el => {
        const svg = el.querySelector('.nav-item__icon svg');
        const ir = el.getBoundingClientRect();
        const sr = svg.getBoundingClientRect();
        return {
          w: Math.round(sr.width),
          insideRail: sr.left >= r.left - 0.5 && sr.right <= r.right + 0.5,
          centered: Math.abs((sr.left + sr.right) / 2 - (ir.left + ir.right) / 2) < 2,
          visible: sr.width > 0 && sr.height > 0
        };
      });
      return { compact: !sb.classList.contains('sidebar--expanded'), width: Math.round(r.width), icons };
    })()`)
    check(
      'sidebar is compact by default',
      sidebar.compact === true,
      `width=${sidebar.width}`
    )
    check(
      'every nav icon stays visible inside the collapsed rail',
      sidebar.icons.length === 5 && sidebar.icons.every((i) => i.visible && i.insideRail),
      JSON.stringify(sidebar.icons)
    )
    check(
      'collapsed nav icons are centred on their button',
      sidebar.icons.every((i) => i.centered),
      JSON.stringify(sidebar.icons.map((i) => i.centered))
    )
    check(
      'collapsed sidebar has no leftover label width',
      sidebar.width <= 64,
      `width=${sidebar.width}`
    )

    // --- Logo -----------------------------------------------------------------
    const logoCount = await evaluate(
      `document.querySelectorAll('svg[aria-label="VoxTerm"]').length`
    )
    check('branded logo mark is rendered in the title bar', logoCount >= 1, `count=${logoCount}`)

    // --- No external-session UI remains ---------------------------------------
    const pages = ['workspace', 'terminals', 'voice', 'activity', 'settings']
    for (const key of pages) {
      const found = await evaluate(nav(key))
      check(`nav "${key}" is clickable`, found)
      await sleep(250)
    }

    const externalHits = await evaluate(`(() => {
      const text = document.body.innerText;
      const hits = [];
      for (const needle of ['external session', 'external sessions', 'attach to session', 'detach', 'discovered session']) {
        if (text.toLowerCase().includes(needle.toLowerCase())) hits.push(needle);
      }
      return hits;
    })()`)
    check('no external-session wording anywhere in the UI', externalHits.length === 0, JSON.stringify(externalHits))

    // --- Terminal font dropdown ----------------------------------------------
    await evaluate(nav('settings'))
    await sleep(250)
    const font = await evaluate(`(() => {
      const selects = [...document.querySelectorAll('select')];
      const fontSelect = selects.find(s => [...s.options].some(o => o.value.includes('JetBrains Mono')));
      if (!fontSelect) return { found: false, selects: selects.length };
      return {
        found: true,
        options: fontSelect.options.length,
        selectedIndex: fontSelect.selectedIndex,
        value: fontSelect.options[fontSelect.selectedIndex]?.text,
        hasPreview: Boolean(document.querySelector('.font-picker__preview')),
        labels: [...fontSelect.options].map(o => o.text).slice(0, 4)
      };
    })()`)
    check('terminal font family is a dropdown', font.found, JSON.stringify(font))
    check('font dropdown has a curated list with a preview', (font.options ?? 0) >= 10 && font.hasPreview, JSON.stringify(font))
    check(
      'stored font value resolves to a listed family (no "Custom stack" for a fresh install)',
      (font.selectedIndex ?? -1) >= 0,
      `selectedIndex=${font.selectedIndex} selected="${font.value}"`
    )

    const aiLabels = await evaluate(`(() => {
      const text = document.body.innerText;
      return { ai: /\\bAI\\b/.test(text), googleOk: text.includes('Google API key') };
    })()`)
    check('no "AI" label tags on the appearance section', aiLabels.ai === false)

    const sections = await evaluate(
      `[...document.querySelectorAll('.settings__link')].map(b => b.textContent)`
    )
    check(
      'settings has no "External sessions" section',
      !sections.some((s) => /external/i.test(s)),
      JSON.stringify(sections)
    )

    // The Google credential lives under System & credentials; open that section.
    await evaluate(`(() => {
      const link = [...document.querySelectorAll('.settings__link')].find(b => /credentials/i.test(b.textContent));
      if (link) link.click();
      return Boolean(link);
    })()`)
    await sleep(250)
    const systemSection = await evaluate(`(() => {
      const text = document.body.innerText;
      return { googleOk: text.includes('Google API key'), ai: /\\bAI\\b/.test(text) };
    })()`)
    check('Google credential is labelled "Google API key"', systemSection.googleOk === true)
    check('no "AI" label tags on the credentials section', systemSection.ai === false)

    // --- Overflow at wide viewport -------------------------------------------
    const wide = []
    for (const key of pages) {
      await evaluate(nav(key))
      await sleep(200)
      const over = await evaluate(
        `Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)`
      )
      wide.push(`${key}:${over}`)
    }
    check('no horizontal overflow at desktop width', wide.every((v) => Number(v.split(':')[1]) <= 1), wide.join(' '))

    // --- Overflow + responsive rules at a narrow viewport ---------------------
    await send('Emulation.setDeviceMetricsOverride', {
      width: 560,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false
    })
    await sleep(300)
    const narrow = []
    for (const key of pages) {
      await evaluate(nav(key))
      await sleep(200)
      const over = await evaluate(
        `Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)`
      )
      narrow.push(`${key}:${over}`)
    }
    check(
      'no horizontal overflow at 560px width',
      narrow.every((v) => Number(v.split(':')[1]) <= 1),
      narrow.join(' ')
    )

    await evaluate(nav('workspace'))
    await sleep(250)
    const tooling = await evaluate(`(() => {
      const el = document.querySelector('.workspace__tooling');
      if (!el) return { present: false };
      return { present: true, display: getComputedStyle(el).display, visible: el.offsetParent !== null };
    })()`)
    check(
      'detected-tooling panel is hidden on narrow widths',
      tooling.present !== false && (tooling.display === 'none' || tooling.visible === false),
      JSON.stringify(tooling)
    )
    await send('Emulation.clearDeviceMetricsOverride')
    await sleep(200)

    const restored = await evaluate(`(() => {
      const el = document.querySelector('.workspace__tooling');
      return el ? getComputedStyle(el).display : 'missing';
    })()`)
    check('detected-tooling panel returns at desktop width', restored !== 'none', `display=${restored}`)

    // --- Terminal surface -----------------------------------------------------
    await evaluate(nav('terminals'))
    await sleep(700)
    const terminals = await evaluate(`(() => ({
      hasContainer: Boolean(document.querySelector('.terminals')),
      tabs: document.querySelectorAll('.tab').length,
      hasXterm: Boolean(document.querySelector('.xterm')),
      toolbar: Boolean(document.querySelector('.terminal-toolbar')),
      empty: Boolean(document.querySelector('.empty'))
    }))()`)
    check(
      'terminals page mounts a real terminal surface',
      terminals.hasContainer && (terminals.hasXterm || terminals.empty),
      JSON.stringify(terminals)
    )
  }

  check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '))

  // --- report ---------------------------------------------------------------
  const failed = results.filter((r) => !r.ok)
  for (const r of results) {
    process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}\n`)
  }
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`)
  if (stderr.trim()) process.stdout.write(`\n--- app output ---\n${stderr.trim().split('\n').slice(-15).join('\n')}\n`)

  try {
    ws.close()
  } catch {
    /* ignore */
  }
  child.kill('SIGKILL')
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error) => {
  process.stdout.write(`SMOKE HARNESS ERROR: ${error && error.stack ? error.stack : error}\n`)
  process.exit(2)
})
