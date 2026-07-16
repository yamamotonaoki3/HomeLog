# HomeLog — Claude Code ワークフロールール

## 絶対に守るルール

1. **作業は必ずイシューから始める**
   - コード変更・機能追加・バグ修正・ドキュメント更新、いかなる作業も GitHub Issue を先に作成する。
   - Issue なしにブランチを切ってはいけない。

2. **main ブランチへの直接プッシュ禁止**
   - `git push origin main` は禁止。GitHub 側でも強制されている。
   - 必ず作業ブランチから PR を作成し、マージで取り込む。

3. **PR はレビュー・動作確認後にマージする**
   - 自分でセルフレビューを行い、チェックリストを埋めてからマージする。
   - CI（整備後）が通っていることを確認する。

4. **内部設定・周知不要なものはGitHubに上げない**
   - `.claude/`（スキル・エージェント・設定等、Claude Codeの内部動作設定）は `.gitignore` で除外し、リポジトリにコミットしない。
   - 同様に、チーム外への周知が不要な個人環境依存の設定ファイルはコミット対象外とする。

5. **MyBatisのSQLは必ずXMLマッパーファイルに書く**
   - Mapperの実装ではSQLをJavaアノテーション（`@Select`等）に書かず、`resources/mapper/<feature>/*.xml`に集約する。SQLとコードを分離することで、SQL単体の可読性・保守性を保つ。

---

## ブランチ命名規則

```
<prefix>/#<issue番号>-<英語の概要>
```

| プレフィックス | 用途 |
|---|---|
| `feature` | 機能追加 |
| `fix` | 不具合修正 |
| `chore` | リファクタ・設定変更・依存更新 |
| `docs` | ドキュメントのみの変更 |

**例:**
- `feature/#1-add-zaiko-entity`
- `fix/#5-kakeibo-total-not-updating`
- `chore/#3-update-dependencies`
- `docs/#2-add-requirements`

---

## 作業フロー（毎回この順番で）

