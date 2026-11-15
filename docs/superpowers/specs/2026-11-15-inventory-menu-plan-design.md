# 在庫別レシピ予定回数・メモ・一括保存 承認仕様

2026-11-15、ユーザーが画面案/操作フローを含め本内容の実装を承認。ベースmain `6d2f0239c0482d829783ce82be837c8675c0b217`。従来の消費量usageを残予定回数へ置換する合意済み変更であり、旧#547/#548仕様と異なる点は本仕様を優先する。

## 確定した操作・不変条件

1. 在庫鶏肉5個→カレー2回/親子丼3回。予定は整数remainingCount、1回食べると当該回数1とstock1を同時減算。他recipe/他在庫は不変。usageQuantityの入力は撤去する。
2. 常にsum remainingCount<=stock。未割当可。stockは既存0.1単位を保持し、3.5に3回なら0.5は未割当。超過する保存/一覧±/下方入力は全未反映で拒否し、先に予定回数を減らすよう案内。自動でrecipeの予定を削らない。
3. 献立連携enabledは在庫品目全体に1個。recipe別は残予定回数/memo/carry。品目OFFでも計画を保持し、新consume/新carryを停止、undoは可能。OFFも合計制約を免れない。
4. 残予定>0なら品目OFFでもdaily auto ON不可。既にdaily auto ONの品目へ予定割当を追加しない。既存daily設定を勝手にOFFにしない。無計画の既存在庫は従来どおり。
5. carryはrecipe単位を維持。残回数だけを現在週へ引継ぎ、0は新週行なし。元初期回数へ自動復活させず、carry自体でstockを減らさない。itemOFF中も計画/carry設定を保持して生成だけ止める。
6. 食事取消は当週の対象イベントを一度だけ取消しstockへ消費差分を返す。生存linkは残回数も同じだけ返す。unlink済みはstockだけ返し、link/予定を復活させない。週跨ぎ・数量上限・他世帯拒否、成功再送の検証順序を維持。
7. unlinkは残予定割当を解放しstockを変えず、原本recipeを保持。再追加は新link IDとし、過去イベント/成功結果の対象を新linkへ付替えない。原本削除・在庫削除の既存履歴参照も保持。
8. 新規/既存在庫で複数recipeを追加/解除できる。登録済みWeb等recipe検索、手入力、通常在庫fields（品名/カテゴリー/店舗/数量/価格/閾値/daily設定）を維持。既存原本は複製しない。
9. inventory modal内の±/link追加解除/回数/memo/品目enabledはdraft。下部保存で全件を単一原子的APIへ送り、cancel/Esc/背景閉鎖で対象inventory/link mutation0。個別の「連携設定を保存」は撤去。一覧行±は従来操作で合計guardを追加。
10. 検索/初期GETは許可。既存カテゴリー/店舗の独立新規作成は別保存のまま、本件の同batch/取消範囲へ拡張しない。新規recipe原本は集約保存内で作り保存前に単独作成しない。
11. 各linkのmemoは原本memoと分離。一行「カレー×2｜辛口」を基本とし、長文は表示だけ省略、詳細展開で全文と操作を表示する。memo空欄可。既存title snapshotと通常recipe/自由メモの導線を維持。
12. 同要求ID/bodyは保存成功を再現し、異bodyはmismatch。unknownでは同ID/不変body保持、別scopeへ表示/送信/移植しない。成功後GET失敗はGETのみ再試行。明示認証refresh回復と同期invalidateを維持。

## 実装方式と境界

