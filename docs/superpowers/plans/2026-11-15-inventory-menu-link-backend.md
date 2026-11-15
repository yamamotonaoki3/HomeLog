# 在庫と週献立の消費連携 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在庫別メニューを週献立へ登録し、実食・取消・残数に応じた持越しを安全に行う。
**Architecture:** 原本と在庫の関連を週行から独立し、週行は使用数snapshotと食済状態を持つ。D1 batch、条件更新、操作要求台帳、0到達トリガーを使う。
**Tech Stack:** 現行TypeScript/Hono/Drizzle/zod/D1/Vitest/Playwright。依存追加なし。
**Spec:** [承認仕様・DB/API契約](../specs/2026-11-15-inventory-menu-link-design.md)（ユーザー承認ルールを優先）。

## Global Constraints

- #545未コミット文書を取り込まない隔離worktree `C:/Users/3219b/orca/workspaces/HomeLog/issue547-inventory-menu-link`、branch `feature/#547-inventory-menu-link`、backend子Issue#547/FE#548。root指定までコード編集を開始しない。隔離先への編集/テストはrequire_escalatedでGUIを開かず実行する。
- コミット・push・PR・merge・本番公開はこの作業では実行しない。計画内の完了単位はレビュー単位でありコミット指示ではない。
- 既存quantityは10倍整数、使用数0.1〜99999.9、初期1、JST月曜の週。consumeは設定量のみ。
- 二重消費/負数/他世帯参照禁止。既存通常献立・memo・shopping予定保護・daily設定を維持。
- テストは架空データ/local D1、秘密設定実値は出力しない。子プロセスはwindowsHide、GUI起動なし。

## Review Focus

1. 食事成功後の応答喪失で同じrequestを再送しても再減算しない（Task 2）。
2. 取消時の補充/他の食事と競合しても現在量の相対加算、上限超過は全rollback（Task 2）。
3. 手動減少/daily到来分清算/同時別メニューで0になり、補充してもcarryが勝手に戻らない（Task 3）。
4. 月曜境界/cleanup先行/遅延Cronで継続設定が残り、現在週だけ一行生成（Task 4）。
5. 原本・在庫・デモ削除中の参照競合や旧データが新機能の条件で壊れない（Task 1/4/5）。

## Files / Task interfaces

- db/schema.ts + drizzle/0028_inventory_menu_linkage.sql:追加schema、guard/0停止trigger。
- lib/inventory-menu-links.ts: `createLinkedInventory(db,actorId,householdId,input):Promise<ResponseSnapshot>`、`updateMenuLink(db,householdId,linkId,input):Promise<Link>`。型はdesignのAPI。
- lib/menu-inventory-consumption.ts: `consumeMenuEntry(db,scope,entryId,input)` / `undoMenuConsumption(...)`。scope={actorUserId,householdId}、input={requestId,expectedRevision}、戻り値={status,json}。
- lib/menu-operation-requests.ts: 正規化要求/台帳照合/保存用statement構築。requestのoperation/対象/actor/世帯を必ず含める。
- lib/menu-carryover.ts: `carryMenuEntries(db,now):Promise<number>`。
- routes/inventory-items.ts/menu-entries.ts、routes/inventory-menu-links.ts(index.tsへmount)、inventory-consumption.ts、menu-entry-cleanup.ts/index.ts、demo-cleanup.tsを適所で拡張。
- src/test/routes/{inventory-items,menu-entries}.test.ts と新規inventory-menu-links.test.ts/menu-consumption.test.ts、src/test/lib/menu-carryover.test.ts、migration/demo-cleanup/consumption回帰。
- e2e/tests/menu-inventory-api.spec.ts: console-guard import/watchを使うAPI契約E2E。
- docs/details/features/F07/F10、api-design/data-model/common-notes: 新feature契約だけを追記し#545変更をコピーしない。

### Task 1: 追加schemaと登録連携

- [ ] migration testへ旧在庫/通常recipe/memo行を作り0028適用→値不変/linkNULL/stateuneaten、同在庫3原本link共存、別在庫同原本共存を追加。
- [ ] `npm test -- src/test/routes/inventory-menu-links.test.ts`で赤確認。未導入table/APIによる失敗を確認しログはscratchへ。
- [ ] migration/schemaとcreateLinkedInventory/updateMenuLinkを最小実装。inventory登録+原本+link+今週行+要求結果の単一batch、POST既存bodyは従来処理。
- [ ] 同request同body再送で在庫/原本/献立増えず、異body409、新規/既存混在3件、在庫3→3をassert。既存原本複製0、別世帯/不存在原本/不正値で全未作成をassert。
- [ ] 同一actor/世帯/requestId/bodyの登録要求をPromise.allで実際に並行送信し、成功応答の再現と在庫・原本・関連・週行・台帳が各1回だけ増えることをassert。
- [ ] dailyON登録拒否、carryON stock0拒否、CAS古revision409、同原本同在庫重複拒否、別在庫同原本許可をgreen化。
- [ ] 対象testを再実行しgreen、差分をrootへレビュー用提示。コミットしない。

