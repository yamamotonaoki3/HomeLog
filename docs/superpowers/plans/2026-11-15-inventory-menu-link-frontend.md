# FE #548 在庫と週献立の連携：設計・TDD計画
**契約参照:** [在庫と週献立の承認仕様・DB/API契約](../specs/2026-11-15-inventory-menu-link-design.md)

**開始記録:** BE #547 は PR #550 で main `70d4b1f1d5f472dbb91ab40d39c527360e94c43d` へマージ済み。FE #548 は `feature/#548-inventory-menu-link-ui`、既存隔離worktreeを再利用しroot開始通知済み。以下の開始前表現は準備時点の記録であり、最新のroot割当を優先する。coreが型・通信・pending・献立、inventoryが選択共通部・在庫画面、opsがE2E・QA・Git・文書・共通styles/fixtureを所有する。

2026-11-15。既読README/画面案と完成BE #547の実装に基づく準備文書。BE merge後に専用FE worktreeを作り、root開始通知まではrepo編集・テスト実行をしない。新依存なし。commit/push/PR/merge・本番反映はrootの指示範囲に従う。

## 目的と画面

- 在庫の新規登録フォームに「レシピも登録する」を追加。既存の品名・カテゴリー・店舗・数量・値段・補充基準・日次消費を保持する。OFF時のbody/挙動は従来通り。
- ON時に新しい料理名入力／既存レシピ検索を切り替え、1〜20料理を選択一覧へ追加。各料理は使用数初期1、0.1〜99999.9/小数1桁、持ち越し初期OFF。新規名1〜100文字、同じ既存原本の重複選択不可。予定合計>在庫は拒否せず「登録では在庫を予約・減算しない」と示す。
- 検索はkeyword.tsのfilterByKeyword、MenuAddSheetの候補部分を共通化。お気に入り順・Web出典・0件・検索外選択保持・長名展開を維持する。新規名はレシピ原本になり、自由メモとは区別する。
- 連携トグルを日次消費ON中は不可にし理由を表示。連携ON中の日次ONも不可。既存の日次値や停止状態を勝手に変えない。トグルOFFで未保存料理下書きは保持、送信から除外。
- 在庫の詳細編集では既存linkの使用数/連携ONOFF/持ち越しを編集する。通常在庫フォームの保存とは別の明示「連携設定を保存」でPATCHし、通常入力下書きを消さない。既存在庫へ新しい料理を追加するAPIは今回ないため入口を新設しない。
- 献立行は通常レシピ/自由メモの原本閲覧・削除を保持。連携行だけ元在庫名/現在残/週行使用数/未食・食済/持ち越しを表示。「食べた」は設定量で確認し、量を変更する入力は置かない。食済行の「取り消す」も対象・返却量・現在量を確認する。双方の送信中は閉鎖/連打/別操作を止める。
- canConsume/canUndoを操作可否の正とし、当週外・不足・連携解除・削除・日次消費・返却上限の理由を既存表示情報から説明する。取消は原本削除/連携OFFでもcanUndo=trueなら利用可。0で持ち越し停止し、補充/取消で再開しないことを表示する。
- carry変更は現在linkをPATCHする。GET献立のusageQuantityは週行snapshotなので、inventory GET menuLinksの最新usage/revisionをlinkIdで確認して全置換する。食済行の旧usageで現在設定を巻き戻さない。行が削除済/在庫削除済なら新規操作を作らず再取得する。最新inventory GET失敗中はcarry設定だけを止め、menu GETが取得できている場合のconsume/undo能力とは独立に扱う。

## 実APIと状態

