import { Hono } from 'hono'
import { accountsRoute } from './routes/accounts'
import { authRoute } from './routes/auth'
import { cardsRoute } from './routes/cards'
import { expensesRoute } from './routes/expenses'
import { householdRoute } from './routes/household'
import { incomeCategoriesRoute } from './routes/income-categories'
import { incomesRoute } from './routes/incomes'
import { inventoryItemsRoute } from './routes/inventory-items'
import { kakeiboCategoriesRoute } from './routes/kakeibo-categories'
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
app.route('/api/incomes', incomesRoute)

export default app
