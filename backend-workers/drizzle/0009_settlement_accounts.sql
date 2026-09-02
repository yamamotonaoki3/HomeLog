-- F-04 割り勘・精算管理の改訂(docs/details/features/F04_kakeibo_warikan.md)。
-- 精算確定時に立替者へ収入・負担者へ支出を自動記録し、選択した口座の残高も増減させるための列を追加する。

-- 立替者が「受け取りました」で選んだ入金先口座(任意)。通常の収入登録では常にNULL。
ALTER TABLE incomes ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;

-- 負担者が「支払った」時点で選んだ支払い元口座(任意)。精算確定(立替者の受領確定)まで内訳行に保持する。
ALTER TABLE expense_splits ADD COLUMN debtor_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;

-- 旧フローの中間状態を新フローへ移す。旧 approval_requested は「立替者が受領申請を出し、負担者の承認待ち」
-- という意味で、負担者が実際に支払った証拠にはならない。新フローでそのまま payment_reported に変換すると
-- 立替者が負担者の操作なしに confirm-receipt で精算(＝家計簿記録)できてしまうため、負担者の mark-paid を
-- 改めて要求する requested に戻す。
UPDATE expense_splits SET status = 'requested' WHERE status = 'approval_requested';