- POST /inventory-items: 従来body + menuLinkage:{requestId,menus:[{newRecipeTitle|recipeId,usageQuantity,carryEnabled}]}。201は従来在庫+linkedMenuEntries。今週へ追加され、在庫数量は登録値のまま。
- GET /inventory-items: menuLinks:[id,recipeId,recipeTitle,usageQuantity,enabled,carryEnabled,revision]。
- GET /menu-entries?weekStartDate=: inventoryLinkageは通常null。連携ID/在庫ID・名・現在量/週使用数/enabled/carryEnabled/linkRevision/mealState/mealRevision/canConsume/canUndo/unavailableReasonを使用。
- PATCH /inventory-menu-links/:id: {expectedRevision,usageQuantity,enabled,carryEnabled}全置換。409は再取得して再確認、自動rebase/再PATCHなし。応答Linkを保存結果として扱い、後続GET失敗でPATCHを再送しない。
- POST /menu-entries/:id/{consume|undo-consumption}: {requestId,expectedRevision:mealRevision}。200 {menuEntryId,mealState,mealRevision,inventoryItemId,quantity,carryEnabled}は確定時snapshot。成功後は対象週と在庫/linkを再取得し、GET失敗は「記録済み。一覧を再取得してください」としてGETだけ再試行。
- 登録/consume/undoは操作種別・対象・actor/世帯・原UUID・deep copyした不変bodyをenvelopeとして保持する共通hook/API helperにまとめる。既存shoppingの認証scope確認・明示Bearer・世代/credential検査・Web LocksとlocalStorage readbackのパターンを再利用するが、shopping専用schemaや成功/拒否判定関数は流用しない。
- UIへ要求ID等の実装用語は出さず「結果を確認できません」「同じ内容で確認」を使う。未解決要求はscope別保存しlogout/再読込で消さない。認証/現世帯をfresh確認した同本人だけに「前回の結果を確認」を表示し、元ID/bodyで明示再送する。他人/他世帯へ内容表示・送信しない。登録の完全bodyは再送に必要な入力値だけを保存し、token/header/原本全文は保存しない。
- 401/通信断/5xx/不正成功body/PAYLOAD_MISMATCHは結果不明として元要求を保持し、編集して別IDを発行しない。BEは成功のみ台帳保存し、shoppingの永続未反映markerがない。初回の明確な入力/業務拒否と、結果不明後の回復応答を区別し、後者の400/404/409だけで元要求を捨てない。この境界を先にテストしてrootレビューする。
- pendingが解決した後も一覧同期が完了するまで対象の次のmutationを止める。保存結果snapshotを最新全一覧として上書きしない。scope変更時は旧下書き/画面/後着応答を隔離する。

## 変更候補（FE worktreeで確定）

- api/zaikoTypes.ts, api/kondateTypes.ts: 追加型と成功/エラーresponseの型。
- api/menuInventory.ts, lib/menuOperationPending.ts, hooks/useMenuInventoryOperation.ts（新規候補）: scope固定通信、immutable pending、回復とGET同期。
- components/kondate/RecipePicker.tsx（新規候補）+MenuAddSheet.tsx: 検索候補共通化。既存の複数選択順・検索外保持を変えない。
- components/zaiko/InventoryModal.tsx +連携入力/設定部品、InventoryPanel.tsx/ZaikoPage.tsx: レシピ候補取得・登録とlink編集、成功後の在庫/買い物同期。
- pages/MenuPage.tsx +連携行/確認dialog部品: 食済/取消/持ち越し、最新link値照合。useDialog、MenuTitle、recipeSite、既存フォーム/CSSを利用。
- 既存メイン食材在庫一つだけを操作。曜日選択、材料自動照合、通常レシピ/自由メモへの新しい消費UIは追加しない。

## TDD実装順（各段階red→最小green→独立レビュー）

1. 型/API/pending: 送信body、同ID/body再送、成功shape検証、mismatch/未知/401保持、別scope非表示、旧応答非適用、保存後GET失敗・再取得のみを先にテスト。storage/locks不可や破損では送信しない。
2. 共通RecipePicker: 正規化/空欄/0件/検索外選択/既存原本重複防止、既存MenuAddSheetの登録済み再追加・お気に入り・自由メモ回帰。選択/全文展開だけでは保存しない。
3. 新規在庫フォーム: OFF従来body、ONの新規/既存混在3件各1、使用数境界、予定超過許可、daily設定保持、トグル/検索/取消の下書き保持、二重click・未知結果回復・成功後GET失敗を検証。
4. link設定/献立操作: 最新link使用数をcarry PATCHへ渡す、409再取得、食済のsnapshot非巻戻し、consume前確認・不足、undo確認・上限、原本削除/OFF後取消、当週外不可、削除と取消の区別。0→補充でcarry再ONしない、明示ONでも食済行を復活させない。
5. ローカルWorkersとのE2E: 1280/390/320pxで在庫3→新規2+既存Web1→今週献立3件/在庫3→食事2→取消3、別在庫同原本で各々の在庫だけ減る、家族2人同時食事/競合、0停止/補充非再開/明示再ON。週跨ぎは既存BEテストとAPI E2Eで保証し、本番時刻/データを変えない。
6. キーボード/フォーカス/長名/0件/読取失敗/安全領域を確認。主要操作44px・入力16px、初期focus/子dialog中の親隔離・閉鎖後起点復帰を既存慣例で揃える。
7. FE全体lint/test/build、関連BE API契約回帰、e2e全体（ローカル8787のみ、別作業serverを止めない）をroot管理で実行。Codexレビュー指摘0後、ユーザー確認工程と配送指示を待つ。自分のserverだけ停止/port閉鎖確認。

