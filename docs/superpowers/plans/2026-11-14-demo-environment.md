# デモ環境（2アカウント切り替え） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** README から登録なしで始められ、デモ太郎・デモ花子を切り替えて「本人だけ」と「世帯共有」の違いを体験できるデモ環境を作る。

**Architecture:** 本番と同じプログラムを、`DEMO_MODE="true"` を持つ別の Worker（`homelog-demo`）と別の D1 で動かす。デモ用の API（`/api/demo/*`）・機能の停止・期限切れの判定は `DEMO_MODE` のときだけ働き、本番の動きは変わらない。見本データは1回の D1 `batch` で作り、1時間ごとの Cron で期限切れのデモを全テーブルから消す。

**Tech Stack:** Cloudflare Workers / Hono 4 / D1 / zod / Vitest（`@cloudflare/vitest-pool-workers`）/ React 19 / msw / Playwright

**Spec:** `docs/superpowers/specs/2026-11-14-demo-environment-design.md`

## Global Constraints

- デモの寿命は作成から **24時間**。同時に存在できるデモ世帯は **300件**。`POST /api/demo/start` は同じ接続元から **1時間に5回** まで。
- 本番（`DEMO_MODE` 未設定）では `/api/demo/start`・`/api/demo/switch` は 404、`GET /api/demo` は 200 `{ enabled: false }`、`me.demo` は `null`。それ以外の既存の動きは一切変えない。
- 止める API は 403、コード `DEMO_DISABLED`、文言「デモでは使えません」。混雑時は 503、コード `DEMO_CAPACITY_REACHED`、文言「混み合っています。時間をおいて試してください」。
- デモ利用者：表示名「デモ太郎」「デモ花子」、世帯名「デモ家」、メール `demo-<乱数>-taro@example.com` / `demo-<乱数>-hanako@example.com`、パスワードは誰も知らない乱数のハッシュ。
- 画面の文言（そのまま使う）：
  - ボタン「デモを試す（登録不要）」、説明「架空の2人の世帯で、24時間お試しできます」
  - 帯「デモ中：{表示名}として表示しています（残り{n}時間）」、ボタン「{相手の表示名}に切り替える」「見どころ」「デモを終わる」
  - アカウント設定の注記「デモでは表示名以外は変更できません」
  - 見どころの4行は設計書 5-2 の文言どおり。
- 実在の人名・店名・ドメインを使わない。テストのメールは `@example.com`、IP は `203.0.113.0/24`（TEST-NET-3）。
- コミット・PR・Issue は日本語（種別だけ英語）。PR 本文は「概要 / 変更内容 / 担当 / 確認 / `Closes #N`」。main へ直接 push しない。CI 成功でマージ。
- Cloudflare 上のデモ Worker・D1 の作成と公開は、ユーザーの指示を受けてから行う（Task 9）。秘密情報の値はリポジトリ・チャットに出さない。

## Review Focus

1. **本番での無影響**：`DEMO_MODE` が無い環境で、登録・パスワード変更・世帯作成などが従来どおり動き、`requireAuth` に余計な判定が入らないこと（Task 1・4 のテストで固定）。
2. **切り替え後の古いトークン**：切り替え前のリフレッシュトークンで `/api/auth/refresh` すると 401 になること（Task 3）。
3. **他人の世帯への切り替え**：デモでない利用者、別のデモ世帯の利用者、期限切れのデモ利用者からの `switch` が 404/401 になり、相手のトークンが出ないこと（Task 3）。
4. **削除の巻き添え**：期限切れのデモを消すとき、期限内のデモと通常の世帯・利用者の行が1行も消えないこと。デモ中に利用者が足した行（割り勘コメント、世帯外の相手、店、リフレッシュトークン）も残らないこと（Task 5）。
5. **毎時 Cron の副作用**：`0 * * * *` で在庫の自動消費・固定費の計上などが動かないこと。R2 が無いデモ環境で毎日の処理がエラーにならないこと（Task 5）。

