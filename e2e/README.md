# E2Eテスト（Playwright）

## 実行

事前に以下を実施する。

- `frontend` と `backend-workers` でそれぞれ `npm ci` を実行する。
- `backend-workers/.dev.vars.example` を `backend-workers/.dev.vars` にコピーし、`JWT_SECRET` を設定する（実値はリポジトリに保存しない）。

```bash
cd e2e
npm ci
npx playwright install chromium   # 初回のみ
npm test
```

`npm test` は `scripts/run-e2e.mjs` を通じて以下を自動で行う。Playwright が失敗した場合も、`finally` で E2E 専用DBを削除してから Playwright と同じ終了コードで終了する。

1. `scripts/cleanup.mjs` で E2E 専用ローカルDB（`backend-workers/.wrangler/e2e-state`）を削除
2. backend-workers をそのDBへマイグレーション適用して `wrangler dev`（8787）で起動
3. frontend を `VITE_API_PROXY_TARGET=http://localhost:8787` で起動（5173）
4. Playwright の成否にかかわらず、テスト実行後に再び E2E 専用DBを削除（残数0を確認）

Playwright の引数はそのまま渡せる。

```bash
npm test -- tests/zaiko.spec.ts
```

- 接続先は常にローカル。開発用DB（`.wrangler/state`）や本番DBには触れない
- 8787 / 5173 で既にサーバーが起動していると失敗する（既存サーバーは再利用しない）ので、先に停止しておく

## テストデータ規約

`tests/support/test-data.ts` を使う。

- メール：`e2euser_<label>_<ランダム>@example.com`
- 表示名：`e2euser_` 接頭辞、パスワード：`TestPass123!`
- 登録する本文には `[E2E_TEST]` タグを付ける

## シナリオ

| Tier | ファイル | 内容 |
|---|---|---|
| 1 | `auth.spec.ts` | 登録（確認欄不一致）・ログイン/ログアウト・未ログインリダイレクト |
| 1 | `household.spec.ts` | 世帯作成 → 別ユーザーが招待コードで参加 |
| 1 | `kakeibo.spec.ts` | 支出・収入登録 → 一覧・今月サマリー反映 |
| 2 | `warikan.spec.ts` | A 割り勘登録 → B 支払報告 → A 受領確認で精算済み |
| 2 | `fixed-costs.spec.ts` | 固定費の登録・一覧表示・削除 |
| 2 | `zaiko.spec.ts` | 閾値以下の在庫が買い物リストに載る → 購入で在庫反映・リストから消える |
| 3 | `kondate.spec.ts` | レシピ手動登録 → 献立にレシピ・自由メモを追加 |
| 3 | `events.spec.ts` | イベント登録 → 一覧表示 |
| 3 | `accounts.spec.ts` | 口座登録 → 口座指定の支出が残高・取引履歴に反映 |