## 開始条件

BE #547 main mergeとFE worktree/branch通知、rootの本計画レビューを待つ。追加ユーザー承認は不要。現時点では準備文書のみでアプリ/テスト/DB変更なし。完全な新規画面案や追加仕様質問は増やさず、承認画像と既存操作慣例を使う。


## rootレビューによる適用範囲の明確化

- scope/credentialの送信前後検査・明示Bearer固定・古い応答の隔離は、台帳付き操作だけでなくlink PATCHにも適用する。旧link PATCHを新しい利用者のtokenで再送しない。
- consume/undo成功後、menu GET成功・inventory GETのみ失敗なら、食済状態/mealRevision/canConsume/canUndoは取得済みmenuを使う。carryだけを停止してinventory GET再試行を提示する。無関係なinventory同期待ちでconsume/undo全体を止めない。
- 操作結果自体が不明なpendingの重複抑止は別であり、単なるinventory GET失敗と混同しない。成功応答受領済みなら同じmutationを再送せず必要なGETだけを再試行する。

## 分担・共通インターフェース案（開始前のroot調整用）

- 基盤/献立担当: api/zaikoTypes.ts, api/kondateTypes.ts, api/menuInventory.ts, lib/menuOperationPending.ts, hooks/useMenuInventoryOperation.ts, pages/MenuPage.tsx, 献立連携行/確認dialog新規部品と対応unit tests。
- 在庫/選択担当: components/kondate/RecipePicker.tsx, MenuAddSheet.tsx, components/zaiko/InventoryModal.tsxおよび連携入力/設定部品, InventoryPanel.tsx, pages/ZaikoPage.tsxと対応unit tests。共通型ファイルは基盤担当が先に追加し、在庫担当は同ファイルを同時編集しない。
- ops: E2E/QA/Git/要件文書。BE merge後の専用worktreeで開始、共通型の引渡しが先行。

RecipePicker props案は既存MenuAddSheetの命名を維持する:
`{recipes: Recipe[]; keyword: string; selectedIds: number[]; registeredRecipeIds?: number[]; disabled?: boolean; onKeyword:(value:string)=>void; onToggle:(id:number)=>void; onClear:()=>void}`。
検索欄の可視labelは「レシピを検索」。候補はお気に入り先頭・同順位は元順、filterByKeywordを使う。選択は親管理なので検索外も保持。登録済み印は任意、既存献立の再追加は禁止しない。候補展開だけではonToggle/送信しない。新規料理名入力/各使用数/重複選択禁止は在庫側の責務。

通信基盤は`MenuScope={actorUserId:number;householdId:number}`、`InventoryMenuLink`、`MenuInventoryLinkage`、`LinkedInventoryCreateBody`、`MenuMealResult`を公開し、BE応答型を一箇所へ集約する。
`MenuOperationEnvelope`はversion/scope/操作種別/対象ID/作成時刻/UUID/完全なdeep-copy済み送信bodyを持つ判別共用体。token/headerは持たない。
台帳付きmutationの呼出面は`run(input)`/`recover()`/`pending`/`busy`/`outcome`を公開するhookを候補とし、register inputは通常在庫+menusの下書き、consume/undo inputはentryId+mealRevisionとする。UUID付与・scope固定・保存/readback・送信は基盤責務、表示とmenu/inventory個別の再取得は呼出元責務。成功結果と各GET失敗を別状態にする。
link PATCHは別の`updateInventoryMenuLink(id, body, verifiedScope, credentials)`相当の固定credential通信を使い、CAS失敗を自動再送しない。署名の最終形は開始直後に型ファイルへ確定し、在庫担当へ引き渡す。


