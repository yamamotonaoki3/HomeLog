# 割り勘の精算・削除競合修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** #391 の精算と削除の競合で、精算記録と残高の整合性が崩れないようにする。

**Architecture:** 未精算内訳の削除SQLに状態・世帯・立替者の条件を含める。読込後に精算や削除が確定していた場合は409を返し、精算取消処理へ勝手に切り替えない。既存の世帯外settledの専用取消処理は維持する。

**Tech Stack:** Hono / TypeScript / Cloudflare D1 / Vitest / Playwright

**Spec:** GitHub Issue #391、`docs/details/features/F04_kakeibo_warikan.md`、`docs/details/common-notes.md`

## Global Constraints

- 本人・世帯の認可、世帯内settledの削除禁止、自動精算明細の編集・削除禁止を維持する。
- 本番・ステージングへテスト接続しない。秘密情報を出力しない。
- コミット・pushはユーザー指示を待つ。本番反映は含めない。

## Review Focus

- 世帯内精算が先に確定した場合、内訳・自動明細・残高を維持する。
- 世帯外精算が先に確定した場合、古い未精算削除から取消を起こさない。
- 削除が先に確定した場合、精算による明細と残高の移動を起こさない。
- 重複削除でも成功を偽装せず、他の内訳を変更しない。
- 他人・別世帯の内訳は既存どおり404で拒否する。

## Task 1: 条件付き削除と回帰検証

**Files:**
- Modify: `backend-workers/src/routes/expense-splits.ts`
- Test: `backend-workers/src/test/routes/expense-splits.test.ts`
- Create: `e2e/tests/split-delete-api.spec.ts`
- Modify: `docs/details/features/F04_kakeibo_warikan.md`

- [x] D1実行直前に別の実API操作を挿入し、精算先行の世帯内・世帯外テストを書いてredを確認する。
- [x] 削除SQLに未精算状態・世帯・立替者の条件を入れ、0件なら409とする。
- [x] 削除先行の精算、重複削除、通常削除、既存の世帯外取消を検証する。
- [x] ローカルAPI層E2Eで、未精算削除と精算済み削除禁止、自動明細の保護を検証する。
- [x] 仕様に競合時409を追記する。
- [x] backend-workers全体のlint/typecheck/testとE2Eを実行する。
- [x] `codex review --uncommitted`でレビューし、指摘を解消して再検証する。

## 検証記録（2026-10-29）

- RED: 割り勘テスト41件のうち追加した競合3件が期待した409に対して204となり失敗、38件成功。
- GREEN: 割り勘テスト41件成功。逆順（削除先行）では精算が拒否され、明細・残高移動がないことも確認。
- バックエンド全体: `npm run lint`、`npm run typecheck`成功。`npm test`は44ファイル・651件成功。
- E2E全体: `npm test -- --workers=4`は176成功・1スキップ・1失敗。追加したAPI E2Eは成功。
- 全体E2Eの失敗は既存の`display-settings.spec.ts:27`で、カード順と表示OFFの状態が期待と不一致。今回の変更で該当画面・設定APIは変更していない。今回の修正との因果関係は確認できていない。
- 切り分け: `npm test -- tests/display-settings.spec.ts tests/split-delete-api.spec.ts --workers=1 --repeat-each=3`は9件成功。並列時の失敗原因の確定・修正は本Issueの対象外として残す。
- Codexレビュー: 修正指摘なし。レビュー側の動的検証はspawn EPERMで実行不能だったため、上記の全体検証を呼出元で実行して補完した。レビューログはリポジトリ外に保存。
- `git diff --check`成功。コミット・push・PR作成・本番反映は未実施。

## 後続

#392 → #393 → #394 を各Issueの専用ブランチで実施する。#395はサービス選定・復旧案内の設計を確定し、#396は既存データの設定履歴不足の扱いを確認して進める。
