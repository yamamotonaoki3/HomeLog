import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../../index'

// 再認証の後、更新バッチの直前に別の操作でパスワードが変わった状態を、D1のbatchを包んで再現する。
function racingEnv(userId: number) {
  const DB = new Proxy(env.DB, {
    get(target, property) {
      if (property === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          await target.prepare("UPDATE users SET password_hash = 'testuser_changed' WHERE id = ?").bind(userId).run()
          return target.batch(statements)
        }
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { ...env, DB }
}

const PASSWORD = 'TestPass123!'
const call = (path: string, method: string, body: unknown) => app.request(`/api/auth/${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', },
  body: JSON.stringify(body),
}, env)

describe('並行したパスワード変更 (#291)', () => {
  it.each([
    ['password', { currentPassword: PASSWORD, newPassword: 'NewPass456' }],
    ['email', { currentPassword: PASSWORD, newEmail: 'testuser_race_new@example.com' }],
  ] as const)('%s: 再認証後にハッシュが変わっていたら409で上書きしない', async (path, body) => {
    const email = `testuser_race_${crypto.randomUUID()}@example.com`
    const registered = await (await call('register', 'POST', { email, password: PASSWORD, displayName: 'テスト太郎' })).json<{ id: number }>()
    const { accessToken } = await (await call('login', 'POST', { email, password: PASSWORD })).json<{ accessToken: string }>()
    const res = await app.request(`/api/auth/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    }, racingEnv(registered.id))
    expect(res.status).toBe(409)
    const row = await env.DB.prepare('SELECT email, password_hash FROM users WHERE id = ?').bind(registered.id).first<{ email: string; password_hash: string }>()
    expect(row).toEqual({ email, password_hash: 'testuser_changed' })
  })
})
