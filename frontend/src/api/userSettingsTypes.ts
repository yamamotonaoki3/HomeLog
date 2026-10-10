export const ORDERABLE_CARDS = ['today', 'stock', 'finance', 'money', 'eventExpenses'] as const
export type OrderableCard = (typeof ORDERABLE_CARDS)[number]
export type DashboardCard = OrderableCard | 'calendar'

export type DisplaySettings = {
  cards: Record<DashboardCard, boolean>
  cardOrder: OrderableCard[]
  items: {
    today: Record<'balance' | 'menu' | 'events', boolean>
    stock: Record<'shoppingList' | 'inventoryList', boolean>
    money: Record<'personal' | 'householdTotal' | 'unsettled', boolean>
    calendar: Record<'income' | 'expense' | 'events', boolean>
  }
}

export type ItemCard = keyof DisplaySettings['items']

export const CARD_LABELS: Record<DashboardCard, string> = {
  today: '今日の状況',
  stock: '買い物・在庫',
  finance: '個人の財政',
  money: '今月のお金',
  eventExpenses: 'イベント別支出',
  calendar: 'カレンダー',
}

export const CARD_DESCRIPTIONS: Record<OrderableCard, string> = {
  today: '収支・今週の献立・イベント',
  stock: '買い物リスト・在庫リスト',
  finance: '口座残高合計',
  money: '個人支出・世帯合計対象額・未精算',
  eventExpenses: '今日・今月・今年のイベント別支出',
}

export const ITEM_LABELS: { [C in ItemCard]: Record<keyof DisplaySettings['items'][C], string> } = {
  today: { balance: '収支', menu: '今週の献立', events: 'イベント' },
  stock: { shoppingList: '買い物リスト', inventoryList: '在庫リスト' },
  money: { personal: '個人支出', householdTotal: '世帯合計対象額', unsettled: '未精算（受取・支払）' },
  calendar: { income: '収入', expense: '支出', events: 'イベント' },
}

export const CHECKLIST_ORDER: DashboardCard[] = ['today', 'stock', 'finance', 'money', 'eventExpenses', 'calendar']
