import { hashPassword } from './crypto'
import { DEMO_LIFETIME_HOURS } from './demo'
import { currentWeekStart } from './date'
import { DEFAULT_CATEGORY_NAMES as INCOME_CATEGORY_NAMES } from '../routes/income-categories'
import { normalizeName } from '../routes/inventory-items'
import { DEFAULT_CATEGORY_NAMES as KAKEIBO_CATEGORY_NAMES } from '../routes/kakeibo-categories'
import { DEFAULT_CATEGORY_NAMES as ZAIKO_CATEGORY_NAMES } from '../routes/zaiko-categories'

// デモ世帯(デモ太郎・デモ花子・見本データ)を1回のD1 batchで作る(#532)。
// 途中で失敗したら何も残さない(batchは1つのトランザクション)。
// 親のIDは last_insert_rowid() の連鎖ではなく、その回だけの一意な値(乱数の招待コード・乱数入りのメール)を
// 使った副問い合わせで参照する。

export interface DemoHousehold {
  householdId: number
  primaryUserId: number
  partnerUserId: number
  expiresAt: string
}

export interface CreateDemoOptions {
  /** メール・招待コードに入れる乱数部分。テストで衝突を作るときだけ指定する。 */
  token?: string
}

const TARO = 'デモ太郎'
const HANAKO = 'デモ花子'
const INVITE_CODE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

interface Frag {
  text: string
  params: unknown[]
}

function isFrag(value: unknown): value is Frag {
  return typeof value === 'object' && value !== null && 'text' in value && 'params' in value
}

// 値は ? にして params へ、Frag(副問い合わせ)はそのまま埋め込むタグ付きテンプレート。
function f(strings: TemplateStringsArray, ...values: unknown[]): Frag {
  let text = strings[0]
  const params: unknown[] = []
  values.forEach((value, index) => {
    if (isFrag(value)) {
      text += value.text
      params.push(...value.params)
    } else {
      text += '?'
      params.push(value)
    }
    text += strings[index + 1]
  })
  return { text, params }
}

// 同じテーブル・列構成のINSERTを複数行VALUESにまとめる。
// Mapの挿入順で親→子を維持する。在庫は全行を入れてから買い物リストが参照する。
// 副問い合わせ内のbindも含め、1文あたり99個までにする。
function combineInserts(statements: Frag[]): Frag[] {
  const groups = new Map<string, Frag[]>()
  for (const statement of statements) {
    const match = /^(INSERT INTO \w+ \([^)]+\))\s+VALUES\s+([\s\S]+)$/.exec(statement.text)
    if (!match) throw new Error('Unexpected demo INSERT format')
    const [, insert, values] = match
    const rows = groups.get(insert) ?? []
    rows.push({ text: values, params: statement.params })
    groups.set(insert, rows)
  }
  const combined: Frag[] = []
  for (const [insert, rows] of groups) {
    let current: Frag | undefined
    for (const row of rows) {
      if (row.params.length >= 100) throw new Error('Too many demo INSERT parameters')
      if (!current || current.params.length + row.params.length >= 100) {
        current = { text: `${insert} VALUES ${row.text}`, params: [...row.params] }
        combined.push(current)
      } else {
        current.text += `, ${row.text}`
        current.params.push(...row.params)
      }
    }
  }
  return combined
}

function randomToken(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20)
}

