-- 退会(アカウント削除)の申し込み日時と、削除完了日時(#297、F01_auth.md 8-2章)。
-- deletion_requested_at が入っている間はログイン・通常APIを拒否し、30日後の日次処理で削除する。
-- 削除完了後のユーザー行は識別情報を消した退会済み行として残し、deleted_at を記録する。
ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
ALTER TABLE users ADD COLUMN deleted_at TEXT;
