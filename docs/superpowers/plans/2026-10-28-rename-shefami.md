# シェファミへの名称変更計画（#386）

**Goal:** 家族で使うアプリの表示名を「シェファミ」に統一する。
**Architecture:** 画面上の表示とHTML/PWAメタデータを変更する。既存URL、API、DB、ストレージキーは同じまま、既存利用者のデータ・ログインを継続する。
**Tech Stack:** React / Vite / Vitest / Playwright、新依存なし。

## 対象と判断
- AppLayout・LoginPage・index.html・vite.config.ts：表示名、タブ名、PWA name/short_name。
- RecipeBookmarkletGuide：「シェファミに登録」。生成するURL転送コードは既存のまま。
- RecipeIphoneShortcutPage：アプリ名は変更。iCloud APIで確認した実名「homelogに登録」は既存配布名として明示し維持。配布物の実名を画面上だけ変更しない。
- README・要件定義/構想のタイトル・現在の画面仕様とレシピ案内を更新。過去の計画や運用上の識別子は改名しない。

## Task 1: 表示と案内のTDD
- [x] LoginPage・RecipeBookmarkletGuide・RecipeIphoneShortcutPageのテストを更新しredを確認（5件失敗）。
- [x] 画面と案内、HTML/PWAの名前を変更。
- [x] 関連29テストをgreenにし、現在の仕様を更新。

## Task 2: ブラウザ検証
- [x] smoke・sticky-header・recipe-bookmarkletの既存名称を更新。
- [x] 1280/390/320pxでログイン名・共通ヘッダー名・タブ名・共有案内とログイン継続を確認するE2Eを追加。320pxの画像も目視確認。
- [x] Workers静的配信でmanifestのname/short_nameとタイトルを検証するテストを追加。
- [x] frontend全lint/test/build、通常E2E全体、静的配信E2Eを実施（結果と注意事項は下記）。
- [x] Codexレビュー、git diff --check、Issueの受け入れ基準を確認。

ユーザーの追加指示により、検索結果への掲載を防ぐrobots metaのnoindexも共通HTMLへ追加する。静的配信E2Eでログイン・登録・保護画面等への直接アクセス時の元HTMLを検証し、red→greenを確認する。検索掲載の制御とアクセス制限を区別し、新たな認証方式は追加しない。

コミット・push・PR・レビューとCI成功後のマージはユーザー承認済み。本番反映は別指示待ち。出力済みアイコンの作業用outputフォルダは対象外。

## 検証結果
- frontend：lint成功（既存警告あり）、496テスト成功（47ファイル）、build成功。
- 通常E2E：175件成功・録画用1件skip・1件失敗。名称変更の3幅テスト、既存の共有・レシピ登録・固定ヘッダーテストは成功。
- 失敗は変更対象外のwarikan.spec.tsの390px削除確認で、「口座の残高を元に戻します」がないという既知の並列時と同じ事象。割り勘specをworkers=1で再実行すると4件すべて成功。原因特定・修正は別範囲とし、全体E2Eを成功扱いにしない。
- Workers静的配信E2E：5件成功。manifest name/short_name、HTML title、ログインの名称も確認。
- E2E実行後の専用データ残数0。320pxのスクリーンショットを目視確認。
- Codexレビューは修正指摘なし。レビュー環境のテストはspawn EPERMのため起動できなかったが、実行側で検証済み。
- ログはリポジトリ外のTEMPにshefami-386-*.logとして保存。

## 家族利用向け設定の追加検証
- 共通HTMLにnoindexがない状態の静的配信E2Eでredを確認し、meta追加後green。
- 最終frontend：lint成功（既存警告あり）、496テスト成功、build成功。
- 最終Workers静的配信E2E：6件成功。5つのパスで、JavaScript実行前のHTMLにnoindexが含まれることを確認。専用データ残数0。
- 追加後のCodexレビューも修正指摘なし、git diff --check成功。
