// S-01 ログイン / S-02 ユーザー登録 / S-03 世帯グループ作成参加 / S-17 パスワードリセット
const Auth = (() => {
  const app = () => document.getElementById('app');

  function renderLogin() {
    app().innerHTML = `
      <div class="center-screen">
        <div class="auth-card">
          <h1 class="logo-title">HomeLog</h1>
          <form id="login-form">
            <label>メールアドレス</label>
            <input type="email" id="login-email" required value="taro@example.com" />
            <label>パスワード</label>
            <input type="password" id="login-password" required value="Passw0rd" />
            <button type="submit" class="btn btn-primary btn-block">ログイン</button>
          </form>
          <p class="error" id="login-error"></p>
          <div class="auth-links">
            <a href="#/reset">パスワードを忘れた場合</a>
            <a href="#/register">新規登録はこちら</a>
          </div>
        </div>
      </div>`;
    document.getElementById('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const user = DB.findUserByEmail(email);
      if (!user || user.password !== password) {
        document.getElementById('login-error').textContent = 'メールアドレスまたはパスワードが違います';
        return;
      }
      const household = DB.getHouseholdByUser(user.id);
      user.householdId = household ? household.id : (user.householdId || null);
      DB.state.currentUser = user;
      Router.navigate('#/dashboard');
    });
  }

  function renderRegister() {
    app().innerHTML = `
      <div class="center-screen">
        <div class="auth-card">
          <h1>新規登録</h1>
          <form id="register-form">
            <label>メールアドレス</label>
            <input type="email" id="reg-email" required />
            <label>パスワード（8文字以上、英字と数字を含む）</label>
            <input type="password" id="reg-password" required minlength="8" />
            <label>表示名</label>
            <input type="text" id="reg-name" required />
            <button type="submit" class="btn btn-primary btn-block">登録する</button>
          </form>
          <p class="error" id="register-error"></p>
          <div class="auth-links">
            <a href="#/login">ログインはこちら</a>
          </div>
        </div>
      </div>`;
    document.getElementById('register-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      const name = document.getElementById('reg-name').value.trim();
      if (!/(?=.*[A-Za-z])(?=.*\d).{8,}/.test(password)) {
        document.getElementById('register-error').textContent = 'パスワードは8文字以上、英字と数字を含めてください';
        return;
      }
      if (DB.findUserByEmail(email)) {
        document.getElementById('register-error').textContent = 'このメールアドレスは既に登録されています';
        return;
      }
      const user = DB.registerUser(email, password, name);
      DB.state.currentUser = user;
      Router.navigate('#/household');
    });
  }

  function renderPasswordReset() {
    app().innerHTML = `
      <div class="center-screen">
        <div class="auth-card">
          <h1>パスワードリセット</h1>
          <div id="reset-step1">
            <label>メールアドレス</label>
            <input type="email" id="reset-email" required />
            <button class="btn btn-primary btn-block" id="btn-reset-send">送信する</button>
          </div>
          <div id="reset-step2" class="hidden">
            <p class="hint">（メール内リンクをクリックした想定の画面です）</p>
            <label>新しいパスワード（8文字以上、英字と数字を含む）</label>
            <input type="password" id="reset-new-password" minlength="8" />
            <button class="btn btn-primary btn-block" id="btn-reset-confirm">変更する</button>
          </div>
          <p class="error" id="reset-error"></p>
          <p class="success" id="reset-message"></p>
          <div class="auth-links"><a href="#/login">ログイン画面へ戻る</a></div>
        </div>
      </div>`;
    let resetEmail = '';
    document.getElementById('btn-reset-send').addEventListener('click', () => {
      resetEmail = document.getElementById('reset-email').value.trim();
      document.getElementById('reset-message').textContent = 'パスワードリセット用のメールを送信しました（該当アカウントが存在する場合）';
      document.getElementById('reset-step1').classList.add('hidden');
      document.getElementById('reset-step2').classList.remove('hidden');
    });
    document.getElementById('btn-reset-confirm').addEventListener('click', () => {
      const newPassword = document.getElementById('reset-new-password').value;
      if (!/(?=.*[A-Za-z])(?=.*\d).{8,}/.test(newPassword)) {
        document.getElementById('reset-error').textContent = 'パスワードは8文字以上、英字と数字を含めてください';
        return;
      }
      const user = DB.findUserByEmail(resetEmail);
      if (user) {
        user.password = newPassword;
      }
      UI.toast('パスワードを変更しました');
      Router.navigate('#/login');
    });
  }

  function renderHousehold() {
    app().innerHTML = `
      <div class="center-screen">
        <div class="auth-card auth-card-wide">
          <h1>世帯グループ</h1>
          <div class="split-two">
            <div>
              <h2>新規作成</h2>
              <label>世帯グループ名</label>
              <input type="text" id="hh-name" value="新しい世帯" />
              <button class="btn btn-primary btn-block" id="btn-hh-create">作成する</button>
            </div>
            <div>
              <h2>既存に参加</h2>
              <label>招待コード</label>
              <input type="text" id="hh-code" value="AB12CD34EF56GH78" />
              <button class="btn btn-secondary btn-block" id="btn-hh-join">参加する</button>
            </div>
          </div>
          <p class="error" id="hh-error"></p>
        </div>
      </div>`;
    document.getElementById('btn-hh-create').addEventListener('click', () => {
      const name = document.getElementById('hh-name').value.trim();
      const household = DB.createHousehold(name, DB.state.currentUser.id);
      DB.state.currentUser.householdId = household.id;
      Router.navigate('#/dashboard');
    });
    document.getElementById('btn-hh-join').addEventListener('click', () => {
      const code = document.getElementById('hh-code').value.trim();
      const household = DB.findHouseholdByInviteCode(code);
      if (!household) {
        document.getElementById('hh-error').textContent = '招待コードが正しくありません';
        return;
      }
      DB.joinHousehold(household, DB.state.currentUser.id);
      DB.state.currentUser.householdId = household.id;
      Router.navigate('#/dashboard');
    });
  }

  return { renderLogin, renderRegister, renderPasswordReset, renderHousehold };
})();
