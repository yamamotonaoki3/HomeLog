# 削除済み口座の精算取消 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** #392 の口座削除後の世帯外精算取消を可能にする。

**Architecture:** 既存の精算取消バッチの残高補正を未削除口座だけに制限する。削除済み口座の残高・削除状態・新規取引禁止トリガーは維持し、自動精算明細と内訳だけを同一バッチで削除する。

**Tech Stack:** Hono / TypeScript / D1 / Vitest / Playwright

**Spec:** Issue #392、F04_kakeibo_warikan.md、F11_kakeibo_account.md、common-notes.md

## Global Constraints

- 世帯内settledの削除禁止、認可、#391の競合防止を維持する。
- 本番反映は全作業終了後にユーザー指示を待つ。
- コミット・pushはユーザー指示を待つ。

## Review Focus

- 削除済み口座は残高・削除状態を変更せず、復活させない。
- 有効口座の通常の取消では従来どおり残高を戻す。
- 二重削除で残高を二重補正しない。
- 口座未指定・旧明細・世帯内精算の既存動作を保つ。
- 取消と口座削除が重なってもトランザクション内の状態で残高補正対象を判断する。

## Task 1

**Files:** `backend-workers/src/routes/expense-splits.ts`、同テスト、`e2e/tests/warikan-settled-delete-api.spec.ts`、F04/F11仕様。

- [x] 精算→口座削除→内訳削除のテストを書き、400となるREDを確認する。
- [x] 残高補正対象に`deleted_at IS NULL`条件を追加する。
- [x] 削除済み残高の維持、明細取消、重複削除、既存の有効口座・口座なし取消を検証する。
- [x] ローカルAPI E2Eで実際の操作順を確認する。
- [x] 合意済みの例外（精算取消で履歴削除、口座残高は固定）を仕様に明記する。
- [x] バックエンド全体lint/typecheck/testとE2E全体を実施し、Codexレビューを行う。

## 検証記録（2026-10-29）

- RED: 追加した口座削除後の精算取消テストが失敗し、既存41件は成功。
- GREEN: 割り勘テスト42件成功。削除済み口座の残高・削除日時の維持、無関係な有効口座の残高維持、二重削除の200/404、精算明細削除を確認。
- バックエンド全体: lint/typecheck成功、44ファイル・652件成功。
- E2E全体: `npm test -- --workers=4`は177成功・1スキップ・1失敗。新設の削除済み口座の精算取消API契約と、有効口座の既存契約は両方成功。
- 全体E2Eでの失敗: 既存`warikan.spec.ts:177`の390px削除確認ダイアログから「口座の残高を元に戻します」が欠落する、以前から確認されていた並列時の事象。今回、フロントエンドは変更していない。失敗時の記録をリポジトリ外に保存して切り分けを実施する。
- `codex review --uncommitted`: 修正指摘なし。レビュー側でテストは実行していないため、動的検証は上記の実行結果で補完。
- 切り分け: `npm test -- tests/warikan.spec.ts tests/warikan-settled-delete-api.spec.ts --workers=1 --repeat-each=3`は18件成功。全体並列実行での既存ダイアログの失敗原因は本Issueで変更せず、検証上の制約として残す。
- `git diff --check`成功。
- コミット・push・PR作成・本番反映は未実施。本番反映は全Issue対応後のユーザー指示を待つ。
