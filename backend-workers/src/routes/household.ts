import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { households, householdMembers, users } from '../db/schema'
import { errorResponse } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const ALREADY_HAS_HOUSEHOLD_MESSAGE = '既にいずれかの世帯グループに所属しています'
const NOT_FOUND_MESSAGE = '世帯グループが見つかりません'
// コード誤りと期限切れを区別しない(api-design.md 3章参照、招待コード探索対策)
const INVALID_INVITE_CODE_MESSAGE = '招待コードが無効です'
const INVITE_CODE_GENERATION_FAILED_MESSAGE = '招待コードの生成に失敗しました。再度お試しください'

const INVITE_CODE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const INVITE_CODE_LENGTH = 16
const INVITE_CODE_MAX_RETRIES = 5

function generateInviteCode(): string {
  let code = ''
  const randomValues = crypto.getRandomValues(new Uint32Array(INVITE_CODE_LENGTH))
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += INVITE_CODE_CHARACTERS[randomValues[i] % INVITE_CODE_CHARACTERS.length]
  }
  return code
}

const createHouseholdSchema = z.object({
  name: z.string().max(100).refine((value) => value.trim().length > 0, { message: '世帯グループ名を入力してください' }),
})

const joinHouseholdSchema = z.object({
  inviteCode: z.string().min(1),
})

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed')
}

function isUniqueConstraintErrorOn(error: unknown, qualifiedColumn: string): boolean {
  return error instanceof Error && error.message.includes(`UNIQUE constraint failed: ${qualifiedColumn}`)
}

export const householdRoute = new Hono<AppEnv>()

householdRoute.use('*', requireAuth)

householdRoute.post('/', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = createHouseholdSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { name } = parsed.data
  const userId = c.get('userId')

  const db = drizzle(c.env.DB)
  const existingMembership = await db.select().from(householdMembers).where(eq(householdMembers.userId, userId)).get()
  if (existingMembership) {
    return c.json(errorResponse('VALIDATION_ERROR', ALREADY_HAS_HOUSEHOLD_MESSAGE), 400)
  }

  for (let attempt = 1; attempt <= INVITE_CODE_MAX_RETRIES; attempt += 1) {
    const inviteCode = generateInviteCode()
    try {
      // households/household_membersへの2つのINSERTを1つのD1バッチ(トランザクション)にまとめる。
      // 事前チェックとinsertの間で同時に別の世帯へ参加/作成された場合、2件目のINSERTが
      // household_members.user_idのUNIQUE制約に違反してバッチ全体がロールバックされるため、
      // 所有者不在のhousehold行が孤立して残ることはない(last_insert_rowid()で直前のINSERTの
      // idを参照することで、事前にhousehold.idを取得しなくても1バッチで完結できる)。
      const [householdInsertResult] = await c.env.DB.batch([
        c.env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?, ?)').bind(name, inviteCode),
        c.env.DB
          .prepare('INSERT INTO household_members (household_id, user_id) VALUES (last_insert_rowid(), ?)')
          .bind(userId),
      ])
      return c.json({ id: householdInsertResult.meta.last_row_id, name, inviteCode }, 201)
    } catch (error) {
      if (isUniqueConstraintErrorOn(error, 'household_members.user_id')) {
        return c.json(errorResponse('VALIDATION_ERROR', ALREADY_HAS_HOUSEHOLD_MESSAGE), 400)
      }
      if (isUniqueConstraintErrorOn(error, 'households.invite_code') && attempt < INVITE_CODE_MAX_RETRIES) {
        continue
      }
      if (isUniqueConstraintError(error)) {
        return c.json(errorResponse('DUPLICATE_RESOURCE', INVITE_CODE_GENERATION_FAILED_MESSAGE), 409)
      }
      throw error
    }
  }
  return c.json(errorResponse('DUPLICATE_RESOURCE', INVITE_CODE_GENERATION_FAILED_MESSAGE), 409)
})