### Task 2: 食事と取消の原子的操作

- [ ] menu-consumption.test.tsに在庫3/使用1→consume2/食済、同行別request409、同request再送200数量2、undo3/未食、新consume2を作る。
- [ ] `npm test -- src/test/routes/menu-consumption.test.ts`で赤確認。
- [ ] consumeMenuEntry/undoMenuConsumptionとroutes、GET拡張、台帳を実装。D1 batch内guard不成立はrollback。inventoryShoppingSyncは在庫UPDATEの直後に置く。
- [ ] Promise.allで在庫1の別メニュー2件consume→成功1/失敗1/在庫0。別actorの同じ行consumeも成功1。量0/負/小数2桁/上限の登録拒否、在庫不足でevent/state/ledger不変をassert。
- [ ] consumeとundoそれぞれで同一actor/世帯/requestId/bodyをPromise.allで実際に並行送信し、両応答が同じ保存結果となり減算/返却・event・台帳が各1回だけ反映されることをassert。逐次再送だけで代替しない。
- [ ] consume後補充+3と別消費-1、その後undo+1で期待現在量、古い読取値へ復元しない。取消二重送信/別request同時取消は1回だけ返却、上限超過全rollback。
- [ ] 新規consume/undoはJST当週だけ許可し、cleanup遅延の前週行・未来週行は409全未反映、GET canConsume/canUndoもfalseをassert。同requestId/bodyの保存成功再送は権限照合後、週跨ぎ・行削除後も元結果を返すことをassert。
- [ ] 他世帯ID/無認証/退会pending/デモ期限切れの拒否、未知DB例外→500、保存成功をGET失敗で再実行しない契約をassert。
- [ ] 対象test green、rootレビューへ。コミットしない。

### Task 3: 0到達とdaily排他の全経路

- [ ] inventory/menu testへconsume/手動quantity/-delta/daily設定変更時の到来分清算で0→全対象carryOFF、補充/undoで非復活を追加。
- [ ] `npm test -- src/test/routes/inventory-items.test.ts src/test/routes/menu-consumption.test.ts`で新assertの赤確認。
- [ ] DB triggerとroute既知エラー変換を実装。dailyON既存行は移行時不変、link作成拒否。有効linkあり→dailyON変更拒否、linkOFF後ON可能。
- [ ] raw SQL UPDATEでも0停止、古いcarryPATCHと同時0到達でOFF/CAS conflict、stock0で再ON拒否・補充後明示ON成功をassert。
- [ ] shopping保護行/手動行をconsume/undoで勝手に削除せず、閾値同期の既存規約と一致させgreen。
- [ ] 対象test green、rootレビューへ。コミットしない。

### Task 4: 継続・週削除・削除整合

- [ ] menu-carryover.test.tsに食済前週+stock1+carryON→翌週未食新行/在庫1、同Cron再実行行数1、stock0→0行を追加。
- [ ] `npm test -- src/test/lib/menu-carryover.test.ts`で赤確認。
- [ ] carryMenuEntriesをINSERT SELECT+UNIQUEで実装。indexの日次献立処理をcarry→cleanupにし、失敗時cleanupを飛ばして1時再試行。demo毎時は従来の期限削除だけ。
- [ ] 年跨ぎ/JST月曜0時/数週遅延は現在週だけ、cleanup先行後もlinkから再生成、未来手動通常行は不変、同(link,week)を上書きしないをgreen。
- [ ] 在庫削除/recipe削除/linkOFFで継続停止と既存行削除表示、consume不可。在庫削除後undo409・在庫非復活、recipe削除/linkOFF後も在庫有なら当週undo可。献立削除で在庫返却なし/carryOFF、enabledのfalse→trueまたはcarryのfalse→trueという明示再ONで今週行がなければ生成し（carryfalseの今週限定再連携も対象）、未食行設定更新・既存食済行非復活/非重複をassert。同値設定やusageだけの編集では削除行を復活させない。通常recipe削除SETNULL/memo/週削除は回帰不変をassert。
- [ ] demo-cleanupの既存CASCADEを新表fixtureで検証し（既存動作で十分なら削除SQLは追加しない）、全FK有効で期限demo消去、通常世帯不変、世帯退出CASCADEと退会墓標保持をassert。
- [ ] 対象test green、rootレビューへ。コミットしない。

