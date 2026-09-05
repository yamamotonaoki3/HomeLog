// drizzle-ormは「SQLを直接書かずにTypeScriptの関数呼び出しでクエリを組み立てる」ためのライブラリ
// (Java/MyBatisで言うとMapper層に相当)。and/eqはWHERE句の条件を作るためのヘルパー関数。
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
// Honoはこのプロジェクトで使っているWebフレームワーク(Java/Spring MVCのControllerに相当)。
// `type Context`のように`type`を付けてimportすると型情報だけを取り込む(実行時には影響しない)。
import { Hono, type Context } from 'hono'
// zodはリクエストボディの検証(バリデーション)を行うライブラリ(Java/Spring Validationに相当)。
import { z } from 'zod'
import { recipes } from '../db/schema'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = 'レシピが見つかりません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

// z.object({...})で「リクエストボディはこういう形であるべき」というルールを定義する。
// このオブジェクト自体がPOST(新規登録)とPATCH(更新)の両方で共用されている。
const recipeSchema = z.object({
  // z.string().max(100)で「文字列かつ100文字以内」、.refine(...)で追加の独自チェック
  // (トリムした結果が空文字でないこと=空白だけの入力を弾く)を行う。
  title: z.string().max(100).refine((value) => value.trim().length > 0, { message: 'タイトルを入力してください' }),
  // .nullish()は「null・undefined・その型のいずれか」を許可する、という意味
  // (材料・手順は任意入力のため、送られてこなくても、nullで送られてきてもOKにする)。
  ingredients: z.string().nullish(),
  steps: z.string().nullish(),
})

// お気に入りON/OFF切り替え専用のリクエストボディの形。
const favoriteSchema = z.object({
  isFavorite: z.boolean(),
})

// WEBレシピ引用登録(POST /from-url)専用のリクエストボディの形。
const fromUrlSchema = z.object({
  url: z.string().max(2048),
  memo: z.string().max(255).nullish(),
})

// WEBレシピ(source_type='web')の編集専用のリクエストボディの形。memoしか変更できない。
const webRecipeUpdateSchema = z.object({
  memo: z.string().max(255).nullish(),
})

const FROM_URL_VALIDATION_MESSAGE = 'URLの形式を確認してください'
const FETCH_FAILED_MESSAGE = 'URLの取得に失敗しました。URLを確認してください'
// HTMLRewriterでのOGP抽出中、レスポンスボディを丸ごとメモリに載せないための上限(2MB)。
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

// プライベートIP帯・ループバックアドレスへのアクセスを弾く(SSRF対策の多層防御)。
// Cloudflare WorkersのfetchはすでにIPアドレスへの直接アクセス等をある程度制限しているが、
// hostnameの文字列だけでも判定できる範囲は明示的にブロックしておく。
function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '0.0.0.0' || lower === '::1') {
    return true
  }
  if (/^10\./.test(lower)) return true
  if (/^192\.168\./.test(lower)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(lower)) return true
  return false
}

// HTMLRewriterで<meta property="og:title">/<meta property="og:image">/<title>を
// ストリーミング抽出するためのハンドラ。ボディ全体を.text()で読み込まず、
// タグを見つけた時点で値を保持していく。
class MetaCollector {
  ogTitle: string | null = null
  ogImage: string | null = null
  titleTagText = ''
  private inTitleTag = false

  element(element: Element) {
    if (element.tagName === 'meta') {
      const property = element.getAttribute('property')
      const content = element.getAttribute('content')
      if (property === 'og:title' && content) this.ogTitle = content
      if (property === 'og:image' && content) this.ogImage = content
    } else if (element.tagName === 'title') {
      this.inTitleTag = true
      element.onEndTag(() => {
        this.inTitleTag = false
      })
    }
  }

  text(chunk: Text) {
    if (this.inTitleTag) {
      this.titleTagText += chunk.text
    }
  }
}

// リクエストボディのJSONを安全に読み取るための共通関数。
// ボディが空、あるいはJSONとして壊れている場合に例外で落ちないよう、catchでnullを返す。
async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

