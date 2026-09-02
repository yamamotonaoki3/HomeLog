-- F-04 割り勘・精算管理の改訂(docs/details/features/F04_kakeibo_warikan.md)。
-- 精算確定時に立替者へ収入・負担者へ支出を自動記録し、選択した口座の残高も増減させるための列を追加する。

-- 立替者が「受け取りました」で選んだ入金先口座(任意)。通常の収入登録では常にNULL。
ALTER TABLE incomes ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;

-- 負担者が「支払った」時点で選んだ支払い元口座(任意)。精算確定(立替者の受領確定)まで内訳行に保持する。
ALTER TABLE expense_splits ADD COLUMN debtor_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;

-- status値のリネーム。承認者が「負担者」から「立替者(受領側)」に変わり、approval_requested の意味が
-- 「負担者が支払った報告を出し、立替者の受領確定を待っている」状態に反転するため。
UPDATE expense_splits SET status = 'payment_reported' WHERE status = 'approval_requested';
