// E2E専用ローカルD1(backend-workers/.wrangler/e2e-state)を削除し、テストデータを残さない。
// E2Eは開発用DBと分離した専用保存先のみを使うため、保存先ごと消すことで
// e2euser_% / [E2E_TEST] のデータが確実に0件になる。
import { existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../../backend-workers/.wrangler/e2e-state', import.meta.url))
rmSync(dir, { recursive: true, force: true })
if (existsSync(dir)) {
  console.error(`削除に失敗しました: ${dir}`)
  process.exit(1)
}
console.log(`E2Eデータを削除しました（残数0）: ${dir}`)
