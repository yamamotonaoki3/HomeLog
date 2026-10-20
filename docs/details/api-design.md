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
| `DELETE /api/accounts/:id` | 支出/チャージ/固定費参照や子カードの既存削除禁止を優先。収入（通常/精算）参照ありなら`deleted_at`へUTC日時を設定、なしなら物理削除。成功204。削除済み/他人は404 |
| `GET /api/accounts` | 削除済み口座とその子カードを除外。口座選択肢・残高合計はこの結果を利用 |

削除済み口座は口座編集・再削除・履歴取得で404、新規の収入/支出/カード登録/チャージ元/固定費/精算先で指定不可。全APIは認証必須（未認証401）。過去のNULL口座行・精算収入・残高は遡及更新しない。精算で自動生成される収入の口座は従来どおり任意。#245で口座必須入力と削除済み口座名の表示UIを対応する。

事前照合後に口座が論理削除された場合も、書き込み時のDBガードで400 `VALIDATION_ERROR`として拒否する。同一D1 batch内の支出/収入/チャージ履歴・残高・精算状態をまとめてロールバックする。削除側もbatch内で支出/チャージ/固定費/子カード残高の禁止条件を再確認する。

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
主なエラー：400（入力形式不正・パスワード強度不足）／409（メール重複）

### POST /api/auth/login

リクエスト:
```json
{ "email": "taro@example.com", "password": "Passw0rd" }
```
レスポンス（200 OK）:
```json
{ "accessToken": "xxx.yyy.zzz", "refreshToken": "aaa.bbb.ccc", "expiresIn": 900 }
```
主なエラー：401（メールアドレス/パスワード不一致）

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

### POST /api/auth/password-reset/request

リクエスト:
```json
{ "email": "taro@example.com" }
```
レスポンス（200 OK、メール存在有無に関わらず同一メッセージ）:
```json
{ "message": "パスワードリセット用のメールを送信しました（該当アカウントが存在する場合）" }
```

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
| DELETE | `/api/shopping-list-items/{id}` | 品目の手動削除 |
| POST | `/api/shopping-list-items/update` | 購入済みチェック分を一括更新し在庫へ反映 |

### GET /api/shopping-list-items?sort=name|category|store

レスポンス（200 OK）:
```json
[
  { "id": 1, "inventoryItemId": 100, "name": "牛乳", "isManual": false, "purchased": false, "purchasedQuantity": 0, "price": 1280 }
]
```

### POST /api/shopping-list-items

リクエスト例：`{ "inventoryItemId": 100, "price": 980 }`。priceは任意。
成功時は201で、GETと同じ形の単一行（isManual=true、purchased=false、purchasedQuantity=0）を返す。priceは常にnumberまたはnull。
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
| 買い物リスト | `GET/POST shopping-list-items` `DELETE shopping-list-items/:id` `POST shopping-list-items/update` | [F08](features/F08_zaiko_shoppinglist.md) |
| レシピ | `GET/POST recipes` `POST recipes/from-url` `PATCH/DELETE recipes/:id` `PATCH recipes/:id/favorite` `POST recipes/ocr/upload` `POST recipes/ocr/analyze` | [F09](features/F09_kondate_recipe.md) |
| 献立表 | `GET/POST menu-entries` `DELETE menu-entries/:id` | [F10](features/F10_kondate_menu.md) |
| 口座・カード | `GET/POST accounts` `PATCH/DELETE accounts/:id` `GET accounts/:id/transactions` `POST cards` `PATCH/DELETE cards/:id` `POST cards/:id/charges` | [F11](features/F11_kakeibo_account.md) |
| 収入 | `GET/POST incomes` `PUT/DELETE incomes/:id` `GET/POST income-categories` `PATCH/DELETE income-categories/:id` | [F13](features/F13_kakeibo_income.md) |
| ダッシュボード | `GET dashboard/summary` `GET dashboard/calendar` `GET dashboard/notifications/today` | 6章・[F12](features/F12_kakeibo_household_summary.md) |
| 表示設定 | `GET/PUT user-settings` | [wireframes.md](wireframes.md) S-21 |


### レシピURLの重複防止（#318）

`POST /api/recipes/from-url` は、入力URLを `new URL()` で解析し、正規化した文字列（`parsedUrl.toString()`）と同一世帯の保存済みURLとの一致で比較する。
一致すれば外部取得・保存を行わず409、共通形式 `{ code: "DUPLICATE_RECIPE_URL", message: "このURLのレシピは既に登録されています", details: [] }` を返す。
保存も従来どおり `parsedUrl.toString()` の形式とする。ホスト名の大小文字やルートの末尾スラッシュの有無（`https://EXAMPLE.com` と `https://example.com/`）はURL正規化により同一になる。パスの大小文字など、正規化後も異なる文字列は別URLとして扱う。
別世帯は対象外。URLなし（null・空文字）のレシピは複数可。既存重複データは維持し、UNIQUE制約は追加しない。
