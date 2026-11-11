// 認証・画像解析のAPIの回数制限(#510)。
// メールアドレス・接続元・利用者ごとに固定窓で数え、上限を超えた要求を呼び出し側が429で返す。
// パスワード再設定の申請回数(password-reset-mail.ts、#401)と同じ数え方で、表は分けている。

export interface RateLimitRule {
  /** 数える種類。表の scope 列に入る。 */
  scope: string
  /** 1つの窓で許可する回数。 */
  limit: number
  /** 窓の長さ(秒)。 */
  windowSeconds: number
}

/** 固定窓のため、窓の境目では瞬間的に上限の最大2倍まで通りうる。 */
export const RATE_LIMITS = {
  // ログインと退会の取り消し(どちらもメールアドレスとパスワードで本人確認する)。
  loginEmail: { scope: 'login_email', limit: 10, windowSeconds: 15 * 60 },
  loginAddress: { scope: 'login_address', limit: 30, windowSeconds: 15 * 60 },
  registerAddress: { scope: 'register_address', limit: 5, windowSeconds: 60 * 60 },
  // ログイン済みの利用者が、現在のパスワードで再認証する操作(パスワード変更・メールアドレス変更・退会の申し込み)。
  reauthUser: { scope: 'reauth_user', limit: 10, windowSeconds: 15 * 60 },
  // 画像解析は外部サービスの利用料がかかるため、利用者ごとに1日の上限を置く。
  ocrUploadUser: { scope: 'ocr_upload_user', limit: 20, windowSeconds: 24 * 60 * 60 },
  ocrAnalyzeUser: { scope: 'ocr_analyze_user', limit: 20, windowSeconds: 24 * 60 * 60 },
} as const satisfies Record<string, RateLimitRule>

/** 回数の行を残す期間。最長の窓(1日)より長く、2日とする。 */
export const RATE_LIMIT_RETENTION_SECONDS = 2 * 24 * 60 * 60

export const TOO_MANY_REQUESTS_MESSAGE = '試行回数が多すぎます。しばらく待ってからもう一度お試しください'

export interface RateLimitTarget {
  rule: RateLimitRule
  /** 数える単位の値。null の対象は数えない(接続元を取得できない場合など)。 */
  key: string | null
}

async function digestKey(scope: string, value: string): Promise<string> {
  const data = new TextEncoder().encode(`rate-limit:${scope}:${value}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

const CONSUME_SQL = `INSERT INTO rate_limit_counters (scope, key_hash, window_start, count) VALUES (?, ?, ?, 1)
  ON CONFLICT(scope, key_hash, window_start) DO UPDATE SET count = count + 1 WHERE count < ?`

/**
 * 対象ごとの回数を1回のD1バッチで数え、すべてが上限内なら true を返す。
 * 各カウントは1文の条件付きUPSERTで原子的に増えるため、同時に要求しても上限を超えて許可されない。
 * どれか1つでも上限なら false(その要求では、ほかの対象の回数も消費する。保守的な側に倒れる)。
 * 成功・失敗や登録の有無は判定に使わないので、応答から登録の有無は分からない。
 */
export async function consumeRateLimits(db: D1Database, targets: RateLimitTarget[], nowMs: number = Date.now()): Promise<boolean> {
  const counted = targets.filter((target): target is { rule: RateLimitRule; key: string } => target.key !== null)
  if (counted.length === 0) return true
  const nowSeconds = Math.floor(nowMs / 1000)
  const statements = await Promise.all(
    counted.map(async ({ rule, key }) =>
      db.prepare(CONSUME_SQL).bind(rule.scope, await digestKey(rule.scope, key), Math.floor(nowSeconds / rule.windowSeconds) * rule.windowSeconds, rule.limit),
    ),
  )
  // 対象が1つなら1文だけ実行する(バッチにする必要がない)。複数なら1回のバッチにまとめる。
  const results = statements.length === 1 ? [await statements[0].run()] : await db.batch(statements)
  return results.every((result) => result.meta.changes > 0)
}

/** 保持期間を過ぎた回数の行を削除し、削除件数を返す。 */
export async function purgeRateLimits(db: D1Database, nowMs: number = Date.now()): Promise<number> {
  const threshold = Math.floor(nowMs / 1000) - RATE_LIMIT_RETENTION_SECONDS
  const result = await db.prepare('DELETE FROM rate_limit_counters WHERE window_start < ?').bind(threshold).run()
  return result.meta.changes
}

/**
 * 接続元(CloudflareがつけるCF-Connecting-IP)を、回数を数えるキーにする。
 * 取得できない場合とループバックの場合は null を返し、接続元単位の制限を行わない。
 * 本番ではCloudflareが必ず実際の接続元を設定するため、null になるのはローカル開発とテストだけ。
 */
export function clientAddressKey(header: string | undefined): string | null {
  const address = header?.trim().toLowerCase() ?? ''
  if (address === '' || address === '::1' || /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)) return null
  return address
}

/** メールアドレスを数えるキー。大文字・小文字と前後の空白を区別しない。 */
export function emailKey(email: string): string {
  return email.trim().toLowerCase()
}
