import { Hono } from 'hono'
import { accountsRoute } from './routes/accounts'
import { authRoute } from './routes/auth'
import { cardsRoute } from './routes/cards'
import { dashboardRoute } from './routes/dashboard'
import { eventsRoute } from './routes/events'
import { expenseSplitsRoute } from './routes/expense-splits'
import { expensesRoute } from './routes/expenses'
import { fixedCostsRoute } from './routes/fixed-costs'
import { postDueFixedCosts } from './lib/fixed-cost-posting'
import { getJstToday } from './lib/date'
import { householdRoute } from './routes/household'
import { incomeCategoriesRoute } from './routes/income-categories'
import { incomesRoute } from './routes/incomes'
import { inventoryItemsRoute } from './routes/inventory-items'
import { kakeiboCategoriesRoute } from './routes/kakeibo-categories'
import { menuEntriesRoute } from './routes/menu-entries'
import { recipesRoute } from './routes/recipes'
import { shoppingListItemsRoute } from './routes/shopping-list-items'
import { storesRoute } from './routes/stores'
import { zaikoCategoriesRoute } from './routes/zaiko-categories'

// wrangler.tomlのbindings定義から`wrangler types`で自動生成される
// グローバルEnv型(worker-configuration.d.ts、gitignore対象)をそのまま使う。
export type Bindings = Env

// requireAuthミドルウェアがJWT検証後にセットするコンテキスト変数。
export type Variables = {
  userId: number
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }

const app = new Hono<AppEnv>()

// app.route('/api/xxx', xxxRoute)は「/api/xxxへのリクエストは全部xxxRoute(各機能ごとに
// 分けて定義したルーター)に処理を任せる」という設定。例えば/api/recipesへのリクエストは
// routes/recipes.tsのrecipesRouteが処理する(Java/Spring MVCで言う@RequestMappingの
// パスをファイルごとに分けているイメージ)。
app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/api/auth', authRoute)
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
app.route('/api/recipes', recipesRoute)
app.route('/api/menu-entries', menuEntriesRoute)
app.route('/api/events', eventsRoute)

// デフォルトエクスポートはHonoインスタンス自身のままにする(テストコードが
// `app.request(...)`を直接呼び出しているため)。Cloudflare WorkersのCron Trigger用の
// scheduledハンドラは、ExportedHandlerの規約に沿ってapp自体にプロパティとして追加する。
// (既存JavaのFixedCostPostingService.runMonthlyPostingに相当。JSTには夏時間が無いため、
// wrangler.toml側のcron式はUTC 16:00固定 = JST 01:00で問題ない)。
const appWithScheduled = Object.assign(app, {
  async scheduled(_controller: ScheduledController, env: Bindings): Promise<void> {
    await postDueFixedCosts(env.DB, getJstToday())
  },
})

export default appWithScheduled
