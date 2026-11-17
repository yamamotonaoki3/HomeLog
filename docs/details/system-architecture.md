# システム構成図

[← 要件定義書に戻る](../requirements.md)

技術スタックの詳細は [技術スタック.md](../技術スタック.md)、デプロイ手順は [deployment.md](../deployment.md) を参照。

---

## 1. 構成図（Cloudflare Workers 版）

```mermaid
flowchart TB
    User(["ユーザー（PC・スマホのブラウザ / PWA）"])

    subgraph CF["Cloudflare"]
        Worker["Worker（Hono）\n/api/* と /health を処理"]
        Assets["Static Assets\nfrontend/dist（React SPA）"]
        D1[("D1\n（SQLite 互換 DB）")]
        R2[("R2\n手書きレシピ画像の一時保存")]
        AI["Workers AI\n（LLM でレシピを構造化）"]
        Cron["Cron Trigger\n毎日 JST 0:00・1:00"]
    end

    Vision["Google Cloud Vision\n（手書き文字の認識）"]
    Web["外部のレシピサイト / YouTube oEmbed"]

    User -- HTTPS --> Worker
    User -- HTTPS（画面） --> Assets
    Worker --> D1
    Worker --> R2
    Worker --> AI
    Worker -- 画像の文字認識 --> Vision
    Worker -- タイトル・サムネイル取得 --> Web
    Cron -- 献立の持ち越し・過去週の削除・在庫の自動消費・固定費の自動計上など --> Worker
```

- 画面（SPA）と API は同じ Worker・同じオリジンから配信する。`/api` と `/health` は Worker の処理を先に通し、それ以外のパスは `index.html` に戻す（SPA フォールバック）。
- デプロイは `production` ブランチへの push を契機に Cloudflare Workers Builds が行う（マイグレーション適用 → デプロイ）。
- JST 0:00は連携献立の残り予定を持ち越し、成功した場合に過去週の献立を削除する。持ち越しに失敗した回は過去週を保持する。JST 1:00は同じ順序で再試行し、在庫の日次自動消費、固定費の自動計上、古いOCR画像、退会期限を過ぎたアカウント、保持期間を過ぎた回数制限データの削除も行う。デモ環境は別のWorker・D1を使い、毎時のCronで期限切れのデモ世帯を削除する（[deployment.md](../deployment.md)の「デモ環境」）。

## 2. 開発環境

| 役割 | 起動方法 |
| --- | --- |
| API | `frontend/` をビルドし、`backend-workers/` でローカル D1 にマイグレーションを適用して `npx wrangler dev --local --port 8787` を実行 |
| 画面 | `frontend/` で `VITE_API_PROXY_TARGET` を `http://localhost:8787` に設定して `npx vite --port 5181 --strictPort` を実行 |
| E2E | `e2e/` で `npm test`（専用のローカル D1 を使用し、Workers と Vite を自動起動） |

Bash・Windows PowerShell のコマンドは [README のローカル起動手順](../../README.md#ローカルで動かす)、E2E の準備は [e2e/README.md](../../e2e/README.md#実行) を参照。

## 3. 運用フェーズによる構成の違い

| フェーズ | 構成 |
| --- | --- |
| 初期（家族利用） | Cloudflare の無料枠で運用 |
| 利用拡大後 | D1 の容量・同時実行、Workers の実行時間制限を踏まえて再設計（詳細は今後） |
