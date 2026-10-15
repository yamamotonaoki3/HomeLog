# E2Eテスト（Playwright）

## 実行

事前に以下を実施する。

- `frontend` と `backend-workers` でそれぞれ `npm ci` を実行する。
- `frontend` で `npm run build` を実行する（Wrangler起動・Workersテスト・dry-run共通の事前手順。frontend変更後は再build）。
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

## Workers単独の静的配信（#261）

通常E2E完了後、`e2e/`で `npm test -- --config playwright.static-assets.config.ts` を実行する。
Viteを起動せず8787の実Workersからbuild済みassetsを配信する。同じ専用ローカルD1と前後cleanupを使うため、通常E2Eとの同時実行は禁止。開始前にwrangler/workerd/viteの残存プロセスと使用ポートを確認する。

`static-assets.spec.ts` は1280／390／320px（390／320はタッチ）でログイン・トップ・手順ページの直接アクセス、reload、横はみ出し、JS/CSS/favicon/manifest/SW、同一originの認証・API・health、共有クエリとhashのログイン復帰を検証する。通常contextはSWをblockし、別contextでは登録・制御後のオンラインAPIと共有URLを確認する。
`STATIC_ASSETS_SCREENSHOT_DIR`にリポジトリ外の保存先を指定すると各幅3画面のfullPage画像を保存する。
本番の準備・公開判断は[deployment.md](../docs/deployment.md)参照。

## テストデータ規約

### iPhoneショートカット案内（#223）

`npm test -- tests/recipe-iphone-shortcut.spec.ts --workers=3` で1280／390／320pxの入口・専用ページ・横はみ出し・キーボード遷移・コピー成功と手動コピー・認証／世帯ガードを検証する。表示した接頭辞に複雑なURLをエンコードして連結し、WEBタブ初期値、明示保存、キャンセル、未ログインの失敗・再試行後の復帰も検証する。メタ取得はモックし、保存契約はWorkersの既存テストで担保する。
`RECIPE_IPHONE_SCREENSHOT_DIR` にリポジトリ外のパスを指定すると、各幅で一覧と手順ページのfullPage画像を保存する。

自動テストはiOSショートカット自体の検証ではない。HTTPS公開後、ユーザーがiPhone Safariで案内どおり作成し、共有シートへの表示、URL／Safari Webページ入力、複数URLの先頭選択・空入力終了、エンコードと変数連結、通常／複雑URLの引き継ぎ、登録と未ログイン復帰を確認する。iOSバージョンと実際のアクション名も記録する。

### PCレシピ登録（#222）

`npm test -- tests/recipe-bookmarklet.spec.ts --workers=3` で、1280／390／320pxの案内・共有モーダル、別originの閲覧ページでの生成コード実行、元ページ保持、未ログインから失敗・再試行後の復帰、明示的な保存・キャンセルを検証する。メタ取得APIだけをモックし、URLの保存契約はWorkersテストで担保する。

Chromiumは全specを実行し、Playwright用FirefoxまたはMicrosoft Edgeがインストール済みの場合だけ、それぞれ `bookmarklet-firefox` / `bookmarklet-edge` projectでこのspecを追加実行する。Playwright用Firefoxの別バージョンを既にインストールしている場合は `RECIPE_BOOKMARKLET_FIREFOX_EXECUTABLE` で実行ファイルを指定できる。追加ブラウザのダウンロードは行わない。スクリーンショット保存先は `RECIPE_BOOKMARKLET_SCREENSHOT_DIR` で指定できる（リポジトリ外を指定する）。

実ブックマークバーへのドラッグと設置後のクリックは、ユーザーの最終確認で行う。通常のHTTP(S)ページで試し、実行できないページではWEBタブへのURL貼り付けを使う。

`tests/support/test-data.ts` を使う。

- メール：`e2euser_<label>_<ランダム>@example.com`
- 表示名：`e2euser_` 接頭辞、パスワード：`TestPass123!`
- 登録する本文には `[E2E_TEST]` タグを付ける

## シナリオ

`header-account.spec.ts` は1280／390／320px（390／320はタッチ対応）で、通常名・50文字の日本語名／連続英字名を実登録する。ヘッダーの本人名、1行省略、通知・設定・ログアウトの配置、ページ全体の横はみ出し、再読込・遷移・ユーザー切替、キーボード到達を確認する。`HEADER_ACCOUNT_SCREENSHOT_DIR` にリポジトリ外の保存先を指定すると、各幅・名前のダッシュボード全体とヘッダー画像を保存する。

`auth-me-api.spec.ts` は1280／390／320pxで、実ローカルWorkersへの登録・ログイン・本人取得・refresh後の取得を検証する。世帯未所属のA/Bの識別、返却キー限定、ID指定によるなりすまし不可、未認証／不正トークンの401を確認する。既存ダッシュボードのヘッダー操作表示とページ全体の横はみ出しも検証する（390／320はタッチ対応）。`AUTH_ME_SCREENSHOT_DIR` にリポジトリ外の保存先を指定すると各幅の画面を保存する。本人名のヘッダー表示は後続#257の対象。

`fixed-cost-external-ui.spec.ts` は1280／390／320px（390／320はタッチ対応）で、1人世帯の外部2人登録、世帯内外の混在編集、割合／金額、外部ID保持、名称変更による差し替えと既存マスタ不変、追加・削除・割り勘OFF、キャンセル、再読込後の永続化、他者非公開を実ローカルWorkersで確認する。ページ・モーダル・fieldset・内訳行の横はみ出し、詳細の初期位置・Tab巡回・Escape復帰、フォーム末尾の操作到達も検証する。`FIXED_EXTERNAL_SCREENSHOT_DIR` にリポジトリ外の保存先を指定すると登録（世帯外入力）・編集・詳細とフォーム末尾の画像を保存する。