- 推奨方式: 在庫と全link集合を保存する台帳付き集約API。実書込時にstock/合計/revision/所属をguardし、原本・在庫・link・週行・買い物同期・成功JSONまでD1 batchで原子的確定。FEの既存複数API順送は部分保存/補償競合で不適合。
- 新remainingCountを旧usageQuantity/usage_tenthsへ改名流用しない。既存weekly usage/event量と保存済success JSONは絶対に改変しない。新要求の正規化は新operation versionで旧要求と衝突させない。
- production ref `b453258ff0cea6415ee692c3a3dd917827f3ab63` はBE6d48cee/0029 a78cf68/FE6d2f023を祖先に含まず、0028/29を持たない。新連携は標準production履歴へ未配信。本番DB接続/分布調査不要。local既存データはresetせず保持し、小数usageを丸めたり旧OFFを自動復活させない最小の追加型移行を技術reviewする。
- 旧データ保持案: remainingCountはlegacyを識別できるnullable等の最小方式を検討し、明示的新計画保存まで旧量を整数回数と解釈しない。version付き全API併存を無条件要求しない。最終列/DTOはTask1の技術契約reviewで固定しrootへ報告する。
- shared migration0028/29はimmutable。新番号は着手時に確認。新依存なし。GET世帯/週scoped一括取得とN+1なしを維持。
- memoの技術上限255を既存recipe memoに合わせる案、食事event識別と集約revision更新範囲、原本/在庫削除後の表示をTask1で明文化。合意済み業務挙動を変える新判断はrootへ返す。

## 承認済み画面案

- 在庫編集案: [在庫編集案](images/inventory-menu-plan-editor.png)
- 献立一行案: [献立一行案](images/inventory-menu-plan-row.png)

## 実行条件

BE/FE別Issue、BE先行merge後FE。rootがfresh implementerへTask1を割当するまでproduct code編集なし。既存preview sourceを使わず別worktree。ユーザー5173/ユーザー確認previewは勝手停止しない。commit/push/PR/merge権限はroot判断、本番/production反映は別指示。TDD・独立レビュー・局所→全体品質・実API E2E・3幅UIを検証する。

Issue: 親 #553 / BE #554 / FE #555。実装は新隔離worktree、BE専用branch feature/#554-inventory-menu-plan。

## Root承認のHTTP/原子的保存技術契約
## HTTP contract to implement (root-approved technical contract)

Reuse POST /api/inventory-items for create, add ONE new method PUT /api/inventory-items/:id for full replacement; no separate collection/memo/save endpoints.

New create body is the existing flat inventory fields plus:
`menuPlan:{requestId:UUID,enabled:boolean,links:PlanLine[]}`.
New existing edit body has the same fields including absolute `quantity`, plus required `expectedMenuPlanRevision:safeInteger` and menuPlan.
Inventory fields: name/categoryId/storeId/quantity/price/threshold/dailyConsumption/autoConsumptionEnabled. Keep current name<=50, price<=9999999999, quantity/threshold0..99999.9 one decimal, existing category/store membership/name uniqueness, daily configuration settlement rules. Numeric values must be finite/safe and not silently rounded.

PlanLine is exactly one discriminator:
- `{linkId,remainingCount,memo,carryEnabled}`: existing attached link belonging to target item/household; recipe target cannot be changed in-place.
- `{recipeId,remainingCount,memo,carryEnabled}`: existing same-household original (Web/manual/etc), no copy/fetch.
- `{newRecipeTitle,remainingCount,memo,carryEnabled}`: new manual original1..100 trim, created inside batch.
Common: integer remainingCount0..99999; memo null or string<=255 (preserve text; empty UI sends null); carry boolean. Array0..20. Reject duplicate linkId/resolved recipe within same item and extraneous discriminator combinations. Different items may use same original.
`menuPlan.enabled` maps to item flag only; planned link's old `enabled` is internal attachment compatibility, not recipe UI setting.
For creation reject expectedMenuPlanRevision; for edit require it. Reject simultaneous old `menuLinkage` and new `menuPlan`. No menuPlan means existing ordinary POST remains unchanged; old legacy menuLinkage POST remains legacy and its request canonicalization/result unchanged.

Response: 201(create)/200(edit), existing inventory fields plus menuPlanEnabled/menuPlanRevision and ordered menuLinks (existing fields preserved plus remainingCount/memo). If weekly entries are included, title uses weekly snapshot. Return committed success snapshot, not a later GET. GET DTO expansion is finalized in Task4 but aggregate response contract must be exported here.
400 invalid input/over-allocation/daily conflict, 404 missing/foreign target, 409 stale revision or write-time race/mismatch. Use existing validation/name-conflict codes where applicable. Known request mismatch remains RESOURCE_CONFLICT + requestId/PAYLOAD_MISMATCH.