## 再ONの在庫境界（BE最終レビュー反映）

- enabled false→true、またはcarry false→trueの明示再ONは現在庫>0が条件。在庫0では再ON操作を不可にして「在庫を補充してから再開してください」と説明する。補充しても自動ONにしない。送信前に在庫が変わった場合の409は最新GET後に再確認する。
- この条件を初回の在庫0/carryOFF登録、すでに有効な在庫0の使用数編集、OFF操作、取消へ一律適用しない。consume/undoの可否はmenu GETの能力を引き続き使い、再ONの可否と区別する。API型変更なし。


## 連携献立の週表示名（BE最終レビュー反映）

- 連携行のrecipeTitleは週行生成時の原本名snapshotとして表示する。原本を改名・削除しても週表示名を保持し、食済名を消さない。通常の非連携行は従来のlive title/削除時null表示を維持する。
- 原本を開けるかはrecipeIdと原本削除状態で別判定する。原本GETが取得できても、そのlive titleで連携週行の表示名を上書きしない。削除後もsnapshot名を示し、consume不可/取消可否はmenu能力を使う。
- API型recipeTitle:string|nullは変更なし。BEは共有済0028を編集せず新0029で対応済み（PR #550）。FE実装/テストの開始条件は引き続きBE merge通知後。
- core実装はfresh workerへ引き渡し、当担当は計画/独立レビューを継続する予定。上記owner案はrootの最新割当を優先する。

## ops検証計画・実績

- [x] 開始時点（main `70d4b1f`）のfrontend全体lintを実行しexit 0を確認。
- [x] 開始時点のfrontend全体unitを実行し67ファイル1041テストpassを確認。
- [x] frontend全体buildを実装完了後に再検証した（成功）。初回は並行TDD開始中の `menuOperationPending.test.ts` が実装ファイル着地前に参照しTS2307となった。既存問題とは扱わない。
- [x] 実API契約は既存 `e2e/tests/menu-inventory-api.spec.ts` と上記承認仕様を参照し、UI可視label/roleが確定してからWeb E2Eを追加する。
- [x] 1280/390/320pxで新規在庫3→新規2+既存原本1（Web出典はunit）→週献立3件、consume2・undo3、別在庫の同原本分離を実Workersで検証する。
- [x] 在庫0でcarryOFF、補充で自動再開しない、明示再ONと食済非復活、改名・原本削除後の週snapshot名を検証する。競合/認可/週跨ぎの境界網羅は既存BE unit/API E2Eと役割分担する。
- [ ] console-guard監視、横overflow/44px操作領域/入力16px、dialogのfocusとキーボードを確認する。架空データ・ローカル専用D1だけを使い、既存5173を操作せず、自分の8787/画面portを停止して後始末を確認する。
- [ ] 完成後のfrontend lint/test/build、必要なAPI回帰、通常E2E全体と専用設定、相対リンク/空白チェックをroot管理の実行窓で確認する。
### Web E2E準備記録

`e2e/tests/menu-inventory-ui.spec.ts` に5件を追加し、`npx playwright test --list tests/menu-inventory-ui.spec.ts` で検出を確認（実行結果ではない）。1280/390/320pxで登録・実食・取消と在庫3→2→3、入力16px/44pxと横overflow/画面証拠を確認する。残り2件は在庫0停止/補充非再開/明示ON/同原本別在庫不変、および実保存後503→reload→別世帯非表示・404→本人の同一ID/body回復を扱う。データ準備と検証用GETだけを実API helperへ分離し、対象mutationはUIから操作する。外部サイト依存を避け、既存原本はmanualで準備し、Web出典の表示はRecipePicker/登録unitのWeb fixtureと役割分担する。

在庫担当の依頼により共通CSS（zaiko.css/recipes.css）をops所有で最小追加。RecipePickerの検索/チェック配置をsheet限定からpicker配下へ共通化し、在庫フォームのfieldset reset、grid、16px入力、44px操作領域、献立controlsの折返しを適用。対象diffcheck成功。全体build/実画面結果は統合準備完了後に確認する。

### 統合レビュー対応記録

