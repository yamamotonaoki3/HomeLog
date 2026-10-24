# 過去週の献立自動削除 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 実装開始の指示を受けるまでは実装しない。

**Goal:** 日本時間で先週以前の献立だけを自動削除し、今週・未来の献立と元レシピを保持する。

**Architecture:** 期限判定と単一DELETEを専用関数へ分離する。JST 0時の献立専用Cronと既存JST 1時の日次Cronから呼び出し、既存業務と失敗を隔離する。

**Tech Stack:** 既存のTypeScript / Hono / Cloudflare Workers / D1 / Drizzle / Vitest / Playwright。新規依存なし。

**Spec:** ユーザー合意と https://github.com/yamamotonaoki3/HomeLog/issues/362 。保持期限を変更するためF10とデータモデルを実装と同時に更新する。

## Global Constraints

- 新機能はbackend-workersへ実装し、テストは専用ローカルD1のみを使う。
- 実装はTDD、追加レビュー、CIで検証する。
- 本番反映および実データ削除は本番反映指示を待つ。

## Review Focus

- JST月曜0時の前後：日曜中の早すぎる削除を防ぐ。
- 年越し：前年の日付も文字列比較と週計算で正しく扱う。
- 複数世帯と元レシピ：削除対象以外を変えない。
- Cronの遅延・失敗・再実行：実時刻の週で安全に再処理する。
- Cron追加：既存の在庫・固定費等を余分に実行しない。

以下にIssue本文の実装手順・検証項目を記載する。

## 目的
日本時間の週替わり後、不要になった先週以前の献立登録を自動削除し、今週と未来の献立だけを保持する。

## 対象・参照ドキュメント
バックエンドの独立したIssueとする。
- docs/details/features/F10_kondate_menu.md
- docs/details/data-model.md（menu_entries）
- docs/details/common-notes.md
- docs/requirements.md、docs/lessons-learned.md
- backend-workers/src/db/schema.ts、src/routes/menu-entries.ts、src/index.ts、src/lib/date.ts、wrangler.toml

## 合意した仕様・設計
- 週の開始は日本時間の月曜日0時。week_start_dateが今週の月曜日より前のmenu_entriesを全世帯について物理削除する。
- 今週・未来の献立、元のrecipes、在庫、家計簿は変更しない。
- 初回実行では、既存の過去週の献立も削除対象になる。本番への反映・実データ削除は本番反映指示を待つ。
- 毎日JST 0時（UTC 15時、0 15 * * *）の献立専用Cronを追加する。毎日JST 1時の既存Cronは維持し、削除の再試行も行う。追加Cronでは既存の固定費計上・在庫消費等を余分に実行しない。
- Cronの厳密な定刻実行は保証しない。失敗・停止があっても次回実行で過去週をまとめて処理し、繰り返し実行しても安全にする。
- 削除基準は実際の実行時刻のJSTの週とする。予定時刻はログ等に使えても、遅延した古い予定時刻を保持期限の基準にしない。
- 他の日次処理とはPromise.allSettled等で失敗を隔離し、失敗は既存のログ方針に合わせて記録する。個別献立や秘密情報はログに出さない。
- 既存の先週・次週への移動、過去週への登録APIは変更しない。削除後の過去週表示は空リストとなり、過去週へ再登録された分は次回の削除対象になる。

