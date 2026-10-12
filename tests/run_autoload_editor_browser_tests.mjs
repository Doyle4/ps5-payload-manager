import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from '../frontend/node_modules/vite/dist/node/index.js'

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url))
const baseline = process.argv.includes('--baseline')
const lifecycleBaseline = process.argv.includes('--lifecycle-baseline')
const lifecycle = lifecycleBaseline || process.argv.includes('--lifecycle')
if (lifecycle) process.chdir(frontend) // Tailwind resolves its config from cwd.
const previousEditor = baseline || lifecycleBaseline ? execFileSync('git', ['show', `${baseline ? 'bfbe474' : '4fe3588'}:frontend/src/components/views/AutoloadView.jsx`], { encoding: 'utf8' }) : null
const chrome = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome')
const keptList = 'local/kept-a,!1000,local/kept-b'
let stored = { AUTOLOAD_ENABLED: true, AUTOLOAD_LIST: keptList }
let pending = [], writes = []
const pendingSaves = [], pendingProcesses = [], pendingStatuses = [], pendingAppConfigs = [], requests = []
let holdAppConfig = false, holdStatus = false
const fixtureItems = [
  { slot: 'local/kept-a', filename: 'a.elf', name: 'A', kind: 'local' },
  { slot: 'local/kept-b', filename: 'b.elf', name: 'B', kind: 'local' },
  { slot: 'local/next', filename: 'next.elf', name: 'Next', kind: 'local' },
]
const html = `<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/${lifecycle ? 'frontendLifecycle' : 'autoloadEditor'}.browser.jsx"></script></body></html>`
const vite = await createServer({ root: frontend, configFile: join(frontend, 'vite.config.js'),
  server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'autoload-editor-fixture', enforce: 'pre',
    transform(source, id) {
      if (previousEditor && id.split('?')[0] === join(frontend, 'src/components/views/AutoloadView.jsx')) return previousEditor
    }, configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      requests.push(req.url)
      if (req.url === '/__editor_page') {
        res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml(req.url, html)); return
      }
      if (req.url === '/__editor_config') { pending.push(res); return }
      if (req.url === '/__editor_save' || req.url === '/set_config') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const update = JSON.parse(Buffer.concat(chunks).toString())
        writes.push(update)
        if (lifecycle && (req.url === '/__editor_save' || (update.FAVORITES !== undefined && req.headers['x-pldmgr-request']))) {
          pendingSaves.push({ update, res }); return
        }
        stored = { ...stored, ...update }; res.end('OK'); return
      }
      if (lifecycle) {
        const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
        if (req.url === '/processes_list') { pendingProcesses.push(res); return }
        if (req.url === '/autoload_status') {
          if (holdStatus) pendingStatuses.push(res); else json({ remaining: -1, state: 'disabled' }); return
        }
        if (req.url === '/get_config') {
          if (holdAppConfig) pendingAppConfigs.push(res)
          else json({ ...stored, FAVORITES: stored.FAVORITES || '', FAVORITES_INITIALIZED: true })
          return
        }
        if (req.url === '/getip' || req.url === '/version') { res.end(req.url === '/getip' ? '127.0.0.1' : '0.5.2'); return }
        if (req.url === '/list_payloads') { json({ items: fixtureItems, payloads: fixtureItems.map(item => item.slot) }); return }
        if (req.url === '/history_list') { json({ history: [] }); return }
        if (req.url === '/repository_payloads') { json({ sources: [] }); return }
        if (req.url.startsWith('/process_kill')) { json({ ok: true }); return }
      }
      next()
    })
  }}] })