// DBから取得したレシピの行(DBの列名そのままの形)を、APIレスポンス用の形に変換する関数。
// `typeof recipes.$inferSelect`は「recipesテーブルをSELECTしたときの行の型」を
// drizzle-ormに自動で推論させるための書き方(手で型を書き直す必要がなくなる)。
function toResponse(recipe: typeof recipes.$inferSelect) {
  return {
    id: recipe.id,
    title: recipe.title,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    sourceType: recipe.sourceType,
    url: recipe.url,
    thumbnailUrl: recipe.thumbnailUrl,
    memo: recipe.memo,
    isFavorite: recipe.isFavorite,
  }
}

// この機能専用の小さなHonoアプリ(ルーター)を作る。src/index.tsで
// `app.route('/api/recipes', recipesRoute)`のように差し込まれ、全体のアプリに組み込まれる。
export const recipesRoute = new Hono<AppEnv>()

// '*'は「このルーター配下の全エンドポイント」という意味。
// requireAuthミドルウェアを先に通すことで、以降の処理ではログイン済みであることが保証される
// (Java/Spring Securityのフィルターに近い役割)。
recipesRoute.use('*', requireAuth)

// GET /api/recipes: 世帯内の全レシピを一覧取得する。
recipesRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  // requireAuthがセットしたuserIdから、所属する世帯グループのIDを解決する。
  // 世帯に所属していない場合はnullが返るので404として扱う。
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  // レシピは世帯メンバー全員が自由に編集可能(common-notes.md 2章)なため、
  // 所有者チェックは行わず世帯所属のみを確認する(stores.tsと同じパターン)。
  // db.select().from(recipes).where(...)は「SELECT * FROM recipes WHERE ...」に相当する。
  const rows = await db.select().from(recipes).where(eq(recipes.householdId, householdId)).orderBy(recipes.id).all()
  // rows.map(toResponse)で、取得した行1件1件をtoResponseで変換した配列を作り、JSONで返す。
  return c.json(rows.map(toResponse))
})

// POST /api/recipes: レシピを新規登録する。
recipesRoute.post('/', async (c) => {
  // safeParseは「検証してエラーがあっても例外を投げず、成功/失敗を結果オブジェクトで返す」メソッド。
  const parsed = recipeSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  // parsed.dataには検証済み・型が確定した値が入っている(分割代入で個別の変数に取り出す)。
  const { title, ingredients, steps } = parsed.data
  // db.insert(recipes).values({...})は「INSERT INTO recipes (...) VALUES (...)」に相当する。
  // .returning()を付けると、INSERT直後にその行をSELECTし直さずそのまま結果として受け取れる。
  // `ingredients ?? null`は「ingredientsがnull/undefinedならnullを使う」という意味
  // (nullish()で受け取った値をDBのNULLに正規化している)。
  const inserted = await db
    .insert(recipes)
    .values({
      householdId,
      createdByUserId: userId,
      title,
      ingredients: ingredients ?? null,
      steps: steps ?? null,
      // 今回は手動登録のみに対応するため、常に'manual'固定で保存する。
      sourceType: 'manual',
      isFavorite: false,
    })
    .returning()
    .get()

  // 201はHTTPステータスコードで「作成成功」を意味する。
  return c.json(toResponse(inserted), 201)
})

