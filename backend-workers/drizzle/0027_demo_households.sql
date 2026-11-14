-- デモ環境(2アカウント切り替え)用の表(#532)。本番では空のまま使われない。
-- 外部キーは付けない。期限切れのデモを削除する batch で、この表を「消す対象の目印」として
-- 最後まで使い、親(households・users)より後に消すため。値として同じIDを持つという意味で参照する。
CREATE TABLE demo_households (
  household_id INTEGER PRIMARY KEY,
  primary_user_id INTEGER NOT NULL,
  partner_user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX demo_households_expires_at_idx ON demo_households (expires_at);