- 2026-11-15の初回統合frontend unitは75ファイル1071件中1059pass/12fail。通常在庫へ新しい連携確認messageがalertとして混入し、通常登録後GET失敗も連携用ロックへ入る回帰を在庫担当が分離。既存fixture/厳密assertは変更せず、アプリ修正後に再検証する。
- BEの異body同requestIdは409 `RESOURCE_CONFLICT` と `details:[{field:'requestId',reason:'PAYLOAD_MISMATCH'}]`。誤った単独codeのfixtureを実形へ訂正し、初回markerでもunknown/pending保持をAPI3操作・hookで追加。caller redは5fail/9pass、Codex exec最小修正後14/14pass。普通の初回409を確定拒否する既存挙動は維持。
- carry PATCH直前GETの自動refresh後にbusyが残る経路、onDetachedで通常献立のdialog/下書きが残る経路、同token世帯変更時のPurchaseIdentityError分類は、同executorへテスト先行でまとめて依頼中。サーバーを起動せず修正・局所検証後、全体品質とWeb E2Eを再開する。

### 最新の検証実績（2026-11-15）

- frontend全体: `npm run lint` / `npm test` / `npm run build` 成功。75ファイル1090テストpass。初回buildの並行着手参照と追加テストのRTL型誤記は解消済み。
- 独立レビュー採用修正: 実形requestId/PAYLOAD_MISMATCHはunknownを保持。scope/credential不一致の同期invalidateで旧dialog/draft/一覧を隔離し、carryの確定不一致後は追加GET不要。API/hook/献立の31件と、旧在庫回帰を含む6ファイル84件pass。旧scopeの保存pendingは元scopeへ保持し、別scopeへ移植しない。
- 新Web E2E `npm test -- tests/menu-inventory-ui.spec.ts --workers=1`: 5pass（27.0秒）。3幅の登録/実食/取消、同原本別在庫不変、0停止/補充非再開/明示ON、実commit後503/reload/別世帯非表示404/同IDbody回復を確認。初回1pass/4failはテストの品名50文字上限超過とcontrolled checkbox非同期待機を修正して解消。
- 通常全体 `npm test -- --workers=2`: 286pass/4skip/1fail（4.8分）。既存WarikanコメントdialogのTab後focus可視領域だけ失敗（bottom9940.09、viewport844）。アプリ/テスト変更なしで同シナリオ3幅をworkers1再検証し3pass。今回CSSはrecipe/menu/inventory限定、Warikan/useDialog/共通modalは不変。単一原因は断定せず、全体を成功と読み替えない。最新CI全件成功をdelivery条件とする。
- 3幅の画面証拠は共通scratch `issue548-ui-evidence/`。横overflow・使用数入力16px/44pxと確認dialog初期focusをE2Eで確認。通常4skipは既存の録画/表示確認用の条件付き除外。現行30Markdownリンク不備0、git diff --check成功。
- 専用設定とdeliveryの結果は完了後に追記。本番反映・ユーザーの最終ブラウザ確認は未実施。

専用E2E最終結果: `npm test -- --config playwright.menu-cleanup.config.ts` は1pass、demo設定は7pass、static-assets設定は11pass。各runner終了時に専用D1残数0を確認。既存5173（PID6664）は停止せず、今回使用8787/画面空きportだけ後始末する。frontend以外の実行コード/DB/migration差分なし。

### PR #551 正式CLIレビュー対応

`codex review --base main` の初回正式レビューで、期限切れaccessを「本人と世帯を再確認」から更新できないP2を採用。hookの実401/refresh経路で3ケースredを確認し、利用者の明示再確認だけ既存GET refresh→新credential固定の本人/世帯再検証へつなぐ最小修正を行った。自動checkはrefreshせず、mutationを自動再送しない。元pendingは元scope/id/bodyで保持し、refresh中のsession変更では旧応答を適用しない。同期invalidateの追加通信不要保証も維持。

caller最終検証: API/hook/献立34件pass、frontend全体lint/typecheckを含むbuild成功・75ファイル1093テストpass、新UI実Workers5件pass（27.3秒）。D1残数0・今回8787/画面空きport閉鎖、既存5173 PID6664は不操作。最新修正headの正式CLI再レビューとCI全成功をマージ条件とする。
