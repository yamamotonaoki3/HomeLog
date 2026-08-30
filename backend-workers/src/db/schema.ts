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
  inventoryItemId: integer('inventory_item_id')
    .notNull()
    .references(() => inventoryItems.id, { onDelete: 'cascade' }),
  isManual: integer('is_manual', { mode: 'boolean' }).notNull(),
  purchased: integer('purchased', { mode: 'boolean' }).notNull().default(false),
  purchasedQuantityTenths: integer('purchased_quantity_tenths').notNull().default(0),
  addedAt: text('added_at')
    .notNull()
    .default(sql`(current_timestamp)`),
})
