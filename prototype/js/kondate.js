// S-12 レシピ一覧 / S-13 レシピ登録モーダル / S-14 献立表（週単位の作りたい料理リスト）
const Kondate = (() => {
  const app = () => document.getElementById('app');
  let recipeFilter = 'all';
  let selectedDate = '2026-07-08'; // この日付を含む週の献立リストを表示する

  function renderRecipes() {
    app().innerHTML = `
      <div class="page">
        <div class="toolbar">
          <div class="tabs">
            <button class="tab-btn ${recipeFilter === 'all' ? 'is-active' : ''}" id="tab-all">すべて</button>
            <button class="tab-btn ${recipeFilter === 'favorite' ? 'is-active' : ''}" id="tab-fav">お気に入り</button>
          </div>
          <button class="btn btn-primary" id="btn-open-recipe-modal">レシピを登録</button>
        </div>
        <div class="recipe-grid" id="recipe-grid"></div>
      </div>
      ${recipeModalHtml()}`;
    document.getElementById('tab-all').addEventListener('click', () => { recipeFilter = 'all'; renderRecipes(); });
    document.getElementById('tab-fav').addEventListener('click', () => { recipeFilter = 'favorite'; renderRecipes(); });
    document.getElementById('btn-open-recipe-modal').addEventListener('click', () => UI.openModal('modal-recipe'));
    renderRecipeGrid();
    bindRecipeModal(() => renderRecipeGrid());
  }

  function renderRecipeGrid() {
    const grid = document.getElementById('recipe-grid');
    if (!grid) return;
    const list = DB.listRecipes().filter((r) => recipeFilter === 'all' || r.isFavorite);
    grid.innerHTML = list.map((r) => `
      <div class="recipe-card">
        <div class="recipe-thumb">🍽</div>
        <div class="recipe-title">${UI.escapeHtml(r.title)} <button class="btn-fav" data-fav="${r.id}">${r.isFavorite ? '★' : '☆'}</button></div>
      </div>`).join('') || '<p>レシピがありません</p>';
    document.querySelectorAll('[data-fav]').forEach((btn) => {
      btn.addEventListener('click', () => { DB.toggleFavorite(btn.dataset.fav); renderRecipeGrid(); });
    });
  }

  function recipeModalHtml() {
    return `
      <div class="modal-overlay" id="modal-recipe">
        <div class="modal">
          <h2>レシピを登録</h2>
          <div class="tabs">
            <button class="tab-btn is-active" data-recipe-tab="manual">手動</button>
            <button class="tab-btn" data-recipe-tab="ocr">手書き画像解析</button>
            <button class="tab-btn" data-recipe-tab="web">WEBレシピ</button>
          </div>
          <div id="recipe-tab-manual">
            <label>タイトル</label><input type="text" id="recipe-title" />
            <label>材料</label><textarea id="recipe-ingredients"></textarea>
            <label>手順</label><textarea id="recipe-steps"></textarea>
          </div>
          <div id="recipe-tab-ocr" class="hidden">
            <label>画像アップロード</label><input type="file" />
            <button class="btn btn-secondary" id="btn-ocr-dummy">解析する（ダミー）</button>
            <div id="ocr-result" class="hidden">
              <label>タイトル</label><input type="text" id="ocr-title" value="手書きレシピ（解析結果）" />
              <label>材料</label><textarea id="ocr-ingredients">（解析結果のダミー材料）</textarea>
              <label>手順</label><textarea id="ocr-steps">（解析結果のダミー手順）</textarea>
            </div>
          </div>
          <div id="recipe-tab-web" class="hidden">
            <label>URL</label><input type="text" id="web-url" placeholder="https://..." />
            <button class="btn btn-secondary" id="btn-web-dummy">取得する（ダミー）</button>
            <div id="web-result" class="hidden">
              <p>タイトル: <span id="web-title-preview">WEBレシピ（取得結果）</span></p>
              <label>独自メモ</label><input type="text" id="web-memo" />
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn btn-primary" id="btn-save-recipe">登録する</button>
            <button class="btn btn-secondary" id="btn-cancel-recipe">キャンセル</button>
          </div>
        </div>
      </div>`;
  }

  function bindRecipeModal(onSaved) {
    let currentRecipeTab = 'manual';
    document.querySelectorAll('[data-recipe-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentRecipeTab = btn.dataset.recipeTab;
        document.querySelectorAll('[data-recipe-tab]').forEach((b) => b.classList.toggle('is-active', b === btn));
        ['manual', 'ocr', 'web'].forEach((t) => document.getElementById(`recipe-tab-${t}`).classList.toggle('hidden', t !== currentRecipeTab));
      });
    });
    document.getElementById('btn-ocr-dummy').addEventListener('click', () => document.getElementById('ocr-result').classList.remove('hidden'));
    document.getElementById('btn-web-dummy').addEventListener('click', () => document.getElementById('web-result').classList.remove('hidden'));
    document.getElementById('btn-cancel-recipe').addEventListener('click', () => UI.closeModal('modal-recipe'));
    document.getElementById('btn-save-recipe').addEventListener('click', () => {
      let recipe;
      if (currentRecipeTab === 'manual') {
        recipe = { title: document.getElementById('recipe-title').value || '(無題レシピ)', sourceType: 'manual', ingredients: document.getElementById('recipe-ingredients').value, steps: document.getElementById('recipe-steps').value };
      } else if (currentRecipeTab === 'ocr') {
        recipe = { title: document.getElementById('ocr-title').value || '(手書きレシピ)', sourceType: 'ocr', ingredients: document.getElementById('ocr-ingredients').value, steps: document.getElementById('ocr-steps').value };
      } else {
        recipe = { title: document.getElementById('web-title-preview').textContent, sourceType: 'web', url: document.getElementById('web-url').value, memo: document.getElementById('web-memo').value };
      }
      DB.addRecipe(recipe);
      UI.closeModal('modal-recipe');
      UI.toast('レシピを登録しました');
      if (onSaved) onSaved();
    });
  }

  function renderMenu() {
    app().innerHTML = `
      <div class="page kondate-page">
        <div class="main-area">
          <div id="menu-view-content"></div>
        </div>
        <div class="recipe-panel">
          <h3>レシピ選択 <button type="button" class="btn btn-tiny" id="btn-open-recipe-from-menu">＋レシピ登録</button></h3>
          <input type="text" id="recipe-search" placeholder="検索" />
          <h4>最近使ったレシピ</h4>
          <ul id="recent-recipes"></ul>
          <h4>お気に入り</h4>
          <ul id="fav-recipes"></ul>
          <p class="hint">クリックすると表示中の週の献立リストに追加されます</p>
          <p class="hint"><a href="#/recipes">レシピ一覧をすべて見る</a></p>
        </div>
      </div>
      ${recipeModalHtml()}`;
    renderMenuViewContent();
    renderRecipePanel();
    // 献立表からもレシピを登録できるようにする（S-13 レシピ登録モーダルを共用）
    document.getElementById('btn-open-recipe-from-menu').addEventListener('click', () => UI.openModal('modal-recipe'));
    bindRecipeModal(() => renderMenu());
  }

  function shiftWeek(days) {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    const pad = (n) => String(n).padStart(2, '0');
    selectedDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function weekEndOf(weekStart) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function renderMenuViewContent() {
    const el = document.getElementById('menu-view-content');
    const weekStart = DB.weekStartOf(selectedDate);
    const weekEnd = weekEndOf(weekStart);
    const items = DB.listWeekMenu(weekStart);
    const itemLabel = (m) => m.recipeId
      ? UI.escapeHtml((DB.listRecipes().find((r) => r.id === m.recipeId) || {}).title || '(不明なレシピ)')
      : `${UI.escapeHtml(m.freeTextMemo)}（メモ）`;
    el.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-small" id="week-prev">◀ 前週</button>
        <strong>${weekStart.slice(5).replace('-', '/')} 〜 ${weekEnd.slice(5).replace('-', '/')} の献立</strong>
        <button class="btn btn-small" id="week-next">次週 ▶</button>
      </div>
      <p class="hint">この週に作りたい料理のリストです。曜日への割り当てはありません。右のレシピ選択パネルをクリックするか、下の入力欄からリストに追加できます。</p>
      <ul class="week-menu-list">
        ${items.length ? items.map((m) => `<li>🍽 ${itemLabel(m)} <button class="btn btn-tiny" data-remove-menu="${m.id}">削除</button></li>`).join('') : '<li class="hint">まだ登録がありません</li>'}
      </ul>
      <div class="toolbar" style="margin-top: 12px;">
        <input type="text" id="menu-freetext" placeholder="自由メモで追加（例：魚料理、外食）" />
        <button class="btn btn-secondary" id="btn-add-memo">メモを追加</button>
      </div>`;

    document.getElementById('week-prev').addEventListener('click', () => { shiftWeek(-7); renderMenu(); });
    document.getElementById('week-next').addEventListener('click', () => { shiftWeek(7); renderMenu(); });
    document.querySelectorAll('[data-remove-menu]').forEach((btn) => {
      btn.addEventListener('click', () => {
        DB.removeWeekMenuItem(btn.dataset.removeMenu);
        renderMenu();
      });
    });
    document.getElementById('btn-add-memo').addEventListener('click', () => {
      const memo = document.getElementById('menu-freetext').value.trim();
      if (!memo) {
        UI.toast('メモを入力してください');
        return;
      }
      DB.addWeekMenuItem(weekStart, { freeTextMemo: memo });
      UI.toast('献立リストに追加しました');
      renderMenu();
    });
  }

  function renderRecipePanel() {
    document.getElementById('recent-recipes').innerHTML = DB.listRecipes().slice(-2).map((r) => `<li data-pick="${r.id}">${UI.escapeHtml(r.title)}</li>`).join('');
    document.getElementById('fav-recipes').innerHTML = DB.listRecipes().filter((r) => r.isFavorite).map((r) => `<li data-pick="${r.id}">${UI.escapeHtml(r.title)}</li>`).join('');
    document.querySelectorAll('[data-pick]').forEach((li) => {
      li.addEventListener('click', () => {
        // クリックしたレシピを表示中の週の献立リストへ即時追加する
        DB.addWeekMenuItem(DB.weekStartOf(selectedDate), { recipeId: Number(li.dataset.pick) });
        UI.toast('献立リストに追加しました');
        renderMenu();
      });
    });
  }

  function editDay(dateStr) {
    // 献立は週単位のリストのため、対象日を含む週の献立表を開く
    selectedDate = dateStr;
    renderMenu();
  }

  return { renderRecipes, renderMenu, editDay };
})();
