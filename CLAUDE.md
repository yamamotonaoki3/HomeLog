# HomeLog — Claude Code ワークフロールール

本番は TypeScript / Cloudflare Workers 版（`backend-workers/` ＋ `frontend/`）で動いている。Java/Spring Boot 版（`backend/`）は移行元として残しているだけで、新しい機能は追加しない。Codex など他のエージェント向けの同じ内容は [`AGENTS.md`](AGENTS.md) にまとめている。

## Issue・PRの日本語記載

- GitHub IssueとPull Requestのタイトル・本文は、原則として日本語で記載する。本文内の見出し、受け入れ基準、検証結果、レビュー上の説明も日本語にする。
- API名、コード識別子、ファイルパス、コマンド、規格名など、正確さや検索性のために必要な技術用語は英語のまま使用してよい。コードやログの引用も原文を保つ。
- `Closes #123` などGitHubが認識するキーワードは機械処理のため英語のまま残し、その周囲の説明は日本語にする。
- ブランチ名やConventional Commitsの種別など、既定の機械可読形式はこのルールの対象外とする。

## GitHub認証・実行環境の切り分け

- これまで利用できていたGitHubのIssue・PR作成、更新、push、マージなどが突然失敗した場合、認証情報の失効だけでなく、実行中のサンドボックス、ネットワーク制限、Windows資格情報ストアへのアクセス制限も原因候補として確認する。
- GitHub Connector、ローカルの`gh` CLI、Gitの認証情報は別経路として扱う。ある経路の成功または失敗だけで、他の経路の認証状態を断定しない。
- GitHub CLI、Git Credential Manager、Orca、外部API、ブラウザ自動操作など、ネットワーク・資格情報ストア・ローカルIPCに依存する外部ツールは、原則として最初からサンドボックス外で実行する。まず秘密情報を表示しない`gh auth status`と`gh api user --jq .login`などの読み取り専用確認を制限外環境で実行し、認証状態を確認する。
- トークン、パスワード、認可コードは画面出力、ログ、Issue、PR、コミット、チャットへ記録しない。確認結果は有効性、アカウント名、必要な権限の有無だけを報告する。
- 外部ツールを使う認証・接続・起動・書き込み操作には、`external-tool-sandbox` スキルを用いる。外部ツールをサンドボックス内で実行するのは、ユーザーが明示的に求めた場合か、安全なローカル代替を確認する場合に限る。サンドボックス外で実行しても、外部変更はユーザーの明示的な依頼と承認範囲でのみ実行する。

## 絶対に守るルール

1. **作業は必ずイシューから始める**
   - コード変更・機能追加・バグ修正・ドキュメント更新、いかなる作業も GitHub Issue を先に作成する。
   - Issue なしにブランチを切ってはいけない。

2. **main ブランチへの直接プッシュ禁止**
   - `git push origin main` は禁止。GitHub 側でも強制されている。
   - 必ず作業ブランチから PR を作成し、マージで取り込む。

3. **PR はレビュー・動作確認後にマージする**
   - セルフレビューと Codex レビューを行い、CI（backend-quality / frontend-quality / e2e / gitleaks）が通っていることを確認してからマージする。

4. **本番への反映はユーザーの指示があったときだけ**
   - ユーザーが「本番に出して」と言ったときに限り、`production` ブランチへ push する（[`docs/deployment.md`](docs/deployment.md)）。マージしただけでは本番に出さない。

5. **内部設定・周知不要なものはGitHubに上げない**
   - `.claude/`（スキル・エージェント・設定等、Claude Codeの内部動作設定）は `.gitignore` で除外し、リポジトリにコミットしない。
   - 同様に、チーム外への周知が不要な個人環境依存の設定ファイルはコミット対象外とする。
   - テストやレビューの出力ログはリポジトリ内に保存せず、スクラッチ領域など外部のディレクトリに出す（`*.log` は `.gitignore` 済みだが、作業ディレクトリを散らかさないため）。

---

## ブランチ命名規則

```
<prefix>/#<issue番号>-<英語の概要>
```

| プレフィックス | 用途 |
|---|---|
| `feature` | 機能追加 |
| `fix` | 不具合修正 |
| `chore` | リファクタ・設定変更・依存更新 |
| `docs` | ドキュメントのみの変更 |

**例:**
- `feature/#289-menu-recipe-link`
- `fix/#285-youtube-recipe-title`
- `docs/#305-sync-requirements`

---

## 作業フロー（毎回この順番で）

