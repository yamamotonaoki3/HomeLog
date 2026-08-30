import { Hono } from 'hono'
import { authRoute } from './routes/auth'

// wrangler.tomlのbindings定義から`wrangler types`で自動生成される
// グローバルEnv型(worker-configuration.d.ts、gitignore対象)をそのまま使う。
export type Bindings = Env

const app = new Hono<{ Bindings: Bindings }>()

app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/auth', authRoute)

export default app