---

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `backend-workers/drizzle/0027_demo_households.sql` | `demo_households` テーブルと `expires_at` の索引 |
| `backend-workers/src/db/schema.ts` | `demoHouseholds` を追加 |
| `backend-workers/src/lib/demo.ts` | 定数・`isDemoMode`・デモ利用者の検索 |
| `backend-workers/src/lib/tokens.ts` | `auth.ts` の `issueTokens` を移して共有する |
| `backend-workers/src/lib/demo-seed.ts` | デモ世帯・2人・見本データを1つの batch で作る |
| `backend-workers/src/lib/demo-cleanup.ts` | 期限切れデモの削除 |
| `backend-workers/src/middleware/demo-guard.ts` | デモで止める API を 403 にする |
| `backend-workers/src/routes/demo.ts` | `GET /api/demo`・`POST /api/demo/start`・`POST /api/demo/switch` |
| `frontend/src/api/demo.ts` | デモ API の呼び出し |
| `frontend/src/components/DemoBanner.tsx` | デモ中の帯・見どころ |
| `e2e/playwright.demo.config.ts`、`e2e/tests/demo.spec.ts` | `DEMO_MODE=true` の E2E |

Issue は3つに分ける：バックエンド（Task 1〜5）、フロントエンド（Task 6〜8）、環境と文書（Task 9）。

---

### Task 1: `demo_households` とデモ利用者の期限切れ判定

**Files:**
- Create: `backend-workers/drizzle/0027_demo_households.sql`、`backend-workers/src/lib/demo.ts`
- Modify: `backend-workers/src/db/schema.ts`、`backend-workers/src/middleware/auth.ts`、`backend-workers/src/index.ts`（`Bindings` に `DEMO_MODE?: string`）、`backend-workers/src/lib/errors.ts`（`ErrorCode` に `'DEMO_DISABLED' | 'DEMO_CAPACITY_REACHED'`）
- Test: `backend-workers/src/test/middleware/auth-demo.test.ts`

**Interfaces:**
- Produces:
  - `export const DEMO_LIFETIME_HOURS = 24`、`export const DEMO_MAX_ACTIVE = 300`
  - `export function isDemoMode(env: { DEMO_MODE?: string }): boolean`（`=== 'true'` のときだけ true）
  - `export async function findDemoMembership(db: D1Database, userId: number): Promise<{ householdId: number; primaryUserId: number; partnerUserId: number; expiresAt: string } | null>`
  - `schema.ts` の `demoHouseholds`（`householdId` integer PK、`primaryUserId` integer not null、`partnerUserId` integer not null、`expiresAt` text not null、`createdAt` default current_timestamp）。**外部キーは付けない**：削除の batch で、この表を「消す対象の目印」として最後まで使い、親（`households`・`users`）より後に消すため（外部キーがあると親の削除で失敗する）。設計書 3-1 の「参照」は、値として同じ ID を持つという意味で扱う

- [ ] **Step 1: テストを書く**（`auth-demo.test.ts`。利用者・世帯・`demo_households` は SQL で直接作る）
  - `期限切れのデモ利用者は DEMO_MODE で 401`：`expires_at` を過去にして `GET /api/auth/me` → 401、`code: 'UNAUTHORIZED'`
  - `期限内のデモ利用者は 200`
  - `DEMO_MODE なしでは期限切れの行があっても 200`（本番では判定しない）
  - `期限切れのデモ利用者の POST /api/auth/refresh は DEMO_MODE で 401`（`requireAuth` を通らないため、refresh 側にも同じ判定を入れる）、`DEMO_MODE なしでは従来どおり 200`
  - `findDemoMembership はどちらの利用者からも同じ行を返し、通常の利用者では null`
