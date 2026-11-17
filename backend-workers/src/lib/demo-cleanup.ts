// 期限切れのデモ(#532)の削除。1時間ごとのCron(デモ環境のみ)から呼ぶ。

/** デモ環境で期限切れのデモを削除するCron式。既存の日次2本とは分けて扱う。 */
export const DEMO_CLEANUP_CRON = '0 * * * *'

/**
 * 期限切れのデモ世帯と、その2人に関わる全テーブルの行を、1回のD1 batchで削除する。戻り値は消したデモ世帯の数。
 * - 対象は demo_households に載っている世帯と利用者だけ。それ以外の行には触れない。
 * - デモ中に利用者が足した行(割り勘のコメント、世帯外の相手、店、リフレッシュトークンなど)も含む。
 * - 世帯ごとに呼ばず、期限切れすべてを副問い合わせの集合で1回のbatchにする。D1の無料プランは1回の実行で
 *   50クエリまでで、batchは1回と数えるため。IDをbindで並べない(D1は1文に100個までしかbindできない)。
 * - 外部キー(D1は有効)に合わせて、子→親の順に並べる。最後に demo_households を消す(外部キーを持たない)。
 */
export async function purgeExpiredDemos(db: D1Database, now: Date): Promise<number> {
  const threshold = now.toISOString()
  const expired = await db.prepare('SELECT COUNT(*) AS n FROM demo_households WHERE expires_at <= ?').bind(threshold).first<{ n: number }>()
  const count = expired?.n ?? 0
  if (count === 0) return 0

  const houses = 'SELECT household_id FROM demo_households WHERE expires_at <= ?1'
  const users = 'SELECT primary_user_id FROM demo_households WHERE expires_at <= ?1 UNION SELECT partner_user_id FROM demo_households WHERE expires_at <= ?1'
  const del = (sql: string) => db.prepare(`DELETE FROM ${sql}`).bind(threshold)

  await db.batch([
    // 割り勘: コメント → 内訳(支出・世帯外の相手・負担者のどれかが対象のもの)。
    del(`expense_split_comments WHERE author_user_id IN (${users}) OR expense_split_id IN (
      SELECT s.id FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.household_id IN (${houses}))`),
    del(`expense_splits WHERE debtor_user_id IN (${users})
      OR expense_id IN (SELECT id FROM expenses WHERE household_id IN (${houses}) OR payer_user_id IN (${users}))
      OR debtor_external_id IN (SELECT id FROM external_persons WHERE household_id IN (${houses}))`),
    del(`expenses WHERE household_id IN (${houses}) OR payer_user_id IN (${users})`),
    del(`incomes WHERE household_id IN (${houses}) OR earner_user_id IN (${users})`),
    // 固定費: 割り勘設定・計上の抑止 → 本体。
    del(`fixed_cost_splits WHERE fixed_cost_id IN (SELECT id FROM fixed_costs WHERE household_id IN (${houses}) OR created_by_user_id IN (${users}))
      OR debtor_user_id IN (${users}) OR debtor_external_id IN (SELECT id FROM external_persons WHERE household_id IN (${houses}))`),
    del(`fixed_cost_posting_suppressions WHERE fixed_cost_id IN (SELECT id FROM fixed_costs WHERE household_id IN (${houses}) OR created_by_user_id IN (${users}))`),
    del(`fixed_costs WHERE household_id IN (${houses}) OR created_by_user_id IN (${users})`),
    del(`events WHERE household_id IN (${houses}) OR created_by_user_id IN (${users})`),
    // 口座: チャージ履歴 → カード → 口座。
    del(`card_charges WHERE from_account_id IN (SELECT id FROM accounts WHERE household_id IN (${houses}) OR owner_user_id IN (${users}))
      OR card_id IN (SELECT c.id FROM cards c JOIN accounts a ON a.id = c.account_id WHERE a.household_id IN (${houses}) OR a.owner_user_id IN (${users}))`),
    del(`cards WHERE account_id IN (SELECT id FROM accounts WHERE household_id IN (${houses}) OR owner_user_id IN (${users}))`),
    del(`accounts WHERE household_id IN (${houses}) OR owner_user_id IN (${users})`),
    // 献立・レシピ、在庫・買い物。
    del(`menu_entries WHERE household_id IN (${houses})`),
    del(`recipes WHERE household_id IN (${houses}) OR created_by_user_id IN (${users})`),
    del(`shopping_purchase_requests WHERE household_id IN (${houses}) OR actor_user_id IN (${users})`),
    del(`shopping_list_items WHERE household_id IN (${houses})`),
    del(`inventory_items WHERE household_id IN (${houses})`),
    del(`stores WHERE household_id IN (${houses})`),
    // カテゴリー・世帯外の相手。
    del(`zaiko_categories WHERE household_id IN (${houses})`),
    del(`kakeibo_categories WHERE household_id IN (${houses})`),
    del(`income_categories WHERE household_id IN (${houses})`),
    del(`external_persons WHERE household_id IN (${houses})`),
    // 利用者に関わる行 → 世帯 → 利用者。
    del(`user_settings WHERE user_id IN (${users})`),
    del(`refresh_tokens WHERE user_id IN (${users})`),
    del(`password_reset_tokens WHERE user_id IN (${users})`),
    del(`household_members WHERE household_id IN (${houses}) OR user_id IN (${users})`),
    del(`households WHERE id IN (${houses})`),
    del(`users WHERE id IN (${users})`),
    // 目印の表は最後に消す(これより前の文が、この表を使って対象を決めるため)。
    del('demo_households WHERE expires_at <= ?1'),
  ])
  return count
}
