import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getJstToday } from '../../lib/date'
import { signAccessToken } from '../../lib/jwt'
import app from '../../index'

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM expenses'),
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM kakeibo_categories'),
    env.DB.prepare('DELETE FROM household_members'),
    env.DB.prepare('DELETE FROM households'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function createUserWithHousehold(email: string): Promise<{ userId: number; headers: Record<string, string> }> {
  const user = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id',
  )
    .bind(email, 'dummy-hash', 'テスト太郎')
    .first<{ id: number }>()
  if (!user) throw new Error('test setup error')
  const household = await env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?) RETURNING id')
    .bind('テスト世帯', `CODE${user.id}00000000000`.slice(0, 16))
    .first<{ id: number }>()
  if (!household) throw new Error('test setup error')
  await env.DB.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)')
    .bind(household.id, user.id)
    .run()
  const token = await signAccessToken(user.id, env.JWT_SECRET, 900)
  return { userId: user.id, headers: { Authorization: `Bearer ${token}` } }
}

async function createUserWithoutHousehold(email: string): Promise<{ userId: number; headers: Record<string, string> }> {
  const user = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id',
  )
    .bind(email, 'dummy-hash', 'テスト花子')
    .first<{ id: number }>()
  if (!user) throw new Error('test setup error')
  const token = await signAccessToken(user.id, env.JWT_SECRET, 900)
  return { userId: user.id, headers: { Authorization: `Bearer ${token}` } }
}

async function joinHousehold(userId: number, headers: Record<string, string>, ownerHeaders: Record<string, string>): Promise<Record<string, string>> {
  const meRes = await app.request('/api/households/me', { headers: ownerHeaders }, env)
  const me = await meRes.json<{ inviteCode: string }>()
  const joinRes = await app.request(
    '/api/households/join',
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ inviteCode: me.inviteCode }) },
    env,
  )
  if (joinRes.status !== 200) throw new Error(`test setup error: join failed with status ${joinRes.status}`)
  return headers
}

beforeEach(async () => {
  await resetDb()
})

describe('POST /api/events', () => {
  it('201で世帯共有のイベントを登録できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '旅行', eventDate: '2026-09-20', personal: false }),
      },
      env,
    )

    expect(res.status).toBe(201)
    const body = await res.json<{ name: string; personal: boolean; editable: boolean; isAllDay: boolean; recurrenceType: string; showOnDashboard: boolean }>()
    expect(body.name).toBe('旅行')
    expect(body.personal).toBe(false)
    expect(body.editable).toBe(true)
    expect(body.isAllDay).toBe(true)
    expect(body.recurrenceType).toBe('none')
    expect(body.showOnDashboard).toBe(true)
  })

  it('終日OFFで開始時刻が無い場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '学習', eventDate: '2026-09-20', personal: false, isAllDay: false }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('終了時刻が開始時刻より前の場合は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '学習', eventDate: '2026-09-20', personal: false, isAllDay: false, startTime: '20:00', endTime: '19:00' }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('終了時刻のみ指定(開始時刻なし)は400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '学習', eventDate: '2026-09-20', personal: false, isAllDay: false, endTime: '21:00' }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('不正なrecurrenceTypeは400を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')

    const res = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: '学習', eventDate: '2026-09-20', personal: false, recurrenceType: 'hourly' }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })
})

describe('GET /api/events', () => {
  it('世帯共有イベントは他メンバーにも見えるが、個人イベントは見えない', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const hanako = await createUserWithoutHousehold('hanako@example.com')
    const memberHeaders = await joinHousehold(hanako.userId, hanako.headers, owner.headers)
    await app.request(
      '/api/events',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ name: '旅行', eventDate: '2026-09-20', personal: false }) },
      env,
    )
    await app.request(
      '/api/events',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ name: '推し活', eventDate: '2026-09-21', personal: true }) },
      env,
    )

    const memberRes = await app.request('/api/events', { headers: memberHeaders }, env)
    const memberList = await memberRes.json<{ name: string; editable: boolean }[]>()
    expect(memberList.map((e) => e.name)).toEqual(['旅行'])
    expect(memberList[0].editable).toBe(false)

    const ownerRes = await app.request('/api/events', { headers: owner.headers }, env)
    const ownerList = await ownerRes.json<{ name: string }[]>()
    expect(ownerList.map((e) => e.name).sort()).toEqual(['推し活', '旅行'].sort())
  })
})

