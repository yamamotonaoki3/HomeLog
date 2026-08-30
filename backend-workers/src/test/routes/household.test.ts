import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function createTestUser(email: string, displayName: string): Promise<number> {
  const result = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id',
  )
    .bind(email, 'dummy-hash', displayName)
    .first<{ id: number }>()
  if (!result) {
    throw new Error('test setup error: failed to create user')
  }
  return result.id
}

async function authHeaderFor(userId: number): Promise<Record<string, string>> {
  const token = await signAccessToken(userId, env.JWT_SECRET, 900)
  return { Authorization: `Bearer ${token}` }
}

beforeEach(async () => {
  await resetDb()
})

describe('POST /api/households', () => {
  it('201で世帯グループを作成でき、招待コードを含む', async () => {
    const userId = await createTestUser('taro@example.com', '太郎')

    const res = await app.request(
      '/api/households',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaderFor(userId)) },
        body: JSON.stringify({ name: '山田家' }),
      },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ id: number; name: string; inviteCode: string }>()
    expect(body.id).toBeGreaterThan(0)
    expect(body.name).toBe('山田家')
    expect(body.inviteCode).toHaveLength(16)
  })

  it('既に世帯グループに所属している場合は400を返す', async () => {
    const userId = await createTestUser('taro@example.com', '太郎')
    const headers = { 'Content-Type': 'application/json', ...(await authHeaderFor(userId)) }

    await app.request('/api/households', { method: 'POST', headers, body: JSON.stringify({ name: '山田家' }) }, env)
    const res = await app.request(
      '/api/households',
      { method: 'POST', headers, body: JSON.stringify({ name: '鈴木家' }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('Authorizationヘッダーが無い場合は401を返す', async () => {
    const res = await app.request(
      '/api/households',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '山田家' }),
      },
      env,
    )

    expect(res.status).toBe(401)
  })

  it('世帯グループ名が空の場合は400を返す', async () => {
    const userId = await createTestUser('taro@example.com', '太郎')

    const res = await app.request(
      '/api/households',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaderFor(userId)) },
        body: JSON.stringify({ name: '' }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })
})

async function createHouseholdFor(userId: number, name = '山田家') {
  const res = await app.request(
    '/api/households',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaderFor(userId)) },
      body: JSON.stringify({ name }),
    },
    env,
  )
  return res.json<{ id: number; name: string; inviteCode: string }>()
}

describe('POST /api/households/join', () => {
  it('有効な招待コードで参加できる', async () => {
    const ownerId = await createTestUser('taro@example.com', '太郎')
    const { inviteCode, id: householdId } = await createHouseholdFor(ownerId)
    const joinerId = await createTestUser('hanako@example.com', '花子')

    const res = await app.request(
      '/api/households/join',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaderFor(joinerId)) },
        body: JSON.stringify({ inviteCode }),
      },
      env,
    )

    expect(res.status).toBe(200)
    const body = await res.json<{ id: number; name: string }>()
    expect(body.id).toBe(householdId)
  })

  it('無効な招待コードでは404を返す', async () => {
    const userId = await createTestUser('taro@example.com', '太郎')

    const res = await app.request(
      '/api/households/join',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaderFor(userId)) },
        body: JSON.stringify({ inviteCode: 'INVALIDCODE0000X' }),
      },
      env,
    )

    expect(res.status).toBe(404)
  })

  it('既に世帯グループに所属している場合は400を返す', async () => {
    const ownerId = await createTestUser('taro@example.com', '太郎')
    const { inviteCode } = await createHouseholdFor(ownerId)
    const joinerId = await createTestUser('hanako@example.com', '花子')
    await createHouseholdFor(joinerId, '鈴木家')

    const res = await app.request(
      '/api/households/join',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaderFor(joinerId)) },
        body: JSON.stringify({ inviteCode }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })
})

