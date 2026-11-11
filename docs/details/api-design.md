# API設計

[← 要件定義書に戻る](../requirements.md)

Cloudflare Workers 版（`backend-workers/src/routes/`）の API。全エンドポイントの一覧は 8章、機能ごとの詳しい契約は各機能の要件定義書（features/F01〜F13）を正とする。

## 固定費の世帯外割り勘（Workers、#253）

`GET/POST/PATCH /api/fixed-costs` は世帯内・世帯外を混在して扱う。認証必須（401）、編集は登録者のみ（他者・他世帯は404）。

- POST/PATCHの `splits` は最大20行。各行は `debtorUserId` / `debtorExternalId` / `debtorExternalName` の一つだけを指定する（他の識別子は省略またはnull）。既存IDは自世帯に限り、新規名はtrimし50文字以内。名前の自動名寄せは行わず、編集時は取得済みIDを再利用する。
- 自己指定、識別子なし・複数、重複（名前はtrim・大文字小文字を無視）、空白名、不正な負担分を400 `VALIDATION_ERROR`で拒否する。拒否時は既存設定を維持し、新規名も作成しない。割合は0〜100・合計100以下、金額は0〜9,999,999,999の整数・合計は固定費金額以下。`splitInputType` は `ratio` / `amount`、未指定は `ratio`。
- 本人向け内訳は `{ debtorUserId, debtorExternalId, debtorExternalName, splitRatio, amountDue }`。世帯内は外部ID・名がnull、世帯外はuser IDがnull。外部名は現在の `external_persons.name` を返す。他者には `splitInputType:null` / `splits:[]` を返す。
- PATCHは全置換。空配列・null・省略は内訳削除。世帯内のみの旧入力も引き続き利用可能。本体と内訳は単一batchで保存し、新規の外部名マスタのみ検証完了後に先行作成する。
- 自動計上は自世帯の世帯外相手も `expense_splits`（unpaid）へ転記し、精算APIの既存フローを利用する。退会snapshotは対象外。入力・詳細UIは後続#254で対応する。

[← 要件定義書に戻る](../requirements.md)

MVPスコープ（認証・世帯グループ・在庫管理・買い物リスト・トップ簡易ダッシュボード）のREST APIエンドポイントを定義する。家計簿・献立表等のPhase 2以降の機能のAPIは、着手時に追記する。

エンドポイントパスや型は実装時に変更されうる暫定仕様であり、詳細はController実装時にOpenAPI（springdoc）で確定させる（[技術スタック.md](../技術スタック.md)参照）。

---

## 1. 共通仕様

### 収入・口座連携の追加契約（Workers、#244）

| API | 契約 |
| --- | --- |
| `POST /api/incomes` | `incomeDate`（有効なYYYY-MM-DD）、`amount`（整数1〜9,999,999,999）、`content`（空白のみ不可、最大100文字）、`categoryId`（同世帯）、`accountId`（必須の正整数）、`memo`（任意/null、最大255文字）。入金先は本人所有・同世帯・未削除口座のみ。成功201。省略/null/不正/他人/別世帯/削除済み口座は400 `VALIDATION_ERROR`。収入INSERTと残高相対加算は単一D1 batchで原子的に実行 |
| `GET /api/expense-splits`（追記） | 各内訳に相手の`debtorUserId`／`debtorExternalId`を含める（割り勘付き支出の編集で内訳を作り直すため、#278） |
| `PUT/DELETE /api/expenses/:id`・`PUT/DELETE /api/incomes/:id` | 本人の支出・収入の編集（登録と同じ入力の全置換、200）・削除（204）。残高を自動補正。割り勘内訳に未請求以外がある支出・精算で自動作成された明細・補正先口座が削除済みの明細は409 `RESOURCE_CONFLICT`。他人・不存在は404。詳細は[F03](features/F03_kakeibo_expense.md)「支出・収入の編集・削除」（#275） |
| `GET /api/incomes` | 本人の収入のみ返す。`categoryId`絞り込みは従来どおり。各要素は`id, incomeDate, amount, content, categoryId, memo, accountId, accountName`。`accountId/accountName`はnullable。論理削除口座も名前を解決する。POST成功レスポンスにも同じ項目を返す |
| `DELETE /api/accounts/:id` | 固定費参照または残高0でない子カードがあれば400。過去の支出/収入（通常/精算）/チャージ/割り勘支払元の参照があれば`deleted_at`へUTC日時を設定し履歴と口座名を保持（子カード経由も対象）、参照なしなら物理削除。成功204。削除済み/他人は404（#368） |
| `GET /api/accounts` | 削除済み口座とその子カードを除外。口座選択肢・残高合計はこの結果を利用 |

削除済み口座は口座編集・再削除・履歴取得で404、新規の収入/支出/カード登録/チャージ元/固定費/精算先で指定不可。全APIは認証必須（未認証401）。過去のNULL口座行・精算収入・残高は遡及更新しない。精算で自動生成される収入の口座は従来どおり任意。#245で口座必須入力と削除済み口座名の表示UIを対応する。

事前照合後に口座が論理削除された場合も、書き込み時のDBガードで400 `VALIDATION_ERROR`として拒否する。同一D1 batch内の支出/収入/チャージ履歴・残高・精算状態をまとめてロールバックする。削除側もbatch内で固定費・子カード残高の禁止条件と履歴参照の有無を再確認する。削除より先に確定した取引は保持して論理削除する（#368）。

### 1-1. 認証

