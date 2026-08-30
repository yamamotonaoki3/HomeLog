// パスワードハッシュ・トークン生成のユーティリティ。
// 既存Java実装はBCryptを使用しているが、Cloudflare WorkersはネイティブバインディングであるBCryptを
// 実行できないため、Workers標準のWebCrypto SubtleCryptoのみで完結するPBKDF2-HMAC-SHA256に置き換える。
// データ引き継ぎは不要なため、既存ハッシュとの互換性は考慮しない。

const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES = 16
const HASH_BITS = 256

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    HASH_BITS,
  )
  return new Uint8Array(derived)
}

/**
 * パスワードをハッシュ化する。返り値は `pbkdf2$<iterations>$<saltBase64>$<hashBase64>` の形式。
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await deriveBits(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

/**
 * パスワードとハッシュ値を比較検証する。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
    return false
  }
  const iterations = Number(parts[1])
  const salt = fromBase64(parts[2])
  const expectedHash = parts[3]

  const actualHash = toBase64(await deriveBits(password, salt, iterations))
  return timingSafeEqual(actualHash, expectedHash)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * リフレッシュトークン・パスワードリセットトークン用の、推測不能なopaqueトークンを生成する。
 * base64url形式の文字列を返す。
 */
export function generateOpaqueToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * 文字列のSHA-256ハッシュを16進文字列で返す。opaqueトークンをDBに保存する前のハッシュ化に使う。
 */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
