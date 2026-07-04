---
description: HomeLog の開発環境を起動してブラウザで開く
---

# HomeLog 開発環境起動スキル

## 手順

### 1. データベース起動（Docker）

```bash
cd backend && docker compose up -d
```

PostgreSQL 17 コンテナが起動する。

### 2. バックエンド（Spring Boot）の起動確認

すでに起動しているか確認する：

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/actuator/health 2>/dev/null || echo "not running"
```

- `200` が返ればすでに起動済み → 手順4へ
- 接続失敗なら手順3へ

### 3. バックエンドを起動

```bash
cd backend && ./gradlew bootRun > /tmp/spring.log 2>&1 &
sleep 10
cat /tmp/spring.log | tail -20
```

`Started ... in ... seconds` が表示されれば起動成功。

### 4. フロントエンド（React + Vite）の起動確認

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173 2>/dev/null || echo "not running"
```

- `200` が返ればすでに起動済み → 手順6へ
- 接続失敗なら手順5へ

### 5. フロントエンドを起動

```bash
cd frontend && npm run dev > /tmp/vite.log 2>&1 &
sleep 5
cat /tmp/vite.log
```

`Local:   http://localhost:5173/` が表示されれば起動成功。

### 6. ブラウザを開く

```bash
start http://localhost:5173
```

Windows のデフォルトブラウザで `http://localhost:5173` が開く。

## トラブルシューティング

- Spring Boot が起動しない場合は `/tmp/spring.log` を確認する
- Vite が起動しない場合は `/tmp/vite.log` を確認する
- DB 接続エラーの場合は `docker compose ps` でコンテナ状態を確認する