## 実装計画（TDD）
1. backend-workers/src/test/lib/menu-entry-cleanup.test.tsを追加。複数世帯、レシピ指定・自由メモ、過去週のみ削除、今週・未来・元レシピ保持、再実行、空DB、JST日曜23:59→月曜0時、年越し、失敗後の再実行をテストしredを確認する。
2. backend-workers/src/lib/menu-entry-cleanup.tsにpurgePastMenuEntries(db: D1Database, now: Date): Promise<number>を実装。nowはUTCの実時刻を受け取り、JSTへ変換して既存currentWeekStartを使う。week_start_date < 基準日の単一DELETEで削除件数を返す。DB定義変更・新依存は不要。
3. backend-workers/src/test/scheduled.test.tsに専用Cron分岐、日次Cronからの呼出し、削除失敗時の他処理続行、他処理失敗時の削除実行、予定時刻と実時刻のずれを検証するテストを追加しredを確認。src/index.tsとwrangler.tomlへ接続してgreenにする。
4. API層E2Eをe2e/tests/menu-entry-cleanup-api.spec.tsへ追加する。専用ローカルD1だけに過去・今週・未来のテスト献立を用意し、ローカルWorkersのscheduledイベント経路を起動して、実APIで過去週が空・今週と未来と元レシピが保持されることを検証する。既存console-guardを利用し、作成したページは操作前にwatchする。
5. ローカルscheduledイベントの起動方法を、実装時に導入済みWranglerのhelpと実機で確認する。必要ならE2E専用設定・supportを最小限追加する。公開APIや本番用管理エンドポイントは追加しない。起動経路を構成できない場合は黙って省略せず、理由とscheduled統合テスト・実D1削除テストによる代替担保を報告する。
6. F10とdata-modelの保持期間、必要ならapi-design・deploymentの定期処理説明を更新する。過去の献立が消えること、元レシピは残ること、初回の既存データ削除を明記する。
7. backend-workers直下でnpm run lint、npm run typecheck、npm test。ローカルの専用D1で対象API層E2Eと既存kondate.spec.tsを実行し後始末を確認する。E2E追加が定期削除を実際に通っているか内容を確認する。
8. セルフレビュー、codex review --base main（未コミットなら--uncommitted）、指摘解消、ユーザー指示後のコミット・push・PR・CI確認。本番反映は別途指示を待つ。

## 受け入れ基準
- [x] JSTの週を基準に先週以前だけが全世帯について削除される。
- [x] 日曜のうちはその週を消さず、月曜になってから先週分を消す。月末・年末でも正しい。
- [x] 今週・未来の献立と元レシピは保持される。
- [x] 多重実行、対象0件、数日以上の停止後の再開で正しく動く。
- [x] 既存の日次処理を余分に実行せず、相互の失敗を隔離する。
- [x] 実際の削除経路を通るテストとAPI層E2Eで検証する。実行できない場合は理由と代替を報告する。
- [x] 保存期間と削除の仕様を関連資料へ反映する。
- [ ] lint/typecheck/testとCIが成功し、Codexレビューの指摘を解消する。

## 依存関係・範囲外
依存Issueなし。フロントエンド変更、過去週への登録禁止、一括手動削除UI、復元・アーカイブ機能、既存定期処理の再設計は対象外。本Issue作成段階では本番データを削除しない。

## 実装記録

- Task 1: complete — 削除関数の未実装によるredを確認後、実D1の削除・保持・週境界・年越し・再実行・失敗回復の5テストがgreen。
- Task 2: complete — scheduled接続前の6テストのredを確認後、専用Cronと日次Cronの接続・失敗隔離がgreen。
- Task 3: complete — API層E2Eは実scheduledハンドラと専用ローカルD1で削除・保持・再実行を検証。
- Ruling: 全世帯の削除で他のspecの過去週データを消さないよう、専用Playwright設定とCIステップで分離する。
- Ruling: 本体のassetsが `/__scheduled` にHTMLを返すことを再現したため、E2E専用Wrangler設定でassetsを外す。公開用エンドポイントは追加せず、本体と同じエントリポイントとマイグレーションを使う。
- 最終検証: backend全644件成功、backend lint/typecheck成功、frontend build成功、scheduled API層E2E 1件成功、既存kondate E2E 9件成功（1280/390/320pxを含む）。各E2E終了後の専用DB残数0。
- codex review --uncommitted: 指摘なし。レビュー側のtypecheckはspawn EPERMで未完了だったが、実装側では制限外でtypecheckの成功を確認済み。
- CIは未実行（コミット・push前）。
- コミット・pushはユーザーの指示後。本番反映は別途指示を待つ。