householdRoute.post('/join', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = joinHouseholdSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { inviteCode } = parsed.data
  const userId = c.get('userId')

  const db = drizzle(c.env.DB)
  const existingMembership = await db.select().from(householdMembers).where(eq(householdMembers.userId, userId)).get()
  if (existingMembership) {
    return c.json(errorResponse('VALIDATION_ERROR', ALREADY_HAS_HOUSEHOLD_MESSAGE), 400)
  }

  const household = await db.select().from(households).where(eq(households.inviteCode, inviteCode)).get()
  if (!household) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', INVALID_INVITE_CODE_MESSAGE), 404)
  }

  try {
    // 検索(SELECT)と登録(INSERT)を1つのクエリにまとめ、招待コードが一致する場合のみ挿入する。
    // 別々のクエリのままだと、この間に招待コードが再発行された場合、無効化されたはずの
    // 旧コードでも参加できてしまう競合状態が起こりうる。
    const insertResult = await c.env.DB.prepare(
      `INSERT INTO household_members (household_id, user_id)
       SELECT id, ? FROM households WHERE id = ? AND invite_code = ?`,
    )
      .bind(userId, household.id, inviteCode)
      .run()
    if (insertResult.meta.changes === 0) {
      return c.json(errorResponse('RESOURCE_NOT_FOUND', INVALID_INVITE_CODE_MESSAGE), 404)
    }
  } catch (error) {
    if (isUniqueConstraintErrorOn(error, 'household_members.user_id')) {
      return c.json(errorResponse('VALIDATION_ERROR', ALREADY_HAS_HOUSEHOLD_MESSAGE), 400)
    }
    throw error
  }

  return c.json({ id: household.id, name: household.name })
})

householdRoute.get('/me', async (c) => {
  const userId = c.get('userId')
  const db = drizzle(c.env.DB)

  const membership = await db.select().from(householdMembers).where(eq(householdMembers.userId, userId)).get()
  if (!membership) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  const household = await db.select().from(households).where(eq(households.id, membership.householdId)).get()
  if (!household) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  const memberRows = await db
    .select({ userId: users.id, displayName: users.displayName })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, household.id))
    .all()

  return c.json({
    id: household.id,
    name: household.name,
    inviteCode: household.inviteCode,
    members: memberRows,
  })
})

householdRoute.post('/invite-code/regenerate', async (c) => {
  const userId = c.get('userId')
  const db = drizzle(c.env.DB)

  const membership = await db.select().from(householdMembers).where(eq(householdMembers.userId, userId)).get()
  if (!membership) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  for (let attempt = 1; attempt <= INVITE_CODE_MAX_RETRIES; attempt += 1) {
    const inviteCode = generateInviteCode()
    try {
      await db.update(households).set({ inviteCode }).where(eq(households.id, membership.householdId))
      return c.json({ inviteCode })
    } catch (error) {
      if (isUniqueConstraintError(error) && attempt < INVITE_CODE_MAX_RETRIES) {
        continue
      }
      if (isUniqueConstraintError(error)) {
        return c.json(errorResponse('DUPLICATE_RESOURCE', INVITE_CODE_GENERATION_FAILED_MESSAGE), 409)
      }
      throw error
    }
  }
  return c.json(errorResponse('DUPLICATE_RESOURCE', INVITE_CODE_GENERATION_FAILED_MESSAGE), 409)
})

householdRoute.post('/leave', async (c) => {
  const userId = c.get('userId')
  const db = drizzle(c.env.DB)

  const membership = await db.select().from(householdMembers).where(eq(householdMembers.userId, userId)).get()
  if (!membership) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  // メンバー削除と「残りメンバーが0人ならhousehold削除」を1つのD1バッチ(トランザクション)にまとめる。
  // 別々のクエリのままだと、削除→残数確認→household削除の間に別ユーザーの参加(join)が割り込み、
  // 参加が成功した直後にそのメンバーごとhouseholdが削除されてしまう競合状態が起こりうる。
  // 2文目のNOT EXISTSサブクエリは同一トランザクション内で1文目のDELETE適用後の状態を見るため、
  // このバッチの実行中に他リクエストのjoinが割り込む余地がない。
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM household_members WHERE user_id = ?').bind(userId),
    c.env.DB
      .prepare(
        `DELETE FROM households WHERE id = ? AND NOT EXISTS (
           SELECT 1 FROM household_members WHERE household_id = ?
         )`,
      )
      .bind(membership.householdId, membership.householdId),
  ])

  return c.body(null, 204)
})