function randomInviteCode(): string {
  const values = crypto.getRandomValues(new Uint32Array(16))
  return Array.from(values, (v) => INVITE_CODE_CHARACTERS[v % INVITE_CODE_CHARACTERS.length]).join('')
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

export async function createDemoHousehold(db: D1Database, now: Date, options: CreateDemoOptions = {}): Promise<DemoHousehold> {
  const token = options.token ?? randomToken()
  const code = randomInviteCode()
  const taroEmail = `demo-${token}-taro@example.com`
  const hanakoEmail = `demo-${token}-hanako@example.com`
  const expiresAt = new Date(now.getTime() + DEMO_LIFETIME_HOURS * 3_600_000).toISOString()

  // 誰も知らない乱数のハッシュ。メールとパスワードではログインできない(2人で同じ値を使い、計算は1回にする)。
  const passwordHash = await hashPassword(crypto.randomUUID() + crypto.randomUUID())

  // 日付はJSTの今月。日が今日より後になる記録(収入・支出)は今日にする。予定・固定費は今月のその日のまま。
  const jstToday = new Date(now.getTime() + 9 * 3_600_000)
  const year = jstToday.getUTCFullYear()
  const month = jstToday.getUTCMonth() + 1
  const todayDay = jstToday.getUTCDate()
  const monthDate = (day: number): string => `${year}-${pad2(month)}-${pad2(day)}`
  const recordDate = (day: number): string => monthDate(Math.min(day, todayDay))
  const today = monthDate(todayDay)

  const household = f`(SELECT id FROM households WHERE invite_code = ${code})`
  const user = (email: string) => f`(SELECT id FROM users WHERE email = ${email})`
  const account = (name: string) => f`(SELECT id FROM accounts WHERE household_id = ${household} AND name = ${name})`
  const kakeibo = (name: string) => f`(SELECT id FROM kakeibo_categories WHERE household_id = ${household} AND name = ${name})`
  const incomeCategory = (name: string) => f`(SELECT id FROM income_categories WHERE household_id = ${household} AND name = ${name})`
  const zaiko = (name: string) => f`(SELECT id FROM zaiko_categories WHERE household_id = ${household} AND name = ${name})`
  const item = (name: string) => f`(SELECT id FROM inventory_items WHERE household_id = ${household} AND name = ${name})`
  const recipe = (title: string) => f`(SELECT id FROM recipes WHERE household_id = ${household} AND title = ${title})`

  const statements: Frag[] = [
    f`INSERT INTO households (name, invite_code) VALUES (${'デモ家'}, ${code})`,
    f`INSERT INTO users (email, password_hash, display_name) VALUES (${taroEmail}, ${passwordHash}, ${TARO})`,
    f`INSERT INTO users (email, password_hash, display_name) VALUES (${hanakoEmail}, ${passwordHash}, ${HANAKO})`,
    f`INSERT INTO household_members (household_id, user_id) VALUES (${household}, ${user(taroEmail)})`,
    f`INSERT INTO household_members (household_id, user_id) VALUES (${household}, ${user(hanakoEmail)})`,
  ]

  // 既定カテゴリー(各ルートの既定と同じ。在庫カテゴリーには「日用品」を1つ足す)。
  for (const name of KAKEIBO_CATEGORY_NAMES) {
    statements.push(f`INSERT INTO kakeibo_categories (household_id, name, is_default) VALUES (${household}, ${name}, 1)`)
  }
  for (const name of INCOME_CATEGORY_NAMES) {
    statements.push(f`INSERT INTO income_categories (household_id, name, is_default) VALUES (${household}, ${name}, 1)`)
  }
  for (const name of ZAIKO_CATEGORY_NAMES) {
    statements.push(f`INSERT INTO zaiko_categories (household_id, name, is_default) VALUES (${household}, ${name}, 1)`)
  }
  statements.push(f`INSERT INTO zaiko_categories (household_id, name, is_default) VALUES (${household}, ${'日用品'}, 0)`)

  // 口座・カード。残高は「初期残高に本人の収入・支出(立替の全額を含む)を反映した値」。
  // 太郎 みどり銀行: 250,000 + 給与 280,000 - 書籍 1,800 - ランチ 1,200 - 映画 2,000 - スーパー(立替) 6,000
  // 花子 さくら銀行: 180,000 + 給与 240,000 - 美容院 5,500 - 服 4,900 - 日用品(立替) 2,400
  // 花子 交通系IC:     3,000 - カフェ 800
  const addAccount = (owner: string, name: string, type: string, balance: number) =>
    statements.push(f`INSERT INTO accounts (household_id, owner_user_id, name, type, balance) VALUES (${household}, ${user(owner)}, ${name}, ${type}, ${balance})`)
  addAccount(taroEmail, 'みどり銀行', 'bank', 519_000)
  addAccount(hanakoEmail, 'さくら銀行', 'bank', 407_200)
  addAccount(hanakoEmail, '交通系IC', 'e_money', 2_200)
  statements.push(f`INSERT INTO cards (account_id, name, card_type, balance) VALUES (${account('みどり銀行')}, ${'いつものクレジット'}, ${'credit'}, 0)`)

  const addIncome = (owner: string, accountName: string, amount: number, content: string, day: number) =>
    statements.push(
      f`INSERT INTO incomes (household_id, earner_user_id, category_id, account_id, amount, content, income_date)
        VALUES (${household}, ${user(owner)}, ${incomeCategory('給与')}, ${account(accountName)}, ${amount}, ${content}, ${recordDate(day)})`,
    )
  addIncome(taroEmail, 'みどり銀行', 280_000, '給与', 1)
  addIncome(hanakoEmail, 'さくら銀行', 240_000, '給与', 1)

  const addExpense = (payer: string, accountName: string, category: string, amount: number, purpose: string, day: number) =>
    statements.push(
      f`INSERT INTO expenses (household_id, payer_user_id, category_id, account_id, amount, purpose, expense_date)
        VALUES (${household}, ${user(payer)}, ${kakeibo(category)}, ${account(accountName)}, ${amount}, ${purpose}, ${recordDate(day)})`,
    )
  addExpense(taroEmail, 'みどり銀行', '趣味・娯楽', 1_800, '書籍', 3)
  addExpense(taroEmail, 'みどり銀行', '食費', 1_200, 'ランチ', 5)
  addExpense(taroEmail, 'みどり銀行', '趣味・娯楽', 2_000, '映画', 7)
  addExpense(hanakoEmail, 'さくら銀行', 'その他', 5_500, '美容院', 4)
  addExpense(hanakoEmail, '交通系IC', '食費', 800, 'カフェ', 6)
  addExpense(hanakoEmail, 'さくら銀行', 'その他', 4_900, '服', 8)

  // 割り勘(立替者以外の1人分だけ内訳を持つ)。どちらも未精算。
  addExpense(taroEmail, 'みどり銀行', '食費', 6_000, 'スーパー', 2)
  addExpense(hanakoEmail, 'さくら銀行', '日用品', 2_400, '日用品', 4)
  const addSplit = (payer: string, purpose: string, debtor: string, amountDue: number) =>
    statements.push(
      f`INSERT INTO expense_splits (expense_id, debtor_user_id, split_input_type, split_ratio, amount_due, status)
        VALUES ((SELECT id FROM expenses WHERE household_id = ${household} AND payer_user_id = ${user(payer)} AND purpose = ${purpose}),
          ${user(debtor)}, ${'ratio'}, ${50}, ${amountDue}, ${'unpaid'})`,
    )
  addSplit(taroEmail, 'スーパー', hanakoEmail, 3_000)
  addSplit(hanakoEmail, '日用品', taroEmail, 1_200)

  // 固定費。個人(owner_user_id あり)は本人だけ、「家賃」(NULL)は世帯で共有して2人で折半。
  // 取りこぼし回収の対象にならないよう、有効開始日は今日にする(固定費の登録APIと同じ)。
  const addFixedCost = (owner: string | null, creator: string, accountName: string, name: string, amount: number, day: number, inTotal: number) =>
    statements.push(
      f`INSERT INTO fixed_costs (household_id, owner_user_id, created_by_user_id, account_id, name, amount, payment_day, include_in_household_total, effective_from)
        VALUES (${household}, ${owner === null ? null : user(owner)}, ${user(creator)}, ${account(accountName)}, ${name}, ${amount}, ${day}, ${inTotal}, ${today})`,
    )
  addFixedCost(taroEmail, taroEmail, 'みどり銀行', 'スマホ代', 3_000, 25, 0)
  addFixedCost(hanakoEmail, hanakoEmail, 'さくら銀行', 'ジム会費', 7_000, 10, 0)
  addFixedCost(null, taroEmail, 'みどり銀行', '家賃', 120_000, 27, 1)
  statements.push(
    f`INSERT INTO fixed_cost_splits (fixed_cost_id, debtor_user_id, split_input_type, split_ratio, amount_due)
      VALUES ((SELECT id FROM fixed_costs WHERE household_id = ${household} AND name = ${'家賃'}), ${user(hanakoEmail)}, ${'ratio'}, ${50}, ${60_000})`,
  )

  // 予定。個人は本人だけ、「誕生日会」(NULL)は世帯で共有。
  const addEvent = (owner: string | null, creator: string, name: string, day: number, recurrence: string) =>
    statements.push(
      f`INSERT INTO events (household_id, owner_user_id, created_by_user_id, name, event_date, recurrence_type)
        VALUES (${household}, ${owner === null ? null : user(owner)}, ${user(creator)}, ${name}, ${monthDate(day)}, ${recurrence})`,
    )
  addEvent(taroEmail, taroEmail, '歯医者', 18, 'none')
  addEvent(hanakoEmail, hanakoEmail, '友人とランチ会', 22, 'none')
  addEvent(null, taroEmail, '誕生日会', 20, 'yearly')

  // 在庫(数量・しきい値・単価)。しきい値以下のものは、在庫の登録APIと同じく買い物リスト(自動追加)にも入れる。
  const stock: Array<[string, string, number, number, number]> = [
    ['卵', '卵', 2, 3, 250],
    ['牛乳', '乳製品', 1, 2, 220],
    ['お米', '乾物', 5, 1, 2_500],
    ['トイレットペーパー', '日用品', 0, 1, 450],
  ]
  for (const [name, category, quantity, threshold, price] of stock) {
    statements.push(
      f`INSERT INTO inventory_items (household_id, name, normalized_name, category_id, price, quantity_tenths, threshold_tenths, last_consumed_on)
        VALUES (${household}, ${name}, ${normalizeName(name)}, ${zaiko(category)}, ${price}, ${quantity * 10}, ${threshold * 10}, ${today})`,
    )
    if (quantity <= threshold) {
      statements.push(
        f`INSERT INTO shopping_list_items (household_id, inventory_item_id, is_manual, purchased, purchased_quantity_tenths)
          VALUES (${household}, ${item(name)}, 0, 0, 0)`,
      )
    }
  }

  // レシピ(手入力)と今週の献立。
  const recipes: Array<[string, string, string, number]> = [
    ['肉じゃが', '牛肉 200g\nじゃがいも 3個\n玉ねぎ 1個\nしょうゆ・砂糖・みりん 各大さじ2', '1. 具材を切る\n2. 炒めて調味料と水を加える\n3. 落とし蓋をして煮込む', 0],
    ['カレーライス', '豚肉 200g\nじゃがいも 2個\n玉ねぎ 2個\nにんじん 1本\nカレールー 1/2箱', '1. 具材を炒める\n2. 水を加えて煮込む\n3. ルーを溶かして仕上げる', 1],
    ['鮭のホイル焼き', '生鮭 2切れ\nしめじ 1パック\nバター 10g\nしょうゆ 小さじ2', '1. ホイルに鮭ときのこをのせる\n2. バターとしょうゆを加えて包む\n3. トースターで15分焼く', 0],
  ]
  for (const [title, ingredients, steps, favorite] of recipes) {
    statements.push(
      f`INSERT INTO recipes (household_id, created_by_user_id, title, ingredients, steps, source_type, is_favorite)
        VALUES (${household}, ${user(taroEmail)}, ${title}, ${ingredients}, ${steps}, ${'manual'}, ${favorite})`,
    )
  }
  const weekStart = currentWeekStart(jstToday)
  statements.push(
    f`INSERT INTO menu_entries (household_id, recipe_id, week_start_date) VALUES (${household}, ${recipe('肉じゃが')}, ${weekStart})`,
    f`INSERT INTO menu_entries (household_id, free_text_memo, week_start_date) VALUES (${household}, ${'外食'}, ${weekStart})`,
  )

  statements.push(
    f`INSERT INTO demo_households (household_id, primary_user_id, partner_user_id, expires_at)
      VALUES (${household}, ${user(taroEmail)}, ${user(hanakoEmail)}, ${expiresAt})`,
  )

  // POST /api/demo/start のD1文数（batch内の各文も1件として数える）:
  // 回数制限UPSERT 最大1 + 有効デモ件数SELECT 1 + 作成batch 20
  // + 作成ID取得SELECT 1 + トークン保存INSERT 1 = 最大24文（40以下）。
  // 作成batchは19テーブル分。ただしmenu_entriesは列構成が2種類なので2文。
  await db.batch(combineInserts(statements).map((statement) => db.prepare(statement.text).bind(...statement.params)))

  const created = await db
    .prepare('SELECT household_id AS householdId, primary_user_id AS primaryUserId, partner_user_id AS partnerUserId FROM demo_households WHERE household_id = (SELECT id FROM households WHERE invite_code = ?)')
    .bind(code)
    .first<{ householdId: number; primaryUserId: number; partnerUserId: number }>()
  return { ...created!, expiresAt }
}