- [ ] **Step 2: 実行して失敗を確認** — `cd backend-workers && npx vitest run src/test/middleware/auth-demo.test.ts` → テーブルが無いため FAIL
- [ ] **Step 3: 実装**
  - マイグレーション：`CREATE TABLE demo_households (...)` と `CREATE INDEX demo_households_expires_at_idx ON demo_households (expires_at)`。
  - `requireAuth`：`isDemoMode(c.env)` のときだけ、既存の有効確認の SQL に `AND NOT EXISTS (SELECT 1 FROM demo_households d WHERE (d.primary_user_id = users.id OR d.partner_user_id = users.id) AND d.expires_at <= ?)` を足す（クエリは1本のまま）。`DEMO_MODE` なしでは SQL を変えない。
  - `POST /api/auth/refresh`：`isDemoMode(c.env)` のときだけ、トークンの持ち主が期限切れのデモ利用者なら 401（既存の無効トークンと同じ応答）。判定は `lib/demo.ts` の `export async function isExpiredDemoUser(db: D1Database, userId: number, now: Date): Promise<boolean>` にまとめる。
- [ ] **Step 4: 実行して成功を確認** — 同じコマンドで PASS。`npm test` 全体も PASS
- [ ] **Step 5: コミット** — `feat(backend): デモ世帯の表と期限切れの判定を追加する (#<BE Issue>)`

### Task 2: 見本データと `GET /api/demo`・`POST /api/demo/start`

**Files:**
- Create: `backend-workers/src/lib/tokens.ts`、`backend-workers/src/lib/demo-seed.ts`、`backend-workers/src/routes/demo.ts`
- Modify: `backend-workers/src/routes/auth.ts`（`issueTokens` を `lib/tokens.ts` から使う）、`backend-workers/src/lib/rate-limit.ts`（`demoStartAddress: { scope: 'demo_start_address', limit: 5, windowSeconds: 60 * 60 }`）、`backend-workers/src/index.ts`（`app.route('/api/demo', demoRoute)`）
- Test: `backend-workers/src/test/routes/demo.test.ts`

**Interfaces:**
- Consumes: Task 1 の `isDemoMode`・`DEMO_LIFETIME_HOURS`・`DEMO_MAX_ACTIVE`・`demoHouseholds`
- Produces:
  - `export interface TokenResponse { accessToken: string; refreshToken: string; expiresIn: number }`
  - `export async function issueTokens(env: Bindings, userId: number): Promise<TokenResponse>`（`lib/tokens.ts`。中身は今の `auth.ts` の `issueTokens` と同じ）
  - `export async function createDemoHousehold(db: D1Database, now: Date): Promise<{ householdId: number; primaryUserId: number; partnerUserId: number; expiresAt: string }>`（`lib/demo-seed.ts`）
  - `GET /api/demo` → 200 `{ enabled: boolean }`、`POST /api/demo/start` → 201 `TokenResponse`（デモ太郎）

- [ ] **Step 1: テストを書く**（`demo.test.ts`。`app.request(path, init, { ...env, DEMO_MODE: 'true' })` でデモ環境にする）
  - `GET /api/demo は DEMO_MODE で enabled: true、なしで enabled: false`
  - `start は DEMO_MODE なしで 404`
  - `start で太郎としてログインでき、me の表示名がデモ太郎`
  - `太郎と花子で口座が分かれる`：太郎の `GET /api/accounts` の名前が `['みどり銀行']`、花子が `['さくら銀行', '交通系IC']`（順不同）
  - `支出も本人のものだけが見える`：太郎の支出に「書籍」があり「美容院」が無い。花子はその逆
  - `在庫・レシピ・献立は2人で同じ`：`GET /api/inventory-items` の名前が2人とも `卵・牛乳・お米・トイレットペーパー`、レシピが `肉じゃが・カレーライス・鮭のホイル焼き`
  - `割り勘は相手側に負担として出る`：花子の割り勘の一覧に「スーパー」（負担 3,000円・未精算）、太郎に「日用品」（負担 1,200円・未精算）。既存の `expense-splits` の一覧 API の形に合わせて書く
  - `個人の予定と固定費は本人だけ`：太郎の予定に「歯医者」「誕生日会」、花子に「友人とランチ会」「誕生日会」があり、相手の個人の予定は無い。固定費も「スマホ代」「ジム会費」が本人だけで、「家賃」は2人に見える
  - `口座残高はアプリで同じ収支を登録したときと同じ`：期待値は初期残高（みどり銀行 250,000、さくら銀行 180,000、交通系IC 3,000）に収入・支出を反映した値
  - `同じ接続元から6回目は 429`（`CF-Connecting-IP: 203.0.113.9`）
  - `期限内のデモが300件あると 503 DEMO_CAPACITY_REACHED`（`demo_households` に SQL で300行入れる。期限切れの行は数えない）
  - `途中で失敗したら何も残らない`：`createDemoHousehold` を失敗させる条件（例：同じメールを先に入れておく）で、`users`・`households`・`demo_households` の件数が増えていない
