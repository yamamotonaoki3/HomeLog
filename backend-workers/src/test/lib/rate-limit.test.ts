import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { RATE_LIMITS, RATE_LIMIT_RETENTION_SECONDS, clientAddressKey, consumeRateLimits, purgeRateLimits } from '../../lib/rate-limit'

// 実在しないメールアドレスと、文書用に予約されたIPアドレス(TEST-NET-3)だけを使う。
const EMAIL = 'taro@example.com'
const ADDRESS = '203.0.113.7'
const NOW = Date.parse('2026-11-11T03:05:00Z')
const rule = { scope: 'test_scope', limit: 3, windowSeconds: 60 }

const rows = () => env.DB.prepare('SELECT scope, key_hash AS keyHash, window_start AS windowStart, count FROM rate_limit_counters ORDER BY scope, window_start')
  .all<{ scope: string; keyHash: string; windowStart: number; count: number }>().then((result) => result.results)

describe('consumeRateLimits', () => {
  it('上限までは許可し、超えた要求は拒否する(境界値)', async () => {
    for (let i = 0; i < rule.limit; i += 1) expect(await consumeRateLimits(env.DB, [{ rule, key: EMAIL }], NOW)).toBe(true)
    expect(await consumeRateLimits(env.DB, [{ rule, key: EMAIL }], NOW)).toBe(false)
    expect((await rows())[0].count).toBe(rule.limit)
  })

  it('別のキー・別の種類は、互いの回数に影響しない', async () => {
    for (let i = 0; i < rule.limit; i += 1) await consumeRateLimits(env.DB, [{ rule, key: EMAIL }], NOW)
    expect(await consumeRateLimits(env.DB, [{ rule, key: 'hanako@example.com' }], NOW)).toBe(true)
    expect(await consumeRateLimits(env.DB, [{ rule: { ...rule, scope: 'other_scope' }, key: EMAIL }], NOW)).toBe(true)
  })

  it('次の窓になると、また上限まで許可する', async () => {
    for (let i = 0; i < rule.limit; i += 1) await consumeRateLimits(env.DB, [{ rule, key: EMAIL }], NOW)
    expect(await consumeRateLimits(env.DB, [{ rule, key: EMAIL }], NOW + 59_000)).toBe(false)
    expect(await consumeRateLimits(env.DB, [{ rule, key: EMAIL }], NOW + 60_000)).toBe(true)
  })

  it('複数の対象のうち1つでも上限なら拒否する', async () => {
    const byAddress = { scope: 'test_address', limit: 1, windowSeconds: 60 }
    expect(await consumeRateLimits(env.DB, [{ rule, key: EMAIL }, { rule: byAddress, key: ADDRESS }], NOW)).toBe(true)
    expect(await consumeRateLimits(env.DB, [{ rule, key: 'hanako@example.com' }, { rule: byAddress, key: ADDRESS }], NOW)).toBe(false)
  })

  it('キーが無い対象(接続元を取得できない場合)は数えず、ほかの対象だけで判定する', async () => {
    for (let i = 0; i < 5; i += 1) expect(await consumeRateLimits(env.DB, [{ rule, key: null }], NOW)).toBe(true)
    expect(await rows()).toEqual([])
    expect(await consumeRateLimits(env.DB, [{ rule, key: EMAIL }, { rule: { ...rule, scope: 'test_address' }, key: null }], NOW)).toBe(true)
    expect((await rows()).map((row) => row.scope)).toEqual(['test_scope'])
  })

  it('同時に要求しても、上限を超えて許可しない', async () => {
    const results = await Promise.all(Array.from({ length: rule.limit + 5 }, () => consumeRateLimits(env.DB, [{ rule, key: EMAIL }], NOW)))
    expect(results.filter(Boolean)).toHaveLength(rule.limit)
  })

  it('メールアドレスや接続元の実値は保存しない(ハッシュだけを保存する)', async () => {
    await consumeRateLimits(env.DB, [{ rule, key: EMAIL }, { rule: { ...rule, scope: 'test_address' }, key: ADDRESS }], NOW)
    const saved = await rows()
    expect(saved).toHaveLength(2)
    for (const row of saved) {
      expect(row.keyHash).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(row)).not.toContain(EMAIL)
      expect(JSON.stringify(row)).not.toContain(ADDRESS)
    }
    // 同じ値でも、種類が違えば別のハッシュになる。
    expect(saved[0].keyHash).not.toBe(saved[1].keyHash)
  })
})

describe('purgeRateLimits', () => {
  it('保持期間を過ぎた行だけを削除する', async () => {
    const old = NOW - (RATE_LIMIT_RETENTION_SECONDS + 120) * 1000
    await consumeRateLimits(env.DB, [{ rule, key: EMAIL }], old)
    await consumeRateLimits(env.DB, [{ rule, key: EMAIL }], NOW)
    expect(await purgeRateLimits(env.DB, NOW)).toBe(1)
    expect((await rows()).map((row) => row.windowStart)).toEqual([Math.floor(NOW / 1000 / 60) * 60])
  })

  it('保持期間は、最も長い窓(1日)より長い', () => {
    const longest = Math.max(...Object.values(RATE_LIMITS).map((limit) => limit.windowSeconds))
    expect(RATE_LIMIT_RETENTION_SECONDS).toBeGreaterThan(longest)
  })
})

describe('clientAddressKey', () => {
  it('接続元を取得できない場合と、ループバックの場合はnullを返す', () => {
    expect(clientAddressKey(undefined)).toBeNull()
    expect(clientAddressKey('')).toBeNull()
    expect(clientAddressKey('127.0.0.1')).toBeNull()
    expect(clientAddressKey('127.10.20.30')).toBeNull()
    expect(clientAddressKey('::1')).toBeNull()
    expect(clientAddressKey('::ffff:127.0.0.1')).toBeNull()
  })
  it('それ以外は接続元の値を返す', () => {
    expect(clientAddressKey(ADDRESS)).toBe(ADDRESS)
    expect(clientAddressKey(' 2001:db8::1 ')).toBe('2001:db8::1')
    expect(clientAddressKey('12.7.0.1')).toBe('12.7.0.1')
  })
})