describe('PATCH/DELETE /api/events/:id', () => {
  it('登録者本人以外(世帯共有でも)は編集・削除できず404を返す', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const hanako = await createUserWithoutHousehold('hanako@example.com')
    const memberHeaders = await joinHousehold(hanako.userId, hanako.headers, owner.headers)
    const createRes = await app.request(
      '/api/events',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ name: '旅行', eventDate: '2026-09-20', personal: false }) },
      env,
    )
    const event = await createRes.json<{ id: number }>()

    const patchRes = await app.request(
      `/api/events/${event.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...memberHeaders }, body: JSON.stringify({ name: '改変', eventDate: '2026-09-20', personal: false }) },
      env,
    )
    expect(patchRes.status).toBe(404)

    const deleteRes = await app.request(`/api/events/${event.id}`, { method: 'DELETE', headers: memberHeaders }, env)
    expect(deleteRes.status).toBe(404)
  })

  it('登録者本人は編集・削除できる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const createRes = await app.request(
      '/api/events',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '旅行', eventDate: '2026-09-20', personal: false }) },
      env,
    )
    const event = await createRes.json<{ id: number }>()

    const patchRes = await app.request(
      `/api/events/${event.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '旅行(更新後)', eventDate: '2026-09-21', personal: false }) },
      env,
    )
    expect(patchRes.status).toBe(200)
    expect((await patchRes.json<{ name: string }>()).name).toBe('旅行(更新後)')

    const deleteRes = await app.request(`/api/events/${event.id}`, { method: 'DELETE', headers }, env)
    expect(deleteRes.status).toBe(204)
  })
})

describe('PATCH /api/events/:id/show-on-dashboard', () => {
  it('他の項目を変更せずshowOnDashboardのみ切り替えられる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const createRes = await app.request(
      '/api/events',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '旅行', eventDate: '2026-09-20', personal: false }) },
      env,
    )
    const event = await createRes.json<{ id: number }>()

    const res = await app.request(
      `/api/events/${event.id}/show-on-dashboard`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ showOnDashboard: false }) },
      env,
    )

    expect(res.status).toBe(200)
    const body = await res.json<{ name: string; showOnDashboard: boolean }>()
    expect(body.name).toBe('旅行')
    expect(body.showOnDashboard).toBe(false)
  })

  it('登録者本人以外は切り替えられず404を返す', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const hanako = await createUserWithoutHousehold('hanako@example.com')
    const memberHeaders = await joinHousehold(hanako.userId, hanako.headers, owner.headers)
    const createRes = await app.request(
      '/api/events',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ name: '旅行', eventDate: '2026-09-20', personal: false }) },
      env,
    )
    const event = await createRes.json<{ id: number }>()

    const res = await app.request(
      `/api/events/${event.id}/show-on-dashboard`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...memberHeaders }, body: JSON.stringify({ showOnDashboard: false }) },
      env,
    )

    expect(res.status).toBe(404)
  })
})

describe('GET /api/events/:id/summary', () => {
  async function createCategory(headers: Record<string, string>): Promise<number> {
    const res = await app.request('/api/kakeibo-categories', { headers }, env)
    const categories = await res.json<{ id: number }[]>()
    return categories[0].id
  }

  it('本人が支払った紐付け済み支出のみを対象期間で合計する', async () => {
    // ハードコードした日付だと実行時期によってテストが壊れるため、実行時の「今日」を
    // 基準に「今月」「今年の別の月(1月固定。ただし今月が1月の場合は12月にずらす)」
    // 「翌日」を動的に算出する。
    const today = getJstToday()
    const thisMonthDate = `${today.getUTCFullYear()}-${(today.getUTCMonth() + 1).toString().padStart(2, '0')}-01`
    const otherMonthInSameYear = today.getUTCMonth() === 0 ? 12 : 1
    const otherMonthDate = `${today.getUTCFullYear()}-${otherMonthInSameYear.toString().padStart(2, '0')}-01`
    const unrelatedDate = `${today.getUTCFullYear()}-${(today.getUTCMonth() + 1).toString().padStart(2, '0')}-02`

    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryId = await createCategory(headers)
    const createRes = await app.request(
      '/api/events',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '旅行', eventDate: thisMonthDate, personal: false }) },
      env,
    )
    const event = await createRes.json<{ id: number }>()
    await app.request(
      '/api/expenses',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ expenseDate: thisMonthDate, amount: 5000, purpose: '旅行代', categoryId, eventId: event.id }) },
      env,
    )
    await app.request(
      '/api/expenses',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ expenseDate: otherMonthDate, amount: 3000, purpose: '別月の旅行代', categoryId, eventId: event.id }) },
      env,
    )
    await app.request(
      '/api/expenses',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ expenseDate: unrelatedDate, amount: 1000, purpose: '無関係の支出', categoryId }) },
      env,
    )

    const yearRes = await app.request(`/api/events/${event.id}/summary?period=year`, { headers }, env)
    expect((await yearRes.json<{ total: number }>()).total).toBe(8000)

    const monthRes = await app.request(`/api/events/${event.id}/summary?period=month`, { headers }, env)
    expect((await monthRes.json<{ total: number }>()).total).toBe(5000)
  })

  it('他世帯のイベントIDを指定すると404を返す', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const other = await createUserWithHousehold('jiro@example.com')
    const createRes = await app.request(
      '/api/events',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ name: '旅行', eventDate: '2026-09-20', personal: false }) },
      env,
    )
    const event = await createRes.json<{ id: number }>()

    const res = await app.request(`/api/events/${event.id}/summary?period=year`, { headers: other.headers }, env)

    expect(res.status).toBe(404)
  })

  it('showOnDashboard=falseのイベントを指定すると404を返す', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const createRes = await app.request(
      '/api/events',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '旅行', eventDate: '2026-09-20', personal: false, showOnDashboard: false }) },
      env,
    )
    const event = await createRes.json<{ id: number }>()

    const res = await app.request(`/api/events/${event.id}/summary?period=year`, { headers }, env)

    expect(res.status).toBe(404)
  })
})