- [ ] **Step 2: 実行して失敗を確認** — `npx vitest run src/test/routes/demo.test.ts` → FAIL（ルートが無い）
- [ ] **Step 3: 実装**
  - `createDemoHousehold`：すべての INSERT を **1つの `db.batch`** にまとめる。親の ID は、その回だけの一意な値（乱数の招待コード・乱数入りのメール）を使った副問い合わせ（例：`(SELECT id FROM users WHERE email = ?)`、`(SELECT id FROM accounts WHERE household_id = (...) AND name = ?)`）で参照する。`last_insert_rowid()` の連鎖には頼らない。
  - 見本データ（日付は JST の今月。日が今日より後になるものは今日にする）：
    - 既定カテゴリー：家計簿・収入・在庫は、各ルートの `DEFAULT_CATEGORY_NAMES` と同じもの（定数を export して共有する）。在庫カテゴリーに「日用品」を1つ足す。
    - 太郎：口座「みどり銀行」（bank、初期 250,000）、カード「いつものクレジット」（みどり銀行に紐づく credit）。収入「給与」280,000（1日）。支出「書籍」1,800（趣味・娯楽、3日）、「ランチ」1,200（食費、5日）、「映画」2,000（趣味・娯楽、7日）。個人の固定費「スマホ代」3,000（25日）。個人の予定「歯医者」（18日）。
    - 花子：口座「さくら銀行」（bank、初期 180,000）、「交通系IC」（e_money、初期 3,000）。収入「給与」240,000（1日）。支出「美容院」5,500（その他、4日）、「カフェ」800（食費、6日）、「服」4,900（その他、8日）。個人の固定費「ジム会費」7,000（10日）。個人の予定「友人とランチ会」（22日）。
    - 割り勘：太郎が「スーパー」6,000（食費、みどり銀行、2日）を立替、花子の負担 3,000・未精算。花子が「日用品」2,400（日用品、さくら銀行、4日）を立替、太郎の負担 1,200・未精算。
    - 世帯：固定費「家賃」120,000（27日、`owner_user_id` NULL、世帯合計に含める、太郎の登録、2人で 0.5 ずつ）、予定「誕生日会」（20日、毎年、`owner_user_id` NULL）、在庫（卵 2/3/250・牛乳 1/2/220・お米 5/1/2500・トイレットペーパー 0/1/450。数量/しきい値/単価、カテゴリーは卵・乳製品・乾物・日用品）、買い物リストは在庫のしきい値と同じ仕組みで出るもの、レシピ「肉じゃが」「カレーライス」（お気に入り）「鮭のホイル焼き」（手入力、材料・手順あり）、今週の献立「肉じゃが」と自由メモ「外食」。
    - 口座残高は、初期残高に本人の収入・支出（立替の全額を含む）を反映した値で入れる。割り勘・固定費・在庫と買い物リストの列は、`schema.ts` と既存ルートが作る行と同じ値にする（各ルートの INSERT 文を参照）。
  - `POST /api/demo/start`：`isDemoMode` でなければ 404 → `consumeRateLimits(db, [{ rule: RATE_LIMITS.demoStartAddress, key: clientAddressKey(c) }])` が false なら 429（既存の `TOO_MANY_REQUESTS`）→ 期限内の `demo_households` が `DEMO_MAX_ACTIVE` 以上なら 503 → `createDemoHousehold` → `issueTokens(env, primaryUserId)` を 201 で返す。上限の確認と作成は別の処理なので、同時に来たときにわずかに超えることがある（緩い上限として扱い、コメントに書く）。
