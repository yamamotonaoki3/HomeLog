import { createServer, request as proxyRequest } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 専用の実SW検証用。製品のHTML/永続データは編集せず、一時buildだけを切り替える。
const frontend = fileURLToPath(new URL('../../../frontend/', import.meta.url))
const requireFrontend = createRequire(join(frontend, 'package.json'))
const { build } = await import(pathToFileURL(requireFrontend.resolve('vite')).href)
const { VitePWA } = await import(pathToFileURL(requireFrontend.resolve('vite-plugin-pwa')).href)
const fixtureRoot = await mkdtemp(join(tmpdir(), 'homelog-pwa-e2e-'))
const versions = Object.fromEntries(['legacy', 'a', 'b'].map(version => [version, join(fixtureRoot, version)]))
const port = Number(process.env.E2E_FRONTEND_PORT || 5173)
let version = 'legacy'
let server
let cleaning = false

async function removeBuilds() {
  // このプロセスが作った既知の一時ディレクトリだけを後始末する。
  const target = resolve(fixtureRoot)
  if (dirname(target) !== resolve(tmpdir()) || !target.split(sep).at(-1).startsWith('homelog-pwa-e2e-')) throw new Error('不正なPWA一時保存先')
  await rm(target, { recursive: true, force: true })
}
async function cleanup() {
  if (cleaning) return
  cleaning = true
  await new Promise(resolveClose => server ? server.close(resolveClose) : resolveClose())
  await removeBuilds()
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void cleanup().then(() => process.exit(0)))

try {
  const legacySource = join(fixtureRoot, 'legacy-source')
  await mkdir(legacySource)
  await writeFile(join(legacySource, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"><meta name="pwa-test-version" content="legacy"><title>[E2E_TEST] Legacy PWA</title><link rel="icon" href="data:,"></head><body><main><h1>[E2E_TEST] Legacy PWA</h1><form><label>旧画面の入力<input aria-label="旧画面の入力"></label></form></main></body></html>')
  await build({
    configFile: false, root: legacySource, logLevel: 'warn',
    plugins: [VitePWA({ registerType: 'autoUpdate', manifest: false, workbox: { navigateFallbackDenylist: [/^\/api(\/|\?|$)/, /^\/health(\?|$)/] } })],
    build: { outDir: versions.legacy, emptyOutDir: true },
  })
  for (const next of ['a', 'b']) {
    await build({
      configFile: join(frontend, 'vite.config.ts'), root: frontend, logLevel: 'warn',
      plugins: [{ name: 'pwa-e2e-version', transformIndexHtml: { order: 'pre', handler: html => html.replace('<head>', `<head><meta name="pwa-test-version" content="${next}">`) } }],
      build: { outDir: versions[next], emptyOutDir: true },
    })
  }
  const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/__pwa_fixture/version' && req.method === 'POST') {
        let body = ''
        for await (const chunk of req) { body += chunk; if (body.length > 200) throw new Error('fixture request too large') }
        const next = JSON.parse(body).version
        if (!Object.hasOwn(versions, next)) { res.writeHead(400).end(); return }
        version = next
        res.writeHead(204).end()
        return
      }
      if (url.pathname === '/__pwa_fixture/cleanup' && req.method === 'POST') { await removeBuilds(); res.writeHead(204).end(); return }
      if (url.pathname === '/__pwa_fixture/health') { res.writeHead(200).end('ready'); return }
      if (/^\/(api(?:\/|$)|health(?:$|\?))/.test(url.pathname)) {
        const upstream = proxyRequest({ hostname: '127.0.0.1', port: 8787, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:8787' } }, response => {
          res.writeHead(response.statusCode ?? 502, response.headers)
          response.pipe(res)
        })
        upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
        req.pipe(upstream)
        return
      }
      const root = resolve(versions[version])
      let path = resolve(root, '.' + decodeURIComponent(url.pathname))
      if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return }
      const info = await stat(path).catch(() => null)
      if (!info?.isFile()) {
        if (extname(url.pathname)) { res.writeHead(404).end(); return }
        path = join(root, 'index.html')
      }
      const body = await readFile(path)
      res.writeHead(200, { 'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      res.end(body)
    } catch { if (!res.headersSent) res.writeHead(500); res.end() }
  })
  server.listen(port, 'localhost', () => console.log(`PWA E2E fixture: http://localhost:${port}`))
  server.once('error', error => { console.error(error.message); void cleanup().then(() => process.exit(1)) })
} catch (error) {
  console.error(error.message)
  await cleanup()
  process.exit(1)
}
