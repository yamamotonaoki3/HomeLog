// webServer起動より後に実行されるため、ここではDBを消さない(リセットはscripts/cleanup.mjs)。
// テスト開始前に、接続先がローカルのbackend-workersであることだけを確認する。
export default async function globalSetup() {
  const res = await fetch('http://localhost:8787/health')
  if (!res.ok) {
    throw new Error(`backend-workers(localhost:8787)に接続できません: ${res.status}`)
  }
}
