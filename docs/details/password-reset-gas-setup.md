# パスワード再設定メール（GAS）設定手順（#401）

設計は [password-reset-mail-design.md](password-reset-mail-design.md)。GASのコードは [`gas/password-reset-mail/Code.js`](../../gas/password-reset-mail/Code.js)。

**ここに実値（共通鍵・GASのURL・メールアドレス）を書かない。** コミット・Issue・PR・チャット・ログにも出さない。本番の有効化は、ユーザーが本番反映を指示してから行う。

## 構成と役割

| 部品 | 役割 |
| --- | --- |
| Workers | トークン発行・回数制限・停止スイッチ。署名付きでGASを1回だけ呼ぶ（自動再送なし） |
| GAS（Webアプリ） | 署名・時刻・形式を検証し、固定文面のメールをMailAppで送る。任意の件名・本文・リンクは送れない |
| 共通鍵 | WorkersとGASが同じ値を持つ。HMAC-SHA256の署名にだけ使い、通信には載せない |

## 初回設定（ユーザーが行う）

1. **送信専用のGoogleアカウントを用意する**（専用を推奨。メールの送信元に表示される。アカウントの選択・作成はユーザーが行う）。
2. そのアカウントで [Apps Script](https://script.google.com/) に新しいプロジェクトを作り、`gas/password-reset-mail/Code.js` の内容を貼り付ける。
3. **Script Properties** を設定する（プロジェクトの設定 → スクリプト プロパティ）。
   - `SHARED_SECRET`: 十分に長いランダム文字列（例: `openssl rand -base64 48` の出力）。**生成した値はこの場で控え、次の手順のWorkers secretにも同じ値を入れる。ファイルやチャットには残さない。**
   - `APP_URL`: アプリの公開URL（`https://` で始まる。末尾スラッシュは不要）。この値からメールのリンクを作る。
4. 初回のみ、エディタで `doGet` を実行し、MailAppの送信権限を許可する（Gmailの受信箱を読む権限は要求しない）。
5. **デプロイ → 新しいデプロイ → 種類: ウェブアプリ** で公開する。
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**（Googleログイン不要でWorkersから呼ぶため。公開URLを知るだけでは送れず、毎回の署名検証が必要）
   - 発行された `/exec` のURLは秘密として扱う。
6. **Workers側のsecretを登録**する（`backend-workers/` で。値は対話入力する。コマンド引数・ファイルに書かない）。
   ```
   npx wrangler secret put PASSWORD_RESET_GAS_URL
   npx wrangler secret put PASSWORD_RESET_GAS_SECRET
   ```
   `PASSWORD_RESET_GAS_URL` は `https://script.google.com/macros/s/.../exec` 形式のみ受け付ける（それ以外は利用不可扱い）。`PASSWORD_RESET_GAS_SECRET` は手順3の `SHARED_SECRET` と同じ値。
7. **有効化**: `backend-workers/wrangler.toml` の `PASSWORD_RESET_MAIL_ENABLED` を `"true"` にして反映する（初期値は `"false"` = 停止）。反映後、`GET /api/auth/password-reset/availability` が `{ "available": true }` を返すことを確認する。
8. **実配信の確認**: ユーザーが承認した宛先1件だけで、申請 → メール受信 → リンクで新パスワード設定までを確認する。

## 日常の運用

| 操作 | 手順 |
| --- | --- |
| 一時停止 | `PASSWORD_RESET_MAIL_ENABLED` を `"false"` にして反映。申請APIは503（利用不可）を返し、画面は案内に切り替わる。即時に止めたいときはGASのデプロイを「管理 → アーカイブ」でもよい（Workers側は失敗をログに残すだけで応答は変わらない） |
| 共通鍵の更新 | 新しい値を生成 → GASの `SHARED_SECRET` と Workers の `PASSWORD_RESET_GAS_SECRET` を続けて更新。更新の間に飛んだ要求は署名不一致で失敗する（`reason=signature`）ので、更新は短時間で行い、直後に1件確認する |
| コード更新 | GASエディタで貼り替え → **デプロイ → デプロイを管理 → 編集 → 新バージョン**（URLは変わらない）。新規デプロイするとURLが変わるため、その場合は `PASSWORD_RESET_GAS_URL` も更新する |
| 送信枠 | 個人アカウントはMailAppが1日100宛先（Googleの仕様で変わりうる）。アプリ全体の申請上限は50件/日で、これより低く保っている |

## 障害の見分け方（Workersのログ）

ログには失敗の分類と相関ID（`requestId`）だけが出る。宛先・トークン・本文・URL・鍵は出ない。

| `reason` | 意味 | 対処 |
| --- | --- | --- |
| `timeout` / `network` | GASに届かない・応答が遅い。**メールは送られている可能性がある**（届いたリンクは30分以内なら使える） | 続くならGASの状態とGoogleの障害情報を確認。自動再送はしない |
| `http_error` / `invalid_response` | GASのURL違い・デプロイ削除・Googleの一時エラー | URLとデプロイ状態を確認 |
| `signature` | 共通鍵の不一致 | 両側の鍵を更新し直す |
| `expired` | 時刻のずれ（許容±5分） | 通常は一時的。続くなら調査 |
| `authorization` | 送信権限の失効・アカウント停止 | GASエディタで手順4をやり直す |
| `quota` | 当日のMailApp枠不足 | 翌日まで待つ。必要なら停止スイッチで案内を切り替える |
| `config` | GASのScript Properties未設定・`APP_URL`がhttpsでない | 手順3を確認 |
| `busy` | GASが同時処理中 | 利用者が少し待って再申請 |

## ローカル開発・テスト

- 通常のテスト・E2Eは実GASや実メールに接続しない（`fetch` を模擬）。GAS側は `gas/` で `npm test`（Apps Scriptのグローバルを模擬するNodeのテスト）。
- メールなしで画面確認したいときだけ、`.dev.vars` に `APP_PASSWORD_RESET_LOG_TOKEN_ENABLED=true` を設定すると、生トークンがログに出て申請が通る。共有環境・本番では設定しない。

## 既知の制約

- 署名検証は不正送信を防ぐものであり、GASの公開URLへのリクエストによるGoogle側の実行枠消費までは防げない。URLを画面・ログ・リポジトリへ出さない。
- MailAppと重複検出の保存を跨ぐ厳密なexactly-onceは保証しない。短時間の同一要求IDの再送を検出して抑える。
- 到達保証・配信SLAはない。迷惑メール判定されたときは、再申請の案内と受信設定の確認で対応する。
