# HomeLog — エージェント作業ルール

このファイルは、`CLAUDE.md` の開発・運用ルールを、Codexを含む作業エージェント向けに同期したものです。機能仕様・データモデルは次のドキュメントを正とします。

- 全体要件定義書: [`docs/requirements.md`](docs/requirements.md)
- 全体構想: [`docs/構想.md`](docs/構想.md)
- 機能別詳細要件定義書: `docs/details/features/F*.md`
- 機能横断の共通事項: [`docs/details/common-notes.md`](docs/details/common-notes.md)
- ER図・テーブル定義: [`docs/details/data-model.md`](docs/details/data-model.md)
- 画面・API: [`docs/details/wireframes.md`](docs/details/wireframes.md)、[`docs/details/api-design.md`](docs/details/api-design.md)
- 技術スタック: [`docs/技術スタック.md`](docs/技術スタック.md)
- Java版からの移行で見つかった食い違い（すべて対応済み）: [`docs/TypeScript移行時の要確認事項.md`](docs/TypeScript移行時の要確認事項.md)
- 過去の学び・手直し: [`docs/lessons-learned.md`](docs/lessons-learned.md)

## 現在の実装対象

バックエンドは Java/Spring Boot（`backend/`）から TypeScript/Cloudflare Workers（`backend-workers/`）へ移行済みで、本番は Workers 版で動いている。新しい機能は `backend-workers/` に実装する。`backend/` は移行元として残しているだけで、新機能を追加しない。

| 領域 | ディレクトリ | 主な技術 |
| --- | --- | --- |
| バックエンド | `backend-workers/` | TypeScript / Hono / Cloudflare D1 / Drizzle / zod / Vitest（`@cloudflare/vitest-pool-workers`） |
| フロントエンド | `frontend/` | React / TypeScript / Vite / Vitest + Testing Library / oxlint |
| E2E | `e2e/` | Playwright（ローカルの `wrangler dev` と Vite を起動して実行） |

- D1のマイグレーションは `backend-workers/drizzle/NNNN_*.sql` に連番で追加する。PRで共有したマイグレーションファイルは編集せず、修正は新しい番号のファイルで行う。
- 実装とドキュメントが食い違っている場合は、その場で直さずユーザーへ判断を求める（移行は完了したため、`docs/TypeScript移行時の要確認事項.md` への追記は不要）。

## 必須の開発フロー

すべてのコード変更・機能追加・バグ修正・ドキュメント更新は、次の順で進める。

1. 対象機能に関係する上記ドキュメントを読み、実装プランを立てる。
2. GitHub Issueを作成する。Issueなしにブランチを切らない。
3. Issue番号を含む専用ブランチを作成する。
4. テスト駆動開発（TDD）で実装する。先にテストを書いてredを確認し、最小限の実装でgreenにしてからリファクタリングする。
5. 品質チェックを実行する（後述）。
6. ユーザーによる動作確認が必要な工程では、そこで止まって確認を待つ。
7. ユーザーからコミット指示を受けたら、コミット後に同じブランチをpushする。
8. PRを作成する（`Closes #<番号>` を記載）。
9. Codexでレビューし、指摘ゼロになるまで修正を繰り返す（後述）。
10. セルフレビュー後、CI成功を確認してマージする。
11. マージ後、対応するローカル作業ブランチを削除する。
12. 本番への反映は、ユーザーが「本番に出して」と指示したときだけ `production` ブランチへ push して行う（[`docs/deployment.md`](docs/deployment.md)）。マージしただけでは本番に出さない。

`main` への直接pushは禁止する（GitHub側でも強制）。必ず作業ブランチとPRを経由する。

## ブランチ・コミット

ブランチ名は次の形式にする。

```text
<prefix>/#<issue番号>-<英語の概要>
```

| prefix | 用途 |
| --- | --- |
| `feature` | 機能追加 |
| `fix` | 不具合修正 |
| `chore` | リファクタ・設定変更・依存更新 |
| `docs` | ドキュメントのみの変更 |

コミットメッセージは `<種別>: <変更内容の要約>` の形式とし、日本語の要約を使ってよい。

```text
feat: 在庫アイテム登録機能を追加
fix: 割り勘精算時の端数計算を修正
docs: 要件定義書を追加
```

## 品質チェック

一部のファイルだけでなく、各ディレクトリ全体を対象に実行する（CIも全体を検査する）。

| 対象 | コマンド |
| --- | --- |
| `backend-workers/` | `npm run lint` / `npm run typecheck` / `npm test` |
| `frontend/` | `npm run lint` / `npm test` / `npm run build`（`tsc -b` を含む） |
| `e2e/` | `npm test`（実行後に後始末スクリプトも走る。単発実行は `npx playwright test <spec>`） |