```
0. ドキュメントを必ず読む（プランを立てる前に必ず実施）
     - docs/requirements.md（全体要件定義書）
     - docs/構想.md（全体構想）
     - docs/details/features/F*.md（対象機能の詳細要件定義書）
     - docs/details/common-notes.md（機能横断の共通事項）
     - docs/details/data-model.md（ER図・テーブル定義）
     - docs/details/api-design.md（API設計・エンドポイント一覧）
     - docs/技術スタック.md（技術スタック構成）
     - docs/lessons-learned.md（過去の学び・手直しの記録）
     上記のうち対象機能に関係するファイルを全て確認した上で実装プランを立てる。
     要件にない設計判断が必要なときは、ユーザーに確認する。
1. GitHub で Issue を作成する（バックエンドとフロントエンドは別 Issue）
2. ブランチを切る: git checkout -b feature/#<番号>-<概要>
3. テスト駆動開発（TDD）で実装する
     3-1. 先にテストを書き、red（失敗）になることを確認する
     3-2. テストを green にする最小限の実装を行う
     3-3. リファクタリングする（テストが green のまま保たれることを確認しながら整理する）
4. 品質チェックを実行する（後述「品質チェック」）
     - 今回の変更を検証するテスト・E2E が実在するかを中身で確認し、無ければ追加する
     - バックエンドだけ先にマージする場合は、API 層の E2E で契約の要点を確認する
5. Codex でレビューする（後述「Codex レビュー」）
6. コミット → push → PR 作成（Closes #<番号> を記載）
7. CI が通ったらマージし、ローカルの main を更新する
8. ユーザーにブラウザでの確認を依頼する（開発サーバーの URL を伝える）
9. ユーザーの「本番に出して」で production に push し、本番の反映を確認する
```

**TDDを採用する理由**：先にテストでインプット/アウトプットの形を固めてから実装に入ることで、実装途中で設計ミスや考慮漏れに気づく「手戻り」ではなく、コーディング前の段階でエラーを検出できるようにするため。

---

## 品質チェック

各ディレクトリ全体を対象に実行する（CI も全体を検査する）。

| 対象 | コマンド |
| --- | --- |
| `backend-workers/` | `npm run lint` / `npm run typecheck` / `npm test` |
| `frontend/` | `npm run lint` / `npx tsc -b` / `npx vitest run` / `npm run build` |
| `e2e/` | `npm test -- tests/<spec>`（先に `frontend` をビルドする。8787・5181 番ポートを空けておく） |

- `backend-workers/` のテストとローカル実行には `.dev.vars`（`.dev.vars.example` を参考に作成。値はコミットしない）が必要。
- 画面の変更は E2E で 1280 / 390 / 320px の表示を確認し、必要に応じて画面写真でも確かめる。
- テストの詳細は [`docs/結合テスト.md`](docs/結合テスト.md) を参照。

---

## Codex レビュー

このマシンには Codex CLI が導入されている。Claude Code のセルフレビューに加え、別モデルによる第二の視点として使う。

1. `codex review --uncommitted < /dev/null`（PR 作成後は `--base main`）でレビューする。標準入力を閉じないと入力待ちで止まる。
2. 指摘があれば修正する。Codex に修正させる場合は `codex exec -s workspace-write -C . - < 指示ファイル` で渡す。
3. Codex のサンドボックスでは子プロセスを起動できない（spawn EPERM）ため、テスト・lint・ビルドの最終検証は必ず Claude Code 側で行う。
4. 指摘ゼロになるまで繰り返す。3回を超えたら Claude Code が直接修正し、同様に検証する。
5. データ破損・認証バイパス・情報漏えいなどの重大な指摘は、解消するまでレビューを終えない。

---

## 機能実装の連続実行ルール（バックエンド→フロントエンド）

1つの機能（バックエンド・フロントエンドの2 Issue に分かれるもの）は、事前に合意した計画の範囲内で、次の条件をすべて満たす限り確認を挟まず進めてよい。

```
バックエンドIssue作成 → ブランチ → TDD実装 → 品質チェック・API層E2E → Codexレビュー
  → PR作成 → CI成功でマージ → ローカルmainをpull
  → フロントエンドIssue作成 → ブランチ → 実装 → 品質チェック・E2E（1280/390/320px）
  → Codexレビュー → PR作成 → CI成功でマージ
  → ユーザーに「ブラウザで確認できる状態」であることを報告し、本番反映の指示を待つ
```

### 自動で次工程に進んでよい条件（すべて満たすとき）

- 単体テスト・E2E が全て green である
- lint / typecheck / build がエラーなしである
- Codex レビューの指摘がゼロになっている

### 必ず立ち止まる条件

