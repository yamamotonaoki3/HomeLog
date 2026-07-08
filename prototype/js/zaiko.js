// S-10 在庫・買い物リスト画面
const Zaiko = (() => {
  const app = () => document.getElementById('app');
  let shoppingSort = 'name';

  function render() {
    app().innerHTML = `
      <div class="page zaiko-page">
        <div class="panel">
          <div class="toolbar">
            <h2>在庫一覧</h2>
            <button class="btn btn-primary" id="btn-add-inventory">在庫を登録</button>
          </div>
          <p class="hint">カテゴリーマスタ管理（プロトタイプでは省略。デフォルトマスタを使用）。店舗は在庫登録モーダル内で追加できます</p>
          <table class="table">
            <thead><tr><th>品名</th><th>カテゴリー</th><th>買う店</th><th>在庫個数</th><th>閾値</th></tr></thead>
            <tbody id="inventory-rows"></tbody>
          </table>
        </div>
        <div class="panel">
          <div class="toolbar">
            <h2>買い物リスト</h2>
            <select id="shopping-sort">
              <option value="name">あいうえお順</option>
              <option value="category">カテゴリー順</option>
              <option value="store">買う店順</option>
            </select>
            <button class="btn btn-secondary" id="btn-add-shopping">品目を手動追加</button>
          </div>
          <div id="add-shopping-form" class="hidden inline-form">
            <select id="shopping-add-select">${DB.listInventoryItems().map((i) => `<option value="${i.id}">${UI.escapeHtml(i.name)}</option>`).join('')}</select>
            <button class="btn btn-primary" id="btn-confirm-add-shopping">追加</button>
          </div>
          <table class="table">
            <thead><tr><th>品名</th><th>カテゴリー</th><th>買う店</th><th>購入済</th><th>購入個数</th><th></th></tr></thead>
            <tbody id="shopping-rows"></tbody>
          </table>
          <button class="btn btn-primary" id="btn-update-shopping">更新</button>
        </div>
      </div>
      ${inventoryModalHtml()}`;

    renderInventoryRows();
    renderShoppingRows();
    bindInventoryModal();

    document.getElementById('btn-add-inventory').addEventListener('click', () => openInventoryModal());

    document.getElementById('shopping-sort').addEventListener('change', (e) => { shoppingSort = e.target.value; renderShoppingRows(); });
    document.getElementById('btn-add-shopping').addEventListener('click', () => document.getElementById('add-shopping-form').classList.toggle('hidden'));
    document.getElementById('btn-confirm-add-shopping').addEventListener('click', () => {
      DB.addShoppingListItemManual(document.getElementById('shopping-add-select').value);
      document.getElementById('add-shopping-form').classList.add('hidden');
      renderShoppingRows();
    });
    document.getElementById('btn-update-shopping').addEventListener('click', () => {
      const updates = Array.from(document.querySelectorAll('.purchase-qty')).map((el) => ({
        id: el.dataset.id,
        purchasedQuantity: document.getElementById(`chk-${el.dataset.id}`).checked ? Number(el.value) : 0,
      })).filter((u) => u.purchasedQuantity > 0);
      DB.updateShoppingListPurchases(updates);
      UI.toast('在庫に反映しました');
      renderInventoryRows();
      renderShoppingRows();
    });
  }

  // --- 在庫登録モーダル ---
  function inventoryModalHtml() {
    return `
      <div class="modal-overlay" id="modal-inventory">
        <div class="modal">
          <h2>在庫を登録</h2>
          <label>品名</label><input type="text" id="inv-name" />
          <label>カテゴリー</label><select id="inv-category">${DB.state.zaikoCategories.map((c) => `<option value="${c.id}">${UI.escapeHtml(c.name)}</option>`).join('')}</select>
          <label>買う店（任意） <button type="button" class="btn btn-tiny" id="btn-open-store-form">＋店を登録</button></label>
          <select id="inv-store"><option value="">なし</option>${DB.listStores().map((s) => `<option value="${s.id}">${UI.escapeHtml(s.name)}</option>`).join('')}</select>
          <div id="store-form" class="hidden">
            <label>店名</label><input type="text" id="store-name" placeholder="例：スーパーC" />
            <button type="button" class="btn btn-small" id="btn-save-store">店を追加</button>
          </div>
          <label>在庫個数</label><input type="number" step="0.1" id="inv-quantity" />
          <label>買い物リスト追加閾値</label><input type="number" step="0.1" id="inv-threshold" />
          <p class="hint">在庫個数がこの閾値を下回ると、買い物リストに自動追加されます</p>
          <div class="modal-actions">
            <button class="btn btn-primary" id="btn-save-inventory">保存</button>
            <button class="btn btn-secondary" id="btn-cancel-inventory">キャンセル</button>
          </div>
        </div>
      </div>`;
  }

  function bindInventoryModal() {
    document.getElementById('btn-cancel-inventory').addEventListener('click', () => UI.closeModal('modal-inventory'));
    document.getElementById('btn-open-store-form').addEventListener('click', () => document.getElementById('store-form').classList.toggle('hidden'));
    document.getElementById('btn-save-store').addEventListener('click', () => {
      const name = document.getElementById('store-name').value.trim();
      if (!name) {
        UI.toast('店名を入力してください');
        return;
      }
      const newStore = DB.addStore(name);
      // 買う店セレクトに即反映し、追加した店を選択状態にする
      const select = document.getElementById('inv-store');
      select.innerHTML = `<option value="">なし</option>${DB.listStores().map((s) => `<option value="${s.id}">${UI.escapeHtml(s.name)}</option>`).join('')}`;
      select.value = String(newStore.id);
      document.getElementById('store-name').value = '';
      document.getElementById('store-form').classList.add('hidden');
      UI.toast('店を登録しました');
    });
    document.getElementById('btn-save-inventory').addEventListener('click', () => {
      DB.addInventoryItem({
        name: document.getElementById('inv-name').value || '(無題)',
        categoryId: Number(document.getElementById('inv-category').value),
        storeId: document.getElementById('inv-store').value ? Number(document.getElementById('inv-store').value) : null,
        quantity: Number(document.getElementById('inv-quantity').value) || 0,
        threshold: Number(document.getElementById('inv-threshold').value) || 0,
      });
      UI.closeModal('modal-inventory');
      UI.toast('在庫を登録しました');
      // 手動追加用の品目セレクト（shopping-add-select）にも新しい在庫を反映するため画面全体を再描画する
      render();
    });
  }

  function openInventoryModal() {
    // 前回入力値が残らないよう、開くたびに全項目を初期化する
    document.getElementById('inv-name').value = '';
    document.getElementById('inv-category').selectedIndex = 0;
    document.getElementById('inv-store').value = '';
    document.getElementById('store-name').value = '';
    document.getElementById('store-form').classList.add('hidden');
    document.getElementById('inv-quantity').value = '1.0';
    document.getElementById('inv-threshold').value = '0.5';
    UI.openModal('modal-inventory');
  }

  function renderInventoryRows() {
    const rows = DB.listInventoryItems().map((item) => `
      <tr>
        <td>${UI.escapeHtml(item.name)}</td>
        <td>${UI.escapeHtml((DB.getCategory(item.categoryId) || {}).name)}</td>
        <td>${UI.escapeHtml(item.storeId ? (DB.getStore(item.storeId) || {}).name : '')}</td>
        <td>
          <button class="btn btn-tiny" data-inv-adjust="${item.id}" data-delta="-1">－</button>
          <span class="qty-value">${item.quantity.toFixed(1)}</span>
          <button class="btn btn-tiny" data-inv-adjust="${item.id}" data-delta="1">＋</button>
          <select class="step-select" data-step-for="${item.id}"><option value="1">1</option><option value="0.1">0.1</option></select>
        </td>
        <td>${item.threshold.toFixed(1)}</td>
      </tr>`).join('');
    document.getElementById('inventory-rows').innerHTML = rows || '<tr><td colspan="5">在庫がありません</td></tr>';
    document.querySelectorAll('[data-inv-adjust]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.invAdjust;
        const step = Number(document.querySelector(`[data-step-for="${itemId}"]`).value);
        const sign = Number(btn.dataset.delta) < 0 ? -1 : 1;
        DB.adjustInventoryQuantity(itemId, sign * step);
        renderInventoryRows();
        renderShoppingRows();
      });
    });
  }

  function renderShoppingRows() {
    let items = DB.listShoppingListItems().map((s) => ({ ...s, item: DB.listInventoryItems().find((i) => i.id === s.inventoryItemId) })).filter((s) => s.item);
    if (shoppingSort === 'name') items.sort((a, b) => a.item.name.localeCompare(b.item.name, 'ja'));
    else if (shoppingSort === 'category') items.sort((a, b) => a.item.categoryId - b.item.categoryId);
    else if (shoppingSort === 'store') items.sort((a, b) => (a.item.storeId || 0) - (b.item.storeId || 0));

    const rows = items.map((s) => `
      <tr>
        <td>${UI.escapeHtml(s.item.name)}</td>
        <td>${UI.escapeHtml((DB.getCategory(s.item.categoryId) || {}).name)}</td>
        <td>${UI.escapeHtml(s.item.storeId ? (DB.getStore(s.item.storeId) || {}).name : '')}</td>
        <td><input type="checkbox" id="chk-${s.id}" /></td>
        <td><input type="number" class="purchase-qty" data-id="${s.id}" value="1" min="0" style="width:60px" /></td>
        <td><button class="btn btn-tiny" data-remove-shopping="${s.id}">✕</button></td>
      </tr>`).join('');
    document.getElementById('shopping-rows').innerHTML = rows || '<tr><td colspan="6">買い物リストは空です</td></tr>';
    document.querySelectorAll('[data-remove-shopping]').forEach((btn) => {
      btn.addEventListener('click', () => { DB.removeShoppingListItem(btn.dataset.removeShopping); renderShoppingRows(); });
    });
  }

  return { render };
})();
