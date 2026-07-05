# API設計（MVP範囲）

[← 要件定義書に戻る](../requirements.md)

MVPスコープ（認証・世帯グループ・在庫管理・買い物リスト・トップ簡易ダッシュボード）のREST APIエンドポイントを定義する。家計簿・献立表等のPhase 2以降の機能のAPIは、着手時に追記する。

エンドポイントパスや型は実装時に変更されうる暫定仕様であり、詳細はController実装時にOpenAPI（springdoc）で確定させる（[技術スタック.md](../技術スタック.md)参照）。

---

## 1. 共通仕様

### 1-1. 認証

- ログイン系エンドポイント（登録・ログイン・リフレッシュ・パスワードリセット）以外は、`Authorization: Bearer <アクセストークン>`ヘッダーが必須。
- トークンが無い・無効・期限切れの場合は **401 Unauthorized** を返す。

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
| POST | `/api/auth/refresh` | リフレッシュトークンでアクセストークン再発行 |
| POST | `/api/auth/logout` | ログアウト（リフレッシュトークンを失効） |
| POST | `/api/auth/password-reset/request` | パスワードリセット申請（メール送信） |
| POST | `/api/auth/password-reset/confirm` | パスワードリセット実行 |

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

---

## 3. 世帯グループ（F-02）

| メソッド | パス | 説明 |
| --- | --- | --- |
| POST | `/api/households` | 世帯グループ作成（作成者を自動でメンバーに追加） |
| POST | `/api/households/join` | 招待コードで既存の世帯グループに参加 |
| GET | `/api/households/me` | 自分が所属する世帯グループ情報を取得 |

### POST /api/households

リクエスト:
```json
{ "name": "山田家" }
```
レスポンス（201 Created）:
```json
{ "id": 10, "name": "山田家" }
```

### GET /api/households/me

レスポンス（200 OK）:
```json
{ "id": 10, "name": "山田家", "members": [{ "userId": 1, "displayName": "太郎" }] }
```
主なエラー：404（未所属の場合）

---

## 4. 在庫管理（F-07）

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/inventory-items` | 在庫一覧取得 |
| POST | `/api/inventory-items` | 在庫アイテム登録 |
| PATCH | `/api/inventory-items/{id}` | 在庫アイテム編集（品名・カテゴリー・店舗・閾値） |
| PATCH | `/api/inventory-items/{id}/quantity` | 在庫個数の増減（＋/－ボタン用） |
| DELETE | `/api/inventory-items/{id}` | 在庫アイテム削除 |
| GET/POST/PATCH/DELETE | `/api/zaiko-categories` | カテゴリーマスタ管理 |
| GET/POST/PATCH/DELETE | `/api/stores` | 店舗マスタ管理 |

### POST /api/inventory-items

リクエスト:
```json
{ "name": "牛乳", "categoryId": 3, "storeId": 5, "quantity": 1.0, "threshold": 0.5 }
```
レスポンス（201 Created）:
```json
{ "id": 100, "name": "牛乳", "categoryId": 3, "storeId": 5, "quantity": 1.0, "threshold": 0.5 }
```
主なエラー：400（quantity/thresholdが負数等）

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
  { "id": 1, "inventoryItemId": 100, "name": "牛乳", "isManual": false, "purchased": false, "purchasedQuantity": 0 }
]
```

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
| GET | `/api/dashboard/summary` | 買い物リスト件数・在庫不足件数等を取得 |

レスポンス（200 OK）:
```json
{ "shoppingListCount": 3, "lowStockCount": 2 }
```

---

## 7. 今後の検討事項

- 家計簿（F-03〜F-06, F-11, F-12）・献立表（F-09, F-10）のAPI設計はPhase 2着手時に本ファイルへ追記する
- ページネーション方式（一覧系APIの件数が増えた場合の対応）
- springdoc-openapiによる自動生成ドキュメントとの整合方法
