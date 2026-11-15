# 在庫予定回数・一括保存 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 整数の残予定回数とstockを1ずつ連動し、在庫＋全関連を一括保存する。
**Architecture:** 在庫品目のenabledとrecipe別の残予定/memo/carryを分離。既存usage量/消費履歴を黙って変換せず、集約保存・消費・取消の原子性と台帳を維持する。業務仕様は承認済み、DTO/列名はTask1で技術契約を固定してrootへ共有する。
**Tech Stack:** 現行Hono/D1/Drizzle/zod/Vitest。依存追加なし。
**Spec:** [承認仕様](../specs/2026-11-15-inventory-menu-plan-design.md)

## Global Constraints

- main `6d2f023`。親#553/BE#554/FE#555、branch feature/#554-inventory-menu-plan。既存preview/tab不操作。commit/push/PR/mergeはroot判断。
- 単位は整数予定回数/eat1=stock1固定/usage入力撤去。stockは既存tenths保存を維持する提案。
- recipe原本保持、item全体enabled1個、recipe別carryのまま。modal保存は全件原子的・cancel未反映。
- 旧usage/mixedは未productionでありlocal legacy保持の技術移行とする。stock下方/OFF/解除undo/carryは承認仕様どおり実装する。
- shared0028/0029変更禁止。新番号は着手時確認。BE merge後にFE。送信成功台帳/認可/買い物同期を維持。

## Review Focus

- 旧小数usage/食済/旧OFF linkが無断変換・復活しない（Task1）。
- 保存前の見た目合計だけでなく同時consume/数量更新でも割当超過を作らない（Task2/3）。
- 既存recipeを別在庫で参照しても原本複製・他在庫消費をしない（Task2/3）。
- 解除・週cleanup後もundo/成功再送の過去結果を壊さない（Task3/4）。
- 全量入力失敗/unknown後に原本だけ・一部linkだけ・二重保存が残らない（Task2）。

## ファイル/提案インターフェース

- 変更: `backend-workers/src/db/schema.ts`、新migration、`routes/inventory-items.ts`、`lib/inventory-menu-links.ts`、`lib/menu-inventory-consumption.ts`、`lib/menu-carryover.ts`、`lib/menu-operation-requests.ts`。
- 必要に応じ変更: `lib/inventory-consumption.ts`、`lib/inventory-shopping-sync.ts`、`routes/recipes.ts`（原本削除の参照保持）、`src/index.ts`（新route mount時のみ）。
- 新規候補: `lib/inventory-menu-plan.ts`、`src/test/routes/inventory-menu-plan.test.ts`、`src/test/db/inventory-menu-plan-migration.test.ts`。
- 提案DTO: `SaveInventoryPlanInput={requestId,expectedInventoryRevision,inventory:{...全入力,menuLinkageEnabled},links:[{id?,recipeId?|newRecipeTitle?,remainingCount,memo,carryEnabled,expectedRevision?}]}`。除外linkの扱いを明示する全集合置換。`usageQuantity`再利用禁止。
- 提案関数: `saveInventoryPlan(db,scope,itemId:number|null,input):Promise<MenuResult>`。集約revisionはstock/linksを変更する全経路と整合させ、列/DTO確定はTask1 gateで行う。

### Task 1: 契約・旧データ移行gate
- [ ] Issue/branch/承認specを確認し、Task1で必要なDB列・旧データ保持・DTOの技術契約を最小案でrootへ共有。業務仕様に未定事項を再導入しない。
- [ ] 真のpre新migration DBにusage0.5/1.5、未食/食済、mixed enabled、原本削除/event/成功ledgerを用意。決定済み変換のみ適用し、旧OFF非復活/履歴量不変/通常在庫不変の失敗testを書く。
- [ ] `npm test -- src/test/db/inventory-menu-plan-migration.test.ts` で期待したred→追加型migration/schema最小実装→green。自動丸めで通さない。

