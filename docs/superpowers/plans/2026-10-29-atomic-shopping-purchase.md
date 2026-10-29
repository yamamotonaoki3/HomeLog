# 買い物の全件反映 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** #394 の一括購入を全件成功または全件未反映に統一する。

**Architecture:** バインドしたJSONから要求行を展開し、購入専用revision・世帯・リストと在庫の対応・数量上限を検証した適格行をMATERIALIZED CTEに固定する。全行が適格な場合だけ単一UPDATEで在庫を加算する。同じD1 batchの後続の購入入力リセット・revision更新・リスト削除も、直前の更新件数が全行分である場合のみ実行する。適格でなければ書込はすべて0件となり409を返し、SQL例外ならD1 batch全体をロールバックする。

**Tech Stack:** Hono / TypeScript / D1 SQLite(JSON / MATERIALIZED CTE) / Vitest / Playwright。依存追加なし。migration 0022で内部のpurchase_revisionを追加する。

**Spec:** Issue #394、F08_zaiko_shoppinglist.md、F07_zaiko_inventory.md、common-notes.md

## Global Constraints

- 本番反映は全作業後の指示を待つ。コミット・pushもユーザー指示を待つ。
- 既存の事前検証404/400、数量の0.1刻み、重複ID拒否、API成功応答を維持する。
- 手動追加は購入後削除、自動追加は閾値以下なら残して入力リセットする。
- バッチ前に読んだ購入revisionが変わっていたら競合とする。Cronや手動調整による数量変化は許容するが、上限超過なら全件拒否する。既に完了した購入後に新たに送られた独立要求の冪等性は今回追加しない。

## Review Focus

- 先頭・中間・末尾のリスト削除、在庫削除、上限到達で他品目を変更しない。
- 同じ未反映状態を読んだ購入要求同士は一方だけを適用する。
- MATERIALIZED CTEで更新前の適格性を固定し、先行行の更新で後続行の適格性が変わらない。
- 更新0件を成功扱いせず、購入入力やリスト削除も実行しない。
- 応答の数量・削除IDは同じバッチのRETURNING結果に基づき、後続の別要求を混ぜない。

## Task 1

**Files:** `backend-workers/src/routes/shopping-list-items.ts`、同テスト、`backend-workers/src/db/schema.ts`、`backend-workers/drizzle/0022_shopping_purchase_revision.sql`、`e2e/tests/shopping-purchase-atomic-api.spec.ts`、F08仕様。

- [x] 9通りの競合と自動追加品の同時購入の失敗テストを書く。
- [x] REDを確認してから、条件付き一括UPDATEと後続操作の全件ガードを実装する。
- [x] GREEN、複数行正常系、手動/自動の削除・リセットと数量0を確認する。
- [x] ローカルAPI E2Eで、全件成功・不正品目による全件拒否・同時購入を検証する。
- [x] 409と全件反映の仕様を更新する。
- [x] 全体lint/typecheck/test、E2E全体、Codexレビューを行う。

## 実装判断の記録

- 初期の数量一致による競合判定は、F08 §7のCronとの直列化契約に不要な409を発生させることが追加テストで判明したため採用しない。購入時だけ増えるrevisionに変更し、日次消費や通常の数量調整との共存を維持する。DB内の内部列のみを追加し、APIの入力・出力は変更しない。

## 検証記録（2026-10-29）

- RED: 先頭・中間・末尾でのリスト削除/在庫削除/上限到達の9件と、自動品目の重複購入1件で、期待409に対して200となる失敗を確認。既存10件は成功。
- 日次消費との契約を追加テストで確認し、数量一致方式では409となる失敗を確認してからrevision方式へ変更。
- GREEN: 買い物ルート23件成功。日次消費との組合せ確認時も両ファイルで71件成功（その後に正常複数行・SQLエラーロールバックの2件を追加）。
- バックエンド全体: lint/typecheck成功、44ファイル・670件成功。
- E2E全体: `npm test -- --workers=4`は180件成功・1件スキップ・失敗なし。追加API E2Eで全件拒否・同時購入の1回だけの加算・応答とDB状態の一致を確認。
- `codex review --uncommitted`: 修正指摘なし。レビュー側のテスト起動はspawn EPERMとなったため、動的検証は呼出元の上記実行で補完。
- `git diff --check`成功。
- migration 0022はローカルテストで適用済み。本番DBには適用していない。コミット・push・PR作成・本番反映は未実施。
