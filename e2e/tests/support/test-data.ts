import { randomUUID } from 'node:crypto'

// テストデータ規約(~/.claude/CLAUDE.md「テストデータの標準要件」)
// - メールは RFC 2606 予約ドメイン example.com のみ
// - 表示名は e2euser_ 接頭辞、パスワードはテスト専用固定値
// - 並列実行・再実行で衝突しないようランダムな接尾辞を付ける
export const E2E_PASSWORD = 'TestPass123!'

export interface E2EUser {
  email: string
  password: string
  displayName: string
}

export function newUser(label: string): E2EUser {
  const suffix = randomUUID().slice(0, 8)
  return {
    email: `e2euser_${label}_${suffix}@example.com`,
    password: E2E_PASSWORD,
    displayName: `e2euser_${label}_${suffix}`,
  }
}

export function e2eTag(text: string): string {
  return `[E2E_TEST] ${text}`
}
