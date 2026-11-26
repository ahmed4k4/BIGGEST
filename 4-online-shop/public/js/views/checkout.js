import { html, price, num, GOVERNORATES, PAYMENT_LABELS, uuid, normalizeDigits } from '../util.js';
import { state, kv, api, ApiError, cartLines, cartTotal, cartClear, loadAvailability, getUtm } from '../store.js';
import { normalizePhone } from '../shared/phone.js';
import { emptyState } from '../components.js';

const FORM_KEY = 'shop.form.v1';
const saved = () => { try { return JSON.parse(kv.get(FORM_KEY)) ?? {}; } catch { return {}; } };

/** رمز الطلب مرتبط بمحتوى السلة: إعادة الإرسال بنفس السلة تعيد نفس الرمز فلا يتكرر الطلب. */
function tokenFor(lines) {
  const sig = lines.map((l) => `${l.vid}:${l.qty}`).sort().join('|');
  try { const t = JSON.parse(kv.get('shop.token.v1')); if (t?.sig === sig) return t.token; } catch { /* جديد */ }
  const token = uuid(); kv.set('shop.token.v1', JSON.stringify({ sig, token })); return token;
}

export function checkoutView() {
  const lines = cartLines();
  if (!lines.length) return { title: 'إتمام الطلب', html: emptyState('السلة فارغة', 'أضف قطعة إلى السلة أولًا.', html`<a class="btn primary" href="#/">تصفح المنتجات</a>`) };
  const methods = (state.config.paymentMethods ?? ['cod']).filter((m) => PAYMENT_LABELS[m]);
  const closed = state.config.open === false;
  const v = saved();
  const markup = html`
    <h1 tabindex="-1" data-title>إتمام الطلب</h1>
    <div class="cartwrap">
      <form class="cform" data-form="order" novalidate>
        <p class="status-line" id="form-status" role="status"></p>
        <div class="field"><label for="f-name">الاسم</label><input id="f-name" name="name" autocomplete="name" required maxlength="100" value="${v.name ?? ''}"><p class="err" data-err="name"></p></div>
        <div class="field"><label for="f-phone">رقم الموبايل</label><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" required placeholder="01xxxxxxxxx" value="${v.phone ?? ''}"><p class="err" data-err="phone"></p></div>
        <div class="field"><label for="f-gov">المحافظة</label><select id="f-gov" name="governorate" autocomplete="address-level1" required><option value="">اختر المحافظة</option>${GOVERNORATES.map((g) => html`<option ${v.governorate === g ? 'selected' : ''}>${g}</option>`)}</select><p class="err" data-err="governorate"></p></div>
        <div class="field"><label for="f-addr">العنوان بالتفصيل</label><textarea id="f-addr" name="address" rows="3" autocomplete="street-address" required maxlength="300">${v.address ?? ''}</textarea><p class="err" data-err="address"></p></div>
        <fieldset class="field pay"><legend>طريقة الدفع</legend>${methods.map((m, i) => html`<label class="radio"><input type="radio" name="paymentMethod" value="${m}" ${(v.paymentMethod ? v.paymentMethod === m : i === 0) ? 'checked' : ''}> ${PAYMENT_LABELS[m]}</label>`)}
          <p class="hint">لا يُعتبر فتح واتساب أو إرسال رسالة دفعًا. يؤكد الموظف طريقة الدفع معك.</p></fieldset>
        <div class="field"><label for="f-note">ملاحظات (اختياري)</label><textarea id="f-note" name="note" rows="2" maxlength="300">${v.note ?? ''}</textarea></div>
        <label class="check"><input type="checkbox" name="consent"> أوافق على استلام عروض المتجر على رقمي (اختياري)</label>
        <div class="hp" aria-hidden="true"><label>الموقع الإلكتروني<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <p class="warn" id="form-error" role="alert"></p>
        ${closed ? html`<p class="warn">المتجر متوقف مؤقتًا عن استقبال الطلبات.</p>` : ''}
        <button class="btn primary block" type="submit" id="submit" ${closed ? 'disabled' : ''}>تأكيد الطلب · ${price(cartTotal())}</button>
        <p class="hint">بعد التأكيد يُسجَّل طلبك بحالة «بانتظار التأكيد»، ثم تفتح واتساب لإرسال التفاصيل للموظف.</p>
      </form>
      <aside class="csum" aria-label="طلبك"><h2>طلبك</h2><ul class="mini">${lines.map((l) => html`<li><span>${l.model.name} <small>${l.variant.color} · ${l.variant.size}</small> × ${num(l.qty)}</span><b>${price(l.total)}</b></li>`)}</ul>
        <dl><div><dt>المجموع</dt><dd>${price(cartTotal())}</dd></div></dl><a class="link" href="#/cart">تعديل السلة</a></aside>
    </div>`;

  return { title: 'إتمام الطلب', html: markup, bind(root) {
    const form = root.querySelector('form'); const btn = root.querySelector('#submit');
    const status = root.querySelector('#form-status'); const errBox = root.querySelector('#form-error');
    const setErr = (name, msg) => { const el = root.querySelector(`[data-err="${name}"]`); if (el) el.textContent = msg ?? ''; form.elements[name]?.setAttribute('aria-invalid', msg ? 'true' : 'false'); };
    let sending = false;
    form.addEventListener('input', () => { const fd = Object.fromEntries(new FormData(form)); delete fd.website; kv.set(FORM_KEY, JSON.stringify(fd)); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (sending) return;
      errBox.textContent = '';
      const fd = Object.fromEntries(new FormData(form));
      const phone = normalizePhone(fd.phone);
      const problems = {};
      if (fd.name.trim().length < 2) problems.name = 'اكتب اسمك بالكامل.';
      if (!phone) problems.phone = 'اكتب رقم موبايل مصري صحيح، مثل 01012345678.';
      if (!fd.governorate) problems.governorate = 'اختر المحافظة.';
      if (fd.address.trim().length < 6) problems.address = 'اكتب العنوان بالتفصيل (الشارع والمنطقة).';
      for (const n of ['name', 'phone', 'governorate', 'address']) setErr(n, problems[n]);
      const first = Object.keys(problems)[0];
      if (first) { form.elements[first].focus(); return; }

      sending = true; btn.disabled = true; btn.textContent = 'جارٍ إرسال الطلب…';
      const slow = setTimeout(() => { status.textContent = 'الاتصال بطيء. لا تغلق الصفحة، سنكمل الإرسال.'; }, 6000);
      const cur = cartLines();
      try {
        const res = await api('/public/orders', { method: 'POST', timeout: 30000, body: {
          clientToken: tokenFor(cur), paymentMethod: fd.paymentMethod ?? 'cod', note: fd.note || undefined, website: fd.website ?? '', utm: getUtm(),
          customer: { name: fd.name.trim(), phone, address: fd.address.trim(), governorate: fd.governorate, marketingConsent: !!fd.consent },
          lines: cur.map((l) => ({ variantId: l.vid, qty: l.qty })) } });
        kv.set('shop.lastOrder.v1', JSON.stringify({ number: res.number, total: res.total || cartTotal(), at: Date.now(), payment: fd.paymentMethod ?? 'cod', phone, name: fd.name.trim(), address: fd.address.trim(), governorate: fd.governorate,
          lines: cur.map((l) => ({ name: l.model.name, color: l.variant.color, size: l.variant.size, qty: l.qty, unit: l.unit })) }));
        cartClear(); kv.del(FORM_KEY);
        location.hash = `#/done/${encodeURIComponent(res.number)}`;
      } catch (err) {
        const e2 = err instanceof ApiError ? err : new ApiError(0, 'تعذّر الاتصال');
        if (e2.status === 409) {
          const id = /[0-9a-f]{8}-[0-9a-f-]{27}/i.exec(e2.message)?.[0];
          const hit = id ? cur.find((l) => l.vid === id) : null;
          errBox.textContent = hit ? `نفدت الكمية من «${hit.model.name} (${hit.variant.color}، ${hit.variant.size})». راجع السلة وعدّل الكمية.` : 'نفدت كمية أحد الأصناف. راجع السلة.';
          await loadAvailability();
          errBox.insertAdjacentHTML('beforeend', ' <a href="#/cart">فتح السلة</a>');
        } else if (e2.status === 0) errBox.textContent = `${e2.message}. لم يُرسل طلبك بعد، وبياناتك محفوظة. اضغط «تأكيد الطلب» مرة أخرى حين يتحسن الاتصال، ولن يتكرر الطلب.`;
        else if (e2.status === 429) errBox.textContent = 'محاولات كثيرة في وقت قصير. انتظر دقيقة ثم أعد المحاولة.';
        else if (e2.status === 503) { errBox.textContent = 'المتجر متوقف مؤقتًا عن استقبال الطلبات.'; state.config.open = false; }
        else errBox.textContent = e2.message;
        errBox.focus?.();
        btn.disabled = false; btn.textContent = `تأكيد الطلب · ${price(cartTotal())}`;
      } finally { clearTimeout(slow); status.textContent = ''; sending = false; }
    });
    void normalizeDigits;
  } };
}