`events.spec.ts` と `kakeibo-detail.spec.ts` は#246の共通行buttonを1280／390／320pxで検証する（390／320はタッチ対応）。3列と左右の余白、Enter／Space、1行1Tab停止、44px以上の高さ、hover／focus-visible、詳細の巡回と起点復帰、長文と上限金額の横はみ出し、イベントの編集保存後の詳細復帰を確認する。`ISSUE_246_SHOTS_DIR` にリポジトリ外の保存先を指定すると、一覧とイベント・支出・収入詳細、家計簿ダーク設定の画像を保存する。

`income-account-api.spec.ts` は1280／390／320pxで実Workersへの収入POST、口座残高、履歴、ダッシュボード集計、口座論理削除と名前保持・再利用拒否を検証する。長い内容/口座名と上限金額の一覧・詳細・口座一覧・履歴でページ横はみ出しを検査する。`INCOME_ACCOUNT_SCREENSHOT_DIR`でリポジトリ外の画像保存先を指定する。

`income-account-ui.spec.ts` は1280／390／320px（390／320はタッチ対応）で、口座0件の案内、未選択の登録防止、キーボードによる口座選択、UI収入登録、選択口座だけの残高増加と履歴、削除後の詳細名と選択肢除外、長文・上限金額での横はみ出しと操作ボタンへの到達を実ローカルWorkersで検証する。`INCOME_UI_SCREENSHOT_DIR` にリポジトリ外の保存先を指定すると登録・詳細・削除後詳細を撮影する。`kakeibo.spec.ts` も収入をUIで登録する。`addTransaction` に収入の入金先を明示する `accountId` を渡す。表示専用の既存シナリオでは `addIncomeViaApi` を利用できる。

`fixed-cost-detail.spec.ts` は1280／390／320pxで固定費4列の各セル・余白・Enter/Space、詳細のフォーカス巡回と復帰、編集保存／キャンセル・削除確認／キャンセル・登録導線、上限金額と長い名前・口座名の横はみ出しを実ローカルAPIで検証する。390／320pxはタッチ対応。`FIXED_COST_SCREENSHOT_DIR` にリポジトリ外の保存先を指定すると一覧・詳細・編集・削除確認・登録を保存する。

`shopping-detail.spec.ts` は1280／390／320pxで買い物3列の行全域、Enter/Space、詳細のフォーカス巡回と復帰、購入個数の保持・一括反映（実在庫数と自動残留・手動除外）、削除・手動追加・横はみ出しを検証する。390／320pxはタッチ対応コンテキストで実行する。`SHOPPING_SCREENSHOT_DIR` にリポジトリ外の保存先を指定すると一覧・詳細・手動追加の画像を保存する。

`inventory-detail.spec.ts` は1280／390／320pxで在庫3列の行全域、Enter/Space、詳細のTab巡回とフォーカス復帰、編集の保存／キャンセルを検証する。390／320pxはタッチ対応コンテキストで実行する。`INVENTORY_SCREENSHOT_DIR` にリポジトリ外の保存先を指定すると一覧・詳細・編集・登録の画像を保存する。既存の数量・値段E2Eも在庫詳細経由で操作する。

| Tier | ファイル | 内容 |
|---|---|---|
| 1 | `auth.spec.ts` | 登録（確認欄不一致）・ログイン/ログアウト・未ログインリダイレクト |
| 1 | `navigation.spec.ts` | 主要3機能の下部ナビゲーション・家計簿/献立表の関連機能への遷移 |
| 1 | `household.spec.ts` | 世帯作成 → 別ユーザーが招待コードで参加 |
| 1 | `kakeibo.spec.ts` | 支出・収入登録 → 一覧・今月サマリー反映 |
| 2 | `warikan.spec.ts` | A 割り勘登録 → B 支払報告 → A 受領確認で精算済み |
| 2 | `fixed-costs.spec.ts` | 固定費の登録・一覧表示・削除 |
| 2 | `zaiko.spec.ts` | 閾値以下の在庫が買い物リストに載る → 購入で在庫反映・リストから消える |
| 2 | `zaiko-price-ui.spec.ts` | 1280／390／320pxで値段の登録・編集・クリア・手動追加・購入後保持と横幅を実APIで検証。`ZAIKO_SCREENSHOT_DIR` 指定時は両一覧・登録／編集モーダル・手動追加フォームの画像を保存 |
| 2 | `zaiko-price-api.spec.ts` | Workersへの直接HTTP要求で値段の省略互換・上書き・0・null・両一覧の共有・購入後保持・自動再追加を検証。1280／390／320pxの既存画面幅も確認 |
| 3 | `kondate.spec.ts` | レシピ手動登録 → 献立にレシピ・自由メモを追加 |
| 3 | `events.spec.ts` | イベント登録 → 一覧表示 |
| 3 | `accounts.spec.ts` | 口座登録 → 口座指定の支出が残高・取引履歴に反映 |

`zaiko-price-api.spec.ts` の画面画像はPlaywrightのテスト別出力先（`test-results/` 配下）へ保存する。値段の入力・表示UIは後続Issueのため、このspecの画面検証は既存一覧の表示と横幅を対象とする。
