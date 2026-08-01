# 学び・手直しの記録

Codexレビューで採用された指摘や、実装中の手直しのうち、次回以降に活かすべき内容を記録する。記録するタイミング・基準・形式は `lessons-learned` Skill（`~/.claude/skills/lessons-learned/SKILL.md`）に従う。手動で追記する場合も、以下の形式を保つこと。

## 索引

- 2026-07-31: Flywayマイグレーション運用ルール（HomeLogでの適用内容）

## 記録

### 2026-07-31: Flywayマイグレーション運用ルール（HomeLogでの適用内容）

- **種別**: ユーザー指定
- **対象領域・関連ファイル**: backend / `backend/src/main/resources/db/migration/*.sql`（Flywayマイグレーション全般）
- **何が起きたか**: チャージ型カード機能（F-11拡張）のためのマイグレーション（`cards`/`expenses`テーブルへの`ALTER TABLE`）を計画する際、ユーザーから「ALTER TABLEは手動管理にすべきでは」という懸念が出た。過去に、一度適用済みのマイグレーションファイルの内容を後から書き換えたことで、Flywayのchecksum不一致によるトラブルが発生し、手動対応で解消した経験があるとのこと。
- **対応**: Flywayによる自動適用の仕組み自体は維持する（結合テスト・CIがFlywayの自動適用に依存しているため、手動管理に切り替えると再現性が壊れる）。トラブルの実体（checksum mismatch等）と一般的な対処原則は `tech-notes` Skill（`~/.claude/skills/tech-notes/references/flyway.md`）に切り出し、ここにはHomeLog固有の適用内容のみ残す。
- **次回の行動規則**（Flyway一般の原則は`tech-notes` Skillの`references/flyway.md`参照）:
  - 開発中（まだPRを出す前＝リモート・他環境に一度も反映していないマイグレーションファイル）は内容を自由に修正してよい。修正するたびに `docker compose down -v && docker compose up -d` でローカルDBを作り直し、Flywayを最初から再適用させる（このプロジェクトはローカルDocker運用のみのため、作り直しコストはゼロに近い）。
  - `ALTER TABLE`を含むマイグレーションを追加するPRでは、同じ変更の中でEntity・Mapper（XMLのResultMap・INSERT/UPDATE文）・DTOも必ず同時に更新する（HomeLogはMyBatis + XMLマッパー構成のため、CLAUDE.md「MyBatisのSQLは必ずXMLマッパーファイルに書く」との整合も兼ねる）。
- **状態**: 有効
- **根拠**: チャージ型カード機能の実装計画時のユーザーとの会話（Flyway運用に関する懸念への回答、2026-07-31）。2026-08-01にtech-notes Skillを新設し、汎用部分をそちらへ移設。
