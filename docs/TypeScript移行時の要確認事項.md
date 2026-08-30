# TypeScript移行時の要確認事項

HomeLogバックエンドのJava→TypeScript(Cloudflare Workers)移行作業中、Codexレビュー等で「既存Java実装とドキュメント(docs/details/features/等)が食い違っている」「既存Java実装自体に改善余地がある」といった指摘が見つかった場合、移行作業では**既存Java実装をそのまま踏襲する**ことを優先し、指摘への対応要否はここに記録してユーザーが後で判断する。

移行方針(既存実装の1対1移植を優先)とは無関係に、TypeScript側だけで発生した実装ミス(Java実装からの意図しない乖離)はその場で修正し、ここには記載しない。あくまで「Java実装とドキュメントの矛盾」「Java実装自体の設計上の余地」に該当するものだけを対象とする。

## 索引

- 2026-08-30: 支出登録レスポンスに口座/カード残高が含まれない(F11ドキュメントとの不一致)

## 記録

### 2026-08-30: 支出登録レスポンスに口座/カード残高が含まれない(F11ドキュメントとの不一致)

- **対象領域・関連ファイル**: backend-workers `src/routes/expenses.ts`(移行元: `backend/src/main/java/com/homelog/kakeibo/dto/response/ExpenseResponse.java`)
- **何が起きたか**: `docs/details/features/F11_kakeibo_account.md`の「支出登録時の口座/カード選択」IPO表には、出力として「口座/カードが紐付いた支出、**更新後の口座またはカード残高**」と明記されている。しかし実際のJava実装の`ExpenseResponse`(`id, expenseDate, amount, purpose, categoryId, memo, includeInHouseholdTotal, accountId, cardId`)、およびフロントエンドの型契約(`frontend/src/api/kakeiboTypes.ts`の`Expense`型)のどちらにも残高フィールドは存在しない。Codexレビューでこの食い違いを指摘されたが、移行方針(既存Java実装への1対1移植)に従い、TypeScript版もJava実装通りレスポンスに残高を含めない形とした。
- **現状の対応**: 未対応(Java実装のまま)。支出登録後に最新残高を確認したい場合、呼び出し側(フロントエンド)は別途`GET /api/accounts`を呼ぶ必要がある。
- **要判断事項**: ドキュメント通りに支出登録レスポンスへ残高を含める改修を行うか。行う場合はJava版・TypeScript版の両方(または全面移行完了後はTypeScript版のみ)への対応と、フロントエンドの型・呼び出し側コードの更新が必要になる。
- **状態**: 未判断(ユーザー確認待ち)