- 以下のエンドポイントは`Authorization`ヘッダー不要（アクセストークンを前提としない）：`/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/password-reset/*`, `/api/auth/account/deletion/cancel`, `/health`
- 認証が必要なAPIでは、退会の申し込み中・退会済みのアカウントを有効なアクセストークンでも401にする（#297）
  - `/api/auth/logout`はリクエストボディのリフレッシュトークンのみで失効処理を行う。アクセストークンが期限切れでもログアウトできる必要があるため（[F01_auth](features/F01_auth.md)参照）。
- 上記以外は`Authorization: Bearer <アクセストークン>`ヘッダーが必須。
- トークンが無い・無効・期限切れの場合は **401 Unauthorized** を返す。
- ログイン・保護対象API・トークン更新ではアカウント状態をサーバー側で確認する。削除申請中アカウントへの新規ログインを拒否し、未失効のアクセストークンが残っていても通常APIとトークン更新を拒否する。許可するのは削除申請取消の専用経路のみ。
- 削除申請取消は通常ログインに依存しないワンタイム資格情報で行う。資格情報はハッシュ化して保存し、使用後は失効させる。資格情報の発行・送信方法はメール基盤を含め実装時に確定する。

### 1-2. 権限エラー

- 自分の世帯グループに属さないリソース、他人が所有するリソースを指定した場合は **404 Not Found** を返す（[common-notes.md](common-notes.md) 10章：IDOR対策のため403は使わない）。

### 1-3. 共通エラーレスポンス形式

```json
{
  "code": "VALIDATION_ERROR",
  "message": "在庫個数は0以上で入力してください",
  "details": [
    { "field": "quantity", "reason": "must be >= 0" }
  ]
}
```

### 1-4. 共通ステータスコード方針

| ステータス | 用途 |
| --- | --- |
| 200 OK | 取得・更新成功 |
| 201 Created | 新規作成成功 |
| 204 No Content | 削除成功 |
| 400 Bad Request | 入力チェックエラー |
| 401 Unauthorized | 未認証・トークン無効/期限切れ |
| 404 Not Found | リソースが存在しない、または他人/他世帯のリソースを指定した場合 |
| 409 Conflict | メールアドレス重複等の一意制約違反 |
| 413 Content Too Large | リクエスト本文が上限を超えた（下記 1-5） |
| 429 Too Many Requests | 回数制限を超えた（「認証・画像解析の回数制限」、パスワード再設定の申請） |

### 1-5. 入力の大きさの上限と、応答の安全用ヘッダー（#512）

- **リクエスト本文の上限**：`/api/*` は 100KB まで。超えると 413 と共通形式のエラー（`code: "VALIDATION_ERROR"`、「送信された内容が大きすぎます」）を返す。画像のアップロード（`POST /api/recipes/ocr/upload`）だけは対象外で、専用の上限（画像 5MB）を使う。
- **レシピの材料・手順**：それぞれ 10,000 文字まで（`POST /api/recipes`・`PATCH /api/recipes/:id`）。超えると 400。既存の行は変更しない（次に編集するときから適用される）。
- **応答ヘッダー**：`/api/*` と `/health` の応答（成功・エラーとも）に次を付ける。

