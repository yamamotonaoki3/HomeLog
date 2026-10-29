# 口座履歴の同時点取得 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** #393 の取引明細と現在残高の取得時点を一致させる。

**Architecture:** 有効な本人所有口座の残高と、支出・収入・チャージ明細を単一D1 batchで取得する。口座の存在判定と残高逆算はバッチ結果に基づいて行い、応答形式・並び順は維持する。

**Tech Stack:** Hono / TypeScript / D1 / Vitest / Playwright

**Spec:** Issue #393、F11_kakeibo_account.md、common-notes.md

## Global Constraints

- 口座は本人のみ閲覧でき、他人・不存在・削除済みの口座は404。
- 本番反映は全作業後のユーザー指示を待つ。コミット・pushも指示を待つ。
- 同一秒の異種取引の既存の並び順は変更しない。

## Review Focus

- 入金・支出・チャージが履歴取得と重なっても全明細の残高が整合する。
- 取得前に口座が削除された場合、古い口座情報を返さない。
- 同一世帯でも他人の口座・明細を返さない。
- 空の履歴と既存のクレジットカード取引を保持する。
- バッチ内の口座確認と各明細検索に同じ認可条件を使う。

## Task 1

**Files:** `backend-workers/src/routes/accounts.ts`、`backend-workers/src/test/routes/accounts-cards.test.ts`、`e2e/tests/account-history-consistency-api.spec.ts`、F11仕様。

- [x] 履歴バッチ直前の実APIによる入金・支出・チャージと口座削除の回帰テストを書き、REDを確認する。
- [x] 残高と3種の明細を認可条件付きの同一バッチで取得し、GREENを確認する。
- [x] ローカルAPI E2Eで同時入金時の応答内整合性と本人限定アクセスを確認する。
- [x] 仕様に同時点取得を明記する。
- [x] バックエンド全体lint/typecheck/test、E2E全体、Codexレビューを実施する。

## 検証記録（2026-10-29）

- RED: 修正前の実装で、入金・支出・チャージの取得競合3件が古い残高9950を返して失敗。削除競合も404を期待して200となり失敗。同一世帯の他人の口座は404を維持。
- テストの時刻条件は、同一秒の異種取引について受容済みの並び順制約から分離するため、先行する支出のcreated_atを固定した。チャージAPIの成功応答は既存契約の200として検証する。
- GREEN: 口座・カードテスト24件成功。バックエンド全体のlint/typecheck成功、44ファイル・657件成功。
- Codexレビュー: `codex review --uncommitted`は修正指摘なし。レビュー側ではテストを実行していないため、動的検証は呼出元で補完。
- E2E全体: `npm test -- --workers=4`は179件成功・1件スキップ・失敗なし。追加API E2Eでは10回の入金と履歴取得の並行要求ごとに、現在残高と全明細の取引後残高を確認し、同世帯の別人と削除後の取得を404で拒否することも確認。
- `git diff --check`成功。
- コミット・push・PR作成・本番反映は未実施。
