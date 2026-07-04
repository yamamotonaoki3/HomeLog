# ユースケース一覧

[← 要件定義書に戻る](../requirements.md)

各ユースケースの詳細な業務フローは、対応する[機能別要件定義書](../requirements.md#5-機能要件)を参照。

---

| ユースケースID | アクター | 概要 | 対応機能 |
| --- | --- | --- | --- |
| UC-01 | ユーザー | メールアドレス・パスワードで新規登録する | [F01_auth](features/F01_auth.md) |
| UC-02 | ユーザー | ログイン・ログアウトする | [F01_auth](features/F01_auth.md) |
| UC-03 | ユーザー | 世帯グループを作成する、または既存の世帯グループに参加する | [F02_household](features/F02_household.md) |
| UC-04 | ユーザー | 日々の支出を記録する（日時・金額・用途・カテゴリー・支払った人・メモ） | [F03_kakeibo_expense](features/F03_kakeibo_expense.md) |
| UC-05 | ユーザー | カテゴリー別に支出を検索する | [F03_kakeibo_expense](features/F03_kakeibo_expense.md) |
| UC-06 | ユーザー | 支出登録時に割り勘対象者と負担割合（デフォルト50:50、変更可）を指定し、負担額を自動計算する | [F04_kakeibo_warikan](features/F04_kakeibo_warikan.md) |
| UC-07 | ユーザー | 立て替えた相手に精算を請求する／請求された精算に応じ受領確認する | [F04_kakeibo_warikan](features/F04_kakeibo_warikan.md) |
| UC-08 | ユーザー | 世帯外の相手との割り勘・精算を記録する | [F04_kakeibo_warikan](features/F04_kakeibo_warikan.md) |
| UC-09 | ユーザー | 固定費（家賃・水道代等）を登録し、毎月自動計上させる | [F05_kakeibo_fixedcost](features/F05_kakeibo_fixedcost.md) |
| UC-10 | ユーザー | イベントを作成し、複数の支出を紐付けて集計する | [F06_kakeibo_event](features/F06_kakeibo_event.md) |
| UC-11 | ユーザー | 食材の在庫を登録・編集する | [F07_zaiko_inventory](features/F07_zaiko_inventory.md) |
| UC-12 | システム | 在庫が閾値を下回った品目を自動的に買い物リストへ追加する | [F08_zaiko_shoppinglist](features/F08_zaiko_shoppinglist.md) |
| UC-13 | ユーザー | 買い物リストの購入チェックを入れ、在庫に一括反映する | [F08_zaiko_shoppinglist](features/F08_zaiko_shoppinglist.md) |
| UC-14 | ユーザー | レシピを手動登録する、または手書きレシピを画像解析で登録する | [F09_kondate_recipe](features/F09_kondate_recipe.md) |
| UC-15 | ユーザー | WEBレシピのURLを貼り付けて登録し、独自メモを残す | [F09_kondate_recipe](features/F09_kondate_recipe.md) |
| UC-16 | ユーザー | 献立を日単位で登録し、週表示で確認する | [F10_kondate_menu](features/F10_kondate_menu.md) |
| UC-17 | ユーザー | ログインパスワードを忘れた場合にリセットする | [F01_auth](features/F01_auth.md) |
| UC-18 | ユーザー | 口座・カードを手動登録し、支出にどの口座/カードを使ったか紐付ける | [F11_kakeibo_account](features/F11_kakeibo_account.md) |
| UC-19 | ユーザー | 世帯合計対象の支出・固定費のみを合計した「世帯合計支出」を確認する | [F12_kakeibo_household_summary](features/F12_kakeibo_household_summary.md) |