### Task 5: 文書/API E2Eと全体検証

- [ ] F07/F10/data-model/API/commonの既存在庫-献立連携なし表記を新機能の限定範囲へ更新。承認仕様との対応表をrootへ。
- [ ] API E2Eを先に追加し`npm test -- tests/menu-inventory-api.spec.ts`で赤→API契約実装差分→green。在庫3とA/B/C、新規/既存原本混在、GET追加型、食事→2→1→0、取消、再送、他世帯拒否を実Workersへ送る。
- [ ] frontendでnpm run build後、backend-workers全体`npm run lint` / `npm run typecheck` / `npm test`、e2e全体`npm test`と専用menu-cleanup/demoを順次実行。自分のサーバーのみ終了し8787/割当port閉鎖を確認。
- [ ] rootがCodexレビューと修正側への具体指示、最終再検証を管理。受入れ: 確定ルール全項green、既存回帰green、レビュー指摘0。コミット/push/PRを自動実行しない。

## FE引継ぎ（backend契約確認・merge後の子Issue）

InventoryModalに連携toggleと1〜20メニュー、新規/既存検索（keyword.ts/MenuAddSheet再利用）、使用数/持越し。日次ONは連携不可の理由表示。MenuPageは関連在庫と現在残/設定使用数/食済、食べた確認（量は設定値）/取消/持越しONを表示。通常行は従来どおり。
在庫登録から今週へ追加、再送用request/bodyを認証scope別に維持、成功後GET失敗と操作失敗を区別。320/390/1280・キーボード・フォーカス・家族2人競合・0後補充非再開をE2E化。画像にない既存入力を消さない。

## 計画自己点検

承認8規則→Tasks1〜4、登録再送→1、食事/取消→2、0全経路/daily排他→3、週cleanup/削除→4、実Workers/品質→5。API名・型はdesignを唯一の契約とし、機能追加範囲外の予約・曜日指定・材料照合・家計自動計上は追加しない。

## ローカル実行記録（2026-11-15、#547）

- frontendのnpm ci/buildと、backend-workers/e2eのnpm ciを実施。新しい依存は追加せず、ローカル専用JWT鍵は出力せず生成した。
- 持越し/Cronの新テストは未実装でred確認後に実装し、担当3ファイル28テストがgreen。デモの新表fixtureは既存CASCADEで成功したため削除SQLを増やさなかった。
- backend-workers全体のnpm run lint / npm run typecheck / npm testは成功。最終66ファイル1017テストpass。通常在庫60件・通常献立60件でも一覧取得は各4クエリをテストで保証した。
- 通常E2Eの初回は12workersで273pass/4skip/9fail。接続拒否・ローカルproxy回復警告等を記録したが、単一原因は断定しない。既存テストの状態/API結果assert強化とN+1是正後、最終アプリでnpm test -- --workers=2が282pass/4skip・失敗0。
- 通常全体完了後、dashboardの保存後GET同定だけをtest-onlyで強化し、npm test -- tests/dashboard-cards.spec.ts --workers=1は1pass。全体実行とその後のtest-only変更を区別する。
- 専用E2Eはmenu-cleanup 1pass、demo 7pass、static-assets 11pass。各実行前後に専用D1を削除し残数0、今回起動したサーバーのポート閉鎖をrunnerで確認した。既存5173は操作せず空き5174を使用。
- API E2Eは登録同ID並行・既存原本非複製・食事/取消/再送・0停止・補充後未再開・明示再ON/CAS・食済非復活・世帯分離を実Workersで確認した。
- 元checkoutの#545文書20件を取り込まず保持。#548画面と外部deliveryは未着手。本番未反映。個別手順の未実行コマンドや将来工程は、この実行記録から成功を推測して完了扱いにしない。
### PR #550のCLIレビュー対応

- 在庫0・enabled OFF→ON・carryOFFの再有効化が成功するP2を確認した。追加HTTP回帰は在庫0とbatch直前1→0の2件が200!=409でred。
- Codex execで、UPDATE時の実際のenabled/carry遷移だけを対象に同世帯在庫>0の原子guardを追加。既存CHECKでbatchをrollbackし、0028/schemaは変更していない。初回stock0登録と既有効usage編集は維持した。
- 依頼側の最終確認: 対象16件green、backend全体lint/typecheck成功・66ファイル1020件pass、実Workers API E2E 1件pass（stock0/carryOFF再ON409と全値不変を追加）。
- Codex execのsandboxではテストがspawn EPERMだったため、redと最終greenは依頼側の制限外環境で確認した。ローカル通常全体282pass/4skipはこのguard修正前の結果で、修正後はAPI E2Eと最新headのCI全件を確認する。
