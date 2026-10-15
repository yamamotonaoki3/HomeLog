# Cloudflare Workersへの配信手順（#261 / #265）

WorkersがReactのビルド成果物とAPIを同一originで配信する。画面の直接アクセスはSPAへ、`/api`・`/api/*`・`/health` はHonoへ渡す。既存のfetchとscheduled処理は維持する。画面・API・DBの仕様変更はない。

本書は実施手順であり、本Issueでは外部リソース作成・本番デプロイを実行しない。技術スタック等の資料全体の刷新も対象外。

## ローカル検証・CIの前提

Node.js 24と各ディレクトリの依存導入（`npm ci`）が必要。`backend-workers/.dev.vars.example`を参考にローカル専用の`.dev.vars`へJWT_SECRETを設定する。値を出力・コミットしない。

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

## 将来の初回公開（ユーザーの公開判断後のみ）

自動配信を取り込む前に、後述のproduction Environmentの承認ルールとSecretsをユーザーが設定する。保護ルールなしのEnvironment自動作成では承認待ちにならないため、設定完了前にdeploy workflowをmainへ取り込まない。

以下は`backend-workers/`で行う。Cloudflareアカウント、Workers/D1/R2の利用権限と必要な課金設定を準備する。実行先アカウントを確認する。

1. `npx wrangler login`で認証する。
2. ダッシュボードまたは`npx wrangler d1 create homelog-db`でD1を作成する。
3. `wrangler.toml`の`database_id`が作成済みD1のIDになっていることを確認する（#263で設定済み。別環境に作り直した場合は置き換える）。D1 IDは秘密鍵ではない。対象DBを必ず確認する。
   本番DBを変更する前に`frontend/`で`npm ci`と`npm run build`を成功させておく。
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

## 承認付き自動配信の事前設定（ユーザー作業）

本Issueでは以下の外部設定変更も本番デプロイも実行しない。productionの存在だけでは保護設定済みと判断できないため、ユーザーが次を確認する。

1. GitHubのSettings → Environmentsで`production`を作成・選択する。
2. Required reviewersに運用者本人を登録する。個人運用では**Prevent self-reviewを無効**にし、自分が開始したrunを自分で承認できるようにする。管理者による保護ルールのbypassを許可しない設定にし、通常運用でもbypassを使わない。
3. Deployment branches and tagsをSelected branches and tagsにして、branchの`main`のみを許可する。tagや他ブランチは許可しない。
4. 同じEnvironmentのEnvironment secretsへ`CLOUDFLARE_API_TOKEN`と`CLOUDFLARE_ACCOUNT_ID`を登録する。Repository secretsへの登録や同名secretの重複は避ける。値をIssue・ログ・スクリーンショットへ貼らない。
5. Cloudflareで対象アカウントだけに限定したAPI tokenを作成する。Workers ScriptsのEdit（API表記Write）とD1のEditを基本に、既存R2/Workers AIバインディングに必要なWorkers R2 Storage / Workers AIのRead等を実際の構成と公式権限一覧で確認して追加する。不要なzone/DNS権限やGlobal API Keyは使わない。権限不足の際は必要な権限だけを調べ、全面権限へ広げない。
6. Cloudflare側の既存本番`JWT_SECRET`、必要な`GOOGLE_VISION_API_KEY`、D1/R2/AIとCron開始条件を確認する。CI用`.dev.vars`を本番へコピーせず、deploy workflowから本番secretを再登録しない。
7. ブランチ保護の必須チェックは`backend-quality` / `frontend-quality` / `e2e`を維持する。PRトリガーと各job名・チェック内容は変更していない。main側のreusable呼出しはActions画面で親job名付きになることがあるが、PRの必須チェック名を置き換えない。設定変更は本Issueでは行わない。

API tokenの権限は[Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)と[権限一覧](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)を参照する。設定後、初回runの承認待ち・Environment・対象SHAをユーザーが確認する。ローカル検証だけではGitHub側の承認・secret隔離が有効であることを証明できない。

## main pushから承認・配信まで

