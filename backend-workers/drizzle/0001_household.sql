-- 既存Java実装のFlyway V1(households/household_members)+V2(CASCADE化)相当。

CREATE TABLE households (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);

-- MVPでは1ユーザー1世帯のみ所属可能なため、user_idにUNIQUE制約を付与する。
-- household_id はhousehold退出時のCASCADE削除に備えてON DELETE CASCADEとする
-- (アプリケーション層では退出時にhousehold_membersを先に削除するため実際には発火しない想定だが、
-- 既存Java実装のV2マイグレーションと同じ安全策として付与する)。
CREATE TABLE household_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  joined_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX idx_household_members_household_id ON household_members(household_id);
