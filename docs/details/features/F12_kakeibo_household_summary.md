# F-12 世帯支出サマリー

[← 要件定義書に戻る](../../requirements.md)

---

## 1. 概要

世帯全体としてどれだけ支出があったかを、個人の支出内訳を非公開にしたまま合計金額のみで確認できるようにする機能（[common-notes.md](../common-notes.md) 8章参照）。世帯全体の合算家計簿（個別の支出管理）ではなく、あくまで集計値の閲覧に限定する。

独立した専用画面は持たず、トップ画面（S-04：生活ダッシュボード）と家計簿一覧画面（S-05）のサマリーカードとして常時表示する（[common-notes.md](../common-notes.md) 9章「確認はトップに集約」方針）。

## 2. 対象画面

| 画面ID | 画面名 |
| --- | --- |
| S-04 | トップ画面（生活ダッシュボード内「今月のお金」カードに世帯合計対象額を表示） |
| S-05 | 家計簿一覧画面（同内容のサマリーカードに世帯合計対象額を表示） |

## 3. 業務フロー

```mermaid
flowchart TD
    A([S-04 トップ画面表示]) --> B[対象期間（当月）で\nexpensesをhousehold_idで検索\ninclude_in_household_total=true のみ抽出]
    B --> C[fixed_costs を household_id で検索\ninclude_in_household_total=true のみ抽出]
    C --> D[両者を合算した世帯合計支出額を\n「今月のお金」カードに表示]
    D --> E["個別の使途・金額の内訳は表示しない\n（合計金額のみ）"]
```

## 4. IPO

### 世帯合計支出の取得

| 項目 | 内容 |
| --- | --- |
| 入力 | household_id・対象期間（当月固定） |
| 処理 | expenses・fixed_costsのうち `include_in_household_total=true` のレコードを抽出しSUM(amount)を計算 |
| 出力 | 世帯合計支出額（内訳は含まない） |

## 5. データ設計（関連テーブル）

[data-model.md](../data-model.md) の `expenses.include_in_household_total`, `fixed_costs.include_in_household_total` を参照。

## 6. 今後の検討事項

- 対象期間の指定方法（当月固定のままでよいか、期間を自由指定できるようにするか）
- カテゴリー別など、内訳を出さない範囲での集計軸追加の要否
