// 起動処理
document.addEventListener('DOMContentLoaded', () => {
  if (!window.location.hash) window.location.hash = '#/login';
  Router.render();
});