- 上記チェックのいずれかで解決できない問題が起きたとき（原因調査・対応方針の確認をユーザーに求める）
- ドキュメントと実装の間に矛盾を見つけたとき
- 事前に合意した計画に無い、新たな設計判断が必要になったとき
- 本番への反映（ユーザーの指示が必要）

---

## テスト方針

- **バックエンド**：Vitest ＋ `@cloudflare/vitest-pool-workers`。miniflare 上の本物の D1 にマイグレーションを適用し、Hono アプリへ HTTP リクエストを送って検証する（`backend-workers/src/test/`）。
- **フロントエンド**：Vitest ＋ jsdom ＋ Testing Library。API は msw で差し替える（`frontend/src/test/`）。
- **E2E**：Playwright。ローカルの Workers と Vite を起動し、画面操作と API を通しで確認する（`e2e/tests/`）。spec は `e2e/tests/console-guard.ts` の `test` を使い、最初に `consoleGuard.watch(page)` を呼ぶ。
- **テストケース設計の基本**：ブラックボックス（同値分割・境界値分析）とホワイトボックス（主要な分岐網羅）の両観点で設計する。並行操作の対策は、対策を外すとテストが失敗することまで確認する。

---

## 学び・手直しの記録

Codexレビューで採用された指摘や、実装中の手直しは `docs/lessons-learned.md` に記録する。記録のタイミング・基準・形式は `lessons-learned` Skill（詳細ルールの正本）に従う。

---

## コミット・PR の規則

- コミットメッセージ・PR は日本語で書き、先頭の種別だけ英語にする（`feat(frontend):` `fix(backend):` `docs:` `chore:` など）。
- PR 本文は「概要 / 変更内容 / 担当 / 確認 / `Closes #N`」の構成にする。

```
feat(frontend): 献立表のレシピタイトルから元ページ・レシピ詳細を開けるようにする (#289)
fix(backend): YouTube の URL は oEmbed から動画タイトルを取得する (#285)
docs: 要件定義書を現在の実装に合わせて更新する (#305)
```

---

## バックエンド構成（`backend-workers/`）

```
backend-workers/
├── src/
│   ├── index.ts        … Hono アプリ・ルーティング・Cron（scheduled）
│   ├── routes/         … 機能ごとの API（auth, household, expenses, expense-splits, recipes …）
│   ├── lib/            … 共通処理（固定費の自動計上、退会処理、精算、残高補正、OCR など）
│   ├── middleware/     … 認証（requireAuth）
│   ├── db/schema.ts    … drizzle のスキーマ定義
│   └── test/           … routes / lib / middleware ごとのテスト
├── drizzle/            … D1 マイグレーション（NNNN_*.sql）
└── wrangler.toml       … バインディング（D1・R2・AI）・Cron・静的アセット
```

- 入力は zod で検証し、エラーは `lib/errors.ts` の `errorResponse` で共通形式にする。他人・他世帯のリソースは 404 で返す。
- 残高の増減や複数テーブルの更新は D1 の `batch` にまとめ、途中で失敗しても中途半端な状態を残さない。並行操作は条件付き更新（更新行数の確認）で防ぐ。
- マイグレーションは連番で追加し、PR で共有したファイルは編集しない（修正は新しい番号で行う）。

---

## 技術スタック

| 役割 | 技術 |
| --- | --- |
| フロントエンド | React 19 + TypeScript 6 / Vite 8 / React Router 7 / axios / vite-plugin-pwa |
| Lint(FE) | oxlint |
| テスト(FE) | Vitest + Testing Library + msw |
| バックエンド | Cloudflare Workers / Hono 4 / TypeScript / zod |
| データベース | Cloudflare D1（SQLite 互換）/ drizzle-orm |
| ファイル・AI | Cloudflare R2 / Workers AI / Google Cloud Vision |
| 認証 | 自前 JWT（アクセストークン）＋ リフレッシュトークン（D1）、PBKDF2 |
| Lint(BE) | ESLint + typescript-eslint |
| テスト(BE) | Vitest + `@cloudflare/vitest-pool-workers` |
| E2E | Playwright |
| デプロイ | Cloudflare Workers Builds（`production` ブランチ） |

詳細は `docs/技術スタック.md` を参照。

## アプリ起動手順

```bash
# 1. API（backend-workers/ で。http://localhost:8787）
npx wrangler d1 migrations apply DB --local
npx wrangler dev --local --port 8787

# 2. 画面（frontend/ で。http://localhost:5181、スマホからは PC の IP アドレス:5181）
VITE_API_PROXY_TARGET=http://localhost:8787 npx vite --port 5181 --strictPort --host 0.0.0.0
```

`.claude/skills/run-dev` スキルを使うと上記手順を自動実行できる。
