import { spawn } from 'node:child_process'
import { findFreePort, isPortInUse, waitForPortsClosed } from './ports.mjs'

const DEFAULT_FRONTEND_PORT = 5173
// API側は複数のspecが直接参照しているため固定。playwright.config.ts の BACKEND_PORT と揃える。
const BACKEND_PORT = 8787

const run = (command, args) => new Promise((resolve) => {
  const child = spawn(command, args, { shell: true, stdio: 'inherit', windowsHide: true })

  child.on('error', (error) => {
    console.error(`コマンドの起動に失敗しました: ${command}`, error)
    resolve(1)
  })
  child.on('exit', (code) => resolve(code ?? 1))
})

// 画面側のポートを決める。既定の5173番が別の作業で使用中なら、そのサーバーを止めずに次の空きポートを使う。
const resolveFrontendPort = async () => {
  const specified = process.env.E2E_FRONTEND_PORT

  if (specified) {
    const port = Number(specified)

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`E2E_FRONTEND_PORT にはポート番号を指定してください: ${specified}`)
    }

    return port
  }

  const port = await findFreePort(DEFAULT_FRONTEND_PORT)

  if (port !== DEFAULT_FRONTEND_PORT) {
    console.log(`${DEFAULT_FRONTEND_PORT}番ポートは使用中のため、画面側は${port}番ポートで実行します（使用中のサーバーは止めません）。`)
  }

  return port
}

let frontendPort

try {
  frontendPort = await resolveFrontendPort()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

// Playwright の設定と各ワーカーが同じポートを使うよう、環境変数で渡す。
process.env.E2E_FRONTEND_PORT = String(frontendPort)

// 実行前から開いていたポートは今回のE2Eが開いたものではないため、終了後の確認対象から外す。
const candidatePorts = [BACKEND_PORT, frontendPort]
const inUseBeforeRun = await Promise.all(candidatePorts.map(isPortInUse))
const portsOpenedByRun = candidatePorts.filter((_, index) => !inUseBeforeRun[index])

const preCleanupExitCode = await run('node', ['scripts/cleanup.mjs'])

if (preCleanupExitCode !== 0) {
  process.exit(preCleanupExitCode)
}

const playwrightExitCode = await run('playwright', ['test', ...process.argv.slice(2)])

// テストのために起動したサーバーが止まり、ポートが閉じたことを確かめる。
const stillOpenPorts = await waitForPortsClosed(portsOpenedByRun)

if (stillOpenPorts.length > 0) {
  console.error(`E2E終了後もポートが開いたままです: ${stillOpenPorts.join(', ')}番。残っているサーバーを停止してください。`)
}

const postCleanupExitCode = await run('node', ['scripts/cleanup.mjs'])

if (playwrightExitCode !== 0) {
  process.exit(playwrightExitCode)
}

process.exit(postCleanupExitCode !== 0 ? postCleanupExitCode : stillOpenPorts.length > 0 ? 1 : 0)
