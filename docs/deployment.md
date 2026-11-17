# Cloudflare Workersへの配信手順（#261）

WorkersがReactのビルド成果物とAPIを同一originで配信する。画面の直接アクセスはSPAへ、`/api`・`/api/*`・`/health` はHonoへ渡す。既存のfetchとscheduled処理は維持する。画面・API・DBの仕様変更はない。

本番は https://homelog-backend-workers.nyproducts.workers.dev で公開済み。以降の公開は「本番の自動デプロイ（Workers Builds・#267）」の手順で行う。技術スタック等の資料全体の刷新は対象外。

## ローカル検証・CIの前提

Node.js 24.22.1（LTS）と各ディレクトリの依存導入（`npm ci`）が必要。開発・GitHub Actionsはルートの[.node-version](../.node-version)、Cloudflare Workers Buildsはビルドルートにある[backend-workers/.node-version](../backend-workers/.node-version)で同じバージョンを指定する。各 `package.json` の `engines.node` は `>=24.22.1 <25`。`backend-workers/.dev.vars.example`を参考にローカル専用の`.dev.vars`へJWT_SECRETを設定する。値を出力・コミットしない。

### Node.jsの導入・更新

Windowsでnvm-windowsを利用している場合は、リポジトリのルートで次を実行する。nvmの保存先が `C:\Program Files\nvm` の場合は管理者権限が必要。

```powershell
$nodeVersion = (Get-Content .node-version -Raw).Trim()
nvm install $nodeVersion 64
nvm use $nodeVersion 64
node --version
npm --version
```

切り替え後は実行中のVite・Wrangler等を再起動し、`frontend/`・`backend-workers/`・`e2e/` それぞれで `npm ci` と本資料・[E2E手順](../e2e/README.md)の品質チェックを実行する。旧Node.jsは検証が終わるまで残す。nvm-windowsではバージョンごとにグローバルCLIが分かれるため、切り替え前に `npm ls -g --depth=0` で記録し、必要なCLIを元と同じバージョン・導入元で引き継ぐ。アプリの依存は各 `package-lock.json` で管理し、Node.jsの更新だけを理由に依存バージョンを変えない。

今後Node.jsを更新する際は、2つの `.node-version` と3つの `package.json` / `package-lock.json` の `engines.node`、本資料のバージョンを揃え、同じバージョンで検証する。CIの `actions/setup-node` はルートの `.node-version` を読み込む。

Cloudflare側にビルド変数 `NODE_VERSION` を設定している場合は、ファイル指定と食い違わないよう同じ値へ更新するか、変数指定を外してファイルに統一する。設定は **Buildsのビルド変数**であり、`wrangler.toml` の実行時 `vars` やWorkerのsecretには追加しない。次回のproductionビルドのログで使用されたNode.jsバージョンを確認する。[公式のビルドイメージ設定](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)参照。

この指定は開発・テスト・ビルド用のNode.jsを揃えるもの。本番APIはCloudflare Workersのランタイムで実行されるため、Node.jsの更新と `compatibility_date` / `nodejs_compat` の変更は別に扱う。設定ファイルを変更しただけでは本番を再デプロイしない。

Wrangler起動・Workersテスト・dry-run・E2Eより前に、必ず`frontend/`で`npm run build`を実行する。Reactを変更した際も再buildする。通常開発のViteと通常E2Eは引き続き別サーバー構成。

```sh
# リポジトリルート
cd frontend
npm ci
npm run build
cd ../backend-workers
npm ci
npm run lint
npm run typecheck
npm test
npm run deploy:dry-run
```

dry-runはローカルのbundle・assets構成を検証するもので、D1/R2の実在、権限、secret登録済みか、公開環境の動作までは保証しない。E2Eの専用DB・後始末と静的配信テストは[e2e/README.md](../e2e/README.md)参照。

## 初回公開の手順（実施済み・環境を作り直す場合の参考）

以下は`backend-workers/`で行う。Cloudflareアカウント、Workers/D1/R2の利用権限と必要な課金設定を準備する。実行先アカウントを確認する。

1. `npx wrangler login`で認証する。
2. ダッシュボードまたは`npx wrangler d1 create homelog-db`でD1を作成する。
3. `wrangler.toml`の`database_id`が作成済みD1のIDになっていることを確認する（#263で設定済み。別環境に作り直した場合は置き換える）。D1 IDは秘密鍵ではない。対象DBを必ず確認する。
4. `npx wrangler d1 migrations apply homelog-db --remote`で本番DBへ既存マイグレーションを適用する。
5. `npx wrangler r2 bucket create homelog-recipe-images`で画像用R2を準備する。
6. `npx wrangler secret put JWT_SECRET`へ十分な強度の本番鍵を対話入力する。コマンド引数・vars・Issue・ログへ実鍵を書かない。`.dev.vars`はローカル専用で、本番secret登録の代わりにはならない。
7. `frontend/`で`npm ci`と`npm run build`を実行する。
8. `backend-workers/`へ戻り`npm run deploy:dry-run`を実行する。
9. 公開判断後に`npm run deploy`を実行する。