| ヘッダー | 値 | 目的 |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | 応答の種類をブラウザに推測させない |
| `X-Frame-Options` | `DENY` | 他サイトの枠内に表示させない |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` | APIの応答を文書として実行・埋め込みさせない |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 外部へ渡す参照元を最小限にする |
| `Strict-Transport-Security` | `max-age=31536000` | HTTPS での接続を維持する |
| `Cache-Control` | `no-store`（個別に指定済みの応答はその値） | 個人のデータを含む応答をブラウザや中継に残さない |

このほか、Hono の `secureHeaders` の既定値（`Cross-Origin-Resource-Policy: same-origin`・`Cross-Origin-Opener-Policy: same-origin` など）も付く。画面（静的ファイル）の応答は Worker を通らないため、別に設定する（フロントエンド側）。

---

## 2. 認証（F-01）

| メソッド | パス | 説明 |
| --- | --- | --- |
| POST | `/api/auth/register` | ユーザー登録 |
| POST | `/api/auth/login` | ログイン（アクセストークン・リフレッシュトークン発行） |
| GET | `/api/auth/me` | 認証済み本人のID・表示名取得（Workers、#258） |
| POST | `/api/auth/refresh` | リフレッシュトークンでアクセストークン再発行 |
| POST | `/api/auth/logout` | ログアウト（リフレッシュトークンを失効） |
| POST | `/api/auth/password-reset/request` | パスワードリセット申請（メール送信サービス未導入のため、現在はトークンを発行するだけでメールは送らない） |
| POST | `/api/auth/password-reset/confirm` | パスワードリセット実行 |
| GET / PATCH | `/api/auth/account` | 本人のメールアドレス・表示名の取得／表示名の変更（#291） |
| PUT | `/api/auth/password` | 現在のパスワードで再認証してパスワードを変更（#291） |
| PUT | `/api/auth/email` | 現在のパスワードで再認証してメールアドレスを変更（確認メールなしの暫定仕様、#291） |
| GET | `/api/auth/account/deletion-check` | 退会を申し込めるか（未精算の割り勘・他者負担の固定費の件数、#297） |
| POST | `/api/auth/account/deletion` | 再認証して退会を申し込む（30日後に削除、#297） |
| POST | `/api/auth/account/deletion/cancel` | 30日以内に退会を取り消してログイン（#297） |

### GET /api/auth/me（Workers、#258）

`Authorization: Bearer <アクセストークン>` 必須。JWTで認証した本人のIDで `users` を検索し、現在の `{ "id": 1, "displayName": "testuser_太郎" }` のみを200で返す。`id` は数値、`displayName` は登録済みの表示名（1〜50文字）。メールアドレス・パスワードハッシュ等は返さない。リクエストのID指定は本人の識別に使わず、世帯所属も不要。

トークンなし・不正・期限切れ、および認証したIDのユーザーがDBに存在しない場合は、いずれも401と `{ "code": "UNAUTHORIZED", "message": "認証が必要です" }` を返す。JWTの内容、login/refreshの応答、DBスキーマは変更しない。ヘッダーへの表示は後続#257で対応する。

### POST /api/auth/register

リクエスト:
```json
{ "email": "taro@example.com", "password": "Passw0rd", "displayName": "太郎" }
```
レスポンス（201 Created）:
```json
{ "id": 1, "email": "taro@example.com", "displayName": "太郎" }
```
主なエラー：400（入力形式不正・パスワード強度不足）／409（メール重複）／429 `TOO_MANY_REQUESTS`（同じ接続元から1時間に5件を超過。下記「認証・画像解析の回数制限」）

### POST /api/auth/login

リクエスト:
```json
{ "email": "taro@example.com", "password": "Passw0rd" }
```
レスポンス（200 OK）:
```json
{ "accessToken": "xxx.yyy.zzz", "refreshToken": "aaa.bbb.ccc", "expiresIn": 900 }
```
主なエラー：401（メールアドレス/パスワード不一致）／429 `TOO_MANY_REQUESTS`（同じメールアドレスで15分に10回、または同じ接続元から15分に30回を超過。パスワードの正誤・登録の有無に関わらず同一）

### POST /api/auth/refresh

リクエスト:
```json
{ "refreshToken": "aaa.bbb.ccc" }
```
レスポンス（200 OK）:
```json
{ "accessToken": "xxx.yyy.zzz", "expiresIn": 900 }
```
主なエラー：401（リフレッシュトークンが無効・期限切れ・失効済み）

### POST /api/auth/logout

リクエスト:
```json
{ "refreshToken": "aaa.bbb.ccc" }
```
レスポンス：204 No Content（該当`refresh_tokens`レコードの`revoked_at`を設定）

### 認証・画像解析の回数制限（#510）

固定窓で数え、上限を超えた要求は 429 と共通形式のエラー（`code: "TOO_MANY_REQUESTS"`）で返す。入力形式の誤り（400）は数えない。

| 対象のAPI | 数える単位 | 上限 |
| --- | --- | --- |
| `POST /api/auth/login`・`POST /api/auth/account/deletion/cancel`（合算） | メールアドレス（大文字・小文字を区別しない） | 15分に10回 |
| 同上 | 接続元（`CF-Connecting-IP`） | 15分に30回 |
| `POST /api/auth/register` | 接続元 | 1時間に5件 |
| `PUT /api/auth/password`・`PUT /api/auth/email`・`POST /api/auth/account/deletion`（合算） | 利用者 | 15分に10回 |
| `POST /api/recipes/ocr/upload` | 利用者 | 1日に20回 |
| `POST /api/recipes/ocr/analyze` | 利用者 | 1日に20回 |

- パスワードの検証より前に数える。成功した要求も1回に数え、上限を超えた後は正しいパスワードでも窓が替わるまで 429 になる。
- メールアドレスの登録有無によって、応答と数え方は変わらない。
- 接続元を取得できない場合とループバックの場合（ローカル開発・テスト）は、接続元単位の制限を行わない。本番では Cloudflare が必ず実際の接続元を設定する。
- 固定窓のため、窓の境目では瞬間的に上限の最大2倍まで通りうる。
- 画像解析の上限時のメッセージは「画像解析の利用回数が1日の上限に達しました。時間をおいて再度お試しください」。解析が上限のときは一時保存した画像を消さない（24時間後の清掃で消える）。
- パスワード再設定の申請は、別の回数制限（`PASSWORD_RESET_RATE_LIMITED`、#401）を使う。

### GET /api/auth/password-reset/availability

認証不要。再設定メールを利用できるかを返す（フロントエンドが案内を切り替えるために使う）。`Cache-Control: no-store`。設定値（URL・鍵）は返さない。
```json
{ "available": true }
```

### POST /api/auth/password-reset/request

リクエスト:
```json
{ "email": "taro@example.com" }
```
レスポンス（200 OK、メール存在有無・個別の配信失敗に関わらず同一。送信完了とは断定しない）:
```json
{ "message": "入力されたメールアドレスが登録済みの場合、再設定の案内メールを送信します。届かない場合は、しばらく待ってからもう一度お試しください" }
```
主なエラー：400（メール形式不正）、429 `PASSWORD_RESET_RATE_LIMITED`（メール3回/時間・接続元10回/時間・全体50件/日を超過）、503 `PASSWORD_RESET_UNAVAILABLE`（未設定・停止中。メールアドレスの登録有無・入力内容に関わらず同一）。メールは応答の後にGASへ署名付きで送信依頼し、失敗しても応答は変えない。メール内のリンクは `/password-reset#token=<トークン>`。

### POST /api/auth/password-reset/confirm

リクエスト:
```json
{ "token": "reset-token-xxxx", "newPassword": "NewPassw0rd" }
```
レスポンス：200 OK
主なエラー：400（トークン無効・期限切れ・使用済み、パスワード強度不足）

### アカウント設定・退会（実装済み）

契約・エラーは [F01_auth.md](features/F01_auth.md) 8-1章（アカウント設定）・8-2章（退会）を参照。メール送信サービスが未導入のため、要件で想定していた「新アドレスの確認リンク」「削除申請メールのワンタイム資格情報による取り消し」は採用せず、取り消しはメールアドレスとパスワードで本人確認する。

---

## 3. 世帯グループ（F-02）

