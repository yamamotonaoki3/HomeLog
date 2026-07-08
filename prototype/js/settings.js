// S-21 設定画面（ダッシュボード表示カスタマイズ）
const Settings = (() => {
  const app = () => document.getElementById('app');

  // カード（親）とカード内項目（子）の2階層。個人の財政は項目が1つのため子項目なし
  const CARDS = [
    ['today', '今日の状況', [['balance', '収支'], ['menu', '今週の献立'], ['events', 'イベント']]],
    ['money', '今月のお金', [['personal', '個人支出'], ['householdTotal', '世帯合計対象額'], ['unsettled', '未精算（受取・支払）'], ['eventSummary', 'イベント別支出']]],
    ['finance', '個人の財政', []],
    ['stock', '買い物・在庫', [['shoppingCount', '買い物リスト件数'], ['lowStock', '在庫不足件数'], ['commonItems', 'よく使う品目']]],
    ['calendar', 'カレンダー', [['events', 'イベント'], ['balance', '日次収支']]],
  ];

  function render() {
    const settings = DB.getDashboardSettings();
    const cards = settings.dashboardCards;
    const items = settings.dashboardItems;

    app().innerHTML = `
      <div class="page">
        <div class="card">
          <h2>設定</h2>
          <h3>ダッシュボードに表示する項目</h3>
          <p class="hint">チェックを外した項目はトップ画面に表示されません（設定はユーザーごとに保存されます）。カードのチェックを外すと、カード内の項目ごとまとめて非表示になります。</p>
          ${CARDS.map(([cardKey, cardLabel, subItems]) => `
            <div class="settings-group">
              <label class="checkbox-inline"><input type="checkbox" class="dash-card-toggle" value="${cardKey}" ${cards[cardKey] ? 'checked' : ''} /> <strong>${cardLabel}</strong></label>
              ${subItems.length ? `
              <div class="settings-subitems">
                ${subItems.map(([itemKey, itemLabel]) => `
                  <label class="checkbox-inline"><input type="checkbox" class="dash-item-toggle" data-card="${cardKey}" value="${itemKey}" ${items[cardKey][itemKey] ? 'checked' : ''} ${cards[cardKey] ? '' : 'disabled'} /> ${itemLabel}</label>`).join('<br />')}
              </div>` : ''}
            </div>`).join('')}
          <div class="modal-actions">
            <button class="btn btn-primary" id="btn-save-settings">保存</button>
          </div>
        </div>
      </div>`;

    // 親カードのON/OFFに連動して、子項目チェックの有効/無効を切り替える（設定値は保持）
    document.querySelectorAll('.dash-card-toggle').forEach((cardEl) => {
      cardEl.addEventListener('change', () => {
        document.querySelectorAll(`.dash-item-toggle[data-card="${cardEl.value}"]`).forEach((itemEl) => {
          itemEl.disabled = !cardEl.checked;
        });
      });
    });

    document.getElementById('btn-save-settings').addEventListener('click', () => {
      const updatedCards = {};
      document.querySelectorAll('.dash-card-toggle').forEach((el) => { updatedCards[el.value] = el.checked; });
      const updatedItems = {};
      document.querySelectorAll('.dash-item-toggle').forEach((el) => {
        if (!updatedItems[el.dataset.card]) updatedItems[el.dataset.card] = {};
        updatedItems[el.dataset.card][el.value] = el.checked;
      });
      DB.updateDashboardSettings(updatedCards, updatedItems);
      UI.toast('設定を保存しました');
      Router.navigate('#/dashboard');
    });
  }

  return { render };
})();
