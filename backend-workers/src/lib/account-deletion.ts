// 退会(アカウント削除)の共通処理(#297、F01_auth.md 8-2章)。

export const DELETION_GRACE_DAYS = 30
const GRACE_MS = DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000
export const DELETED_USER_DISPLAY_NAME = '退会したユーザー'

export function deletionScheduledAt(requestedAt: string): string {
  return new Date(new Date(requestedAt).getTime() + GRACE_MS).toISOString()
}

// 取り消し期間内か(申し込みから30日以内)。
export function isWithinGracePeriod(requestedAt: string, now = new Date()): boolean {
  return now.getTime() < new Date(requestedAt).getTime() + GRACE_MS
}

export interface DeletionBlockers {
  unsettledSplits: number
  fixedCostsWithOthers: number
}

// 退会を申し込めない理由。本人が立替者・負担者の未精算の割り勘内訳と、
// 本人が登録し他の人が負担する固定費・他の人が登録し本人が負担する固定費を数える。
export async function countDeletionBlockers(db: D1Database, userId: number): Promise<DeletionBlockers> {
  const [splits, fixedCosts] = await db.batch<{ n: number }>([
    db.prepare(
      `SELECT COUNT(*) AS n FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
       WHERE s.status <> 'settled' AND (s.debtor_user_id = ? OR e.payer_user_id = ?)`,
    ).bind(userId, userId),
    db.prepare(
      `SELECT COUNT(DISTINCT f.id) AS n FROM fixed_costs f JOIN fixed_cost_splits fs ON fs.fixed_cost_id = f.id
       WHERE (f.created_by_user_id = ? AND (fs.debtor_user_id IS NULL OR fs.debtor_user_id <> ?))
          OR (f.created_by_user_id <> ? AND fs.debtor_user_id = ?)`,
    ).bind(userId, userId, userId, userId),
  ])
  return { unsettledSplits: splits.results[0]?.n ?? 0, fixedCostsWithOthers: fixedCosts.results[0]?.n ?? 0 }
}

export function hasBlockers(blockers: DeletionBlockers): boolean {
  return blockers.unsettledSplits > 0 || blockers.fixedCostsWithOthers > 0
}

// 退会済み行に使うメールアドレスのドメイン(RFC 2606の予約ドメイン)。登録・メールアドレス変更では受け付けない。
export const DELETED_EMAIL_DOMAIN = 'deleted.invalid'

