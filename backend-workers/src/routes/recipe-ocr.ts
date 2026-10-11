import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { z } from 'zod'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { ExternalServiceError, extractTextWithVision, structureRecipeText } from '../lib/recipe-ocr'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'
const INVALID_IMAGE_MESSAGE = '画像はJPEG・PNG・WebP形式、5MB以下のファイルを選択してください'
const IMAGE_NOT_FOUND_MESSAGE = '画像が見つかりません。もう一度アップロードしてください'
const EXTERNAL_ERROR_MESSAGE = '画像の解析に失敗しました。時間をおいて再度お試しください'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// 受け付ける画像形式と、ファイル先頭のマジックナンバー(形式ごとに決まっている数バイト)。
// Content-Typeは送信側で自由に偽装できるため、中身の先頭バイトでも形式を確かめる。
const IMAGE_TYPES: Record<string, { ext: string; matches: (bytes: Uint8Array) => boolean }> = {
  'image/jpeg': { ext: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': {
    ext: 'png',
    matches: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => b[index] === value),
  },
  'image/webp': {
    ext: 'webp',
    matches: (b) => String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP',
  },
}

const analyzeSchema = z.object({ key: z.string().regex(/^ocr\/\d+\/[0-9a-f-]{36}\.(jpg|png|webp)$/) })

// 一時keyの先頭に世帯IDを含めておき、他世帯の画像を解析できないようにする(IDOR対策)。
function householdPrefix(householdId: number): string {
  return `ocr/${householdId}/`
}

export const recipeOcrRoute = new Hono<AppEnv>()

recipeOcrRoute.use('*', requireAuth)

// POST /api/recipes/ocr/upload: 画像をR2に一時保存し、解析時に使うkeyを返す。
recipeOcrRoute.post('/upload', async (c) => {
  let file: unknown
  try {
    file = (await c.req.formData()).get('file')
  } catch {
    return c.json(errorResponse('VALIDATION_ERROR', INVALID_IMAGE_MESSAGE), 400)
  }
  if (!(file instanceof File)) {
    return c.json(errorResponse('VALIDATION_ERROR', INVALID_IMAGE_MESSAGE), 400)
  }
  const imageType = IMAGE_TYPES[file.type]
  if (!imageType || file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    return c.json(errorResponse('VALIDATION_ERROR', INVALID_IMAGE_MESSAGE), 400)
  }
  const bytes = await file.arrayBuffer()
  if (!imageType.matches(new Uint8Array(bytes))) {
    return c.json(errorResponse('VALIDATION_ERROR', INVALID_IMAGE_MESSAGE), 400)
  }

  const householdId = await resolveHouseholdId(drizzle(c.env.DB), c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const key = `${householdPrefix(householdId)}${crypto.randomUUID()}.${imageType.ext}`
  await c.env.RECIPE_IMAGES.put(key, bytes, { httpMetadata: { contentType: file.type } })
  return c.json({ key }, 201)
})

// POST /api/recipes/ocr/analyze: 一時保存した画像を解析し、構造化した結果を返す。
// 結果はDBに保存しない(利用者が確認フォームで編集してから POST /api/recipes で保存する)。
recipeOcrRoute.post('/analyze', async (c) => {
  const parsed = analyzeSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { key } = parsed.data

  const householdId = await resolveHouseholdId(drizzle(c.env.DB), c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }
  // 他世帯のkeyは「存在しない」と同じ404で返す(存在の有無を外部に区別させない)。
  if (!key.startsWith(householdPrefix(householdId))) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', IMAGE_NOT_FOUND_MESSAGE), 404)
  }

  const object = await c.env.RECIPE_IMAGES.get(key)
  if (!object) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', IMAGE_NOT_FOUND_MESSAGE), 404)
  }

  try {
    const image = await object.arrayBuffer()
    const apiKey = c.env.GOOGLE_VISION_API_KEY
    if (!apiKey) {
      return c.json(errorResponse('EXTERNAL_SERVICE_ERROR', EXTERNAL_ERROR_MESSAGE), 502)
    }
    const rawText = await extractTextWithVision(apiKey, image)
    if (rawText === null) {
      return c.json(errorResponse('VALIDATION_ERROR', '画像から文字を読み取れませんでした'), 400)
    }
    const structured = await structureRecipeText(c.env.AI, rawText)
    return c.json({ ...structured, rawText })
  } catch (error) {
    if (error instanceof ExternalServiceError) {
      return c.json(errorResponse('EXTERNAL_SERVICE_ERROR', EXTERNAL_ERROR_MESSAGE), 502)
    }
    throw error
  } finally {
    // 画像は解析のためだけの一時ファイルなので、成功・失敗にかかわらず削除する。
    await c.env.RECIPE_IMAGES.delete(key)
  }
})
