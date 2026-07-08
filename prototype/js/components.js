// 共通UI部品：モーダル開閉・タブ切り替え・トースト通知
const UI = (() => {
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('is-open');
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('is-open');
  }
  function closeAllModals() {
    document.querySelectorAll('.modal-overlay.is-open').forEach((el) => el.classList.remove('is-open'));
  }
  function toast(message) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 2000);
  }
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  return { openModal, closeModal, closeAllModals, toast, escapeHtml };
})();
