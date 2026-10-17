import { env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import app from '../../index'

const PASSWORD = 'TestPass123!'

// 取り消しの本人確認の後、更新の直前に別の操作でパスワードが変わった状態を、D1のprepareを包んで再現する。
function racingEnv(userId: number) {
  const DB = new Proxy(env.DB, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql: string) => {
          const statement = target.prepare(sql)
          if (!sql.startsWith('UPDATE users SET deletion_requested_at = NULL')) return statement
          return new Proxy(statement, {
            get(stmt, key) {
              if (key === 'bind') {
                return (...values: unknown[]) => {
                  const bound = stmt.bind(...values)
                  return new Proxy(bound, {
                    get(b, k) {
                      if (k === 'run') {
                        return async () => {
                          await target.prepare("UPDATE users SET password_hash = 'testuser_changed' WHERE id = ?").bind(userId).run()
                          return b.run()
                        }
                      }
                      const v = Reflect.get(b, k)
                      return typeof v === 'function' ? v.bind(b) : v
                    },
                  })
                }
              }
              const v = Reflect.get(stmt, key)
              return typeof v === 'function' ? v.bind(stmt) : v
            },
          })
        }
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { ...env, DB }
}

it('取り消しの途中でパスワードが変わっていたら取り消さず401にする (#297)', async () => {
  const email = `testuser_del_cancel_race_${crypto.randomUUID().slice(0, 8)}@example.com`
  const post = (path: string, body: unknown, token?: string, bindings: object = env) => app.request(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }, bindings)
  const { id } = await (await post('auth/register', { email, password: PASSWORD, displayName: 'テスト' })).json<{ id: number }>()
  const { accessToken } = await (await post('auth/login', { email, password: PASSWORD })).json<{ accessToken: string }>()
  expect((await post('auth/account/deletion', { currentPassword: PASSWORD }, accessToken)).status).toBe(200)

  const res = await post('auth/account/deletion/cancel', { email, password: PASSWORD }, undefined, racingEnv(id))
  expect(res.status).toBe(401)
  const row = await env.DB.prepare('SELECT deletion_requested_at FROM users WHERE id = ?').bind(id).first<{ deletion_requested_at: string | null }>()
  expect(row!.deletion_requested_at).not.toBeNull()
})