describe('POST /api/expenses eventId連携', () => {
  it('eventIdを指定すると支出とイベントが紐付く', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const categoryRes = await app.request('/api/kakeibo-categories', { headers }, env)
    const categoryId = (await categoryRes.json<{ id: number }[]>())[0].id
    const eventRes = await app.request(
      '/api/events',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '旅行', eventDate: '2026-09-20', personal: false }) },
      env,
    )
    const event = await eventRes.json<{ id: number }>()

    const res = await app.request(
      '/api/expenses',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ expenseDate: '2026-09-20', amount: 5000, purpose: '旅行代', categoryId, eventId: event.id }) },
      env,
    )

    expect(res.status).toBe(201)
    expect((await res.json<{ eventId: number | null }>()).eventId).toBe(event.id)
  })

  it('他世帯のイベントIDを指定すると400を返す', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const eventRes = await app.request(
      '/api/events',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ name: '旅行', eventDate: '2026-09-20', personal: false }) },
      env,
    )
    const event = await eventRes.json<{ id: number }>()

    const other = await createUserWithHousehold('jiro@example.com')
    const categoryRes = await app.request('/api/kakeibo-categories', { headers: other.headers }, env)
    const categoryId = (await categoryRes.json<{ id: number }[]>())[0].id

    const res = await app.request(
      '/api/expenses',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...other.headers }, body: JSON.stringify({ expenseDate: '2026-09-20', amount: 5000, purpose: '旅行代', categoryId, eventId: event.id }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('他メンバーの個人イベントには紐付けできず400を返す(本人のみ閲覧可能なため)', async () => {
    const owner = await createUserWithHousehold('taro@example.com')
    const hanako = await createUserWithoutHousehold('hanako@example.com')
    const memberHeaders = await joinHousehold(hanako.userId, hanako.headers, owner.headers)
    const eventRes = await app.request(
      '/api/events',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ name: '推し活', eventDate: '2026-09-20', personal: true }) },
      env,
    )
    const event = await eventRes.json<{ id: number }>()
    const categoryRes = await app.request('/api/kakeibo-categories', { headers: memberHeaders }, env)
    const categoryId = (await categoryRes.json<{ id: number }[]>())[0].id

    const res = await app.request(
      '/api/expenses',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...memberHeaders }, body: JSON.stringify({ expenseDate: '2026-09-20', amount: 3000, purpose: 'グッズ', categoryId, eventId: event.id }) },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('自分の個人イベントには紐付けできる', async () => {
    const { headers } = await createUserWithHousehold('taro@example.com')
    const eventRes = await app.request(
      '/api/events',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: '推し活', eventDate: '2026-09-20', personal: true }) },
      env,
    )
    const event = await eventRes.json<{ id: number }>()
    const categoryRes = await app.request('/api/kakeibo-categories', { headers }, env)
    const categoryId = (await categoryRes.json<{ id: number }[]>())[0].id

    const res = await app.request(
      '/api/expenses',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ expenseDate: '2026-09-20', amount: 3000, purpose: 'グッズ', categoryId, eventId: event.id }) },
      env,
    )

    expect(res.status).toBe(201)
  })
})
