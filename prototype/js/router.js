// ハッシュベースの簡易ルーター
const Router = (() => {
  const PUBLIC_ROUTES = ['#/login', '#/register', '#/reset'];

  const routes = {
    '#/login': () => Auth.renderLogin(),
    '#/register': () => Auth.renderRegister(),
    '#/reset': () => Auth.renderPasswordReset(),
    '#/household': () => Auth.renderHousehold(),
    '#/dashboard': () => Dashboard.render(),
    '#/kakeibo': () => Kakeibo.render(),
    '#/zaiko': () => Zaiko.render(),
    '#/recipes': () => Kondate.renderRecipes(),
    '#/kondate': () => Kondate.renderMenu(),
    '#/settings': () => Settings.render(),
  };

  function currentHash() {
    return window.location.hash || '#/login';
  }

  function navigate(hash) {
    if (window.location.hash === hash) {
      render();
    } else {
      window.location.hash = hash;
    }
  }

  function render() {
    UI.closeAllModals();
    let hash = currentHash();

    if (!DB.state.currentUser && !PUBLIC_ROUTES.includes(hash)) {
      window.location.hash = '#/login';
      return;
    }
    if (DB.state.currentUser && !DB.state.currentUser.householdId && hash !== '#/household') {
      window.location.hash = '#/household';
      return;
    }

    const view = routes[hash] || routes['#/login'];
    view();
    renderNav();
  }

  function renderNav() {
    const nav = document.getElementById('global-nav');
    if (!DB.state.currentUser) {
      nav.innerHTML = '';
      return;
    }
    if (!DB.state.currentUser.householdId) {
      // 世帯グループ未所属でもログアウトできるようにする
      nav.innerHTML = `
        <div class="nav-inner">
          <span class="nav-logo">HomeLog</span>
          <button class="nav-logout" id="btn-logout">ログアウト</button>
        </div>`;
      document.getElementById('btn-logout').addEventListener('click', () => {
        DB.state.currentUser = null;
        navigate('#/login');
      });
      return;
    }
    const current = currentHash();
    const items = [
      ['#/dashboard', 'トップ'],
      ['#/kakeibo', '家計簿'],
      ['#/zaiko', '在庫管理'],
      ['#/kondate', '献立表'],
      ['#/settings', '設定'],
    ];
    nav.innerHTML = `
      <div class="nav-inner">
        <span class="nav-logo">HomeLog</span>
        ${items.map(([hash, label]) => `<a href="${hash}" class="nav-link ${current === hash ? 'is-active' : ''}">${label}</a>`).join('')}
        <button class="nav-logout" id="btn-logout">ログアウト</button>
      </div>`;
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', () => {
      DB.state.currentUser = null;
      navigate('#/login');
    });
  }

  window.addEventListener('hashchange', render);

  return { navigate, render };
})();
