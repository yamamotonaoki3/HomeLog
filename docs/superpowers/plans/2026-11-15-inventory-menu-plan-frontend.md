# 在庫予定回数・一括保存 Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一つのmodal保存で在庫とrecipe別の整数予定回数/memoを確定し、献立を一行で扱えるようにする。
**Architecture:** 保存済み在庫＋全linkから独立draftを作り、modal内ではinventory/linkを書き込まず、検索/初期GETは許可する。確認済みBE集約APIで一括送信し、既存pending/credential/scope隔離を維持する。設計未確定事項をUIで先に固定しない。
**Tech Stack:** 現行React/TypeScript/Vitest/Playwright。既存RecipePicker/MenuTitle/useDialog/CSSを再利用。
**Spec:** [承認仕様](../specs/2026-11-15-inventory-menu-plan-design.md)、[BE計画](2026-11-15-inventory-menu-plan-backend.md)

## Global Constraints

- 親#553/FE#555。BE#554契約merge後にのみ着手、rootが専用branch/担当を割当。既存preview/tab不操作。
- 整数予定回数/eat1=stock1固定、usageQuantity入力撤去、item全体enabled1個。recipe別carryを品目toggleと混同しない。
- modal内±/全link追加解除/回数/memoはdraft、cancelはinventory/link mutation0・保存値不変。一覧±は従来動作、割当割れの合意方針だけ反映。
- 原本削除なし、新依存なし。旧データはlocal legacy保持の技術移行。stock下方/解除undo/carryは承認仕様を厳守する。

## Review Focus

- modal内部で一つだけ先に保存されcancel後に残らない（Task1）。
- 古いGETや別session応答がdraft/成功状態へ混ざらない（Task2）。
- 原本の全文/検索・他在庫linkを削除しない（Task1）。
- 食べた複数回/undo/残0とcarryを旧食済1回制約へ戻さない（Task3）。
- 320pxの一行要約/長いmemo・詳細/キーボード/送信中閉鎖を保証（Task3/4）。

## ファイル/提案インターフェース

- 型/通信: `frontend/src/api/zaikoTypes.ts`、`kondateTypes.ts`、`menuInventory.ts`、`lib/menuOperationPending.ts`、`hooks/useMenuInventoryOperation.ts`。
- 在庫: `components/zaiko/InventoryModal.tsx`、`InventoryMenuDrafts.tsx`、`InventoryMenuSettings.tsx`、`InventoryPanel.tsx`、`pages/ZaikoPage.tsx`。
- 献立: `components/kondate/LinkedMenuControls.tsx`、`MenuTitle.tsx`（必要最小）、`pages/MenuPage.tsx`、`styles/zaiko.css`、`styles/recipes.css`。
- テスト: 現行`InventoryMenuRegistration/Settings/Panel`、hook/API/pending、`MenuInventoryPage`、`e2e/tests/menu-inventory-ui.spec.ts`。
- draft候補: `{inventory:{...保存済値,menuLinkageEnabled},links:[{key,id?,recipeId?|newRecipeTitle?,remainingCount,memo,carryEnabled,revision?}]}`。DTOはBE確定形に合わせ、独自仮APIを作らない。

### Task 1: 完全draftと在庫品目toggle
- [ ] BE merge/API型/設計承認を確認。FE既存Issueがなければ作成し専用branchを作る。
- [ ] UI red: 新規/既存のrecipe複数追加、memo/整数回数変更、link解除、品目enabled変更、modal数量±の全てが保存前inventory/link mutation0。cancel/Esc/背景閉鎖で在庫/link/原本不変。
- [ ] item全体「献立と連携する」1個へ集約。個別enabledと独立連携保存を撤去し、recipe単位は残回数/memo/carryだけ。削除操作はdraftからlinkを外し原本保持と明示。
- [ ] 合計/在庫/未割当を表示し超過保存不可。小数stock表示は維持し、回数入力は整数。`npm test --` 対象在庫componentsでred→最小実装→green。