- [ ] **Step 4: 実行して成功を確認** — `npx vitest run src/test/routes/demo.test.ts` PASS、`npm test`・`npm run lint`・`npm run typecheck` PASS
- [ ] **Step 5: コミット** — `feat(backend): デモの開始と見本データを追加する (#<BE Issue>)`

### Task 3: `POST /api/demo/switch` と `me.demo`

**Files:**
- Modify: `backend-workers/src/routes/demo.ts`、`backend-workers/src/routes/auth.ts`（`GET /me`）
- Test: `backend-workers/src/test/routes/demo.test.ts`、`backend-workers/src/test/routes/auth-me.test.ts`

**Interfaces:**
- Consumes: `findDemoMembership`、`issueTokens`
- Produces:
  - `POST /api/demo/switch`（`requireAuth`、本文 `{ refreshToken: string }`）→ 200 `TokenResponse`（相手）
  - `GET /api/auth/me` の応答に `demo: { expiresAt: string; partnerName: string } | null` を追加

- [ ] **Step 1: テストを書く**
  - `太郎→花子→太郎と切り替わる`（`me.displayName` で確認）
  - `切り替え前のリフレッシュトークンは失効し、refresh が 401`
  - `本文の refreshToken が本人のものでなければ 404 で、何も失効しない`
  - `デモでない利用者は 404`、`DEMO_MODE なしでは 404`、`期限切れのデモ利用者は 401`
  - `me.demo は デモ利用者で { expiresAt, partnerName: 'デモ花子' }（太郎のとき）、通常の利用者と DEMO_MODE なしでは null`
- [ ] **Step 2: 実行して失敗を確認**
- [ ] **Step 3: 実装** — `switch`：デモ利用者でなければ 404。本文のリフレッシュトークンが本人の未失効のものなら失効させ、相手（`primaryUserId`/`partnerUserId` のうち自分でない方）に `issueTokens`。失効と発行は順に行い、失効が0行なら 404。`me`：`isDemoMode` のときだけ `findDemoMembership` と相手の表示名を引く。
- [ ] **Step 4: 実行して成功を確認**（`npm test` 全体も）
- [ ] **Step 5: コミット** — `feat(backend): デモの2人を切り替えられるようにする (#<BE Issue>)`

### Task 4: デモで止める API

**Files:**
- Create: `backend-workers/src/middleware/demo-guard.ts`
- Modify: `backend-workers/src/index.ts`（`/api/*` のルート登録より前に `app.use('/api/*', demoGuard)`）
- Test: `backend-workers/src/test/middleware/demo-guard.test.ts`

**Interfaces:**
- Produces: `export const DEMO_DISABLED_ROUTES: ReadonlyArray<{ method: string; path: string }>`、`export const demoGuard: MiddlewareHandler<AppEnv>`

- [ ] **Step 1: テストを書く** — 設計書 4-1 の13本（`register`、`password`、`email`、`account/deletion`、`account/deletion/cancel`、`password-reset/request`、`password-reset/confirm`、`households` の作成・参加・脱退・招待コード再発行、`recipes/ocr/upload`、`recipes/ocr/analyze`）を `it.each` で：
  - `DEMO_MODE で 403 { code: 'DEMO_DISABLED', message: 'デモでは使えません' }`、かつ DB に変化がない（例：`register` 後に `users` の件数が同じ）
  - `DEMO_MODE なしでは 403 にならない`（既存どおりの状態コード。認証が要るものは 401 など）
  - `PATCH /api/auth/account（表示名）と POST /api/recipes/from-url は DEMO_MODE でも止めない`
