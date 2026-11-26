import { html } from '../util.js';
import { state, siteCfg } from '../store.js';

export function helpView() {
  const wa = String(state.config.whatsapp ?? '').replace(/\D/g, '');
  return { title: 'المساعدة', html: html`
    <h1 tabindex="-1" data-title>المساعدة والتواصل</h1>
    <section class="prose"><h2>كيف يتم الطلب؟</h2>
      <p>تختار القطعة والمقاس، وتسجّل بياناتك، فيُسجَّل طلبك بحالة «بانتظار التأكيد». بعدها تراسلنا على واتساب ليؤكد الموظف التفاصيل وطريقة الدفع والتوصيل.</p>
      <h2>الاستبدال والاسترجاع</h2><p>${siteCfg.returnsPolicy || 'للاستبدال أو الاسترجاع راسلنا على واتساب مع رقم طلبك، وسنرد عليك بالخطوات.'}</p>
      <h2>تواصل معنا</h2>${wa ? html`<p><a class="btn" href="https://wa.me/${wa}" target="_blank" rel="noopener">راسلنا على واتساب</a></p>` : html`<p>سنتواصل معك على الرقم الذي تسجّله في الطلب.</p>`}
      <h2>تتبّع طلب</h2><p><a class="link" href="#/track">افتح صفحة التتبّع</a> وأدخل رقم الطلب وآخر 4 أرقام من موبايلك.</p></section>` };
}
