# Issue #546 承認仕様・DB/API契約

2026-11-15。ユーザー承認済み追加ルールと入力READMEを具体化する実装契約。入力資料のimplementation_plan.mdは原本として変更しない。[バックエンド実装計画](../plans/2026-11-15-inventory-menu-link-backend.md)を参照。バックエンドは隔離環境にローカル実装済み（#547）。画面#548・コミット・PR・マージ・本番反映は未実施。

## 業務規則

- 一つの在庫から複数メニュー。新規名はそれぞれmanualレシピを作成、既存原本は複製しない。同一原本でも在庫別に別の関連・別の週献立となる。
- 在庫登録からの追加はJST今週、使用数初期1。使用数は0.1〜99999.9、小数1桁。計画使用数合計の在庫超過は許可する（在庫予約ではない）。
- 登録・献立追加・持越しは在庫不変。食べた操作で週行に設定済みの使用数だけ減算し、食済行はその週に残す。同じ食済行の再消費は禁止。
- 在庫不足は全未反映エラー。複数在庫のまとめ消費は提供しない。
- 取消でその食事量を現在在庫へ相対加算し未食へ戻す。補充や別消費を上書きしない。返却後99999.9を超える場合は全未反映エラー。
- 持越しONかつ在庫ありなら翌週に未食の新規行。食済履歴・食事操作IDは引き継がない。0到達で持越しOFF、補充・取消で自動再ONしない。再ONは明示操作。
- 日次自動消費ONの在庫は連携対象外。連携を有効にしている間は日次消費ONへの変更を拒否し、どちらも無断変更しない。利用者は連携OFF後に日次消費をONにできる。
- 連携OFF・在庫削除・原本削除は将来の持越しを止める。既存週行は残し「連携解除／削除された在庫・レシピ」を表示、新たなconsumeは不可。既食行の取消は連携OFF・原本削除後も在庫と世帯権限が維持されれば可能。在庫削除後は409で拒否し在庫を再作成しない。献立行の明示削除も関連carryをOFFにし、数量は返さない（取消と区別）。通常献立・自由メモの削除動作は従来どおり。
- 取消は現行保持する当週行だけ。既存の過去週物理削除を維持し、cleanup後の新しい取消は404。別履歴UIは追加しない。保存済み要求の同一再送は週行削除後も保存結果を返す。

## DB（追加型0028・0029 migration、既共有migrationを変更しない）

`inventory_menu_links`:
`id PK, household_id FK CASCADE, inventory_item_id FK SET NULL, recipe_id FK SET NULL, recipe_title_snapshot TEXT NOT NULL, usage_tenths INTEGER NOT NULL CHECK 1..999999 DEFAULT 10, enabled INTEGER NOT NULL DEFAULT 1, carry_enabled INTEGER NOT NULL DEFAULT 0, starts_on TEXT NOT NULL（月曜）, revision INTEGER NOT NULL DEFAULT 0, created_at TEXT`。
関連行は世帯内共有。原本・在庫削除では関連を物理削除しない。enabled=0は以後consume不可、取消用snapshotを残す。再ONは同じ関連を使い現在在庫>0/原本存在/dailyOFFを要求する。設定変更は現行の未食週行へ使用数を反映しmeal_revisionも増やす。既存食済行のsnapshot/食済状態は変更せず、翌週新行で新設定を使う。今週行が既にあれば重複生成しない。

`menu_entries`追加:
`inventory_menu_link_id INTEGER NULL FK SET NULL, usage_tenths INTEGER NULL, meal_state TEXT NOT NULL DEFAULT 'uneaten' CHECK ('uneaten','eaten'), meal_revision INTEGER NOT NULL DEFAULT 0, consumed_event_id TEXT NULL`（UUID）。
通常行はlink/usage/event NULL、state=uneatenのまま。`UNIQUE(inventory_menu_link_id,week_start_date)`は連携行だけを重複防止し、従来の同原本手動再追加は制限しない。使用数/原本名は生成時snapshot。レシピの現行SET NULLを維持する。