**MVPでは1ユーザーにつき1世帯グループのみ所属可能**とする（[F02_household](features/F02_household.md)参照）。そのため`/api/households/me`は常に単一の世帯グループを返す。

| メソッド | パス | 説明 |
| --- | --- | --- |
| POST | `/api/households` | 世帯グループ作成（作成者を自動でメンバーに追加。招待コードを自動発行） |
| POST | `/api/households/join` | 招待コードで既存の世帯グループに参加 |
| GET | `/api/households/me` | 自分が所属する世帯グループ情報を取得（招待コードを含む） |
| POST | `/api/households/invite-code/regenerate` | 招待コードを再発行する（漏洩時等に無効化する用途） |
| POST | `/api/households/leave` | 世帯グループから退出する。最後のメンバーなら世帯と世帯のデータを削除する |

### POST /api/households

世帯グループ作成時、`invite_code`をサーバー側でランダム生成（英数字16文字程度）し保存する。既にいずれかの世帯グループに所属しているユーザーがこのAPIを呼んだ場合は400 Bad Requestを返す。

リクエスト:
```json
{ "name": "山田家" }
```
レスポンス（201 Created）:
```json
{ "id": 10, "name": "山田家", "inviteCode": "AB12CD34EF56GH78" }
```

### GET /api/households/me

招待コードはメンバーであれば誰でも閲覧可能とする（他メンバーを招待する目的のため）。

レスポンス（200 OK）:
```json
{ "id": 10, "name": "山田家", "inviteCode": "AB12CD34EF56GH78", "members": [{ "userId": 1, "displayName": "太郎" }] }
```
主なエラー：404（未所属の場合）

### POST /api/households/join

既にいずれかの世帯グループに所属しているユーザーがこのAPIを呼んだ場合は400 Bad Requestを返す。

リクエスト:
```json
{ "inviteCode": "AB12CD34EF56GH78" }
```
レスポンス（200 OK）:
```json
{ "id": 10, "name": "山田家" }
```
主なエラー：404（招待コードが存在しない場合。他人の招待コード探索を防ぐため、コード誤りと期限切れを区別しない）

### POST /api/households/invite-code/regenerate

レスポンス（200 OK）:
```json
{ "inviteCode": "ZZ99YY88XX77WW66" }
```
再発行後、旧コードでの`/api/households/join`は失敗する（404）。

### 世帯管理者・アプリ全体管理者（未実装。候補API）

| メソッド | パス | 説明 |
| --- | --- | --- |
| PATCH | `/api/households/me/members/{userId}/role` | 世帯管理者がメンバーを`admin`/`member`に変更する。世帯管理者のみ許可 |
| PUT | `/api/admin/application-admins/{userId}` | 既存のアプリ全体管理者が、信頼する利用者へアプリ全体管理者権限を付与 |
| DELETE | `/api/admin/application-admins/{userId}` | アプリ全体管理者権限を解除 |
| POST | `/api/admin/exception-access-requests` | 理由・対象・許可操作・期限を指定して例外アクセスを申請 |
| POST | `/api/admin/exception-access-requests/{id}/approve` | 申請者とは別の承認者が例外アクセスを承認 |
| POST | `/api/admin/exception-access-requests/{id}/revoke` | 期限前の例外アクセスを失効 |

すべてのロール判定・対象データ検証はサーバー側で行い、管理者ロールだけで個人コンテンツを返すAPIを設けない。最後の世帯管理者/アプリ全体管理者を単独で解除・降格する操作は拒否し、後任付与との一括引継ぎを必須とする。例外アクセスの実利用も操作・対象・理由・時刻を監査ログへ記録し、有効期限後は拒否する。API名・入力形式は実装Issueで確定する。

---

