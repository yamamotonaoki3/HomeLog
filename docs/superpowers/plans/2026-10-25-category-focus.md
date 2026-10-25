# カテゴリー追加後のフォーカス復帰 実装計画

> 実行: superpowers:executing-plans。ユーザーから別Issueでの修正指示を受けた範囲のみ実装する。

**Goal:** 登録・編集モーダルでカテゴリー追加後のフォーカスを確実に選択欄へ戻す。
**Architecture:** 成功時のフォーカス復帰要求をrefに保持し、DOM更新後のeffectでロック解除・入力フォーム終了を確認して一度だけ戻す。非表示・未接続のselectは対象外。
**Tech Stack:** 既存React / TypeScript / Vitest / Testing Library / Playwright。依存追加なし。
**Spec:** https://github.com/yamamotonaoki3/HomeLog/issues/365 。F07とcommon-notesの既存フォーカス・入力保持要件を維持する。

## 制約・レビュー観点

- main基準。#364のヘッダー固定は含めず、元の変更をstashに保持する。
- 修正対象はカテゴリー追加成功時のフォーカス復帰。共有モーダルやAPI・DBへ広げない。
- 失敗時の入力保持、追加中ロック、連打防止、取りやめ、閉じる、在庫情報の保存を維持する。
- rAFがDOM更新前に実行される順序を固定したテストでredを確認する。登録・編集を対象にする。
- 一度戻した後の通常入力からフォーカスを奪わない。
- 既存E2Eの期待値・タイムアウト・通常CIの並列数を弱めない。

## 手順と進捗

- [x] 修正前: コンポーネントテストの登録・編集2件で、有効化後もBODYにフォーカスが残るredを確認。
- [x] 最小修正: 早すぎるrAFをeffectへ置換。既存分を含むカテゴリー11件がgreen。
- [x] frontend全体のlint/test/buildを実行。
- [x] 既存カテゴリーE2Eを3画面幅×4回、6ワーカーで並列反復し、専用DBの後始末を確認。
- [x] Codex追加レビューを行い指摘を解消。
- [x] 最終検証結果を報告し、ユーザーからコミット・push・PR・CI確認・マージ・main更新の指示を受領。

## 分離した作業

#364の未コミット変更7ファイルは `On feature/#364-sticky-header-tabs: backup: issue 364 sticky header before issue 365 focus fix` のstashに保存。本Issueの修正後も、#364再開時に専用ブランチへ戻して適用するまで削除しない。

## 検証結果

- frontend: lint終了コード0（既存警告のみ）、全476テスト成功、型検査を含むbuild成功。
- E2E: 既存zaiko-categories-ui.spec.tsを変更せず、3画面幅×4回を6ワーカーで実行して12件すべて成功。専用DB残数0。
- Codexレビュー: 指摘なし。レビュー側のテストはspawn EPERMで未実行だが、実装側の制限外検証で成功確認済み。
- git diff --check成功。ローカル検証後、ユーザー指示に基づきGitHubへの反映を進める。