0029で`menu_entries.recipe_title_snapshot TEXT NULL`を追加する。連携行は初回登録・明示再ON・持ち越しの新行生成時の現原本名を保存し、同値/使用数編集・食事状態更新・改名/削除では上書きしない。GETの連携行と登録応答`linkedMenuEntries`はこの週snapshotを返す。通常行は列NULLのまま現JOIN名に追随し、原本削除後は名前もNULL。原本のlive存在によるconsume/undo能力判定は変更しない。

既存連携行は移行時の現原本名、原本削除済みなら関連の名前snapshotでbackfillする。移行前の改名履歴は復元不能であり、移行前の生成時名を保証できない。関連作成時snapshotと各週生成時snapshotは別物とし、保存済み`menu_operation_requests`の成功JSONは一切更新しない。

dashboard summaryの`weeklyMenuEntries`とday-detailの`menuEntries`も、連携行は同じ週行の名前snapshot、通常行は現原本名（削除後NULL）を返す。

`menu_consumption_events`:
`id TEXT UUID PK, household_id FK CASCADE, menu_entry_id INTEGER NULL FK SET NULL, inventory_item_id INTEGER NULL FK SET NULL, quantity_tenths INTEGER NOT NULL, undone_at TEXT NULL, created_at TEXT`。
取消は週行のactive eventだけを対象にする。週行削除で履歴を消さず、在庫削除時は参照NULLにして取消不可。これは食事監査用であり家計簿とは連携しない。

`menu_operation_requests`:
`household_id FK CASCADE, actor_user_id FK users CASCADE, request_id TEXT, request_json TEXT NOT NULL, response_status INTEGER NOT NULL, response_json TEXT NOT NULL, guard INTEGER NOT NULL DEFAULT 1 CHECK(guard=1), created_at TEXT, PRIMARY KEY(household_id,actor_user_id,request_id)`。
連携登録/消費/取消の成功結果を保存。request_jsonはversion・操作名・対象ID・revision・正規化bodyを含む。同じ要求ID異bodyは409、同bodyは保存HTTP/JSON再現。現在認証/所属を先に検証し、別actor/別世帯へ結果を返さない。失敗は原子rollbackして保存しない。同じkeyの同時成功候補はbatch先頭の台帳INSERTのPKで調停し、敗者はrollback後に勝者の保存結果を再照合する。未知応答の再送は元要求ID/bodyを使う。期限自動削除はしない。

DBトリガー:
- inventory_items.quantity_tenthsが0になったUPDATE時、該当linkのcarry_enabled=0（ONだった関連だけrevision+1）。初期0ではcarryONをアプリ/書込条件で拒否。
- inventory削除/recipe削除前に該当link enabled=0/carry=0/revision+1。FK SET NULL後も週行は維持。
- 有効link作成/再有効化とdailyON更新を相互にDBで拒否する（既存dailyON行の移行は変更なし）。アプリ事前検証だけに依存しない。
- CHECK等は名前を固定し既知違反だけ400/409へ変換。未知D1例外を成功/未反映保証へ変換しない。

## API

全てrequireAuth→resolveHouseholdId、現所属の同世帯に限定。他世帯リソースは404。不正入力400 VALIDATION_ERROR、同時変更/不足/状態不整合は409 RESOURCE_CONFLICT。

