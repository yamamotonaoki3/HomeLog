import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { errorResponse } from './lib/errors'
import { accountsRoute } from './routes/accounts'
import { authRoute } from './routes/auth'
import { cardsRoute } from './routes/cards'
import { demoRoute } from './routes/demo'
import { dashboardRoute } from './routes/dashboard'
import { eventsRoute } from './routes/events'
import { expenseSplitsRoute } from './routes/expense-splits'
import { expensesRoute } from './routes/expenses'
import { fixedCostsRoute } from './routes/fixed-costs'
import { postDueFixedCosts } from './lib/fixed-cost-posting'
import { purgeExpiredAccounts } from './lib/account-deletion'
import { DEMO_CLEANUP_CRON, purgeExpiredDemos } from './lib/demo-cleanup'
import { purgePasswordResetAttempts } from './lib/password-reset-mail'
import { purgeRateLimits } from './lib/rate-limit'
import { deleteStaleOcrImages } from './lib/recipe-ocr'
import { consumeInventoryForDate, consumptionDate } from './lib/inventory-consumption'
import { getJstToday } from './lib/date'
import { purgePastMenuEntries } from './lib/menu-entry-cleanup'
import { householdRoute } from './routes/household'
import { incomeCategoriesRoute } from './routes/income-categories'
import { incomesRoute } from './routes/incomes'
import { inventoryItemsRoute } from './routes/inventory-items'
import { kakeiboCategoriesRoute } from './routes/kakeibo-categories'
import { demoGuard } from './middleware/demo-guard'
import { menuEntriesRoute } from './routes/menu-entries'
import { recipeOcrRoute } from './routes/recipe-ocr'
import { recipesRoute } from './routes/recipes'
import { shoppingListItemsRoute } from './routes/shopping-list-items'
import { storesRoute } from './routes/stores'
import { zaikoCategoriesRoute } from './routes/zaiko-categories'
import { userSettingsRoute } from './routes/user-settings'

// wrangler.tomlのbindings定義から`wrangler types`で自動生成される
// グローバルEnv型(worker-configuration.d.ts、gitignore対象)をそのまま使う。
// GOOGLE_VISION_API_KEYはwrangler secret put / .dev.varsで設定するシークレットで、
// 未設定の環境(CI等)では型が生成されないため、任意項目として明示的に足す。
// PASSWORD_RESET_GAS_URL / PASSWORD_RESET_GAS_SECRET も同様の任意のsecret(#401)。
// DEMO_MODEは "true" のときだけデモ環境として動く(#532)。本番では未設定。
export type Bindings = Env & { GOOGLE_VISION_API_KEY?: string; PASSWORD_RESET_GAS_URL?: string; PASSWORD_RESET_GAS_SECRET?: string; DEMO_MODE?: string }

// requireAuthミドルウェアがJWT検証後にセットするコンテキスト変数。
export type Variables = {
  userId: number
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }

const app = new Hono<AppEnv>()

app.onError((err, c) => {
  // Drizzle may wrap the D1 trigger error in a cause.
  const seen = new Set<Error>()
  let cause: unknown = err
  while (cause instanceof Error && !seen.has(cause)) {
    seen.add(cause)
    if (/\bHOMELOG_ACCOUNT_DELETED\b/.test(cause.message)) {
      return c.json(errorResponse('VALIDATION_ERROR', '指定された口座が見つかりません'), 400)
    }
    cause = cause.cause
  }
  // Honoの既定と同じHTTP例外/500応答を維持し、privateなerrorHandlerには依存しない。
  if ('getResponse' in err) {
    const response = err.getResponse()
    return c.newResponse(response.body, response)
  }
  console.error(err)
  return c.text('Internal Server Error', 500)
})

// app.route('/api/xxx', xxxRoute)は「/api/xxxへのリクエストは全部xxxRoute(各機能ごとに
// 分けて定義したルーター)に処理を任せる」という設定。例えば/api/recipesへのリクエストは
// routes/recipes.tsのrecipesRouteが処理する(Java/Spring MVCで言う@RequestMappingの
// パスをファイルごとに分けているイメージ)。
// ---- API応答の安全用ヘッダーと、リクエスト本文の大きさの上限(#512) ----
// 画面(静的ファイル)はWorkerを通らないため、ここで付くのは /api/* と /health の応答だけ。
const API_PATHS = ['/api/*', '/health'] as const
// JSONのAPIが受け付ける本文の上限。最も大きい正当な入力(レシピの材料・手順が各10,000文字)でも収まる大きさ。
const MAX_JSON_BODY_BYTES = 100 * 1024
// 画像のアップロードは専用の上限(5MB＋余裕)を routes/recipe-ocr.ts で設けている。
const UPLOAD_PATH = '/api/recipes/ocr/upload'

