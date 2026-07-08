// HomeLog プロトタイプ用モックデータストア（メモリ上のみ、リロードで初期化）
const DB = (() => {
  let nextId = 1000;
  const id = () => nextId++;

  const state = {
    currentUser: null,
    users: [
      { id: 1, email: 'taro@example.com', password: 'Passw0rd', displayName: '太郎' },
      { id: 2, email: 'hanako@example.com', password: 'Passw0rd', displayName: '花子' },
    ],
    households: [
      { id: 1, name: '山田家', inviteCode: 'AB12CD34EF56GH78', memberIds: [1, 2] },
    ],

    zaikoCategories: [
      { id: 1, name: '野菜', isDefault: true },
      { id: 2, name: '肉', isDefault: true },
      { id: 3, name: '魚介', isDefault: true },
      { id: 4, name: '乳製品', isDefault: true },
      { id: 5, name: '卵', isDefault: true },
      { id: 6, name: '調味料', isDefault: true },
      { id: 7, name: '飲料', isDefault: true },
      { id: 8, name: '冷凍食品', isDefault: true },
      { id: 9, name: '乾物', isDefault: true },
      { id: 10, name: 'その他', isDefault: true },
    ],
    stores: [
      { id: 1, householdId: 1, name: 'スーパーA' },
      { id: 2, householdId: 1, name: 'ドラッグストアB' },
    ],
    inventoryItems: [
      { id: 1, householdId: 1, name: '牛乳', categoryId: 4, storeId: 1, quantity: 1.0, threshold: 0.5 },
      { id: 2, householdId: 1, name: '卵', categoryId: 5, storeId: 1, quantity: 0.0, threshold: 1.0 },
      { id: 3, householdId: 1, name: '醤油', categoryId: 6, storeId: 2, quantity: 0.3, threshold: 0.5 },
      { id: 4, householdId: 1, name: 'にんじん', categoryId: 1, storeId: 1, quantity: 2.0, threshold: 1.0 },
    ],
    shoppingListItems: [
      // { id, inventoryItemId, isManual, purchased, purchasedQuantity }
    ],

    kakeiboCategories: [
      { id: 1, name: '食費', isDefault: true },
      { id: 2, name: '日用品', isDefault: true },
      { id: 3, name: '交際費', isDefault: true },
      { id: 4, name: '光熱費', isDefault: true },
      { id: 5, name: '住居費', isDefault: true },
      { id: 6, name: '通信費', isDefault: true },
      { id: 7, name: '医療費', isDefault: true },
      { id: 8, name: '趣味・娯楽', isDefault: true },
      { id: 9, name: 'その他', isDefault: true },
    ],
    accounts: [
      { id: 1, householdId: 1, ownerUserId: 1, name: '○○銀行', type: 'bank', balance: 123000 },
      { id: 2, householdId: 1, ownerUserId: 1, name: 'PayPay', type: 'e_money', balance: 3200 },
    ],
    cards: [
      { id: 1, accountId: 1, name: '○○カード' },
    ],
    expenses: [
      { id: 1, householdId: 1, date: '2026-07-01', purpose: 'スーパー', categoryId: 1, amount: 1200, payerUserId: 1, accountId: 1, eventId: null, includeInHouseholdTotal: false, memo: '' },
      { id: 2, householdId: 1, date: '2026-07-03', purpose: '電気代', categoryId: 4, amount: 8000, payerUserId: 2, accountId: null, eventId: null, includeInHouseholdTotal: true, memo: '' },
    ],
    expenseSplits: [
      // { id, expenseId, debtorUserId, splitRatio, amountDue, status }
    ],
    fixedCosts: [
      // ownerUserId: null＝世帯共有、設定時＝個人所有（本人のみ閲覧可能）
      { id: 1, householdId: 1, ownerUserId: null, name: '家賃', amount: 80000, paymentDay: 27, includeInHouseholdTotal: true },
      { id: 2, householdId: 1, ownerUserId: 1, name: '個人サブスク', amount: 1200, paymentDay: 5, includeInHouseholdTotal: false },
    ],
    events: [
      // ownerUserId: null＝世帯共有、設定時＝個人所有（本人のみ閲覧可能）
      // showOnDashboard: トップ画面のイベント別支出サマリーに表示するかどうか（確認したいイベントだけを選べる）
      // isAllDay: 終日イベントかどうか。falseの場合はstartTime必須・endTime任意（F06参照）
      { id: 1, householdId: 1, ownerUserId: null, name: '父の日', date: '2026-06-21', isAllDay: true, startTime: null, endTime: null, recurrenceType: 'none', notifyEnabled: false, defaultAmount: 3000, showOnDashboard: true },
      { id: 2, householdId: 1, ownerUserId: 1, name: '学習', date: '2026-07-03', isAllDay: false, startTime: '20:00', endTime: '21:00', recurrenceType: 'daily', notifyEnabled: true, defaultAmount: null, showOnDashboard: false },
    ],

    recipes: [
      { id: 1, householdId: 1, title: 'カレー', sourceType: 'manual', ingredients: 'カレールー、豚肉、じゃがいも、にんじん、たまねぎ', steps: '1. 材料を切る\n2. 炒める\n3. 煮込む', isFavorite: true },
      { id: 2, householdId: 1, title: '肉じゃが', sourceType: 'manual', ingredients: '牛肉、じゃがいも、たまねぎ', steps: '1. 材料を切る\n2. 煮込む', isFavorite: false },
    ],
    menuEntries: [
      // { id, householdId, weekStartDate, recipeId, freeTextMemo }
      // … 週単位の「作りたい料理リスト」。weekStartDateはその週の月曜日。曜日への割り当ては持たない（F10参照）
      { id: 1, householdId: 1, weekStartDate: '2026-07-06', recipeId: 1, freeTextMemo: null },
      { id: 2, householdId: 1, weekStartDate: '2026-07-06', recipeId: null, freeTextMemo: '魚料理' },
    ],

    userSettings: [
      // { userId, dashboardCards: { today, money, ... }, dashboardItems: { today: { balance, menu, events }, ... } }
      // … ダッシュボードに表示するカード（親）・カード内項目（子）のユーザー別設定
    ],
  };

  function recalcShoppingList() {
    state.inventoryItems.forEach((item) => {
      const existing = state.shoppingListItems.find((s) => s.inventoryItemId === item.id && !s.isManual);
      if (item.quantity < item.threshold) {
        if (!existing) {
          state.shoppingListItems.push({ id: id(), inventoryItemId: item.id, isManual: false, purchased: false, purchasedQuantity: 0 });
        }
      } else if (existing) {
        state.shoppingListItems = state.shoppingListItems.filter((s) => s.id !== existing.id);
      }
    });
  }
  recalcShoppingList();

  return {
    state,
    nextId: id,
    recalcShoppingList,

    findUserByEmail(email) {
      return state.users.find((u) => u.email === email);
    },
    registerUser(email, password, displayName) {
      const user = { id: id(), email, password, displayName };
      state.users.push(user);
      return user;
    },
    getHouseholdByUser(userId) {
      return state.households.find((h) => h.memberIds.includes(Number(userId)));
    },
    getCurrentHousehold() {
      return state.currentUser ? this.getHouseholdByUser(state.currentUser.id) : null;
    },
    findHouseholdByInviteCode(code) {
      return state.households.find((h) => h.inviteCode === code);
    },
    createHousehold(name, ownerUserId) {
      const household = { id: id(), name, inviteCode: 'CODE' + id(), memberIds: [ownerUserId] };
      state.households.push(household);
      return household;
    },
    joinHousehold(household, userId) {
      household.memberIds.push(Number(userId));
    },

    getCategory(catId) { return state.zaikoCategories.find((c) => c.id === Number(catId)); },
    getStore(storeId) { return state.stores.find((s) => s.id === Number(storeId)); },
    getKakeiboCategory(catId) { return state.kakeiboCategories.find((c) => c.id === Number(catId)); },
    getMemberName(userId) {
      const u = state.users.find((u) => u.id === Number(userId));
      return u ? u.displayName : '不明';
    },

    getCurrentHouseholdId() {
      const h = this.getCurrentHousehold();
      return h ? h.id : null;
    },
    listInventoryItems() {
      const hid = this.getCurrentHouseholdId();
      return state.inventoryItems.filter((i) => i.householdId === hid);
    },
    listStores() {
      // 店舗マスタは世帯単位で共有する（common-notes.md 3章）
      const hid = this.getCurrentHouseholdId();
      return state.stores.filter((s) => s.householdId === hid);
    },
    addStore(name) {
      const newStore = { id: id(), householdId: this.getCurrentHouseholdId(), name };
      state.stores.push(newStore);
      return newStore;
    },
    listShoppingListItems() {
      const hid = this.getCurrentHouseholdId();
      const myItemIds = new Set(this.listInventoryItems().map((i) => i.id));
      return state.shoppingListItems.filter((s) => myItemIds.has(s.inventoryItemId));
    },
    listRecipes() {
      const hid = this.getCurrentHouseholdId();
      return state.recipes.filter((r) => r.householdId === hid);
    },
    listFixedCosts() {
      const hid = this.getCurrentHouseholdId();
      const userId = state.currentUser.id;
      // 世帯共有（ownerUserId: null）は全員に、個人所有は本人にのみ表示する（common-notes.md 2章）
      return state.fixedCosts.filter((f) => f.householdId === hid && (f.ownerUserId == null || f.ownerUserId === userId));
    },
    listEvents() {
      const hid = this.getCurrentHouseholdId();
      const userId = state.currentUser.id;
      // 世帯共有（ownerUserId: null）は全員に、個人所有は本人にのみ表示する（common-notes.md 2章）
      return state.events.filter((ev) => ev.householdId === hid && (ev.ownerUserId == null || ev.ownerUserId === userId));
    },
    getDashboardSettings() {
      const userId = state.currentUser.id;
      let s = state.userSettings.find((u) => u.userId === userId);
      if (!s) {
        // 未設定の場合は全カード・全項目表示をデフォルトとする
        s = {
          userId,
          dashboardCards: { today: true, money: true, finance: true, stock: true, calendar: true },
          // カード内の項目単位の表示設定（親カードがONのときのみ有効）
          dashboardItems: {
            today: { balance: true, menu: true, events: true },
            money: { personal: true, householdTotal: true, unsettled: true, eventSummary: true },
            stock: { shoppingCount: true, lowStock: true, commonItems: true },
            calendar: { events: true, balance: true },
          },
        };
        state.userSettings.push(s);
      }
      return s;
    },
    updateDashboardSettings(cards, items) {
      const s = this.getDashboardSettings();
      Object.assign(s.dashboardCards, cards);
      if (items) {
        Object.keys(items).forEach((cardKey) => {
          Object.assign(s.dashboardItems[cardKey], items[cardKey]);
        });
      }
    },
    listMyAccounts() {
      // 口座・残高は所有者本人のみ閲覧可能（common-notes.md 2章）
      return state.accounts.filter((a) => a.ownerUserId === state.currentUser.id);
    },
    getMyTotalBalance() {
      return this.listMyAccounts().reduce((s, a) => s + a.balance, 0);
    },
    getEvent(eventId) {
      return state.events.find((ev) => ev.id === Number(eventId));
    },

    addInventoryItem(item) {
      const newItem = { id: id(), householdId: this.getCurrentHouseholdId(), ...item };
      state.inventoryItems.push(newItem);
      recalcShoppingList();
      return newItem;
    },
    adjustInventoryQuantity(itemId, delta) {
      const item = state.inventoryItems.find((i) => i.id === Number(itemId));
      if (!item) return;
      item.quantity = Math.max(0, Math.round((item.quantity + delta) * 10) / 10);
      recalcShoppingList();
    },
    addShoppingListItemManual(inventoryItemId) {
      state.shoppingListItems.push({ id: id(), inventoryItemId: Number(inventoryItemId), isManual: true, purchased: false, purchasedQuantity: 0 });
    },
    removeShoppingListItem(itemId) {
      state.shoppingListItems = state.shoppingListItems.filter((s) => s.id !== Number(itemId));
    },
    updateShoppingListPurchases(updates) {
      // updates: [{id, purchasedQuantity}]
      const purchasedManualIds = [];
      updates.forEach(({ id: sid, purchasedQuantity }) => {
        const listItem = state.shoppingListItems.find((s) => s.id === Number(sid));
        if (!listItem || !purchasedQuantity) return;
        const invItem = state.inventoryItems.find((i) => i.id === listItem.inventoryItemId);
        if (invItem) invItem.quantity = Math.round((invItem.quantity + Number(purchasedQuantity)) * 10) / 10;
        if (listItem.isManual) purchasedManualIds.push(listItem.id);
      });
      // 手動追加分は購入処理により除外する（自動追加分はrecalcShoppingListの閾値判定に委ねる）
      state.shoppingListItems = state.shoppingListItems.filter((s) => !purchasedManualIds.includes(s.id));
      recalcShoppingList();
    },

    addExpense(expense, splitTargets) {
      const newExpense = { id: id(), householdId: this.getCurrentHouseholdId(), ...expense };
      state.expenses.push(newExpense);
      // 口座/カードが指定されている場合、当該口座の残高から支出金額を自動減算する（F11_kakeibo_account参照）
      if (newExpense.accountId) {
        const account = state.accounts.find((a) => a.id === Number(newExpense.accountId));
        if (account) account.balance = Math.round((account.balance - newExpense.amount) * 100) / 100;
      }
      // splitTargets は呼び出し側（S-06 支出登録モーダル）で検証・計算済みの
      // { userId, name, splitInputType, splitRatio, amountDue } の配列（F04 7章：％入力/金額入力）。
      // 支払った人自身は「負担者（債務者）」にはなり得ないためレコードを作成しない（自己負債の防止）。
      (splitTargets || [])
        .filter((t) => t.userId !== newExpense.payerUserId)
        .forEach((t) => {
          state.expenseSplits.push({
            id: id(), expenseId: newExpense.id, debtorUserId: t.userId, debtorName: t.name,
            splitInputType: t.splitInputType, splitRatio: t.splitRatio, amountDue: t.amountDue, status: 'unpaid',
          });
        });
      return newExpense;
    },
    updateSplitStatus(splitId, status) {
      const split = state.expenseSplits.find((s) => s.id === Number(splitId));
      if (split) split.status = status;
    },

    addFixedCost(fc) { state.fixedCosts.push({ id: id(), householdId: this.getCurrentHouseholdId(), ...fc }); },
    addEvent(ev) {
      const newEvent = { id: id(), householdId: this.getCurrentHouseholdId(), ...ev };
      state.events.push(newEvent);
      return newEvent;
    },
    toggleEventDashboard(eventId) {
      const ev = state.events.find((e) => e.id === Number(eventId));
      if (ev) ev.showOnDashboard = !ev.showOnDashboard;
    },
    addAccount(acc) { state.accounts.push({ id: id(), householdId: this.getCurrentHouseholdId(), ...acc }); },
    addCard(card) { state.cards.push({ id: id(), ...card }); },

    addRecipe(recipe) { const r = { id: id(), householdId: this.getCurrentHouseholdId(), isFavorite: false, ...recipe }; state.recipes.push(r); return r; },
    toggleFavorite(recipeId) {
      const r = state.recipes.find((r) => r.id === Number(recipeId));
      if (r) r.isFavorite = !r.isFavorite;
    },
    // 日付文字列からその週の月曜日（週の開始日）を返す
    weekStartOf(dateStr) {
      const d = new Date(dateStr);
      const day = d.getDay(); // 0=日, 1=月, ...
      d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    },
    listWeekMenu(weekStartDate) {
      const hid = this.getCurrentHouseholdId();
      return state.menuEntries.filter((m) => m.weekStartDate === weekStartDate && m.householdId === hid);
    },
    addWeekMenuItem(weekStartDate, { recipeId, freeTextMemo }) {
      state.menuEntries.push({
        id: id(),
        householdId: this.getCurrentHouseholdId(),
        weekStartDate,
        recipeId: recipeId || null,
        freeTextMemo: recipeId ? null : (freeTextMemo || null),
      });
    },
    removeWeekMenuItem(itemId) {
      state.menuEntries = state.menuEntries.filter((m) => m.id !== Number(itemId));
    },

    // ダッシュボード集計（すべて所属世帯の範囲にスコープする）
    getMonthlyPersonalExpenseTotal(userId, yyyyMm) {
      const hid = this.getCurrentHouseholdId();
      return state.expenses
        .filter((e) => e.householdId === hid && e.payerUserId === userId && e.date.startsWith(yyyyMm))
        .reduce((sum, e) => sum + e.amount, 0);
    },
    getHouseholdTotal(yyyyMm) {
      const hid = this.getCurrentHouseholdId();
      const expTotal = state.expenses.filter((e) => e.householdId === hid && e.includeInHouseholdTotal && e.date.startsWith(yyyyMm)).reduce((s, e) => s + e.amount, 0);
      const fcTotal = state.fixedCosts.filter((f) => f.householdId === hid && f.includeInHouseholdTotal).reduce((s, f) => s + f.amount, 0);
      return expTotal + fcTotal;
    },
    getUnsettled() {
      const hid = this.getCurrentHouseholdId();
      const userId = state.currentUser.id;
      // 未精算サマリーは、自分が精算の当事者である分のみを対象とし、
      // 「受取予定（自分が立て替えた分）」と「支払予定（自分が負担する分）」を分けて集計する（common-notes.md 2章）
      const result = {
        receivable: { count: 0, amount: 0 },
        payable: { count: 0, amount: 0 },
      };
      state.expenseSplits.forEach((s) => {
        const exp = state.expenses.find((e) => e.id === s.expenseId);
        if (!exp || exp.householdId !== hid || s.status === 'settled') return;
        if (exp.payerUserId === userId) {
          result.receivable.count++;
          result.receivable.amount += s.amountDue;
        } else if (s.debtorUserId === userId) {
          result.payable.count++;
          result.payable.amount += s.amountDue;
        }
      });
      return result;
    },
    getEventTotals(period, baseDate) {
      const hid = this.getCurrentHouseholdId();
      const userId = state.currentUser.id;
      const y = baseDate.slice(0, 4);
      const ym = baseDate.slice(0, 7);
      return this.listEvents().map((ev) => {
        // イベント別支出は個人の支出データのため、本人の支出のみを集計対象とする（common-notes.md 2章）
        const total = state.expenses
          .filter((e) => e.householdId === hid && e.eventId === ev.id && e.payerUserId === userId && (period === 'year' ? e.date.startsWith(y) : e.date.startsWith(ym)))
          .reduce((s, e) => s + e.amount, 0);
        return { event: ev, total };
      });
    },
  };
})();
