-- F-06 イベント管理(docs/details/features/F06_kakeibo_event.md)。
-- data-model.mdのeventsテーブル定義にはowner_user_id列のみが記載されているが、
-- common-notes.md 2章「固定費・イベントは世帯共有でも編集・削除は登録者のみ」というルールを
-- 実現するには、公開範囲を表すowner_user_id(NULL=世帯共有)とは別に、常に登録者を保持する
-- created_by_user_idが必要(fixed_costsで確立済みのパターンをそのまま適用する)。

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  -- NULL = 世帯共有、非NULL = 個人所有(登録者)。個人所有の場合はcreated_by_user_idと同値になる。
  owner_user_id INTEGER REFERENCES users(id),
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  is_all_day INTEGER NOT NULL DEFAULT 1,
  start_time TEXT,
  end_time TEXT,
  recurrence_type TEXT NOT NULL DEFAULT 'none',
  notify_enabled INTEGER NOT NULL DEFAULT 0,
  default_amount INTEGER,
  show_on_dashboard INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX idx_events_household_id ON events(household_id);
CREATE INDEX idx_events_owner_user_id ON events(owner_user_id);

-- 支出とイベントの紐付け(F06ドキュメント「支出とイベントの紐付け」参照)。
-- fixed_cost_idと同様、イベント削除時は支出記録自体は残しevent_idのみNULLにする。
ALTER TABLE expenses ADD COLUMN event_id INTEGER REFERENCES events(id) ON DELETE SET NULL;
CREATE INDEX idx_expenses_event_id ON expenses(event_id);