- [ ] **Step 2: 実行して失敗を確認**
- [ ] **Step 3: 実装** — メソッドとパスの完全一致で判定し、`isDemoMode` のときだけ 403 を返す。
- [ ] **Step 4: 実行して成功を確認**
- [ ] **Step 5: コミット** — `feat(backend): デモでは費用・画像・アカウント管理のAPIを止める (#<BE Issue>)`

### Task 5: 期限切れデモの削除と毎時 Cron

**Files:**
- Create: `backend-workers/src/lib/demo-cleanup.ts`
- Modify: `backend-workers/src/index.ts`（`scheduled`）
- Test: `backend-workers/src/test/lib/demo-cleanup.test.ts`、`backend-workers/src/test/scheduled.test.ts`

**Interfaces:**
- Produces: `export const DEMO_CLEANUP_CRON = '0 * * * *'`、`export async function purgeExpiredDemos(db: D1Database, now: Date): Promise<number>`（消したデモ世帯の数）

- [ ] **Step 1: テストを書く**
  - `期限切れのデモだけを全テーブルから消す`：通常の世帯（利用者・支出など）と期限内のデモを作り、全テーブル（`sqlite_master` から `d1_migrations`・`rate_limit_counters`・`_cf_%`・`sqlite_%` を除く）の件数を記録 → 期限切れのデモを1つ作り、そのデモで割り勘コメント・世帯外の相手・店・リフレッシュトークンを API で足す → `purgeExpiredDemos` → 全テーブルの件数が記録と同じ、戻り値が 1
  - `期限内のデモは消さない`（戻り値 0）
  - `期限切れが複数（3件）あっても1回の batch で全部消える`（`db.batch` の呼び出し回数を `vi.spyOn` で数えて1回。D1 の無料プランは1回の実行で50クエリまでのため、世帯ごとに呼ばない）
  - scheduled：`cron: '0 * * * *'` のとき `purgeExpiredDemos` だけが動き、在庫の自動消費・固定費の計上・献立の削除が動かない（既存の `scheduled.test.ts` の確かめ方に合わせる）
  - scheduled：`0 15`・`0 16` の動きは従来どおり。`RECIPE_IMAGES` が無い環境で `0 16` を実行しても、エラーが記録されない
- [ ] **Step 2: 実行して失敗を確認**
- [ ] **Step 3: 実装** — 期限切れのデモ**すべて**を、1回の `batch` で集合として削除する。各 DELETE は対象を副問い合わせで指定する（世帯：`household_id IN (SELECT household_id FROM demo_households WHERE expires_at <= ?)`、利用者：同じ条件の `primary_user_id` と `partner_user_id`）。ID を bind で並べない（D1 の100パラメータ上限）。`schema.ts` の外部キーの順（子→親）に並べ、最後に `household_members`・`households`・`users`、いちばん最後に `demo_households` を消す（`demo_households` は外部キーを持たないので、親より後に消せる）。期限の基準時刻は全文で同じ値を bind する。戻り値は先に数えた期限切れの件数。`scheduled` は Cron 式ごとに分岐し、`DEMO_CLEANUP_CRON` では `purgeExpiredDemos` だけを行う。`deleteStaleOcrImages` は `env.RECIPE_IMAGES` があるときだけ呼ぶ。
- [ ] **Step 4: 実行して成功を確認**（`npm test`・lint・typecheck）
- [ ] **Step 5: コミット** — `feat(backend): 期限切れのデモを1時間ごとに削除する (#<BE Issue>)`
- [ ] **Step 6: API 層の E2E** — `e2e/playwright.demo.config.ts` を作る（`playwright.menu-cleanup.config.ts` と同じ形で、1つ目の webServer の `wrangler dev` に `--var DEMO_MODE:true` を足し、`workers: 1`、`testMatch: '**/demo*.spec.ts'`）。`e2e/playwright.config.ts` の `testIgnore` に `**/demo*.spec.ts` を足す。`e2e/tests/demo-api.spec.ts`（`request` だけを使う）：`GET /api/demo` が true → `start` が 201 → 太郎と花子で口座が違い在庫が同じ → `switch` → 古いリフレッシュトークンの refresh が 401 → `POST /api/auth/register` が 403 `DEMO_DISABLED`。`.github/workflows/e2e.yml` に `npm test -- --config playwright.demo.config.ts` の手順を足す。`cd e2e && npm test -- --config playwright.demo.config.ts` が PASS
- [ ] **Step 7: バックエンドの PR** — 品質チェック、Codex レビュー（`codex review --base main < /dev/null`）、PR、CI 成功でマージ

