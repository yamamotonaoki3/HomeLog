// S-05 家計簿一覧 / S-06 支出登録モーダル / S-07 精算一覧 / S-08 固定費 / S-09 イベント / S-15 口座・カード
const Kakeibo = (() => {
  const app = () => document.getElementById('app');
  let activeTab = 'expense';
  let expenseCategoryFilter = '';
  let summaryEventPeriod = 'year';
  let lastAutoFilledValue = '';
  let eventModalOpenedFromExpense = false; // 支出登録モーダルからイベント登録モーダルを開いたかどうか
  const ym = '2026-07';
  const today = '2026-07-10';

  function yen(n) { return `${n.toLocaleString()}円`; }

  function render(tab) {
    if (tab) activeTab = tab;
    const personalTotal = DB.getMonthlyPersonalExpenseTotal(DB.state.currentUser.id, ym);
    const householdTotal = DB.getHouseholdTotal(ym);
    const unsettled = DB.getUnsettled();
    const fixedTotal = DB.listFixedCosts().reduce((s, f) => s + f.amount, 0);
    const eventTotal = DB.getEventTotals(summaryEventPeriod, today).reduce((s, e) => s + e.total, 0);

    app().innerHTML = `
      <div class="page">
        <div class="summary-bar">
          <span>今月支出: ${yen(personalTotal)}</span>
          <span>世帯合計対象額: ${yen(householdTotal)}</span>
          <span>未精算 受取: ${yen(unsettled.receivable.amount)}／支払: ${yen(unsettled.payable.amount)}</span>
          <span>固定費予定: ${yen(fixedTotal)}</span>
          <span>イベント支出<select id="kakeibo-event-period"><option value="year" ${summaryEventPeriod === 'year' ? 'selected' : ''}>今年</option><option value="month" ${summaryEventPeriod === 'month' ? 'selected' : ''}>今月</option></select>: ${yen(eventTotal)}</span>
        </div>
        <div class="tabs">
          ${tabBtn('expense', '支出一覧')}${tabBtn('settle', '精算')}${tabBtn('fixed', '固定費')}${tabBtn('event', 'イベント')}${tabBtn('account', '口座・カード')}
        </div>
        <div id="tab-content"></div>
      </div>
      ${expenseModalHtml()}${eventModalHtml()}${fixedModalHtml()}`;

    document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => { activeTab = b.dataset.tab; render(); }));
    document.getElementById('kakeibo-event-period').addEventListener('change', (e) => { summaryEventPeriod = e.target.value; render(); });
    renderTabContent();
    bindExpenseModal();
    bindEventModal();
    bindFixedModal();
  }

  function tabBtn(tab, label) {
    return `<button class="tab-btn ${activeTab === tab ? 'is-active' : ''}" data-tab="${tab}">${label}</button>`;
  }

  function renderTabContent() {
    const el = document.getElementById('tab-content');
    if (activeTab === 'expense') el.innerHTML = renderExpenseTab();
    else if (activeTab === 'settle') el.innerHTML = renderSettleTab();
    else if (activeTab === 'fixed') el.innerHTML = renderFixedTab();
    else if (activeTab === 'event') el.innerHTML = renderEventTab();
    else if (activeTab === 'account') el.innerHTML = renderAccountTab();
    bindTabEvents();
  }

  function renderExpenseTab() {
    // 個人の支出データは本人のみ閲覧可能（common-notes.md 2章）
    const filtered = DB.state.expenses
      .filter((e) => e.payerUserId === DB.state.currentUser.id)
      .filter((e) => !expenseCategoryFilter || String(e.categoryId) === expenseCategoryFilter);
    const rows = filtered.slice().reverse().map((e) => `
      <tr>
        <td>${e.date}</td><td>${UI.escapeHtml(e.purpose)}</td><td>${UI.escapeHtml((DB.getKakeiboCategory(e.categoryId) || {}).name)}</td>
        <td>${e.amount.toLocaleString()}円</td><td>${UI.escapeHtml(DB.getMemberName(e.payerUserId))}</td><td>${UI.escapeHtml(e.memo || '')}</td>
      </tr>`).join('');
    return `
      <div class="toolbar">
        <label>カテゴリー: <select id="expense-filter"><option value="">すべて</option>${DB.state.kakeiboCategories.map((c) => `<option value="${c.id}" ${expenseCategoryFilter === String(c.id) ? 'selected' : ''}>${UI.escapeHtml(c.name)}</option>`).join('')}</select></label>
        <button class="btn btn-primary" id="btn-open-expense">支出を登録</button>
      </div>
      <table class="table">
        <thead><tr><th>日時</th><th>用途</th><th>カテゴリー</th><th>金額</th><th>支払った人</th><th>メモ</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">支出がありません</td></tr>'}</tbody>
      </table>`;
  }

  function renderSettleTab() {
    const currentUserId = DB.state.currentUser.id;
    // 自分が支払った側（債権者）か負担する側（債務者）である精算のみ表示する
    const rows = DB.state.expenseSplits
      .filter((s) => {
        const exp = DB.state.expenses.find((e) => e.id === s.expenseId) || {};
        return exp.payerUserId === currentUserId || s.debtorUserId === currentUserId;
      })
      .map((s) => {
      const exp = DB.state.expenses.find((e) => e.id === s.expenseId) || {};
      // 請求・受領申請は「立て替えた人（支払った人＝受け取る側）」、承認・保留は「負担者（支払う側）」のみ操作可能
      // 精算済み（settled）にするには、支払った人の受領申請を負担者が承認する必要がある（common-notes.md 2章）
      const isPayer = exp.payerUserId === currentUserId;
      const isDebtor = s.debtorUserId === currentUserId;
      let actions = '';
      if (s.status !== 'settled') {
        if (isPayer && s.status !== 'approval_requested') {
          actions += `<button class="btn btn-small" data-action="request" data-id="${s.id}">請求</button><button class="btn btn-small" data-action="approval_requested" data-id="${s.id}">受領申請</button>`;
        }
        if (isDebtor) {
          if (s.status === 'approval_requested') {
            actions += `<button class="btn btn-small" data-action="settle" data-id="${s.id}">承認（精算済みにする）</button>`;
          }
          actions += `<button class="btn btn-small" data-action="pending" data-id="${s.id}">保留</button>`;
        }
        if (!actions) actions = '<span class="hint">相手の操作待ち</span>';
      }
      // 「相手」欄には精算の相手方を表示する（立て替えた側から見れば負担者、負担者から見れば支払った人）
      const counterpartyName = isDebtor ? DB.getMemberName(exp.payerUserId) : s.debtorName;
      return `<tr>
        <td>${UI.escapeHtml(exp.purpose || '')}</td><td>${UI.escapeHtml(counterpartyName)}</td><td>${s.splitRatio}%</td><td>${s.amountDue.toLocaleString()}円</td>
        <td>${statusLabel(s.status)}</td>
        <td>${actions}</td>
      </tr>`;
    }).join('');
    return `<table class="table">
      <thead><tr><th>支出内容</th><th>相手</th><th>割合</th><th>金額</th><th>ステータス</th><th>操作</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">精算対象がありません</td></tr>'}</tbody>
    </table>`;
  }

  function statusLabel(s) {
    return { unpaid: '未請求', requested: '請求中', approval_requested: '受領承認待ち', pending: '保留中', settled: '精算済み' }[s] || s;
  }

  function renderFixedTab() {
    const rows = DB.listFixedCosts().map((f) => {
      const splitLabel = (f.splits || []).length
        ? f.splits.map((s) => `${UI.escapeHtml(s.name)} ${s.splitRatio}%`).join('、')
        : 'なし';
      return `<tr><td>${UI.escapeHtml(f.name)}</td><td>${f.amount.toLocaleString()}円</td><td>${f.paymentDay}日</td><td>${f.ownerUserId == null ? '世帯共有' : '個人'}</td><td>${f.includeInHouseholdTotal ? '○' : '×'}</td><td>${splitLabel}</td></tr>`;
    }).join('');
    return `
      <div class="toolbar"><button class="btn btn-primary" id="btn-add-fixed">固定費を登録</button></div>
      <p class="hint">公開範囲が「個人」の固定費は自分にのみ表示されます。割り勘を設定した固定費は、毎月の自動計上時にその割合で精算が作成されます。</p>
      <table class="table">
        <thead><tr><th>固定費名</th><th>金額</th><th>支払日</th><th>公開範囲</th><th>世帯合計対象</th><th>割り勘</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">固定費がありません</td></tr>'}</tbody>
      </table>`;
  }

  function renderEventTab() {
    const rows = DB.listEvents().map((ev) => {
      const total = DB.getEventTotals('year', today).find((e) => e.event.id === ev.id).total;
      const defaultAmountLabel = ev.defaultAmount ? `${ev.defaultAmount.toLocaleString()}円` : '未設定';
      return `<tr><td>${UI.escapeHtml(ev.name)}</td><td>${ev.date}（${recurrenceLabel(ev.recurrenceType)}）${eventTimeLabel(ev)}</td><td>${defaultAmountLabel}</td><td>${ev.ownerUserId == null ? '世帯共有' : '個人'}</td><td>${total.toLocaleString()}円</td><td><label class="checkbox-inline"><input type="checkbox" class="ev-dash-toggle" data-id="${ev.id}" ${ev.showOnDashboard ? 'checked' : ''} /> 表示</label></td></tr>`;
    }).join('');
    return `
      <div class="toolbar"><button class="btn btn-primary" id="btn-open-event">イベントを作成</button></div>
      <p class="hint">公開範囲が「個人」のイベントは自分にのみ表示されます。合計金額は自分の支出のみを集計します。トップ画面のイベント別支出には「ダッシュボード表示」がONのイベントのみ表示されます。</p>
      <table class="table"><thead><tr><th>イベント名</th><th>日付/繰り返し・時間帯</th><th>デフォルト金額</th><th>公開範囲</th><th>合計金額（今年）</th><th>ダッシュボード表示</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">イベントがありません</td></tr>'}</tbody></table>`;
  }

  function recurrenceLabel(t) {
    return { none: '単発', daily: '毎日', weekly: '毎週', monthly: '毎月', yearly: '毎年' }[t] || t;
  }

  // イベントの時間帯ラベル（終日 / 20:00〜21:00 / 9:00〜）。日次詳細モーダル（dashboard.js）からも使う
  function eventTimeLabel(ev) {
    if (ev.isAllDay || !ev.startTime) return '終日';
    return `${ev.startTime}〜${ev.endTime || ''}`;
  }

  function renderAccountTab() {
    // 口座は所有者本人のみが自分の一覧・選択肢に表示する（F11_kakeibo_account参照）
    const myAccounts = DB.listMyAccounts();
    const list = myAccounts.map((a) => {
      const cards = DB.state.cards.filter((c) => c.accountId === a.id);
      return `<li>${UI.escapeHtml(a.name)}（${a.type === 'bank' ? '銀行' : '電子マネー'}）　残高: ${a.balance.toLocaleString()}円${cards.length ? `<ul>${cards.map((c) => `<li>${UI.escapeHtml(c.name)}</li>`).join('')}</ul>` : ''}</li>`;
    }).join('');
    return `
      <div class="toolbar">
        <button class="btn btn-primary" id="btn-add-account">口座を登録</button>
        <button class="btn btn-secondary" id="btn-add-card">カードを登録</button>
      </div>
      <p class="hint">残高は本人のみ閲覧可能です。支出登録で口座/カードを指定すると自動的に減算されます。</p>
      <div id="account-form" class="hidden inline-form">
        <label>口座名</label><input type="text" id="acc-name" />
        <label>種別</label><select id="acc-type"><option value="bank">銀行</option><option value="e_money">電子マネー</option></select>
        <label>初期残高</label><input type="number" id="acc-balance" value="0" />
        <button class="btn btn-primary" id="btn-save-account">保存</button>
      </div>
      <div id="card-form" class="hidden inline-form">
        <label>紐づける口座</label><select id="card-account">${myAccounts.map((a) => `<option value="${a.id}">${UI.escapeHtml(a.name)}</option>`).join('')}</select>
        <label>カード名</label><input type="text" id="card-name" />
        <button class="btn btn-primary" id="btn-save-card">保存</button>
      </div>
      <ul class="account-list">${list}</ul>`;
  }

  function bindTabEvents() {
    if (activeTab === 'expense') {
      document.getElementById('btn-open-expense').addEventListener('click', () => openExpenseModal());
      document.getElementById('expense-filter').addEventListener('change', (e) => {
        expenseCategoryFilter = e.target.value;
        renderTabContent();
      });
    } else if (activeTab === 'settle') {
      document.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          const status = { request: 'requested', settle: 'settled' }[action] || action;
          DB.updateSplitStatus(btn.dataset.id, status);
          // サマリーバーの未精算 受取/支払も最新化するため画面全体を再描画する
          render();
        });
      });
    } else if (activeTab === 'fixed') {
      document.getElementById('btn-add-fixed').addEventListener('click', () => openFixedModal());
    } else if (activeTab === 'event') {
      document.getElementById('btn-open-event').addEventListener('click', () => openEventModal());
      // ダッシュボード表示のON/OFF切り替え（トップ画面のイベント別支出サマリーの表示対象を選択する）
      document.querySelectorAll('.ev-dash-toggle').forEach((cb) => {
        cb.addEventListener('change', () => DB.toggleEventDashboard(cb.dataset.id));
      });
    } else if (activeTab === 'account') {
      document.getElementById('btn-add-account').addEventListener('click', () => document.getElementById('account-form').classList.toggle('hidden'));
      document.getElementById('btn-add-card').addEventListener('click', () => document.getElementById('card-form').classList.toggle('hidden'));
      document.getElementById('btn-save-account').addEventListener('click', () => {
        DB.addAccount({
          ownerUserId: DB.state.currentUser.id,
          name: document.getElementById('acc-name').value || '口座',
          type: document.getElementById('acc-type').value,
          balance: Number(document.getElementById('acc-balance').value) || 0,
        });
        // 支出登録モーダルの口座選択肢を最新化するため画面全体を再描画する
        render();
      });
      document.getElementById('btn-save-card').addEventListener('click', () => {
        const accountIdRaw = document.getElementById('card-account').value;
        // カードは必ずいずれかの口座に属する（common-notes.md 7章）。口座未登録の場合は作成させない
        if (!accountIdRaw) {
          UI.toast('カードを登録するには、先に口座を登録してください');
          return;
        }
        DB.addCard({ accountId: Number(accountIdRaw), name: document.getElementById('card-name').value || 'カード' });
        render();
      });
    }
  }

  // --- 割り勘設定の共通UI（S-06支出登録・固定費登録モーダルで共用、F04 7章） ---
  const splitControls = {};

  function splitFieldsetHtml(prefix) {
    const members = DB.getCurrentHousehold().memberIds.map((id) => ({ id, name: DB.getMemberName(id) }));
    return `
          <fieldset class="split-fieldset">
            <legend>割り勘設定（任意）</legend>
            <label>入力モード</label>
            <label class="checkbox-inline"><input type="radio" name="${prefix}-split-mode" value="ratio" checked /> ％入力</label>
            <label class="checkbox-inline"><input type="radio" name="${prefix}-split-mode" value="amount" /> 金額入力</label>
            <label>対象者と負担分</label>
            <div>${members.map((m) => `
              <div class="split-row">
                <label class="checkbox-inline"><input type="checkbox" class="split-target ${prefix}-split-target" value="${m.id}" data-name="${UI.escapeHtml(m.name)}" /> ${UI.escapeHtml(m.name)}</label>
                <input type="number" class="split-value ${prefix}-split-value hidden" data-user="${m.id}" step="0.01" min="0" />
                <span class="split-unit ${prefix}-split-unit hidden" data-user="${m.id}">%</span>
              </div>`).join('')}</div>
            <p class="hint">対象者にチェックを入れると負担分を入力できます（初期値は均等割り）。％入力は合計100%、金額入力は合計が金額と一致するように入力してください。</p>
            <p id="${prefix}-split-check-msg" class="hint"></p>
          </fieldset>`;
  }

  // 割り勘入力のイベントバインドと検証・計算。collect(amount)はエラー時null、成功時は
  // { userId, name, splitInputType, splitRatio, amountDue } の配列を返す
  function bindSplitInputs(prefix, getAmount) {
    const mode = () => document.querySelector(`input[name="${prefix}-split-mode"]:checked`).value;
    const checked = () => Array.from(document.querySelectorAll(`.${prefix}-split-target:checked`));
    const msgEl = () => document.getElementById(`${prefix}-split-check-msg`);

    // チェック中の対象者の負担分入力欄を均等割りのデフォルト値で埋め直す
    function resetDefaults() {
      const m = mode();
      const targets = checked();
      const n = targets.length;
      const amount = getAmount();
      document.querySelectorAll(`.${prefix}-split-value`).forEach((input) => {
        const isChecked = targets.some((t) => t.value === input.dataset.user);
        input.classList.toggle('hidden', !isChecked);
        document.querySelector(`.${prefix}-split-unit[data-user="${input.dataset.user}"]`).classList.toggle('hidden', !isChecked);
      });
      document.querySelectorAll(`.${prefix}-split-unit`).forEach((u) => { u.textContent = m === 'ratio' ? '%' : '円'; });
      if (!n) return;
      targets.forEach((t, idx) => {
        const input = document.querySelector(`.${prefix}-split-value[data-user="${t.value}"]`);
        if (m === 'ratio') {
          const base = Math.floor((100 / n) * 100) / 100;
          // 端数は先頭（代表者）へ寄せて合計100%にする
          input.value = idx === 0 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base;
        } else {
          const base = Math.floor(amount / n);
          input.value = idx === 0 ? amount - base * (n - 1) : base;
        }
      });
      msgEl().textContent = '';
    }

    // 全チェック・入力値・モードを初期状態に戻す（モーダルを開くたびに呼ぶ）
    function resetAll() {
      document.querySelectorAll(`.${prefix}-split-target`).forEach((el) => { el.checked = false; });
      document.querySelector(`input[name="${prefix}-split-mode"][value="ratio"]`).checked = true;
      document.querySelectorAll(`.${prefix}-split-value`).forEach((el) => { el.value = ''; el.classList.add('hidden'); });
      document.querySelectorAll(`.${prefix}-split-unit`).forEach((el) => el.classList.add('hidden'));
      msgEl().textContent = '';
    }

    // 負担分を検証し、割合と負担額の両方を算出する（F04 7章）
    function collect(amount) {
      const m = mode();
      msgEl().textContent = '';
      const rawTargets = checked().map((el) => ({
        userId: Number(el.value),
        name: el.dataset.name,
        value: Number(document.querySelector(`.${prefix}-split-value[data-user="${el.value}"]`).value) || 0,
      }));
      if (!rawTargets.length) return [];
      if (m === 'ratio') {
        const totalRatio = Math.round(rawTargets.reduce((s, t) => s + t.value, 0) * 100) / 100;
        if (totalRatio !== 100) {
          msgEl().textContent = `割合の合計が${totalRatio}%です。合計100%になるように入力してください。`;
          UI.toast('割り勘の割合の合計を100%にしてください');
          return null;
        }
        // 負担額＝金額×割合（1円未満切り捨て。端数は代表者＝支払う人が負担する）
        return rawTargets.map((t) => ({ userId: t.userId, name: t.name, splitInputType: m, splitRatio: t.value, amountDue: Math.floor(amount * (t.value / 100)) }));
      }
      const totalAmount = rawTargets.reduce((s, t) => s + t.value, 0);
      if (totalAmount !== amount) {
        const diff = amount - totalAmount;
        msgEl().textContent = `負担額の合計が${totalAmount.toLocaleString()}円で、金額と${Math.abs(diff).toLocaleString()}円ずれています（${diff > 0 ? '不足' : '超過'}）。`;
        UI.toast('割り勘の負担額の合計を金額と一致させてください');
        return null;
      }
      // 負担割合＝負担額÷金額×100（小数第3位を四捨五入、表示・集計用の参考値）
      return rawTargets.map((t) => ({ userId: t.userId, name: t.name, splitInputType: m, splitRatio: Math.round((t.value / amount) * 10000) / 100, amountDue: t.value }));
    }

    document.querySelectorAll(`input[name="${prefix}-split-mode"]`).forEach((radio) => radio.addEventListener('change', resetDefaults));
    document.querySelectorAll(`.${prefix}-split-target`).forEach((cb) => cb.addEventListener('change', resetDefaults));
    splitControls[prefix] = { resetAll, collect };
    return splitControls[prefix];
  }

  // --- S-06 支出登録モーダル ---
  function expenseModalHtml() {
    return `
      <div class="modal-overlay" id="modal-expense">
        <div class="modal">
          <h2>支出を登録</h2>
          <label>日時</label><input type="date" id="exp-date" value="2026-07-10" />
          <label>金額</label><input type="number" id="exp-amount" />
          <label>使用用途</label><input type="text" id="exp-purpose" />
          <label>カテゴリー</label><select id="exp-category">${DB.state.kakeiboCategories.map((c) => `<option value="${c.id}">${UI.escapeHtml(c.name)}</option>`).join('')}</select>
          <label>支払った人</label><p>${UI.escapeHtml(DB.getMemberName(DB.state.currentUser.id))}（本人の支出のみ登録可能）</p>
          <label>口座/カード（任意）</label>
          <select id="exp-account"><option value="">なし</option>${(() => {
            const myAccounts = DB.listMyAccounts();
            const options = [];
            myAccounts.forEach((a) => {
              options.push(`<option value="${a.id}">${UI.escapeHtml(a.name)}</option>`);
              DB.state.cards.filter((c) => c.accountId === a.id).forEach((c) => {
                options.push(`<option value="${a.id}">${UI.escapeHtml(a.name)}／${UI.escapeHtml(c.name)}</option>`);
              });
            });
            return options.join('');
          })()}</select>
          <label>イベント（任意） <button type="button" class="btn btn-tiny" id="btn-open-event-from-expense">＋イベント登録</button></label>
          <select id="exp-event"><option value="">なし</option>${DB.listEvents().map((ev) => `<option value="${ev.id}">${UI.escapeHtml(ev.name)}</option>`).join('')}</select>
          <label><input type="checkbox" id="exp-household" /> 世帯合計に含める</label>
          <label>メモ</label><input type="text" id="exp-memo" />
          ${splitFieldsetHtml('exp')}
          <div class="modal-actions">
            <button class="btn btn-primary" id="btn-save-expense">保存</button>
            <button class="btn btn-secondary" id="btn-cancel-expense">キャンセル</button>
          </div>
        </div>
      </div>`;
  }

  function bindExpenseModal() {
    document.getElementById('btn-cancel-expense').addEventListener('click', () => UI.closeModal('modal-expense'));
    // 支出モーダルの上にイベント登録モーダルを重ねて開く（保存後は支出モーダルに戻り、新イベントを選択状態にする）
    document.getElementById('btn-open-event-from-expense').addEventListener('click', () => {
      eventModalOpenedFromExpense = true;
      openEventModal(document.getElementById('exp-date').value);
    });
    document.getElementById('exp-event').addEventListener('change', (e) => {
      const amountInput = document.getElementById('exp-amount');
      // 直前にこの自動入力で設定した値のままの場合のみイベント切替に追従して更新/クリアする。
      // ユーザーが手入力で上書きした金額はそれ以降のイベント切替では保持する。
      if (amountInput.value !== lastAutoFilledValue) return;
      const ev = e.target.value ? DB.getEvent(e.target.value) : null;
      lastAutoFilledValue = ev && ev.defaultAmount ? String(ev.defaultAmount) : '';
      amountInput.value = lastAutoFilledValue;
    });
    // 割り勘：入力モード（％/金額）切替と負担分入力（共通ヘルパー、F04 7章）
    const expSplit = bindSplitInputs('exp', () => Number(document.getElementById('exp-amount').value) || 0);

    document.getElementById('btn-save-expense').addEventListener('click', () => {
      const amount = Number(document.getElementById('exp-amount').value);
      if (!amount || amount <= 0) {
        UI.toast('金額は0より大きい値を入力してください');
        return;
      }
      const targets = expSplit.collect(amount);
      if (targets === null) return;
      DB.addExpense({
        date: document.getElementById('exp-date').value,
        amount,
        purpose: document.getElementById('exp-purpose').value || '(無題)',
        categoryId: Number(document.getElementById('exp-category').value),
        payerUserId: DB.state.currentUser.id,
        accountId: document.getElementById('exp-account').value ? Number(document.getElementById('exp-account').value) : null,
        eventId: document.getElementById('exp-event').value ? Number(document.getElementById('exp-event').value) : null,
        includeInHouseholdTotal: document.getElementById('exp-household').checked,
        memo: document.getElementById('exp-memo').value,
      }, targets);
      UI.closeModal('modal-expense');
      UI.toast('支出を登録しました');
      // サマリーバー（今月支出・世帯合計対象額・イベント支出等）も最新化するため画面全体を再描画する
      if (document.getElementById('tab-content')) render();
    });
  }

  function openExpenseModal(dateStr) {
    document.getElementById('exp-date').value = dateStr || '2026-07-10';
    document.getElementById('exp-amount').value = '';
    document.getElementById('exp-purpose').value = '';
    document.getElementById('exp-category').selectedIndex = 0;
    document.getElementById('exp-account').value = '';
    document.getElementById('exp-event').value = '';
    document.getElementById('exp-household').checked = false;
    document.getElementById('exp-memo').value = '';
    splitControls.exp.resetAll();
    lastAutoFilledValue = '';
    UI.openModal('modal-expense');
  }

  // --- S-18 イベント登録モーダル ---
  function eventModalHtml() {
    return `
      <div class="modal-overlay" id="modal-event">
        <div class="modal">
          <h2>イベントを登録</h2>
          <label>イベント名</label><input type="text" id="ev-name" />
          <label>日付</label><input type="date" id="ev-date" value="2026-07-10" />
          <label><input type="checkbox" id="ev-all-day" checked /> 終日</label>
          <div id="ev-time-fields" class="hidden">
            <label>開始時刻</label><input type="time" id="ev-start-time" />
            <label>終了時刻（任意）</label><input type="time" id="ev-end-time" />
            <p class="hint">終了未定の場合は開始時刻のみ入力してください</p>
          </div>
          <label>繰り返し</label>
          <select id="ev-recurrence"><option value="none">なし</option><option value="daily">毎日</option><option value="weekly">毎週</option><option value="monthly">毎月</option><option value="yearly">毎年</option></select>
          <label><input type="checkbox" id="ev-notify" /> アプリ内通知を有効にする</label>
          <label>デフォルト金額（任意）</label>
          <input type="number" id="ev-default-amount" placeholder="支出登録時に自動入力されます" />
          <label><input type="checkbox" id="ev-show-dashboard" checked /> トップ画面のイベント別支出に表示する</label>
          <label>公開範囲</label>
          <label class="checkbox-inline"><input type="radio" name="ev-visibility" value="shared" checked /> 世帯共有</label>
          <label class="checkbox-inline"><input type="radio" name="ev-visibility" value="personal" /> 個人</label>
          <p class="hint">「個人」を選ぶと自分にのみ表示されます</p>
          <div class="modal-actions">
            <button class="btn btn-primary" id="btn-save-event">保存</button>
            <button class="btn btn-secondary" id="btn-cancel-event">キャンセル</button>
          </div>
        </div>
      </div>`;
  }

  function bindEventModal() {
    document.getElementById('btn-cancel-event').addEventListener('click', () => {
      eventModalOpenedFromExpense = false;
      UI.closeModal('modal-event');
    });
    document.getElementById('ev-all-day').addEventListener('change', (e) => {
      document.getElementById('ev-time-fields').classList.toggle('hidden', e.target.checked);
    });
    document.getElementById('btn-save-event').addEventListener('click', () => {
      const isAllDay = document.getElementById('ev-all-day').checked;
      const startTime = document.getElementById('ev-start-time').value;
      const endTime = document.getElementById('ev-end-time').value;
      if (!isAllDay) {
        // 時刻指定イベントは開始時刻必須（終了のみの入力は不可）、終了＜開始はエラー（F06参照）
        if (!startTime) {
          UI.toast('開始時刻を入力してください（終日の場合は「終日」にチェック）');
          return;
        }
        if (endTime && endTime < startTime) {
          UI.toast('終了時刻は開始時刻より後にしてください');
          return;
        }
      }
      const defaultAmountRaw = document.getElementById('ev-default-amount').value;
      const visibility = document.querySelector('input[name="ev-visibility"]:checked').value;
      const newEvent = DB.addEvent({
        name: document.getElementById('ev-name').value || '(無題イベント)',
        date: document.getElementById('ev-date').value,
        isAllDay,
        startTime: isAllDay ? null : startTime,
        endTime: isAllDay ? null : (endTime || null),
        recurrenceType: document.getElementById('ev-recurrence').value,
        notifyEnabled: document.getElementById('ev-notify').checked,
        defaultAmount: defaultAmountRaw ? Number(defaultAmountRaw) : null,
        ownerUserId: visibility === 'personal' ? DB.state.currentUser.id : null,
        showOnDashboard: document.getElementById('ev-show-dashboard').checked,
      });
      UI.toast('イベントを登録しました');
      if (eventModalOpenedFromExpense) {
        // 支出登録モーダルから開いた場合は、入力中の値を消さないよう画面は再描画せず、
        // イベントセレクトの選択肢だけを組み直して新イベントを選択状態にする
        eventModalOpenedFromExpense = false;
        const select = document.getElementById('exp-event');
        select.innerHTML = `<option value="">なし</option>${DB.listEvents().map((ev) => `<option value="${ev.id}">${UI.escapeHtml(ev.name)}</option>`).join('')}`;
        select.value = String(newEvent.id);
        // デフォルト金額の自動入力を発火させる
        select.dispatchEvent(new Event('change'));
        UI.closeModal('modal-event');
        return;
      }
      // イベント選択肢（支出登録モーダル・イベント一覧）を最新化するため画面全体を再描画する
      activeTab = 'event';
      render();
    });
  }

  function openEventModal(dateStr) {
    // 前回入力値が残らないよう、開くたびに全項目を初期化する
    document.getElementById('ev-name').value = '';
    document.getElementById('ev-date').value = dateStr || '2026-07-10';
    document.getElementById('ev-all-day').checked = true;
    document.getElementById('ev-start-time').value = '';
    document.getElementById('ev-end-time').value = '';
    document.getElementById('ev-time-fields').classList.add('hidden');
    document.getElementById('ev-recurrence').value = 'none';
    document.getElementById('ev-notify').checked = false;
    document.getElementById('ev-default-amount').value = '';
    document.getElementById('ev-show-dashboard').checked = true;
    document.querySelector('input[name="ev-visibility"][value="shared"]').checked = true;
    UI.openModal('modal-event');
  }

  // --- 固定費登録モーダル ---
  function fixedModalHtml() {
    return `
      <div class="modal-overlay" id="modal-fixed">
        <div class="modal">
          <h2>固定費を登録</h2>
          <label>固定費名</label><input type="text" id="fc-name" list="fc-defaults" />
          <datalist id="fc-defaults"><option>家賃</option><option>水道代</option><option>電気代</option><option>ガス代</option><option>インターネット代</option><option>携帯電話代</option><option>サブスクリプション</option></datalist>
          <label>金額</label><input type="number" id="fc-amount" />
          <label>支払日</label><input type="number" id="fc-day" min="1" max="31" />
          <label>公開範囲</label>
          <label class="checkbox-inline"><input type="radio" name="fc-visibility" value="shared" checked /> 世帯共有</label>
          <label class="checkbox-inline"><input type="radio" name="fc-visibility" value="personal" /> 個人</label>
          <label><input type="checkbox" id="fc-household" /> 世帯合計に含める</label>
          ${splitFieldsetHtml('fc')}
          <p class="hint">割り勘を設定すると、毎月の自動計上時にこの割合で精算（expense_splits）が作成されます。</p>
          <div class="modal-actions">
            <button class="btn btn-primary" id="btn-save-fixed">保存</button>
            <button class="btn btn-secondary" id="btn-cancel-fixed">キャンセル</button>
          </div>
        </div>
      </div>`;
  }

  function bindFixedModal() {
    document.getElementById('btn-cancel-fixed').addEventListener('click', () => UI.closeModal('modal-fixed'));
    const fcSplit = bindSplitInputs('fc', () => Number(document.getElementById('fc-amount').value) || 0);
    document.getElementById('btn-save-fixed').addEventListener('click', () => {
      const amount = Number(document.getElementById('fc-amount').value);
      if (!amount || amount <= 0) {
        UI.toast('金額は0より大きい値を入力してください');
        return;
      }
      const targets = fcSplit.collect(amount);
      if (targets === null) return;
      const visibility = document.querySelector('input[name="fc-visibility"]:checked').value;
      DB.addFixedCost({
        name: document.getElementById('fc-name').value || '固定費',
        amount,
        paymentDay: Number(document.getElementById('fc-day').value) || 1,
        ownerUserId: visibility === 'personal' ? DB.state.currentUser.id : null,
        includeInHouseholdTotal: document.getElementById('fc-household').checked,
        // 登録者本人は債務者にならないため、割り勘設定として保持するのは本人以外の分のみ
        splits: targets.filter((t) => t.userId !== DB.state.currentUser.id),
      });
      UI.closeModal('modal-fixed');
      UI.toast('固定費を登録しました');
      // サマリーバーの固定費予定・世帯合計対象額も最新化するため画面全体を再描画する
      activeTab = 'fixed';
      render();
    });
  }

  function openFixedModal() {
    // 前回入力値が残らないよう、開くたびに全項目を初期化する
    document.getElementById('fc-name').value = '';
    document.getElementById('fc-amount').value = '';
    document.getElementById('fc-day').value = '';
    document.querySelector('input[name="fc-visibility"][value="shared"]').checked = true;
    document.getElementById('fc-household').checked = false;
    splitControls.fc.resetAll();
    UI.openModal('modal-fixed');
  }

  return { render, openExpenseModal, openEventModal, eventTimeLabel };
})();
