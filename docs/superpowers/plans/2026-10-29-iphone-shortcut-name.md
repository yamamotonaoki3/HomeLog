# iPhoneショートカットの案内更新（#388）

**Goal:** 新しい配布URLと「シェファミに登録」の名称を案内・ドキュメントへ反映する。
**Architecture:** 既存案内ページのURLと表示文を変更し、関連仕様とテストも同期する。新依存・API・DB変更なし。

## 手順
- [x] コンポーネントテストを新URLと新名称へ更新しredを確認（2件失敗）。更新後の3件green。
- [x] RecipeIphoneShortcutPageのURL・説明・共有メニュー名を更新。
- [x] F09・共通事項・名称E2Eを更新し、iPhone案内E2Eで新URLと新名称を明示検証するテストへ更新。
- [x] frontend全lint/test/build、通常E2E、Codexレビュー、差分確認。

## 事前確認
2026-10-29、iCloudメタデータで新URLの実名「シェファミに登録」を確認。旧URLとのワークフローの処理内容と入力タイプは同一。外部ショートカットは実行していない。

新URL：`https://www.icloud.com/shortcuts/5e2b4881fda540b481cf0b61efd2bb35`

コミット・push・PR・本番反映は別指示待ち。過去の計画書は当時の記録として維持する。

## 検証記録
- frontend全496テスト成功（47ファイル）、lint成功（既存警告あり）、build成功。
- コードレビューで修正を要する指摘なし。レビュー側はspawn EPERMでテスト起動不可、実行側で検証済み。
- git diff --check成功。現行の画面・ドキュメント・テストに旧URLと旧ショートカット名が残っていないことを確認。
- 通常E2E176件成功・録画用1件skip、Workers静的配信E2E6件成功。各実行後の専用テストデータ残数0。
- iPhone案内の320px画像を目視確認。ログはリポジトリ外のTEMPにshefami-388-*.logとして保存。
