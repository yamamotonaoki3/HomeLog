-- パスワード再設定の申請回数制限(#401)。メール・接続元・アプリ全体を固定窓で数える。
-- key_hashはSHA-256のハッシュのみを保存し、メールアドレスやIPの実値は残さない。
CREATE TABLE password_reset_attempts (
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (scope, key_hash, window_start)
);
CREATE INDEX idx_password_reset_attempts_window_start ON password_reset_attempts (window_start);
