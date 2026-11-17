import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { findFreePort, isPortInUse, waitForPortsClosed } from './ports.mjs'

// OSに空きポートを割り当ててもらい、テストごとに実在のサーバーを立てて判定を確かめる。
const listen = (host, port = 0) => new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(port, host, () => resolve(server))
})
const close = (server) => new Promise((resolve) => server.close(resolve))
const portOf = (server) => server.address().port

const releasedPort = async () => {
  const server = await listen('127.0.0.1')
  const port = portOf(server)
  await close(server)
  return port
}

test('誰も使っていないポートは未使用と判定する', async () => {
  assert.equal(await isPortInUse(await releasedPort()), false)
})

test('IPv4(127.0.0.1)で待ち受け中のポートは使用中と判定する', async () => {
  const server = await listen('127.0.0.1')
  try {
    assert.equal(await isPortInUse(portOf(server)), true)
  } finally {
    await close(server)
  }
})

test('IPv6(::1)だけで待ち受け中のポートも使用中と判定する', async (t) => {
  let server
  try {
    server = await listen('::1')
  } catch {
    t.skip('この環境ではIPv6のループバックを利用できない')
    return
  }
  try {
    assert.equal(await isPortInUse(portOf(server)), true)
  } finally {
    await close(server)
  }
})

test('既定のポートが空いていれば、そのポートを返す', async () => {
  const port = await releasedPort()
  assert.equal(await findFreePort(port), port)
})

test('既定のポートが使用中なら、それより後ろの空いているポートを返す', async () => {
  const server = await listen('127.0.0.1')
  try {
    const occupied = portOf(server)
    const found = await findFreePort(occupied, { attempts: 20 })
    assert.ok(found > occupied && found < occupied + 20, `範囲外のポートを返した: ${found}`)
    assert.equal(await isPortInUse(found), false)
  } finally {
    await close(server)
  }
})

test('探す範囲のポートがすべて使用中なら、範囲を示して失敗する', async () => {
  const server = await listen('127.0.0.1')
  try {
    const occupied = portOf(server)
    await assert.rejects(findFreePort(occupied, { attempts: 1 }), new RegExp(`${occupied}`))
  } finally {
    await close(server)
  }
})

test('待っている間に閉じたポートは、残りとして報告しない', async () => {
  const server = await listen('127.0.0.1')
  const port = portOf(server)
  setTimeout(() => server.close(), 150)
  assert.deepEqual(await waitForPortsClosed([port], { timeoutMs: 3000, intervalMs: 50 }), [])
})

test('制限時間を過ぎても開いているポートだけを報告する', async () => {
  const server = await listen('127.0.0.1')
  try {
    const open = portOf(server)
    const closed = await releasedPort()
    assert.deepEqual(await waitForPortsClosed([open, closed], { timeoutMs: 300, intervalMs: 50 }), [open])
  } finally {
    await close(server)
  }
})