1. `POST /api/inventory-items`の既存bodyへ任意`menuLinkage:{requestId,menus:[{newRecipeTitle?:string,recipeId?:number,usageQuantity?:number,carryEnabled?:boolean}]}`を追加。menusは1〜20、newRecipeTitle/recipeId排他、titleはtrim後1〜100、既存原本は同世帯。usage既定1、carry既定false。日次ONと同時指定不可。今週の在庫・新規原本・関連・週行・要求台帳を一つのbatchで作り、既存在庫応答に任意`linkedMenuEntries`を追加。従来bodyの応答/挙動不変。
2. `GET /api/inventory-items`の各行へ`menuLinks:Link[]`を追加。`Link={id,recipeId,recipeTitle,usageQuantity,enabled,carryEnabled,revision}`。無関連は[]。原本名は現在値、削除時snapshotと状態を返す。
3. `PATCH /api/inventory-menu-links/:id` body `{expectedRevision,usageQuantity,enabled,carryEnabled}`（全置換）。同値でもCAS revision+1。ON条件は上記、OFFは将来持越し停止で既存行を消さない。enabledのfalse→trueまたはcarryEnabledのfalse→trueという明示再ON時に現在週行がなければ1行追加（carryEnabled=falseの今週限定再連携も対象）、あれば重複生成せず未食行だけ設定反映。食済行は未食へ復活させない。同値設定や使用数だけの編集では削除済み行を復活させない。返すLinkは保存時snapshot。
4. `GET /api/menu-entries`の各要素に`inventoryLinkage:null|{linkId,inventoryItemId,inventoryName,quantity,usageQuantity,enabled,carryEnabled,linkRevision,mealState,mealRevision,canConsume,canUndo}`を追加。通常行null。quantityは現在在庫、usageは週行snapshot。消費/取消不可の理由を`unavailableReason:null|'link_disabled'|'inventory_deleted'|'recipe_deleted'|'daily_consumption'`で返す。
5. `POST /api/menu-entries/:id/consume` body `{requestId,expectedRevision}`。量はクライアントから受けず週行usageを使用。batch内で世帯/有効link/dailyOFF/未食/revision/在庫残を条件検証、相対減算→直後inventoryShoppingSync→食事event→週行食済/revision+1→結果台帳。既知guard不成立409で全rollback。
6. `POST /api/menu-entries/:id/undo-consumption` body `{requestId,expectedRevision}`。当週食済かつactive event未取消・同世帯・在庫存在を条件にevent量を相対返却→直後shopping同期→event取消→週行未食/eventNULL/revision+1→台帳。原本削除/連携OFFは取消を妨げない。在庫削除済みは409、行削除済みは404。取消後は新しいrequestIdで再度consume可（consumeの有効link/原本などの条件も必要）。
消費/取消の新規要求はJST当週の週行だけを対象とする。cleanup遅延で残った前週行や未来週行は409で全未反映とし、GETのcanConsume/canUndoも当週条件を含める。現在認証・所属の検証後、保存済みの同requestId・同bodyの再送はこの当週検査より先に照合し、週跨ぎ・週行削除後も過去の成功結果を再現する。
消費/取消200:`{menuEntryId,mealState,mealRevision,inventoryItemId,quantity,carryEnabled}`。GET再取得失敗は操作成功と区別する。保存結果は確定時snapshotで最新値ではない。

持越しは内部`carryMenuEntries(db,now):Promise<number>`。JST現在週だけを、enabled/carryON/stock>0/dailyOFF/recipe存在/starts_on<=週開始を条件にINSERT SELECT。同一(link,week)既存は上書きしない。在庫・原本・食事履歴は増減しない。0時/1時にcarry完了後cleanup、他の日次処理とは独立した失敗区分で再試行。毎時demo cleanupは既存の期限削除だけ。

## 実装判断

上記の当週取消・設定値のみ消費・予定超過許可・再ONと食済保持・削除と取消の区別は、2026-11-15のrootによる承認済み規則の具体化（rulings）。追加の履歴UI・原本削除後の新consume・暗黙の在庫復元は行わない。

既存関連の同レシピ重複選択はフォームで拒否し、同じ在庫/原本の有効linkもDB部分一意で防ぐ。異在庫では許可。新規同名レシピは通常原本の命名ルールに従い別物、名前で自動名寄せしない。未来週への通常手動追加は現APIを維持し、自動carryと原本IDだけで同一視しない。今週リンク追加のみが新しい在庫登録フローの対象。

新表には世帯CASCADEを付け、demo-cleanupは既存の世帯・利用者削除のCASCADEで要求台帳・食事履歴・関連を消す。全表比較テストで通常世帯の保持と期限切れデモの新表行消去を確認する。退会者の作成原本の共有保持方針は既存通り、要求台帳actor参照は既存usersの墓標化を維持し、デモ物理削除時に確実に消す。
