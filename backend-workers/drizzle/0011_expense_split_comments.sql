-- F-04 割り勘・精算のコメント機能（docs/details/features/F04_kakeibo_warikan.md 4章「コメント（立替者・負担者）」）。
-- 負担者が「保留」にした際の連絡手段として主に使うが、status を問わずいつでも閲覧・投稿できる
-- (精算後も履歴として残す)。投稿できるのはその内訳の立替者・負担者本人のみ(app利用者のみ、
-- 世帯外の負担者はログインできないため投稿不可)。

CREATE TABLE expense_split_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_split_id INTEGER NOT NULL REFERENCES expense_splits(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX idx_expense_split_comments_split_id ON expense_split_comments(expense_split_id, id);
