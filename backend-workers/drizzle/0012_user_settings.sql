CREATE TABLE user_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  dashboard_settings TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);
