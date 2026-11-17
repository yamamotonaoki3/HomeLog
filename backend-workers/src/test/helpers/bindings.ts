import { env } from 'cloudflare:test'

// テストは wrangler.toml の本番の設定で動くため R2・AI がある
export function testImages(): R2Bucket {
  if (!env.RECIPE_IMAGES) throw new Error('テスト用の RECIPE_IMAGES がありません')
  return env.RECIPE_IMAGES
}

export function testAi(): Ai {
  if (!env.AI) throw new Error('テスト用の AI がありません')
  return env.AI
}