describe('GET /api/households/me', () => {
  it('所属する世帯グループの情報とメンバー一覧を返す', async () => {
    const ownerId = await createTestUser('taro@example.com', '太郎')
    const { inviteCode } = await createHouseholdFor(ownerId)
    const joinerId = await createTestUser('hanako@example.com', '花子')
    await app.request(
      '/api/households/join',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaderFor(joinerId)) },
        body: JSON.stringify({ inviteCode }),
      },
      env,
    )

    const res = await app.request('/api/households/me', { headers: await authHeaderFor(ownerId) }, env)

    expect(res.status).toBe(200)
    const body = await res.json<{
      id: number
      name: string
      inviteCode: string
      members: { userId: number; displayName: string }[]
    }>()
    expect(body.name).toBe('山田家')
    expect(body.inviteCode).toBe(inviteCode)
    expect(body.members).toHaveLength(2)
    expect(body.members.map((m) => m.displayName).sort()).toEqual(['太郎', '花子'].sort())
  })

  it('世帯グループに未所属の場合は404を返す', async () => {
    const userId = await createTestUser('taro@example.com', '太郎')

    const res = await app.request('/api/households/me', { headers: await authHeaderFor(userId) }, env)

    expect(res.status).toBe(404)
  })
})

describe('POST /api/households/invite-code/regenerate', () => {
  it('新しい招待コードを発行し、旧コードでは参加できなくなる', async () => {
    const ownerId = await createTestUser('taro@example.com', '太郎')
    const { inviteCode: oldCode } = await createHouseholdFor(ownerId)

    const res = await app.request(
      '/api/households/invite-code/regenerate',
      { method: 'POST', headers: await authHeaderFor(ownerId) },
      env,
    )

    expect(res.status).toBe(200)
    const body = await res.json<{ inviteCode: string }>()
    expect(body.inviteCode).not.toBe(oldCode)

    const joinerId = await createTestUser('hanako@example.com', '花子')
    const joinRes = await app.request(
      '/api/households/join',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaderFor(joinerId)) },
        body: JSON.stringify({ inviteCode: oldCode }),
      },
      env,
    )
    expect(joinRes.status).toBe(404)
  })

  it('世帯グループに未所属の場合は404を返す', async () => {
    const userId = await createTestUser('taro@example.com', '太郎')

    const res = await app.request(
      '/api/households/invite-code/regenerate',
      { method: 'POST', headers: await authHeaderFor(userId) },
      env,
    )

    expect(res.status).toBe(404)
  })
})

describe('POST /api/households/leave', () => {
  it('204を返し、最後の1人が退出すると世帯グループごと削除される', async () => {
    const ownerId = await createTestUser('taro@example.com', '太郎')
    const { inviteCode } = await createHouseholdFor(ownerId)

    const leaveRes = await app.request(
      '/api/households/leave',
      { method: 'POST', headers: await authHeaderFor(ownerId) },
      env,
    )
    expect(leaveRes.status).toBe(204)

    const meRes = await app.request('/api/households/me', { headers: await authHeaderFor(ownerId) }, env)
    expect(meRes.status).toBe(404)

    // 世帯グループごと削除されているため、旧招待コードでの参加も失敗する
    const joinerId = await createTestUser('hanako@example.com', '花子')
    const joinRes = await app.request(
      '/api/households/join',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaderFor(joinerId)) },
        body: JSON.stringify({ inviteCode }),
      },
      env,
    )
    expect(joinRes.status).toBe(404)
  })

  it('他のメンバーが残っている場合は世帯グループは削除されない', async () => {
    const ownerId = await createTestUser('taro@example.com', '太郎')
    const { inviteCode } = await createHouseholdFor(ownerId)
    const joinerId = await createTestUser('hanako@example.com', '花子')
    await app.request(
      '/api/households/join',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaderFor(joinerId)) },
        body: JSON.stringify({ inviteCode }),
      },
      env,
    )

    const leaveRes = await app.request(
      '/api/households/leave',
      { method: 'POST', headers: await authHeaderFor(ownerId) },
      env,
    )
    expect(leaveRes.status).toBe(204)

    const meRes = await app.request('/api/households/me', { headers: await authHeaderFor(joinerId) }, env)
    expect(meRes.status).toBe(200)
  })

  it('世帯グループに未所属の場合は404を返す', async () => {
    const userId = await createTestUser('taro@example.com', '太郎')

    const res = await app.request(
      '/api/households/leave',
      { method: 'POST', headers: await authHeaderFor(userId) },
      env,
    )

    expect(res.status).toBe(404)
  })
})