注意: `wrangler secret put`は既存Workerでも新バージョンを即時デプロイする。初回Worker未作成時はWranglerがWorker作成を提案するため、作成確認も外部操作として扱う。公開準備の単なるローカル検証として実行しない。初回はsecret操作より前にもfrontend buildを済ませる。作成・配信対象のWorker名は`homelog-backend-workers`。

Cronも公開対象となる。UTC毎日15:00（JST翌00:00）は、対象の連携献立を今週に持ち越し（#547）、成功した場合に先週以前の献立登録を物理削除する（#362）。持ち越しに失敗した回は旧週の献立を保持し、UTC毎日16:00（JST翌01:00）の処理でも同じ順序で再試行する。01:00には固定費計上（今月の支払日を過ぎた未計上分の回収を含む、#396）、在庫の日次自動消費、OCR一時画像・退会期限を過ぎたアカウント・保持期間を過ぎた回数制限データの削除も行う。

**本番反映後は、献立の定期処理が成功した回に全世帯の先週以前の献立登録が物理削除される。** 今週と未来の献立・元のレシピは残る。削除した献立の復元機能はない。Cronの実行時刻は遅れる場合があり、実行時点のJSTの週を基準に持ち越しと削除を行う。公開先D1/R2と自動処理開始・既存データへの影響を確認し、ユーザーから本番反映の指示を受けてから実行する。

**パスワード再設定メール（#401）**はGASのMailApp経由。`PASSWORD_RESET_MAIL_ENABLED`は初期値`"false"`（停止）で、停止中・secret未設定のあいだ申請APIは利用不可（503）を返す。`APP_PASSWORD_RESET_LOG_TOKEN_ENABLED`は本番で必ず`false`とし、生トークンを出力しない。GAS公開・送信用Googleアカウントの認可・`PASSWORD_RESET_GAS_URL`/`PASSWORD_RESET_GAS_SECRET`のsecret登録・有効化の手順は[password-reset-gas-setup.md](details/password-reset-gas-setup.md)を参照する（実値はコミット・チャット・Issueに書かない）。D1マイグレーション0023（`password_reset_attempts`）を含む未適用マイグレーションは、Workers Buildsのデプロイコマンドが配信前に適用する。`npm run deploy`単独ではマイグレーションは適用しないため、手動公開時は先に`npx wrangler d1 migrations apply DB --remote`を実行する。

**固定費の取りこぼし回収（#396）**: マイグレーション0024が`fixed_costs.effective_from`を追加し、既存の固定費は**適用日（JST）**を有効開始日にする。適用日以前の支払日は回収せず、以降の支払日から今月分の取りこぼしを回収する。反映後の最初のCron（JST翌01:00）から有効になる。反映後に`wrangler d1 execute homelog-db --remote`の読み取り専用クエリで`effective_from`が全行に入っていることを確認する。

OCRには既存の`GOOGLE_VISION_API_KEY`のsecret設定（同じ対話入力方式）とGoogle Vision側の利用準備、およびWorkers AIの利用準備が別途必要。ローカルE2Eではリモートバインディングを無効にする。

<a id="デモ環境"></a>

## デモ環境（#529）

README から誰でも試せるデモ環境。本番とは別の Worker・D1 で動かし、プログラムと画面は本番と同じビルドを使う。設計は [2026-11-14-demo-environment-design.md](superpowers/specs/2026-11-14-demo-environment-design.md)、API は [api-design.md](details/api-design.md) の「デモ環境」を参照。

### 構成

| 項目 | 本番 | デモ |
| --- | --- | --- |
| Worker | `homelog-backend-workers` | `homelog-demo` |
| URL | `https://homelog-backend-workers.nyproducts.workers.dev` | `https://homelog-demo.nyproducts.workers.dev`（入口は `/demo`） |
| D1 | `homelog-db` | `homelog-demo-db`（本番とは別） |
| R2・Workers AI・Google Vision | あり | つながない |
| メール | — | 送らない（`PASSWORD_RESET_MAIL_ENABLED = "false"`） |
| `DEMO_MODE` | 未設定 | `"true"` |
| `JWT_SECRET` | 本番の値 | 本番と別の値（デモの Worker にだけ登録） |
| Cron | `0 15 * * *`・`0 16 * * *` | 同じ2本 ＋ `0 * * * *`（期限切れのデモの削除） |
| 自動デプロイ（Workers Builds） | `production` ブランチ | つないでいない（手元から公開する） |