## 4. 在庫管理（F-07）

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/inventory-items` | 在庫一覧取得 |
| POST | `/api/inventory-items` | 在庫アイテム登録 |
| PATCH | `/api/inventory-items/{id}` | 在庫アイテム編集（品名・カテゴリー・店舗・閾値・任意の値段） |
| PATCH | `/api/inventory-items/{id}/quantity` | 在庫個数の増減（＋/－ボタン用） |
| DELETE | `/api/inventory-items/{id}` | 在庫アイテム削除 |
| GET/POST/PATCH/DELETE | `/api/zaiko-categories` | カテゴリーマスタ管理 |
| GET/POST/PATCH/DELETE | `/api/stores` | 店舗マスタ管理 |

### 在庫カテゴリー名（#337）

POST /api/zaiko-categories と PATCH /api/zaiko-categories/:id のnameは前後空白を除去して1〜50文字。世帯内の前後空白除去後の完全一致を重複とする（大文字小文字・全半角などは追加正規化しない）。デフォルト名は初回GET前も予約し、別世帯の同名は許可する。PATCHは自身を除外し、デフォルトの編集不可は維持する。

重複時は409、code: DUPLICATE_ZAIKO_CATEGORY_NAME、message:「同じ名前のカテゴリーが既に登録されています」、details: []。競合時も新しい重複を作らず、失敗時は保存しない。既存データの一括変更・削除はしない。詳細は[F07](features/F07_zaiko_inventory.md)「在庫カテゴリー名の重複防止」を参照。


### POST /api/inventory-items

リクエスト:
```json
{ "name": "牛乳", "categoryId": 3, "storeId": 5, "quantity": 1.0, "threshold": 0.5, "price": 1280, "dailyConsumption": 0.2, "autoConsumptionEnabled": true }
```
レスポンス（201 Created）:
```json
{ "id": 100, "name": "牛乳", "categoryId": 3, "storeId": 5, "quantity": 1.0, "threshold": 0.5, "price": 1280, "dailyConsumption": 0.2, "autoConsumptionEnabled": true }
```
主なエラー：400（quantity/thresholdが負数等）／409（品名重複、#318）

POST `/api/inventory-items` と PATCH `/api/inventory-items/{id}` は、品名をNFKC正規化・小文字化・前後空白除去・カタカナのひらがな化（#325）をして同一世帯内で比較する。
編集対象自身を除いて一致すれば409、共通形式 `{ code: "DUPLICATE_INVENTORY_ITEM_NAME", message: "同じ品名の在庫が既に登録されています", details: [] }` を返す。
別世帯は対象外。失敗時は在庫・買い物リストを変更しない。既存重複データは維持し、UNIQUE制約は追加しない。

### 値段の共通契約（#235：バックエンド先行）

- 在庫GET（配列の各行）/POST/PATCHは常に `price: number | null` を返す。
- `price` は日本円の整数0〜9,999,999,999、null許容。文字列・負数・小数・上限超過は400で保存値を変更しない。
- 在庫POSTの省略はNULL。PATCHの省略は維持、明示nullはクリア、数値は上書き。
- PATCHの必須入力は従来どおりname/categoryId/storeId/threshold。quantityは数量増減APIで操作する。
- 値段は在庫ID単位で世帯共有し、同名の別IDは独立。世帯メンバーは閲覧・編集可。未認証401、他世帯PATCHは404。
- 数量増減・購入更新はpriceを変更・乗算しない。同時更新は最後に成功した書き込みを保持する。履歴・比較・ダッシュボードへの追加は行わない。
- UIの値段入力・表示は後続Issue。#235では画面を変更しない。

### 日次自動消費の共通契約（#329）

在庫GETの各行・POST・PATCHレスポンスは常に `dailyConsumption: number | null` と `autoConsumptionEnabled: boolean` を含む。基準日・revisionは内部状態であり入出力に公開しない。トグル専用APIは追加しない。

| POST入力 | 結果 |
| --- | --- |
| 両方省略／消費量NULL | 未設定・オフ |
| 正の消費量のみ | 消費量を保存しオン |
| 正の消費量＋enabled=false | 消費量を保存しオフ |
| 消費量NULL／未設定＋enabled=true | 400 |

PATCHの必須項目name/categoryId/storeId/thresholdは維持する。新フィールド省略は現在値維持。消費量NULLはクリアしてオフ、正の消費量だけの指定では現在の有効状態を維持する。enabled=trueは更新後の消費量が設定済みの場合だけ許可する。NULLとtrueの同時指定は400。同値保存は基準日を変えない。

消費量は有限の数値0.1〜99999.9、小数第一位まで、またはNULL。0・負数・小数第二位・上限超過・文字列を拒否し、enabledはbooleanのみとする。未認証401、他世帯404、品名重複409を維持する。競合が連続して保存できない場合は409で再保存を案内する。

登録・再開は操作日のJST日付を基準に翌日1:00から開始。停止・クリア・オン中の消費量変更は直近到来済みの1:00まで旧設定で精算する（JST 0:00〜0:59では前日）。新消費量は翌日から適用し、オフ期間は消費しない。手動数量変更・購入は消費設定・基準日を維持する。日次処理・競合時の詳細は[F07](features/F07_zaiko_inventory.md)を参照。

### PATCH /api/inventory-items/{id}/quantity

リクエスト:
```json
{ "delta": -0.1 }
```
レスポンス（200 OK）:
```json
{ "id": 100, "quantity": 0.9 }
```
主なエラー：400（更新後の値が0未満になる場合。[F07_zaiko_inventory](features/F07_zaiko_inventory.md)参照）／404（他世帯のアイテムを指定）

---

## 5. 買い物リスト（F-08）

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/shopping-list-items` | 買い物リスト取得（並び替えパラメータ対応） |
| POST | `/api/shopping-list-items` | 品目の手動追加 |
| PATCH | `/api/shopping-list-items/{id}` | 予定数をrevision条件付きで保存 |
| DELETE | `/api/shopping-list-items/{id}` | 品目の手動削除 |
| POST | `/api/shopping-list-items/purchases` | 要求ID付き購入・予定残数保持 |
| POST | `/api/shopping-list-items/update` | 購入済みチェック分を一括更新し在庫へ反映 |

### GET /api/shopping-list-items?sort=name|category|store

レスポンス（200 OK）:
```json
[
  { "id": 1, "inventoryItemId": 100, "name": "牛乳", "isManual": false, "purchased": false, "purchasedQuantity": 0, "plannedQuantity": 1, "purchaseRevision": 0, "price": 1280 }
]
```

### POST /api/shopping-list-items

リクエスト例：`{ "inventoryItemId": 100, "price": 980 }`。priceは任意。
成功時は201で、GETと同じ形の単一行（isManual=true、purchased=false、purchasedQuantity=0、plannedQuantity=1、purchaseRevision=0）を返す。priceは常にnumberまたはnull。
price省略は保存値維持、nullはクリア、数値は在庫の値段を上書きする。
リストINSERTと指定priceの在庫UPDATEは単一D1 batchで原子的に行う。重複・UNIQUE競合は400で値段も変更しない。
他世帯の在庫ID・不存在ID・不正入力は400。未認証は401。その他のDB失敗は500でbatch全体をロールバックする。
自動追加は値段をコピーせず、GETが在庫の現在priceを参照する。リスト削除・購入・再追加後も在庫の値段を保持する。

### POST /api/shopping-list-items/update

リクエスト:
```json
{ "items": [{ "id": 1, "purchasedQuantity": 1 }] }
```
レスポンス（200 OK）:
```json
{ "updatedInventoryItems": [{ "id": 100, "quantity": 1.0 }], "removedShoppingListItemIds": [1] }
```