## Atomic behavior

- Use menu_operation_requests/executeMenuOperation/menuGuard/finalizeMenuOperation. New operation canonical version2 and create/replace operation names; do not collide with legacy request_json. Normalize UUID lowercase; explicit submitted order matters. Same valid request before entity/revision checks after current auth/membership; parallel same-key effects exactly once; different body same key409; old stored response JSON untouched.
- Full set semantics: listed linkId kept/explicitly converted to planned with submitted integer count; omitted attached links unlinked, never delete original. New line always new link ID. Unlink stock unchanged, reservations released. Preserve current-week menu rows referenced by events before link DELETE/SET NULL; preserve recipe_title_snapshot even if row linkID becomesNULL. Event.inventory_item_id remains undo authority. Do not reattach old event to a re-added recipe.
- Actual SQL guard must validate sum planned remaining*10<=new quantityTenths even itemOFF; 5 +2/3 succeeds, 6 fails all. Daily ON cannot coexist with remaining>0 even itemOFF; a currently dailyON item may accept a new allocation only in the SAME batch with user-explicit autoConsumptionEnabled=false; never silently switch it OFF. Preserve existing configured daily amount rather than silently turning OFF.
- Entire update/create, new originals, full links, current-week row create/update, stock/shopping sync and success result in one D1 batch. No FE multi-API sequence/compensating rollback. Failed final response construction must roll back too.
- current JST week only for newly created planned rows. New planned entries use fixed consumption basis10 tenths, but never rewrite existing legacy usage/event values during conversion. Do not reset an existing week's title snapshot. Remaining0 creates no unnecessary new week row; keep existing event-bearing row for undo.
- Aggregate CAS uses menuPlanRevision. All concurrent inventory/plan writers must invalidate it; implement one consistent minimal strategy (e.g. bounded DB triggers with safe-integer guard) and document it for Task3. Do not treat consumptionRevision as whole-inventory CAS. Stage hooks/guards so Task3 adds consume/quantity behavior without gaps.
- Existing legacy individual link PATCH cannot mutate planned links or bypass item flag/count/memo atomic save; return409/reload for planned target while legacy target keeps old contract. Old stock/settings endpoints remain for old UI but cannot bypass new allocation/daily invariants; coordinate writer enforcement with Task3 and test concrete races.

## Root-approved writer/daily settlement ruling

Task2 owns ALL stock-writer invariant/revision DB guard/trigger coverage now, not only the new endpoint; Task3 adds consume/undo semantics using that guard. New0031 is recommended, do not edit reviewed0030. Planned remaining sum guards apply even itemOFF and to legacy consumption alongside planned counts. Item menu_plan_enabled affects planned links only; legacy NULL links keep old enabled semantics.

For old dailyON inventory, do not omit or overwrite overdue settlement. Capture the CAS original stock/config/lastConsumed snapshot. Inside SAME batch settle due days with old configuration, then apply modal quantity draft delta `(submitted quantity - CAS original quantity)` to the settled stock; validate final effective stock and total allocation there. Snapshot mismatch =>409/reload, all settlement/save rollback together. User-explicit autoOFF stops future daily consumption but does not erase overdue days. Return effective quantity/revision and FE refreshes GET. Tests must pin delayed days+explicit autoOFF+allocation success, allocation over-effective-stock failure with no settlement/name/link/original/ledger partial write, and concurrent changed snapshot409.

Task3 handoff: event inventory is undo authority, no INNER JOIN link prerequisite. Preserve current-week event-referenced menu row and event.menu_entry_id during unlink. New surviving original link alone receives count+1; legacy event count stays untouched; unlinked/re-added ID never restored.
Task4 handoff: cleanup removes old week rows only, remaining independent. Preserve weekly title snapshot provenance when linkID NULL; past week cannot display live count as historical count. Keep capability DTO operation guards explicit.
