// S-04 トップ画面（生活ダッシュボード＋カレンダー） / S-19 日次詳細モーダル
const Dashboard = (() => {
  const app = () => document.getElementById('app');
  let viewDate = new Date(2026, 6, 1); // 2026年7月
  let eventPeriod = 'year';

  function yyyyMm(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateStr(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
  function yen(n) { return `${n.toLocaleString()}円`; }

  function dayEvents(dStr) {
    return DB.listEvents().filter((ev) => {
      if (ev.date === dStr) return true;
      if (ev.recurrenceType === 'daily') return ev.date <= dStr;
      if (ev.recurrenceType === 'monthly') return ev.date.slice(8, 10) === dStr.slice(8, 10) && ev.date <= dStr;
      if (ev.recurrenceType === 'yearly') return ev.date.slice(5) === dStr.slice(5) && ev.date <= dStr;
      if (ev.recurrenceType === 'weekly') {
        const evDate = new Date(ev.date);
        const target = new Date(dStr);
        return evDate.getDay() === target.getDay() && ev.date <= dStr;
      }
      return false;
    });
  }

  function dayBalance(dStr) {
    // カレンダーの収支表示は本人の支出のみを対象とする（common-notes.md 2章）
    return DB.state.expenses
      .filter((e) => e.date === dStr && e.payerUserId === DB.state.currentUser.id)
      .reduce((s, e) => s - e.amount, 0);
  }

  function renderCalendar(y, m) {
    const first = new Date(y, m, 1);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    // セル内に表示する要素（イベント/日次収支）はユーザーの項目別設定に従う（S-21）
    // 献立は週単位のリストのためカレンダーセルには表示しない（F10参照）
    const calItems = DB.getDashboardSettings().dashboardItems.calendar;
    let cells = '';
    for (let i = 0; i < startWeekday; i++) cells += `<div class="cal-cell cal-empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = dateStr(y, m, d);
      const evs = calItems.events ? dayEvents(dStr) : [];
      const balance = dayBalance(dStr);
      cells += `
        <div class="cal-cell" data-date="${dStr}">
          <div class="cal-date">${d}</div>
          ${evs.map((ev) => `<div class="cal-event">${ev.recurrenceType !== 'none' ? '📌' : '🎉'} ${UI.escapeHtml(ev.name)}</div>`).join('')}
          ${calItems.balance ? `<div class="cal-balance ${balance < 0 ? 'is-negative' : ''}">${balance === 0 ? '+0円' : yen(balance)}</div>` : ''}
        </div>`;
    }
    return cells;
  }

  function render() {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const ymStr = yyyyMm(viewDate);
    const today = dateStr(2026, 6, 10);

    const personalTotal = DB.getMonthlyPersonalExpenseTotal(DB.state.currentUser.id, ymStr);
    const householdTotal = DB.getHouseholdTotal(ymStr);
    const unsettled = DB.getUnsettled();
    // ダッシュボードには全イベントではなく、ユーザーが表示対象に選んだ（showOnDashboard=true）イベントのみを表示する
    const eventTotals = DB.getEventTotals(eventPeriod, today).filter((e) => e.event.showOnDashboard);
    const shoppingCount = DB.listShoppingListItems().length;
    const lowStockCount = DB.listInventoryItems().filter((i) => i.quantity < i.threshold).length;
    const commonItems = DB.listInventoryItems().slice(0, 3).map((i) => i.name).join('・');
    const todayEvents = dayEvents(today);
    // 献立は週単位のリスト（曜日割り当てなし）のため、今日を含む週のリストを表示する
    const weekMenu = DB.listWeekMenu(DB.weekStartOf(today));
    const weekMenuLabel = weekMenu.map((m) => m.recipeId ? (DB.listRecipes().find((r) => r.id === m.recipeId) || {}).title : m.freeTextMemo).join('、');
    const todayBalance = dayBalance(today);
    // ユーザーごとの表示設定（S-21 設定画面）に応じて、カード（親）とカード内項目（子）を出し分ける
    const settings = DB.getDashboardSettings();
    const cards = settings.dashboardCards;
    const items = settings.dashboardItems;

    const todayCard = !cards.today ? '' : `
          <div class="card">
            <h2>今日の状況（${today.slice(5).replace('-', '/')}）</h2>
            ${items.today.balance ? `<p>収支: <strong class="${todayBalance < 0 ? 'is-negative' : ''}">${todayBalance === 0 ? '+0円' : yen(todayBalance)}</strong></p>` : ''}
            ${items.today.menu ? `<p>今週の献立: ${weekMenuLabel ? UI.escapeHtml(weekMenuLabel) : '未登録'}</p>` : ''}
            ${items.today.events ? `<p>イベント: ${todayEvents.length ? todayEvents.map((e) => UI.escapeHtml(e.name)).join('、') : 'なし'}</p>` : ''}
          </div>`;

    const moneyCard = !cards.money ? '' : `
          <div class="card">
            <h2>今月のお金</h2>
            ${items.money.personal ? `<p>個人支出: ${yen(personalTotal)}</p>` : ''}
            ${items.money.householdTotal ? `<p>世帯合計対象額: ${yen(householdTotal)}</p>` : ''}
            ${items.money.unsettled ? `
            <p>未精算 受取予定: ${unsettled.receivable.count}件・${yen(unsettled.receivable.amount)}</p>
            <p>未精算 支払予定: ${unsettled.payable.count}件・${yen(unsettled.payable.amount)}　<a href="#/kakeibo" id="link-settle-list">精算一覧を見る</a></p>` : ''}
            ${items.money.eventSummary ? `
            <p>
              イベント別支出
              <select id="event-period">
                <option value="year" ${eventPeriod === 'year' ? 'selected' : ''}>今年</option>
                <option value="month" ${eventPeriod === 'month' ? 'selected' : ''}>今月</option>
              </select>
            </p>
            <p>${eventTotals.length ? eventTotals.map((e) => `${UI.escapeHtml(e.event.name)}${yen(e.total)}`).join('、') : '表示対象なし'}</p>
            <p class="hint">表示するイベントは<a href="#/kakeibo" id="link-event-list">イベント一覧</a>の「ダッシュボード表示」で選べます</p>` : ''}
          </div>`;

    const financeCard = !cards.finance ? '' : `
          <div class="card">
            <h2>個人の財政</h2>
            <p>口座残高合計: <strong>${yen(DB.getMyTotalBalance())}</strong></p>
            <p><a href="#/kakeibo" id="link-account-list">口座・カード管理を見る</a></p>
            <p class="hint">本人のみ表示されます</p>
          </div>`;

    const stockCard = !cards.stock ? '' : `
          <div class="card">
            <h2>買い物・在庫</h2>
            ${items.stock.shoppingCount ? `<p>買い物リスト: ${shoppingCount}件</p>` : ''}
            ${items.stock.lowStock ? `<p>在庫不足: ${lowStockCount}件　<a href="#/zaiko">買い物リストを見る</a></p>` : ''}
            ${items.stock.commonItems ? `<p>よく使う品目: ${UI.escapeHtml(commonItems || 'なし')}</p>` : ''}
          </div>`;

    const sidebarHtml = todayCard + moneyCard + financeCard + stockCard;

    const calendarHtml = !cards.calendar ? '' : `
        <div class="dashboard-main">
          <div class="card calendar-card">
            <div class="cal-header">
              <button class="btn btn-small" id="cal-prev">◀</button>
              <span>${y}年 ${m + 1}月</span>
              <button class="btn btn-small" id="cal-next">▶</button>
            </div>
            <div class="cal-grid cal-grid-header">
              <div>日</div><div>月</div><div>火</div><div>水</div><div>木</div><div>金</div><div>土</div>
            </div>
            <div class="cal-grid">${renderCalendar(y, m)}</div>
          </div>
        </div>`;

    // サイドバー/カレンダーが非表示の場合はグリッドを1カラムに崩す
    const layoutClass = !sidebarHtml || !calendarHtml ? 'dashboard dashboard-single' : 'dashboard';

    app().innerHTML = `
      <div class="${layoutClass}">
        ${sidebarHtml ? `<div class="dashboard-sidebar">${sidebarHtml}</div>` : ''}
        ${calendarHtml}
        ${!sidebarHtml && !calendarHtml ? '<div class="card"><p>表示する項目がありません。<a href="#/settings">設定</a>から表示項目を選択してください。</p></div>' : ''}
      </div>
      ${dayModalHtml()}`;

    // 非表示カードの要素は存在しないため、各リスナーは存在チェックの上でバインドする
    const on = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
    };
    on('cal-prev', 'click', () => { viewDate = new Date(y, m - 1, 1); render(); });
    on('cal-next', 'click', () => { viewDate = new Date(y, m + 1, 1); render(); });
    on('event-period', 'change', (e) => { eventPeriod = e.target.value; render(); });
    document.querySelectorAll('.cal-cell[data-date]').forEach((cell) => {
      cell.addEventListener('click', () => openDayModal(cell.dataset.date));
    });
    on('day-modal-close', 'click', () => UI.closeModal('modal-day'));
    on('link-event-list', 'click', () => {
      setTimeout(() => Kakeibo.render('event'), 0);
    });
    on('link-settle-list', 'click', () => {
      setTimeout(() => Kakeibo.render('settle'), 0);
    });
    on('link-account-list', 'click', () => {
      setTimeout(() => Kakeibo.render('account'), 0);
    });
  }

  function dayModalHtml() {
    return `
      <div class="modal-overlay" id="modal-day">
        <div class="modal">
          <h2 id="day-modal-title"></h2>
          <div id="day-modal-body"></div>
          <div class="modal-actions">
            <button class="btn btn-secondary" id="day-modal-close">閉じる</button>
          </div>
        </div>
      </div>`;
  }

  function openDayModal(dStr) {
    document.getElementById('day-modal-title').textContent = dStr;
    // 個人の支出データは本人のみ閲覧可能（common-notes.md 2章）
    const expenses = DB.state.expenses.filter((e) => e.date === dStr && e.payerUserId === DB.state.currentUser.id);
    const evs = dayEvents(dStr);
    // 献立は週単位のリストのため、その日を含む週のリストを表示する
    const weekMenu = DB.listWeekMenu(DB.weekStartOf(dStr));
    const weekMenuLabel = weekMenu.map((m) => m.recipeId ? (DB.listRecipes().find((r) => r.id === m.recipeId) || {}).title : m.freeTextMemo).join('、');
    document.getElementById('day-modal-body').innerHTML = `
      <h3>支出一覧</h3>
      <ul>${expenses.length ? expenses.map((e) => `<li>${UI.escapeHtml(e.purpose)} ${e.amount.toLocaleString()}円</li>`).join('') : '<li>なし</li>'}</ul>
      <button class="btn btn-small" id="day-add-expense">支出を登録</button>
      <h3>イベント</h3>
      <ul>${evs.length ? evs.map((e) => `<li>${UI.escapeHtml(e.name)}　${Kakeibo.eventTimeLabel(e)}</li>`).join('') : '<li>なし</li>'}</ul>
      <button class="btn btn-small" id="day-add-event">イベントを追加</button>
      <h3>この週の献立</h3>
      <p>${weekMenuLabel ? UI.escapeHtml(weekMenuLabel) : '未登録'}</p>
      <button class="btn btn-small" id="day-edit-menu">この週の献立を編集</button>
    `;
    document.getElementById('day-add-expense').addEventListener('click', () => {
      UI.closeModal('modal-day');
      Router.navigate('#/kakeibo');
      setTimeout(() => Kakeibo.openExpenseModal(dStr), 0);
    });
    document.getElementById('day-add-event').addEventListener('click', () => {
      UI.closeModal('modal-day');
      Router.navigate('#/kakeibo');
      setTimeout(() => Kakeibo.openEventModal(dStr), 0);
    });
    document.getElementById('day-edit-menu').addEventListener('click', () => {
      UI.closeModal('modal-day');
      Router.navigate('#/kondate');
      setTimeout(() => Kondate.editDay(dStr), 0);
    });
    UI.openModal('modal-day');
  }

  return { render };
})();
