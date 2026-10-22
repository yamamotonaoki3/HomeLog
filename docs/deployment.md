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

既存Cron（UTC毎日16:00、JST翌01:00）も公開対象となり、固定費計上とOCR一時画像削除が動く。公開先D1/R2と自動処理開始を確認してから実行する。

**パスワード再設定メールは未実装**。`APP_PASSWORD_RESET_LOG_TOKEN_ENABLED`は本番で必ず`false`とし、生トークンを出力しない。配信構成が整ってもメール送信を前提とする本番運用開始の条件は満たさない。メール基盤の選定・実装は別途対応する。

OCRには既存の`GOOGLE_VISION_API_KEY`のsecret設定（同じ対話入力方式）とGoogle Vision側の利用準備、およびWorkers AIの利用準備が別途必要。ローカルE2Eではリモートバインディングを無効にする。

## 公開後の確認・残作業

- HTTPS公開URLで`/`、`/login`、`/recipes/iphone-shortcut`への直接アクセスとreloadを確認する。
- 同じoriginでhealthの200 JSON、未認証meの401 JSON、未知APIと`/api`の非HTML 404を確認する。
- 登録・ログイン・本人表示・共有URLの未ログイン復帰・PWA登録後のオンライン動作を確認する。架空の確認データのみを使う。
- 公開URL確定後、ユーザーがiPhone Safariとショートカット共有を実機確認する。iCloud共有リンクの配布は後続Issue。カスタムドメイン・本番ID・課金プランは本Issueで決めない。

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
2. 公開したい時点で、`main` を `production` に反映する。
   ```sh
   git fetch origin
   git push origin origin/main:production
   ```
   GitHub 上で `main` → `production` の PR を作ってマージしてもよい。
3. Cloudflare の Builds 画面でビルドとデプロイの成功を確認し、公開 URL で `/health` などを確認する。

`production` へは `main` 以外のコミットを入れない（fast-forward のみ）。`main` と食い違った場合は、`main` 側を正として修正する。

### 切り戻し

Cloudflare の Deployments 画面で直前のバージョンに戻す。ただし D1 マイグレーションは戻らないため、DB 変更を含む公開の切り戻しは個別に判断する。
