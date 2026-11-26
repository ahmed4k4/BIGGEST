import { api } from '../api.js';
import { h, clear, field, inp, run } from '../ui.js';

export function renderLogin(onDone) {
  const app = document.getElementById('app'); clear(app);
  const user = inp({ type: 'text', autocomplete: 'username', required: true, autofocus: true });
  const pass = inp({ type: 'password', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'notice err', role: 'alert', hidden: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'تسجيل الدخول');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.hidden = true;
    try { btn.disabled = true; await api.login(user.value.trim(), pass.value); onDone(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; pass.select(); }
  } }, h('h1', null, 'تسجيل الدخول'), err, field('اسم المستخدم', user), field('كلمة السر', pass), btn);
  app.append(h('div', { class: 'login' }, h('div', { class: 'login-card' }, h('div', { class: 'tape', 'aria-hidden': 'true' }), h('div', { class: 'login-brand' }, h('img', { src: 'assets/logo-black.png', alt: 'BIGGEST Fashion Collection Men\'s Wear', class: 'logo-on-light' }), h('img', { src: 'assets/logo-white.png', alt: '', class: 'logo-on-dark', 'aria-hidden': 'true' })), form)));
  document.title = 'تسجيل الدخول · BIGGEST';
}