// POST /api/recipes/from-url: WEBレシピを引用登録する。
// 材料・手順は保持せず、元ページへの参照(url/thumbnailUrl)とタイトル・メモだけを保存する。
recipesRoute.post('/from-url', async (c) => {
  const parsed = fromUrlSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', FROM_URL_VALIDATION_MESSAGE), 400)
  }
  const { url, memo } = parsed.data

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return c.json(errorResponse('VALIDATION_ERROR', FROM_URL_VALIDATION_MESSAGE), 400)
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return c.json(errorResponse('VALIDATION_ERROR', FROM_URL_VALIDATION_MESSAGE), 400)
  }
  if (isBlockedHostname(parsedUrl.hostname)) {
    return c.json(errorResponse('VALIDATION_ERROR', FROM_URL_VALIDATION_MESSAGE), 400)
  }

  let response: Response
  try {
    response = await fetch(parsedUrl.toString(), {
      headers: { 'User-Agent': 'HomeLogBot/1.0 (+recipe-clip)' },
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    return c.json(errorResponse('VALIDATION_ERROR', FETCH_FAILED_MESSAGE), 400)
  }
  if (!response.ok) {
    return c.json(errorResponse('VALIDATION_ERROR', FETCH_FAILED_MESSAGE), 400)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html') || !response.body) {
    return c.json(errorResponse('VALIDATION_ERROR', FETCH_FAILED_MESSAGE), 400)
  }

  const collector = new MetaCollector()
  const rewriter = new HTMLRewriter().on('meta', collector).on('title', collector)

  let byteCount = 0
  const countingSink = new WritableStream<Uint8Array>({
    write(chunk) {
      byteCount += chunk.byteLength
      if (byteCount > MAX_RESPONSE_BYTES) {
        throw new Error('response too large')
      }
    },
  })

  try {
    await rewriter.transform(response).body?.pipeTo(countingSink)
  } catch {
    // 2MB超過時などはここに到達するが、その時点までに取得できたメタ情報で処理を続行する。
  }

  const title = collector.ogTitle ?? (collector.titleTagText.trim() || null) ?? parsedUrl.toString()
  const thumbnailUrl = collector.ogImage ?? null

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const inserted = await db
    .insert(recipes)
    .values({
      householdId,
      createdByUserId: userId,
      title,
      ingredients: null,
      steps: null,
      sourceType: 'web',
      url: parsedUrl.toString(),
      thumbnailUrl,
      memo: memo ?? null,
      isFavorite: false,
    })
    .returning()
    .get()

  return c.json(toResponse(inserted), 201)
})

// PATCH /api/recipes/:id: 既存レシピを編集する。
// sourceType='web'のレシピはブックマークに近い性質のため、memoしか編集できない
// (title/ingredients/steps/urlは元ページの情報のまま変更不可)。manual/ocrは従来通り。
recipesRoute.patch('/:id', async (c) => {
  // URLの:id部分(例: /api/recipes/5 の "5")は文字列として渡ってくるため、Number()で数値に変換する。
  const recipeId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  // 「そのIDのレシピが存在し、かつ自分の世帯のものか」を1つの条件(and)で確認する。
  // 他世帯のレシピIDを指定された場合もここでnull(該当なし)になり、404を返す
  // (「存在しない」のか「他人の世帯のものだから見えない」のかを外部に区別させないため。
  // common-notes.md 10章のIDOR対策の考え方に合わせている)。
  const recipe = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .get()
  if (!recipe) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  if (recipe.sourceType === 'web') {
    const parsed = webRecipeUpdateSchema.safeParse(await parseJsonBody(c))
    if (!parsed.success) {
      return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
    }
    const memo = parsed.data.memo ?? null
    await db.update(recipes).set({ memo }).where(eq(recipes.id, recipeId))
    return c.json(toResponse({ ...recipe, memo }))
  }

  const parsed = recipeSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { title, ingredients, steps } = parsed.data
  // db.update(recipes).set({...}).where(...)は「UPDATE recipes SET ... WHERE ...」に相当する。
  await db
    .update(recipes)
    .set({ title, ingredients: ingredients ?? null, steps: steps ?? null })
    .where(eq(recipes.id, recipeId))

  // 更新後にもう一度SELECTし直す代わりに、直前に取得したrecipeを元にして
  // 更新後の値で上書きしたオブジェクトを組み立てて返す(`...recipe`は元のプロパティを
  // すべてコピーしてから、指定したプロパティだけ上書きするスプレッド構文)。
  return c.json(toResponse({ ...recipe, title, ingredients: ingredients ?? null, steps: steps ?? null }))
})

// PATCH /api/recipes/:id/favorite: お気に入りのON/OFFだけを切り替える専用エンドポイント。
recipesRoute.patch('/:id/favorite', async (c) => {
  const parsed = favoriteSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const recipeId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const recipe = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .get()
  if (!recipe) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  const { isFavorite } = parsed.data
  await db.update(recipes).set({ isFavorite }).where(eq(recipes.id, recipeId))

  return c.json(toResponse({ ...recipe, isFavorite }))
})

// DELETE /api/recipes/:id: レシピを削除する。
recipesRoute.delete('/:id', async (c) => {
  const recipeId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const recipe = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .get()
  if (!recipe) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  await db.delete(recipes).where(eq(recipes.id, recipeId))

  // 204は「成功したが返すデータは無い」という意味のHTTPステータスコード。
  // c.body(null, 204)でレスポンスボディを空にする。
  return c.body(null, 204)
})