設定は `backend-workers/wrangler.toml` の `[env.demo]`。`vars`・D1・Cron は名前付き環境に引き継がれないため、デモ側に書き直している。`DEMO_MODE` が `"true"` のときだけ `/api/demo/start` などのデモ用の動作、止める機能、期限切れの判定が働く。本番では `/api/demo/start` と `/api/demo/switch` は 404 を返す。

### 公開・更新の手順

本番と同じタイミング（ユーザーの「本番に出して」）で更新する。デモ専用の D1 に対してマイグレーションを適用してから公開する。

```sh
cd frontend && npm run build
cd ../backend-workers
npx wrangler d1 migrations apply DB --remote --env demo
npx wrangler deploy --env demo
```

`--env demo` を付け忘れると本番の D1・Worker が対象になるため、必ず付ける。

### 初回作成の手順（実施済み・作り直す場合の参考）

以下は `backend-workers/` で行う。値は書かず、対話入力で登録する。

1. `npx wrangler d1 create homelog-demo-db` で D1 を作成し、表示された `database_id` を `wrangler.toml` の `[[env.demo.d1_databases]]` に設定する（D1 の ID は秘密情報ではない）。
2. `npx wrangler secret put JWT_SECRET --env demo` で、本番とは別の十分な強度の値を対話入力する。コマンド引数・vars・Issue・ログへ実値を書かない。
3. 上の「公開・更新の手順」でマイグレーションの適用と公開を行う。初回は Worker が未作成のため、作成の確認が出る。

`wrangler secret put` は既存の Worker でも新しいバージョンを即時にデプロイする。

### 確認方法

- `GET https://homelog-demo.nyproducts.workers.dev/api/demo` が `{ "enabled": true }` を返す。本番の同じ API は `{ "enabled": false }` を返す。
- `https://homelog-demo.nyproducts.workers.dev/demo` を PC で開くとスマホの枠の中にログイン画面が出て、「デモを試す（登録不要）」でデモ太郎として始まる。
- デモの利用期限は作成から24時間。期限切れのデモは毎時の Cron で削除される。Cloudflare のダッシュボードで `homelog-demo` の Cron の実行を確認できる。

## 公開後の確認・残作業

- HTTPS公開URLで`/`、`/login`、`/recipes/iphone-shortcut`への直接アクセスとreloadを確認する。
- 同じoriginでhealthの200 JSON、未認証meの401 JSON、未知APIと`/api`の非HTML 404を確認する。
- 登録・ログイン・本人表示・共有URLの未ログイン復帰・PWA登録後のオンライン動作を確認する。架空の確認データのみを使う。
- iPhone Safariとショートカット共有の実機確認はユーザーが行う。iCloud共有リンクは現在、画面の「ショートカットを追加」から配布している。

参考（2026-10-16確認）: [Cloudflare SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)、[Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。

## 本番の自動デプロイ（Workers Builds・#267）

本番への公開は、Cloudflare Workers Builds が `production` ブランチの更新を検知して行う。`main` へのマージだけでは本番は変わらない。`main` を `production` に反映する操作が、公開の承認にあたる。

### Cloudflare 側の設定（初回のみ）

Workers & Pages → `homelog-backend-workers` → Settings → Builds で GitHub リポジトリを接続し、次のとおり設定する。

| 項目 | 設定値 |
|---|---|
| 本番ブランチ（Production branch） | `production` |
| 本番以外のブランチのビルド | 無効 |
| ルートディレクトリ | `backend-workers` |
| Node.js | `backend-workers/.node-version` の `24.22.1`（`NODE_VERSION` の別指定があれば統一） |
| ビルドコマンド | `cd ../frontend && npm ci && npm run build && cd ../backend-workers && npm ci` |
| デプロイコマンド | `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy` |

secret（`JWT_SECRET` など）は Worker に登録済みのものがそのまま使われる。Builds の環境変数へ実値を書かない。

### 公開の手順

1. 通常どおり PR を作り、CI が通ったら `main` にマージする。
2. ユーザーから本番反映の指示を受けたら、`git fetch origin` の成功を確認してから `origin/main` を `production` に fast-forward で反映する。
   ```sh
   git fetch origin
   git push origin origin/main:production
   ```
3. Cloudflare の Builds 画面でビルドとデプロイの成功を確認し、公開 URL で `/health` などを確認する。

`production` へは `main` 以外のコミットを入れない（fast-forward のみ）。履歴の分岐で push が拒否された場合は、公開を止めて `main` と `production` の差分を確認する。

### 切り戻し

Cloudflare の Deployments 画面で直前のバージョンに戻す。ただし D1 マイグレーションは戻らないため、DB 変更を含む公開の切り戻しは個別に判断する。