await vite.listen()
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function eventually(condition, label) {
  for (let i = 0; i < 200; i++) { if (await condition()) return; await wait(25) }
  throw new Error(label)
}
function releaseConfig(data = stored, status = 200) {
  pending = pending.filter(res => !res.destroyed)
  assert.equal(pending.length, 1)
  const res = pending.shift(); res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data))
}
const profile = await mkdtemp(join(tmpdir(), 'pldmgr-editor-browser-'))
let child, ws
try {
  child = spawn(chrome, ['--headless', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--password-store=basic',
    '--user-data-dir=' + profile, '--remote-debugging-port=0', 'about:blank'])
  let launchError; child.on('error', error => { launchError = error }); child.stdout.resume(); child.stderr.resume()
  let portInfo
  await eventually(async () => { if (launchError) throw launchError; try { portInfo = await readFile(join(profile, 'DevToolsActivePort'), 'utf8'); return true } catch { return false } }, 'Chrome did not start')
  const [port, path] = portInfo.trim().split('\n')
  ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let id = 0; const calls = new Map()
  ws.onmessage = event => { const reply = JSON.parse(event.data); const call = calls.get(reply.id); if (call) { calls.delete(reply.id); reply.error ? call.reject(reply.error) : call.resolve(reply.result) } }
  function rpc(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const call = ++id; calls.set(call, { resolve, reject }); ws.send(JSON.stringify({ id: call, method, params, ...(sessionId ? { sessionId } : {}) }))
      setTimeout(() => { if (calls.delete(call)) reject(new Error('Debugger timeout: ' + method)) }, 5000).unref()
    })
  }
  const url = `http://127.0.0.1:${vite.httpServer.address().port}/__editor_page`
  const { targetId } = await rpc('Target.createTarget', { url })
  const { sessionId } = await rpc('Target.attachToTarget', { targetId, flatten: true })
  if (lifecycle) await rpc('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)
  async function evaluate(expression) {
    const response = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails)); return response.result?.value
  }
  const hasButton = text => evaluate(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${JSON.stringify(text)})`)
  const loading = () => evaluate(`document.querySelector('[role="status"]')?.textContent.includes('Loading autoload settings')`)
  async function reload() {
    await rpc('Page.reload', {}, sessionId); await eventually(() => pending.length === 1, 'config request did not start')
  }
  await eventually(() => pending.filter(res => !res.destroyed).length === 1, 'initial config request did not start')
  if (lifecycle) {
    await wait(100) // Let StrictMode's aborted probe request leave the fixture.
    releaseConfig()
    try { await eventually(() => hasButton('Disable Autoload'), 'StrictMode editor failed to initialize') }
    catch (error) { throw new Error(error.message + ': ' + JSON.stringify(await evaluate(`({text:document.body.textContent,errors:window.__unhandledErrors})`))) }
    assert.equal(writes.length, 0, 'StrictMode initial cleanup saved defaults')
    const click = (title, index = 0) => evaluate(`Array.from(document.querySelectorAll('button[title=${JSON.stringify(title)}]')).filter(b => b.offsetParent !== null)[${index}].click()`)
    const clickText = text => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.offsetParent !== null && b.textContent.trim() === ${JSON.stringify(text)}).click()`)
    const releaseSave = (status = 200) => {
      assert.equal(pendingSaves.length, 1, 'only one normal save may be in flight')
      const { update, res } = pendingSaves.shift()
      if (status === 200) stored = { ...stored, ...update }
      res.statusCode = status; res.end(status === 200 ? 'OK' : 'failed')
      return update
    }
    if (lifecycleBaseline) {
      await evaluate('window.__rejectSave = true')
      await click('Move Down')
      await eventually(() => evaluate('window.__unhandledErrors.length > 0'), 'old rejected save did not reproduce unhandled rejection')
      assert.equal(await hasButton('Retry'), false)
      console.log('Baseline 4fe3588: actual editor save rejection escapes its handler and has no retry control')
    } else {
      // Same-turn handlers must compose against the current draft, not a render snapshot.
      await evaluate(`const buttons = title => Array.from(document.querySelectorAll('button')).filter(b => b.title === title && b.offsetParent !== null);
        buttons('Move Down')[0].click(); buttons('Move Down')[0].click(); buttons('Remove')[2].click();`)
      await eventually(() => pendingSaves.length === 1, 'reorder did not save')
      assert.equal(pendingSaves[0].update.AUTOLOAD_LIST, '!1000,local/kept-a,local/kept-b')
      releaseSave(); await eventually(() => pendingSaves.length === 1, 'queued remove did not drain')
      assert.equal(pendingSaves[0].update.AUTOLOAD_LIST, 'local/kept-a,!1000')
      releaseSave(500); await eventually(() => hasButton('Retry'), 'failed save lacked Retry')
      await clickText('Retry'); await eventually(() => pendingSaves.length === 1, 'retry did not save')
      releaseSave(); await eventually(async () => !(await hasButton('Retry')), 'retry error did not clear')

      // Add through the actual available-payload and delay-modal handlers.
      await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.offsetParent !== null && b.textContent.includes('Next')).click()`)
      await eventually(() => pendingSaves.length === 1, 'add payload did not save')
      assert.equal(pendingSaves[0].update.AUTOLOAD_LIST, 'local/kept-a,!1000,local/next'); releaseSave()
      await eventually(() => pendingSaves.length === 0, 'add save not released'); await wait(50)
      await clickText('Add Delay'); await clickText('3s')
      await eventually(() => pendingSaves.length === 1, 'delay did not save')
      assert.equal(pendingSaves[0].update.AUTOLOAD_LIST, 'local/kept-a,!1000,local/next,!3000'); releaseSave(); await wait(50)
      await evaluate('window.__rejectSave = true'); await click('Move Down')
      await eventually(() => hasButton('Retry'), 'thrown save did not become retryable')
      assert.equal(await evaluate('window.__unhandledErrors.length'), 0)
      await evaluate('window.__rejectSave = false'); await clickText('Retry')
      await eventually(() => pendingSaves.length === 1, 'throw retry did not save'); releaseSave(); await wait(50)

      // A pending earlier save cannot prevent a latest-state pagehide/unmount flush.
      await click('Remove', 3); await eventually(() => pendingSaves.length === 1, 'exit first save absent')
      await click('Remove', 2)
      const beforeExit = writes.length
      await evaluate(`window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('beforeunload'))`)
      await eventually(() => writes.length === beforeExit + 1, 'exit flush missing/duplicated')
      assert.equal(writes.at(-1).AUTOLOAD_LIST, '!1000,local/kept-a')
      await evaluate('window.editor.mount(false)'); await wait(50)
      assert.equal(writes.length, beforeExit + 1, 'unmount duplicated exit flush')
      releaseSave(); await eventually(() => pendingSaves.length === 1, 'unmounted queued edit did not drain')
      assert.equal(pendingSaves[0].update.AUTOLOAD_LIST, '!1000,local/kept-a'); releaseSave(); await wait(50)
      assert.equal(stored.AUTOLOAD_LIST, '!1000,local/kept-a')
      await evaluate(`window.editor.config(${JSON.stringify(stored)}); window.editor.mount(true)`)
      await eventually(() => hasButton('Disable Autoload'), 'remount lost editor')

      // Countdown phase transitions, zero delay and malformed progress must render finite SVG values.
      await evaluate(`window.editor.show('overlay'); window.editor.status({state:'countdown',remaining:0,delay:0,list:'a,b',total:2,done:0})`)
      await wait(50)
      const finiteSVG = () => evaluate(`Array.from(document.querySelectorAll('circle[stroke-dashoffset]')).every(c => Number.isFinite(Number(c.getAttribute('stroke-dashoffset'))) && Number(c.getAttribute('stroke-dashoffset')) >= 0 && Number(c.getAttribute('stroke-dashoffset')) <= 628)`)
      assert.equal(await finiteSVG(), true)
      await evaluate(`window.editor.status({state:'countdown',remaining:NaN,remaining_ms:Infinity,delay:NaN,total:NaN,done:Infinity,list:'a,b'})`)
      await wait(50); assert.equal(await finiteSVG(), true)
      await evaluate(`window.editor.status({state:'waiting',remaining:0,delay:5,total:2,done:0,list:'a,b'})`); await wait(30)
      await evaluate(`window.editor.status({state:'countdown',remaining:5,delay:5,total:2,done:0,list:'a,b'})`)
      await eventually(() => evaluate(`document.querySelector('.text-8xl')?.textContent === '5'`), 'waiting-to-countdown did not reset')
      await evaluate(`window.editor.status({state:'executing',remaining:0,delay:0,total:2,done:99,list:'a,b'})`)
      await wait(50); assert.equal(await finiteSVG(), true)
      assert.equal(await evaluate(`document.querySelector('.text-6xl')?.textContent`), '100%')

      // Reading old logs alone must not claim new activity; new logs must not drag the reader down.
      await evaluate(`window.editor.show('logs')`); await wait(100)
      await evaluate(`const scroller = document.querySelector('[class*="overflow-y-auto"]'); scroller.style.scrollBehavior='auto'; scroller.scrollTop=0; scroller.dispatchEvent(new Event('scroll'))`)
      await wait(50); assert.equal(await hasButton('New Activity Below'), false)
      await evaluate(`window.editor.logs(Array.from({length:101},(_,i)=>'line '+i))`)
      await eventually(() => hasButton('New Activity Below'), 'new log activity was not shown')
      assert.ok(await evaluate(`document.querySelector('[class*="overflow-y-auto"]').scrollTop < 100`), 'new logs dragged the reader to the bottom')
      await clickText('New Activity Below'); await eventually(async () => !(await hasButton('New Activity Below')), 'jump to bottom did not clear notice')

      // Real process component: StrictMode creates one initial request; leaving aborts it.
      await evaluate(`window.editor.show('processes')`)
      await eventually(() => pendingProcesses.filter(res => !res.destroyed).length === 1, 'process initial request absent/duplicated')
      const processWrites = requests.filter(url => url === '/processes_list').length
      pendingProcesses.shift().end(JSON.stringify({ processes: [{ pid: 12, name: 'safe.elf', memory: 1, is_daemon: true }] }))
      await eventually(() => evaluate(`document.body.textContent.includes('safe.elf')`), 'process list did not render')
      assert.equal(requests.filter(url => url === '/processes_list').length, processWrites)
      await click('Kill')
      await eventually(() => evaluate(`document.body.textContent.includes('No processes found')`), 'process kill did not update the list')
      await evaluate(`window.editor.mount(false)`); await wait(50)
      await wait(1100)
      assert.equal(requests.filter(url => url === '/processes_list').length, processWrites, 'post-kill timer survived unmount')
      await evaluate(`window.AbortController = undefined; window.editor.mount(true)`)
      await eventually(() => pendingProcesses.filter(res => !res.destroyed).length === 1, 'fallback process request absent')
      const oldRequest = pendingProcesses.filter(res => !res.destroyed)[0]
      await evaluate(`void window.__pollProcesses()`)
      await eventually(() => pendingProcesses.filter(res => !res.destroyed).length === 2, 'overlapping fallback poll did not start')
      const latest = pendingProcesses.filter(res => !res.destroyed)[1]
      latest.end(JSON.stringify({ processes: [{ pid: 98, name: 'latest.elf', memory: 1, is_daemon: true }] }))
      await eventually(() => evaluate(`document.body.textContent.includes('latest.elf')`), 'latest process response did not render')
      oldRequest.end(JSON.stringify({ processes: [{ pid: 99, name: 'old.elf', memory: 1, is_daemon: true }] }))
      await wait(50)
      assert.equal(await evaluate(`document.body.textContent.includes('old.elf')`), false, 'older response overwrote latest processes')
      await evaluate(`void window.__pollProcesses()`)
      await eventually(() => pendingProcesses.filter(res => !res.destroyed).length === 1, 'final pending poll did not start')
      await evaluate(`window.editor.mount(false)`)
      const stale = pendingProcesses.filter(res => !res.destroyed).shift()
      stale.end(JSON.stringify({ processes: [{ pid: 99, name: 'stale.elf', memory: 1, is_daemon: true }] }))
      await wait(50)
      assert.equal(await evaluate(`document.body.textContent.includes('stale.elf')`), false)

      // Full App under StrictMode: favorite saves serialize and stale config reads cannot replace edits.
      stored = { ...stored, FAVORITES: '' }; holdStatus = true
      await evaluate(`window.editor.show('app'); window.editor.mount(true)`)
      await eventually(() => evaluate(`Array.from(document.querySelectorAll('button')).some(b => b.title === 'Edit Favorites')`), 'App did not render')
      try { await eventually(() => evaluate(`document.body.textContent.toLowerCase().includes('next')`), 'App payloads did not load') }
      catch (error) { throw new Error(error.message + ': ' + JSON.stringify({ requests, page: await evaluate(`({text:document.body.textContent,errors:window.__unhandledErrors})`) })) }
      await click('Edit Favorites')
      const clickCard = name => evaluate(`Array.from(document.querySelectorAll('.glass-card > button')).find(b => b.textContent.toLowerCase().includes(${JSON.stringify(name.toLowerCase())})).click()`)
      await clickCard('Next'); await eventually(() => pendingSaves.length === 1, 'favorite save did not start')
      assert.equal(pendingSaves[0].update.FAVORITES, 'local/next')
      await clickCard('A'); await clickCard('B'); await wait(300)
      assert.equal(pendingSaves.length, 1, 'favorite writes ran concurrently')
      releaseSave(); await eventually(() => pendingSaves.length === 1, 'favorite queue did not drain')
      assert.equal(pendingSaves[0].update.FAVORITES, 'local/next,local/kept-a,local/kept-b')
      releaseSave(); await wait(50)
      assert.equal(await evaluate(`document.querySelector('button button') === null`), true, 'payload controls are nested buttons')
      await evaluate(`Array.from(document.querySelectorAll('.glass-card')).find(card => card.querySelector('button')?.textContent.toLowerCase().includes('next')).querySelector('button[aria-label="Move Right"]').click()`)
      await eventually(() => pendingSaves.length === 1, 'favorite move did not save')
      assert.equal(pendingSaves[0].update.FAVORITES, 'local/kept-a,local/next,local/kept-b', 'move also toggled the favorite')
      releaseSave(); await wait(50)
      holdAppConfig = true
      await clickText('Autoload')
      await eventually(() => pendingAppConfigs.length > 0, 'delayed App config fetch did not start')
      await clickText('Dashboard')
      await eventually(() => evaluate(`document.body.textContent.toLowerCase().includes('next')`), 'dashboard did not return')
      if (!(await evaluate(`Array.from(document.querySelectorAll('button[title="Edit Favorites"]')).some(b => b.className.includes('bg-yellow-400'))`))) await click('Edit Favorites')
      await clickCard('B')
      await eventually(() => pendingSaves.length === 1, 'favorite removal did not save')
      assert.equal(pendingSaves[0].update.FAVORITES, 'local/kept-a,local/next')
      releaseSave(); await wait(50)
      for (const res of pendingAppConfigs) res.end(JSON.stringify({ ...stored, FAVORITES: 'local/kept-a,local/next,local/kept-b', FAVORITES_INITIALIZED: true }))
      holdAppConfig = false; await wait(100)
      assert.equal(await evaluate(`localStorage.getItem('favoritePayloads')`), '["local/kept-a","local/next"]', 'stale config response replaced newer favorite edits')
      const statusCount = await evaluate(`window.__fetchRequests.filter(url => url === '/autoload_status').length`)
      await evaluate(`window.editor.mount(false)`)
      for (const res of pendingStatuses) if (!res.destroyed) res.end(JSON.stringify({ remaining: 5, state: 'countdown' }))
      await wait(700)
      assert.equal(await evaluate(`window.__fetchRequests.filter(url => url === '/autoload_status').length`), statusCount, 'unmounted status response scheduled a new poll')
      assert.equal(await evaluate('window.__unhandledErrors.length'), 0)
      console.log('Frontend lifecycle browser: StrictMode, rapid editor/favorite saves, failure/retry, exit/unmount, countdown validation/transitions, log scrolling and stale polling passed')
    }
  } else if (baseline) {
    await eventually(() => hasButton('Enable Autoload'), 'old editor did not reproduce premature Enable screen')
    releaseConfig(); await wait(100)
    assert.equal(await hasButton('Enable Autoload'), true, 'old editor unexpectedly loaded enabled settings')
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Enable Autoload').click()`)
    await eventually(() => writes.length > 0, 'old editor did not save')
    assert.deepEqual(writes.at(-1), { AUTOLOAD_ENABLED: true, AUTOLOAD_LIST: '' })
    console.log('Baseline bfbe474 reproduced: delayed settings ignored; Enable clears the persisted list')
  } else {
  await eventually(loading, 'editor did not show loading state')
  assert.equal(await hasButton('Enable Autoload'), false)
  assert.equal(writes.length, 0)
  releaseConfig(); await eventually(() => hasButton('Disable Autoload'), 'enabled config was not loaded')
  assert.equal(writes.length, 0, 'loading config must not save it')
  await reload(); await eventually(loading, 'reloaded editor did not wait for settings')
  assert.equal(await hasButton('Enable Autoload'), false)
  releaseConfig(); await eventually(() => hasButton('Disable Autoload'), 'reload lost enabled state')
  assert.equal(writes.length, 0, 'reload/unload must not write an untouched list')
  await evaluate('window.editor.mount(false)'); await wait(50)
  await evaluate('window.editor.mount(true)'); await eventually(() => hasButton('Disable Autoload'), 'section remount failed')
  assert.equal(writes.length, 0)

  // Navigating away before the request completes must not flush defaults.
  await reload(); await eventually(loading, 'early navigation did not start loading')
  await evaluate('window.editor.mount(false)'); await wait(50)
  assert.equal(writes.length, 0, 'uninitialized unmount saved defaults')
  releaseConfig(); await wait(50); await evaluate('window.editor.mount(true)')
  await eventually(() => hasButton('Disable Autoload'), 'return after delayed config failed')

  // An actually disabled configuration can retain a populated sequence.
  stored = { AUTOLOAD_ENABLED: false, AUTOLOAD_LIST: keptList }
  await reload(); await eventually(loading, 'disabled reload did not wait')
  releaseConfig(); await eventually(() => hasButton('Enable Autoload'), 'disabled config did not show enable')
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Enable Autoload').click()`)
  await eventually(() => writes.length === 1, 'enable did not save')
  assert.deepEqual(writes[0], { AUTOLOAD_ENABLED: true, AUTOLOAD_LIST: keptList })
  assert.equal(stored.AUTOLOAD_LIST, keptList)
  await eventually(() => hasButton('Disable Autoload'), 'enable did not update editor')
  const saved = writes.length
  await reload(); await eventually(loading, 'post-enable reload did not wait'); releaseConfig()
  await eventually(() => hasButton('Disable Autoload'), 'saved state did not survive reload')
  assert.equal(writes.length, saved)

  // Failed/incomplete fetches remain noneditable and cannot clear persistence.
  for (const [data, status] of [[{}, 500], [{ AUTOLOAD_ENABLED: true }, 200]]) {
    await reload(); await eventually(loading, 'failed/partial fetch initial loading missing')
    releaseConfig(data, status); await wait(100)
    assert.equal(await hasButton('Enable Autoload'), false); assert.equal(await loading(), true)
    await evaluate('window.editor.mount(false)'); await wait(50)
    assert.equal(writes.length, saved)
    assert.equal(stored.AUTOLOAD_LIST, keptList)
  }
  console.log('Autoload editor browser: delayed config, actual reload, section navigation, early exit, populated disabled enable, failed/partial loads all preserve settings/list')
  }
} finally {
  for (const res of pending) res.end('{}')
  for (const { res } of pendingSaves) res.end('failed')
  for (const res of [...pendingProcesses, ...pendingStatuses, ...pendingAppConfigs]) if (!res.destroyed) res.end('{}')
  ws?.close()
  if (child) {
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await Promise.race([exited, wait(2000)])
    if (child.exitCode === null) { child.kill('SIGKILL'); await Promise.race([exited, wait(2000)]) }
  }
  await vite.close(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