---

## 6. トップ画面ダッシュボード（簡易版）

MVP時点では家計簿機能を含まないため、ダッシュボードは在庫・買い物リストの集計のみを提供する（家計簿系カード・カレンダーはPhase 2で追加）。

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/dashboard/summary` | ダッシュボード用の集計（在庫・家計簿・今日の状況）を取得 |
| GET | `/api/dashboard/calendar?month=YYYY-MM` | 指定月のカレンダー表示用集計を取得 |
| GET | `/api/dashboard/day-detail?date=YYYY-MM-DD` | 選択日の読み取り専用詳細を取得（#446） |
| GET | `/api/dashboard/notifications/today` | 上部ナビゲーション表示用のJST当日通知件数を取得 |

レスポンス（200 OK）:
```json
{
  "shoppingListCount": 3,
  "lowStockCount": 2,
  "householdExpenseTotal": 45300,
  "todayBalance": -500,
  "weeklyMenuEntries": [
    { "recipeId": 1, "recipeTitle": "カレー", "freeTextMemo": null },
    { "recipeId": null, "recipeTitle": null, "freeTextMemo": "外食" }
  ],
  "todayEvents": [
    { "name": "学習", "recurrenceType": "daily" }
  ],
  "monthlyPersonalExpense": 32000,
  "unsettledReceivable": { "count": 1, "total": 4000 },
  "unsettledPayable": { "count": 1, "total": 4500 },
  "eventExpenseSummaries": [
    { "eventId": 1, "name": "旅行", "total": 30000 }
  ]
}
```

- `weeklyMenuEntries` はJST基準の今週（月曜始まり）の同一世帯の献立を登録順に返す。`recipeId` はレシピID（number）で、自由メモはnull。同名レシピもIDで区別できる。レシピ削除後は献立行を残し、`recipeId`・`recipeTitle` はnullになる。献立がなければ空配列を返す。
- `eventPeriod=year|month` でイベント別支出の集計期間を指定する。未指定時は `year`、不正値は400。
- `monthlyPersonalExpense` はJST当月の本人支出、未精算サマリーは精算済みを除いた本人の受取予定／支払予定。イベント別支出は表示対象かつ閲覧可能なイベントを0円を含めて返す。

`GET /api/dashboard/calendar` のレスポンス（200 OK）:
```json
{
  "days": [
    {
      "date": "2026-02-28",
      "fixedCosts": ["家賃"],
      "events": [{ "name": "毎週の予定", "isRecurring": true }],
      "balance": -1200
    }
  ],
  "notificationCount": 1
}
```

- `month` は実在する `YYYY-MM` 形式で必須。不正時は400を返す。
- `fixedCosts` と `events` は世帯共有またはログインユーザー本人の個人データだけを含む。固定費の支払日は月末を超える場合、その月の末日に補正する。
- `balance` はログインユーザー本人の当日の収入合計から支出合計を引いた値。
- `notificationCount` は既存クライアントとの互換性のために残すJST当日の通知有効イベント数であり、新規UIの表示元には使用しない。トップナビゲーションの通知アラームは `GET /api/dashboard/notifications/today` を使用する。

### GET /api/dashboard/day-detail（Workers、#446）

認証必須。実在する `date=YYYY-MM-DD` を必須とする。欠落・不正日付は400 `VALIDATION_ERROR`、未認証は401、所属世帯なしは404 `RESOURCE_NOT_FOUND`。取得障害は既存の500応答とし、空配列や確認不能の成功応答に置き換えない。

200応答の型:

```ts
type FixedCostPostingStatus = 'posted' | 'scheduled' | 'missing' | 'suppressed' | 'not_applicable' | 'unknown'
interface DashboardDayDetail {
  date: string
  weekStartDate: string
  menuEntries: { id: number; recipeId: number | null; recipeTitle: string | null; freeTextMemo: string | null; weekStartDate: string }[]
  events: { id: number; name: string; isRecurring: boolean; recurrenceType: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'; eventDate: string }[]
  finance: {
    income: number; expense: number; balance: number
    incomes: { id: number; incomeDate: string; amount: number; content: string }[]
    expenses: { id: number; expenseDate: string; amount: number; purpose: string; fixedCostId: number | null; fixedCostYearMonth: string | null }[]
  }
  fixedCosts: {
    id: number; name: string; amount: number; paymentDate: string; yearMonth: string
    postingStatus: FixedCostPostingStatus
    postedExpense: { id: number; expenseDate: string; amount: number } | null
  }[]
}
```

- `weekStartDate` は選択日を含む月曜開始週。献立は同世帯の当該週、id昇順。レシピ結合も同世帯に限定し、削除済みレシピのnullを保つ。
- イベントは同世帯の共有または本人所有で、既存の繰り返し規則により選択日に発生するものだけ、id昇順。`eventDate` は原本日付で、発生日はトップの `date`。
- 収入・支出は同世帯かつ本人（earner/payer）の選択日実績だけ、各id降順。合計はこの配列のみから算出し、固定費予定額を加算しない。`balance=income-expense`。件数は配列lengthから求め、差額0円と0件を区別する。
- 本人支出の関連固定費が同世帯かつ共有/本人所有として可視でない場合、補助フィールド `fixedCostId` と `fixedCostYearMonth` は両方null。支出本体は本人の実績として返す。
- 固定費は同世帯の共有/本人所有かつ現在の支払日を選択月の月末に丸めた日が選択日となる登録行、id昇順。`amount` は現在の予定額。`postedExpense` は固定費IDと計上年月を厳密照合した本人の記録実額で、支出日や金額の編集後も予定額と同一視しない。支出日を移動した場合の日次収支は移動先だけに含める。削除済み固定費は復元しない。
- 他者作成の共有固定費は関連支出・抑止の有無にかかわらず `unknown` / `postedExpense:null`。本人作成固定費では本人支出があれば `posted`、支出なしで抑止があれば `suppressed`。両記録があればpostedを優先し、個人情報を含まない固定文で内部警告する。
- 無記録の状態は順に、作成JST日より前の予定日なら `not_applicable`、過去月・不正/欠損履歴なら `unknown`、未来日/当日なら `scheduled`、当月過去日かつ予定日が実在する `effective_from` より後なら `missing`、それ以外は `unknown`。編集前/同日の過去設定を現在値から推測しない。missingは計上失敗や未決済の断定ではない。当日はJST翌日までscheduled。
- GETはSELECTのみ。計上・カテゴリseed・抑止・残高・割勘・表示設定の更新は行わない。当日Cron/当月遅延回収や既存calendarの契約は変更しない。ホーム表示設定・cardOrderと独立し、権限は常に適用する。状態の日本語表示は[F05](features/F05_kakeibo_fixedcost.md)参照。

### GET /api/dashboard/notifications/today

レスポンス（200 OK）:

```json
{ "notificationCount": 1 }
```

- JST当日に発生する通知有効イベントを数える。世帯共有イベントとログインユーザー本人の個人イベントを含み、他メンバーの個人イベントは含めない。
- 月パラメータを必要としない。上部ナビゲーションなど、月間カレンダーと独立した表示で利用する。

---

## 7. 今後の検討事項

- ページネーション方式（一覧系APIの件数が増えた場合の対応）
- OpenAPI 等による API 仕様の自動生成

---

## 8. エンドポイント一覧（Workers 版）

すべて `/api` 配下。`/health` だけは認証不要のヘルスチェック。詳細は各機能の要件定義書を参照。

| 機能 | エンドポイント | 詳細 |
| --- | --- | --- |
| 認証・アカウント | `POST auth/register` `POST auth/login` `POST auth/refresh` `POST auth/logout` `GET auth/me` `POST auth/password-reset/request` `POST auth/password-reset/confirm` `GET/PATCH auth/account` `PUT auth/password` `PUT auth/email` `GET auth/account/deletion-check` `POST auth/account/deletion` `POST auth/account/deletion/cancel` | [F01](features/F01_auth.md) |
| 世帯グループ | `POST households` `POST households/join` `GET households/me` `POST households/invite-code/regenerate` `POST households/leave` | [F02](features/F02_household.md) |
| 支出 | `GET/POST expenses` `PUT/DELETE expenses/:id` | [F03](features/F03_kakeibo_expense.md) |
| 支出カテゴリー | `GET/POST kakeibo-categories` `PATCH/DELETE kakeibo-categories/:id` | [F03](features/F03_kakeibo_expense.md) |
| 割り勘・精算 | `GET expense-splits` `PATCH expense-splits/:id/request` `PATCH expense-splits/:id/mark-paid` `PATCH expense-splits/:id/hold` `PATCH expense-splits/:id/confirm-receipt` `PATCH expense-splits/:id/settle-self` `DELETE expense-splits/:id` `GET/POST expense-splits/:id/comments` | [F04](features/F04_kakeibo_warikan.md) |
| 固定費 | `GET/POST fixed-costs` `PATCH/DELETE fixed-costs/:id` | [F05](features/F05_kakeibo_fixedcost.md) |
| イベント | `GET/POST events` `PATCH/DELETE events/:id` `PATCH events/:id/show-on-dashboard` `GET events/:id/summary` | [F06](features/F06_kakeibo_event.md) |
| 在庫 | `GET/POST inventory-items` `PATCH/DELETE inventory-items/:id` `PATCH inventory-items/:id/quantity` `GET/POST zaiko-categories` `PATCH/DELETE zaiko-categories/:id` `GET/POST stores` `PATCH/DELETE stores/:id` | [F07](features/F07_zaiko_inventory.md) |
| 買い物リスト | `GET/POST shopping-list-items` `DELETE shopping-list-items/:id` `PATCH shopping-list-items/:id` `POST shopping-list-items/purchases` `POST shopping-list-items/update` | [F08](features/F08_zaiko_shoppinglist.md) |
| レシピ | `GET/POST recipes` `POST recipes/from-url` `PATCH/DELETE recipes/:id` `PATCH recipes/:id/favorite` `POST recipes/ocr/upload` `POST recipes/ocr/analyze` | [F09](features/F09_kondate_recipe.md) |
| 献立表 | `GET/POST menu-entries` `DELETE menu-entries/:id` | [F10](features/F10_kondate_menu.md) |
| 口座・カード | `GET/POST accounts` `PATCH/DELETE accounts/:id` `GET accounts/:id/transactions` `POST cards` `PATCH/DELETE cards/:id` `POST cards/:id/charges` | [F11](features/F11_kakeibo_account.md) |
| 収入 | `GET/POST incomes` `PUT/DELETE incomes/:id` `GET/POST income-categories` `PATCH/DELETE income-categories/:id` | [F13](features/F13_kakeibo_income.md) |
| ダッシュボード | `GET dashboard/summary` `GET dashboard/calendar` `GET dashboard/day-detail` `GET dashboard/notifications/today` | 6章・[F12](features/F12_kakeibo_household_summary.md) |
| 表示設定 | `GET/PUT user-settings` | [wireframes.md](wireframes.md) S-21 |


### レシピURLの重複防止（#318）

`POST /api/recipes/from-url` は、入力URLを `new URL()` で解析し、正規化した文字列（`parsedUrl.toString()`）と同一世帯の保存済みURLとの一致で比較する。
一致すれば外部取得・保存を行わず409、共通形式 `{ code: "DUPLICATE_RECIPE_URL", message: "このURLのレシピは既に登録されています", details: [] }` を返す。
保存も従来どおり `parsedUrl.toString()` の形式とする。ホスト名の大小文字やルートの末尾スラッシュの有無（`https://EXAMPLE.com` と `https://example.com/`）はURL正規化により同一になる。パスの大小文字など、正規化後も異なる文字列は別URLとして扱う。
別世帯は対象外。URLなし（null・空文字）のレシピは複数可。既存重複データは維持し、UNIQUE制約は追加しない。
旧/updateは未保護行の従来の入力・応答・数量0処理を維持する。予定編集または部分購入で保護された行を1件でも含む場合、事前検証とbatch内条件の双方で全体409 RESOURCE_CONFLICTとし、在庫を加算しない。旧APIには要求IDによる逐次再送保証がない。

### PATCH /api/shopping-list-items/{id}（#455）

入力は { plannedQuantity:number, expectedPurchaseRevision:number }。予定0.1〜99999.9・小数第一位、revisionは0以上の安全な整数、idは正の安全な整数。予定だけを保存し、同値でも保護フラグを1・purchaseRevisionを1増やす。保存時点の { id, plannedQuantity, purchaseRevision } をRETURNINGから200で返す。在庫は変更しない。不正400、不存在/他世帯404、古いrevisionまたは安全な加算上限409。

### POST /api/shopping-list-items/purchases（#455）

入力例:

```json
{ "requestId": "12345678-1234-4234-8234-123456789abc", "items": [{ "id": 1, "purchasedQuantity": 2, "expectedPurchaseRevision": 1 }] }
```

200応答例（予定3を2だけ購入）:

```json
{ "requestId": "12345678-1234-4234-8234-123456789abc", "updatedInventoryItems": [{ "id": 100, "quantity": 2 }], "removedShoppingListItemIds": [], "remainingShoppingListItems": [{ "id": 1, "plannedQuantity": 1, "purchaseRevision": 2 }] }
```

- requestIdは必須UUID（小文字へ正規化）。空items/重複idは400。idは正の安全な整数、revisionは0以上の安全な整数、実購入数は0〜99999.9・小数第一位。実購入0は存在/CAS検証のみで全列不変、結果配列に含めない。全0は空の3配列を200として保存する。
- 正数量だけを在庫へ全量加算する。予定残数>0は閾値を超えても保持し、保護1/revision+1。買切り・超過は手動行を削除。自動行は更新後在庫が閾値以下なら次予定1/保護0/revision+1、閾値超なら削除。予定・在庫は10倍整数で計算し在庫上限99999.9を守る。安全にrevisionを加算できない正購入は409。
- 3配列は正数量対象だけを要求順に返す。updatedInventoryItems.idは在庫ID、他は買い物行ID。確定時点のsnapshotであり、最新一覧とは別。価格・消費設定・基準日・未対象行は変更しない。
- 認証と現在所属確認の後、actor+世帯+requestIdの保存結果を対象存在/CAS/数量範囲より先に照合する。同bodyは保存HTTP/JSONを再現し、行削除・条件改善後も再購入しない。異bodyは409 SHOPPING_PURCHASE_REQUEST_MISMATCH / details:[{field:'requestId',reason:'PAYLOAD_MISMATCH'}]。元bodyやsnapshotをこの409へ付けない。
- 要求JSONはversion1、要求順のid/purchasedQuantity/expectedPurchaseRevisionのみ。有限数の元値で正規化し、キー順・空白・1と1.0を同一化、配列順を区別する。不正精度を丸めて正常値と同一化しない。
- 初期数量上限400/対象なし404/CASまたはbatch内競合409は、同じ複合PKへ確定拒否を通常INSERTできた場合のみ永続拒否になる。成功batch先頭INSERTとのUNIQUE競争で負けた側は保存済み勝者のHTTP/JSONを返す。保存後の拒否にだけdetails:[{field:'purchase',reason:'PURCHASE_NOT_APPLIED'}]を付ける。codeは400 VALIDATION_ERROR、404 RESOURCE_NOT_FOUND、409 RESOURCE_CONFLICT。
- 不正JSON/UUID/必須値・型/unsafe整数など正規化不能な400、未認証401、現在未所属404にはterminal保証/markerがない。未知SQL・通信障害500、MISMATCH、破損/不完全ledgerは結果不明。旧keyを捨て新keyへ自動移行しない。成功・拒否とも期限削除せず、別actor/別世帯へ結果を流用しない。
- 単一D1 batchの全件guard、相対在庫更新、削除/残数/revision、成功台帳を原子的に確定する。末尾SQLはresponse更新件数1・PK1行・status200・要求順snapshot完全一致をassertし、不成立をSQL例外で全rollbackする。既知named CHECKだけ409候補として拒否INSERT調停へ進み、その他の障害を未反映保証へ変換しない。

後続#421のFEは送信前にactor/世帯別pendingへ元requestId/bodyを保存する。成功200または一致したmarker付き保存拒否だけでpendingを解決し、MISMATCH/未知応答では元body回復を行う。logoutでも未解決記録を保持し、同user同世帯の認証確認後に利用者操作で回復する。別user/別世帯へ表示・送信せず、401refresh後の再送直前にもscope/sessionを照合する。200後のGET失敗は反映済みとして一覧再取得だけを行う。FEの実装・画面検証は#421で行う。
