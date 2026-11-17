import type { Account } from '../api/kakeiboTypes'

type Kind = 'expense' | 'income'
const prefix = 'homelog.lastTransactionAccount.v1'

function storageKey(userId: number | null, kind: Kind): string | null {
  return userId != null && Number.isSafeInteger(userId) && userId > 0 ? prefix + ':' + userId + ':' + kind : null
}

function validSelection(kind: Kind, value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value === '') return true
  const id = kind === 'income' ? value : /^(account|card):/.test(value) ? value.split(':')[1] : ''
  return /^[1-9][0-9]*$/.test(id) && Number.isSafeInteger(Number(id)) && (kind === 'income' || value === 'account:' + id || value === 'card:' + id)
}

// nullは記憶なし、空文字は保存に成功した明示未選択。
export function readLastTransactionAccount(userId: number | null, kind: Kind): string | null {
  const key = storageKey(userId, kind)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== 'object' || Object.keys(value).length !== 1 || !('selection' in value)) return null
    return validSelection(kind, value.selection) ? value.selection : null
  } catch {
    return null
  }
}

export function writeLastTransactionAccount(userId: number | null, kind: Kind, selection: string): void {
  const key = storageKey(userId, kind)
  if (!key || !validSelection(kind, selection)) return
  try {
    localStorage.setItem(key, JSON.stringify({ selection }))
  } catch {
    // 記憶できないbrowserでも、成功済みの明細登録は成功として扱う。
  }
}

export function availableTransactionAccount(kind: Kind, selection: string | null, accounts: Account[]): string {
  if (!validSelection(kind, selection) || selection === '') return ''
  if (kind === 'income') return accounts.some(account => String(account.id) === selection) ? selection : ''
  const [type, id] = selection.split(':')
  const available = type === 'account'
    ? accounts.some(account => String(account.id) === id)
    : accounts.some(account => account.cards.some(card => String(card.id) === id))
  return available ? selection : ''
}
