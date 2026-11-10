import { connect } from 'node:net'

// 開発サーバーは環境によってIPv4・IPv6のどちらか一方だけで待ち受けることがあるため、両方を確かめる。
const LOOPBACK_HOSTS = ['127.0.0.1', '::1']
const CONNECT_TIMEOUT_MS = 500

const canConnect = (port, host) => new Promise((resolve) => {
  const socket = connect({ port, host })
  const finish = (connected) => {
    socket.destroy()
    resolve(connected)
  }

  socket.setTimeout(CONNECT_TIMEOUT_MS, () => finish(false))
  socket.once('connect', () => finish(true))
  socket.once('error', () => finish(false))
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** ローカルのどこかでそのポートが待ち受けられていれば true を返す。 */
export const isPortInUse = async (port) => {
  const results = await Promise.all(LOOPBACK_HOSTS.map((host) => canConnect(port, host)))
  return results.includes(true)
}

/** preferred から順に調べ、最初に見つかった空きポートを返す。使用中のサーバーには手を触れない。 */
export const findFreePort = async (preferred, { attempts = 20 } = {}) => {
  for (let port = preferred; port < preferred + attempts; port += 1) {
    if (!(await isPortInUse(port))) {
      return port
    }
  }

  throw new Error(`${preferred}〜${preferred + attempts - 1}番に空いているポートがありません。`)
}

/** ports がすべて閉じるまで待ち、制限時間を過ぎても開いているポートを返す（すべて閉じれば空配列）。 */
export const waitForPortsClosed = async (ports, { timeoutMs = 10_000, intervalMs = 250 } = {}) => {
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const states = await Promise.all(ports.map(isPortInUse))
    const open = ports.filter((_, index) => states[index])

    if (open.length === 0 || Date.now() >= deadline) {
      return open
    }

    await sleep(intervalMs)
  }
}