### Task 2: 在庫＋全関連の原子的保存
- [ ] HTTP red: stock5/カレー2/親子丼3成功・未割当可・合計6全rollback、既存在庫への追加/解除と原本保持、memo、品目OFF、他世帯/重複/競合。同ID同body並行成功1回、異body409、途中SQL失敗全rollback。
- [ ] 既存createと編集を台帳付き集約保存へ接続。入力検証後、実UPDATE時にも合計/stock/revisionをguardし原本/在庫/link/週行/買い物/成功JSONを1batch。集合から消えたlinkは合意済み履歴保持方針で解除。
- [ ] `npm test -- src/test/routes/inventory-menu-plan.test.ts` をred→green。既存通常保存・名前重複・価格/日次設定を維持する。

### Task 3: 複数回consume/undo・下方更新
- [ ] red: stock5/counts2+3→A食べた1でstock4/A1/B3、A同要求再送無変化、別新要求でstock3/A0。残0・不足・競合・他在庫不変。
- [ ] 合意済みundo/event参照と旧イベントを区別し、生存linkはstockと残回数へ差分返却、解除済みlinkはstockだけ返してlink/予定を復活させない。解除/計画変更後のundo、上限、再送を厳密assert。
- [ ] 一覧±/下方更新の合意方針を既存quantity routeと必要な全数量writerへ反映。未合意の自動recipe配分を追加しない。
- [ ] `npm test -- src/test/routes/menu-consumption.test.ts src/test/routes/inventory-items.test.ts` 等、所有testに追加してred→最小実装→green。

### Task 4: carry/削除/一覧・実API契約
- [ ] 決定した残回数carry/0生成/品目OFF/recipe別carry、週境界/遅延/重複を既存carry testへ追加。週削除で計画/event/台帳を失わない。
- [ ] GETはremainingCount/memo/item enabled/capabilityを世帯/週scoped一括取得、一覧N+1を再導入しない。旧成功JSONを新DTOへ書換えない。
- [ ] 実Workers API E2Eを追加し5→4/count2→1、aggregate rollback、原本保持、再送を検証。全backend lint/typecheck/test＋必要E2E成功、文書同期/独立レビュー後、rootの配送承認に従う。本番反映しない。

## design Aに合わせた実装対象の補足（承認済み）

常時割当割れ拒否（品目OFF含む）/一覧±は先に予定減量案内、OFFは計画保持・新consume/carry停止・undo可、carryは残のみ/0行非生成、unlinkは残割当解放/stock不変/原本保持・解除後undoはstockのみ返却でlink復活なし。技術/テストはこの一組に従う。production refはb453258で0028/29・BE547/FE548未包含、旧小数は本番利用者移行の追加質問ではなくlocalデータを壊さないversion付き互換として扱う。FE複数API順送は部分保存リスクにより採用しない。

builder補足: 残予定>0なら品目OFFでもdaily ON不可、既daily ON品目へ割当追加不可を検証する。カテゴリー/店舗の独立新規作成は今回の集約batchへ取り込まず、既存参照の所属/存在だけを保存時検証する。auto Cronが計画保持中のstockを割る経路を作らず、通常の無計画在庫には回帰させない。


## Task2 HTTP contract / task handoff

Task2の具体契約はroot承認済みで本specへ同期済み。SDD `task-2-brief.md` がtask範囲の実装入力。既存POST createへmenuPlanの判別拡張、唯一の新method PUT /inventory-items/:idでinventory全fields+全link集合を保存する案。既存legacy menuLinkage要求/成功JSONはそのまま。menuPlanRevisionは集約CASでありstock/全plan writerを横断して無効化する。

Task3必須: legacy消費も残planned合計guard、legacy event undoは旧stock量だけでcountを足さない。unlinkは当週event参照menu rowを保持しevent.menu_entry_idを失わない。undoはINNER JOIN link前提を外しevent.inventory_item_idを正とし、生存の元newlinkのみcount返却、再追加IDへ移植しない。

Task4必須: cleanupは週行のみでremaining不変。unlinkで週行linkID NULLでもrecipe_title_snapshotの由来を保ちlive原本名へ戻さない。過去週DTOへ現在live countを過去時点の値として示さず、過去週は操作不可・count省略等を技術契約へ固定する。

Root採用: Task2で全stock writerの割当invariant/menuPlanRevision guardを0031等へ実装、Task3は食事差分を追加。旧daily精算→CAS元との差分反映→最終実効stockで割当検証を同batchで行い、明示autoOFF＋新割当を許す。遅延日数/超過rollback/スナップショット競合をTask2 testへ固定。
