import { Hono } from 'hono'
import { authRoute } from './routes/auth'
import { householdRoute } from './routes/household'

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

export default app