`.github/workflows/deploy.yml`はmainへのpushだけで起動する。既存3つのquality workflowを`workflow_call`で同じコミットから呼び、deploy jobの`needs`で全ての成功を待つ。main pushの起動はここへ集約し、PRでは従来のquality workflowだけが動く。Cloudflare secretsはqualityへ渡さない（`secrets: inherit`も使わない）。

3ゲートが全て成功するとdeploy jobがproductionの承認待ちになる。Actionsのrunで対象SHAと検証結果を確認し、Review deploymentsからproductionを承認する。未承認・拒否の場合はdeploy jobの全ステップが開始されない。ゲートの失敗・cancel・skipの場合も配信しない。

承認後は同じ`github.sha`をcheckoutし、Node 24とlockfileで依存を導入して以下の順に実行する。

1. `frontend/`: `npm ci` → `npm run build`
2. `backend-workers/`: `npx wrangler d1 migrations apply DB --remote`
3. `backend-workers/`: `npx wrangler deploy`（Workerとbuild済みassets）

**Issue #265本文のmigration → build → deployから、ユーザー承認によりbuild → migration → deployへ変更した。** build失敗で本番DBだけが更新される事態を避ける。Workers依存もremote操作より前に`npm ci`で導入する。どのステップも失敗したら後続は実行しない。Cloudflare secretsはremote migration/deployの各ステップだけのenvに渡す。GitHub権限は`contents: read`。

固定concurrency group `homelog-production`をrun全体に指定し、承認待ちを含めて直列化する。`cancel-in-progress: false`なので実行中のmigration/deployを次のpushで中断しない。GitHubのpending run置換や順序保証の制約があり、全コミットのFIFO配信は保証しない。承認待ち中の追加pushは、現在のrunを確認・配信またはcancelしてから後続を確認する。

参考: [reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)、[Environmentと承認](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)、[concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。

## 失敗時の確認と手動復旧

- qualityまたは承認後の依存導入/buildが失敗: このrunのremote操作は未実行。ログから原因を修正し、再検証する。承認拒否時もremote操作は未実行。
- migrationが失敗: deployは未実行。migration途中まで適用された可能性もあるため、対象アカウント・D1と適用済みmigrationを確認してから修正する。共有済みSQLは編集せず、新しい連番で修正する。
- migration成功後にdeployが失敗: DBは更新済み。旧Workerと互換性を保つmigrationを前提に、修正版を前進適用する。再実行でもmigration履歴を確認し、二重データ更新を避ける。
- deploy成功後の障害: ユーザーが対象Worker `homelog-backend-workers` と直前に正常だったversion、現在のDB互換性を確認してから手動rollbackを判断する。`backend-workers/`で`npx wrangler deployments list`と`npx wrangler versions list`を確認し、明示した正常versionに`npx wrangler rollback <VERSION_ID> --name homelog-backend-workers`を実行する。復旧も本番変更であり、本Issueでは実行しない。

**Worker rollbackはD1を戻さない。** assetsやバインディング変更にもrollbackの制約がある。破壊的migrationを避け、旧コードとの後方互換性を保つ。D1の復元が必要なら影響とデータ損失範囲を確認して別途承認を得る。復旧前に後続の配信・承認待ちrunを確認し、復旧直後の意図しない再配信も防ぐ。

参考: [Wrangler D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/)、[Worker rollbacksの制約](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)。

## 公開後の確認・残作業

- HTTPS公開URLで`/`、`/login`、`/recipes/iphone-shortcut`への直接アクセスとreloadを確認する。
- 同じoriginでhealthの200 JSON、未認証meの401 JSON、未知APIと`/api`の非HTML 404を確認する。
- 登録・ログイン・本人表示・共有URLの未ログイン復帰・PWA登録後のオンライン動作を確認する。架空の確認データのみを使う。
- 公開URL確定後、ユーザーがiPhone Safariとショートカット共有を実機確認する。iCloud共有リンクの配布は後続Issue。カスタムドメイン・本番ID・課金プランは本Issueで決めない。

参考（2026-10-16確認）: [Cloudflare SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)、[Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。
