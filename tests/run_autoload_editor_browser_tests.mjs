import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from '../frontend/node_modules/vite/dist/node/index.js'

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url))
const baseline = process.argv.includes('--baseline')
const previousEditor = baseline ? execFileSync('git', ['show', 'bfbe474:frontend/src/components/views/AutoloadView.jsx'], { encoding: 'utf8' }) : null
const chrome = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome')
const keptList = 'local/kept-a,!1000,local/kept-b'
let stored = { AUTOLOAD_ENABLED: true, AUTOLOAD_LIST: keptList }
let pending = [], writes = []
const html = '<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/autoloadEditor.browser.jsx"></script></body></html>'
const vite = await createServer({ root: frontend, configFile: join(frontend, 'vite.config.js'),
  server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'autoload-editor-fixture', enforce: 'pre',
    transform(source, id) {
      if (baseline && id.split('?')[0] === join(frontend, 'src/components/views/AutoloadView.jsx')) return previousEditor
    }, configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url === '/__editor_page') {
        res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml(req.url, html)); return
      }
      if (req.url === '/__editor_config') { pending.push(res); return }
      if (req.url === '/__editor_save' || req.url === '/set_config') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const update = JSON.parse(Buffer.concat(chunks).toString())
        writes.push(update); stored = { ...stored, ...update }; res.end('OK'); return
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
  async function evaluate(expression) {
    const response = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails)); return response.result?.value
  }
  const hasButton = text => evaluate(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${JSON.stringify(text)})`)
  const loading = () => evaluate(`document.querySelector('[role="status"]')?.textContent.includes('Loading autoload settings')`)
  async function reload() {
    await rpc('Page.reload', {}, sessionId); await eventually(() => pending.length === 1, 'config request did not start')
  }
  await eventually(() => pending.length === 1, 'initial config request did not start')
  if (baseline) {
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
  ws?.close()
  if (child) {
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await Promise.race([exited, wait(2000)])
    if (child.exitCode === null) { child.kill('SIGKILL'); await Promise.race([exited, wait(2000)]) }
  }
  await vite.close(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