- `backend-workers/` のテストとローカル実行には `JWT_SECRET` を記載した `.dev.vars` が必要。`.dev.vars.example` を参考に各自作成し、値はコミット・出力しない。
- テストが通ったことと、そのテストが今回の変更を検証していることは別である。今回の変更（新しいエンドポイント、画面のラベル等）を検証するテスト・E2Eが実在するかを中身で確認し、無ければ追加する。追加できない場合は理由と代替の担保を報告する。
- バックエンドだけを先に実装する場合は、実行中のWorkers APIを直接呼ぶAPI層のE2E（例: `e2e/tests/user-settings-api.spec.ts`、`e2e/tests/dashboard-summary-api.spec.ts`）で契約の要点を検証する。境界値や認可の網羅は `backend-workers/` のテストが担当する。

### Web E2E のコンソール監視

specは `@playwright/test` ではなく `e2e/tests/console-guard.ts` の `test` / `expect` を import し、最初の操作の前に `consoleGuard.watch(page)` を呼ぶ。console error と未捕捉例外はテスト失敗になる。テストが意図して起こす異常系だけ、そのテストの中でURLとメッセージを絞って `consoleGuard.allow(...)` で許可する。

## テストデータ・秘密情報

- README 用の GIF（`e2e/tests/readme-gifs.spec.ts`）は、読みやすさのため本文に `[E2E_TEST]` タグを付けない架空のデモデータを使う（ユーザー確認済み）。録画用の D1 は実行ごとに作り直して削除される。

- テストデータは架空のものだけを使う。メールアドレスは `@example.com` 等の予約ドメイン、ユーザー名は `testuser_` / `e2euser_` などの接頭辞、本文には `[E2E_TEST]` などのタグを付ける。
- テストは本番・ステージングへ接続しない。E2Eは専用のローカルD1保存先を使う。
- 実値を持つ `.env*` / `.dev.vars`、認証情報、トークン、APIキーを、コミットされるファイル・コミットメッセージ・Issue・PR・チャットに書かない。コミットするファイルには環境変数参照やプレースホルダだけを書く。
- `.claude/` などエージェント固有の内部設定や、個人環境だけに必要な設定はコミットしない。
- 作業対象外のファイルに秘密情報のハードコードを見つけた場合は、無断で修正せず別Issueとしてユーザーに提示する。

## 設計・実装の判断

- 要件にない新しい技術・依存パッケージ・構成が必要な場合は、独断で決めずにユーザーへ確認する。
- 1つの機能はバックエンドとフロントエンドのIssueに分け、フロントエンドは対応するバックエンドがマージされAPI契約を確認できてから着手する。
- Issueは単独でレビュー・マージできる最小単位にする。
- ドキュメントと実装が矛盾する場合、または合意済みの計画にない設計判断が必要な場合は、実装を進めずユーザーへ判断を求める。

## レビュー・記録

- PR作成後、`codex review --base main`（コミット前なら `--uncommitted`）でレビューする。標準入力を閉じて実行する。出力をファイルに保存する場合は、リポジトリ外（スクラッチ領域など）に出し、リポジトリ直下にログを残さない。
- 指摘があれば、指摘内容と対象ファイルを踏まえた具体的な修正指示を添えて `codex exec "<修正指示>"` で修正し、ビルド・テストの最終検証は修正を依頼した側が行う。指摘ゼロになるまで繰り返す。
- 同種の指摘が繰り返されて収穫逓減になった場合は、修正を続けずにユーザーへ「現状で受容するか、さらに修正するか」を確認する。
- データ破損・認証バイパス・情報漏えいなどの重大な指摘は、解消するまでレビューを終えない。
- レビューで採用された指摘や実装中の手直しは、必要に応じて [`docs/lessons-learned.md`](docs/lessons-learned.md) に記録する。

## 機能実装の自動連続実行（バックエンド→フロントエンド）

事前に合意した計画の範囲内で、次の条件をすべて満たす限り、確認を挟まず次工程へ進んでよい。

- テスト（バックエンドはAPI層E2Eを含む）がすべてgreen
- lint / typecheck / build がエラーなし
- Codexレビューの指摘がゼロ

バックエンドのPRは上記を満たし CI が通れば自動でマージし、続けてフロントエンドに着手してよい。フロントエンドも E2E（1280 / 390 / 320px）で実機の表示を確認し、上記を満たし CI が通ればマージしてよい。マージ後はユーザーにブラウザでの確認を依頼し、**本番への反映はユーザーの指示を待つ**。

次の場合は必ず立ち止まり、ユーザーへ判断を求める。

- 品質チェックのいずれかで解決できない問題が起きたとき
- フロントエンドの実装が完了し、ブラウザで確認できる状態に到達したとき（本番反映の指示を待つ）
- ドキュメントと実装の矛盾を見つけたとき
- 合意済みの計画にない新たな設計判断が必要になったとき

## 参照先

- 開発背景・詳細ルール: [`CLAUDE.md`](CLAUDE.md)
- 要件・受け入れ基準: [`docs/requirements.md`](docs/requirements.md)、`docs/details/`
- E2Eの実行方法: [`e2e/README.md`](e2e/README.md)
- 学び・過去の手直し: [`docs/lessons-learned.md`](docs/lessons-learned.md)
