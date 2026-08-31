import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// 既存Java実装のFlyway V1相当のテーブル定義をSQLite(D1)向けに翻訳したもの。
// Phase 2以降、household等のテーブルをこのファイルに追加していく。

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`),
})

export const refreshTokens = sqliteTable('refresh_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  tokenHash: text('token_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at'),
})

export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  tokenHash: text('token_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
})

export const households = sqliteTable('households', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`),
})

export const householdMembers = sqliteTable('household_members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  // MVPでは1ユーザー1世帯のみ所属可能なため、user_idはUNIQUE制約で二重所属を防ぐ
  // (アプリケーション層の事前チェックに加えた最終防衛線。docs/details/features/F02_household.md参照)。
  userId: integer('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  joinedAt: text('joined_at')
    .notNull()
    .default(sql`(current_timestamp)`),
})

export const zaikoCategories = sqliteTable('zaiko_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
})

export const stores = sqliteTable('stores', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
})

export const inventoryItems = sqliteTable('inventory_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  categoryId: integer('category_id')
    .notNull()
    .references(() => zaikoCategories.id),
  storeId: integer('store_id').references(() => stores.id),
  // 数量・閾値はSQLiteのfloat演算誤差(0.1の加減算の繰り返し等)を避けるため、
  // 「小数点第一位までの値を10倍した整数」として保持する。API入出力時にのみ10で除算/乗算する。
  quantityTenths: integer('quantity_tenths').notNull(),
  thresholdTenths: integer('threshold_tenths').notNull(),
})

export const shoppingListItems = sqliteTable('shopping_list_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  // 1在庫アイテムにつき買い物リスト項目は1件のみ(手動追加チェック・閾値による自動同期の
  // どちらも「存在確認してから挿入」という手順のため、同時リクエストによる重複挿入を
  // 防ぐ最終防衛線としてUNIQUE制約を付与する)。
  inventoryItemId: integer('inventory_item_id')
    .notNull()
    .unique()
    .references(() => inventoryItems.id, { onDelete: 'cascade' }),
  isManual: integer('is_manual', { mode: 'boolean' }).notNull(),
  purchased: integer('purchased', { mode: 'boolean' }).notNull().default(false),
  purchasedQuantityTenths: integer('purchased_quantity_tenths').notNull().default(0),
  addedAt: text('added_at')
    .notNull()
    .default(sql`(current_timestamp)`),
})

export const kakeiboCategories = sqliteTable('kakeibo_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
})

export const incomeCategories = sqliteTable('income_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
})

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  ownerUserId: integer('owner_user_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  type: text('type').notNull(),
  // 金額は整数円のためSQLiteでも誤差の心配がなく、INTEGERにそのまま保持する。
  balance: integer('balance').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`),
})

export const cards = sqliteTable('cards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // 'credit' | 'charge'。登録後の変更は不可(既存Java実装と同じ、CardServiceにUpdate用の
  // フィールドが存在しない)。
  cardType: text('card_type').notNull().default('credit'),
  balance: integer('balance').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`),
})

export const cardCharges = sqliteTable('card_charges', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: integer('card_id')
    .notNull()
    .references(() => cards.id, { onDelete: 'cascade' }),
  fromAccountId: integer('from_account_id')
    .notNull()
    .references(() => accounts.id),
  amount: integer('amount').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`),
})

export const expenses = sqliteTable('expenses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  payerUserId: integer('payer_user_id')
    .notNull()
    .references(() => users.id),
  categoryId: integer('category_id')
    .notNull()
    .references(() => kakeiboCategories.id),
  accountId: integer('account_id').references(() => accounts.id),
  cardId: integer('card_id').references(() => cards.id),
  // 固定費の毎月自動計上により作成された支出のみ設定される。固定費削除時はNULLになる
  // (既存Java実装のON DELETE SET NULLと同じ)。
  fixedCostId: integer('fixed_cost_id').references(() => fixedCosts.id, { onDelete: 'set null' }),
  // 同一固定費の同月分の二重計上を防ぐUNIQUE制約(fixed_cost_id, fixed_cost_year_month)のための列。
  // 通常の支出(fixed_cost_id=NULL)には影響しない(SQLiteはNULL同士を重複とみなさない)。
  fixedCostYearMonth: text('fixed_cost_year_month'),
  amount: integer('amount').notNull(),
  purpose: text('purpose').notNull(),
  memo: text('memo'),
  expenseDate: text('expense_date').notNull(),
  includeInHouseholdTotal: integer('include_in_household_total', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`),
})

export const incomes = sqliteTable('incomes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  earnerUserId: integer('earner_user_id')
    .notNull()
    .references(() => users.id),
  categoryId: integer('category_id')
    .notNull()
    .references(() => incomeCategories.id),
  amount: integer('amount').notNull(),
  content: text('content').notNull(),
  memo: text('memo'),
  incomeDate: text('income_date').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`),
})

export const recipes = sqliteTable('recipes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  createdByUserId: integer('created_by_user_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  ingredients: text('ingredients'),
  steps: text('steps'),
  // 'manual'/'ocr'/'web'。今回は'manual'のみ使用する。
  sourceType: text('source_type').notNull().default('manual'),
  // 将来のWEBレシピ登録拡張用の列。現時点のAPIでは常にNULL。
  url: text('url'),
  thumbnailUrl: text('thumbnail_url'),
  memo: text('memo'),
  isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`),
})

export const fixedCosts = sqliteTable('fixed_costs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  // NULL = 世帯共有、非NULL = 個人所有(登録者)。個人所有の場合はcreatedByUserIdと同値になる。
  ownerUserId: integer('owner_user_id').references(() => users.id),
  createdByUserId: integer('created_by_user_id')
    .notNull()
    .references(() => users.id),
  accountId: integer('account_id').references(() => accounts.id),
  cardId: integer('card_id').references(() => cards.id),
  name: text('name').notNull(),
  amount: integer('amount').notNull(),
  paymentDay: integer('payment_day').notNull(),
  includeInHouseholdTotal: integer('include_in_household_total', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`),
})
