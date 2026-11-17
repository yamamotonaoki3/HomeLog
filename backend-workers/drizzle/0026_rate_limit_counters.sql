-- 認証・画像解析のAPIの回数制限(#510)。メールアドレス・接続元・利用者ごとに固定窓で数える。
-- key_hashはSHA-256のハッシュのみを保存し、メールアドレスやIPの実値は残さない。
-- 追加のみ。既存の表と行は変更しない(パスワード再設定の申請回数は password_reset_attempts のまま)。
CREATE TABLE rate_limit_counters (
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (scope, key_hash, window_start)
);
CREATE INDEX idx_rate_limit_counters_window_start ON rate_limit_counters (window_start);