const apiSecureHeaders = secureHeaders({
  // APIはJSONだけを返す。ブラウザに文書として解釈・埋め込みさせない。
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  xFrameOptions: 'DENY',
  referrerPolicy: 'strict-origin-when-cross-origin',
  strictTransportSecurity: 'max-age=31536000',
})
const jsonBodyLimit = bodyLimit({
  maxSize: MAX_JSON_BODY_BYTES,
  onError: (c) => c.json(errorResponse('VALIDATION_ERROR', '送信された内容が大きすぎます'), 413),
})

for (const path of API_PATHS) {
  app.use(path, apiSecureHeaders)
  // 個人のデータを含む応答を、ブラウザや中継のキャッシュに残さない(個別に指定済みの応答はそのまま)。
  app.use(path, async (c, next) => {
    await next()
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store')
  })
}
app.use('/api/*', (c, next) => (c.req.path === UPLOAD_PATH ? next() : jsonBodyLimit(c, next)))
// デモ環境(DEMO_MODE)だけ、費用・画像・アカウント管理のAPIを処理の前に止める(#532)。
app.use('/api/*', demoGuard)

app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/api/auth', authRoute)
app.route('/api/demo', demoRoute)
app.route('/api/households', householdRoute)
app.route('/api/zaiko-categories', zaikoCategoriesRoute)
app.route('/api/stores', storesRoute)
app.route('/api/inventory-items', inventoryItemsRoute)
app.route('/api/shopping-list-items', shoppingListItemsRoute)
app.route('/api/kakeibo-categories', kakeiboCategoriesRoute)
app.route('/api/income-categories', incomeCategoriesRoute)
app.route('/api/accounts', accountsRoute)
app.route('/api/cards', cardsRoute)
app.route('/api/expenses', expensesRoute)
app.route('/api/expense-splits', expenseSplitsRoute)
app.route('/api/incomes', incomesRoute)
app.route('/api/fixed-costs', fixedCostsRoute)
app.route('/api/dashboard', dashboardRoute)
app.route('/api/recipes/ocr', recipeOcrRoute)
app.route('/api/recipes', recipesRoute)
app.route('/api/menu-entries', menuEntriesRoute)
app.route('/api/events', eventsRoute)
app.route('/api/user-settings', userSettingsRoute)

// デフォルトエクスポートはHonoインスタンス自身のままにする(テストコードが
// `app.request(...)`を直接呼び出しているため)。Cloudflare WorkersのCron Trigger用の
// scheduledハンドラは、ExportedHandlerの規約に沿ってapp自体にプロパティとして追加する。
// (既存JavaのFixedCostPostingService.runMonthlyPostingに相当。JSTには夏時間が無いため、
// wrangler.toml側のcron式はUTC 16:00固定 = JST 01:00で問題ない)。
const appWithScheduled = Object.assign(app, {
  async scheduled(controller: ScheduledController, env: Bindings): Promise<void> {
    // 1時間ごとのCron(デモ環境のみ)は、期限切れのデモの削除だけを行う。在庫の自動消費・固定費の計上などは動かさない(#532)。
    if (controller.cron === DEMO_CLEANUP_CRON) {
      try {
        await purgeExpiredDemos(env.DB, new Date())
      } catch (error) {
        console.error('期限切れのデモの削除に失敗しました', error)
      }
      return
    }
    // JST 0時は献立だけ。既存のJST 1時にも再試行し、取りこぼしを回収する。
    const cleanup = purgePastMenuEntries(env.DB, new Date())
    // 一方が失敗しても、ほかの日次処理は実行する。
    const results = await Promise.allSettled([
      cleanup,
      ...(controller.cron === '0 15 * * *' ? [] : [
        consumeInventoryForDate(env.DB, consumptionDate(controller.scheduledTime)),
        postDueFixedCosts(env.DB, getJstToday()),
        // R2が無い環境(デモ)では画像の削除を行わない。
        ...(env.RECIPE_IMAGES ? [deleteStaleOcrImages(env.RECIPE_IMAGES, new Date())] : []),
        // 退会の申し込みから30日を過ぎたアカウントの削除(#297)。
        purgeExpiredAccounts(env.DB, new Date()),
        // 保持期間を過ぎたパスワード再設定の回数制限の行を削除する(#401)。
        purgePasswordResetAttempts(env.DB),
        // 保持期間を過ぎた認証・画像解析の回数制限の行を削除する(#510)。
        purgeRateLimits(env.DB),
      ]),
    ])
    for (const result of results) {
      if (result.status === 'rejected') console.error('日次処理に失敗しました', result.reason)
    }
  },
})

export default appWithScheduled