### Task 6: ログイン画面の「デモを試す」と切り替えの土台

**Files:**
- Create: `frontend/src/api/demo.ts`
- Modify: `frontend/src/context/AuthContext.tsx`、`frontend/src/context/authContextValue.ts`、`frontend/src/pages/LoginPage.tsx`
- Test: `frontend/src/test/pages/LoginPage.test.tsx`、`frontend/src/test/context/AuthContext.test.tsx`（既存があればそこへ）

**Interfaces:**
- Consumes: Task 2・3 の API
- Produces:
  - `export async function fetchDemoAvailability(): Promise<boolean>`
  - 認証コンテキストの `user` の型に `demo: { expiresAt: string; partnerName: string } | null`
  - コンテキストに `startDemo(): Promise<void>`（`POST /demo/start` → 既存の `startSession`）、`switchDemo(): Promise<void>`（`POST /demo/switch` に今のリフレッシュトークンを送る → `setTokens` → `window.location.assign('/')`）

- [ ] **Step 1: テストを書く**
  - `GET /api/demo が enabled: true のときだけ「デモを試す（登録不要）」と説明が出る`
  - `押すと /demo/start を呼び、ホームへ進む`
  - `429・503 のときはサーバーの文言を表示し、ログインしない`
  - `GET /api/demo が失敗してもボタンを出さず、ログインは使える`
- [ ] **Step 2: 実行して失敗を確認** — `cd frontend && npx vitest run src/test/pages/LoginPage.test.tsx`
- [ ] **Step 3: 実装**（ボタンはログインボタンの下。既存の補助ボタンのクラスに合わせる）
- [ ] **Step 4: 実行して成功を確認**
- [ ] **Step 5: コミット** — `feat(frontend): ログイン画面からデモを始められるようにする (#<FE Issue>)`

### Task 7: デモ中の帯・見どころ・アカウント設定の注記

**Files:**
- Create: `frontend/src/components/DemoBanner.tsx`
- Modify: `frontend/src/components/AppLayout.tsx`（ヘッダーの直下に `<DemoBanner />`）、`frontend/src/pages/AccountSettingsPage.tsx`、スタイルは既存の共通 CSS に追加
- Test: `frontend/src/test/components/DemoBanner.test.tsx`、`frontend/src/test/pages/AccountSettingsPage.test.tsx`

**Interfaces:**
- Consumes: Task 6 の `user.demo`・`switchDemo`・`logout`

- [ ] **Step 1: テストを書く**
  - `user.demo が null なら何も出さない`
  - `「デモ中：デモ太郎として表示しています（残り23時間）」`（`expiresAt` を今から 22時間30分後にすると、切り上げて23）
  - `「デモ花子に切り替える」で switchDemo が呼ばれる`、`「デモを終わる」で logout`
  - `「見どころ」を押すと4行が出て、もう一度押すと閉じる（aria-expanded が切り替わる）`
  - アカウント設定：`user.demo があるときだけ「デモでは表示名以外は変更できません」`
