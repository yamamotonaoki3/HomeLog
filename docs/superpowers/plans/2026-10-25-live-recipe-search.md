# レシピ候補の即時表示 実装計画（#376）

**Goal:** 献立表で検索入力直後に候補が見えるようにする。
**Architecture:** 既存の検索状態とAPIを維持し、selectを標準radio一覧に置換する。共通filterByKeywordを使用する。
**Tech Stack:** React / TypeScript / Vitest / Playwright（新依存なし）。
**Spec:** ../specs/2026-10-25-live-recipe-search-design.md

## 制約・レビュー重点
- 入力のたびに結果更新。空欄は全件、0件の案内、かな・全半角一致、お気に入り順を維持。
- 条件から外れた選択解除と、選択だけでは登録しないことをテスト。
- 長いタイトル・多数候補・狭幅・キーボードフォーカスをE2E確認。
- 在庫と買い物の検索は既存の即時表示を回帰確認。
- commit/push/PR/本番は別指示待ち。

## Task 1: 候補選択のTDD
- [x] frontend/src/test/pages/MenuPage.test.tsxに常時表示・即時絞り込み・かな一致・空/0件・お気に入り順・選択解除のテストを書く。
- [x] 対象テストでredを確認（候補未表示など5件失敗）。
- [x] frontend/src/pages/MenuPage.tsxとfrontend/src/index.cssを変更。単一radioグループとスクロール候補領域にする。
- [x] 対象18件green、関連仕様docs/details/features/F10_kondate_menu.md・wireframes.mdを更新。

## Task 2: ブラウザ検証と全体検証
- [x] 既存E2Eのselect依存操作をradioへ更新。
- [x] e2e/tests/recipe-search.spec.tsに1280/390/320pxの即時表示・選択追加・キーボード・長い候補/多数候補、および在庫/買い物の即時検索を追加。
- [x] frontend全lint（警告あり・exit 0）/test（488件）/buildと関連E2E24件、git diff --check成功。320px画像で折り返しとスクロールも確認。
- [x] codex review --uncommitted（標準入力を閉じログはTEMP）：修正を要する指摘なし。レビュー側のテストはspawn EPERM、実行側で全件検証済み。
- [ ] ユーザーへブラウザ確認を依頼。

## 全体E2Eの未解決事項

`npm test -- --workers=6` は167件成功・1件skip・3件失敗。後始末残数0。
- 変更対象外のevents.spec.ts：390/320pxのイベント削除後、登録ボタンへのフォーカス復帰が不成立。
- 変更対象外のwarikan.spec.ts：390pxの削除確認で期待する「口座の残高を元に戻します」が表示されない。

この変更ではイベント・割り勘のコードとspecを変更していない。検索機能とは分けて報告し、別範囲の修正はユーザー判断を待つ。ログはTEMPのhomelog-376-e2e-all.log、関連E2Eはhomelog-376-e2e.log、全体テストはhomelog-376-final-tests.log。

失敗した2specを`--workers=1`で再実行すると11件すべて成功、後始末残数0。並列実行時の不安定さが疑われるが、原因の特定・修正は未実施。ログはTEMPのhomelog-376-unrelated-rerun.log。全体E2Eを成功扱いにはしない。