export function isReservedEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${DELETED_EMAIL_DOMAIN}`)
}

const BLOCKER_EXISTS = `EXISTS (
  SELECT 1 FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
  WHERE s.status <> 'settled' AND (s.debtor_user_id = ?1 OR e.payer_user_id = ?1)
) OR EXISTS (
  SELECT 1 FROM fixed_costs f JOIN fixed_cost_splits fs ON fs.fixed_cost_id = f.id
  WHERE (f.created_by_user_id = ?1 AND (fs.debtor_user_id IS NULL OR fs.debtor_user_id <> ?1))
     OR (f.created_by_user_id <> ?1 AND fs.debtor_user_id = ?1)
)`

// 1人分の削除。全体を1つのD1バッチ(トランザクション)で行う。
// 1文目で「未精算などが無い」ことを確かめながら deleted_at を記録し、以降の文はその印がある場合だけ実行する。
// これにより、事前確認の後に割り勘が追加されても、削除が途中まで進むことはない。
function purgeStatements(db: D1Database, userId: number, householdId: number | null, now: string, threshold: string): D1PreparedStatement[] {
  const marked = 'EXISTS (SELECT 1 FROM users WHERE id = ?1 AND deleted_at = ?2)'
  const ownAccounts = 'SELECT id FROM accounts WHERE owner_user_id = ?1'
  const ownCards = 'SELECT c.id FROM cards c JOIN accounts a ON a.id = c.account_id WHERE a.owner_user_id = ?1'
  const guarded = (sql: string) => db.prepare(`${sql} AND ${marked}`).bind(userId, now)
  // 選定後に取り消し→再申し込みされた場合に新しい申し込みを消さないよう、期限もこのトランザクション内で確かめ直す。
  const statements = [
    db.prepare(
      `UPDATE users SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL AND deletion_requested_at IS NOT NULL AND deletion_requested_at <= ?3 AND NOT (${BLOCKER_EXISTS})`,
    ).bind(userId, now, threshold),
    // 残す記録から、本人の口座・カードへの参照を外す。
    guarded(`UPDATE expenses SET account_id = NULL WHERE account_id IN (${ownAccounts})`),
    guarded(`UPDATE expenses SET card_id = NULL WHERE card_id IN (${ownCards})`),
    guarded(`UPDATE fixed_costs SET account_id = NULL WHERE account_id IN (${ownAccounts})`),
    guarded(`UPDATE fixed_costs SET card_id = NULL WHERE card_id IN (${ownCards})`),
    guarded(`UPDATE expense_splits SET debtor_account_id = NULL WHERE debtor_account_id IN (${ownAccounts})`),
    guarded(`UPDATE incomes SET account_id = NULL WHERE account_id IN (${ownAccounts})`),
    guarded('DELETE FROM incomes WHERE earner_user_id = ?1'),
    // 割り勘内訳のある支出は、他のメンバーの精算記録として残す。
    guarded('DELETE FROM expenses WHERE payer_user_id = ?1 AND NOT EXISTS (SELECT 1 FROM expense_splits s WHERE s.expense_id = expenses.id)'),
    // 固定費は登録者しか編集・削除できないため、本人が登録したものは削除して自動計上を止める。
    guarded('DELETE FROM fixed_costs WHERE created_by_user_id = ?1'),
    guarded('DELETE FROM events WHERE owner_user_id = ?1'),
    guarded(`DELETE FROM card_charges WHERE (from_account_id IN (${ownAccounts}) OR card_id IN (${ownCards}))`),
    guarded('DELETE FROM accounts WHERE owner_user_id = ?1'),
    guarded('DELETE FROM user_settings WHERE user_id = ?1'),
    guarded('DELETE FROM refresh_tokens WHERE user_id = ?1'),
    guarded('DELETE FROM password_reset_tokens WHERE user_id = ?1'),
    guarded('DELETE FROM household_members WHERE user_id = ?1'),
  ]
  if (householdId !== null) {
    // 既存の世帯退出(POST /api/households/leave)と同じく、最後のメンバーなら世帯ごと削除する。
    statements.push(
      db.prepare(`DELETE FROM households WHERE id = ?3 AND NOT EXISTS (SELECT 1 FROM household_members WHERE household_id = ?3) AND ${marked}`)
        .bind(userId, now, householdId),
    )
  }
  // 識別情報を消す。メールアドレスは予約ドメインのため、利用者のアドレスと衝突しない。
  statements.push(
    db.prepare(
      `UPDATE users SET email = 'deleted-' || id || '@${DELETED_EMAIL_DOMAIN}', password_hash = 'deleted', display_name = ?3 WHERE id = ?1 AND deleted_at = ?2`,
    ).bind(userId, now, DELETED_USER_DISPLAY_NAME),
  )
  return statements
}

// 日次処理。申し込みから30日を過ぎたアカウントを削除する。取り消し期間中に未精算などが
// 増えていた場合は、解決するまで削除を保留する(F01_auth.md 8-2章、common-notes.md 12.5)。
// 1件の失敗で他のアカウントの処理が止まらないよう、1件ずつ例外を捕まえる。
export async function purgeExpiredAccounts(db: D1Database, now: Date): Promise<{ purged: number[]; skipped: number[] }> {
  const threshold = new Date(now.getTime() - GRACE_MS).toISOString()
  const { results } = await db
    .prepare(
      `SELECT u.id AS id, m.household_id AS householdId FROM users u LEFT JOIN household_members m ON m.user_id = u.id
       WHERE u.deleted_at IS NULL AND u.deletion_requested_at IS NOT NULL AND u.deletion_requested_at <= ?`,
    )
    .bind(threshold)
    .all<{ id: number; householdId: number | null }>()
  const purged: number[] = []
  const skipped: number[] = []
  for (const { id, householdId } of results) {
    try {
      const [mark] = await db.batch(purgeStatements(db, id, householdId, now.toISOString(), threshold))
      if (mark.meta.changes === 1) {
        purged.push(id)
      } else {
        console.warn('未精算などが残っているため退会処理を保留しました', id)
        skipped.push(id)
      }
    } catch (error) {
      console.error('退会処理に失敗しました', id, error)
      skipped.push(id)
    }
  }
  return { purged, skipped }
}