### Task 2: 一括保存/pending/競合
- [ ] API/hook red: 全draftを1要求で送信、成功body検証、同ID/body回復、refresh/別scope隔離、CAS競合、成功後GET失敗でmutation再送0。
- [ ] 新規と編集の保存を集約APIへ接続。送信中はdraft編集/閉鎖/二重保存を止め、結果不明なら元body保持。409は利用者再確認、最新GETによる無断draft全上書きなし。
- [ ] 在庫通常保存/数量行操作/価格/カテゴリー/日次設定の既存assertを維持して局所green。既存成功台帳を新保存bodyへ変換しない。

### Task 3: 献立の一行表示と反復食事
- [ ] red: 「カレー×2｜辛口」、食べた後「カレー×1｜辛口」とstock-1。親子丼/別在庫は不変。複数回/残0/undoはBE決定済みcapabilityに従う。
- [ ] 一行の要約は全文を保存したまま省略し、既存詳細展開でmemo/在庫/食事/取消/carryを操作。原本閲覧・通常recipe/自由メモの導線を維持。
- [ ] memo/回数の編集後に旧週snapshotや旧成功応答で現在計画を巻き戻さない。`MenuInventoryPage`のscope/unknown/期限切れ明示確認を含めred→green。

### Task 4: 実API UIと全体検証・文書
- [ ] 1280/390/320px: stock5→カレー2/親子丼3を一括登録、在庫5維持、食べたでstock4/カレー1、memo一行、cancel全不変、既存編集追加/解除、原本保持、合計超過rollbackを実Workersで検証。
- [ ] 統合窓でunknown/同ID再送・別世帯・stock競合・決定済みcarry/undoを確認し、44px/16px/横overflow/focus・画面証拠を保存。
- [ ] 全frontend lint/test/build、必要API回帰/E2E、相対リンク/diffcheck。F07/F10/API/DB/READMEを実装へ同期し独立レビュー。配送はroot承認、ユーザー確認、本番は別指示。

## design Aに合わせた実装対象の補足（承認済み）

常時割当割れ拒否（品目OFF含む）/一覧±は先に予定減量案内、OFFは計画保持・新consume/carry停止・undo可、carryは残のみ/0行非生成、unlinkは残割当解放/stock不変/原本保持・解除後undoはstockのみ返却でlink復活なし。技術/テストはこの一組に従う。production refはb453258で0028/29・BE547/FE548未包含、旧小数は本番利用者移行の追加質問ではなくlocalデータを壊さないversion付き互換として扱う。FE複数API順送は部分保存リスクにより採用しない。

builder補足: cancel不変更はinventory/link/回数/memo draftの範囲。カテゴリー/店舗の独立新規作成は既存どおり別保存であることを明示し、同batch化しない。検索GETを禁止しない。残予定>0ならitemOFFでもdaily ON不可、既daily ONなら新割当不可の理由を表示し、既存設定を勝手にOFFへ変更しない。

## 最新ユーザー効率化指示 / root実行手順ruling（2026-11-16）

本節は上記Task分割・全体反復記述より優先する。承認業務仕様は不変。API/hook・在庫modal・献立画面をfresh単一implementerの1統合タスクへまとめる。元Task1/2/3は振舞のチェックリストとして用い、中間の型handoff/別レビューゲートを繰り返さない。opsはCSS/共有fixture/E2E/環境を窓調整して担当する。BE#554のmerge後だけFE productを開始する。

TDDは重要なobservable振舞単位、stock/count/atomic/replay/unlink/tenantを守る最小focused unit/E2Eを用いる。修正のたびにlocal全unit/無関係全E2E/専用3設定を回さず、最終静的lint/type/buildと既存CIの全体結果を採用する。一つのfresh reviewerの同一diff1回でtask spec/qualityとwholebranch両verdictを得る。正式PR CLIreview指摘0と既存CI成功は維持し、本番は別指示を待つ。統合dispatch要件はscratchのissue555-integrated-brief.mdに具体化した。