- [ ] **Step 2〜4: 失敗 → 実装 → 成功**（`npm run lint`・`npx tsc -b`・`npx vitest run`・`npm run build`）
- [ ] **Step 5: コミット** — `feat(frontend): デモ中の帯と見どころを表示する (#<FE Issue>)`

### Task 8: デモの E2E と CI

**Files:**
- Create: `e2e/tests/demo.spec.ts`（設定 `playwright.demo.config.ts` と CI の手順は Task 5 で作成済み）
- Modify: `e2e/tests/` の既存ログイン系 spec のどれか（デモボタンが出ないこと）

- [ ] **Step 1〜2: spec を書く**（`consoleGuard.watch(page)` を最初に呼ぶ。1280 / 390 / 320px）
  - デモを試す → 帯に「デモ太郎」→ 口座に「みどり銀行」があり「さくら銀行」が無い → 「デモ花子に切り替える」→ 帯に「デモ花子」、口座に「さくら銀行」 → 在庫に「卵」（2人で同じ）→ 割り勘に「スーパー」の負担 → 見どころが開く
  - 帯とボタンが横にはみ出さない（各幅で `scrollWidth <= clientWidth`）
  - アカウント設定でパスワード変更を送ると「デモでは使えません」
  - 本番相当（通常の設定）：ログイン画面に「デモを試す」が出ない
- [ ] **Step 3: 実行** — `cd e2e && npm test -- --config playwright.demo.config.ts` PASS、通常の `npm test` も PASS
- [ ] **Step 4: コミットとフロントエンドの PR** — 品質チェック、Codex レビュー、PR、CI 成功でマージ。ユーザーにローカルで確かめる URL を伝える

### Task 9: デモ環境の作成・公開と文書（ユーザーの指示を受けてから）

**Files:**
- Modify: `backend-workers/wrangler.toml`（`[env.demo]`）、`docs/deployment.md`、`README.md`、`docs/requirements.md`、`docs/details/features/F01_auth.md`、`docs/details/features/F02_household.md`、`docs/details/api-design.md`、`docs/details/data-model.md`、`docs/manual/index.html`（デモがある旨を1行）

- [ ] **Step 1: ユーザーの指示を確認する**（デモの作成・公開は外部への変更）
- [ ] **Step 2: Cloudflare に作る** — `npx wrangler d1 create homelog-demo-db`（出力の `database_id` を使う）。デモ用の `JWT_SECRET` は乱数で作り、`npx wrangler secret put JWT_SECRET --env demo` に標準入力で渡す（値を表示・保存しない）
- [ ] **Step 3: `[env.demo]` を書く** — `name = "homelog-demo"`、`vars`（`DEMO_MODE = "true"`、JWT の有効期限は本番と同じ、`APP_PASSWORD_RESET_LOG_TOKEN_ENABLED = "false"`、`PASSWORD_RESET_MAIL_ENABLED = "false"`）、`d1_databases`（`homelog-demo-db`）、`triggers.crons = ["0 15 * * *", "0 16 * * *", "0 * * * *"]`。R2・AI は書かない
- [ ] **Step 4: 文書** — README の冒頭近くに「デモ」の節（設計書 6章の内容）、`deployment.md` にデモの更新手順（`npx wrangler d1 migrations apply DB --remote --env demo && npx wrangler deploy --env demo`）、要件・F01・F02・API 設計・データモデルにデモの記述
- [ ] **Step 5: PR → CI 成功でマージ → 公開** — `npx wrangler d1 migrations apply DB --remote --env demo`、`npx wrangler deploy --env demo`
- [ ] **Step 6: 公開後の確認** — `GET /api/demo` が `enabled: true`、ヘッドレスのブラウザで「デモを試す」→ 切り替え → 見どころ（1280 / 390px）、CSP 違反なし。本番の `GET /api/demo` が `enabled: false`。作った確認用のデモは期限で消えることを報告する