```
0. ドキュメントを必ず読む（プランを立てる前に必ず実施）
     - docs/requirements.md（全体要件定義書）
     - docs/構想.md（全体構想）
     - docs/details/features/F0x_*.md（対象機能の詳細要件定義書）
     - docs/details/common-notes.md（機能横断の共通事項）
     - docs/details/data-model.md（ER図・テーブル定義）
     - docs/技術スタック.md（技術スタック構成）
     上記のうち対象機能に関係するファイルを全て確認した上で実装プランを立てる。
1. GitHub で Issue を作成（テンプレートを使う）
2. ブランチを切る: git checkout -b feature/#<番号>-<概要>
3. テスト駆動開発（TDD）で実装する
     3-1. 対象機能のテスト（Controller/Service/Mapperの単体テスト）を先に書き、red（失敗）になることを確認する
     3-2. テストを green にする最小限の実装を行う
          ※ Mapperの実装時はSQLをXMLマッパーファイル（`resources/mapper/<feature>/*.xml`）に書く。アノテーションSQLは使わない
     3-3. リファクタリングする（テストが green のまま保たれることを確認しながら整理する）
4. 品質チェックを実行する（/品質チェック スキルを使う）
     4-1. 単体テストが実行可能な状態であれば、単体テストを実行し green であることを確認する
     4-2. バックエンドに変更がある場合は、結合テストも実行し green であることを確認する
          ※ backend/ で `.\gradlew.bat integrationTest`（Docker Desktop起動が前提。詳細は docs/結合テスト.md）
5. ユーザーがブラウザで動作確認する（← ここで一度止まる）
6. コミット: git commit
7. git push origin <ブランチ名>
8. GitHub で PR を作成（テンプレートを使う・Closes #<番号> を記載）
9. Codex CLI でコードレビューを実行し、指摘があれば Codex 自身に修正させる（次項参照）。指摘ゼロになるまで繰り返す。
10. セルフレビュー → マージ
11. ブランチ削除（マージ後は GitHub が自動削除）
```

**TDDを採用する理由**：先にテストでインプット/アウトプットの形（entity・dtoの形状）を固めてから実装に入ることで、実装途中で設計ミスや考慮漏れに気づく「手戻り」ではなく、コーディング前の段階でエラーを検出できるようにするため。

**Codex CLIによるレビュー・修正フローについて**：このマシンには Codex CLI（ChatGPTアカウントでログイン済み）が導入されている。`codex review --base main` でブランチの差分を非対話的にレビューできるほか、`codex review --uncommitted` でコミット前の変更、`codex review --commit <SHA>` で特定コミットのレビューも可能。Claude Codeによるセルフレビューに加え、別モデルによる第二の視点として活用する。

指摘が出た場合は、以下の手順を**都度の指示なしに毎回**適用する（恒久ルール）。

1. `codex review --uncommitted`（または `--base main`）でレビューを実行する。
2. 指摘があれば、指摘内容と対象ファイルを踏まえた具体的な修正指示を添えて `codex exec "<修正指示>"` を実行し、**Codex 自身にコードを修正させる**。Claude Code が直接コードを修正するのは、Codex の応答が得られない・失敗する等、Codex による修正が行えない場合の代替手段とする。
3. Codex の修正後、Claude Code が `./gradlew.bat test checkstyleMain checkstyleTest` 等で検証する（Codex 自身のサンドボックスからは Gradle が実行できないことがあるため、ビルド・テストの最終検証は必ず Claude Code 側で行う）。
4. 指摘ゼロになるまで `codex review` の再実行 → `codex exec` による修正を繰り返す。

---

## テスト方針（単体テスト・結合テスト）

- **単体テスト**：TDD（3章参照）で先に書く。Controller/Service/Mapperそれぞれの責務単位でテストを作成する。
- **結合テスト**：複数レイヤー（Controller→Service→Mapper→DB）やAPI経由の疎通を検証できる状態になった機能から、順次結合テストを整備・実行する。基盤はTestcontainers（PostgreSQL 17）＋`backend/src/test/java/com/homelog/integration/`のIntegrationTestBase。実行手順は`docs/結合テスト.md`を参照。
- **テストケース設計の基本**：ブラックボックステストとホワイトボックステストの両観点で設計する。
  - **ブラックボックステスト**：仕様（要件定義書・入力チェック仕様）を基に、同値分割・境界値分析でテストケースを洗い出す（正常系・異常系・境界値）。
  - **ホワイトボックステスト**：実装コードの分岐・条件を基に、主要な分岐網羅（if/switch等の各分岐、ループの0回・1回・複数回等）を確認するテストケースを洗い出す。
- 単体テスト・結合テストとも、実行可能な状態になった時点で作業フロー4章の品質チェックの一部として都度実行し、greenであることを都度確認しながら進める。

---

## コミットメッセージ規則

```
<種別>: <変更内容の要約>（日本語可）

例:
feat: 在庫アイテム登録機能を追加
fix: 割り勘精算時の端数計算を修正
chore: Gradle Wrapper を 9.5.0 に更新
docs: 要件定義書を追加
```

---

## バックエンドアーキテクチャ規約

Spring Boot の基本 3 層構造を必ず守ること。

```
Controller → Service → Mapper
```

| 層 | 責務 | 必須 |
| --- | --- | --- |
| Controller | HTTP リクエスト受け口。バリデーション・レスポンス組み立てのみ行い、ロジックを持たない | ✅ |
| Service | ビジネスロジック本体。トランザクション境界 | ✅ |
| Mapper | MyBatis によるデータアクセス。SQL は全て XML マッパーファイル（`resources/mapper/<feature>/*.xml`）で管理する。アノテーション SQL は使わない | ✅ |

### パッケージ構成

機能パッケージ（`auth`, `household`, `kakeibo`, `zaiko`, `kondate`）は以下のディレクトリ構成に統一する。

```
com.homelog.<feature>/
├── controller/
├── service/
├── mapper/       … MyBatisマッパーインターフェース
├── entity/       … DBの行に対応するデータクラス（Mapperの戻り値・引数）
└── dto/
    ├── request/  … Controllerが受け取るリクエストボディ
    └── response/ … Controllerが返すレスポンスボディ
```

- **entity と dto を分離する理由**：entityはDBの形、dtoはAPI入出力の形。分離することでDBスキーマ変更がAPI仕様に直結せず、Controllerが必要な項目だけをレスポンスに含められる。
- **dto配下で request/response を分ける理由**：1つの機能で複数エンドポイントを持つ際にファイルが増えても迷わず置き場所が決まるようにするため。

横断的な共通処理は `common` パッケージに集約する。

```
com.homelog.common/
├── config/       … SecurityConfig, WebConfig(CORS), OpenApiConfig等 アプリ全体設定
├── exception/    … GlobalExceptionHandler(@RestControllerAdvice), 独自例外クラス群
├── security/     … JWTフィルタ・JWTユーティリティ
├── constant/     … 全機能共通の定数・Enum
└── util/         … 日付操作等、複数機能から使う純粋ユーティリティ
```

- **securityをauthではなくcommonに置く理由**：auth機能の中に置くと、他機能のControllerがJWT検証のためだけに`auth`パッケージへ依存する逆転が起きるため、認証基盤は独立させる。
- **constantとutilを分ける理由**：「値」と「振る舞い」を混在させないための整理。

### テスト構成（単体テストの完結性）

`src/test/java/com/homelog/<feature>/` に本体と同じ `controller/service/mapper` 構成をミラーリングし、機能ごとに「そのパッケージだけ見ればテストが揃っている」状態にする。

- Mapperの単体テスト: H2（インメモリDB）を使用
- Service/Controllerの単体テスト: Mockito / MockMvc で完結させる

---

## 技術スタック

| 役割 | 技術 |
| --- | --- |
| フロントエンド | React 19.2.7 + TypeScript 6.0.2 |
| ビルドツール | Vite 8.1.0 |
| ルーティング | React Router 7.15.1 |
| HTTP クライアント | Axios 1.16.1 |
| Lint | oxlint 1.69.0 |
| テスト(FE) | Vitest 4.1.9 + Testing Library + msw |
| バックエンド | Java 25 / Spring Boot 4.0.3 / Gradle 9.5.0 |
| DBアクセス | MyBatis 3.5.19 + Flyway |
| 認証 | Spring Security + JWT (jjwt 0.12.6) |
| データベース | PostgreSQL 17 |
| 画像ストレージ | AWS S3 |
| コンテナ | Docker |
| Lint(BE) | Checkstyle 10.21.4 |

詳細は `docs/技術スタック.md` を参照。

## アプリ起動手順

```bash
# 1. データベース起動（backend/ ディレクトリで）
cd backend
docker compose up -d

# 2. バックエンド起動（backend/ ディレクトリで）
.\gradlew.bat bootRun

# 3. フロントエンド起動（frontend/ ディレクトリで）
cd frontend
npm run dev
```

`.claude/skills/run-dev` スキルを使うと上記手順を自動実行できる。
