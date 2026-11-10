/* SafeCity — скрипти сайту (safecity.in.ua)
 * Підключення в Хорошопі (одне поле, один рядок):
 * <script src="https://cdn.jsdelivr.net/gh/valnuz-ops/safecity-scripts@main/safecity.js" defer></script>
 */

/* ===== Вимикач для перевірки швидкості =====
 * ?sc_off=1 у будь-якій адресі — скрипт не працює до кінця сеансу вкладки; ?sc_off=0 — увімкнути знову */
(function () {
  var m = location.search.match(/[?&]sc_off=([01])/);
  try { if (m) sessionStorage.setItem('sc_off', m[1]); } catch (e) {}
  var off = m ? m[1] === '1' : (function () { try { return sessionStorage.getItem('sc_off') === '1'; } catch (e) { return false; } })();
  if (off) throw new Error('safecity.js вимкнено (sc_off=1)');
})();

/* ===== Загальні налаштування ===== */
var SC_TG_BOT = 'clienttext_bot'; // username Telegram-бота БЕЗ @ (підтвердження замовлень)
var SC_CLIENT_BOT = 'SafeCityUA_bot';          // username клієнтського бота (наявність, менеджер) — для «Знайшли дешевше?»; порожньо = без кнопки Telegram
var SC_PHONE  = '380503941500';     // номер для Viber і WhatsApp (лише цифри, з 380)
// Сторож (блок 20): URL веб-застосунку Google Apps Script з apps-script/health/Code.gs
// (https://script.google.com/macros/s/…/exec). Порожньо — сторож нічого не робить і нічого не надсилає.
var SC_HEALTH_URL = 'https://script.google.com/macros/s/AKfycby4kTm_6M4ZBj5-5dQfYopgYbGslziBpnenbS0dR9q1IGwSHSpOhHvJP6C8bD9RxBpBwA/exec';
// TikTok Pixel (блок 21): ID пікселя з TikTok Events Manager. Порожньо — блок нічого не робить.
var SC_TT_PIXEL = 'DBJI7JJC77U4J2JQPOCG';
// Версія збірки: build.sh підставляє дату й час збірки (UTC) через esbuild --define; без збірки — 'dev'
var SC_BUILD = typeof __SC_BUILD__ !== 'undefined' ? __SC_BUILD__ : 'dev';

/* ===== Ізоляція блоків =====
 * Кожен блок запускається через scModule, а його обробники (таймери, спостерігачі, idle) — через scSafe:
 * помилка в одному блоці пишеться в консоль і не зупиняє решту скрипту. */
function scErr(n, e) {
  try { console.warn('[safecity] блок ' + n + ':', e); } catch (x) {}
  scHealth('блок ' + n, e);
}

/* ===== Сторож: звіт про проблему (блок 20) =====
 * Надсилає на SC_HEALTH_URL: помилку блоку (з scErr) або результат перевірки опорних елементів.
 * Одна й та сама проблема — не частіше разу на добу з одного браузера (localStorage) і не більше
 * 5 звітів за перегляд сторінки. Боти не надсилають. Власні помилки сторожа глушаться тут же —
 * scErr звідси не викликається, тож рекурсії немає. */
var scHealthSent = {}, scHealthCount = 0;
function scHealth(kind, e) {
  try {
    var url = window.SC_HEALTH_URL_TEST || SC_HEALTH_URL;    // SC_HEALTH_URL_TEST — лише для test/health.html
    if (!url || scHealthCount >= 5) return;
    var ua = navigator.userAgent || '';
    if (/bot|crawl|spider|lighthouse|headless/i.test(ua)) return;

    var msg = e && e.message ? (e.name ? e.name + ': ' : '') + e.message : String(e);
    var at = String((e && e.stack) || '').match(/([^\/\s(@]+\.js):(\d+):(\d+)/);   // де саме: файл:рядок:колонка
    if (at) msg += ' @ ' + at[0];
    msg = msg.slice(0, 300);

    var id = kind + '|' + msg, h = 5381;                       // короткий ключ: djb2-хеш
    for (var i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) | 0;
    var key = 'sch:' + (h >>> 0).toString(36);
    if (scHealthSent[key]) return;
    scHealthSent[key] = 1;
    try {
      var last = +localStorage.getItem(key) || 0;
      if (Date.now() - last < 86400000) return;
      localStorage.setItem(key, String(Date.now()));
    } catch (x) {}                                             // localStorage недоступний — лишається ліміт на сторінку
    scHealthCount++;

    var body = JSON.stringify({
      block: kind, msg: msg,
      url: location.origin + location.pathname,
      device: window.innerWidth < 768 ? 'mobile' : 'desktop',
      ua: ua.slice(0, 150), build: SC_BUILD
    });
    // text/plain — «простий» запит без CORS-preflight; Apps Script читає його з e.postData.contents
    var ok = false;
    try { ok = !!(navigator.sendBeacon && navigator.sendBeacon(url, body)); } catch (x) {}
    if (!ok && window.fetch) {
      fetch(url, { method: 'POST', mode: 'no-cors', keepalive: true, body: body,
                   headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(function () {});
    }
  } catch (x) {}
}
function scModule(n, fn) { try { fn(); } catch (e) { scErr(n, e); } }
function scSafe(n, fn) {
  return function () { try { return fn.apply(this, arguments); } catch (e) { scErr(n, e); } };
}
// Після DOMContentLoaded (або одразу, якщо DOM уже готовий — скрипт підключено з defer)
function scReady(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}
// Типовий запуск блоку на картці: коли браузер вільний + повтор через 2 с (Хорошоп дорендерює сторінку).
// Повтор безпечний: кожен init() спершу перевіряє, чи його блок уже є на сторінці.
function scInit(n, init) {
  var f = scSafe(n, init);
  scIdle(function () { f(); setTimeout(f, 2000); });
}

/* ===== Спільні помічники (швидкість) ===== */
// Запуск після повного завантаження сторінки, коли браузер вільний — не заважає основному контенту
function scIdle(fn) {
  var run = function () {
    (window.requestIdleCallback || function (f) { setTimeout(f, 300); })(fn, { timeout: 3000 });
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run);
}

// Запуск fn, коли елемент наближається до екрана (за margin px, типово 400) — товари в блоках підбору
// завантажуються лише тоді, коли покупець до них гортає (менше трафіку на мобільному)
function scNear(el, fn, margin) {
  margin = margin || 400;
  var done = false, t = 0, io = null;
  function stop() {
    done = true;
    window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll);
    if (io) io.disconnect();
  }
  function go() {
    if (done) return;
    stop();
    fn();
  }
  function check() {
    t = 0;
    if (done) return;
    if (!el.isConnected) { stop(); return; }          // блок прибрали зі сторінки — слухачі більше не потрібні
    var r = el.getBoundingClientRect();
    if (r.top < window.innerHeight + margin && r.bottom > -margin) go();
  }
  function onScroll() { if (!t) t = setTimeout(check, 100); }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) go(); }, { rootMargin: margin + 'px 0px' });
    setTimeout(function () { if (!done && el.isConnected) io.observe(el); check(); }, 0);
  } else setTimeout(check, 0);
}

// Дані товару за URL (назва, наявність, ціна, фото). Кешуються в браузері на 1 год,
// тож повторні перегляди карток не завантажують сторінки товарів знову.
// Швидкість: сторінку читаємо потоком і обриваємо, щойно дійшли до наявності
// (мобільна ≈ ¼ сторінки, десктоп ≈ ½); одночасно не більше 2 завантажень;
// після «Купити» / відкриття кошика черга чекає 4 с, щоб кошик Хорошопа вантажився першим.
var scProduct = (function () {
  var TTL = 3600 * 1000, mem = {}, MAXC = 2, active = 0, queue = [], holdUntil = 0, held = 0;
  function read(k) {
    try {
      var v = JSON.parse(localStorage.getItem('scp2:' + k));
      if (v && Date.now() - v.t < TTL) return v.d;
    } catch (e) {}
    return null;
  }
  function write(k, d) {
    try { localStorage.setItem('scp2:' + k, JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('.j-buy-button-add, [class*="buy"], [href*="cart"], .j-cart, [data-cart]');
    if (t) holdUntil = Date.now() + 4000;
  }, true);
  function pump() {
    var wait = holdUntil - Date.now();
    if (wait > 0) {                                   // один відкладений запуск замість таймера на кожен товар у черзі
      if (!held) held = setTimeout(function () { held = 0; pump(); }, wait + 50);
      return;
    }
    while (active < MAXC && queue.length) { active++; queue.shift()(); }
  }
  function decode(s) {
    var t = document.createElement('textarea'); t.innerHTML = s; return t.value;
  }
  // Читаємо HTML до мітки наявності (+ запас), решту не завантажуємо
  function readHead(url) {
    var ctrl = window.AbortController ? new AbortController() : null;
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' }, signal: ctrl && ctrl.signal }).then(function (r) {
      if (!r.body || !r.body.getReader || !window.TextDecoder) return r.text();
      var reader = r.body.getReader(), dec = new TextDecoder('utf-8'), html = '';
      return (function step() {
        return reader.read().then(function (c) {
          if (c.done) return html;
          html += dec.decode(c.value, { stream: true });
          var i = html.indexOf('itemprop="availability"');
          if (i !== -1 && html.length > i + 200) {
            // після abort() cancel() повертає відхилений проміс — гасимо, інакше в консолі
            // «Uncaught (in promise) BodyStreamBuffer was aborted» на кожен товар
            try { ctrl && ctrl.abort(); var c = reader.cancel(); if (c && c.catch) c.catch(function () {}); } catch (e) {}
            return html;
          }
          return step();
        });
      })();
    });
  }
  function parse(html) {
    var m, name = '';
    if ((m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i))) name = decode(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!name && (m = html.match(/property="og:title"\s+content="([^"]*)"/i))) name = decode(m[1]).trim();
    if (!name) return null;
    var av = (html.match(/itemprop="availability"\s+(?:href|content)="([^"]*)"/i) || [])[1] || '';
    var avail = /InStock/i.test(av) ? 'в наявності' : /Limited/i.test(av) ? 'закінчується'
              : /OutOfStock|Discontinued/i.test(av) ? 'немає' : /PreOrder|BackOrder/i.test(av) ? 'під замовлення' : '';
    var pn = parseFloat(((html.match(/itemprop="price"\s+content="([^"]*)"/i) || [])[1] || '').replace(',', '.'));
    var img = (html.match(/property="og:image"\s+content="([^"]*)"/i) || [])[1] || '';
    return { name: name, avail: avail, price: pn ? Math.round(pn).toLocaleString('uk-UA') + ' грн' : '', img: img };
  }
  return function (url) {
    if (mem[url]) return mem[url];
    var cached = read(url);
    if (cached) return (mem[url] = Promise.resolve(cached));
    return (mem[url] = new Promise(function (resolve) {
      queue.push(function () {
        // через then: синхронна помилка fetch теж потрапить у catch, і черга не «зависне» з active++
        Promise.resolve(url).then(readHead).then(function (html) {
          var res = parse(html);
          if (res) write(url, res);
          resolve(res);
        }).catch(function () { resolve(null); }).then(function () { active--; pump(); });
      });
      pump();
    }));
  };
})();

// Характеристики товару: десктопна таблиця або будь-які пари «назва — значення» (мобільна версія).
// Обхід усього DOM — дорогий, а викликають його 7 блоків поспіль; результат тримаємо 1 с
// (повторні init через 2 с і після подій рахують заново). Об'єкт лише для читання.
var scFeatures = (function () {
  var cache = null, at = 0;
  return function () {
    var now = Date.now();
    if (!cache || now - at > 1000) { cache = scFeaturesRead(); at = now; }
    return cache;
  };
})();
function scFeaturesRead() {
  var map = {};
  function add(k, v) {
    k = String(k || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/:$/, '');
    v = String(v || '').replace(/\s+/g, ' ').trim();
    if (k && v && k.length < 80 && !(k in map)) map[k] = v;
  }
  document.querySelectorAll('.product-features__table .product-features__row').forEach(function (r) {
    var th = r.querySelector('th'), td = r.querySelector('td');
    if (th && td) add(th.textContent, td.textContent);
  });
  document.querySelectorAll('tr').forEach(function (r) {
    if (r.children.length === 2) add(r.children[0].textContent, r.children[1].textContent);
  });
  document.querySelectorAll('dt').forEach(function (dt) {
    var dd = dt.nextElementSibling;
    if (dd && dd.tagName === 'DD') add(dt.textContent, dd.textContent);
  });
  document.querySelectorAll('[class*="feature"],[class*="characteristic"],[class*="propert"],[class*="param"]').forEach(function (el) {
    var c = el.children;
    if (c.length === 2 && !c[0].children.length) add(c[0].textContent, c[1].textContent);
  });
  return map;
}
function scGet(map, re) { for (var k in map) if (re.test(k)) return map[k]; return ''; }
// «Немає в наявності» теж містить «в наявності», тому спершу відсіюємо відсутні
function scInStock(avail) {
  if (/немає|нема\b|нет в наличии|відсутн|отсутств|під замовлення|под заказ|очікується|ожидается/i.test(avail)) return false;
  return /в наявності|в наличии|закінчується|заканчивается/i.test(avail);
}

function scDesc() {
  var el = document.querySelector('.product-description') || document.querySelector('[itemprop="description"]') ||
           document.querySelector('[class*="description"]');
  return ((el || {}).textContent || '').replace(/\s+/g, ' ');
}

// Блок з кнопкою «Купити» / ціною (десктоп і мобільна версія) — у порядку пріоритету
var SC_ORDER_SELS = ['.product__section--order', '.product-card--main .product-card__order-box',
                     '.product__section--price', '.product-card--main .product-card__price-box'];

// Куди ставити блоки підказок: після блоку з кнопкою «Купити»
function scAnchor() {
  if (!document.querySelector('[itemtype*="schema.org/Product"]')) return null;
  for (var i = 0; i < SC_ORDER_SELS.length; i++) {
    var el = document.querySelector(SC_ORDER_SELS[i]);
    if (el && el.parentNode) return el;
  }
  return null;
}

// Мовний префікс посилань: /ru/…, /en/… або '' для української
var SC_LANG = /^\/(ru|en)\//.test(location.pathname) ? '/' + location.pathname.split('/')[1] : '';

// Товар у наявності (мітка schema.org на картці): «є» або «закінчується»
var SC_AVAIL_SEL = '[itemprop="availability"][href*="InStock"], [itemprop="availability"][href*="Limited"]';

// Сирий текст h1 (без обрізання — кожен блок нормалізує по-своєму)
function scH1() { return (document.querySelector('h1') || {}).textContent || ''; }

// Артикул з тексту сторінки
function scArt() { return ((document.body.innerText || '').match(/Артикул:?\s*([\w-]+)/) || [])[1] || ''; }

// <style id> один раз на сторінку
function scStyle(id, css) {
  if (document.getElementById(id)) return;
  var s = document.createElement('style');
  s.id = id; s.textContent = css;
  document.head.appendChild(s);
}

// Перше число з рядка, кома як десятковий роздільник: «1,5 А» → 1.5
function scNum(s) { var m = String(s || '').replace(',', '.').match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; }

// Сума з тексту ціни: «2 450,50 грн» → 2450.5
function scSum(text) {
  var m = String(text).replace(/[\s ]/g, '').match(/\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(',', '.')) : 0;
}

// Форма оформлення замовлення (блоки 10, 11)
function scCheckout() { return document.getElementById('checkout-container') || document; }

// Текст обраного пункту <select>
function scOptText(s) { return s && s.selectedIndex >= 0 ? s.options[s.selectedIndex].textContent.trim() : ''; }

/* --- Доставка Новою поштою з Києва (блоки 1 — картка товару, 11 — оформлення) ---
 * Тарифи «Посилки до 30 кг» (між відділеннями, за кожне місце), жовтень 2026 */
var SC_NP = {
  freeFrom: 3000,               // від цієї суми доставка безкоштовна (блок 5)
  maxKg: 30,                    // більше — «вартість уточнимо»
  defaultKg: 1,                 // вага товару, якщо в характеристиках немає «Вага»
  local: [[2, 70], [10, 115], [30, 180]],     // Київ → Київ
  ukraine: [[2, 90], [10, 135], [30, 200]],   // Київ → інші міста
  village: 30,                  // доставка в селище / село
  postomat: 10,                 // доставка в поштомат
  courier: 60,                  // адресна доставка кур'єром (тарифи НП 2026: +60 грн до тарифу відділення)
  insFree: 500, insPct: 0.005,  // оголошена вартість: до 500 грн включно — без доплати, далі 0,5%
  extra: 15,                    // службова надбавка (не показується окремо)
  roundTo: 5
};
// Вага з тексту: «1,5 кг» → 1.5, «800 г» → 0.8; немає — 0
function scKg(s) {
  var m = String(s).replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(кг|kg|г|g)(?![a-zа-яіїєґ])/i);
  if (!m) return 0;
  var v = parseFloat(m[1]);
  return /^(г|g)$/i.test(m[2]) ? v / 1000 : v;
}
// Орієнтовна вартість: вага посилки, сума замовлення, Київ чи ні, доплати (село, кур'єр…); понад 30 кг — 0
function scNpPrice(kg, sum, local, add) {
  var t = local ? SC_NP.local : SC_NP.ukraine, p = 0;
  for (var i = 0; i < t.length; i++) if (kg <= t[i][0]) { p = t[i][1]; break; }
  if (!p) return 0;
  p += add || 0;
  if (sum > SC_NP.insFree) p += sum * SC_NP.insPct;
  p += SC_NP.extra;
  return Math.round(p / SC_NP.roundTo) * SC_NP.roundTo;   // до найближчих 5 грн
}

/* --- Блоки «підберіть до товару» з картками товарів (2, 3, 9, 19) --- */
// Товар із переліку підбору (url відносно мови сайту) → дані для картки, або null, якщо ok(p) відхилив
function scPickLoad(pick, ok) {
  var u = SC_LANG + pick.url;
  return scProduct(u).then(function (p) {
    if (!p || !ok(p)) return null;
    return { url: u, name: p.name, price: p.price, img: p.img, note: pick.note || '' };
  });
}
function scAvailOk(p) { return scInStock(p.avail); }

// Картки товарів зі сторінки каталогу (HTML розділу / фільтра). Блоки 6 і 23.
function scCards(html) {
  var doc = new DOMParser().parseFromString(html, 'text/html');
  return [].filter.call(doc.querySelectorAll('.j-catalog-card'), function (c) {
    return !c.parentElement.closest('.j-catalog-card');
  }).map(function (c) {
    // дві верстки карток Хорошопа: catalogCard-* (більшість розділів) і catalog-card__* (шаблон «Альтернативна енергетика»)
    var a = c.querySelector('.catalogCard-title a, .catalog-card__title a') || c.querySelector('a[href]');
    var img = c.querySelector('img');
    var av = c.querySelector('[class*="availability"], .catalog-card__presence');
    var pr = c.querySelector('.catalogCard-price, .catalog-card__price');
    return {
      url: a ? a.getAttribute('href') : '',
      name: a ? (a.getAttribute('title') || a.textContent).trim() : '',
      img: img ? (img.getAttribute('data-src') || img.getAttribute('src') || '').replace(/\/\d+x\d+l\d+nn0\//, '/310x310l85nn0/') : '',   // 160×160 → 310×310
      avail: av ? av.textContent.replace(/\s+/g, ' ').trim() : '',
      price: pr ? pr.textContent.replace(/\s+/g, ' ').trim() : ''
    };
  });
}

// Товари в наявності зі сторінки розділу (url без мовного префікса).
// НЕ для /filter/-адрес: на запит скрипта Хорошоп віддає замість них сторінку перевірки (challenge) без товарів.
// Кеш у браузері на 1 год — переходи між картками не завантажують розділ знову. Порожню відповідь не кешуємо.
function scCatInStock(url) {
  var k = 'scc1:' + SC_LANG + url, TTL = 3600 * 1000;
  try {
    var v = JSON.parse(localStorage.getItem(k));
    if (v && Date.now() - v.t < TTL) return Promise.resolve(v.d);
  } catch (e) {}
  return fetch(SC_LANG + url, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.text() : ''; })
    .then(function (html) {
      var list = html ? scCards(html).filter(function (p) { return p.url && p.name && scInStock(p.avail); }) : [];
      if (/j-catalog-card/.test(html)) try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), d: list })); } catch (e) {}
      return list;
    })['catch'](function () { return []; });
}

// Картка товару <a>: фото, назва, підпис (якщо є клас c.info), ціна. c — імена класів блоку
function scItem(p, c) {
  var a = document.createElement('a');
  a.className = c.a; a.href = p.url;
  a.innerHTML = (p.img ? '<img class="' + c.img + '" loading="lazy" alt="">' : '') +
    (c.info ? '<span class="' + c.info + '"><span class="' + c.name + '"></span><span class="' + c.note + '"></span></span>'
            : '<span class="' + c.name + '"></span>') +
    '<span class="' + c.price + '"></span>';
  if (p.img) a.querySelector('img').src = p.img;
  a.querySelector('.' + c.name).textContent = p.name;
  if (c.info) a.querySelector('.' + c.note).textContent = p.note;
  a.querySelector('.' + c.price).textContent = p.price;
  return a;
}
// Класи у стилі БЕМ: sc-psu → sc-psu__title, sc-psu__item, …
function scBem(b) {
  var c = {};
  ['title', 'text', 'list', 'img', 'info', 'name', 'note', 'price'].forEach(function (k) { c[k] = b + '__' + k; });
  c.a = b + '__item';
  return c;
}
// Спільні стилі жовтого блоку підбору (2, 3, 19); c.links — рядок посилань під картками
function scPickCss(id, c) {
  var r = '#' + id;
  return r + '{margin:16px 0 0;padding:14px 16px;border:1px solid #f0d58a;border-radius:10px;background:#fffbea;font-size:14px;line-height:1.4}' +
    r + ' .' + c.title + '{font-weight:700;font-size:15px;margin:0 0 4px}' +
    r + ' .' + c.text + '{color:#555;margin:0 0 10px;font-size:13px}' +
    r + ' .' + c.list + '{display:flex;flex-direction:column;gap:8px}' +
    r + ' a.' + c.a + '{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid #e8dcb0;border-radius:8px;background:#fff;color:#1a1a1a;text-decoration:none;transition:border-color .15s}' +
    r + ' a.' + c.a + ':hover{border-color:#2b7de9}' +
    r + ' .' + c.img + '{flex:0 0 48px;width:48px;height:48px;object-fit:contain}' +
    r + ' .' + c.info + '{flex:1;min-width:0}' +
    r + ' .' + c.name + '{font-size:13px;line-height:1.3;display:block}' +
    r + ' .' + c.note + '{font-size:12px;color:#7a828c;display:block;margin-top:2px}' +
    r + ' .' + c.price + '{flex:0 0 auto;font-weight:700;white-space:nowrap}' +
    (c.links ? r + ' .' + c.links + '{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:10px}' +
               r + ' .' + c.links + ' a{font-size:13px;color:#2b7de9;text-decoration:none}' +
               r + ' .' + c.links + ' a:hover{text-decoration:underline}' : '');
}

/* --- Блоки «Підберіть до камери / реєстратора» з посиланнями-фішками (6, 7) --- */
var SC_KIT_CSS =
  '.sc-kit{margin:16px 0 0;padding:14px 16px;border:1px solid #e3e6ea;border-radius:10px;background:#fafbfc;font-size:14px;line-height:1.4}' +
  '.sc-kit__title{font-weight:700;font-size:15px;margin:0 0 10px}' +
  '.sc-kit__row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:8px 0;border-top:1px dashed #e3e6ea}' +
  '.sc-kit__row:first-of-type{border-top:0;padding-top:0}' +
  '.sc-kit__label{flex:0 0 100%;font-weight:600;color:#333}' +
  '.sc-kit__hint{flex:0 0 100%;font-size:12px;color:#7a828c;margin-top:-2px}' +
  '.sc-kit a.sc-chip{display:inline-flex;align-items:center;padding:5px 11px;border:1px solid #cfd5dc;border-radius:16px;background:#fff;color:#1a1a1a;text-decoration:none;white-space:nowrap;transition:border-color .15s,background .15s}' +
  '.sc-kit a.sc-chip:hover{border-color:#2b7de9;background:#f0f6ff}' +
  '.sc-kit label.sc-poe{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#444;cursor:pointer;margin-left:4px}' +
  '.sc-kit label.sc-poe input{margin:0}';
function scKitRow(box, label, hint) {
  var r = document.createElement('div');
  r.className = 'sc-kit__row';
  r.innerHTML = '<div class="sc-kit__label"></div>' + (hint ? '<div class="sc-kit__hint"></div>' : '');
  r.querySelector('.sc-kit__label').textContent = label;
  if (hint) r.querySelector('.sc-kit__hint').textContent = hint;
  box.appendChild(r);
  return r;
}
function scKitChip(r, text, href) {
  var a = document.createElement('a');
  a.className = 'sc-chip'; a.href = href; a.textContent = text;
  r.appendChild(a);
  return a;
}
// Посилання на фільтр Хорошопа: /cat/filter/a=1,2;b=3/ — параметри за алфавітом
function scFilterUrl(cat, params) {
  params = params || {};
  var keys = Object.keys(params).sort();
  var path = SC_LANG + cat;
  if (!keys.length) return path;
  return path + 'filter/' + keys.map(function (k) {
    return k + '=' + [].concat(params[k]).sort(function (a, b) { return a - b; }).join(',');
  }).join(';') + '/';
}


/* =====================================================================
 * 1. Плашка відправки на картці товару
 * ===================================================================== */
scModule(1, function () {
  'use strict';

  var CONFIG = {
    timezone: 'Europe/Kyiv',
    cutoffHour: 15,
    cutoffMinute: 0,
    workDays: [1, 2, 3, 4, 5],
    holidays: [
      '2026-12-25',
      '2027-01-01'
    ],
    countdownHours: 3,
    showDelivery: true,
    deliveryDaysMin: 1,
    deliveryDaysMax: 2,
    deliveryDays: [0, 1, 2, 3, 4, 5, 6],
    onlyInStock: true,
    weekendFrom: { day: 5, hour: 15, minute: 0 },
    weekendTo:   { day: 0, hour: 12, minute: 0 },
    weekendMode: 'soft',
    targetSelectors: SC_ORDER_SELS,
    insertPosition: 'beforebegin',
    texts: {
      today: 'Відправимо сьогодні з Києва',
      tomorrow: 'Відправимо завтра з Києва',
      later: 'Відправимо {day} з Києва',
      delivery: 'Отримаєте орієнтовно {date}',
      countdown: 'Замовте протягом {time}, щоб відправити сьогодні',
      weekendMain: 'Отримаєте орієнтовно {date}',
      weekendSub: 'Замовлення з вихідних відправляємо {day}'
    }
  };

  var DAYS_ACC = [
    'в неділю', 'в понеділок', 'у вівторок', 'в середу',
    'в четвер', 'в п\u2019ятницю', 'в суботу'
  ];
  var MONTHS_GEN = [
    'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
    'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'
  ];
  var WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Старі браузери (вбудований браузер TikTok, старі iOS/Android) не знають
  // 'Europe/Kyiv' (перейменовано з 'Europe/Kiev' у 2022 р.) і кидають RangeError.
  // Тому пробуємо по черзі: Kyiv → Kiev → ручний розрахунок київського часу.
  var TZ_ALIASES = { 'Europe/Kyiv': 'Europe/Kiev', 'Europe/Kiev': 'Europe/Kyiv' };
  function makeDtf(tz) {
    try {
      var f = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
      });
      if (typeof f.formatToParts !== 'function') return null;
      f.formatToParts(new Date());
      return f;
    } catch (e) { return null; }
  }

  // Ручний київський час: UTC+2, літній UTC+3 (остання неділя березня 01:00 UTC
  // → остання неділя жовтня 01:00 UTC, як у ЄС)
  function lastSundayUTC(y, month) {
    var d = new Date(Date.UTC(y, month + 1, 0, 1, 0));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.getTime();
  }
  function kyivManualNow() {
    var t = Date.now(), y = new Date(t).getUTCFullYear();
    var dst = t >= lastSundayUTC(y, 2) && t < lastSundayUTC(y, 9);
    var k = new Date(t + (dst ? 3 : 2) * 3600000);
    return {
      y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate(),
      h: k.getUTCHours(), min: k.getUTCMinutes(),
      dow: k.getUTCDay()
    };
  }

  var dtf = null;                     // Intl.DateTimeFormat дорогий у створенні — один на сторінку
  var dtfFailed = false;
  function getNow() {
    if (!dtf && !dtfFailed) {
      dtf = makeDtf(CONFIG.timezone) || (TZ_ALIASES[CONFIG.timezone] && makeDtf(TZ_ALIASES[CONFIG.timezone]));
      if (!dtf) dtfFailed = true;
    }
    if (!dtf) return kyivManualNow();
    var parts = dtf.formatToParts(new Date());
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    return {
      y: +o.year, m: +o.month, d: +o.day,
      h: (+o.hour) % 24, min: +o.minute,
      dow: WEEKDAY_MAP[o.weekday]
    };
  }

  function weekMinutes(dow, h, m) {
    return ((dow + 6) % 7) * 1440 + h * 60 + m;
  }

  function isWeekendPeriod() {
    if (!CONFIG.weekendMode || !CONFIG.weekendFrom || !CONFIG.weekendTo) return false;
    var now = getNow();
    var cur = weekMinutes(now.dow, now.h, now.min);
    var f = CONFIG.weekendFrom, t = CONFIG.weekendTo;
    var from = weekMinutes(f.day, f.hour, f.minute);
    var to = weekMinutes(t.day, t.hour, t.minute);
    return from <= to ? (cur >= from && cur < to) : (cur >= from || cur < to);
  }

  function shouldHide() {
    return CONFIG.weekendMode === 'hide' && isWeekendPeriod();
  }

  function isWorkDay(dateUTC) {
    var key = dateUTC.getUTCFullYear() + '-' + pad(dateUTC.getUTCMonth() + 1) + '-' + pad(dateUTC.getUTCDate());
    return CONFIG.workDays.indexOf(dateUTC.getUTCDay()) !== -1 &&
           CONFIG.holidays.indexOf(key) === -1;
  }

  function calculate() {
    var now = getNow();
    var day = new Date(Date.UTC(now.y, now.m - 1, now.d));
    var minutesNow = now.h * 60 + now.min;
    var cutoff = CONFIG.cutoffHour * 60 + CONFIG.cutoffMinute;

    if (isWorkDay(day) && minutesNow < cutoff) {
      var left = cutoff - minutesNow;
      return { offset: 0, minutesLeft: left, weekday: day.getUTCDay(), shipDate: new Date(day.getTime()) };
    }

    var offset = 0;
    do {
      day.setUTCDate(day.getUTCDate() + 1);
      offset++;
    } while (!isWorkDay(day) && offset < 14);

    return { offset: offset, weekday: day.getUTCDay(), shipDate: new Date(day.getTime()) };
  }

  function isDeliveryDay(d) {
    var days = CONFIG.deliveryDays;
    return !days.length || days.indexOf(d.getUTCDay()) !== -1;
  }

  function addDeliveryDays(from, n) {
    var d = new Date(from.getTime());
    var added = 0;
    while (added < n) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (isDeliveryDay(d)) added++;
    }
    return d;
  }

  function formatRange(d1, d2) {
    var a = d1.getUTCDate(), b = d2.getUTCDate();
    var m1 = d1.getUTCMonth(), m2 = d2.getUTCMonth();
    if (d1.getTime() === d2.getTime()) return a + ' ' + MONTHS_GEN[m1];
    if (m1 === m2) return a + '\u2013' + b + ' ' + MONTHS_GEN[m1];
    return a + ' ' + MONTHS_GEN[m1] + ' \u2013 ' + b + ' ' + MONTHS_GEN[m2];
  }

  function buildText() {
    var r = calculate();
    var T = CONFIG.texts;
    var out = { main: '', lines: [] };

    var deliveryRange = '';
    if (CONFIG.showDelivery) {
      var min = CONFIG.deliveryDaysMin;
      var max = Math.max(min, CONFIG.deliveryDaysMax);
      deliveryRange = formatRange(
        addDeliveryDays(r.shipDate, min),
        addDeliveryDays(r.shipDate, max)
      );
    }

    if (CONFIG.weekendMode === 'soft' && isWeekendPeriod()) {
      var sub = T.weekendSub.replace('{day}', DAYS_ACC[r.weekday]);
      if (deliveryRange) {
        out.main = T.weekendMain.replace('{date}', deliveryRange);
        out.lines.push(sub);
      } else {
        out.main = sub;
      }
      return out;
    }

    if (r.offset === 0) out.main = T.today;
    else if (r.offset === 1) out.main = T.tomorrow;
    else out.main = T.later.replace('{day}', DAYS_ACC[r.weekday]);

    if (deliveryRange) {
      out.lines.push(T.delivery.replace('{date}', deliveryRange));
    }

    if (r.offset === 0 && r.minutesLeft <= CONFIG.countdownHours * 60) {
      var h = Math.floor(r.minutesLeft / 60);
      var m = r.minutesLeft % 60;
      var time = (h ? h + ' год ' : '') + m + ' хв';
      out.lines.push(T.countdown.replace('{time}', time));
    }
    return out;
  }

  // Той самий розрахунок використовує сторінка оформлення (блок 10)
  window.scShipText = buildText;
  // Орієнтовна дата доставки (YYYY-MM-DD) для Google Customer Reviews (блок 12)
  window.scDeliveryDate = function () {
    var r = calculate();
    var d = addDeliveryDays(r.shipDate, Math.max(CONFIG.deliveryDaysMin, CONFIG.deliveryDaysMax));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  };

  // Вартість доставки одразу на картці (до кошика): «Нова пошта ≈ 105 грн · від 3000 грн — безкоштовно».
  // Вага — з характеристик картки, ціна — зі schema.org; тариф «Київ → інші міста» (блок 11 рахує точніше за містом)
  var dlvLine = null;
  function deliveryLine() {
    if (dlvLine !== null) return dlvLine;
    var pm = document.querySelector('[itemprop="offers"] [itemprop="price"], .product-card__price [itemprop="price"]');
    var price = pm ? parseFloat(pm.getAttribute('content')) : 0;
    if (!price) return '';                                   // ціна ще не намальована — спробуємо наступного разу
    var kg = 0;
    [].some.call(document.querySelectorAll('tr'), function (tr) {
      if (tr.children.length === 2 && /^\s*вага\s*$/i.test(tr.children[0].textContent)) { kg = scKg(tr.children[1].textContent); return kg > 0; }
      return false;
    });
    var free = scNum(SC_NP.freeFrom).toLocaleString('uk-UA');
    if (price >= SC_NP.freeFrom) dlvLine = 'Доставка Новою поштою — <b>безкоштовно</b>';
    else {
      var p = scNpPrice(kg || SC_NP.defaultKg, price, false, 0);
      dlvLine = p ? 'Доставка Новою поштою ≈ ' + p + ' грн · від ' + free + ' грн — безкоштовно'
                  : 'Доставка Новою поштою за тарифами перевізника · від ' + free + ' грн — безкоштовно';
    }
    return dlvLine;
  }

  function render(box) {
    var t = buildText();
    var dl = deliveryLine();
    var html =
      '<span class="ship-info__icon" aria-hidden="true">🚚</span> ' +
      '<strong>' + t.main + '</strong>' +
      t.lines.concat(dl ? [dl] : []).map(function (l) {
        return '<div class="ship-info__sub">' + l + '</div>';
      }).join('');
    // щохвилинне оновлення: не перемальовуємо без змін (зайві мутації будять спостерігачі блоків 1 і 5)
    if (box._scHtml !== html) { box.innerHTML = html; box._scHtml = html; }
  }

  function isMulti(el) {
    var cs = window.getComputedStyle(el);
    var d = cs.display;
    if (d === 'grid' || d === 'inline-grid') return true;
    return (d === 'flex' || d === 'inline-flex') && cs.flexDirection.indexOf('row') === 0;
  }

  function outOfRow(el) {
    var node = el, p;
    while ((p = node.parentElement) && p !== document.body) {
      if (!isMulti(p)) break;
      node = p;
    }
    return node;
  }

  function findRow(el) {
    var n = el, i = 0;
    while ((n = n.parentElement) && i++ < 8) {
      if (isMulti(n)) return n;
    }
    return null;
  }

  function findTarget() {
    var pos = CONFIG.insertPosition;
    for (var i = 0; i < CONFIG.targetSelectors.length; i++) {
      var el = document.querySelector(CONFIG.targetSelectors[i]);
      if (el) {
        if (pos === 'beforebegin' || pos === 'afterend') el = outOfRow(el);
        return { el: el, pos: pos };
      }
    }
    var btns = document.querySelectorAll('button, a, input[type="button"], input[type="submit"]');
    for (var j = 0; j < btns.length; j++) {
      var label = (btns[j].textContent || btns[j].value || '').trim();
      if (/^(купити|в кошик|до кошика|придбати)/i.test(label)) {
        var row = findRow(btns[j]);
        var base = row ? outOfRow(row) : (btns[j].parentElement || btns[j]);
        return { el: base, pos: 'beforebegin' };
      }
    }
    return null;
  }

  function isInStock() {
    if (!CONFIG.onlyInStock) return true;
    var a = document.querySelector('[itemprop="availability"]');
    if (!a) return true;
    var v = a.getAttribute('href') || a.getAttribute('content') || '';
    return /InStock/i.test(v);
  }

  var CSS =
    '#ship-info{box-sizing:border-box;width:100%;flex:0 0 100%;clear:both;margin:12px 0;padding:10px 14px;border-radius:8px;' +
    'background:#f1f8f1;border:1px solid #cfe5cf;font-size:15px;line-height:1.4}' +
    '#ship-info .ship-info__sub{font-size:13px;color:#555;margin-top:2px}';

  function removeBox() {
    var box = document.getElementById('ship-info');
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }

  function mount() {
    if (shouldHide()) { removeBox(); return; }
    var existing = document.getElementById('ship-info');
    if (existing && document.body.contains(existing)) return;
    if (!document.querySelector('.product[itemtype*="schema.org/Product"]')) return;
    if (!isInStock()) return;

    var target = findTarget();
    if (!target) return;

    scStyle('ship-info-style', CSS);
    var box = document.createElement('div');
    box.id = 'ship-info';
    render(box);
    target.el.insertAdjacentElement(target.pos, box);
  }

  function init() {
    var safeMount = scSafe(1, mount);
    safeMount();

    var timer;
    new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(safeMount, 200);
    }).observe(document.body, { childList: true, subtree: true });

    setInterval(scSafe(1, function () {
      if (shouldHide()) { removeBox(); return; }
      var box = document.getElementById('ship-info');
      if (box) render(box);
      else mount();
    }), 60000);
  }

  scReady(scSafe(1, init));
});


/* =====================================================================
 * 2. Картка ДБЖ для роутера без БП у комплекті → пропонуємо БП 12 В 2/3 А
 * ===================================================================== */
scModule(2, function () {
  'use strict';

  var CFG = {
    picks: [
      { url: '/blok-zhyvlennia-krf-1202ps-kraft-12v-2a/', note: '2 А — для більшості роутерів' },
      { url: '/blok-zhyvlennia-krf-1203ps-kraft-12v-3a/', note: '3 А — із запасом: живить роутер і заряджає ДБЖ одночасно' }
    ],
    allUrl: '/bloky-zhyvlennia-12-24-48v/filter/presence=1;tipVikonannja=6;vixdnaNapruga=1;vixdniyStrum=8,11/'
  };

  var C = scBem('sc-psu');
  var CSS = scPickCss('sc-psu', C) +
    '#sc-psu a.sc-psu__all{display:inline-block;margin-top:10px;font-size:13px;color:#2b7de9;text-decoration:none}' +
    '#sc-psu a.sc-psu__all:hover{text-decoration:underline}';

  var langPrefix = SC_LANG;
  var features = scFeatures, get = scGet;

  function needsPsu() {
    var f = features();
    var type = get(f, /^тип (пристрою|устройства)$/);
    if (!/безперебійн|бесперебойн/i.test(type)) return false;

    var vin = get(f, /^вхідна напруга$|^входное напряжение$/);
    if (!/dc|12\s?(в|v)/i.test(vin) || /220|230|240/.test(vin)) return false;

    var title = scH1();
    if (/з блоком живлення|с блоком питания/i.test(title)) return false;

    var desc = scDesc();
    var kit = (desc.match(/Комплектаці[^.]{0,200}/i) || [''])[0];
    if (/блок живлення (не входить|окремо)|без блока живлення|блок питания не входит/i.test(desc)) return true;
    if (/блок живлення|блок питания|адаптер/i.test(kit)) return false;
    return true;
  }

  // тут ховаємо лише «немає»; «під замовлення» показуємо (на відміну від блоків 3 і 19)
  function loadProduct(pick) {
    return scPickLoad(pick, function (p) { return !/немає|нет в наличии/i.test(p.avail); });
  }

  function init() {
    if (document.getElementById('sc-psu')) return;
    var anchor = scAnchor();
    if (!anchor || !needsPsu()) return;

    scStyle('sc-psu-style', CSS);
    var box = document.createElement('div');
    box.id = 'sc-psu';
    box.innerHTML =
      '<div class="sc-psu__title">⚡ Блок живлення не входить у комплект</div>' +
      '<div class="sc-psu__text">Для роботи ДБЖ потрібен адаптер 12 В на 2–3 А. Якщо старий БП роутера має менший струм — краще взяти новий.</div>' +
      '<div class="sc-psu__list"></div>' +
      '<a class="sc-psu__all" href="' + langPrefix + CFG.allUrl + '">Усі блоки живлення 12 В 2–3 А →</a>';
    anchor.parentNode.insertBefore(box, anchor.nextSibling);

    var list = box.querySelector('.sc-psu__list');
    scNear(box, function () { Promise.all(CFG.picks.map(loadProduct)).then(function (items) {
      items.filter(Boolean).forEach(function (p) { list.appendChild(scItem(p, C)); });
      if (!list.children.length) list.remove();
    }); });
  }

  scInit(2, init);
});


/* =====================================================================
 * 3. Картки інверторів і ДБЖ 12-24V → підбір АКБ
 * ===================================================================== */
scModule(3, function () {
  'use strict';

  // Кандидати йдуть у порядку пріоритету; показуються перші MAX, що є в наявності.
  var MAX = 3;
  var P = {
    // Інвертори
    inv12: [
      { url: '/akumuliatorna-batareia-12.8v-100ah-lifepo4-cyclen/' },
      { url: '/akumuliatorna-batareia-lfp-12v100ah-lifepo4-trinix-litii-zalizo-fosfatna/' },
      { url: '/akumuliatorna-batareia-litime-lifepo4-12v100ah-xtramini-bluetooth-l12v100-100-xtra-mini-bt-4-a55-litime/' },
      { url: '/akumuliatorna-batareia-power-queen-lifepo4-12v100ah-low-temp-p12v100-100-ltp-4-a100-power-queen/' }
    ],
    inv24: [
      { url: '/akumuliatorna-batareia-sk-25.6v100ah-li-sun-series-lifepo4-sako/' },
      { url: '/akumuliatorna-batareia-power-queen-lifepo4-24v100ah-bluetooth-p24v100-100-basic-bt-8-a160-power-queen/' },
      { url: '/akumuliatorna-batareia-litii-zalizo-fosfatna-z-bluetooth-25-6v-100a-hod-lifepo4-litime-l24/' },   // LiTime L24V100 BT (24309)
      { url: '/akkumuliatorna-batareia-litime-lifepo4-lt24v100/' },
      { url: '/akumuliatorna-batareia-100-ah-24v-tlfp-24100-ultra-lifepo4-trinix/' }
    ],
    inv48: [
      { url: '/akumuliatorna-batareia-lv-bat-w5.12ac-51.2v-100ah-lithium-valley/' },
      { url: '/akumuliatorna-batareia-litime-lifepo4-51.2v100ah-communication-l51.2v100-100-com-16-s3u-litime/' },
      { url: '/akumuliatorna-batareia-power-queen-lifepo4-51.2v100ah-communication-p51.2v100-100-com-16-s3u-power-queen/' },
      { url: '/akumuliatorna-batareia-v10-classic-voltsmile/' }
    ],
    // ДБЖ 12-24V: відсік під АКБ 7 А·год
    ups7lead: [
      { url: '/akumuliatorna-batareia-12v7.2ah-20hr-trinix-svyntsevo-kyslotna/' },
      { url: '/akumuliatorna-batareia-12v9ah-20hr-trinix-super-charge-svyntsevo-kyslotna/', note: '9 А·год — той самий розмір, що й 7 А·год' },
      { url: '/akumuliatorna-batareia-12v7.2ah-20hr-kraft-svyntsevo-kyslotna/' },
      { url: '/akumuliatorna-batareia-12v7ah-20hr-f2-kraft-svyntsevo-kyslotna/' },
      { url: '/akumuliatorna-batareia-tgl12v7.2ah-20hr-trinix-gel/' },
      { url: '/akumuliatorna-batareia-tgl12v9ah-20hr-trinix-gel-super-charge/', note: '9 А·год — той самий розмір, що й 7 А·год' }
    ],
    ups7lfp: [
      { url: '/akumuliatorna-batareia-litii-zalizo-fosfatna-12.8v-9.2ahod-trinix-tlfp-1209-ultra-lifepo4/', note: 'LiFePO4: легша і служить довше. Джампер ДБЖ — на 14 В' },
      { url: '/akumuliatorna-batareia-lfp-12v6ah-lifepo4-trinix-litii-zalizo-fosfatna/', note: 'LiFePO4: легша і служить довше. Джампер ДБЖ — на 14 В' }
    ],
    // ДБЖ 12-24V: відсік під АКБ 18 А·год
    ups18lead: [
      { url: '/akumuliatorna-batareia-12v18ah-20hr-trinix-svyntsevo-kyslotna/' },
      { url: '/akumuliatorna-batareia-tgl12v18ah-20hr-trinix-gel/' }
    ],
    ups18lfp: [
      { url: '/akumuliatorna-batareia-18-ah-12v-tlfp-1218-ultra-lifepo4-trinix/', note: 'LiFePO4: легша і служить довше. Джампер ДБЖ — на 14 В' }
    ]
  };
  var LINKS = {
    leadAll: { text: 'Усі AGM та GEL акумулятори →', url: '/akumuliatory-dlia-dbzh/filter/tipAkumuljatora=2,4/' },
    lfpAll:  { text: 'Усі LiFePO4 акумулятори →',    url: '/akumuliatory-dlia-dbzh/filter/tipAkumuljatora=3/' },
    cables:  { text: 'Кабелі для з’єднання АКБ →',  url: '/avtonomne-zhyvlennia/filter/tipPristrou=85/' }
  };

  var C = scBem('sc-akb');
  C.links = 'sc-akb__links';
  var CSS = scPickCss('sc-akb', C);

  var langPrefix = SC_LANG;
  var features = scFeatures, get = scGet;

  function detect() {
    var f = features();
    var type = get(f, /^тип (пристрою|устройства)$/);
    var title = scH1();
    var desc = scDesc();

    // --- Інвертор ---
    if (/інвертор|инвертор/i.test(type)) {
      if (/вбудован/i.test(title)) return null;
      var bat = get(f, /^напруга акумуляторної батареї$/);
      var nums = (bat.match(/\d+(\.\d+)?/g) || []).map(parseFloat);
      if (!nums.length || Math.max.apply(null, nums) > 70) return null;
      var v = Math.max.apply(null, nums);
      if (v <= 14) return {
        list: P.inv12, links: [LINKS.lfpAll, LINKS.cables],
        title: 'Підберіть акумулятор 12 В',
        text: 'Інвертор працює від АКБ 12 В. LiFePO4 12,8 В / 100 А·год ≈ 1,28 кВт·год запасу.'
      };
      if (v <= 30) return {
        list: P.inv24, links: [LINKS.lfpAll, LINKS.cables],
        title: 'Підберіть акумулятор 24 В',
        text: 'Потрібна АКБ 24 В: LiFePO4 25,6 В або дві однакові АКБ 12 В, з’єднані послідовно.'
      };
      return {
        list: P.inv48, links: [LINKS.lfpAll, LINKS.cables],
        title: 'Підберіть акумулятор 48 В',
        text: 'Потрібна АКБ 48 В (LiFePO4 51,2 В). Для роботи з BMS перевірте, чи є батарея у списку сумісності інвертора — підкажемо.'
      };
    }

    // --- ДБЖ 12-24V (бокс або плата) ---
    var board = /плата/i.test(type) || /^плата/i.test(title.trim()) || /PSU-\S*DIN/i.test(title);
    if (/безперебійн|бесперебойн/i.test(type) && /PSU-/i.test(title) &&
        (board || /купується окремо|не входить|підключається окремо/i.test(desc))) {
      var lfp = /LiFePO4/i.test(title) || /літій-залізо-фосфатні/i.test(desc);
      var cap = get(f, /^ємність акумулятора$/);
      var two = /2\s*шт/i.test(cap);
      var slot = parseFloat(cap) || parseFloat((desc.match(/12 В \/ (\d+) А·год/) || [])[1]) || 0;
      var list, links;

      if (board && !slot) {
        list = lfp
          ? [P.ups7lead[0], P.ups7lfp[0], P.ups18lfp[0], P.ups18lead[0], P.ups7lead[1]]
          : [P.ups7lead[0], P.ups7lead[1], P.ups18lead[0]].concat(P.ups7lead.slice(2), P.ups18lead.slice(1));
      } else if (slot >= 15) {
        list = lfp ? P.ups18lead.concat(P.ups18lfp) : P.ups18lead;
      } else {
        list = lfp ? [P.ups7lead[0], P.ups7lfp[0], P.ups7lead[1], P.ups7lfp[1]].concat(P.ups7lead.slice(2)) : P.ups7lead;
      }
      links = lfp ? [LINKS.leadAll, LINKS.lfpAll] : [LINKS.leadAll];

      var text = board && !slot
        ? 'Плата ставиться на DIN-рейку, акумулятор 12 В розміщується поруч — ємність обирайте під навантаження.'
        : 'У боксі є місце під АКБ 12 В / ' + slot + ' А·год' + (two ? ' — потрібно 2 шт.' : '') + '.';
      if (lfp) text += ' Підтримує свинцево-кислотні та LiFePO4 АКБ.';
      else text += ' Підходять свинцево-кислотні АКБ (AGM або GEL).';

      return { list: list, links: links, title: '🔋 Акумулятор не входить у комплект', text: text, slot: slot, lfp: lfp };
    }
    return null;
  }

  function loadProduct(pick) { return scPickLoad(pick, scAvailOk); }

  // Завантажуємо кандидатів по 3 і зупиняємось, щойно набрали MAX у наявності
  function pickInStock(list, cb) {
    var found = [], i = 0;
    (function next() {
      if (found.length >= MAX || i >= list.length) return cb(found.slice(0, MAX));
      var batch = list.slice(i, i + 3); i += 3;
      Promise.all(batch.map(loadProduct)).then(function (res) {
        res.forEach(function (p) { if (p && found.length < MAX) found.push(p); });
        next();
      });
    })();
  }

  function init() {
    if (document.getElementById('sc-akb')) return;
    var anchor = scAnchor();
    if (!anchor) return;
    var cfg = detect();
    if (!cfg) return;

    scStyle('sc-akb-style', CSS);
    var box = document.createElement('div');
    box.id = 'sc-akb';
    box.innerHTML = '<div class="sc-akb__title"></div><div class="sc-akb__text"></div><div class="sc-akb__list"></div><div class="sc-akb__links"></div>';
    box.querySelector('.sc-akb__title').textContent = cfg.title;
    box.querySelector('.sc-akb__text').textContent = cfg.text;
    var linksEl = box.querySelector('.sc-akb__links');
    cfg.links.forEach(function (l) {
      var a = document.createElement('a'); a.href = langPrefix + l.url; a.textContent = l.text; linksEl.appendChild(a);
    });
    var after = document.getElementById('sc-psu') || anchor;
    after.parentNode.insertBefore(box, after.nextSibling);

    var listEl = box.querySelector('.sc-akb__list');
    scNear(box, function () { pickInStock(cfg.list, function (items) {
      items.forEach(function (p) { listEl.appendChild(scItem(p, C)); });
      if (!listEl.children.length) listEl.remove();
      // Для калькулятора автономності (блок 8): ті самі сумісні АКБ у наявності
      if (cfg.slot !== undefined) {
        window.scAkb = { items: items, slot: cfg.slot, lfp: cfg.lfp };
        document.dispatchEvent(new CustomEvent('sc-akb'));
      }
    }); });
  }

  scInit(3, init);
});


/* =====================================================================
 * 4. Сторінка «Ваше замовлення отримано» → кнопка підтвердження в Telegram
 * ===================================================================== */
scModule(4, function () {
  'use strict';
  if (!/checkout.*complete|complete.*order/i.test(location.pathname)) return;

  // Номер замовлення: «замовлення №123», «Номер замовлення: 123», «№ 123» (мобільна тема пише інакше)
  function findNum() {
    var t = (document.body && document.body.innerText) || '';
    var m = t.match(/замовлен\S*\s*(?:№|#|N\s*[o°]?)?\s*(\d{3,10})/i) ||
            t.match(/номер\S*\s*(?:вашого\s*)?замовлен\S*\s*[:№#]?\s*(\d{3,10})/i) ||
            t.match(/№\s*(\d{4,10})/);
    return m ? m[1] : null;
  }

  // Перший ВИДИМИЙ h1; у мобільній темі h1 немає — тоді напис «Ваше замовлення отримано»
  function anchor() {
    var hs = document.querySelectorAll('h1');
    for (var i = 0; i < hs.length; i++) if (hs[i].offsetParent !== null) return hs[i];
    var els = document.querySelectorAll('h2,h3,div,p,span,strong');
    for (var j = 0; j < els.length; j++) {
      var e = els[j];
      if (e.children.length === 0 && e.offsetParent !== null &&
          /^\s*ваше замовлення отримано/i.test(e.textContent)) return e;
    }
    return null;
  }

  // Ширина — як у картки замовлення під блоком (на десктопі вона вужча за 1100 px)
  function fitWidth(box) {
    var next = box.nextElementSibling;
    while (next && !next.offsetWidth) next = next.nextElementSibling;
    if (next && next.offsetWidth > 200) box.style.maxWidth = next.offsetWidth + 'px';
  }

  function inject() {
    if (document.getElementById('sc-tg')) return true;
    var num = findNum();
    if (!num) return false;

    var msg = 'Добрий день! Підтверджую замовлення №' + num + ' на сайті SafeCity.';
    var btn = 'display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:1 1 180px;max-width:240px;' +
              'color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-size:16px;font-weight:600;box-sizing:border-box';
    var box = document.createElement('div');
    box.id = 'sc-tg';
    box.style.cssText = 'margin:0 0 24px;padding:18px;border:1px solid #d6ecf8;border-radius:12px;background:#f3faff;text-align:center;max-width:1100px;box-sizing:border-box';
    box.innerHTML =
      '<div style="font-size:17px;font-weight:600;margin-bottom:6px">Підтвердіть замовлення №' + num + ' в один клік</div>' +
      '<div style="font-size:14px;color:#555;margin-bottom:14px">Без дзвінка менеджера — оберіть зручний месенджер</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center">' +
        '<a href="https://t.me/' + SC_TG_BOT + '?start=order_' + num + '" target="_blank" rel="noopener" style="' + btn + ';background:#2AABEE">✈️ Telegram</a>' +
        '<a href="viber://chat?number=%2B' + SC_PHONE + '&draft=' + encodeURIComponent(msg) + '" style="' + btn + ';background:#7360F2">📞 Viber</a>' +
        '<a href="https://wa.me/' + SC_PHONE + '?text=' + encodeURIComponent(msg) + '" target="_blank" rel="noopener" style="' + btn + ';background:#25D366">💬 WhatsApp</a>' +
      '</div>';

    var h1 = anchor();
    if (h1 && h1.parentNode) h1.parentNode.insertBefore(box, h1.nextSibling);
    else (document.querySelector('main') || document.body).prepend(box);
    fitWidth(box);
    window.addEventListener('resize', function () { fitWidth(box); });
    return true;
  }

  function start() {
    if (inject()) return;
    // inject() читає body.innerText (перерахунок макета) — не частіше ніж раз на 100 мс, а не на кожну мутацію
    var t = 0, done = false;
    var obs = new MutationObserver(function () {
      if (t || done) return;
      t = setTimeout(scSafe(4, function () { t = 0; if (!done && inject()) { done = true; obs.disconnect(); } }), 100);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { done = true; obs.disconnect(); }, 60000);
  }

  scReady(scSafe(4, start));
});


/* =====================================================================
 * 5. Кошик і оформлення → прогрес до безкоштовної доставки (від 3000 грн)
 * ===================================================================== */
scModule(5, function () {
  'use strict';

  /* ================= НАСТРОЙКИ ================= */
  var CONFIG = {
    threshold: 3000,                      // бесплатная доставка от этой суммы (грн)
    cartSelector: '#cart',                // окно корзины
    totalSelector: '.j-total-sum',        // элемент с итоговой суммой внутри корзины
    // Перед каким элементом вставлять блок (берётся первый найденный):
    // .cart-summary / .cart-footer - корзина на десктопе,
    // .order-details__cost - страница оформления заказа в мобильной версии,
    // .order-summary - страница оформления заказа на десктопе.
    // Если ничего не найдено, блок вставляется прямо перед итоговой суммой.
    insertBeforeSelectors: ['.cart-summary', '.order-details__cost', '.order-summary', '.cart-footer'],
    texts: {
      remaining: 'До безкоштовної доставки залишилось <strong>{sum} грн</strong>',
      reached: '🎉 Доставка безкоштовна'
    },
    colors: {
      bar: '#17b260',                     // цвет полосы прогресса
      track: '#e3e8e5',                   // цвет подложки
      bg: '#f1f8f1',                      // фон блока
      border: '#cfe5cf'
    }
  };
  /* ============================================== */

  var parseSum = scSum;

  function fmt(n) {
    return Math.ceil(n).toLocaleString('uk-UA');
  }

  var c = CONFIG.colors;
  var CSS =
    '#free-ship{box-sizing:border-box;margin:12px 0;padding:10px 14px;border-radius:8px;' +
    'background:' + c.bg + ';border:1px solid ' + c.border + ';font-size:15px;line-height:1.4}' +
    '#free-ship .free-ship__track{height:8px;margin-top:8px;border-radius:4px;' +
    'background:' + c.track + ';overflow:hidden}' +
    '#free-ship .free-ship__bar{height:100%;border-radius:4px;background:' + c.bar + ';' +
    'transition:width .3s ease}';

  function findAnchor(cart) {
    for (var i = 0; i < CONFIG.insertBeforeSelectors.length; i++) {
      var el = cart.querySelector(CONFIG.insertBeforeSelectors[i]);
      if (el && el.parentNode) return el;
    }
    return null;
  }

  function update() {
    var cart = document.querySelector(CONFIG.cartSelector);
    if (!cart) return;

    var totalEl = cart.querySelector(CONFIG.totalSelector);
    if (!totalEl) return;

    var box = cart.querySelector('#free-ship');
    var sum = parseSum(totalEl.textContent);

    // Пустая корзина - блок не нужен
    if (sum <= 0) {
      if (box) box.parentNode.removeChild(box);
      return;
    }

    var anchor = findAnchor(cart) || totalEl;
    if (!anchor || !anchor.parentNode) return;

    scStyle('free-ship-style', CSS);
    if (!box) {
      box = document.createElement('div');
      box.id = 'free-ship';
      anchor.parentNode.insertBefore(box, anchor);
    }

    var pct = Math.min(100, Math.round(sum / CONFIG.threshold * 100));
    var text = sum >= CONFIG.threshold
      ? CONFIG.texts.reached
      : CONFIG.texts.remaining.replace('{sum}', fmt(CONFIG.threshold - sum));

    var html = '<div>' + text + '</div>' +
      '<div class="free-ship__track"><div class="free-ship__bar" style="width:' + pct + '%"></div></div>';

    // Обновляем только при изменении, чтобы не зациклить наблюдатель
    if (box.getAttribute('data-state') !== html) {
      box.innerHTML = html;
      box.setAttribute('data-state', html);
    }
  }

  function init() {
    var safeUpdate = scSafe(5, update);
    safeUpdate();

    // Корзина перерисовывается через AJAX (иногда целиком), поэтому следим за всей страницей.
    // update() ничего не меняет, если текст блока не изменился - зацикливания нет.
    var timer;
    new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(safeUpdate, 150);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  scReady(scSafe(5, init));
});


/* =====================================================================
 * 6. Картка відеокамери → «Підберіть до цієї камери» (реєстратори того ж бренду: TVT, Hikvision, Dahua, Ajax)
 *    + камери зі слотом microSD: карти пам’яті в наявності (до макс. обсягу камери, спершу для відеоспостереження)
 * ===================================================================== */
scModule(6, function () {
  'use strict';

  var CFG = {
    nvrCat: '/videoreiestratory/',
    nvrTypeIP: [47],               // NVR-відеореєстратор
    nvrTypeAnalog: [66],           // MHD-відеореєстратор
    tvt: 101, ajax: 96,
    // реєстратори пропонуємо лише того ж бренду, що й камера; інші бренди (Light Vision, IMOU, Ezviz…) — без рядка «Відеореєстратор»
    nvrBrands: [[/\btvt\b/i, 101, 'TVT'], [/hikvision/i, 131, 'Hikvision'], [/dahua/i, 135, 'Dahua']],
    // [кількість каналів, ID значення фільтра «Кількість каналів IP»]
    channels:     [[4, 5], [8, 1], [16, 2], [32, 4]],
    channelsAjax: [[8, 1], [16, 2]],
    switches: '/komutatory/',
    psu: '/bloky-zhyvlennia-12-24-48v/', psu12: 1,
    utp: '/kabel-vyta-para/2348/',
    coax: '/koaksialnyi-kabel/',
    connectors: '/patch-kordy/2378/',
    storage: '/nakopychuvachi/2297/', sd: 151
  };

  var url = scFilterUrl;   // Хорошоп: /cat/filter/a=1,2;b=3/ — параметри за алфавітом

  function init() {
    if (document.getElementById('sc-cam')) return;
    var anchor = scAnchor();
    if (!anchor) return;

    var f = scFeatures();
    var type = scGet(f, /^тип (пристрою|устройства)$/);
    if (!/відеокамер|видеокамер/i.test(type) || /web/i.test(type)) return;

    var title    = scH1();
    var isAnalog = /hdtvi|hdcvi|ahd|mhd|аналог/i.test(type);
    var poe      = /так|да|yes/i.test(scGet(f, /^poe$/));
    var power    = scGet(f, /^(живлення|питание)$/);
    var wireless = /бездрот|беспровод|wi-?fi/i.test(scGet(f, /^(підключення|подключение)$/));
    // «Карта пам'яті»: у фільтрі Так/Ні, у старих картках — текст («microSD до 256 ГБ»)
    var sdVal    = scGet(f, /^карта пам/);
    var hasSD    = /так|да|yes|sd|карт|\d\s?(гб|gb|тб|tb)/i.test(sdVal) && !/^(ні|нет|no|відсутн|отсутств)/i.test(sdVal);
    var isAjax   = /ajax/i.test(title);
    var brandTxt = scGet(f, /^(бренд|виробник|производитель|торгова марка)$/);
    // бренд реєстратора = бренд камери: спершу за характеристикою «Бренд», потім за назвою
    var nvrBrand = null;
    CFG.nvrBrands.some(function (b) { if (b[0].test(brandTxt)) { nvrBrand = b; return true; } });
    if (!nvrBrand && !brandTxt) CFG.nvrBrands.some(function (b) { if (b[0].test(title)) { nvrBrand = b; return true; } });

    scStyle('sc-kit-style', SC_KIT_CSS);
    var box = document.createElement('div');
    box.id = 'sc-cam'; box.className = 'sc-kit';
    box.innerHTML = '<div class="sc-kit__title">Підберіть до цієї камери</div>';

    function row(label, hint) { return scKitRow(box, label, hint); }
    var chip = scKitChip;

    // 1. Відеореєстратор — лише того ж бренду (Ajax → Ajax NVR, TVT → TVT, Hikvision → Hikvision, Dahua → Dahua)
    if (!isAjax && !nvrBrand) {
      // реєстраторів іншого бренду не пропонуємо
    } else if (isAnalog) {
      if (!isAjax) {
        var ar = row('Відеореєстратор', 'Аналогові HD-камери ' + nvrBrand[2] + ' — з MHD-реєстраторами ' + nvrBrand[2]);
        chip(ar, 'Реєстратори ' + nvrBrand[2] + ' →', url(CFG.nvrCat, { brand: nvrBrand[1], tipPristrou: CFG.nvrTypeAnalog }));
      }
    } else {
      var nr = row('Відеореєстратор', isAjax
        ? 'Для камер Ajax — реєстратори Ajax NVR. Оберіть кількість камер:'
        : 'Реєстратори ' + nvrBrand[2] + '. Скільки камер плануєте підключити?');
      var chips = (isAjax ? CFG.channelsAjax : CFG.channels).map(function (c) {
        return { id: c[1], el: chip(nr, 'до ' + c[0] + ' камер', '#') };
      });

      var poeBox = null;
      if (poe && !isAjax && !wireless) {
        var lbl = document.createElement('label');
        lbl.className = 'sc-poe';
        lbl.innerHTML = '<input type="checkbox" checked> з вбудованим PoE';
        nr.appendChild(lbl);
        poeBox = lbl.querySelector('input');
      }
      var refresh = function () {
        chips.forEach(function (c) {
          var p = isAjax ? { brand: CFG.ajax } : { brand: nvrBrand[1], tipPristrou: CFG.nvrTypeIP };
          if (poeBox && poeBox.checked) p.poe = 1;
          p.klkstKanalvIp = c.id;
          c.el.href = url(CFG.nvrCat, p);
        });
      };
      if (poeBox) poeBox.addEventListener('change', refresh);
      refresh();
    }

    // 2. Живлення
    if (!isAnalog && poe && !wireless) {
      var pr = row('Живлення', 'PoE-комутатор потрібен, якщо реєстратор без PoE або камер більше, ніж PoE-портів');
      chip(pr, 'PoE-комутатори →', url(CFG.switches, { poe: 1, presence: 1 }));
    }
    if (/12\s?(в|v)/i.test(power) && (!poe || isAnalog || wireless)) {
      var pr2 = row('Живлення', 'Камера живиться від 12 В');
      chip(pr2, 'Блоки живлення 12 В →', url(CFG.psu, { presence: 1, vixdnaNapruga: CFG.psu12 }));
    }

    // 3. Кабель і роз'єми
    if (!wireless) {
      var cr = row('Кабель і роз’єми');
      if (isAnalog) chip(cr, 'Коаксіальний кабель →', url(CFG.coax, { presence: 1 }));
      else chip(cr, 'Вита пара →', url(CFG.utp, { presence: 1 }));
      chip(cr, 'Роз’єми та патч-корди →', url(CFG.connectors, { presence: 1 }));
    }

    // 4. Карта пам'яті (якщо в камері є слот) → карти, які є в наявності, у межах обсягу камери
    if (hasSD) {
      var maxKnown = sdMaxGB(f), maxGB = maxKnown || SD_DEFAULT_MAX;
      var sr = row('Запис на камеру', 'Камера може писати на microSD без реєстратора' +
        (maxKnown ? ' (карти до ' + gbText(maxKnown) + ')' : ''));
      var sdList = document.createElement('div');
      sdList.className = SD.list;
      sr.appendChild(sdList);
      chip(sr, 'Усі карти пам’яті →', url(CFG.storage, { presence: 1, tipPristrou: CFG.sd }));
      scNear(box, function () {
        scCatInStock(CFG.storage)   // сам розділ, не /filter/ (див. scCatInStock); карти відбираємо за назвою
          .then(scSafe(6, function (list) {
            pickCards(list.filter(function (p) { return SD_CARD.test(p.name) && !/диск|hdd|ssd/i.test(p.name); }), maxGB).forEach(function (p) { sdList.appendChild(scItem(p, SD)); });
            if (sdList.children.length) scStyle('sc-sd-style', SD_CSS);
            else sdList.remove();
          }));
      });
    }

    anchor.parentNode.insertBefore(box, anchor.nextSibling);
  }

  /* --- Карти пам'яті для камери --- */
  var SD_MAX = 3;   // скільки карт показувати
  // обсяг не вказано ні в характеристиках, ні в описі — не пропонуємо карти більші за цей (ГБ),
  // щоб не продати карту, яку камера не побачить
  var SD_DEFAULT_MAX = 256;
  var SD_CARD = /карт[аи] пам|microsd|micro sd/i;   // у розділі «Накопичувачі» є ще жорсткі диски
  // карти для відеоспостереження (розраховані на постійний перезапис) — показуємо першими
  var SD_ENDURANCE = /endurance|purple|surveillance|monitoring|відеоспостереж|видеонаблюд|для камер|для відео/i;
  var SD = scBem('sc-sd');
  var SD_CSS =
    '.sc-sd__list{flex:0 0 100%;display:flex;flex-direction:column;gap:6px;margin:2px 0 4px}' +
    '.sc-kit a.sc-sd__item{display:flex;align-items:center;gap:10px;padding:6px 8px;border:1px solid #e3e6ea;border-radius:8px;background:#fff;color:#1a1a1a;text-decoration:none;transition:border-color .15s}' +
    '.sc-kit a.sc-sd__item:hover{border-color:#2b7de9}' +
    '.sc-sd__img{flex:0 0 40px;width:40px;height:40px;object-fit:contain}' +
    '.sc-sd__info{flex:1;min-width:0}' +
    '.sc-sd__name{font-size:13px;line-height:1.3;display:block}' +
    '.sc-sd__note{font-size:12px;color:#2e9e4f;display:block;margin-top:2px}' +
    '.sc-sd__note:empty{display:none}' +
    '.sc-sd__price{flex:0 0 auto;font-weight:700;white-space:nowrap}';

  // «256 ГБ», «1 ТБ», «512GB» → гігабайти; 0 — не знайдено
  function toGB(n, u) { n = parseFloat(String(n).replace(',', '.')); return /т|t/i.test(u) ? n * 1024 : n; }
  function capGB(s) {
    s = String(s || '');
    var m = s.match(/(\d+(?:[.,]\d+)?)\s?(гб|gb|тб|tb)(?![a-zа-я])/i);
    if (m) return toGB(m[1], m[2]);
    // обсяг у коді моделі: Hikvision HS-TF-P1/128G, IMOU ST2-64-S1
    m = s.match(/[-\/](16|32|64|128|256|512)(?:g\b|-)/i);
    return m ? +m[1] : 0;
  }
  function gbText(gb) { return gb >= 1024 ? (gb / 1024) + ' ТБ' : gb + ' ГБ'; }

  // Максимальний обсяг карти, який підтримує камера: з характеристик, інакше з опису.
  // Не знайшли — 0 (тоді діє SD_DEFAULT_MAX).
  function sdMaxGB(f) {
    var best = 0;
    for (var k in f) {
      if (!/карт|sd|пам/i.test(k)) continue;
      var re = /(\d+(?:[.,]\d+)?)\s?(гб|gb|тб|tb)(?![a-zа-я])/gi, m;
      while ((m = re.exec(f[k]))) best = Math.max(best, toGB(m[1], m[2]));
    }
    if (best) return best;
    var d = scDesc().match(/(?:micro\s?sd|sd-карт|карт[аиу]? пам\S*)[^.;]{0,60}?(?:до|up to|max\.?|макс\.?)\s*(\d+(?:[.,]\d+)?)\s?(гб|gb|тб|tb)(?![a-zа-я])/i);
    return d ? toGB(d[1], d[2]) : 0;
  }

  // Порядок: карти для відеоспостереження → більший обсяг (довше зберігається запис).
  // Спершу різні обсяги, щоб покупець бачив вибір, потім решта. Більші за maxGB — не показуємо
  // (карти без обсягу в назві — показуємо, але в кінці).
  function pickCards(list, maxGB) {
    var seen = {}, c = list.map(function (p) {
      return { p: p, gb: capGB(p.name), end: SD_ENDURANCE.test(p.name) ? 1 : 0 };
    }).filter(function (x) {
      if (seen[x.p.url]) return false;
      seen[x.p.url] = 1;
      return !maxGB || !x.gb || x.gb <= maxGB;
    });
    c.sort(function (a, b) { return (!a.gb - !b.gb) || (b.end - a.end) || (b.gb - a.gb); });
    var out = [], caps = {};
    c.forEach(function (x) { if (out.length < SD_MAX && !caps[x.gb]) { caps[x.gb] = 1; out.push(x); } });
    c.forEach(function (x) { if (out.length < SD_MAX && out.indexOf(x) < 0) out.push(x); });
    return out.map(function (x) {
      return { url: x.p.url, name: x.p.name, price: x.p.price, img: x.p.img,
               note: x.end ? 'Для відеоспостереження — розрахована на постійний перезапис' : '' };
    });
  }

  scInit(6, init);
});


/* =====================================================================
 * 7. Картка відеореєстратора → «Підберіть до цього реєстратора» (камери того ж бренду: TVT, Hikvision, Dahua, Ajax)
 * ===================================================================== */
scModule(7, function () {
  'use strict';

  var CFG = {
    cams: '/videokamery/',
    tvt: 101, ajax: 96,
    // камери пропонуємо лише того ж бренду, що й реєстратор
    camBrands: [[/\btvt\b/i, 101, 'TVT'], [/hikvision/i, 131, 'Hikvision'], [/dahua/i, 135, 'Dahua']],
    ipCam: 50, ptz: 68,
    // групи роздільної здатності камер: [назва, макс. Мп, ID значень фільтра]
    res: [['4 Мп', 4, [3, 5]], ['5–6 Мп', 6, [1, 7, 9, 14]], ['8 Мп', 8, [2, 13]]],
    switches: '/komutatory/',
    utp: '/kabel-vyta-para/2348/',
    connectors: '/patch-kordy/2378/'
  };

  var url = scFilterUrl;   // стилі й рядки — спільні з блоком 6 (.sc-kit)
  // без заміни коми (на відміну від scNum) — як і було: «5,0 Мп» → 5
  function num(s) { var m = String(s).match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; }

  function init() {
    if (document.getElementById('sc-nvr')) return;
    var anchor = scAnchor();
    if (!anchor) return;

    var f = scFeatures();
    var title = scH1().trim();
    var type = scGet(f, /^тип (пристрою|устройства)$/) || title;   // у кількох карток характеристики не заповнені
    if (!/реєстратор|регистратор/i.test(type) || /нагрудн|автомоб|кабель|живлення/i.test(type)) return;

    var format = scGet(f, /^формат відеореєстратора$/);
    var isIP = /^ip$/i.test(format) || /nvr/i.test(type) || /^(ip-|мережев)/i.test(title) || /nvr|ds-7[6-9]\d\d/i.test(title);
    var isAjax = /ajax/i.test(title);
    var ipCh = num(scGet(f, /^кількість каналів ip$/)) || (isIP ? num((title.match(/(\d+)-канальн/) || [])[1]) : 0);
    var recMp = num(scGet(f, /^роздільна здатність запису$/)) || num((title.match(/(\d+)\s?mp/i) || [])[1]);
    var poe = /так|да|yes/i.test(scGet(f, /^poe$/)) || /poe/i.test(title);
    var poePorts = num(scGet(f, /^кількість poe-портів$/));

    if (!isAjax && !isIP && !ipCh) return;   // аналогові без IP-каналів — IP-камер для них немає
    var brandTxt = scGet(f, /^(бренд|виробник|производитель|торгова марка)$/);
    var camBrand = null;
    CFG.camBrands.some(function (b) { if (b[0].test(brandTxt)) { camBrand = b; return true; } });
    if (!camBrand && !brandTxt) CFG.camBrands.some(function (b) { if (b[0].test(title)) { camBrand = b; return true; } });

    scStyle('sc-kit-style', SC_KIT_CSS);
    var box = document.createElement('div');
    box.id = 'sc-nvr'; box.className = 'sc-kit';
    box.innerHTML = '<div class="sc-kit__title">Підберіть до цього реєстратора</div>';

    function row(label, hint) { return scKitRow(box, label, hint); }
    var chip = scKitChip;

    // 1. Камери
    if (isAjax) {
      var ar = row('Камери', 'Для Ajax NVR — камери Ajax');
      chip(ar, 'Камери Ajax →', url(CFG.cams, { brand: CFG.ajax, presence: 1 }));
    } else if (camBrand) {
      var hint = isIP
        ? (ipCh ? 'До ' + ipCh + ' IP-камер' : 'Мережевий реєстратор') + (recMp ? ' · запис до ' + recMp + ' Мп' : '')
        : 'Гібридний: можна додати до ' + ipCh + ' IP-камер';
      var cr = row('IP-камери ' + camBrand[2], hint);
      CFG.res.forEach(function (g) {
        if (recMp && g[1] > recMp) return;          // реєстратор не запише таку роздільну здатність
        chip(cr, g[0], url(CFG.cams, { brand: camBrand[1], presence: 1, rozdlnaZdatnstKameri: g[2], tipPristrou: CFG.ipCam }));
      });
      chip(cr, 'Поворотні PTZ', url(CFG.cams, { brand: camBrand[1], presence: 1, tipPristrou: CFG.ptz }));
      chip(cr, 'Усі камери ' + camBrand[2] + ' →', url(CFG.cams, { brand: camBrand[1], presence: 1, tipPristrou: [CFG.ipCam, CFG.ptz] }));
    }

    // 2. Живлення камер
    if (isIP && !isAjax) {
      var pr;
      if (poe) {
        var ports = poePorts || ipCh;
        pr = row('Живлення камер', 'Вбудований PoE' + (ports ? ' на ' + ports + ' портів' : '') +
          ' — камери живляться по кабелю від реєстратора. Для додаткових камер — PoE-комутатор.');
      } else {
        pr = row('Живлення камер', 'Реєстратор без PoE: камерам потрібен PoE-комутатор');
      }
      chip(pr, 'PoE-комутатори →', url(CFG.switches, { poe: 1, presence: 1 }));
    }

    // 3. Кабель
    var kr = row('Кабель і роз’єми');
    chip(kr, 'Вита пара →', url(CFG.utp, { presence: 1 }));
    chip(kr, 'Роз’єми та патч-корди →', url(CFG.connectors, { presence: 1 }));

    anchor.parentNode.insertBefore(box, anchor.nextSibling);
  }

  scInit(7, init);
});


/* =====================================================================
 * 8. Картки зарядних станцій, систем накопичення і ДБЖ 12 В → калькулятор автономності
 *    Коефіцієнти — як у текстах описів:
 *    станції ×0.85, системи накопичення ×0.9×0.9 = 0.81, ДБЖ 12 В — А·год ÷ А без втрат
 * ===================================================================== */
scModule(8, function () {
  'use strict';

  var DEV_AC = [
    { id: 'router', name: 'Роутер (+ ONT)', v: 10 },
    { id: 'laptop', name: 'Ноутбук', v: 50 },
    { id: 'fridge', name: 'Холодильник', v: 150, hint: 'середнє споживання з урахуванням циклів компресора' },
    { id: 'boiler', name: 'Газовий котел', v: 100, hint: 'з насосом — близько 120 Вт' },
    { id: 'lamp',   name: 'LED-лампа', v: 10, qty: true },
    { id: 'tv',     name: 'Телевізор', v: 80 },
    { id: 'cam',    name: 'Відеокамера', v: 5, qty: true },
    { id: 'micro',  name: 'Мікрохвильовка', v: 1200 },
    { id: 'tool',   name: 'Електроінструмент', v: 1500 },
    { id: 'kettle', name: 'Чайник', v: 2000 }
  ];
  var DEV_DC = [
    { id: 'cam',      name: 'Камера 12 В', v: 0.5, qty: true },
    { id: 'nvr',      name: 'Відеореєстратор', v: 1.5 },
    { id: 'router',   name: 'Роутер 12 В', v: 1 },
    { id: 'intercom', name: 'Домофон / відеопанель', v: 0.5, qty: true },
    { id: 'lock',     name: 'Електромагнітний замок', v: 0.5, qty: true }
  ];

  var CSS =
    '#sc-calc{margin:20px 0;padding:16px;border:1px solid #d6e4f0;border-radius:10px;background:#f7fbff;font-size:14px;line-height:1.4;color:#1d2733;max-width:900px;box-sizing:border-box}' +
    '#sc-calc *{box-sizing:border-box}' +
    '#sc-calc .scc-t{font-weight:700;font-size:16px;margin:0 0 4px}' +
    '#sc-calc .scc-s{color:#5f6b78;font-size:13px;margin:0 0 12px}' +
    '#sc-calc .scc-bat{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:0 0 10px}' +
    '#sc-calc .scc-bat select{max-width:100%;min-width:0;padding:6px 8px;border:1px solid #cfd8e2;border-radius:6px;background:#fff;color:#1d2733;font:inherit}' +
    '#sc-calc .scc-rows{display:flex;flex-direction:column;gap:6px}' +
    '#sc-calc .scc-r{display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid #dde3ea;border-radius:8px;background:#fff}' +
    '#sc-calc .scc-r.on{background:#e8f3fc;border-color:#b9d8f2}' +
    '#sc-calc .scc-r input[type=checkbox]{width:18px;height:18px;margin:0;accent-color:#1b7fd1;flex:0 0 auto}' +
    '#sc-calc .scc-r label{flex:1 1 auto;min-width:0;cursor:pointer;margin:0;overflow-wrap:break-word}' +
    '#sc-calc .scc-ctl{display:flex;align-items:center;gap:6px;flex:0 0 auto;margin-left:auto}' +
    '#sc-calc .scc-h{display:block;font-size:12px;color:#7a828c}' +
    '#sc-calc .scc-q{display:flex;align-items:center;border:1px solid #cfd8e2;border-radius:6px;background:#fff}' +
    '#sc-calc .scc-q button{width:28px;height:30px;border:0;background:none;font-size:17px;cursor:pointer;color:#1d2733;padding:0}' +
    '#sc-calc .scc-q span{min-width:20px;text-align:center;font-weight:500}' +
    '#sc-calc .scc-w{display:flex;align-items:center;gap:4px;color:#5f6b78;font-size:13px}' +
    '#sc-calc .scc-w input{width:58px;padding:5px 6px;border:1px solid #cfd8e2;border-radius:6px;text-align:right;font:inherit;color:#1d2733;background:#fff}' +
    '#sc-calc .scc-res{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:4px 16px;margin-top:12px;padding:12px 14px;border-radius:8px;background:#e7f6ed}' +
    '#sc-calc .scc-res>div:nth-child(2){margin-left:auto;text-align:right}' +
    '#sc-calc .scc-res.warn{background:#fdf2e3}#sc-calc .scc-res.bad{background:#fdeaea}' +
    '#sc-calc .scc-l{font-size:12px;color:#5f6b78}' +
    '#sc-calc .scc-load{font-weight:500;font-size:15px}' +
    '#sc-calc .scc-hours{font-weight:700;font-size:26px;line-height:1.1;color:#1f8a4c;text-align:right}' +
    '#sc-calc .scc-res.warn .scc-hours{color:#b45309}#sc-calc .scc-res.bad .scc-hours{color:#c62828}' +
    '#sc-calc .scc-msg{flex:1 1 100%;font-size:13px;margin-top:4px}' +
    '#sc-calc .scc-f{font-size:12px;color:#7a828c;margin:10px 0 0}';

  var num = scNum;
  function watts(s) { var v = num(s); return /к(Вт|ВА)/i.test(s) ? v * 1000 : v; }

  function detect() {
    var f = scFeatures(), get = scGet;
    var type = get(f, /^тип (пристрою|устройства)$/);
    var title = scH1();

    if (/зарядна станція|зарядная станция/i.test(type)) {
      var wh = num(get(f, /^ємність$|^емкость$/));
      var w = watts(get(f, /^номінальна потужність$|^номинальная мощность$/));
      if (!wh || !w) return null;
      return { mode: 'wh', wh: wh, k: 0.85, maxW: w, preset: { fridge: 1 },
        formula: 'Розрахунково: ємність ' + wh + ' Вт·год × 0.85 ÷ навантаження. 0.85 — запас на втрати інвертора; реальний час залежить від приладів.' };
    }
    if (/система накопичення|система накопления/i.test(type)) {
      var e = get(f, /енергоємність|энергоемкость/);
      var wh2 = /квт/i.test(e) ? num(e) * 1000 : num(e);
      var w2 = watts(get(f, /^потужність$|^мощность$/));
      if (!wh2 || !w2) return null;
      return { mode: 'wh', wh: wh2, k: 0.81, maxW: w2, preset: { fridge: 1, boiler: 1, router: 1, lamp: 4 },
        formula: 'Розрахунково: ' + wh2 + ' Вт·год × 0.9 (глибина розряду) × 0.9 (ККД) ÷ навантаження.' };
    }
    if (/безперебійн|бесперебойн/i.test(type) && /PSU-/i.test(title)) {
      var a = num(get(f, /^вихідний струм$|^выходной ток$/));
      if (!a) return null;
      return { mode: 'ah', maxA: a, preset: { cam: 4 } };
    }
    return null;
  }

  function fmtH(h) {
    if (!isFinite(h)) return '—';
    if (h < 1.5) return '~' + String(Math.round(h * 10) / 10).replace('.', ',') + ' год';
    return '~' + Math.round(h) + ' год';
  }
  function ahOf(name, fallback) {
    var m = String(name).replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(?:Ah|А\*?·?год|Аг|Ач|А·ч)/i);
    return m ? parseFloat(m[1]) : fallback;
  }

  function build(cfg, bats) {
    var list = cfg.mode === 'ah' ? DEV_DC : DEV_AC, unit = cfg.mode === 'ah' ? 'А' : 'Вт';
    var state = {};
    list.forEach(function (d) { state[d.id] = { on: !!cfg.preset[d.id], qty: cfg.preset[d.id] || 1, v: d.v }; });

    var box = document.createElement('div');
    box.id = 'sc-calc';
    var sub = cfg.mode === 'ah'
      ? 'Акумулятор не входить у комплект. Оберіть сумісну АКБ і пристрої 12 В, які живляться від ДБЖ.'
      : 'Позначте, що буде працювати одночасно під час відключення. Потужність можна змінити під свій прилад.';
    var html = '<div class="scc-t">Скільки пропрацює: порахуйте для свого набору</div><div class="scc-s">' + sub + '</div>';
    if (cfg.mode === 'ah') html += '<div class="scc-bat"><label for="scc-bat">Акумулятор:</label><select id="scc-bat"></select></div>';
    html += '<div class="scc-rows">';
    list.forEach(function (d) {
      html += '<div class="scc-r" id="scc-r-' + d.id + '"><input type="checkbox" id="scc-c-' + d.id + '">' +
        '<label for="scc-c-' + d.id + '">' + d.name + (d.hint ? '<span class="scc-h">' + d.hint + '</span>' : '') + '</label><span class="scc-ctl">' +
        (d.qty ? '<div class="scc-q"><button type="button" data-d="' + d.id + '" data-s="-1" aria-label="Менше">−</button><span id="scc-q-' + d.id + '"></span><button type="button" data-d="' + d.id + '" data-s="1" aria-label="Більше">+</button></div>' : '') +
        '<span class="scc-w"><input id="scc-w-' + d.id + '" inputmode="decimal" aria-label="' + unit + ': ' + d.name + '"> ' + unit + '</span></span></div>';
    });
    html += '</div><div class="scc-res" aria-live="polite"><div><div class="scc-l">Одночасне навантаження</div><div class="scc-load"></div></div>' +
      '<div><div class="scc-l" style="text-align:right">Пропрацює приблизно</div><div class="scc-hours"></div></div><div class="scc-msg"></div></div>' +
      '<p class="scc-f"></p>';
    box.innerHTML = html;

    var $ = function (id) { return box.querySelector('#' + id); };
    var sel = $('scc-bat');
    if (sel) {
      bats.forEach(function (b, i) {
        var o = document.createElement('option');
        o.value = i;
        o.textContent = b.name + (b.price ? ' — ' + b.price : '');
        sel.appendChild(o);
      });
      sel.onchange = calc;
      box.querySelector('.scc-f').textContent = 'Розрахунково: ємність АКБ (А·год) ÷ сумарний струм (А). Струм пристроїв — типові значення, точний дивіться на корпусі або в паспорті.';
    } else {
      box.querySelector('.scc-f').textContent = cfg.formula;
    }

    list.forEach(function (d) {
      var ck = $('scc-c-' + d.id), w = $('scc-w-' + d.id);
      ck.checked = state[d.id].on;
      w.value = String(d.v).replace('.', ',');
      ck.onchange = function () { state[d.id].on = ck.checked; calc(); };
      w.oninput = function () {
        var v = parseFloat(w.value.replace(',', '.'));
        state[d.id].v = isNaN(v) ? 0 : v;
        if (!state[d.id].on) { state[d.id].on = true; ck.checked = true; }
        calc();
      };
    });
    box.querySelectorAll('.scc-q button').forEach(function (b) {
      b.onclick = function () {
        var s = state[b.getAttribute('data-d')];
        s.qty = Math.max(1, Math.min(32, s.qty + Number(b.getAttribute('data-s'))));
        s.on = true; $('scc-c-' + b.getAttribute('data-d')).checked = true;
        calc();
      };
    });

    function calc() {
      var total = 0;
      list.forEach(function (d) {
        var s = state[d.id];
        $('scc-r-' + d.id).classList.toggle('on', s.on);
        var q = $('scc-q-' + d.id); if (q) q.textContent = s.qty;
        if (s.on) total += s.v * (d.qty ? s.qty : 1);
      });
      var res = box.querySelector('.scc-res'), msg = '', h, loadTxt;
      res.className = 'scc-res';
      if (cfg.mode === 'ah') {
        total = Math.round(total * 100) / 100;
        loadTxt = String(total).replace('.', ',') + ' А';
        var ah = bats.length ? bats[+sel.value].ah : 0;
        h = total > 0 && ah ? ah / total : NaN;
        if (total > cfg.maxA) { res.classList.add('bad'); msg = 'ДБЖ видає до ' + String(cfg.maxA).replace('.', ',') + ' А — для такого навантаження потрібна потужніша модель.'; }
        else if (h < 6) { res.classList.add('warn'); msg = 'Більша АКБ у бокс не поміститься. Для довших відключень потрібен ДБЖ із більшим відсіком або виносна АКБ.'; }
      } else {
        loadTxt = Math.round(total) + ' Вт';
        h = total > 0 ? cfg.wh * cfg.k / total : NaN;
        if (total > cfg.maxW) { res.classList.add('bad'); msg = 'Навантаження більше ' + cfg.maxW + ' Вт — пристрій не потягне все одночасно. Вимкніть щось потужне або оберіть потужнішу модель.'; }
        else if (h < 6) { res.classList.add('warn'); msg = 'На тривалі відключення може не вистачити — зверніть увагу на моделі з більшою ємністю.'; }
        else if (h >= 48) { var dd = Math.floor(h / 24); msg = 'Це приблизно ' + dd + (dd % 10 >= 2 && dd % 10 <= 4 && (dd % 100 < 12 || dd % 100 > 14) ? ' доби' : ' діб') + ' без підзарядки.'; }
      }
      box.querySelector('.scc-load').textContent = total > 0 ? loadTxt : 'нічого не обрано';
      box.querySelector('.scc-hours').textContent = total > 0 ? fmtH(h) : '—';
      var m = box.querySelector('.scc-msg'); m.textContent = msg; m.hidden = !msg;
    }
    calc();
    return box;
  }

  function place(box) {
    var desc = document.querySelector('.product-description') || document.querySelector('[itemprop="description"]');
    if (desc && desc.parentNode) { desc.parentNode.insertBefore(box, desc.nextSibling); return true; }
    var after = document.getElementById('sc-akb') || scAnchor();
    if (after && after.parentNode) { after.parentNode.insertBefore(box, after.nextSibling); return true; }
    return false;
  }

  function batteries() {
    var a = window.scAkb;
    if (!a) return null;
    var out = a.items.map(function (p) { return { name: p.name, price: p.price, note: p.note, ah: ahOf(p.name, a.slot) }; });
    if (!out.length && a.slot) out.push({ name: 'АКБ 12 В / ' + a.slot + ' А·год (під замовлення)', ah: a.slot });
    return out;
  }

  var waiting = false;
  function init() {
    if (document.getElementById('sc-calc')) return;
    if (!document.querySelector('[itemtype*="schema.org/Product"]')) return;
    var cfg = detect();
    if (!cfg) return;
    if (cfg.mode === 'ah') {
      var bats = batteries();
      if (!bats) {
        // АКБ від блоку 3 ще не підвантажені — чекаємо його подію (один слухач, хоч init і викликається двічі)
        if (!waiting) { waiting = true; document.addEventListener('sc-akb', scSafe(8, function () { waiting = false; init(); }), { once: true }); }
        return;
      }
      if (!bats.length) return;
      cfg.bats = bats;
    }
    scStyle('sc-calc-style', CSS);
    place(build(cfg, cfg.bats || []));
  }

  scInit(8, init);
});


/* =====================================================================
 * 9. Ajax: сумісність хабів і пристроїв
 *    На картці хаба / стартового комплекту → сумісні датчики і пристрої
 *    На картці пристрою → з якими хабами працює + хаби в наявності
 *    Дані: таблиця сумісності ajax.systems/ua/tools/devices-compatibility (жовтень 2026)
 *    Звірено з PDF-вивантаженням таблиці 30.10.2026: усі класи пристроїв збігаються; додано Curtain Outdoor Mini (G), Superior (G/P);
 *    Fibra і SpeakerPhone не показуємо (Fibra — лише Superior Hub Hybrid, SpeakerPhone — не з Hub 2 (2G))
 *    Класи: B — усі хаби; P — крім Hub (2G); G — лише Hub 2 / Hub 2 Plus / Hub BP;
 *           C — як G, а через ретранслятор лише ReX 2
 * ===================================================================== */
scModule(9, function () {
  'use strict';

  var MAX = 8;
  var U = function (w, b) { return { w: w, b: b || w }; };

  // Хаби: що підтримують
  var HUBS = {
    hub:      { name: 'Hub',        cls: ['B'],                url: U('/intelektualna-tsentral-ajax-hub-bila-z-2g-ethernet/', '/intelektualna-tsentral-ajax-hub-chorna-z-2g-ethernet/') },
    hubplus:  { name: 'Hub Plus',   cls: ['B', 'P'],           url: U('/intelektualna-tsentral-ajax-hub-plus-bila-z-wifi-2g-3g-ethernet/', '/intelektualna-tsentral-ajax-hub-plus-chorna-z-wifi-2g-3g-ethernet/') },
    hub2:     { name: 'Hub 2',      cls: ['B', 'P', 'G', 'C'], url: U('/intelektualna-tsentral-ajax-hub-2-2g-bila-z-2g-ethernet-pidtrymkoiu-datchykiv-z-fotoveryfikatsiieiu/', '/intelektualna-tsentral-ajax-hub-2-2g-chorna-z-2g-ethernet-pidtrymkoiu-datchykiv-z-fotoveryfikatsiieiu/') },
    hub24g:   { name: 'Hub 2 (4G)', cls: ['B', 'P', 'G', 'C'], url: U('/intelektualna-tsentral-ajax-hub-2-4g-bila-z-2g-3g-4g-ethernet-pidtrymkoiu-datchykiv-z-fotoveryfikatsiieiu/', '/intelektualna-tsentral-ajax-hub-2-4g-chorna-z-2g-3g-4g-ethernet-pidtrymkoiu-datchykiv-z-fotoveryfikatsiieiu/') },
    hub2plus: { name: 'Hub 2 Plus', cls: ['B', 'P', 'G', 'C'], url: U('/intelektualna-tsentral-ajax-hub-2-plus-bila-z-wifi-2g-3g-4g-ethernet-pidtrymkoiu-datchykiv-z-fotoveryfikatsiieiu/', '/intelektualna-tsentral-ajax-hub-2-plus-chorna-z-wifi-2g-3g-4g-ethernet-pidtrymkoiu-datchykiv-z-fotoveryfikatsiieiu/') },
    hubbp:    { name: 'Hub BP',     cls: ['B', 'P', 'G', 'C'], url: U('/okhoronna-tsentral-z-zhyvlenniam-vid-zovnishnoi-batarei-ajax-hub-bp-jeweller-white/', '/okhoronna-tsentral-z-zhyvlenniam-vid-zovnishnoi-batarei-ajax-hub-bp-jeweller-black/') }
  };
  var HUB_ORDER = ['hub2', 'hub24g', 'hub2plus', 'hubplus', 'hubbp', 'hub'];

  // Пристрої: клас сумісності, посилання (біла / чорна версія); порядок — пріоритет показу на картці хаба
  var DEV = [
    // Лінійка Superior (Jeweller): G3, HomeSiren, MotionCam і TouchScreen — лише Hub 2 / 2 Plus / BP; решта — усі, крім Hub
    { k: 'superiorg',  re: /Superior.*(\bG3\b|HomeSiren|MotionCam|TouchScreen)/i, cls: 'G', url: null },
    { k: 'superior',   re: /Superior/i,                       cls: 'P', url: null },
    { k: 'motioncam',  re: /MotionCam(?! Outdoor)/i,          cls: 'C', name: 'MotionCam',     url: U('/bezdrotovyi-datchyk-rukhu-z-kameroiu-ajax-motioncam-phod-bilyi/', '/bezdrotovyi-datchyk-rukhu-z-kameroiu-ajax-motioncam-phod-chornyi/') },
    { k: 'motion',     re: /MotionProtect(?! (Plus|Curtain|Outdoor))/i, cls: 'B', url: U('/bezdrotovyi-datchyk-rukhu-ajax-motionprotect-bilyi/', '/bezdrotovyi-datchyk-rukhu-ajax-motionprotect-chornyi/') },
    { k: 'door',       re: /DoorProtect(?! Plus)/i,           cls: 'B', url: U('/bezdrotovyi-datchyk-vidchynennia-ajax-doorprotect-bilyi/', '/bezdrotovyi-datchyk-vidchynennia-ajax-doorprotect-chornyi/') },
    { k: 'kptouch',    re: /KeyPad TouchScreen/i,             cls: 'C', reader: true, url: U('/klaviatura-ajax-keypad-touchscreen-white/', '/klaviatura-ajax-keypad-touchscreen-black/') },
    { k: 'kpplus',     re: /KeyPad Plus/i,                    cls: 'P', reader: true, url: U('/klaviatura-ajax-keypad-plus-bila/', '/klaviatura-ajax-keypad-plus-chorna/') },
    { k: 'keypad',     re: /KeyPad(?! (Plus|TouchScreen|Outdoor))/i, cls: 'B', url: U('/klaviatura-ajax-keypad-bila/', '/klaviatura-ajax-keypad-chorna/') },
    { k: 'homesiren',  re: /HomeSiren/i,                      cls: 'B', url: U('/bezdrotova-vnutrishnia-syrena-ajax-homesiren-bila/', '/bezdrotova-vnutrishnia-syrena-ajax-homesiren-chorna/') },
    // FireProtect 2 RB з датчиком диму (Heat/Smoke, Heat/Smoke/CO) працює і з Hub першої версії; решта FireProtect 2 — ні
    { k: 'fire2',      re: /диму.*FireProtect 2 RB/i,         cls: 'B', url: U('/datchyk-dymu-ta-temperatury-ajax-fireprotect-2-rb-smoke-heat-bilyi/', '/datchyk-dymu-ta-temperatury-ajax-fireprotect-2-rb-smoke-heat-chornyi/') },
    { k: 'fire2p',     re: /FireProtect 2/i,                  cls: 'P', url: null },
    { k: 'fire',       re: /FireProtect(?! 2)/i,              cls: 'B', url: U('/bezdrotovyi-datchyk-dymu-ajax-fireprotect-bilyi-z-temperaturnym-sensorom/', '/bezdrotovyi-datchyk-dymu-ajax-fireprotect-chornyi-z-temperaturnym-sensorom/') },
    { k: 'leaks',      re: /LeaksProtect/i,                   cls: 'B', url: U('/bezdrotovyi-datchyk-zatoplennia-ajax-leaksprotect-bilyi/', '/bezdrotovyi-datchyk-zatoplennia-ajax-leaksprotect-chornyi/') },
    { k: 'waterstop',  re: /WaterStop/i,                      cls: 'P', url: U('/kran-perekryttia-vody-ajax-waterstop-1-2-bilyi/', '/kran-perekryttia-vody-ajax-waterstop-1-2-chornyi/') },
    { k: 'streetsiren', re: /StreetSiren/i,                   cls: 'B', url: U('/bezdrotova-vulychna-syrena-ajax-streetsiren-bila/', '/bezdrotova-vulychna-syrena-ajax-streetsiren-chorna/') },
    { k: 'mcamout',    re: /MotionCam Outdoor/i,              cls: 'C', url: U('/bezdrotovyi-vulychnyi-datchyk-rukhu-z-kameroiu-ajax-motioncam-outdoor-phod-bilyi/') },
    { k: 'kpout',      re: /KeyPad Outdoor/i,                 cls: 'G', reader: true, url: U('/klaviatura-vulychna-ajax-keypad-outdoor-white/', '/klaviatura-vulychna-ajax-keypad-outdoor-black/') },
    { k: 'glass',      re: /GlassProtect/i,                   cls: 'B', url: U('/bezdrotovyi-datchyk-rozbyttia-skla-ajax-glassprotect-bilyi/', '/bezdrotovyi-datchyk-rozbyttia-skla-ajax-glassprotect-chornyi/') },
    { k: 'combi',      re: /CombiProtect/i,                   cls: 'B', url: U('/bezdrotovyi-datchyk-rukhu-ta-rozbyttia-ajax-combiprotect-bilyi/', '/bezdrotovyi-datchyk-rukhu-ta-rozbyttia-ajax-combiprotect-chornyi/') },
    { k: 'doorplus',   re: /DoorProtect Plus/i,               cls: 'B', url: U('/bezdrotovyi-datchyk-vidchynennia-ajax-doorprotect-plus-bilyi-z-datchykom-udaru-i-nakhylu/', '/bezdrotovyi-datchyk-vidchynennia-doorprotect-plus-chornyi-ajax-z-datchykom-udaru-i-nakhylu/') },
    { k: 'motionplus', re: /MotionProtect Plus/i,             cls: 'B', url: U('/bezdrotovyi-datchyk-rukhu-ajax-motionprotect-plus-bilyi-z-mikrokhvylovym-sensorom/', '/bezdrotovyi-datchyk-rukhu-ajax-motionprotect-plus-chornyi-z-mikrokhvylovym-sensorom/') },
    { k: 'curtain',    re: /MotionProtect Curtain/i,          cls: 'B', url: U('/bezdrotovyi-datchyk-rukhu-shtora-ajax-motionprotect-curtain-bilyi/', '/bezdrotovyi-datchyk-rukhu-shtora-ajax-motionprotect-curtain-chornyi/') },
    { k: 'motionout',  re: /MotionProtect Outdoor/i,          cls: 'B', url: U('/bezdrotovyi-vulychnyi-datchyk-rukhu-ajax-motionprotect-outdoor-bilyi/') },
    { k: 'dualcurtain', re: /DualCurtain Outdoor/i,           cls: 'P', url: U('/bezdrotovyi-vulychnyi-dvonapravlenyi-datchyk-rukhu-shtora-ajax-dualcurtain-outdoor-bilyi/') },
    { k: 'curtainmini', re: /Curtain Outdoor Mini/i,          cls: 'G', url: null },
    // без lookbehind (?<!Dual): у Safari < 16.4 він ламав увесь скрипт; «DualCurtain Outdoor» уже перехоплено правилом вище
    { k: 'curtainout', re: /Curtain Outdoor/i,                cls: 'G', url: U('/datchyk-shtora-ajax-curtain-outdoor-jeweller-white/') },
    { k: 'spacecontrol', re: /SpaceControl(?! S\b)/i,         cls: 'B', url: U('/brelok-ajax-spacecontrol-bilyi/', '/brelok-ajax-spacecontrol-chornyi/') },
    { k: 'button',     re: /\b(Double)?Button\b(?!\/)/i,      cls: 'B', url: U('/tryvozhna-knopka-ajax-button-bila/', '/tryvozhna-knopka-ajax-button-chorna/') },
    { k: 'lifequality', re: /LifeQuality/i,                   cls: 'C', url: U('/datchyk-yakosti-povitria-ajax-lifequality-bilyi/', '/datchyk-yakosti-povitria-ajax-lifequality-chornyi/') },
    { k: 'socket',     re: /Socket/i,                         cls: 'B', url: U('/rozetka-ajax-socket-bila/', '/rozetka-ajax-socket-chorna/') },
    { k: 'relay',      re: /\bRelay\b|WallSwitch/i,           cls: 'B', url: U('/kontroler-dystantsiinoho-keruvannia-ajax-relay/') },
    { k: 'mcp',        re: /ManualCallPoint/i,                cls: 'P', url: U('/bezdrotova-knopka-dlia-aktyvatsii-pozhezhnoi-tryvohy-vruchnu-ajax-manualcallpoint-red-jeweller/') },
    { k: 'light',      re: /LightSwitch|LightCore/i,          cls: 'P', url: U('/rozumnyi-odnoklavishnyi-vymykach-ajax-lightswitch-1-gang-bilyi/', '/rozumnyi-odnoklavishnyi-vymykach-ajax-lightswitch-1-gang-chornyi/') },
    { k: 'outlet',     re: /OutletCore/i,                     cls: 'P', url: null },
    { k: 'transmitter', re: /Transmitter/i,                   cls: 'B', url: U('/transmitter-ajax-multitransmitter-bilyi/', '/transmitter-ajax-multitransmitter-chornyi/') },
    { k: 'vhf',        re: /vhfBridge/i,                      cls: 'P', url: null },
    { k: 'rex2',       re: /ReX 2/i,                          cls: 'G', isRex2: true, url: U('/retransliator-syhnalu-ajax-rex-2-bilyi-z-pidtrymkoiu-datchykiv-z-fotoveryfikatsiieiu/', '/retransliator-syhnalu-ajax-rex-2-chornyi-z-pidtrymkoiu-datchykiv-z-fotoveryfikatsiieiu/') },
    { k: 'rex',        re: /\bReX\b(?! 2)/i,                  cls: 'B', isRex: true, url: U('/retransliator-syhnalu-ajax-rex-bilyi/', '/retransliator-syhnalu-ajax-rex-chornyi/') }
  ];
  var ACCESS = [
    { k: 'tag',  name: 'Tag',  url: U('/brelok-keruvannia-ajax-tag-rfid-3pcs-bilyi/', '/brelok-keruvannia-ajax-tag-rfid-3pcs-chornyi/') },
    { k: 'pass', name: 'Pass', url: U('/kartka-keruvannia-ajax-pass-3pcs-bila/', '/kartka-keruvannia-ajax-pass-3pcs-chorna/') }
  ];
  // Що показувати на картці хаба (ключі DEV)
  var FOR_HUB = ['motioncam', 'motion', 'door', 'kptouch', 'kpplus', 'keypad', 'homesiren', 'fire2', 'fire', 'leaks', 'waterstop', 'streetsiren', 'rex2', 'rex'];

  var CLS_TEXT = {
    B: 'Працює з будь-яким хабом Ajax: Hub 2, Hub 2 Plus, Hub BP, Hub Plus і Hub. Через ретранслятор — ReX або ReX 2.',
    P: 'Працює з Hub 2, Hub 2 Plus, Hub BP і Hub Plus. Не підходить лише найперша модель — Ajax Hub (без цифри 2 і без Plus у назві). Через ретранслятор — ReX або ReX 2.',
    G: 'Працює з Hub 2, Hub 2 Plus і Hub BP. Зі старими моделями Ajax Hub і Hub Plus не працює.',
    C: 'Працює з Hub 2, Hub 2 Plus і Hub BP. Зі старими моделями Ajax Hub і Hub Plus не працює. Через ретранслятор — лише ReX 2 (ReX фото не передає).'
  };

  var CSS =
    '#sc-ajax{margin:16px 0 0;padding:14px 16px;border:1px solid #cfe0f5;border-radius:10px;background:#f4f8fd;font-size:14px;line-height:1.4}' +
    '#sc-ajax .sca-t{font-weight:700;font-size:15px;margin:0 0 4px}' +
    '#sc-ajax .sca-x{color:#555;margin:0 0 10px;font-size:13px}' +
    '#sc-ajax .sca-w{color:#8a4b08;background:#fff4e2;border-radius:6px;padding:6px 8px;margin:0 0 10px;font-size:13px}' +
    '#sc-ajax .sca-l{display:flex;flex-direction:column;gap:8px}' +
    '#sc-ajax a.sca-i{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid #d9e5f3;border-radius:8px;background:#fff;color:#1a1a1a;text-decoration:none;transition:border-color .15s}' +
    '#sc-ajax a.sca-i:hover{border-color:#2b7de9}' +
    '#sc-ajax .sca-img{flex:0 0 48px;width:48px;height:48px;object-fit:contain}' +
    '#sc-ajax .sca-n{flex:1;min-width:0;font-size:13px;line-height:1.3}' +
    '#sc-ajax .sca-p{flex:0 0 auto;font-weight:700;white-space:nowrap}' +
    '#sc-ajax .sca-s{font-size:12px;color:#7a828c;margin:10px 0 0}';
  var C = { a: 'sca-i', img: 'sca-img', name: 'sca-n', price: 'sca-p' };   // картка без підпису

  var langPrefix = SC_LANG;

  function title() { return scH1().replace(/\s+/g, ' ').trim(); }

  // Не показуємо на аксесуарах і товарах, яким хаб не потрібен
  var SKIP = /Smartbracket|DummyBox|муляж|кріпильна|кронштейн|корпус|Case\b|JunctionBox|Holder|тримач|Hood|навіс|PSU|блок живлення|Акумулятор Ajax|Батарея CR|ExternalAntenna|антена|EN54|відеокамера|IP-відео|NVR|відеореєстратор|DoorBell|підписка|передплата|Frame|рамка|Cover|панель|SoloButton|SideButton|CenterButton|Bypass|ocBridge|uartBridge|SpaceControl S\b|Fibra|SpeakerPhone/i;

  function detect() {
    var t = title();
    if (!/Ajax/i.test(t) || SKIP.test(t)) return null;
    // Хаб або стартовий комплект
    if (/StarterKit/i.test(t)) {
      if (/Cam Plus/i.test(t)) return { hub: 'hub2plus' };
      if (/Cam|StarterKit 2/i.test(t)) return { hub: 'hub2' };
      if (/Plus/i.test(t)) return { hub: 'hubplus' };
      return { hub: 'hub' };
    }
    if (/централь|\bHub\b/i.test(t) && !/для Hub/i.test(t)) {
      if (/Hub 2 Plus/i.test(t)) return { hub: 'hub2plus' };
      if (/Hub 2\b/i.test(t)) return { hub: /4G/i.test(t) ? 'hub24g' : 'hub2' };
      if (/Hub BP/i.test(t)) return { hub: 'hubbp' };
      if (/Hub Plus/i.test(t)) return { hub: 'hubplus' };
      if (/Hub\b/i.test(t)) return { hub: 'hub' };
    }
    if (/\b(Tag|Pass)\b/.test(t) && /брелок|картка/i.test(t)) return { access: true };
    for (var i = 0; i < DEV.length; i++) if (DEV[i].re.test(t)) return { dev: DEV[i] };
    return null;
  }

  function pickUrl(u, dark) { return langPrefix + (dark ? u.b : u.w); }

  // Спершу версія того ж кольору, що й товар; якщо її нема в наявності — іншого кольору
  function load(item, dark, retry) {
    var url = pickUrl(item.url, dark);
    return scProduct(url).then(function (p) {
      if (!p || !scInStock(p.avail)) {
        if (!retry && item.url.b !== item.url.w) return load(item, !dark, true);
        return null;
      }
      return { url: url, name: p.name, price: p.price, img: p.img, hub: !!item.hub };
    });
  }

  function pickInStock(items, dark, cb) {
    var found = [], i = 0;
    (function next() {
      if (found.length >= MAX || i >= items.length) return cb(found);
      var batch = items.slice(i, i + 4); i += 4;
      Promise.all(batch.map(function (it) { return load(it, dark); })).then(function (res) {
        res.forEach(function (p) {
          var hubs = found.filter(function (x) { return x.hub; }).length;
          if (p && found.length < MAX && !(p.hub && hubs >= 4)) found.push(p);
        });
        next();
      });
    })();
  }

  function build(cfg) {
    var dark = /чорн|black/i.test(title());
    var head, text, warn = '', items = [];

    if (cfg.hub) {
      var h = HUBS[cfg.hub];
      head = 'Сумісні датчики і пристрої';
      text = 'Пристрої Ajax, які працюють з ' + h.name + ' (за таблицею сумісності Ajax).';
      if (cfg.hub === 'hub') warn = 'Ця модель Hub (перше покоління) не підтримує KeyPad Plus, WaterStop, LightSwitch, FireProtect 2 SB, датчики з фотоверифікацією MotionCam, KeyPad TouchScreen і LifeQuality. Для них потрібен Hub 2 або Hub 2 Plus.';
      if (cfg.hub === 'hubplus') warn = 'Hub Plus не підтримує датчики з фотоверифікацією MotionCam, KeyPad TouchScreen, KeyPad Outdoor і LifeQuality. Для них потрібен Hub 2 або Hub 2 Plus.';
      FOR_HUB.forEach(function (k) {
        var d = DEV.filter(function (x) { return x.k === k; })[0];
        if (d && d.url && h.cls.indexOf(d.cls) !== -1) items.push(d);
      });
    } else if (cfg.access) {
      head = 'Потрібна клавіатура зі зчитувачем';
      text = 'Брелоки Tag і картки Pass працюють з клавіатурами KeyPad Plus, KeyPad TouchScreen і KeyPad Outdoor. Звичайна KeyPad їх не зчитує.';
      items = DEV.filter(function (x) { return x.reader; });
    } else {
      var d = cfg.dev;
      head = d.isRex || d.isRex2 ? 'З якими хабами працює' : 'Для роботи потрібен хаб Ajax';
      text = CLS_TEXT[d.cls];
      if (d.isRex2) text = 'ReX 2 працює з Hub 2, Hub 2 Plus і Hub BP і передає фото з MotionCam. З Hub і Hub Plus не працює — для них підійде ReX.';
      if (d.isRex) text = 'ReX працює з Hub, Hub Plus, Hub 2, Hub 2 Plus і Hub BP. Фото з датчиків MotionCam не передає — для них потрібен ReX 2.';
      HUB_ORDER.forEach(function (k) {
        var hb = HUBS[k];
        var ok = d.isRex2 ? hb.cls.indexOf('C') !== -1 : hb.cls.indexOf(d.cls) !== -1;
        if (ok) items.push({ url: hb.url, hub: true });   // показуємо до 4 хабів у наявності
      });
      if (d.reader) items = items.concat(ACCESS);
    }

    var box = document.createElement('div');
    box.id = 'sc-ajax';
    box.innerHTML = '<div class="sca-t"></div><div class="sca-x"></div>' + (warn ? '<div class="sca-w"></div>' : '') +
      '<div class="sca-l"></div><div class="sca-s">Сумісність — за даними Ajax Systems, за умови оновленої прошивки хаба (оновлюється автоматично).</div>';
    box.querySelector('.sca-t').textContent = head;
    box.querySelector('.sca-x').textContent = text;
    if (warn) box.querySelector('.sca-w').textContent = warn;

    var listEl = box.querySelector('.sca-l');
    scNear(box, function () { pickInStock(items, dark, function (found) {
      found.forEach(function (p) {
        if (p.url.replace(/\/$/, '') === location.pathname.replace(/\/$/, '')) return;
        listEl.appendChild(scItem(p, C));
      });
      if (!listEl.children.length) listEl.remove();
    }); });
    return box;
  }

  function init() {
    if (document.getElementById('sc-ajax')) return;
    var anchor = scAnchor();
    if (!anchor) return;
    var cfg = detect();
    if (!cfg) return;
    scStyle('sc-ajax-style', CSS);
    anchor.parentNode.insertBefore(build(cfg), anchor.nextSibling);
  }

  scInit(9, init);
});


/* =====================================================================
 * 10. Оформлення замовлення: АКБ → вантажне відділення, підказки до оплати,
 *     термін відправки (як у плашці на картці, блок 1)
 * ===================================================================== */
scModule(10, function () {
  'use strict';
  if (location.pathname.indexOf('/checkout') === -1) return;

  var MIN_AH = 7;                              // правило вантажного відділення — для АКБ від 7 А·год
  // Вантажні відділення НП: «до 200 кг», «до 1100 кг» або взагалі без ваги в назві
  // («Відділення №1: вул. …») — за даними API Нової пошти такі приймають до 1100 кг
  function isCargo(t) {
    if (/поштомат|пункт/i.test(t)) return false;
    if (/до\s*(200|1000|1100)\s*кг/i.test(t)) return true;
    return /^\s*Відділення\s*№\s*\d+\s*:/i.test(t);
  }
  var POSTOMAT = /поштомат/i;
  var NP_RULES = 'https://novaposhta.ua/forbidden-items/?from=ua&to=ua#acc-h6'; // розділ «Акумулятори та зарядні пристрої»
  // Комісія NovaPay за післяплату для отримувача (novapay.ua, жовтень 2026): 2% + 20 грн; карткою NovaPay — 1% + 10 грн
  var COD = { pct: 0.02, fix: 20, npPct: 0.01, npFix: 10 };
  var PAY_HINTS = {
    '15': 'Оплата при отриманні. Нова пошта бере комісію за післяплату: 2% + 20 грн{sum} (карткою NovaPay у застосунку — 1% + 10 грн).',
    '22': 'Оплата карткою одразу після оформлення — без комісії за післяплату{save}. Залишиться лише отримати посилку.',
    '12': 'Надішлемо рахунок для оплати. Вкажіть, будь ласка, у коментарі до замовлення назву компанії та ЄДРПОУ (для ФОП — ІПН). Відправляємо після надходження коштів на рахунок.'
  };
  function orderSum() {
    var t = document.querySelector('#checkout-container .j-total-sum, .order-summary .j-total-sum, .j-total-sum');
    return t ? scSum(t.textContent) : 0;
  }
  function codFee() { var s = orderSum(); return s > 0 ? Math.round(s * COD.pct + COD.fix) : 0; }

  var CSS =
    '.sc-co-note{box-sizing:border-box;margin:8px 0 4px;padding:9px 12px;border-radius:8px;font-size:14px;line-height:1.4}' +
    '.sc-co-note.warn{background:#fff4e2;border:1px solid #f3d29b;color:#7a4306}' +
    '.sc-co-note.info{background:#f3f7fb;border:1px solid #dbe5ef;color:#3d4a57}' +
    '#sc-co-ship{background:#f1f8f1;border:1px solid #cfe5cf;color:#1d2733;margin-bottom:12px}' +
    '#sc-co-total{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:4px 0 12px;font-size:15px;color:#1d2733}' +
    '#sc-co-total b{font-size:18px;white-space:nowrap}#sc-co-total .sub{display:block;font-size:12.5px;color:#5f6b78;margin-top:2px}' +
    '#sc-co-ship .sub{font-size:13px;color:#4c5a67;margin-top:2px}';

  function el(id, cls, after) {
    var n = document.getElementById(id);
    if (!n) {
      n = document.createElement('div');
      n.id = id; n.className = 'sc-co-note ' + cls;
      after.parentNode.insertBefore(n, after.nextSibling);
    }
    return n;
  }
  function setText(n, text) {
    if (!text) { if (n) n.remove(); return; }
    if (n.getAttribute('data-t') !== text) { n.textContent = text; n.setAttribute('data-t', text); }
  }
  var form = scCheckout;
  function sel(q) { return form().querySelector(q); }
  function shown(s) {                          // select прихований плагіном — дивимося на його обгортку
    var box = s && s.parentElement;
    return !!(box && box.offsetParent !== null);
  }
  var optText = scOptText;
  // Видима кнопка «Оформити / Підтвердити» і її рядок форми (мобільна версія)
  function submitRow() {
    var btn = [].filter.call(document.querySelectorAll('#checkout-container button'), function (x) {
      return x.offsetParent !== null && /оформити|підтвердити/i.test(x.textContent);
    })[0];
    return btn && (btn.closest('.form-item') || btn);
  }

  function cartItems() {
    var out = [];
    document.querySelectorAll('.j-cart-product .order-i-title a, .j-cart-product .cart-item__title a').forEach(function (a) {
      var t = a.textContent.replace(/\s+/g, ' ').trim();
      var h = a.getAttribute('href');
      if (t && h && !out.some(function (x) { return x.url === h; })) out.push({ name: t, url: h });
    });
    return out;
  }
  function batteryAh(name) {
    if (!/акумулятор|акб|батаре/i.test(name)) return 0;
    var m = name.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(?:Ah|А\*?·?год|Аг|Ач)/i);
    return m ? parseFloat(m[1]) : 0;
  }

  /* ---- 1. АКБ і вантажне відділення ---- */
  function batteryNote() {
    var hasBat = cartItems().some(function (i) { return batteryAh(i.name) >= MIN_AH; });
    var type = sel('select[name="Delivery[delivery_type]"]');
    var wh = sel('select[name^="Delivery[delivery_method]"]');
    var old = document.getElementById('sc-co-akb');
    if (!hasBat || !type) return setText(old, '');

    var typeText = optText(type), text = '';
    if (POSTOMAT.test(typeText)) {
      text = 'За правилами Нової пошти акумулятори не приймають у поштомати — лише у вантажних відділеннях або кур’єром на адресу. Будь ласка, оберіть доставку «Новою поштою» і відділення з позначкою «до 200 кг», «до 1100 кг» або без обмеження ваги в назві. Якщо у вашому населеному пункті такого немає — підійде звичайне відділення.';
    } else if (wh && shown(wh)) {
      var hasCargo = [].some.call(wh.options, function (o) { return isCargo(o.textContent); });
      var cur = optText(wh);
      if (hasCargo && !isCargo(cur)) {
        text = 'За правилами Нової пошти акумулятори приймають лише у вантажних відділеннях або кур’єром на адресу. Щоб посилка не затрималась, оберіть, будь ласка, відділення з позначкою «до 200 кг», «до 1100 кг» або без обмеження ваги в назві.';
      } else if (!hasCargo && POSTOMAT.test(cur)) {
        text = 'За правилами Нової пошти акумулятори не приймають у поштомати. Будь ласка, оберіть відділення Нової пошти.';
      }
    }
    if (!text) return setText(old, '');
    var anchor = (wh && shown(wh) ? wh : type).parentElement;
    var n = el('sc-co-akb', 'warn', anchor);
    if (n.getAttribute('data-t') !== text) {
      n.textContent = text + ' ';
      var a = document.createElement('a');
      a.href = NP_RULES; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = 'Правила Нової пошти';
      a.style.cssText = 'color:inherit;text-decoration:underline';
      n.appendChild(a);
      n.setAttribute('data-t', text);
    }
  }

  /* ---- 2. Підказка до способу оплати ---- */
  function payNote() {
    var p = sel('select[name="Payment[payment_type]"]');
    var old = document.getElementById('sc-co-pay');
    var hint = p && shown(p) ? PAY_HINTS[p.value] : '';
    var fee = codFee();
    if (hint) hint = hint.replace('{sum}', fee ? ' — для цього замовлення ≈ ' + fee + ' грн' : '')
                         .replace('{save}', fee ? ' (економія ≈ ' + fee + ' грн)' : '');
    if (!hint) return setText(old, '');
    setText(el('sc-co-pay', 'info', p.parentElement), hint);
    if (p.value === '12') openComment();
  }

  // Безнал: лише підказка всередині поля коментаря. Кнопку «Додати коментар» НЕ натискаємо —
  // це <button> всередині форми замовлення, натискання може відправити форму.
  function openComment() {
    var ta = form().querySelector('textarea[name="Recipient[comment]"]');
    if (ta && !ta.placeholder) ta.placeholder = 'Назва компанії, ЄДРПОУ або ІПН ФОП';
  }

  /* ---- 4. Термін відправки (лише якщо всі товари в наявності) ---- */
  var stockOk = null, stockKey = '';
  function checkStock() {
    var items = cartItems(), key = items.map(function (i) { return i.url; }).join('|');
    if (!items.length || typeof scProduct !== 'function') { stockOk = false; return; }
    if (key === stockKey) return;
    stockKey = key; stockOk = null;
    Promise.all(items.map(function (i) { return scProduct(i.url); })).then(function (res) {
      if (key !== stockKey) return;
      stockOk = res.every(function (p) { return p && scInStock(p.avail); });
      shipNote();
    });
  }
  function shipNote() {
    var old = document.getElementById('sc-co-ship');
    // десктоп: .checkout-footer; мобільна: блок з кнопкою «Оформити замовлення»
    var foot = document.querySelector('#checkout-container .checkout-footer') || submitRow();
    if (!stockOk || typeof window.scShipText !== 'function' || !foot) return setText(old, '');
    var t = window.scShipText();
    var html = '🚚 <strong>' + t.main + '</strong>' + t.lines.map(function (l) { return '<div class="sub">' + l + '</div>'; }).join('');
    var n = old;
    if (!n) {
      n = document.createElement('div');
      n.id = 'sc-co-ship'; n.className = 'sc-co-note';
      foot.parentNode.insertBefore(n, foot);
    }
    if (n.getAttribute('data-t') !== html) { n.innerHTML = html; n.setAttribute('data-t', html); }
  }

  /* ---- 5. Мобільна: підсумок над кнопкою «Оформити» (кошик на мобільній — аж під кнопкою) ---- */
  function totalNote() {
    var old = document.getElementById('sc-co-total');
    var foot = submitRow();
    var sum = orderSum();
    if (window.innerWidth >= 768 || !foot || !sum || document.querySelector('#checkout-container .checkout-footer')) { if (old) old.remove(); return; }
    var dlv = window.scDlvPrice || 0;
    var html = '<span>Разом за товари' + (dlv ? '<span class="sub">+ доставка ≈ ' + dlv + ' грн — при отриманні</span>' : '') + '</span>' +
      '<b>' + Math.round(sum).toLocaleString('uk-UA') + ' грн</b>';
    if (!old) { old = document.createElement('div'); old.id = 'sc-co-total'; }
    if (old.nextElementSibling !== foot) foot.parentNode.insertBefore(old, foot);   // після плашки відправки, перед кнопкою
    if (old.getAttribute('data-t') !== html) { old.innerHTML = html; old.setAttribute('data-t', html); }
  }

  /* ---- 6. Поштомат: підпис поля «Відділення» → «Поштомат» ---- */
  function labelNote() {
    var wh = sel('select[name^="Delivery[delivery_method]"]');
    var item = wh && (wh.closest('.j-delivery-method') || wh.closest('.form-item, .form-row, .checkout-step__item'));   // десктоп: підпис у .j-delivery-method
    if (!item) return;
    var post = POSTOMAT.test(optText(sel('select[name="Delivery[delivery_type]"]')));
    [].forEach.call(item.querySelectorAll('label, div, span, dt, p'), function (e) {   // десктоп: <dt class="form-head">
      if (e.children.length) return;
      var t = e.textContent.trim();
      if (post && t === 'Відділення') e.textContent = 'Поштомат';
      else if (!post && t === 'Поштомат') e.textContent = 'Відділення';
    });
  }

  function tick() {
    try { batteryNote(); payNote(); checkStock(); shipNote(); } catch (e) {}
    try { totalNote(); labelNote(); } catch (e) {}
  }

  function start() {
    scStyle('sc-co-style', CSS);
    tick();
    // Поля оформлення — плагін selectboxit, події change ненадійні; перевіряємо стан щосекунди
    setInterval(tick, 1000);
  }
  scReady(scSafe(10, start));
});


/* =====================================================================
 * 11. Оформлення замовлення → орієнтовна вартість доставки Новою поштою з Києва
 *     Тарифи «Посилки до 30 кг» (між відділеннями, за кожне місце), жовтень 2026
 * ===================================================================== */
scModule(11, function () {
  'use strict';
  if (location.pathname.indexOf('/checkout') === -1) return;

  var CFG = SC_NP;              // тарифи — загальні з карткою товару (блок 1)

  /* ---- вага товару з картки (кеш у браузері на 7 днів) ---- */
  var wMem = {};
  var parseKg = scKg;
  function weightOf(url) {
    if (wMem[url]) return wMem[url];
    try {
      var c = JSON.parse(localStorage.getItem('scw:' + url));
      if (c && Date.now() - c.t < 7 * 86400000) return (wMem[url] = Promise.resolve(c.kg));
    } catch (e) {}
    return (wMem[url] = fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error(r.status);       // 404/500 не кешуємо на 7 днів — вага за замовчуванням лише цього разу
      return r.text();
    }).then(function (html) {
      var d = new DOMParser().parseFromString(html, 'text/html'), kg = 0;
      [].some.call(d.querySelectorAll('tr'), function (tr) {
        if (tr.children.length === 2 && /^\s*вага\s*$/i.test(tr.children[0].textContent)) { kg = parseKg(tr.children[1].textContent); return kg > 0; }
        return false;
      });
      try { localStorage.setItem('scw:' + url, JSON.stringify({ t: Date.now(), kg: kg })); } catch (e) {}
      return kg;
    }).catch(function () { return 0; }));
  }

  var form = scCheckout, optText = scOptText;
  function cityText() {
    var c = form().querySelector('[name="Recipient[delivery_city]"]');
    if (!c) return '';
    return (c.tagName === 'SELECT' ? optText(c) : c.value || '').trim();
  }
  function items() {
    return [].map.call(document.querySelectorAll('.j-cart-product'), function (li) {
      var a = li.querySelector('.order-i-title a, .cart-item__title a');
      var q = li.querySelector('input[type="number"], input[name*="quantity"], input[type="text"]');
      return a ? { url: a.getAttribute('href'), qty: Math.max(1, parseInt(q && q.value, 10) || 1) } : null;
    }).filter(Boolean);
  }
  function orderSum() {
    var t = document.querySelector('.j-total-sum');
    return t ? scSum(t.textContent) : 0;
  }

  var CSS = '#sc-co-dlv-aside{margin:-2px 0 10px;padding:0 24px;text-align:right;font-size:13px;color:#5f6b78;list-style:none}' +
    'li#sc-co-dlv-aside{margin-top:-14px;padding-right:0}' +
    '#sc-co-dlv{box-sizing:border-box;margin:8px 0 4px;padding:9px 12px;border-radius:8px;font-size:14px;line-height:1.4;background:#f3f7fb;border:1px solid #dbe5ef;color:#3d4a57}';

  var lastKey = '', lastText = '', lastShort = '', busy = false;
  // Рядок «Доставка» у блоці «Ваше замовлення» праворуч: додаємо орієнтовну суму під ним
  function renderAside(short) {
    var old = document.getElementById('sc-co-dlv-aside');
    var row = document.querySelector('#cart .j-delivery-commission');
    if (!short || !row || row.offsetParent === null) { if (old) old.remove(); return; }
    if (!old || old.previousElementSibling !== row) {
      if (old) old.remove();
      old = document.createElement(row.tagName === 'LI' ? 'li' : 'div'); old.id = 'sc-co-dlv-aside';   // мобільна: список <ul>
      row.parentNode.insertBefore(old, row.nextSibling);
    }
    if (old.textContent !== short) old.textContent = short;
  }

  function render(text, short) {
    renderAside(text ? short : '');
    var old = document.getElementById('sc-co-dlv');
    var type = form().querySelector('select[name="Delivery[delivery_type]"]');
    var wh = form().querySelector('select[name^="Delivery[delivery_method]"]');
    var anchor = wh && wh.parentElement && wh.parentElement.offsetParent !== null ? wh.parentElement : (type && type.parentElement);
    if (!text || !anchor) { if (old) old.remove(); return; }
    if (!old) {
      old = document.createElement('div'); old.id = 'sc-co-dlv';
      var after = document.getElementById('sc-co-akb');
      after = after && after.parentNode === anchor.parentNode ? after : anchor;
      after.parentNode.insertBefore(old, after.nextSibling);
    }
    if (old.textContent !== text) old.textContent = text;
  }

  function tick() {
    var list = items(), city = cityText(), sum = orderSum();
    var typeText = optText(form().querySelector('select[name="Delivery[delivery_type]"]'));
    var whText = optText(form().querySelector('select[name^="Delivery[delivery_method]"]'));
    var key = JSON.stringify([list, city, sum, typeText, whText]);
    if (busy) return;
    if (key === lastKey) return render(lastText, lastShort);   // Хорошоп іноді перемальовує блок доставки
    if (!list.length || !city || sum >= CFG.freeFrom) { lastKey = key; lastText = ''; window.scDlvPrice = 0; return render(''); }
    busy = true;
    Promise.all(list.map(function (i) { return weightOf(i.url); })).then(function (ws) {
      busy = false; lastKey = key;
      var kg = 0;
      list.forEach(function (it, n) { kg += (ws[n] || CFG.defaultKg) * it.qty; });
      if (kg > CFG.maxKg) { window.scDlvPrice = 0; return render(lastText = 'Доставка Новою поштою: вартість для посилки понад 30 кг уточнимо після оформлення.', lastShort = 'вартість уточнимо'); }
      var local = /^(м\.\s*)?Київ$/i.test(city.replace(/\s*\(.*\)\s*$/, ""));
      var add = 0;
      if (!local && /^(с\.|смт|сел\.|с-ще|селище)/i.test(city)) add += CFG.village;
      var courier = /кур/i.test(typeText);
      if (courier) add += CFG.courier;
      else if (/поштомат/i.test(typeText) || /поштомат/i.test(whText)) add += CFG.postomat;
      var price = scNpPrice(kg, sum, local, add);
      window.scDlvPrice = price;
      render(lastText = (courier ? 'Доставка кур’єром Нової пошти' : 'Доставка Новою поштою') + ' — орієнтовно ' + price + ' грн, оплачується при отриманні за тарифами перевізника.', lastShort = 'орієнтовно ≈ ' + price + ' грн');
    }, function () { busy = false; });
  }

  function start() {
    scStyle('sc-co-dlv-style', CSS);
    var t = scSafe(11, tick);
    t();
    setInterval(t, 1000);
  }
  scReady(scSafe(11, start));
});


/* =====================================================================
 * 12. Google Customer Reviews — запрошення залишити відгук після замовлення
 *     Лише на сторінці «Ваше замовлення отримано», з реальним номером, e-mail і датою.
 *     Без e-mail Google опитування не надсилає — тоді нічого не показуємо.
 * ===================================================================== */
scModule(12, function () {
  'use strict';
  var MERCHANT_ID = 5698392861;
  var onComplete = /checkout.*complete|complete.*order/i.test(location.pathname);

  // Старий шаблонний код у налаштуваннях Хорошопа викликає renderOptIn на кожній сторінці з «ORDER_ID» —
  // вимикаємо його, щоб не було помилок (сам шаблон краще видалити зі «Скриптів»)
  try { window.renderOptIn = function () {}; } catch (e) {}
  if (!onComplete) return;

  function data() {
    var main = document.querySelector('main') || document.body;
    var t = (main.innerText || '').replace(/\u00a0/g, ' ');
    var num = (t.match(/замовлен\S*\s*(?:№|#)?\s*(\d{3,10})/i) || [])[1];
    var cut = t.search(/ваше замовлення\s*\n/i);                     // e-mail клієнта — у блоці даних до списку товарів
    var head = cut > 0 ? t.slice(0, cut) : t;
    // лише e-mail після підпису «E-mail» і не адреса самого магазину
    var email = (head.match(/e-?mail\s*:?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i) || [])[1];
    if (email && /safecity/i.test(email)) email = '';
    return num && email ? { order_id: num, email: email } : null;
  }

  function render() {
    var d = data();
    if (!d || !window.gapi || window.__scGcrDone) return;
    window.__scGcrDone = true;
    var date = typeof window.scDeliveryDate === 'function' ? window.scDeliveryDate() : '';
    window.gapi.load('surveyoptin', function () {
      window.gapi.surveyoptin.render({
        merchant_id: MERCHANT_ID,
        order_id: d.order_id,
        email: d.email,
        delivery_country: 'UA',
        estimated_delivery_date: date
      });
    });
  }

  function start() {
    if (!data()) return;                                   // немає e-mail — Google не зможе надіслати опитування
    window.scRenderOptIn = render;
    if (window.gapi && window.gapi.load) return render();
    var s = document.createElement('script');
    s.src = 'https://apis.google.com/js/platform.js?onload=scRenderOptIn';
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }

  var tries = 0;
  (function wait() {                                        // сторінка може дорендерюватись — чекаємо дані до 20 с
    if (data() || tries++ > 40) return start();
    setTimeout(wait, 500);
  })();
});


/* =====================================================================
 * 13. Мобільна картка → закріплена внизу панель «ціна + Купити»
 *     Видно, поки основної кнопки «Купити» немає на екрані (ще не догорнули або вже прогорнули)
 * ===================================================================== */
scModule(13, function () {
  'use strict';

  var CSS =
    '#sc-sticky{position:fixed;left:0;right:0;bottom:0;z-index:350;display:flex;align-items:center;gap:12px;' +
    'padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));background:#fff;border-top:1px solid #e3e8ee;' +
    'box-shadow:0 -4px 16px rgba(0,0,0,.08);transform:translateY(110%);transition:transform .2s ease;box-sizing:border-box}' +
    '#sc-sticky.on{transform:none}' +
    '#sc-sticky .scs-i{flex:1;min-width:0;line-height:1.25}' +
    '#sc-sticky .scs-n{display:block;font-size:12px;color:#5f6b78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#sc-sticky .scs-p{display:block;font-size:18px;font-weight:700;color:#1d2733;white-space:nowrap}' +
    '#sc-sticky button{flex:0 0 auto;min-width:130px;height:44px;margin:0}' +
    'body.sc-sticky-pad{padding-bottom:72px}';

  var BUY = '.product-card__buy-button button, button.j-buy-button-add[data-skin="mobile"]';

  function init() {
    if (document.getElementById('sc-sticky')) return;
    var buy = document.querySelector(BUY);
    if (!buy || window.innerWidth >= 768) return;                 // лише мобільна версія
    if (!document.querySelector(SC_AVAIL_SEL)) return;
    var priceMeta = document.querySelector('[itemprop="offers"] [itemprop="price"], .product-card__price [itemprop="price"]');
    var pn = priceMeta ? parseFloat(priceMeta.getAttribute('content')) : 0;
    if (!pn) return;

    scStyle('sc-sticky-style', CSS);
    var bar = document.createElement('div');
    bar.id = 'sc-sticky';
    bar.innerHTML = '<span class="scs-i"><span class="scs-n"></span><span class="scs-p"></span></span>' +
      '<button type="button" class="btn btn--primary"></button>';
    bar.querySelector('.scs-n').textContent = scH1().trim();
    bar.querySelector('.scs-p').textContent = Math.round(pn).toLocaleString('uk-UA') + ' грн';
    var btn = bar.querySelector('button');
    // Хорошоп може перемалювати кнопку після «Купити» — тоді беремо нову, інакше клік іде у від'єднаний елемент,
    // а панель за нульовими координатами старої кнопки більше не з'являється
    function cur() {
      if (!buy.isConnected) { var b = document.querySelector(BUY); if (b) buy = b; }
      return buy;
    }
    function sync() {                                             // «Купити» / «В кошику» — як в основній кнопці
      var t = (cur().textContent || '').replace(/\s+/g, ' ').trim() || 'Купити';
      if (btn.textContent !== t) btn.textContent = t;
    }
    sync();
    btn.addEventListener('click', function () { cur().click(); setTimeout(scSafe(13, sync), 1500); });
    document.body.appendChild(bar);
    document.body.classList.add('sc-sticky-pad');

    var ticking = false;
    function check() {                                            // показуємо, поки основної кнопки не видно (вище або нижче екрана)
      ticking = false;
      var r = cur().getBoundingClientRect();
      var hidden = r.bottom < 0 || r.top > window.innerHeight - 8;
      if (bar.classList.contains('on') !== hidden) { bar.classList.toggle('on', hidden); if (hidden) sync(); }
    }
    var safeCheck = scSafe(13, check);
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; setTimeout(safeCheck, 60); }   // не rAF: у фонових вкладках він «засинає»
    }, { passive: true });
    check();
  }

  scIdle(scSafe(13, init));
});


/* =====================================================================
 * 14. Картка товару → «Знайшли дешевше? Напишіть нам»
 *     Telegram-бот (start=cheaper_<артикул>), Viber і WhatsApp з готовим текстом
 * ===================================================================== */
scModule(14, function () {
  'use strict';

  var CSS =
    '#sc-cheaper{margin:10px 0 0;font-size:14px;line-height:1.4}' +
    '#sc-cheaper .scc-open{background:none;border:0;padding:0;color:#2b7de9;cursor:pointer;font:inherit;text-decoration:underline;text-underline-offset:2px}' +
    '#sc-cheaper .scc-box{margin-top:8px;padding:12px;border:1px solid #dbe5ef;border-radius:10px;background:#f6f9fc}' +
    '#sc-cheaper .scc-t{color:#3d4a57;margin:0 0 10px;font-size:13px}' +
    '#sc-cheaper .scc-b{display:flex;flex-wrap:wrap;gap:8px}' +
    '#sc-cheaper .scc-b a{flex:1 1 0;min-width:0;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 10px;border-radius:8px;color:#fff;text-decoration:none;font-weight:600;font-size:14px}';

  function init() {
    if (document.getElementById('sc-cheaper')) return;
    var anchor = scAnchor();
    if (!anchor) return;
    if (!document.querySelector(SC_AVAIL_SEL)) return;
    var name = scH1().replace(/\s+/g, ' ').trim();
    if (!name) return;
    var art = scArt();
    var url = location.origin + location.pathname;
    var msg = 'Добрий день! Знайшов дешевше: ' + name + (art ? ' (арт. ' + art + ')' : '') + '\n' + url +
              '\nПосилання на іншу пропозицію: ';

    scStyle('sc-cheaper-style', CSS);
    var box = document.createElement('div');
    box.id = 'sc-cheaper';
    box.innerHTML =
      '<button type="button" class="scc-open">Знайшли дешевше? Напишіть нам</button>' +
      '<div class="scc-box" hidden>' +
        '<div class="scc-t">Надішліть посилання на пропозицію — перевіримо й запропонуємо ціну.</div>' +
        '<div class="scc-b">' +
          (SC_CLIENT_BOT ? '<a target="_blank" rel="noopener" style="background:#2AABEE" data-m="tg">✈️ Telegram</a>' : '') +
          '<a style="background:#7360F2" data-m="viber">📞 Viber</a>' +
          '<a target="_blank" rel="noopener" style="background:#25D366" data-m="wa">💬 WhatsApp</a>' +
        '</div>' +
      '</div>';
    if (SC_CLIENT_BOT) box.querySelector('[data-m="tg"]').href = 'https://t.me/' + SC_CLIENT_BOT + '?start=cheaper_' + (art || 'x').replace(/[^\w-]/g, '').slice(0, 50);
    box.querySelector('[data-m="viber"]').href = 'viber://chat?number=%2B' + SC_PHONE + '&draft=' + encodeURIComponent(msg);
    box.querySelector('[data-m="wa"]').href = 'https://wa.me/' + SC_PHONE + '?text=' + encodeURIComponent(msg);
    box.querySelector('.scc-open').addEventListener('click', function () {
      var b = box.querySelector('.scc-box'); b.hidden = !b.hidden;
    });

    var trust = document.getElementById('sc-trust');               // після плашки довіри (блок 15), якщо вона вже є
    if (trust && trust.parentNode) { trust.parentNode.insertBefore(box, trust.nextSibling); return; }
    var ship = document.getElementById('ship-info');               // одразу під блоком «Купити» / плашкою відправки
    var after = anchor.nextElementSibling && anchor.nextElementSibling.id === 'ship-info' ? anchor.nextElementSibling : anchor;
    if (ship && ship.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_PRECEDING) after = ship;
    after.parentNode.insertBefore(box, after.nextSibling);
    // на десктопі блок кнопок має великий нижній відступ — підтягуємо посилання ближче до кнопок
    var mb = parseFloat(getComputedStyle(after).marginBottom) || 0;
    if (mb > 16) box.style.marginTop = (10 - mb) + 'px';
  }

  scInit(14, init);
});


/* =====================================================================
 * 15. Картка товару → плашка довіри під «Купити» (картки як у TRINITI):
 *     Оплата при отриманні · Гарантія N місяців (з характеристик товару) · Повернення 14 днів
 * ===================================================================== */
scModule(15, function () {
  'use strict';

  var GREEN = '#38ab87';
  var ICONS = {
    pay: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#38ab87" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.6"/><path d="M6 9.5v.01M18 15.5v.01"/></svg>',
    warranty: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5l8-3z" fill="#f59e0b"/><path d="M8.3 12.2l2.5 2.5 4.9-5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ret: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="11" fill="#3b82f6"/><path d="M16.6 9.4A5 5 0 0 0 7.5 9.8M7.4 14.6a5 5 0 0 0 9.1-.4" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/><path d="M16.9 6.8v2.9H14M7.1 17.2v-2.9H10" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  var CSS =
    '#sc-trust{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));gap:8px;margin:12px 0 0;padding:0;list-style:none;box-sizing:border-box}' +
    '#sc-trust li{margin:0;padding:10px;border:1px solid #e3e8ee;border-radius:10px;background:#fff;box-sizing:border-box;min-width:0}' +
    '#sc-trust li:before{content:none}' +
    '#sc-trust .sct-in{display:block;color:inherit;text-decoration:none}' +
    '#sc-trust .sct-i{display:block;width:22px;height:22px;margin-bottom:6px}' +
    '#sc-trust .sct-i svg{display:block}' +
    '#sc-trust .sct-t{display:block;font-size:14px;font-weight:600;color:#1d2733;line-height:1.25;overflow-wrap:break-word}' +
    '#sc-trust .sct-v{display:block;font-size:13px;color:' + GREEN + ';line-height:1.3;margin-top:2px;overflow-wrap:break-word}' +
    // широка колонка (десктоп) — іконка зліва, як у TRINITI
    '#sc-trust.wide li{display:flex}#sc-trust.wide .sct-in{display:flex;align-items:center;gap:10px;width:100%}' +
    '#sc-trust.wide .sct-i{flex:0 0 22px;margin:0}' +
    '#sc-trust li:hover{border-color:#cfd8e2}';

  // «24 міс.» / «12 місяців» / «1 рік» → 24 / 12 / 12
  function warrantyMonths() {
    var v = scGet(scFeatures(), /^(гарантія|гарантия|гарантійний термін|гарантийный срок)/);
    var m = v.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(міс|мес|m|рік|роки|років|год|лет|р\.?)/i);
    if (!m) return 0;
    var n = parseFloat(m[1]);
    if (/^(рік|роки|років|год|лет|р)/i.test(m[2])) n = n * 12;
    return n >= 1 && n <= 120 ? Math.round(n) : 0;
  }
  function months(n) {
    var d = n % 10, dd = n % 100;
    return n + ' ' + (d === 1 && dd !== 11 ? 'місяць' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'місяці' : 'місяців');
  }

  function init() {
    if (document.getElementById('sc-trust')) return;
    var anchor = scAnchor();
    if (!anchor) return;
    var items = [{ i: 'pay', t: 'Оплата', v: 'при отриманні', href: '/oplata-i-dostavka/' }];
    var w = warrantyMonths();
    if (w) items.push({ i: 'warranty', t: 'Гарантія', v: months(w) });
    items.push({ i: 'ret', t: 'Повернення', v: '14 днів', href: '/obmin-ta-povernennya/' });

    scStyle('sc-trust-style', CSS);
    var lang = /^\/ru\//.test(location.pathname) ? '/ru' : '';   // лише /ru: сторінок оплати/повернення англійською немає
    var ul = document.createElement('ul');
    ul.id = 'sc-trust';
    ul.style.setProperty('--n', items.length);
    items.forEach(function (it) {
      var li = document.createElement('li');
      var inner = document.createElement(it.href ? 'a' : 'div');
      inner.className = 'sct-in';
      if (it.href) { inner.href = lang + it.href; inner.target = '_blank'; inner.rel = 'noopener'; }
      inner.innerHTML = '<span class="sct-i" aria-hidden="true">' + ICONS[it.i] + '</span><span><span class="sct-t"></span><span class="sct-v"></span></span>';
      inner.querySelector('.sct-t').textContent = it.t;
      inner.querySelector('.sct-v').textContent = it.v;
      li.appendChild(inner);
      ul.appendChild(li);
    });

    // одразу під «Купити» / плашкою відправки (блок 1), перед «Знайшли дешевше?» (блок 14)
    var cheaper = document.getElementById('sc-cheaper');
    if (cheaper && cheaper.parentNode) {
      cheaper.parentNode.insertBefore(ul, cheaper);
      cheaper.style.marginTop = '';                                  // відступ тепер у плашки довіри
    } else {
      var ship = document.getElementById('ship-info');
      var after = ship && ship.parentNode === anchor.parentNode ? ship : anchor;
      after.parentNode.insertBefore(ul, after.nextSibling);
    }
    // на десктопі блок кнопок має великий нижній відступ — підтягуємо плашку ближче до кнопок
    var prev = ul.previousElementSibling;
    var mb = prev ? parseFloat(getComputedStyle(prev).marginBottom) || 0 : 0;
    if (mb > 16) ul.style.marginTop = (12 - mb) + 'px';
    // кожна картка ширша за 150 px — іконку ставимо зліва
    if (ul.offsetWidth / items.length >= 150) ul.className = 'wide';
  }

  scInit(15, init);
});


/* =====================================================================
 * 16. Товар не в наявності → «Повідомити в Telegram, коли з'явиться»
 *     Клієнтський бот (start=stock_<артикул>) підписує клієнта і сам пише йому,
 *     щойно товар з'явиться у фіді TRINITI; менеджеру — сповіщення про попит.
 * ===================================================================== */
scModule(16, function () {
  'use strict';

  var CSS =
    '#sc-stock{display:flex;align-items:center;gap:10px;box-sizing:border-box;width:100%;margin:12px 0 0;padding:10px 12px;' +
    'border:1px solid #cfe3f5;border-radius:10px;background:#f4f9fe;color:#1d2733;text-decoration:none;font-size:14px;line-height:1.35}' +
    '#sc-stock:hover{border-color:#9fcbef}' +
    '#sc-stock svg{flex:0 0 22px}' +
    '#sc-stock .scs-s{display:block;font-size:12.5px;color:#5f6b78;margin-top:1px}';
  var TG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#2AABEE"/>' +
    '<path d="M5.4 11.7l11.2-4.3c.5-.2 1 .1.8.9l-1.9 9c-.1.6-.5.8-1 .5l-2.9-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-3 5.4-4.9c.2-.2 0-.3-.3-.1l-6.7 4.2-2.9-.9c-.6-.2-.6-.6.1-.9z" fill="#fff"/></svg>';

  function init() {
    if (document.getElementById('sc-stock') || typeof SC_CLIENT_BOT === 'undefined' || !SC_CLIENT_BOT) return;
    var anchor = scAnchor();
    if (!anchor) return;
    var av = document.querySelector('[itemprop="availability"]');
    var href = av ? av.getAttribute('href') || av.getAttribute('content') || '' : '';
    if (!/OutOfStock|SoldOut|Discontinued/i.test(href)) return;   // лише «Немає в наявності»
    var art = scArt().replace(/[^\w-]/g, '').slice(0, 50);
    if (!art) return;

    scStyle('sc-stock-style', CSS);
    var a = document.createElement('a');
    a.id = 'sc-stock';
    a.href = 'https://t.me/' + SC_CLIENT_BOT + '?start=stock_' + art;
    a.target = '_blank'; a.rel = 'noopener';
    a.innerHTML = TG + '<span><b>Повідомити в Telegram, коли з’явиться</b>' +
      '<span class="scs-s">Без e-mail і телефону — бот напише сам, щойно товар надійде</span></span>';
    anchor.parentNode.insertBefore(a, anchor.nextSibling);

    // відступи: плашка довіри (блок 15) могла підтягнутися до кнопок від’ємним відступом — тепер він у нас
    var trust = document.getElementById('sc-trust');
    if (trust && trust.previousElementSibling === a && trust.style.marginTop) {
      a.style.marginTop = trust.style.marginTop; trust.style.marginTop = '';
    } else {
      var mb = parseFloat(getComputedStyle(anchor).marginBottom) || 0;
      if (mb > 16) a.style.marginTop = (12 - mb) + 'px';
    }
  }

  scInit(16, init);
});


/* =====================================================================
 * 17. Картка товару → компактніший верх, щоб ціна і «Купити» були на першому екрані
 *     • назва товару дрібніше (довгі назви на 5–6 рядків)
 *     • вибір модифікації з одним-єдиним варіантом (напр. «Колір: Білий») ховаємо
 * ===================================================================== */
scModule(17, function () {
  'use strict';

  var CSS =
    '.product-header .product-title,.product-header__block .product-title{font-size:26px;line-height:1.3}' +          // десктоп (було 32px)
    '.product__section--header h1.heading--xl{font-size:20px;line-height:1.3}' +                                         // мобільна (було 24px)
    '.sc-mod-one{display:none!important}';

  function hideSingle() {
    [].forEach.call(document.querySelectorAll('.modification'), function (m) {
      var n = m.querySelectorAll('.modification__button').length;
      m.classList.toggle('sc-mod-one', n === 1);
    });
    [].forEach.call(document.querySelectorAll('.product__block--modifications'), function (b) {   // мобільна обгортка
      var all = b.querySelectorAll('.modification'), one = b.querySelectorAll('.modification.sc-mod-one');
      b.classList.toggle('sc-mod-one', all.length > 0 && all.length === one.length);
    });
  }

  function init() {
    if (!document.querySelector('[itemtype*="schema.org/Product"]')) return;
    scStyle('sc-head-style', CSS);
    hideSingle();
  }

  scReady(scSafe(17, init));
  window.addEventListener('load', scSafe(17, hideSingle));
});


/* =====================================================================
 * 18. Cookie-банер Хорошопа → вузька смуга внизу замість вікна посередині
 *     Той самий банер і та сама кнопка «Погодитися» (згода зберігається Хорошопом),
 *     змінюємо лише вигляд: без затемнення, сторінку можна гортати одразу.
 * ===================================================================== */
scModule(18, function () {
  'use strict';
  var SHORT = 'Ми використовуємо cookie для роботи сайту та статистики. ';

  var CSS =
    '#cookies-modal.is-visible{position:fixed!important;top:auto!important;left:0!important;right:0!important;bottom:0!important;height:auto!important;' +
      'overflow:visible!important;background:none!important;z-index:10000!important}' +
    '#cookies-modal.is-visible .modal__box{position:relative!important;top:auto!important;left:0!important;right:0!important;margin:0 auto!important;width:100%!important;max-width:1180px;' +
      'box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px))!important;' +
      'border-radius:12px 12px 0 0;box-shadow:0 -4px 18px rgba(0,0,0,.14);transform:none!important}' +
    '#cookies-modal .modal__body,#cookies-modal .modal__content{flex:1;min-width:0;padding:0!important;margin:0!important}' +
    '#cookies-modal .text p{margin:0!important;font-size:13px;line-height:1.4}' +
    '#cookies-modal .text p:first-child{display:none}' +
    '#cookies-modal .modal__close-button{position:static!important;flex:0 0 auto;margin:0!important;padding:0!important;width:auto!important}' +
    '#cookies-modal .modal__close-button .btn{width:auto!important;min-width:0;height:38px;padding:0 18px;white-space:nowrap}' +
    'body.sc-cookie-bar .backdrop{display:none!important}' +
    // десктоп: панель уже внизу — робимо її нижчою
    '#cookies-panel .text p:first-child{display:none}#cookies-panel .text p{margin:0!important;font-size:13px;line-height:1.4}' +
    '#cookies-panel .panel__content{padding-top:10px!important;padding-bottom:10px!important;align-items:center;gap:16px}';

  function visible(m) { return m && m.classList.contains('is-visible'); }
  function otherModal() {
    return [].some.call(document.querySelectorAll('.modal.is-visible'), function (x) { return x.id !== 'cookies-modal'; });
  }

  var timer = 0;
  function shorten(root) {
    var p = root && root.querySelectorAll('.text p')[1];
    if (!p || p.getAttribute('data-sc')) return;                    // коротший текст, посилання на угоду лишаємо
    var a = p.querySelector('a');
    p.textContent = SHORT;
    if (a) { a.textContent = 'Детальніше'; p.appendChild(a); }
    p.setAttribute('data-sc', '1');
  }
  function style() { scStyle('sc-cookie-style', CSS); }

  function apply() {
    var panel = document.getElementById('cookies-panel');
    if (panel && panel.getClientRects().length) { style(); shorten(panel); }   // fixed-елемент: offsetParent завжди null
    var m = document.getElementById('cookies-modal');
    if (!visible(m)) { document.body && document.body.classList.remove('sc-cookie-bar'); if (timer) { clearInterval(timer); timer = 0; } return false; }
    style(); shorten(m);
    var box = m.querySelector('.modal__box'); if (box) box.style.marginTop = '';
    if (otherModal()) { document.body.classList.remove('sc-cookie-bar'); return true; }   // відкрито інше вікно (кошик) — не заважаємо
    document.body.classList.add('sc-cookie-bar');
    if (document.body.style.overflow === 'hidden') document.body.style.overflow = '';
    document.documentElement.classList.remove('modal-opened');
    return true;
  }

  // iOS: Хорошоп (body-scroll-lock) блокує свайп слухачем touchmove на document — поки відкрита лише cookie-смуга,
  // зупиняємо подію на <html>, до того слухача (свайпи галерей на самих елементах працюють як раніше)
  document.documentElement.addEventListener('touchmove', function (e) {
    var m = document.getElementById('cookies-modal');
    if (visible(m) && !otherModal() && !m.contains(e.target)) e.stopPropagation();
  }, { passive: true });

  var safeApply = scSafe(18, apply);
  var start = scSafe(18, function () {
    if (apply() && !timer) timer = setInterval(safeApply, 500);      // Хорошоп може знову заблокувати прокрутку
  });
  scReady(start);
  window.addEventListener('load', start);
  setTimeout(start, 1500);
});


/* =====================================================================
 * 19. Підбір супутніх товарів за моделлю — картки з фото й ціною
 *     Одна таблиця правил RULES: кожне правило за назвою товару (h1) і характеристиками
 *     повертає заголовок, текст, список товарів (показуються лише ті, що в наявності) і посилання.
 *     • Starlink Mini: перехідник Type-C → DC і кабелі з USB-C → повербанки Choetech з USB-C PD 20 В;
 *       подовжувачі DC/DC → перехідник + повербанки. 22,5 Вт павербанки не видають 20 В — Mini не запуститься.
 *     • Електромагнітні замки Kraft / Trinix → кронштейни під модель (сумісність — з описів кронштейнів)
 *     • IP-камери Ajax → кронштейни MountCam (сумісність — ajax.systems: A1/B1 — BulletCam, TurretCam, DomeCam Mini і HL;
 *       A2/B2 — ще й TurretCam / DomeCam HLVF і Superior HLVF; BulletCam HLVF не сумісна з жодним MountCam)
 *     • Зарядні станції OUKITEL → чохол під модель, дод. батарея; сонячні панелі Kraft (XT60) — якщо в описі станції є XT60
 *     • ІЧ-прожектори 12 В → блок живлення зі струмом ≥ споживання × 1,25
 *     • Marstek: сумісність лише в межах бренду (з описів TRINITI і сторінок Marstek, 05.11.2026):
 *       Venus D: інверторний модуль MST-HI-2200 ↔ батареї MST-E2.5ST-D (1–6 шт.; без батареї модуль не працює);
 *       Venus E 3.0 / C / E Mini → мікроінвертор Marstek для панелей (купується окремо), E 3.0 і C — ще смартбокс DB63S;
 *       мікроінвертори Saturn-M → ці системи; лічильник CT002 ↔ Venus E 3.0, C, D, A; смартбокс DB63S → Venus E 3.0 і C.
 *     Товари вантажаться, лише коли покупець догортає до блоку (scNear), з кешем на 1 год (scProduct).
 * ===================================================================== */
scModule(19, function () {
  'use strict';

  var MAX = 3;
  var PSU12 = '/bloky-zhyvlennia-12-24-48v/filter/presence=1;vixdnaNapruga=1/';

  // --- Starlink Mini ---
  var SL_ADAPTER = { url: '/perekhidnyk-dlia-zhyvlennia-starlink-mini-type-c-na-dc-65-vt/',
                     note: 'Вставляється в USB-C повербанка, до гнізда DC — цей подовжувач' };
  var PB = {
    b733:  { url: '/power-bank-b733-50000mah-black-choetech/',
             note: 'USB-C 65 Вт (20 В) · ≈ 4–6 год роботи Mini' },
    b1012: { url: '/poverbank-20000mah-choetech-b1012-grey-100w-z-eu-adapterom-qc3.0-pd3.0-vbudovanyi-kabel/',
             note: 'USB-C 100 Вт (20 В / 5 А) · ≈ 1,5–2,5 год роботи Mini' },
    b815:  { url: '/poverbank-20000mah-choetech-b815-grey-130w-qc3.0-pd3.0-tft-smart-dysplei-vbudovanyi-kabel/',
             note: 'USB-C 100 Вт (20 В / 5 А) · ≈ 1,5–2,5 год роботи Mini' }
  };

  // --- Кронштейни для електромагнітних замків ---
  var L_NOTE = 'L — якщо двері відчиняються від замка';
  var BR = {
    k200lK: { url: '/kronshtein-k-200l-kraft/',  note: L_NOTE },
    k200lT: { url: '/kronshtein-k-200l-trinix/', note: L_NOTE },
    k200uT: { url: '/kronshtein-k-200u-trinix/', note: 'U — для односторонніх скляних дверей' },
    k300lK: { url: '/kronshtein-k-300l-kraft/',  note: L_NOTE },
    k300lT: { url: '/kronshtein-k-300l-trinix/', note: L_NOTE },
    k300zT: { url: '/kronshtein-k-300z-trinix/', note: 'Z — кріплення якірної планки' },
    k300ds: { url: '/kronshtein-k-300lds-trinix/', note: 'L-кронштейн саме під версію (DS)' },
    k500lK: { url: '/kronshtein-k-500l-kraft/',  note: L_NOTE },
    k500lT: { url: '/kronshtein-k-500l-trinix/', note: L_NOTE }
  };
  var LOCK_LINKS = [
    { text: 'Кнопки виходу →', url: '/knopky-vykhodu/2368/' },
    { text: 'Блоки живлення 12 В →', url: PSU12 }
  ];

  // --- OUKITEL ---
  var OK = {
    caseP5000:  { url: '/chokhol-dlia-p5000e/',      note: 'Чохол саме під цю модель' },
    caseP2001:  { url: '/chokhol-dlia-p2001e-plus/', note: 'Чохол саме під цю модель' },
    caseBP2000: { url: '/chokhol-dlia-bp2000e/',     note: 'Чохол саме під цю модель' },
    batB2000:   { url: '/dodatkova-batareia-b2000-oukitel/',  note: 'Додаткова батарея — подвоює ємність' },
    batB2000L:  { url: '/dodatkova-batareia-b2000l-oukitel/', note: 'Додаткова батарея — +2048 Вт·год' },
    sol200: { url: '/soniachna-panel-kfp-200spxt60i-dlia-zariadnykh-stantsii-oukitel-bigblue-ecoflow/', note: '200 Вт, XT60i — підключається до входу XT60 станції напряму' },
    sol100: { url: '/soniachna-panel-kfp-100spxt60i-dlia-zariadnykh-stantsii-oukitel-bigblue-ecoflow/', note: '100 Вт, XT60i — підключається до входу XT60 станції напряму' }
  };

  // --- Кронштейни Ajax MountCam (у переліку — що є на сайті; A1 і A2 лише білі) ---
  var MC = {
    a1w: { url: '/kronshtein-ajax-mountcam-a1-white-dlia-drotovoi-ip-kamery-serii-bulletcam-turretcam-domeca/', note: 'A1 — короткий виніс' },
    a2w: { url: '/kronshtein-ajax-mountcam-a2-white-dlia-drotovoi-ip-kamery-ajax-serii-bulletcam-turretcam-d/', note: 'A2 — короткий виніс, перехідник під HLVF' },
    b1b: { url: '/kronshtein-ajax-mountcam-b1-black-dlia-drotovoi-ip-kamery-serii-bulletcam-turretcam-domeca/', note: 'B1 — довгий виніс' },
    b1w: { url: '/kronshtein-ajax-mountcam-b1-white-dlia-drotovoi-ip-kamery-serii-bulletcam-turretcam-domeca/', note: 'B1 — довгий виніс' },
    b2b: { url: '/kronshtein-ajax-mountcam-b2-black-dlia-drotovoi-ip-kamery-ajax-serii-bulletcam-turretcam-d/', note: 'B2 — довгий виніс, перехідник під HLVF' },
    b2w: { url: '/kronshtein-ajax-mountcam-b2-white-dlia-drotovoi-ip-kamery-ajax-serii-bulletcam-turretcam-d/', note: 'B2 — довгий виніс, перехідник під HLVF' }
  };

  // --- Блоки живлення 12 В (адаптери Kraft) ---
  var PSU = {
    a1: { url: '/blok-zhyvlennia-krf-1201ps-kraft-12v-1a/', note: '12 В / 1 А' },
    a2: { url: '/blok-zhyvlennia-krf-1202ps-kraft-12v-2a/', note: '12 В / 2 А' },
    a3: { url: '/blok-zhyvlennia-krf-1203ps-kraft-12v-3a/', note: '12 В / 3 А' },
    a5: { url: '/blok-zhyvlennia-krf-1205ps-kraft-12v-5a/', note: '12 В / 5 А' },
    b5: { url: '/blok-zhyvlennia-krf-1205pb-kraft-12v-5a/', note: '12 В / 5 А, для монтажу в бокс' }
  };

  // --- Marstek (лише товари Marstek; сумісність — з описів TRINITI та сторінок Marstek) ---
  var MS = {
    ve3:   { url: '/systema-nakopychennia-enerhii-all-in-one-venus-e-3.0-marstek/', note: 'Venus E 3.0 · 5,12 кВт·год, 2,5 кВт' },
    vc:    { url: '/systema-nakopychennia-enerhii-all-in-one-venus-c-marstek/', note: 'Venus C · 2,56 кВт·год, 2,5 кВт' },
    vmini: { url: '/systema-nakopychennia-enerhii-all-in-one-venus-e-mini-marstek/', note: 'Venus E Mini · 2 кВт·год, 1,5 кВт' },
    va:    { url: '/systema-rezervnoho-zhyvlennia-invertor-ta-batareia-vse-v-odnomu-marstek-venus-a-potuzhnist/', note: 'Venus A · 2,12 кВт·год, свій сонячний вхід' },
    dInv:  { url: '/invertor-marstek-mst-hi-2200-do-systemy-nakopychennia-enerhii-marstek-venus-d-2-2-kvt-ip65/', note: 'Інверторний модуль Venus D · 2,2 кВт, 4 MPPT' },
    dBat:  { url: '/dodatkova-batareia-marstek-mst-e2-5st-d-do-systemy-nakopychennia-enerhii-marstek-venus-d-2/', note: 'Батарея Venus D · 2,56 кВт·год, до 6 шт.' },
    dKit:  { url: '/systema-nakopychennia-enerhii-invertor-ta-batareia-marstek-venus-d-potuzhnist-2-2-kvt-ener/', note: 'Комплект Venus D · інвертор + батарея 2,56 кВт·год' },
    ct:    { url: '/rozumnyi-lichilnyk-ct002-marstek/', note: 'Лічильник CT002 · для режиму власного споживання' },
    db63:  { url: '/smartboks-odnofaznyi-marstek-db63s-dlia-keruvannia-systemamy-nakopychennia-enerhii-serii-marstek-venus/', note: 'Смартбокс DB63S · до 4 Venus паралельно' },
    m4:    { url: '/mikroinvertor-dlia-soniachnykh-panelei-2kw-marstek-m4-2000-saturn-m-4-mppt-on-grid/', note: 'Мікроінвертор 2 кВт · 4 панелі' },
    m2:    { url: '/mikroinvertor-dlia-soniachnykh-panelei-1kw-marstek-m2-1000-saturn-m-2-mppt-on-grid/', note: 'Мікроінвертор 1 кВт · 2 панелі' }
  };

  var num = scNum;

  // Правила: перше, що повернуло налаштування, і показується
  var RULES = [
    // ---------- Starlink Mini ----------
    function (t) {
      if (!/Starlink Mini/i.test(t)) return null;
      if (/^\s*(перехідник|переходник)/i.test(t) && /Type-C/i.test(t)) return {
        title: '🔋 Повербанк для Starlink Mini',
        text: 'Потрібен повербанк із USB-C Power Delivery 20 В від 65 Вт — звичайні на 20–22,5 Вт Mini не запустять. Ці перевірені за характеристиками:',
        list: [PB.b733, PB.b1012, PB.b815],
        foot: 'Підключайте перехідник до порту USB-C повербанка (не до вбудованого кабелю). Час роботи орієнтовний — залежить від погоди й навантаження.'
      };
      if (/DC\s?\/\s?DC/i.test(t) && !/Type-C/i.test(t)) return {
        title: '🔌 Живлення від повербанка',
        text: 'Подовжувач з’єднує Mini з джерелом, що має гніздо DC 5.5×2.1. Щоб живити від повербанка, додайте перехідник Type-C → DC і повербанк з USB-C PD 20 В:',
        list: [SL_ADAPTER, PB.b733, PB.b1012],
        foot: 'Перехідник розрахований на 65 Вт — для звичайної роботи Mini цього достатньо.'
      };
      // «прикурювач/DC з USB Type-C та LED» не чіпаємо — з опису не зрозуміло, чи USB-C там вхід живлення
      if (/Type-C\s?\/\s?DC|Type-C Plug|перехідником Type-C/i.test(t) && !/LED/i.test(t)) return {
        title: '🔋 Повербанк для цього кабелю',
        text: 'Для живлення Mini від USB-C потрібен повербанк з Power Delivery 20 В: за специфікацією Starlink — від 100 Вт, для звичайної роботи вистачає 65 Вт.',
        list: [PB.b1012, PB.b815, PB.b733],
        foot: 'Кабель під’єднуйте до порту USB-C повербанка (не до вбудованого кабелю). Час роботи орієнтовний.'
      };
      return null;
    },

    // ---------- Електромагнітні замки → кронштейни ----------
    function (t) {
      if (!/^\s*Замок електромагнітний/i.test(t) || /врізн/i.test(t)) return null;
      var kraft = /Kraft/i.test(t), list = null;
      if (/\bTML-300LED\s*\(DS\)/i.test(t)) list = [BR.k300ds];
      else if (/\b(KRF|TML)-200\b/i.test(t)) list = kraft ? [BR.k200lK, BR.k200lT, BR.k200uT] : [BR.k200lT, BR.k200lK, BR.k200uT];
      else if (/\b(KRF|TML)-300LED\b/i.test(t)) list = kraft ? [BR.k300lK, BR.k300lT, BR.k300zT] : [BR.k300lT, BR.k300lK, BR.k300zT];
      else if (/\b(KRF|TML)-500LED\b/i.test(t)) list = kraft ? [BR.k500lK, BR.k500lT] : [BR.k500lT, BR.k500lK];
      if (!list) return null;
      return {
        title: '🔩 Кронштейн для цього замка',
        text: 'Потрібен, якщо замок або якірну планку не вийде прикрутити прямо до дверей чи коробки. Сумісні з цією моделлю:',
        list: list, links: LOCK_LINKS,
        foot: 'Для роботи замка також знадобляться блок живлення 12 В і кнопка виходу або зчитувач.'
      };
    },

    // ---------- Зарядні станції OUKITEL ----------
    function (t, f) {
      if (!/зарядна станція/i.test(t) || !/OUKITEL/i.test(t)) return null;
      var list = [];
      if (/\bP5000E(?! Plus)/i.test(t)) list.push(OK.caseP5000);
      else if (/\bP2001E(?! PRO)|\bP2400E/i.test(t)) list.push(OK.caseP2001);
      else if (/\bBP2000E/i.test(t)) list.push(OK.caseBP2000, OK.batB2000);
      else if (/\bBP3000E/i.test(t)) list.push(OK.batB2000L);
      // панелі — лише якщо вхід XT60 вказано в описі чи характеристиках станції
      var xt = /XT-?60/i.test(scDesc() + ' ' + Object.keys(f).map(function (k) { return f[k]; }).join(' '));
      if (xt) list.push(OK.sol200, OK.sol100);
      if (!list.length) return null;
      return {
        title: '🧳 Підберіть до станції',
        text: 'Аксесуари саме під цю модель OUKITEL:',   // про XT60 — у підписі панелі (панелей може не бути в наявності)
        list: list
      };
    },

    // ---------- IP-камери Ajax → кронштейни MountCam ----------
    function (t) {
      if (!/відеокамера/i.test(t) || !/\bAjax\b/i.test(t)) return null;
      var m = t.match(/\b(BulletCam|TurretCam|DomeCam)\b/i);
      if (!m) return null;
      var vf = /HLVF/i.test(t), black = /\bBlack\b|чорн/i.test(t);
      if (vf && /BulletCam/i.test(m[1]) && !/Superior/i.test(t)) return null;   // BulletCam HLVF — без MountCam
      var list = vf ? (black ? [MC.b2b, MC.a2w, MC.b2w] : [MC.a2w, MC.b2w, MC.b2b])
                    : (black ? [MC.b1b, MC.b2b, MC.a1w, MC.a2w] : [MC.a1w, MC.b1w, MC.a2w, MC.b2w]);
      return {
        title: '🔩 Кронштейн для цієї камери',
        text: vf ? 'Для варіофокальних камер HLVF підходять MountCam A2 і B2 — з перехідником під HLVF. Кабель і роз’єм ховаються всередині кронштейна:'
                 : 'Кронштейни Ajax MountCam ставлять камеру під 90° до стіни й ховають кабель і роз’єм усередині. Сумісні з цією камерою:',
        list: list,
        foot: 'A — компактний, короткий виніс; B — довгий виніс, відводить камеру далі від стіни чи карниза. Кріпляться й на стовп стрічками.'
      };
    },

    // ---------- Marstek: лише товари Marstek ----------
    function (t) {
      if (!/Marstek/i.test(t)) return null;
      if (/MST-HI-2200/i.test(t)) return {
        title: '🔋 Батареї для Venus D',
        text: 'Інверторний модуль працює лише з батареями Marstek MST-E2.5ST-D: від 1 до 6 шт. (2,56–15,36 кВт·год). Без батареї модуль не працює.',
        list: [MS.dBat, MS.ct]
      };
      if (/MST-E2\.5ST-D/i.test(t)) return {
        title: '⚡ Інверторний модуль для цієї батареї',
        text: 'Батарея сумісна лише з інверторним модулем Marstek MST-HI-2200 (система Venus D). В одну систему — до 6 батарей. Інвертор продається окремо або в комплекті з першою батареєю:',
        list: [MS.dKit, MS.dInv, MS.ct]
      };
      if (/Venus D\b/i.test(t)) return {
        title: '🔋 Розширити Venus D',
        text: 'У комплекті одна батарея. Ємність нарощують батареями Marstek MST-E2.5ST-D — до 6 шт. у системі (15,36 кВт·год); лічильник CT002 — для режиму власного споживання:',
        list: [MS.dBat, MS.ct]
      };
      if (/DB63S/i.test(t)) return {
        title: '🔋 Сумісні системи Marstek',
        text: 'Смартбокс DB63S працює із системами Marstek Venus E 3.0 і Venus C (за даними постачальника):',
        list: [MS.ve3, MS.vc]
      };
      if (/CT002/i.test(t)) return {
        title: '🔋 Системи Marstek для цього лічильника',
        text: 'Лічильник потрібен для режиму власного споживання: система бачить споживання будинку. Сумісні системи Marstek:',
        list: [MS.ve3, MS.dKit, MS.va, MS.vc]
      };
      if (/\bM[24]-\d{4}\b|Saturn-M/i.test(t)) return {
        title: '🔋 Накопичувати енергію панелей',
        text: 'До систем Marstek Venus E 3.0, Venus C і Venus E Mini сонячні панелі підключають через мікроінвертор Marstek (за даними постачальника):',
        list: [MS.ve3, MS.vc, MS.vmini]
      };
      if (/Venus E Mini/i.test(t)) return {
        title: '☀️ Для сонячних панелей',
        text: 'Щоб заряджати Venus E Mini від сонця, потрібен мікроінвертор Marstek — він купується окремо:',
        list: [MS.m2, MS.m4]
      };
      if (/Venus (E 3\.0|C)\b/i.test(t)) return {
        title: '🧩 Підберіть до системи Marstek',
        text: 'Сонячні панелі підключають через мікроінвертор Marstek (купується окремо); лічильник CT002 і смартбокс DB63S — для керування системою:',
        list: [MS.m4, MS.ct, MS.db63, MS.m2]
      };
      if (/Venus A\b/i.test(t)) return {
        title: '🧩 Підберіть до Venus A',
        text: 'Розумний лічильник Marstek для режиму власного споживання:',
        list: [MS.ct]
      };
      return null;
    },

    // ---------- ІЧ-прожектори 12 В → блок живлення ----------
    function (t, f) {
      if (!/(ІЧ|інфрачервоний)[- ]прожектор/i.test(t)) return null;
      if (!/12/.test(scGet(f, /^живлення/))) return null;
      var a = num(scGet(f, /^струм споживання$/));
      if (!a) return null;
      var need = a * 1.25;
      var list = need <= 1 ? [PSU.a2, PSU.a1] : need <= 2 ? [PSU.a2, PSU.a3] : need <= 3 ? [PSU.a3, PSU.a5] : [PSU.a5, PSU.b5];
      return {
        title: '⚡ Блок живлення для прожектора',
        text: 'Прожектор живиться від 12 В і споживає ' + String(a).replace('.', ',') + ' А — блок живлення беріть із запасом по струму:',
        list: list, links: [{ text: 'Усі блоки живлення 12 В →', url: PSU12 }],
        foot: 'Якщо від того самого блока живиться й камера — додайте її струм.'
      };
    }
  ];

  var C = { title: 'scs-t', text: 'scs-x', list: 'scs-l', a: 'scs-i', img: 'scs-img', info: 'scs-in',
            name: 'scs-n', note: 'scs-o', price: 'scs-p', links: 'scs-k' };
  var CSS = scPickCss('sc-pick', C) +
    '#sc-pick .scs-s{font-size:12px;color:#7a828c;margin:10px 0 0}';

  var langPrefix = SC_LANG;

  function load(pick) {
    var u = langPrefix + pick.url;
    if (u.replace(/\/$/, '') === location.pathname.replace(/\/$/, '')) return Promise.resolve(null);   // не радимо сам товар
    return scPickLoad(pick, scAvailOk);
  }

  function init() {
    if (document.getElementById('sc-pick')) return;
    var anchor = scAnchor();
    if (!anchor) return;
    var t = scH1().replace(/\s+/g, ' ').trim();
    var f = null, cfg = null;
    for (var i = 0; i < RULES.length && !cfg; i++) cfg = RULES[i](t, f || (f = scFeatures()));
    if (!cfg) return;

    scStyle('sc-pick-style', CSS);
    var box = document.createElement('div');
    box.id = 'sc-pick';
    box.innerHTML = '<div class="scs-t"></div><div class="scs-x"></div><div class="scs-l"></div>' +
      (cfg.links ? '<div class="scs-k"></div>' : '') + (cfg.foot ? '<div class="scs-s"></div>' : '');
    box.querySelector('.scs-t').textContent = cfg.title;
    box.querySelector('.scs-x').textContent = cfg.text;
    if (cfg.foot) box.querySelector('.scs-s').textContent = cfg.foot;
    if (cfg.links) cfg.links.forEach(function (l) {
      var a = document.createElement('a'); a.href = langPrefix + l.url; a.textContent = l.text;
      box.querySelector('.scs-k').appendChild(a);
    });
    // після плашки довіри / «Знайшли дешевше?» (блоки 14–15): вони підтягуються до «Купити» від'ємним відступом
    // і розраховують, що стоять одразу під ним — між них не вклинюємось
    var after = document.getElementById('sc-cheaper') || document.getElementById('sc-trust') || anchor;
    after.parentNode.insertBefore(box, after.nextSibling);

    var listEl = box.querySelector('.scs-l');
    scNear(box, function () { Promise.all(cfg.list.map(load)).then(function (items) {
      items.filter(Boolean).slice(0, MAX).forEach(function (p) { listEl.appendChild(scItem(p, C)); });
      // нічого немає в наявності: без посилань блок прибираємо, з посиланнями — лишаємо їх
      if (!listEl.children.length) { if (cfg.links) listEl.remove(); else box.remove(); }
    }); });
  }

  scInit(19, init);
});


/* =====================================================================
 * 21. TikTok Pixel → ретаргетинг за каталогом
 *     Базовий код пікселя + події e-commerce з dataLayer Хорошопа (ті самі, що бачить GA4):
 *       view_item → ViewContent, add_to_cart → AddToCart,
 *       begin_checkout → InitiateCheckout, purchase → CompletePayment.
 *     content_id = item_id Хорошопа — той самий id товару, що у фіді (Merchant / каталог TikTok),
 *     інакше TikTok не знає, який товар показувати. Події, що вже лежать у dataLayer до запуску
 *     (скрипт підключено з defer), обробляються одразу; нові — через обгортку dataLayer.push.
 *     Покупку з тим самим номером замовлення не надсилаємо вдруге (оновлення сторінки «Дякуємо»).
 * ===================================================================== */
scModule(21, function () {
  'use strict';
  if (!SC_TT_PIXEL || window.scTtOn) return;
  window.scTtOn = 1;

  /* Базовий код TikTok Pixel (як у Events Manager), ID — з SC_TT_PIXEL */
  !function (w, d, t) {
    w.TiktokAnalyticsObject = t; var ttq = w[t] = w[t] || [];
    ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group',
                   'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
    ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; };
    for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.instance = function (t) { for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]); return e; };
    ttq.load = function (e, n) {
      var r = 'https://analytics.tiktok.com/i18n/pixel/events.js', o = n && n.partner;
      ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = r; ttq._t = ttq._t || {}; ttq._t[e] = +new Date;
      ttq._o = ttq._o || {}; ttq._o[e] = n || {};
      n = d.createElement('script'); n.type = 'text/javascript'; n.async = !0; n.src = r + '?sdkid=' + e + '&lib=' + t;
      e = d.getElementsByTagName('script')[0]; e.parentNode.insertBefore(n, e);
    };
    ttq.load(SC_TT_PIXEL);
    ttq.page();
  }(window, document, 'ttq');

  var MAP = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'CompletePayment' };

  function send(e) {
    if (!e || typeof e !== 'object' || !MAP[e.event]) return;
    var name = MAP[e.event], ec = e.ecommerce || {}, items = ec.items || [];
    if (!items.length) return;
    var contents = items.map(function (it) {
      return { content_id: String(it.item_id), content_type: 'product', content_name: it.item_name,
               quantity: +it.quantity || 1, price: +it.price || 0 };
    });
    var value = +ec.value || contents.reduce(function (s, c) { return s + c.price * c.quantity; }, 0);
    var opt;
    if (name === 'CompletePayment') {
      var tid = ec.transaction_id ? String(ec.transaction_id) : '';
      if (tid) {
        try {
          if (localStorage.getItem('sc_tt_order_' + tid)) return;
          localStorage.setItem('sc_tt_order_' + tid, '1');
        } catch (x) {}
        opt = { event_id: 'order_' + tid };
      }
    }
    window.ttq.track(name, {
      contents: contents, content_type: 'product', value: Math.round(value * 100) / 100,
      currency: ec.currency || items[0].currency || 'UAH'
    }, opt);
  }

  var dl = window.dataLayer = window.dataLayer || [];
  var safeSend = scSafe(21, send);
  for (var i = 0; i < dl.length; i++) safeSend(dl[i]);
  var push = dl.push;
  dl.push = function () {
    var r = push.apply(dl, arguments);
    for (var j = 0; j < arguments.length; j++) safeSend(arguments[j]);
    return r;
  };
});


/* =====================================================================
 * 22. Калькулятор «Скільки пропрацює ДБЖ» — у статтях блогу й текстах категорій
 *     Вмикається лише там, де в тексті є <div data-sc-calc="runtime"></div> (вставляється в
 *     редакторі Хорошопа). Необов'язкові атрибути: data-wh="64" — ємність за замовчуванням (Вт·год),
 *     data-w="14" — навантаження за замовчуванням (Вт), data-mini="1" — показати кнопку «Starlink Mini».
 *     Те, що лежить усередині div (формула
 *     текстом), бачать пошуковики й люди без JS — скрипт замінює це на калькулятор.
 *     Формула та сама, що в статтях: Вт·год × 0,85 ÷ Вт.
 * ===================================================================== */
scModule(22, function () {
  'use strict';

  var K = 0.85;                                      // орієнтовні втрати на перетворення, як у статтях
  var CHIPS = [                                      // швидке додавання навантаження (Вт), орієнтири зі статей
    ['Роутер', 8], ['ONT / ONU', 6], ['IP-камера', 6.5]
  ];
  // Starlink Mini (до 60 Вт, у середньому 25–40 Вт) міні-ДБЖ для роутерів не тягнуть, тому кнопку
  // показуємо лише там, де в div є data-mini="1" (зарядні станції, повербанки, статті про Starlink)
  var MINI = ['Starlink Mini', 40];
  var CSS =
    '.sc-calc{border:1px solid #d6e2f2;border-radius:12px;padding:18px 20px;margin:0 0 28px;background:#f7faff;font-size:15px;line-height:1.45}' +
    '.sc-calc__t{font-weight:bold;font-size:18px;margin:0 0 12px}' +
    '.sc-calc__row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px}' +
    '.sc-calc__lbl{min-width:150px;font-weight:bold}' +
    '.sc-calc input,.sc-calc select{height:38px;border:1px solid #c5d3e6;border-radius:8px;padding:0 10px;font-size:15px;background:#fff;color:#1c2430}' +
    '.sc-calc input{width:110px!important;max-width:110px}' +
    '.sc-calc select{width:auto!important;max-width:100%;flex:0 1 auto;display:inline-block}' +   // тема розтягує select на всю ширину
    '.sc-calc__chip{border:1px solid #1f6fd1;color:#1f6fd1;background:#fff;border-radius:16px;padding:4px 12px;font-size:14px;cursor:pointer}' +
    '.sc-calc__chip:hover{background:#eaf2fd}' +
    '.sc-calc__reset{color:#5b6675;font-size:14px;text-decoration:underline;cursor:pointer;background:none;border:0;padding:4px}' +
    '.sc-calc__res{margin:14px 0 6px;padding:12px 14px;border-radius:10px;background:#fff;border-left:4px solid #2e9e4f}' +
    '.sc-calc__h{font-size:24px;font-weight:bold;color:#1c2430}' +
    '.sc-calc__f{color:#5b6675;font-size:14px;margin-top:4px}' +
    '.sc-calc__note{color:#5b6675;font-size:13px;margin:6px 0 0}' +
    '@media (max-width:600px){.sc-calc{padding:14px}.sc-calc__lbl{min-width:100%}}';

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }
  function num(v) { var n = parseFloat(String(v || '').replace(',', '.')); return isFinite(n) && n > 0 ? n : 0; }
  function fmt(n) { return (Math.round(n * 10) / 10).toString().replace('.', ','); }
  function hm(h) {
    var t = Math.round(h * 60), hh = Math.floor(t / 60), mm = t % 60;
    if (hh >= 48) return '≈ ' + fmt(h / 24) + ' доби (' + hh + ' год)';
    return '≈ ' + (hh ? hh + ' год ' : '') + (mm || !hh ? mm + ' хв' : '');
  }

  function build(box) {
    if (box.getAttribute('data-sc-ready')) return;
    box.setAttribute('data-sc-ready', '1');
    var wh0 = num(box.getAttribute('data-wh')) || 64, w0 = num(box.getAttribute('data-w')) || 14;

    box.className = (box.className ? box.className + ' ' : '') + 'sc-calc';
    box.innerHTML = '';
    box.appendChild(el('div', { 'class': 'sc-calc__t' }, '🔋 Калькулятор: скільки пропрацює від ' + (box.getAttribute('data-mini') === '1' ? 'батареї' : 'ДБЖ')));

    var r1 = el('div', { 'class': 'sc-calc__row' });
    r1.appendChild(el('span', { 'class': 'sc-calc__lbl' }, 'Ємність'));
    var cap = el('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: String(wh0), 'aria-label': 'Ємність' });
    var unit = el('select', { 'aria-label': 'Одиниці ємності' },
      '<option value="wh">Вт·год</option><option value="mah">мА·год</option><option value="ah">А·год</option>');
    var chem = el('select', { 'aria-label': 'Тип акумулятора' },
      '<option value="3.2">LiFePO4 (3,2 В на елемент)</option><option value="3.7">Li-ion (3,7 В на елемент)</option>');
    var volt = el('select', { 'aria-label': 'Напруга батареї' },
      '<option value="12.8">12,8 В (LiFePO4 «12 В»)</option><option value="12">12 В (свинцевий AGM / GEL)</option>' +
      '<option value="25.6">25,6 В</option><option value="51.2">51,2 В</option>');
    r1.appendChild(cap); r1.appendChild(unit); r1.appendChild(chem); r1.appendChild(volt);
    box.appendChild(r1);

    var r2 = el('div', { 'class': 'sc-calc__row' });
    r2.appendChild(el('span', { 'class': 'sc-calc__lbl' }, 'Навантаження, Вт'));
    var load = el('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: String(w0), 'aria-label': 'Навантаження, Вт' });
    r2.appendChild(load);
    box.appendChild(r2);

    var r3 = el('div', { 'class': 'sc-calc__row' });
    r3.appendChild(el('span', { 'class': 'sc-calc__lbl' }, 'Додати'));
    (box.getAttribute('data-mini') === '1' ? CHIPS.concat([MINI]) : CHIPS).forEach(function (c) {
      var b = el('button', { type: 'button', 'class': 'sc-calc__chip' }, '+ ' + c[0] + ' ' + fmt(c[1]) + ' Вт');
      b.addEventListener('click', scSafe(22, function () { load.value = fmt(num(load.value) + c[1]).replace(',', '.'); calc(); }));
      r3.appendChild(b);
    });
    var rs = el('button', { type: 'button', 'class': 'sc-calc__reset' }, 'обнулити');
    rs.addEventListener('click', scSafe(22, function () { load.value = ''; load.focus(); calc(); }));
    r3.appendChild(rs);
    box.appendChild(r3);

    var res = el('div', { 'class': 'sc-calc__res', 'aria-live': 'polite' });
    box.appendChild(res);
    box.appendChild(el('p', { 'class': 'sc-calc__note' },
      'Розрахунок орієнтовний: енергоємність × 0,85 ÷ навантаження. Точне споживання — у паспорті пристроїв; ' +
      'сумарна потужність не має перевищувати максимальну вихідну потужність ДБЖ. Старий акумулятор і мороз зменшують час роботи.'));

    function calc() {
      var u = unit.value, c = num(cap.value), w = num(load.value), wh = 0, how = '';
      chem.style.display = u === 'mah' ? '' : 'none';
      volt.style.display = u === 'ah' ? '' : 'none';
      if (u === 'wh') wh = c;
      else if (u === 'mah') { wh = c * parseFloat(chem.value) / 1000; how = fmt(c) + ' мА·год × ' + fmt(parseFloat(chem.value)) + ' В = ' + fmt(wh) + ' Вт·год; '; }
      else { wh = c * parseFloat(volt.value); how = fmt(c) + ' А·год × ' + fmt(parseFloat(volt.value)) + ' В = ' + fmt(wh) + ' Вт·год; '; }
      if (!wh || !w) { res.innerHTML = '<div class="sc-calc__f">Вкажіть ємність і навантаження.</div>'; return; }
      var h = wh * K / w;
      res.innerHTML = '<div class="sc-calc__h">' + hm(h) + '</div>' +
        '<div class="sc-calc__f">' + how + fmt(wh) + ' Вт·год × 0,85 ÷ ' + fmt(w) + ' Вт = ' + fmt(h) + ' год</div>';
    }
    [cap, load].forEach(function (i) { i.addEventListener('input', scSafe(22, calc)); });
    [unit, chem, volt].forEach(function (s) { s.addEventListener('change', scSafe(22, calc)); });
    calc();
  }

  function init() {
    var boxes = document.querySelectorAll('[data-sc-calc="runtime"]');
    if (!boxes.length) return;
    scStyle('sc-calc-style', CSS);
    [].forEach.call(boxes, function (b) { scSafe(22, build)(b); });
  }

  scReady(scSafe(22, init));
});


/* =====================================================================
 * 23. «Живі» картки товарів у статтях блогу
 *     <div data-sc-products="/hdmi-kabeli-v-nayavnosti/" data-match="оптичн" data-limit="8">…</div>
 *     Беремо сторінку розділу чи пресету фільтра Хорошопа (звичайні сторінки фільтра /filter/… не
 *     підходять — Хорошоп віддає на fetch заглушку-перевірку), показуємо лише товари в наявності,
 *     data-match — регулярний вираз по назві (без урахування регістру). Нові товари з'являються самі,
 *     зниклі з наявності — зникають. Вміст div (статичні картки) лишається, якщо нічого не знайшли
 *     або сторінка не завантажилась — його ж бачать пошуковики.
 * ===================================================================== */
// ===== 24. Накопичувальна знижка в картці товару: показуємо умови замість голого «Увійти для відображення…» =====
// Умови ті самі, що в банері сайту (2% / 4% / 6%). Посилання «Увійти» лишаємо — для зареєстрованих Хорошоп сам показує їхню знижку.
scModule(24, function () {
  'use strict';
  var CSS = '.user-discount__text a[href="#auth"],.user-discount__text a[data-modal="#sign-in"]{color:#1f6fd1!important;text-decoration:underline!important;font-weight:bold}' +
    // десктоп: прибрати зайвий відступ під блоком знижки (прихований блок однієї модифікації має margin 40px; ціна — 25px)
    '.product__section--modifications:has(.sc-mod-one){margin-bottom:0!important}' +
    '.product__section--price:has(.product__block--user-discount){margin-bottom:6px!important}' +
    '.product__block--user-discount{margin-top:8px!important}' +
    '.product__block--user-discount .user-discount{align-items:center}' +
    '.product__block--user-discount .user-discount__icon{flex:0 0 auto}' +
    '.product__block--user-discount .user-discount__text{padding-left:18px!important}';
  function run() {
    scDiscTipWrap_();   // якщо main.js Хорошопа підвантажився пізніше за наш скрипт
    [].forEach.call(document.querySelectorAll('.user-discount__text'), function (t) {
      if (t.getAttribute('data-sc-disc')) return;
      var a = t.querySelector('a[href="#auth"], a[data-modal="#sign-in"]');   // мобільна / десктопна версія
      if (!a || !/для відображення/.test(t.textContent)) return;          // зареєстрований — не чіпаємо
      t.setAttribute('data-sc-disc', '1');
      t.textContent = '';
      t.appendChild(document.createTextNode('Знижка постійним клієнтам: коли сума ваших виконаних замовлень досягне 5 000 грн — 2% на наступні покупки, 15 000 грн — 4%, 40 000 грн — 6%. '));
      t.appendChild(a);
      t.appendChild(document.createTextNode(', щоб побачити свою'));
    });
    // Кошик / оформлення: кнопка «Увійти для відображення накопичувальної знижки» (вся кнопка — посилання на вхід)
    [].forEach.call(document.querySelectorAll('a[href="#login"], a[href="#auth"], button[onclick*="sign-in"]'), function (a) {
      if (a.getAttribute('data-sc-disc') || !/накопичувальної знижки/.test(a.textContent)) return;
      a.setAttribute('data-sc-disc', '1');
      a.classList.add('sc-disc-btn');
      a.textContent = '';
      var s1 = document.createElement('span');
      s1.className = 'sc-disc-btn__t';
      s1.textContent = 'Знижка постійним клієнтам 2–6% від суми виконаних замовлень.';
      var s2 = document.createElement('span');
      s2.className = 'sc-disc-btn__l';
      s2.textContent = 'Увійдіть, щоб побачити свою →';
      a.appendChild(s1);
      a.appendChild(s2);
    });
    // Зареєстрований покупець: Хорошоп пише «Придбайте на 5 000 грн та отримайте знижку 2%», а у вікні — «Меню» і
    // «Загальна сума покупок 5 000 грн». Це читається як знижка на поточний кошик, а вона діє лише на наступні
    // замовлення після того, як сума виконаних досягне порогу. Міняємо тексти (лише текстові вузли — посилання/кнопки лишаються).
    scDiscLoggedIn_();
    // Десктопний кошик: рядок знижки/купона стоїть під колонкою назви (перша клітинка — порожня під фото).
    // Прибираємо порожню клітинку, щоб блок починався від лівого краю, як смуга «До безкоштовної доставки».
    [].forEach.call(document.querySelectorAll('.cart-items .cart-discount'), function (box) {
      var td = box.closest('td');
      if (!td || td.getAttribute('data-sc-disc')) return;
      var prev = td.previousElementSibling;
      if (!prev || !prev.classList.contains('__image') || prev.textContent.trim()) return;
      td.setAttribute('data-sc-disc', '1');
      prev.style.display = 'none';
      td.colSpan = td.colSpan + 1;
    });
  }
  scStyle('sc-disc-style', CSS +
    '.sc-disc-btn{display:block!important;width:100%!important;cursor:pointer;white-space:normal!important;height:auto!important;line-height:1.35!important;padding:8px 10px!important;text-align:center!important;border:1px dashed #9cc8a8!important;border-radius:8px!important;background:#f4fbf6!important}' +
    '.sc-disc-btn__t{display:block;color:#1c2430;font-size:13px;font-weight:normal}' +
    '.sc-disc-btn__l{display:block;color:#1f6fd1;font-weight:bold;text-decoration:underline;font-size:13px;margin-top:2px}' +
    // десктопний кошик: блок на всю ширину, краї — як у смуги «До безкоштовної доставки»
    '.cart-discount-l:has(.sc-disc-btn){width:auto!important;max-width:none!important;float:none!important}' +
    '.cart-items td[data-sc-disc]{padding-left:1px!important;padding-right:1px!important}' +
    '.cart-items td[data-sc-disc] .j-coupon-add{margin-left:15px!important}' +
    // «Рекомендуємо придбати» в кошику: картки однакової висоти, ціна й «До кошика» на одній лінії
    '.cart-recommended .productsSlider-wrapper{align-items:stretch!important}' +
    '.cart-recommended .productsSlider-i{display:flex!important;flex-direction:column!important;height:auto!important}' +
    '.cart-recommended .productsSlider-i>a{flex:1 1 auto}' +
    '.cart-recommended .productsSlider-order{margin-top:6px}' +
    '.sc-disc-note{margin:12px 0 4px;padding:10px 12px;border-radius:8px;background:#f4fbf6;border:1px dashed #9cc8a8;color:#1c2430;font-size:14px;line-height:1.4}' +
    '.cart-discount .sc-disc-btn{display:block!important;width:100%!important;box-sizing:border-box!important;max-width:none!important;text-align:left!important;padding:10px 14px!important;border-radius:8px!important}');
  var RE_BUY = /^\s*Придбайте на\s*([\d\s ]+грн)\s*та отримайте знижку\s*(\d+)\s*%\s*$/;
  var RE_ROW = /^\s*(?:Загальна сума|Сума) покупок\s*([\d\s ]+грн)\s*$/;
  var NOTE = 'Знижка діє на наступні замовлення після того, як сума ваших виконаних (отриманих) замовлень досягне порогу.';
  // елементи, весь текст яких підходить під re, але жоден дочірній елемент — ні (найглибший «носій» фрази)
  function leaves_(re) {
    var res = [];
    [].forEach.call(document.body ? document.body.querySelectorAll('div,span,p,a,button,li,td,dd,dt,strong,b,label') : [], function (e) {
      if (e.getAttribute('data-sc-disc') || !re.test(e.textContent)) return;
      for (var i = 0; i < e.children.length; i++) if (re.test(e.children[i].textContent)) return;
      res.push(e);
    });
    return res;
  }
  // замінити текст елемента, не чіпаючи вкладені елементи, крім <br>
  function setText_(e, txt) {
    var done = false;
    [].slice.call(e.childNodes).forEach(function (n) {
      if (n.nodeType === 1 && n.tagName === 'BR') { e.removeChild(n); return; }
      if (n.nodeType !== 3) return;
      if (!done && n.nodeValue.trim()) { n.nodeValue = txt; done = true; } else n.nodeValue = '';
    });
    if (!done) e.textContent = txt;
    e.setAttribute('data-sc-disc', '1');
  }
  function sum_(s) { return s.replace(/[\s ]+/g, ' ').trim().replace(/^(\d+) (\d{3}) грн$/, '$1 $2 грн'); }
  function scDiscLoggedIn_() {
    leaves_(RE_BUY).forEach(function (e) {
      var m = e.textContent.match(RE_BUY);
      setText_(e, 'Знижка постійним клієнтам: ' + m[2] + '% на наступні покупки, коли сума виконаних замовлень досягне ' + sum_(m[1]));
    });
    var rows = leaves_(RE_ROW);
    rows.forEach(function (e) {
      setText_(e, 'Сума виконаних замовлень від ' + sum_(e.textContent.match(RE_ROW)[1]));
    });
    if (!rows.length) return;
    // спільний контейнер рядків (список рівнів знижки)
    var box = rows[0].parentElement;
    while (box && rows.some(function (r) { return !box.contains(r); })) box = box.parentElement;
    if (!box || box === document.body) return;
    if (rows.length === 1) box = box.parentElement || box;
    // заголовок вікна «Меню» → «Знижка постійним клієнтам» (шукаємо лише в найближчому вікні навколо рядків)
    var pop = box;
    for (var i = 0; i < 8 && pop && pop !== document.body; i++, pop = pop.parentElement) {
      var t = [].filter.call(pop.querySelectorAll('div,span,p,h1,h2,h3,h4,header'), function (x) {
        return !x.children.length && x.textContent.trim() === 'Меню';
      })[0];
      if (t) { t.textContent = 'Знижка постійним клієнтам'; t.setAttribute('data-sc-disc', '1'); break; }
      if (pop.textContent.length > 3000) break;
    }
    // пояснення під рівнями знижки
    if (!box.parentElement.querySelector('.sc-disc-note')) {
      var n = document.createElement('div');
      n.className = 'sc-disc-note';
      n.textContent = NOTE;
      box.parentElement.insertBefore(n, box.nextSibling);
    }
  }
  // Вікно рівнів знижки (Хорошоп: віджет hs.dropdown на .user-discount-details, відкривається наведенням на
  // .js-user-discount-dropdown). Віджет одразу переносить вікно в «body > .container» і запам'ятовує свій рядок-тригер.
  // Після зміни модифікації Хорошоп перемальовує блок ціни й створює нове вікно, а старе лишається в контейнері,
  // прив'язане до рядка, якого вже немає. Якщо воно було відкрите — ніщо його не закриває (лише клік деінде), і воно
  // висить поверх «Купити». Крім того, вікно ставиться за координатами рядка лише в мить відкриття, а права колонка
  // «липка» — після прокрутки вікно лишається на старому місці. Тому:
  //  • вікна, чий рядок-тригер зник зі сторінки, прибираємо (перед повторною ініціалізацією і при кожній перевірці);
  //  • відкрите вікно ховаємо, коли курсор 0,5 с не над вікном і не над рядком, при прокрутці, кліку/дотику поза ним
  //    або коли курсор пішов зі сторінки.
  function scDiscTipGuard_() {
    var SEL_TIP = '.user-discount-details.is-visible', SEL_KEEP = '.user-discount-details, .js-user-discount-dropdown';
    var timer = null, raf = 0, x = -1, y = -1, y0 = null;
    var root = document.documentElement;
    // вікно-«сирота»: жодного з його рядків-тригерів уже немає на сторінці
    function orphan(d) {
      var jq = window.jQuery, inst;
      if (!jq || !jq.fn || !jq.fn.dropdown) return false;
      try { inst = jq(d).dropdown('instance'); } catch (e) { return false; }
      if (!inst || !inst.$trigger || !inst.$trigger.length) return false;
      return !inst.$trigger.toArray().some(function (t) { return root.contains(t); });
    }
    function dropOrphans() {
      [].forEach.call(document.querySelectorAll('.user-discount-details'), function (d) {
        if (!orphan(d)) return;
        try { window.jQuery(d).remove(); } catch (e) { if (d.parentNode) d.parentNode.removeChild(d); }   // jQuery знімає й обробники віджета
      });
    }
    function tips() { return document.querySelectorAll(SEL_TIP); }
    function over() {
      if (x < 0) return false;
      var el = document.elementFromPoint(x, y);
      return !!(el && el.closest && el.closest(SEL_KEEP));
    }
    function hideAll() {
      clearTimeout(timer); timer = null; y0 = null;
      [].forEach.call(tips(), function (d) {
        var inst = null;
        try { inst = window.jQuery(d).dropdown('instance'); } catch (e) {}
        if (inst && inst.close) { try { inst.close(); } catch (e) {} }   // штатно, щоб віджет знав, що вікно закрите
        d.classList.remove('is-visible');
      });
    }
    function check() {
      raf = 0;
      if (!tips().length) { clearTimeout(timer); timer = null; y0 = null; return; }
      dropOrphans();
      if (!tips().length) { clearTimeout(timer); timer = null; y0 = null; return; }
      if (y0 === null) y0 = window.pageYOffset;
      if (over()) { clearTimeout(timer); timer = null; return; }
      if (!timer) timer = setTimeout(function () { timer = null; if (!over()) hideAll(); }, 500);
    }
    function later() { if (!raf) raf = (window.requestAnimationFrame || setTimeout)(check); }
    document.addEventListener('mousemove', function (e) { x = e.clientX; y = e.clientY; later(); }, { passive: true });
    document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) { x = y = -1; later(); } });
    window.addEventListener('blur', function () { x = y = -1; later(); });
    // прокрутка: «липкий» рядок їде разом з екраном, а вікно — ні
    window.addEventListener('scroll', function () {
      if (!tips().length) return;
      if (y0 === null) y0 = window.pageYOffset;
      if (Math.abs(window.pageYOffset - y0) > 30) hideAll();
    }, { passive: true });
    // клік/дотик поза вікном і рядком
    document.addEventListener('pointerdown', function (e) {
      if (tips().length && !(e.target.closest && e.target.closest(SEL_KEEP))) hideAll();
    }, true);
    scDiscTipGuard_.dropOrphans = dropOrphans;
  }
  // Повторна ініціалізація Хорошопом (після зміни модифікації): спершу прибрати вікна старого блоку
  function scDiscTipWrap_() {
    var F = window.Face;
    if (!F || typeof F.userDiscountDropdown !== 'function' || F.userDiscountDropdown.scWrapped) return;
    var orig = F.userDiscountDropdown;
    var w = function () {
      try { if (scDiscTipGuard_.dropOrphans) scDiscTipGuard_.dropOrphans(); } catch (e) {}
      return orig.apply(this, arguments);
    };
    w.scWrapped = 1;
    F.userDiscountDropdown = w;
  }
  scSafe(24, scDiscTipGuard_)();
  scSafe(24, scDiscTipWrap_)();
  var go = scSafe(24, run);
  scReady(go);
  window.addEventListener('load', go);
  // Хорошоп перемальовує блоки пізніше (модифікації, вхід, кошик відкривається AJAX) — слідкуємо постійно, з паузою
  try {
    var pend = false;
    var mo = new MutationObserver(function () {
      if (pend) return;
      pend = true;
      setTimeout(function () { pend = false; go(); }, 300);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
});

// ===== 26. Фільтри каталогу (десктоп): довгі назви фільтрів — по лівому краю, а не по центру =====
scModule(27, function () {
  'use strict';
  // повна назва товару в картці каталогу (до 5 рядків замість 3) — щоб було видно довжину, модель тощо
  scStyle('sc-cardtitle-style',
    '.catalogCard-title{height:auto!important;max-height:90px!important;display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:5!important}' +
    // мобільна версія (?v=mobile): картки вужчі — до 6 рядків
    '.catalog-card__title{height:auto!important;max-height:none!important;display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:6!important}');
});

scModule(26, function () {
  'use strict';
  scStyle('sc-filter-style',
    '.filter-section-trigger{text-align:left!important}');
});

scModule(28, function () {
  'use strict';
  // «Популярні категорії» на головній (мобільна версія): однакова ширина карток і квадрат під фото,
  // щоб картинки різних пропорцій не робили картки різного розміру, а підписи не «стрибали»
  var P = '.popular-categories ';
  scStyle('sc-popcat-style',
    P + '.carousel__item{width:96px!important;flex:0 0 96px!important}' +
    P + '.catalog-card{width:100%!important;max-width:96px!important}' +
    P + '.catalog-card__image{width:80px!important;height:80px!important;margin:0 auto!important}' +
    P + '.catalog-card__image .image,' + P + '.catalog-card__image .image__box{width:100%!important;height:100%!important;padding:0!important}' +
    P + '.catalog-card__image img{width:100%!important;height:100%!important;object-fit:contain!important;position:static!important}' +
    P + '.catalog-card__title{font-size:13px!important;line-height:1.25!important;text-align:center!important;margin-top:8px!important;-webkit-line-clamp:3!important}');
});

/* =====================================================================
 * 33. Оформлення замовлення — візуальні правки (03.11.2026)
 *     • «Відділення» не вибране заздалегідь: замість №1 — «Оберіть відділення», без вибору
 *       кнопка «Оформити» не відправляє форму (підсвічуємо поле). Значення в select НЕ чіпаємо.
 *     • підпис у полі пошуку відділень; вкладки в один рядок; підказки в кольорах сайту;
 *     • десктоп: колонка «Ваше замовлення» липка, без футера на сторінці оформлення;
 *     • мобільна: без великих кнопок-телефонів у футері оформлення; cookie-смуга не закриває кнопки.
 *     ВІДКАТ: SC33_OFF = true (або ?sc33=0 у адресі — лише для перегляду «як було»).
 * ===================================================================== */
scModule(33, function () {
  'use strict';
  var SC33_OFF = false;
  if (SC33_OFF || /[?&]sc33=0/.test(location.search)) return;

  var mobile = !!document.querySelector('script[src*="/bundles/mobile/"]');
  var checkout = location.pathname.indexOf('/checkout') !== -1 && !/checkout.*complete|complete.*order/i.test(location.pathname);

  // cookie-смуга (модуль 18) на мобільній: відступ знизу, щоб не перекривала кнопки й липку панель «Купити»
  scStyle('sc33-cookie',
    'body.sc-cookie-bar{padding-bottom:var(--sc-cookie-h,0px)!important}' +
    // липка панель «В кошику» на картці (модуль 13) — над смугою, а не під нею
    'body.sc-cookie-bar #sc-sticky{bottom:var(--sc-cookie-h,0px)!important}' +
    'body.sc-cookie-bar.sc-sticky-pad{padding-bottom:calc(var(--sc-cookie-h,0px) + 72px)!important}');
  function cookieH() {
    var m = document.getElementById('cookies-modal');
    var box = m && m.classList.contains('is-visible') && m.querySelector('.modal__box');
    var h = box ? Math.round(box.getBoundingClientRect().height) : 0;
    if (h === cookieH.last) return;
    cookieH.last = h;
    document.documentElement.style.setProperty('--sc-cookie-h', h + 'px');
  }
  scReady(scSafe(33, function () { cookieH(); setInterval(cookieH, 1000); }));

  // значки переваг на картці (модуль «Оплата · Гарантія · Повернення») — в палітрі сайту замість синього й помаранчевого
  scStyle('sc33-trust',
    '#sc-trust svg [fill="#f59e0b"],#sc-trust svg [fill="#3b82f6"]{fill:#2E9E4F}' +
    '#sc-trust svg[stroke="#38ab87"]{stroke:#2E9E4F}#sc-trust .sct-v{color:#2E9E4F!important}');

  if (!checkout) return;

  scStyle('sc33-style',
    // підказки модуля 10 — нейтральні, в палітрі сайту, замість блакитних
    'body .sc-co-note.info,body #sc-co-dlv{background:#F1F3F1!important;border-color:#E1E6E2!important;color:#2B2F2C!important}' +
    // вибір відділення
    '.sc33-empty .selectboxit-text,.sc33-empty.select__text,.sc33-empty .select__text{color:#6B716D!important}' +
    '.sc33-err .selectboxit,.sc33-err.select,.sc33-err .select__text{border-color:#D9534F!important;box-shadow:0 0 0 3px rgba(217,83,79,.15)!important}' +
    '#sc33-wh-msg{margin:6px 0 2px;color:#B23A36;font-size:13.5px;font-weight:600}' +
    (mobile
      ? // мобільна: обидві вкладки поміщаються; без великих кнопок-телефонів у футері
        '.page--checkout .tabs__nav-wrap{display:flex!important}' +
        '.page--checkout .tabs__nav-wrap .tabs__item{flex:1 1 0!important;min-width:0;text-align:center;padding-left:2px!important;padding-right:2px!important}' +
        '.page--checkout .tabs__nav-wrap .tabs__item-text{font-size:14px!important;letter-spacing:-.01em;white-space:nowrap}' +
        '.page--checkout .footer .phones--inline{display:none!important}'
      : // десктоп: вкладки в один рядок, підсумок липкий, футера немає
        '.checkout-tabs-i{white-space:nowrap}.checkout-tabs-text br{display:none}' +
        '.checkout-aside{position:sticky!important;top:16px;align-self:flex-start}' +
        'body:has(#checkout-container) .footer{display:none!important}'));

  /* ---- Відділення без попереднього вибору ---- */
  var PH = 'Оберіть відділення';
  function whSelect() {
    return [].filter.call(scCheckout().querySelectorAll('select[name*="warehouse"]'), function (s) {
      return s.parentElement && s.parentElement.getClientRects().length;
    })[0];
  }
  function whText(s) {
    var c = document.getElementById(s.id + 'SelectBoxItText') || s.parentElement.querySelector('.selectboxit-text, .select__text');
    return c;
  }
  function isPost(s) { return /поштомат/i.test(scOptText(scCheckout().querySelector('select[name="Delivery[delivery_type]"]')) || ''); }
  function mark(s) {
    var first = s.options.length ? s.options[0].value : '';
    if (s.getAttribute('data-sc33-first') !== first) {   // нове місто — новий список, вибору ще немає
      s.setAttribute('data-sc33-first', first);
      s.removeAttribute('data-sc33');
    }
    if (s.getAttribute('data-sc33') === null) {
      // вибір, збережений раніше (не перше значення), — свідомий; перше значення Хорошоп ставить сам
      s.setAttribute('data-sc33', s.selectedIndex > 0 ? 'picked' : s.value);
    }
    var st = s.getAttribute('data-sc33');
    if (st !== 'picked' && s.value !== st) { s.setAttribute('data-sc33', 'picked'); st = 'picked'; }
    var t = whText(s), box = t && (t.closest('.selectboxit-container') || t.closest('.select') || t);
    if (st === 'picked') {
      // вибрали те саме значення — плагін текст не оновлює, повертаємо назву відділення самі
      if (t && /^Оберіть (відділення|поштомат)$/.test(t.textContent) && s.selectedIndex >= 0) t.textContent = s.options[s.selectedIndex].textContent;
      if (box) box.classList.remove('sc33-empty', 'sc33-err');
      var msg = document.getElementById('sc33-wh-msg'); if (msg) msg.remove();
      return;
    }
    var ph = isPost(s) ? 'Оберіть поштомат' : PH;
    if (t && t.textContent !== ph) t.textContent = ph;
    if (box) box.classList.add('sc33-empty');
  }
  // клік по пункту списку (у т.ч. по тому самому №1) — теж вибір
  document.addEventListener('click', function (e) {
    var s = whSelect(); if (!s) return;
    var li = e.target.closest && e.target.closest('.selectboxit-option, .mm-listitem, li');
    if (!li) return;
    var list = li.closest('[id^="' + s.id + '"], [id^="select-drawer"]');
    var drawer = s.parentElement.getAttribute('data-panel');
    if (list && (list.id.indexOf(s.id) === 0 || (drawer && list.id === drawer))) {
      s.setAttribute('data-sc33', 'picked');
      setTimeout(function () { mark(s); }, 50);
    }
  }, true);
  // кнопка «Оформити» без вибраного відділення — не відправляємо, показуємо поле
  function guard(e, form) {
    var s = whSelect();
    if (!s || !form || !form.contains(s) || s.getAttribute('data-sc33') === 'picked') return;
    e.preventDefault(); e.stopImmediatePropagation();
    var t = whText(s), box = t && (t.closest('.selectboxit-container') || t.closest('.select') || t);
    if (box) {
      box.classList.add('sc33-err');
      if (!document.getElementById('sc33-wh-msg')) {
        var m = document.createElement('div'); m.id = 'sc33-wh-msg';
        m.textContent = isPost(s) ? 'Оберіть, будь ласка, поштомат зі списку' : 'Оберіть, будь ласка, відділення зі списку';
        box.parentNode.insertBefore(m, box.nextSibling);
      }
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#checkout-container .j-submit, #checkout-container button[type="submit"]');
    if (b) guard(e, b.closest('form'));
  }, true);
  document.addEventListener('submit', function (e) { guard(e, e.target); }, true);   // Enter у полі форми

  function tick() {
    var s = whSelect(); if (s) mark(s);
    [].forEach.call(document.querySelectorAll('.selectboxit-search-field, .mm-search input'), function (i) {
      if (!i.placeholder) i.placeholder = 'Пошук: номер або вулиця';
    });
  }
  scReady(scSafe(33, function () { tick(); setInterval(scSafe(33, tick), 700); }));
});

scModule(29, function () {
  'use strict';
  // «Відгуки про магазин» на головній (десктоп): 4 відгуки в ряд замість 3 і найдокладніші — першими.
  // Слайди лише переставляємо в DOM (без копіювання), тож обробники Хорошопа на картках лишаються.
  var box = document.querySelector('.top-reviews');
  if (!box) return;
  scStyle('sc-reviews-style',
    '@media (min-width:1000px){.top-reviews__item{width:25%!important}.top-reviews .review-item{min-height:0!important}' +
    // картки однієї висоти; ім'я / зірки / дата завжди трьома рядками (довге ім'я не зсуває зірки)
    '.top-reviews .swiper-wrapper,.top-reviews__carousel-wrapper{align-items:stretch!important}' +
    '.top-reviews__item{height:auto!important;display:flex!important}.top-reviews .review-item{height:auto!important;flex:1 1 auto;box-sizing:border-box}' +
    '.top-reviews .review-item__author{float:none!important;display:block!important}' +
    '.top-reviews .review-item__name{display:block!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.top-reviews .review-item__rating{display:flex!important;margin:3px 0 2px 0!important}.top-reviews .review-item__date{margin-left:0!important}}');
  var tries = 0;
  var run = scSafe(29, function () {
    var el = box.querySelector('.swiper-container-initialized');
    var sw = el && el.swiper;
    if (!sw) { if (++tries < 20) setTimeout(run, 500); return; }
    if (sw.params.loop) return;                                  // у режимі loop слайди-дублікати — не чіпаємо
    var len = function (s) {
      var t = s.querySelector('[class*="review-item__text"]') || s;
      return (t.textContent || '').trim().length;
    };
    var slides = [].slice.call(sw.slides);
    slides.sort(function (a, b) { return len(b) - len(a); });
    slides.forEach(function (s) { sw.wrapperEl.appendChild(s); });
    sw.params.slidesPerGroup = 4;
    if (sw.params.breakpoints) Object.keys(sw.params.breakpoints).forEach(function (k) {
      if (sw.params.breakpoints[k].slidesPerGroup) sw.params.breakpoints[k].slidesPerGroup = 4;
    });
    sw.update();
    sw.slideTo(0, 0);
  });
  scReady(function () { setTimeout(run, 300); });
});

scModule(32, function () {
  'use strict';
  // Футер (десктоп): телефони виділені, під ними графік роботи (з шапки), іконки контактів одного кольору,
  // адреса двома підписаними рядками, способи оплати текстом, без «Мобільна версія», плашка Хорошопа блідіша
  if (document.querySelector('script[src*="/bundles/mobile/"]')) return;
  if (!document.querySelector('.footer__contacts')) return;
  scStyle('sc-dfooter-style',
    '.footer .footer__contacts-item-link.j-phone-item{font-size:17px!important;font-weight:700!important;color:#1E1F1E!important;letter-spacing:.01em}' +
    '.footer .footer__contacts-item-link.j-phone-item:hover{color:#2E9E4F!important}' +
    '.footer .footer__contacts .icon,.footer .footer__address .icon{fill:#2E9E4F!important;opacity:1!important}' +
    // месенджери — у фірмових кольорах (впізнаваніше), решта іконок — зелені
    '.footer .footer__contacts .icon--viber{fill:#7360F2!important}.footer .footer__contacts .icon--whatsapp{fill:#25D366!important}.footer .footer__contacts .icon--telegram{fill:#229ED9!important}' +
    '.footer .footer__link:hover,.footer .footer__menu a:hover{color:#2E9E4F!important}' +
    '.footer .footer__mobile-version{display:none!important}' +
    // іконка телефону — біля кожного номера, як у месенджерів (замість однієї на групу)
    '.footer .footer__contacts-group > svg.icon--phone{display:none!important}' +
    '.footer .sc-fphone{position:relative}' +
    '.footer .sc-fphone svg{position:absolute!important;left:-24px!important;top:50%!important;transform:translateY(-50%)!important;width:16px;height:16px;margin:0!important;fill:#2E9E4F!important}' +
    // у файлі логотипа 200×100 багато порожнього поля зверху й знизу — обрізаємо, щоб не було дірки під лого
    '.footer .footer__logo{height:58px!important;overflow:hidden;margin-bottom:18px!important}.footer .footer__logo-img{margin-top:-21px!important}' +
    // плашка «Створено з Хорошоп» прихована за рішенням власника (03.11.2026); повернути — видалити цей рядок
    '.footer .footer__development{display:none!important}' +
    '.sc-fsched{font-size:13px;line-height:1.45;color:#4A4F4C;margin:4px 0 8px}' +
    '.sc-fsched b{color:#1E1F1E;font-weight:600}' +
    '.footer .footer__address .sc-faddr-t{display:block;color:#1E1F1E;font-weight:600;margin-top:10px}' +
    '.footer .footer__address .sc-faddr-t:first-child{margin-top:0}' +
    '.sc-fpay{list-style:none;margin:6px 0 10px;padding:0;font-size:13px;line-height:1.5;color:#4A4F4C}' +
    '.sc-fpay li{position:relative;padding-left:14px}' +
    '.sc-fpay li:before{content:"";position:absolute;left:0;top:.6em;width:6px;height:6px;border-radius:50%;background:#2E9E4F}' +
    '.sc-fpay-note{font-size:12px;color:#4A4F4C;margin-top:4px}');

  scReady(scSafe(32, function () {
    // іконка телефону до кожного номера
    var grp = document.querySelector('.footer .footer__contacts-group');
    var ico = grp && grp.querySelector(':scope > svg.icon--phone');
    if (ico) [].forEach.call(document.querySelectorAll('.footer .footer__contacts-item-link.j-phone-item'), function (a) {
      var it = a.closest('.footer__contacts-item');
      if (!it || it.classList.contains('sc-fphone')) return;
      it.classList.add('sc-fphone');
      it.insertBefore(ico.cloneNode(true), a);
    });
    // плашка «Створено з Хорошоп»: у неї inline display:flex !important — CSS не перекриє, ховаємо через style
    var dv = document.querySelector('.footer .footer__development');
    if (dv) dv.style.setProperty('display', 'none', 'important');
    // «Мапа проїзду» — прибираємо: самовивозу немає
    [].forEach.call(document.querySelectorAll('.footer .footer__address ~ a, .footer .footer__contacts a.footer__link'), function (a) {
      if (/Мапа проїзду/i.test(a.textContent || '')) a.style.display = 'none';
    });
    // Графік роботи — береться з шапки, щоб не дублювати текст у двох місцях
    var phones = document.querySelectorAll('.footer .footer__contacts-item-link.j-phone-item');
    if (phones.length && !document.querySelector('.sc-fsched')) {
      // найменший елемент шапки, де є і «Пн–Пт», і «Сб» (увесь графік, без заголовка «Графік роботи»)
      var src = [].filter.call(document.querySelectorAll('header *'), function (e) {
        var s = e.textContent || '';
        return /Пн[–-]Пт/.test(s) && /Сб/.test(s) && !/Графік/.test(s);
      }).sort(function (a, b) { return a.textContent.length - b.textContent.length; })[0];
      var lines = src ? src.innerText.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : [];
      if (lines.length) {
        var box = document.createElement('div');
        box.className = 'sc-fsched';
        // рядки виду «Пн–Пт: 09:00–20:00» (або «Пн–Пт:» і «09:00–20:00» окремо) → «<b>Пн–Пт:</b> 09:00–20:00»
        var rows = [];
        lines.forEach(function (s) {
          if (/:$/.test(s) || !rows.length || /^(Пн|Вт|Ср|Чт|Пт|Сб|Нд)/.test(s)) rows.push(s);
          else rows[rows.length - 1] += ' ' + s;
        });
        rows.forEach(function (s) {
          var k = s.indexOf(':');
          var row = document.createElement('div');
          var b = document.createElement('b'); b.textContent = k > 0 ? s.slice(0, k + 1) + ' ' : '';
          row.appendChild(b);
          row.appendChild(document.createTextNode(k > 0 ? s.slice(k + 1).trim() : s));
          box.appendChild(row);
        });
        var last = phones[phones.length - 1].closest('.footer__contacts-item');
        last.parentNode.insertBefore(box, last.nextSibling);
      }
    }

    // Адреса: «Відправлення замовлень: …  Юридична адреса: …» → два підписані рядки
    var addr = document.querySelector('.footer .footer__address');
    if (addr && !addr.querySelector('.sc-faddr-t')) {
      var t = addr.textContent.replace(/\s+/g, ' ').trim();
      var parts = t.split(/(Відправлення замовлень:|Юридична адреса:)/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (parts.length >= 4) {
        addr.textContent = '';
        for (var j = 0; j + 1 < parts.length; j += 2) {
          var h = document.createElement('span'); h.className = 'sc-faddr-t'; h.textContent = parts[j].replace(':', '');
          addr.appendChild(h);
          addr.appendChild(document.createTextNode(parts[j + 1].replace(/\.$/, '').replace(/,(\S)/g, ', $1')));
        }
      }
    }

    // Оплата: способи текстом. Якщо є блок «Покупка частинами» monobank — над ним,
    // інакше (частини вимкнено в Хорошопі, блок зникає) — під логотипом і копірайтом
    var pay = document.querySelector('.footer .footer__payment');
    var anchor = pay || document.querySelector('.footer .footer__copyright') || document.querySelector('.footer .footer__logo');
    if (anchor && !document.querySelector('.sc-fpay')) {
      var ul = document.createElement('ul');
      ul.className = 'sc-fpay';
      ['Оплата при отриманні', 'Карткою онлайн: Visa, Mastercard, Apple Pay, Google Pay', 'Безготівково для юросіб і ФОП'].forEach(function (s) {
        var li = document.createElement('li'); li.textContent = s; ul.appendChild(li);
      });
      if (pay) pay.parentNode.insertBefore(ul, pay);
      else anchor.parentNode.insertBefore(ul, anchor.nextSibling);
      if (pay && pay.querySelector('a[href*="chast.monobank"]')) {
        var n = document.createElement('div'); n.className = 'sc-fpay-note'; n.textContent = 'Покупка частинами від monobank';
        pay.parentNode.insertBefore(n, pay.nextSibling);
      }
    }
  }));
});

scModule(31, function () {
  'use strict';
  // Шапка (десктоп): кошик у тон новій палітрі — темний замість сіро-синього #3F4F67 з теми
  scStyle('sc-header-style',
    '.basket__icon .icon{fill:#1E1F1E!important}.basket__title,.basket__value{color:#1E1F1E!important}');
  // Шапка: тема дописує кому після першого телефону («+38 (066) 095-80-74,») — прибираємо
  scReady(scSafe(31, function () {
    [].forEach.call(document.querySelectorAll('.phones__item-link.j-phone-item'), function (a) {
      [].forEach.call(a.childNodes, function (n) {
        if (n.nodeType === 3 && /,\s*$/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/,\s*$/, '');
      });
    });
  }));
});

scModule(30, function () {
  'use strict';
  // Мобільна версія: телефони у футері — великі зелені кнопки з іконкою, номер з пробілами
  if (!document.querySelector('script[src*="/bundles/mobile/"]')) return;
  scStyle('sc-mfooter-style',
    '.footer .phones--inline{display:flex!important;flex-direction:column!important;gap:10px!important;padding:0 16px!important;margin-bottom:16px!important}' +
    '.footer .phones--inline .phones__item{margin:0!important;width:100%!important}' +
    '.footer .phones__link{display:flex!important;align-items:center;justify-content:center;gap:10px;height:50px;border-radius:12px;background:#2E9E4F;color:#fff!important;font-size:18px!important;font-weight:700!important;letter-spacing:.02em;text-decoration:none!important}' +
    '.footer .phones__link svg{width:20px;height:20px;flex:none}');
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>';
  scReady(scSafe(30, function () {
    // плашка «Створено з Хорошоп» (у неї inline display:flex !important — CSS не перекриє, тому через style)
    var dev = document.querySelector('.footer .footer__bottom');
    if (dev && dev.querySelector('a[href*="horoshop"]')) dev.style.setProperty('display', 'none', 'important');
    [].forEach.call(document.querySelectorAll('.footer .phones__link'), function (a) {
      if (a.querySelector('svg')) return;
      var d = a.textContent.replace(/\D/g, '');
      if (d.length === 12) a.textContent = '+38 ' + d.slice(2, 5) + ' ' + d.slice(5, 8) + ' ' + d.slice(8, 10) + ' ' + d.slice(10);
      a.insertAdjacentHTML('afterbegin', ICON);
    });
  }));
});

scModule(23, function () {
  'use strict';

  var CSS =
    '.sc-live{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 28px}' +
    '.sc-live__item{flex:1 1 160px;max-width:220px;border:1px solid #e3e8ef;border-radius:10px;padding:12px;text-align:center;text-decoration:none!important;color:#1c2430;display:flex;flex-direction:column;align-items:center;background:#fff;transition:border-color .15s}' +
    '.sc-live__item:hover{border-color:#1f6fd1}' +
    '.sc-live__img{width:100%;max-width:160px;height:160px;object-fit:contain}' +
    '.sc-live__name{margin:8px 0 4px;font-weight:bold;font-size:14px;line-height:1.3;color:#1f6fd1}' +
    '.sc-live__price{margin-top:auto;font-weight:bold;font-size:15px;color:#1c2430}' +
    '.sc-live__av{font-size:12px;color:#2e9e4f;margin-top:2px}';

  var cards = scCards;   // парсер карток каталогу — спільний (див. «Спільні помічники»)

  function render(box, list) {
    var wrap = document.createElement('div');
    wrap.className = 'sc-live';
    list.forEach(function (p) {
      var a = document.createElement('a');
      a.className = 'sc-live__item'; a.href = p.url;
      a.innerHTML = (p.img ? '<img class="sc-live__img" loading="lazy" alt="">' : '') +
        '<span class="sc-live__name"></span><span class="sc-live__price"></span><span class="sc-live__av">В наявності</span>';
      if (p.img) { var im = a.querySelector('img'); im.src = p.img; im.alt = p.name; }
      a.querySelector('.sc-live__name').textContent = p.name;
      a.querySelector('.sc-live__price').textContent = p.price;
      wrap.appendChild(a);
    });
    box.innerHTML = '';
    box.appendChild(wrap);
  }

  function load(box) {
    if (box.getAttribute('data-sc-ready')) return;
    box.setAttribute('data-sc-ready', '1');
    var src = box.getAttribute('data-sc-products') || '';
    if (!/^\/[\w\-\/.]*$/.test(src) || /\/filter\//.test(src)) return;     // лише власні сторінки, без /filter/
    var re = null;
    try { re = box.getAttribute('data-match') ? new RegExp(box.getAttribute('data-match'), 'i') : null; } catch (e) {}
    var limit = parseInt(box.getAttribute('data-limit'), 10) || 8;
    fetch(SC_LANG + src, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.text() : ''; })
      .then(scSafe(23, function (html) {
        if (!html) return;
        var list = cards(html).filter(function (p) {
          return p.url && p.name && scInStock(p.avail) && (!re || re.test(p.name));
        }).slice(0, limit);
        if (!list.length) return;                                            // лишаємо статичні картки
        scStyle('sc-live-style', CSS);
        render(box, list);
      }))['catch'](function () {});
  }

  function init() {
    var boxes = document.querySelectorAll('[data-sc-products]');
    if (!boxes.length) return;
    [].forEach.call(boxes, function (b) { scNear(b, scSafe(23, function () { load(b); })); });   // вантажимо, коли читач догортав
  }

  scIdle(scSafe(23, init));
});


/* =====================================================================
 * 34. Сторінка «Сервісний центр» → заявка на діагностику / ремонт
 *     Вмикається лише там, де в тексті сторінки є
 *       <div data-sc-service-form data-url="https://script.google.com/macros/s/…/exec"></div>
 *     data-url — веб-застосунок з apps-script/service/Code.gs (таблиця заявок + Telegram).
 *     Без data-url (або з чужою адресою) форма не показується — лишається вміст div.
 *     Після відправки: номер заявки, що робити далі, кнопка «Роздрукувати заявку» (вкладається
 *     в коробку). Пристрій приймаємо лише Новою Поштою — дані отримувача в SVC_NP (показуємо на екрані
 *     після заявки й у роздруківці); відправляти — після підтвердження менеджера.
 *     Поле how (спосіб передачі) у формі не показуємо, але надсилаємо «Новою Поштою» — його чекає Apps Script.
 * ===================================================================== */
scModule(34, function () {
  'use strict';

  var SVC_NP = 'Нова Пошта: Київ, відділення №384. Отримувач: ТОВ «ТРІНІТІ-СБ», ЄДРПОУ 34186648, тел. +38 068 374 54 56 — лише для накладної; питання щодо ремонту — +38 050 394 15 00';
  var URL_OK = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

  // [name, підпис, тип, обов'язкове, підказка]; тип: t — рядок, tel, email, a — textarea, s:… — вибір
  var GROUPS = [
    ['Контактні дані', [
      ['name', 'ПІБ', 't', 1, 'Прізвище, ім’я'],
      ['phone', 'Телефон', 'tel', 1, '+380…'],
      ['email', 'Електронна пошта', 'email', 0, ''],
      ['company', 'Назва компанії', 't', 0, 'якщо купували на компанію / ФОП']
    ]],
    ['Покупка', [
      ['order', 'Номер замовлення SafeCity', 't', 0, 'або дата покупки'],
      ['kind', 'Вид звернення', 's:Гарантійний ремонт|Платний ремонт / діагностика|Не знаю, потрібна діагностика', 1, '']
    ]],
    ['Інформація про пристрій', [
      ['model', 'Модель', 't', 1, 'напр. Hikvision DS-2CD1043G2-LIU'],
      ['serial', 'Серійний номер', 't', 0, 'з наклейки на корпусі'],
      ['problem', 'Детальний опис несправності', 'a', 1, 'Що саме не працює, коли почалося, що вже пробували'],
      ['kit', 'Комплектація', 'a', 0, 'Що кладете в коробку: блок живлення, кабелі, кріплення…'],
      ['extra', 'Додаткова інформація', 'a', 0, '']
    ]],
    ['Відправка Новою Поштою', [
      ['ttn', 'ТТН Нової Пошти', 't', 0, 'якщо вже відправили'],
      ['back', 'Куди повернути після ремонту', 't', 0, 'місто і відділення Нової Пошти']
    ]]
  ];

  var CSS =
    '.sc-svc{border:1px solid #d6e2f2;border-radius:12px;padding:20px 22px;margin:0 0 28px;background:#f7faff;font-size:15px;line-height:1.45;color:#1c2430}' +
    '.sc-svc__t{font-weight:bold;font-size:20px;margin:0 0 4px}' +
    '.sc-svc__sub{color:#5b6675;font-size:14px;margin:0 0 14px}' +
    '.sc-svc__g{font-weight:bold;font-size:16px;margin:18px 0 8px}' +
    '.sc-svc__grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}' +
    '.sc-svc__f{display:flex;flex-direction:column;gap:4px;min-width:0}' +
    '.sc-svc__f--w{grid-column:1/-1}' +
    '.sc-svc__l{font-size:14px;font-weight:bold}' +
    '.sc-svc__l b{color:#d33}' +
    '.sc-svc input,.sc-svc select,.sc-svc textarea{width:100%!important;max-width:100%;box-sizing:border-box;border:1px solid #c5d3e6;border-radius:8px;padding:8px 10px;font-size:15px;font-family:inherit;background:#fff;color:#1c2430}' +
    '.sc-svc input,.sc-svc select{height:40px}' +
    '.sc-svc textarea{min-height:76px;resize:vertical}' +
    '.sc-svc .sc-svc__bad{border-color:#d33;background:#fff6f6}' +
    '.sc-svc__hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;overflow:hidden}' +
    '.sc-svc__agree{font-size:13px;color:#5b6675;margin:14px 0 0}' +
    '.sc-svc__btn{display:inline-block;margin:14px 10px 0 0;padding:11px 26px;border:0;border-radius:8px;background:#1f6fd1;color:#fff;font-size:16px;font-weight:bold;cursor:pointer}' +
    '.sc-svc__btn:hover{background:#185bb0}' +
    '.sc-svc__btn[disabled]{opacity:.6;cursor:default}' +
    '.sc-svc__btn--o{background:#fff;color:#1f6fd1;border:1px solid #1f6fd1}' +
    '.sc-svc__btn--o:hover{background:#eaf2fd}' +
    '.sc-svc__err{color:#c22;font-size:14px;margin:10px 0 0}' +
    '.sc-svc__ok{background:#fff;border-left:4px solid #2e9e4f;border-radius:10px;padding:14px 16px}' +
    '.sc-svc__num{font-size:24px;font-weight:bold;margin:2px 0 8px}' +
    '.sc-svc__ok ol{margin:8px 0 0 18px;padding:0}' +
    '.sc-svc__ok li{margin:0 0 6px}' +
    '@media (max-width:600px){.sc-svc{padding:14px}.sc-svc__grid{grid-template-columns:1fr}.sc-svc__btn{width:100%;margin-right:0}}' +
    '#sc-svc-print{display:none}' +
    '@media print{body.sc-svc-printing>*{display:none!important}body.sc-svc-printing>#sc-svc-print{display:block!important}' +
    '#sc-svc-print{font:13px/1.4 Arial,sans-serif;color:#000}#sc-svc-print h1{font-size:18px;margin:0 0 4px}' +
    '#sc-svc-print table{width:100%;border-collapse:collapse;margin:10px 0}#sc-svc-print td{border:1px solid #999;padding:5px 7px;vertical-align:top}' +
    '#sc-svc-print td:first-child{width:32%;font-weight:bold}#sc-svc-print .s{margin-top:28px;display:flex;justify-content:space-between}}';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fieldHtml(f) {
    var id = 'sc-svc-' + f[0], type = f[2], req = f[3] ? ' required' : '';
    var lbl = '<label class="sc-svc__l" for="' + id + '">' + esc(f[1]) + (f[3] ? ' <b>*</b>' : '') + '</label>';
    var ph = f[4] ? ' placeholder="' + esc(f[4]) + '"' : '';
    var ctl;
    if (type === 'a') ctl = '<textarea id="' + id + '" name="' + f[0] + '"' + ph + req + ' maxlength="2000"></textarea>';
    else if (type.indexOf('s:') === 0) {
      ctl = '<select id="' + id + '" name="' + f[0] + '"' + req + '><option value="">— оберіть —</option>' +
        type.slice(2).split('|').map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('') + '</select>';
    } else {
      ctl = '<input id="' + id + '" name="' + f[0] + '" type="' + (type === 't' ? 'text' : type) + '"' + ph + req +
        ' maxlength="200"' + (type === 'tel' ? ' inputmode="tel" autocomplete="tel"' : type === 'email' ? ' autocomplete="email"' : f[0] === 'name' ? ' autocomplete="name"' : '') + '>';
    }
    return '<div class="sc-svc__f' + (type === 'a' ? ' sc-svc__f--w' : '') + '">' + lbl + ctl + '</div>';
  }

  function formHtml() {
    return '<div class="sc-svc__t">Заявка до сервісного центру</div>' +
      '<div class="sc-svc__sub">Поля з <b style="color:#d33">*</b> обов’язкові. Після відправки ви отримаєте номер заявки.</div>' +
      '<form novalidate>' +
      GROUPS.map(function (g) {
        return '<div class="sc-svc__g">' + esc(g[0]) + '</div><div class="sc-svc__grid">' + g[1].map(fieldHtml).join('') + '</div>';
      }).join('') +
      '<div class="sc-svc__hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>' +
      '<div class="sc-svc__agree">Надсилаючи заявку, ви погоджуєтесь з умовами сервісного обслуговування на цій сторінці.</div>' +
      '<button class="sc-svc__btn" type="submit">Відправити заявку</button>' +
      '<div class="sc-svc__err" hidden></div>' +
      '</form>';
  }

  function allFields() {
    var out = [];
    GROUPS.forEach(function (g) { g[1].forEach(function (f) { out.push(f); }); });
    return out;
  }

  function collect(form) {
    var d = {};
    allFields().forEach(function (f) { d[f[0]] = String(form.elements[f[0]].value || '').trim(); });
    d.how = 'Новою Поштою';                           // інших способів немає
    return d;
  }

  function check(form, d) {
    var bad = [];
    allFields().forEach(function (f) {
      var el = form.elements[f[0]], v = d[f[0]], ok = true;
      if (f[3] && !v) ok = false;
      if (ok && f[0] === 'phone') ok = v.replace(/\D/g, '').length >= 10;
      if (ok && f[0] === 'email' && v) ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      if (ok && f[0] === 'problem') ok = v.length >= 5;
      el.classList.toggle('sc-svc__bad', !ok);
      if (!ok) bad.push(el);
    });
    return bad;
  }

  function printReq(num, date, d) {
    var p = document.getElementById('sc-svc-print');
    if (!p) { p = document.createElement('div'); p.id = 'sc-svc-print'; document.body.appendChild(p); }
    p.innerHTML = '<h1>Заявка до сервісного центру № ' + esc(num) + '</h1>' +
      '<div>Від ' + esc(date) + ' · магазин SafeCity (safecity.in.ua)</div>' +
      '<table>' + allFields().map(function (f) {
        return '<tr><td>' + esc(f[1]) + '</td><td>' + (esc(d[f[0]]) || '—').replace(/\n/g, '<br>') + '</td></tr>';
      }).join('') + '</table>' +
      '<div>Відправка: ' + esc(SVC_NP) + '.</div>' +
      '<div class="s"><span>Дата: ____________</span><span>Підпис замовника: ____________________</span></div>';
    document.body.classList.add('sc-svc-printing');
    var done = function () { document.body.classList.remove('sc-svc-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1500);                          // Safari не завжди надсилає afterprint
  }

  function showOk(box, num, d) {
    var date = new Date().toLocaleDateString('uk-UA');
    box.innerHTML = '<div class="sc-svc__t">Заявку прийнято</div>' +
      '<div class="sc-svc__ok"><div>Номер заявки</div><div class="sc-svc__num"></div>' +
      '<div>Менеджер SafeCity зв’яжеться з вами протягом робочого дня (Пн–Пт) і підтвердить заявку.</div>' +
      '<ol>' +
      '<li>Роздрукуйте заявку й покладіть у коробку разом із пристроєм. Немає принтера — напишіть номер заявки на коробці.</li>' +
      '<li>Перевірте комплектацію та надійно запакуйте пристрій.</li>' +
      '<li>Після підтвердження менеджера відправте пристрій. ' + esc(SVC_NP) + '. В описі відправлення вкажіть «SafeCity, заявка <span class="sc-svc__n2"></span>».</li>' +
      '</ol></div>' +
      '<button class="sc-svc__btn" type="button" data-a="print">Роздрукувати заявку</button>' +
      '<button class="sc-svc__btn sc-svc__btn--o" type="button" data-a="new">Нова заявка</button>';
    box.querySelector('.sc-svc__num').textContent = num;
    var n2 = box.querySelector('.sc-svc__n2'); if (n2) n2.textContent = num;
    box.querySelector('[data-a="print"]').addEventListener('click', scSafe(34, function () { printReq(num, date, d); }));
    box.querySelector('[data-a="new"]').addEventListener('click', scSafe(34, function () { build(box); }));
    try { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
  }

  function build(box) {
    var url = box.getAttribute('data-url') || '';
    box.className = 'sc-svc';
    box.innerHTML = formHtml();
    var form = box.querySelector('form'), btn = form.querySelector('button'), err = form.querySelector('.sc-svc__err');
    var say = function (t) { err.textContent = t; err.hidden = !t; };

    form.addEventListener('input', function (e) {
      if (e.target.classList) e.target.classList.remove('sc-svc__bad');
    });

    form.addEventListener('submit', scSafe(34, function (e) {
      e.preventDefault();
      say('');
      var d = collect(form), bad = check(form, d);
      if (bad.length) {
        say('Заповніть, будь ласка, виділені поля.');
        try { bad[0].focus(); } catch (x) {}
        return;
      }
      btn.disabled = true; btn.textContent = 'Надсилаємо…';
      var body = JSON.stringify({ form: d, website: form.elements.website.value, page: location.origin + location.pathname, build: SC_BUILD });
      // text/plain — без CORS-preflight; Apps Script відповідає JSON {ok, num} або {ok:false, error}
      fetch(url, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (r && r.ok && r.num) { showOk(box, r.num, d); return; }
          throw new Error((r && r.error) || 'немає номера заявки');
        })
        .catch(function (x) {
          btn.disabled = false; btn.textContent = 'Відправити заявку';
          say('Не вдалося відправити заявку. Спробуйте ще раз або напишіть нам у Viber / Telegram: +' + SC_PHONE + '.');
          scHealth('блок 34: відправка заявки', x);
        });
    }));
  }

  function init() {
    var boxes = document.querySelectorAll('[data-sc-service-form]');
    if (!boxes.length) return;
    [].forEach.call(boxes, function (b) {
      if (b.getAttribute('data-sc-ready') || !URL_OK.test(b.getAttribute('data-url') || '')) return;
      b.setAttribute('data-sc-ready', '1');
      scStyle('sc-svc-style', CSS);
      scSafe(34, build)(b);
    });
  }

  scReady(scSafe(34, init));
});


/* =====================================================================
 * 35. Картка товару → «Або напишіть нам: Telegram · Viber» — компактний рядок під «Купити» (06.11.2026)
 *     Telegram — клієнтський бот (start=buy_<артикул>): картка товару з ціною й наявністю,
 *       замовлення або запитання; менеджеру — сповіщення, відповідь через Reply.
 *     Viber — чат із номером SC_PHONE з готовим текстом (назва, артикул, посилання).
 *     Клік → подія sc_messenger_click у dataLayer (GA4 через GTM) + gtag / Meta / TikTok «Contact».
 *     Лише для товарів у наявності (для відсутніх — блок 16).
 * ===================================================================== */
scModule(35, function () {
  'use strict';

  var CSS =
    // компактний рядок під «Купити»: другорядна дія, не конкурує з кнопкою покупки
    '#sc-msg{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin:12px 0 0;font-size:14px;line-height:1.3}' +
    '#sc-msg .scm-t{color:#5f6b78;font-size:14px;margin:0}' +
    '#sc-msg .scm-b{display:flex;gap:8px}' +
    '#sc-msg .scm-b a{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px 0 10px;border:1px solid #dbe2ea;border-radius:17px;' +
      'background:#fff;color:#1d2733;text-decoration:none;font-weight:500;font-size:14px;white-space:nowrap;transition:border-color .15s,background .15s}' +
    '#sc-msg .scm-b a:hover{border-color:#b9c6d4;background:#f6f9fc}' +
    '#sc-msg svg{flex:0 0 18px;width:18px;height:18px}';
  var ICON = {
    tg: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#2AABEE"/>' +
      '<path d="M5.4 11.7l11.2-4.3c.5-.2 1 .1.8.9l-1.9 9c-.1.6-.5.8-1 .5l-2.9-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-3 5.4-4.9c.2-.2 0-.3-.3-.1l-6.7 4.2-2.9-.9c-.6-.2-.6-.6.1-.9z" fill="#fff"/></svg>',
    viber: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#7360F2"/>' +
      '<path d="M9.3 6.6c-.3-.3-.8-.3-1.1 0l-.9.9c-.7.7-.8 1.9-.2 3.1 1.3 2.6 3.4 4.8 6.1 6.1 1.2.6 2.4.5 3.1-.2l.9-.9c.3-.3.3-.8 0-1.1l-1.7-1.5c-.3-.3-.8-.3-1.1 0l-.8.8c-1.4-.6-2.6-1.8-3.2-3.2l.8-.8c.3-.3.3-.8 0-1.1L9.3 6.6z" fill="#fff"/>' +
      '<path d="M13 6.3a4.8 4.8 0 0 1 4.7 4.7M13 8.3a2.8 2.8 0 0 1 2.7 2.7" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/></svg>'
  };

  function track(m, name, art) {
    try { (window.dataLayer = window.dataLayer || []).push({ event: 'sc_messenger_click', messenger: m, item_id: art, item_name: name }); } catch (x) {}
    try { if (typeof window.gtag === 'function') window.gtag('event', 'sc_messenger_click', { messenger: m, item_id: art }); } catch (x) {}
    try { if (typeof window.fbq === 'function') window.fbq('track', 'Contact', { content_ids: [art], content_type: 'product' }); } catch (x) {}
    try { if (window.ttq && typeof window.ttq.track === 'function') window.ttq.track('Contact', { contents: [{ content_id: art, content_type: 'product' }] }); } catch (x) {}
  }

  function init() {
    if (document.getElementById('sc-msg')) return;
    var anchor = scAnchor();
    if (!anchor || !document.querySelector(SC_AVAIL_SEL)) return;
    var name = scH1().replace(/\s+/g, ' ').trim();
    var art = scArt().replace(/[^\w-]/g, '').slice(0, 50);
    if (!name || !art) return;
    var url = location.origin + location.pathname;
    var msg = 'Добрий день! Хочу замовити: ' + name + ' (арт. ' + art + ')\n' + url;

    scStyle('sc-msg-style', CSS);
    var box = document.createElement('div');
    box.id = 'sc-msg';
    box.innerHTML = '<div class="scm-t">Або напишіть нам:</div><div class="scm-b">' +
      (SC_CLIENT_BOT ? '<a data-m="telegram" target="_blank" rel="noopener">' + ICON.tg + 'Telegram</a>' : '') +
      '<a data-m="viber">' + ICON.viber + 'Viber</a></div>';
    if (SC_CLIENT_BOT) box.querySelector('[data-m="telegram"]').href = 'https://t.me/' + SC_CLIENT_BOT + '?start=buy_' + art;
    box.querySelector('[data-m="viber"]').href = 'viber://chat?number=%2B' + SC_PHONE + '&draft=' + encodeURIComponent(msg);
    [].forEach.call(box.querySelectorAll('a'), function (a) {
      a.addEventListener('click', function () { track(a.getAttribute('data-m'), name, art); });
    });

    // одразу під блоком «Купити» (не над ним: плашка відправки, блок 1, стоїть перед цим блоком), перед плашкою довіри (блок 15)
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
    // плашка довіри могла підтягнутися до кнопок від'ємним відступом — тепер цей відступ у нас
    var trust = document.getElementById('sc-trust');
    if (trust && trust.previousElementSibling === box && trust.style.marginTop) {
      box.style.marginTop = trust.style.marginTop; trust.style.marginTop = '';
    } else {
      var mb = parseFloat(getComputedStyle(anchor).marginBottom) || 0;
      if (mb > 16) box.style.marginTop = (12 - mb) + 'px';
    }
  }

  scInit(35, init);
});


/* =====================================================================
 * 36. Картка товару → характеристики: числові поля фільтрів не дублюють текстові (09.11.2026)
 *     Для повзунків фільтрів у шаблонах є окремі числові параметри «Довжина, м», «Енергоємність, Вт·год»,
 *     «Потужність, Вт», «Роздільна здатність, Мп»… Хорошоп показує їх у картці поруч із текстовими
 *     («Довжина кабелю 40 м» + «Довжина, м 40.0»). Якщо те саме число вже є в іншому рядку — числовий
 *     рядок ховаємо; якщо немає — лише прибираємо «.0» (40.0 → 40). У DOM рядки лишаються (scFeatures читає їх).
 * ===================================================================== */
scModule(36, function () {
  'use strict';

  var NUM_LABEL = /^(.+),\s*(м|мм|см|вт·год|вт\*год|вт|квт|а·год|а|мп|u|кг)$/i;
  // як ця ж величина може бути записана в текстовій характеристиці: [одиниця, множник до одиниці поля]
  var M = [['м(?![а-яіїєa-z])|m(?![a-z])|метр', 1], ['мм|mm', 0.001], ['см|cm', 0.01], ['км|km', 1000]];
  var WH = [['вт·год|вт\\*год|вт ?год|wh', 1], ['квт·год|квт\\*год|квт ?год|kwh', 1000]];
  var W = [['вт(?![·*\\s]?год)|w(?!h)', 1], ['квт(?![·*\\s]?год)|kw(?!h)', 1000]];
  var UNIT = {
    'м': M, 'мм': [['мм|mm', 1], ['см|cm', 10], ['м(?![а-яіїєa-z])|m(?![a-z])', 1000]], 'см': [['см|cm', 1], ['мм|mm', 0.1]],
    'вт·год': WH, 'вт*год': WH, 'вт': W, 'квт': [['квт(?![·*\\s]?год)|kw(?!h)', 1], ['вт(?![·*\\s]?год)|w(?!h)', 0.001]],
    'а·год': [['а·год|а\\*год|аг|ah', 1], ['ма·год|мaг|mah', 0.001]], 'а': [['а(?![·*\\s]?год|г|[а-яіїєa-z])|a(?![a-z])', 1], ['ма(?![·*\\s]?год|г|[а-яіїєa-z])|ma(?![a-z])', 0.001]], 'мп': [['мп|mp|мпікс', 1]], 'u': [['u', 1]], 'кг': [['кг|kg', 1], ['г(?![а-яіїєa-z])|g(?![a-z])', 0.001]]
  };

  function cells(r) {
    var c = r.querySelectorAll('th,td');
    return c.length === 2 ? c : null;
  }
  // значення в одиницях поля для всіх чисел із відповідною одиницею
  function nums(t, list) {
    var out = [];
    list.forEach(function (u) {
      var re = new RegExp('(\\d+(?:[.,]\\d+)?)\\s?(?:' + u[0] + ')', 'gi'), m;
      while ((m = re.exec(t))) out.push(parseFloat(m[1].replace(',', '.')) * u[1]);
    });
    return out;
  }
  // збіг з точністю до округлення поля (22.5 Вт у тексті → 23 у полі)
  function same(x, v) { return Math.abs(x - v) < 0.01 || Math.round(x) === v; }

  // «Застосування» з фіду постачальника: прибрати значення, що звужують або плутають призначення.
  // Ключ — «Тип пристрою» у нижньому регістрі; '*' — для всіх; true — сховати рядок повністю.
  var APPLY_FIX = {
    'кабель hdmi': true,                 // «Для проєкторів» — кабель не лише для проєкторів
    'poe-комутатор': true,               // «Для серверів» — PoE-комутатори для камер
    'комутатор': true,
    'блок безперебійного живлення': ['Для сигналізації'], // ДБЖ 12/24 В — і для камер/домофонів
    '*': ['Для риболовлі', 'Для ДПС']
  };
  var APPLY_RENAME = { 'Джерела безперебійного живлення': 'Для ДБЖ', 'Інвертори': 'Для інверторів' };

  function fixApply(rows) {
    var type = '', row = null;
    [].forEach.call(rows, function (r) {
      var c = cells(r);
      if (!c) return;
      var h = c[0].textContent.replace(/\s+/g, ' ').trim().toLowerCase();
      if (h === 'тип пристрою') type = c[1].textContent.replace(/\s+/g, ' ').trim().toLowerCase();
      else if (h === 'застосування') row = r;
    });
    if (!row || row.getAttribute('data-sc-apply')) return;
    row.setAttribute('data-sc-apply', '1');
    var rule = APPLY_FIX[type];
    if (rule === true) { row.style.display = 'none'; return; }
    var drop = (rule || []).concat(APPLY_FIX['*']);
    var cell = cells(row)[1];
    var vals = cell.textContent.replace(/\s+/g, ' ').trim().split(/\s*[,;]\s*/);
    var out = vals.filter(function (v) { return v && drop.indexOf(v) < 0; })
      .map(function (v) { return APPLY_RENAME[v] || v; });
    if (!out.length) row.style.display = 'none';
    else if (out.join(', ') !== vals.join(', ')) cell.textContent = out.join(', ');
  }

  function init() {
    var rows = document.querySelectorAll('.product-features__row');
    if (!rows.length) return;
    fixApply(rows);
    [].forEach.call(rows, function (r) {
      if (r.getAttribute('data-sc-num')) return;
      var c = cells(r);
      if (!c) return;
      var m = c[0].textContent.replace(/\s+/g, ' ').trim().match(NUM_LABEL);
      if (!m) return;
      r.setAttribute('data-sc-num', '1');
      var raw = c[1].textContent.replace(/\s+/g, ' ').trim();
      if (!/^\d+(?:[.,]\d+)?$/.test(raw)) return;
      var v = parseFloat(raw.replace(',', '.')), unit = UNIT[m[2].toLowerCase()];
      var dup = unit && [].some.call(rows, function (o) {
        if (o === r) return false;
        var oc = cells(o);
        if (!oc || NUM_LABEL.test(oc[0].textContent.replace(/\s+/g, ' ').trim())) return false;
        return nums(oc[1].textContent, unit).some(function (x) { return same(x, v); });
      });
      if (dup) r.style.display = 'none';
      else c[1].textContent = String(Math.round(v * 100) / 100);
    });
  }

  scInit(36, init);
});


/* =====================================================================
 * 37. Розумний пошук (10.11.2026)
 *     Вбудований пошук Хорошопу шукає лише за початком слова: не розуміє «павербанк», «4мп», «100аг»,
 *     код моделі без дефісів, опечатки, розкладку, російські слова. Тут — власний пошук по індексу
 *     search/index.json (усі товари з Facebook-фіду Хорошопу + ключові характеристики постачальника;
 *     збирається щоночі GitHub Action search-index, tools/build_search_index.py).
 *     • Підказки під полем пошуку (замість підказок Хорошопу) — індекс вантажиться лише при фокусі на полі.
 *     • Сторінка /katalog/search/?q=… — наші результати замість списку Хорошопу; якщо в нас нічого
 *       не знайшлось — лишаємо результати Хорошопу (запасний варіант).
 *     • GA4: sc_search (search_term, results, place) — видно запити без результатів.
 *     Увімкнення: SC_SEARCH_ON; для перевірки ?sc_search=1 / ?sc_search=0 (запам'ятовується в браузері).
 *     10.11.2026 (після порівняння з чужим віджетом search.33-2.store — не ставимо: конфліктує з цим блоком,
 *     шле запити й GA-id відвідувачів на свій сервер, зроблений під інший магазин; корисне перенесли сюди):
 *     • опечатки — через словник індексу й ключі синонімів («камрера» → відеокамера), а не по кожному товару;
 *     • число в запиті не шукається всередині іншого числа («ups 1000» ≠ артикул 41-00040, «450» ≠ «4500»);
 *     • без точного збігу — лише товари з найбільшою кількістю збіглих слів («сонячна панель 450»);
 *     • у підказках — категорії й бренди знайденого (ведуть на сторінку результатів з фільтром &k= / &b=);
 *     • порожнє поле — «Ви шукали» (6 останніх запитів, localStorage sc37-hist, кнопка «Очистити»);
 *     • сторінка результатів — фільтри «Категорія» і «Бренд» (у посиланні), GA4: sc_search_facet.
 *     • з реальних запитів (GA4 sc_search + Search Console): англійські слова (battery, inverter…), русизми,
 *       слова через дефіс; «Показано для: камера» при виправленні; фільтри за характеристиками
 *       (Мп, канали, порти, Ah / mAh, Вт, PoE, Wi-Fi, вулична…, &a=); голосовий пошук (мікрофон у полі);
 *       GA4: sc_search_zero / sc_search_partial / sc_search_fixed / sc_search_voice — для тижневого звіту.
 *     • «від N» за характеристиками (поле q індексу), доводчики за вагою дверей (поле r);
 *       наявність «наживо» з карток каталогу й товару (localStorage sc37-live, 12 год) — фід оновлюється раз на добу.
 * ===================================================================== */
var SC_SEARCH_ON = true;    // true — для всіх відвідувачів
var SC_SEARCH_INDEX = 'https://valnuz-ops.github.io/safecity-scripts/search/index.json';
var SC_SEARCH_STOCK = 'https://valnuz-ops.github.io/safecity-scripts/search/stock.json';   // наявність, щогодини

scModule(37, function () {
  'use strict';
  var flag = location.search.match(/[?&]sc_search=([01])/);
  try { if (flag) localStorage.setItem('sc_search', flag[1]); } catch (e) {}
  var local = (function () { try { return localStorage.getItem('sc_search'); } catch (e) { return null; } })();
  if (!(local === '1' || (SC_SEARCH_ON && local !== '0'))) return;
  try { new RegExp('(?<![a-z])a'); } catch (e) { return; }   // старі браузери (iOS < 16.4) — лишаємо пошук Хорошопу

  /* ---------- ядро пошуку ---------- */
  var W = '0-9a-zа-яіїєґ', B = '(?<![' + W + '])', E = '(?![' + W + '])', N = '(\\d+(?:[.,]\\d+)?)\\s?';
  function R(src) { return new RegExp(src.replace(/\\b</g, B).replace(/\\b>/g, E), 'g'); }
  var PHRASES = [
    [R('\\b<(?:power ?bank|павер ?банк|повер ?банк|пауер ?банк)\\S*'), 'повербанк'],
    [R('\\b<(?:wi[\\s-]?fi|вай[\\s-]?фай|вифи|віфі)\\b>'), 'wifi'],
    [R('\\b<(?:ip|іп)[\\s-]?камер'), 'ip камер'],
    [R(N + '(?:мп|mp|мегапікс\\S*|мегапикс\\S*|mpx)\\b>'), '$1mp'],
    [R(N + '(?:ah|аг|а·год|а\\*год|ач|а·ч|а\\*ч|а год|ампер ?год\\S*)\\b>'), '$1ah'],
    [R(N + '(?:mah|маг|ма·год|мач|ма·ч|ма год)\\b>'), '$1mah'],
    [R(N + '(?:kwh|квт·год|квт\\*год|квт год|квтг|квтч)\\b>'), '$1kwh'],
    [R(N + '(?:wh|вт·год|вт\\*год|вт год|втг|втч)\\b>'), '$1wh'],
    [R(N + '(?:kva|ква)\\b>'), '$1kva'],
    [R(N + '(?:va|ва)\\b>'), '$1va'],
    [R(N + '(?:kw|квт|кв)\\b>'), '$1kw'],
    [R(N + '(?:w|вт|vt|ват\\S*)\\b>'), '$1w'],
    [R(N + '(?:v|в|вольт\\S*)\\b>'), '$1v'],
    [R(N + '(?:a|а|ампер\\S*)\\b>'), '$1a'],
    [R(N + '(?:mm|мм)\\b>'), '$1мм'],
    [R(N + '(?:cm|см)\\b>'), '$1см'],
    [R(N + '(?:kg|кг|кілограм\\S*|килограм\\S*)\\b>'), '$1kg'],
    [R(N + '(?:m|м|метр\\S*)\\b>'), '$1м'],
    [R('(\\d+)\\s?-?\\s?(?:х\\s?)?(?:канал\\S*|кан|ch|channel\\S*)\\b>'), '$1канал'],
    [R('(\\d+)\\s?-?\\s?(?:порт\\S*|port\\S*)\\b>'), '$1порт'],
    [R('(\\d+)\\s?(?:tb|тб)\\b>'), '$1tb'], [R('(\\d+)\\s?(?:gb|гб)\\b>'), '$1gb']
  ];
  // слово запиту → додаткові варіанти (будь-який може збігтися)
  var SYN = {
    'камера': ['відеокамера', 'камера'], 'камеры': ['відеокамера', 'камера'], 'камери': ['відеокамера', 'камера'], 'камеру': ['відеокамера', 'камера'], 'видеокамера': ['відеокамера'],
    'реєстратор': ['відеореєстратор', 'реєстратор'], 'регистратор': ['відеореєстратор', 'реєстратор'], 'регістратор': ['відеореєстратор', 'реєстратор'], 'видеорегистратор': ['відеореєстратор'], 'відеорегістратор': ['відеореєстратор'], 'nvr': ['відеореєстратор', 'nvr'], 'dvr': ['відеореєстратор', 'dvr'], 'xvr': ['гібридний', 'xvr'],
    'домофон': ['відеодомофон', 'домофон', 'аудіодомофон'], 'видеодомофон': ['відеодомофон'], 'панель': ['відеопанель', 'панель'], 'вызывная': ['відеопанель'], 'викликна': ['відеопанель'], 'дзвінок': ['відеодзвінок', 'дзвінок'], 'звонок': ['відеодзвінок', 'дзвінок'],
    'акб': ['акумулятор', 'акб'], 'аккумулятор': ['акумулятор'], 'батарея': ['акумулятор', 'батарея'],
    'ибп': ['дбж', 'ups', 'безперебійного'], 'ббж': ['дбж', 'ups', 'безперебійного'], 'упс': ['дбж', 'ups'], 'ups': ['дбж', 'ups'], 'бесперебойник': ['дбж', 'безперебійного'], 'безперебійник': ['дбж', 'безперебійного'],
    'инвертор': ['інвертор'], 'зарядная': ['зарядна'], 'станция': ['станція'], 'генератор': ['генератор'],
    'сигнализация': ['сигналізація', 'ajax'], 'сигналізація': ['сигналізація', 'ajax'], 'датчик': ['датчик', 'сповіщувач'], 'извещатель': ['сповіщувач', 'датчик'], 'сповіщувач': ['сповіщувач', 'датчик'], 'хаб': ['hub', 'хаб'], 'сирена': ['сирена', 'homesiren', 'streetsiren'],
    'коммутатор': ['комутатор'], 'свитч': ['комутатор'], 'світч': ['комутатор'], 'switch': ['комутатор', 'switch'], 'роутер': ['маршрутизатор', 'роутер'], 'маршрутизатор': ['маршрутизатор'],
    'витая': ['вита'], 'витуха': ['вита'], 'патчкорд': ['патч-корд'], 'патч': ['патч-корд'], 'питания': ['живлення'], 'бп': ['блок живлення'],
    'жесткий': ['жорсткий', 'hdd'], 'диск': ['диск', 'hdd'], 'hdd': ['жорсткий', 'hdd'], 'флешка': ['microsd', 'карта'],
    'наружная': ['вуличне', 'вулична'], 'уличная': ['вуличне', 'вулична'], 'вулична': ['вуличне', 'вулична'], 'внутренняя': ['внутрішнє', 'внутрішня'], 'внутрішня': ['внутрішнє', 'внутрішня'], 'купольная': ['купольна'], 'цилиндрическая': ['циліндрична'], 'поворотная': ['поворотна', 'ptz'],
    'солнечная': ['сонячна'], 'старлинк': ['starlink'], 'старлінк': ['starlink'],
    'хиквижн': ['hikvision'], 'хіквіжн': ['hikvision'], 'хиквижен': ['hikvision'], 'дахуа': ['dahua'], 'твт': ['tvt'], 'имоу': ['imou'], 'імоу': ['imou'], 'эзвиз': ['ezviz'], 'езвіз': ['ezviz'], 'аякс': ['ajax'],
    'экофлоу': ['ecoflow'], 'екофлоу': ['ecoflow'], 'джекери': ['jackery'], 'джекері': ['jackery'], 'деє': ['deye'], 'дее': ['deye'], 'крафт': ['kraft'], 'тринікс': ['trinix'], 'триникс': ['trinix'], 'слинекс': ['slinex'], 'слінекс': ['slinex'], 'укітел': ['oukitel'], 'оукитель': ['oukitel'], 'оупес': ['oupes'], 'чоетек': ['choetech'], 'хуавей': ['huawei'], 'тплинк': ['tp-link'], 'кади': ['cudy'], 'кюді': ['cudy'], 'мікротік': ['mikrotik'], 'микротик': ['mikrotik']
  };
  // розмовні назви, русизми, транслітерація (10.11.2026, після «свіч» від власника)
  var SYN2 = {
    'свич': ['комутатор'], 'свіч': ['комутатор'], 'свитчер': ['комутатор'], 'світчер': ['комутатор'], 'коммутатор': ['комутатор'], 'хаб-комутатор': ['комутатор'],
    'раутер': ['маршрутизатор'], 'рутер': ['маршрутизатор'], 'роутор': ['маршрутизатор'], 'router': ['маршрутизатор'], 'меш': ['mesh'], 'мэш': ['mesh'], 'доступа': ['доступу'], 'точка': ['точка'],
    'бесперебойник': ['дбж', 'безперебійного'], 'безперебойник': ['дбж', 'безперебійного'], 'бесперебійник': ['дбж', 'безперебійного'], 'дбж': ['дбж', 'безперебійного'], 'юпс': ['дбж', 'ups'],
    'аккум': ['акумулятор'], 'акум': ['акумулятор'], 'батарея': ['акумулятор', 'батарея'], 'литий': ['lifepo4', 'li-ion'], 'літій': ['lifepo4', 'li-ion'], 'лифепо': ['lifepo4'], 'гелевый': ['gel'], 'гелевий': ['gel'],
    'видеонаблюдение': ['відеокамера', 'відеоспостереження'], 'видеонаблюдения': ['відеокамера', 'відеоспостереження'], 'відеонагляд': ['відеокамера', 'відеоспостереження'], 'відеоспостереження': ['відеокамера', 'відеоспостереження'], 'наблюдения': ['відеокамера'], 'камеры': ['відеокамера', 'камера'],
    'рег': ['відеореєстратор'], 'нвр': ['відеореєстратор', 'nvr'], 'двр': ['відеореєстратор', 'dvr'], 'хвр': ['гібридний', 'xvr'], 'регистратора': ['відеореєстратор'],
    'видеозвонок': ['відеодзвінок'], 'відеодзвінок': ['відеодзвінок'], 'звонок': ['відеодзвінок', 'дзвінок'], 'вызывная': ['відеопанель'], 'вызова': ['відеопанель', 'виклику'], 'вызывашка': ['відеопанель'], 'викликна': ['відеопанель'], 'виклику': ['відеопанель', 'виклику'],
    'электрозамок': ['електромагнітний', 'електромеханічний', 'електрозащіпка'], 'електрозамок': ['електромагнітний', 'електромеханічний', 'електрозащіпка'], 'магнитный': ['електромагнітний'], 'магнітний': ['електромагнітний'], 'электромагнитный': ['електромагнітний'], 'электромеханический': ['електромеханічний'], 'защелка': ['електрозащіпка'], 'защіпка': ['електрозащіпка'], 'шпингалет': ['електрозащіпка'],
    'выхода': ['виходу'], 'доводчик': ['доводчик'], 'считыватель': ['зчитувач'], 'рідер': ['зчитувач'], 'ридер': ['зчитувач'], 'reader': ['зчитувач'], 'брелок': ['брелок', 'ключ'], 'таблетка': ['ключ', 'touch'], 'ключи': ['ключ'], 'карточка': ['картка', 'ключ'], 'метка': ['ключ', 'брелок'], 'турникет': ['турнікет'], 'скуд': ['контролер', 'зчитувач'],
    'движения': ['руху'], 'двери': ['відкриття', 'дверей'], 'открытия': ['відкриття'], 'геркон': ['відкриття'], 'дыма': ['диму'], 'дым': ['диму'], 'протечки': ['протікання', 'leaksprotect'], 'потопа': ['протікання', 'leaksprotect'], 'стекла': ['скла', 'glassprotect'], 'разбития': ['розбиття', 'glassprotect'],
    'ревун': ['сирена'], 'централь': ['hub', 'централь'], 'центральная': ['hub', 'централь'], 'охранка': ['сигналізація', 'ajax'], 'охранная': ['охоронна', 'сигналізація'], 'клавиатура': ['клавіатура', 'keypad'], 'кейпад': ['keypad'], 'пожарная': ['пожежна', 'fireprotect'],
    'гибридный': ['гібридний'], 'автономный': ['автономний'], 'сетевой': ['мережевий'], 'солнечные': ['сонячна'], 'солнечная': ['сонячна'], 'сонячні': ['сонячна'], 'батареи': ['панель', 'акумулятор'], 'электростанция': ['зарядна'], 'павер': ['зарядна', 'повербанк'], 'powerstation': ['зарядна'], 'station': ['зарядна'], 'экофлоу': ['ecoflow'],
    'витуха': ['вита'], 'витая': ['вита'], 'интернет': ['вита', 'мережевий'], 'lan': ['вита', 'мережевий'], 'утп': ['utp'], 'фтп': ['ftp'], 'патчкорд': ['патч-корд'], 'патч': ['патч-корд'], 'коннектор': ['конектор', 'rj-45'], 'джек': ['конектор', 'rj-45'], 'rj45': ['rj-45'],
    'питания': ['живлення'], 'бп': ['блок живлення'], 'адаптер': ['адаптер', 'блок живлення'], 'хард': ['жорсткий'], 'винчестер': ['жорсткий'], 'вінчестер': ['жорсткий'], 'жесткий': ['жорсткий'], 'накопитель': ['накопичувач', 'жорсткий'],
    'флешка': ['microsd', 'карта'], 'карта': ['карта', 'microsd'], 'памяти': ["пам'яті"], 'микросд': ['microsd'], 'мікросд': ['microsd'], 'sd': ['microsd'],
    'крепление': ['кронштейн', 'кріплення'], 'кріплення': ['кронштейн', 'кріплення'], 'шкаф': ['шафа'], 'стойка': ['стійка', 'шафа'], 'хдми': ['hdmi'], 'хдмі': ['hdmi'], 'оптика': ['оптичний'], 'оптический': ['оптичний'],
    'поворотна': ['поворотна', 'ptz'], 'птз': ['ptz'], 'шарик': ['купольна'], 'купол': ['купольна'], 'купольная': ['купольна'], 'наружная': ['вуличне', 'вулична'], 'уличная': ['вуличне', 'вулична'], 'зовнішня': ['вуличне', 'вулична'], 'микрофоном': ['мікрофоном'], 'микрофон': ['мікрофон'], 'звуком': ['мікрофоном'],
    'удлинитель': ['подовжувач'], 'пилот': ['подовжувач'], 'автомат': ['автоматичний вимикач'], 'громкоговоритель': ['гучномовець'], 'рупор': ['гучномовець'], 'динамик': ['гучномовець'], 'колонка': ['гучномовець'], 'усилитель': ['підсилювач'],
    'металлоискатель': ['металодетектор'], 'металоискатель': ['металодетектор'], 'огнетушитель': ['вогнегасник'], 'подсветка': ['прожектор'], 'прожектор': ['прожектор'], 'стабилизатор': ['стабілізатор', 'avr'], 'монитор': ['монітор'], 'тестер': ['тестер']
  };
  // назви категорій, як їх пишуть у Google (Search Console safecity), на Rozetka / Prom / Hotline (10.11.2026)
  var SYN3 = {
    'котушка': ['305м', 'бухта', 'котушка'], 'катушка': ['305м', 'бухта', 'котушка'], 'бобіна': ['305м', 'бухта'], 'бухта': ['305м', 'бухта'], 'натяжитель': ['затискач', 'натяжний'], 'натяжной': ['натяжний', 'затискач'], 'гибкий': ['гнучкий'], 'переход': ['перехід'], 'наконечник': ['наконечник', 'клема'], 'инв': ['інвертор'], 'мережевий фільтр': ['подовжувач'], 'фільтр': ['подовжувач', 'фільтр'],
    // резервне живлення
    'бесперебойного': ['безперебійного', 'дбж'], 'бесперебойное': ['безперебійного', 'дбж'], 'безперебійне': ['безперебійного', 'дбж'], 'безперебійного': ['безперебійного', 'дбж'], 'источник': ['дбж', 'джерело'], 'джерело': ['дбж', 'джерело', 'зарядна'],
    'стабилизатор': ['стабілізатор', 'avr', 'реле'], 'стабілізатор': ['стабілізатор', 'avr', 'реле'], 'авр': ['авр'], 'ats': ['авр'], 'атс': ['авр'], 'перемикач': ['перемикач', 'авр'], 'переключатель': ['перемикач', 'авр'], 'резерва': ['резерву', 'авр'],
    'накопитель': ['накопичення', 'накопичувач', 'жорсткий'], 'накопичувач': ['накопичення', 'накопичувач'], 'енергонакопичувач': ['накопичення'], 'енерго': ['накопичення', 'енергії'], 'энергии': ['енергії', 'накопичення'], 'электроэнергии': ['накопичення'], 'електроенергії': ['накопичення'], 'ess': ['накопичення', 'ess'], 'всевоодном': ['все-в-одному'],
    'портативная': ['портативна', 'зарядна'], 'портативне': ['портативна', 'зарядна'], 'портативний': ['портативна', 'зарядна', 'повербанк'], 'генератор': ['генератор'], 'бензогенератор': ['генератор бензиновий'], 'бензиновый': ['бензиновий'], 'дизельный': ['дизельний'], 'инверторный': ['інверторний'],
    'солнечный': ['сонячна', 'сонячних'], 'солнечных': ['сонячних', 'сонячна'], 'сонячних': ['сонячних', 'сонячна'], 'фотоэлектрическая': ['сонячна'], 'контроллер': ['контролер'], 'mppt': ['mppt'], 'оптимизатор': ['оптимізатор'], 'гибридный': ['гібридний'], 'сетевой': ['мережевий'],
    'аккумуляторная': ['акумулятор'], 'акумуляторна': ['акумулятор'], 'agm': ['agm'], 'гель': ['gel'], 'свинцовый': ['agm', 'свинцево-кислотна'], 'литиевый': ['lifepo4', 'li-ion', 'літієвий'], 'літієвий': ['lifepo4', 'li-ion', 'літієвий'], 'ампер': ['ah'],
    'павербанк': ['повербанк'], 'пауербанк': ['повербанк'], 'powerbank': ['повербанк'], 'зарядка': ['зарядний', 'зарядна', 'повербанк'], 'зарядное': ['зарядний'], 'зарядний': ['зарядний'], 'батарея-павербанк': ['повербанк'], 'мобильная': ['повербанк'], 'універсальна': ['повербанк'],
    // відео
    'видеокамера': ['відеокамера'], 'камеры': ['відеокамера', 'камера'], 'відеокамери': ['відеокамера'], 'ipкамера': ['ip-відеокамера'], 'аналоговая': ['hdcvi', 'hdtvi', 'ahd'], 'аналогова': ['hdcvi', 'hdtvi', 'ahd'], 'speeddome': ['ptz'], 'скоростная': ['ptz'], 'цилиндрическая': ['циліндрична'], 'циліндрична': ['циліндрична'], 'турельная': ['турельна', 'купольна'], 'турельна': ['турельна', 'купольна'], 'муляж': ['муляж'],
    'видеорегистратор': ['відеореєстратор'], 'регистраторы': ['відеореєстратор'], 'реєстратори': ['відеореєстратор'], 'нагрудный': ['нагрудний'], 'нательный': ['нагрудний'], 'бодикамера': ['нагрудний'], 'бодікамера': ['нагрудний'],
    'комплект': ['комплект'], 'комплекты': ['комплект'], 'кит': ['комплект', 'kit'], 'набор': ['комплект'], 'набір': ['комплект'], 'монитор': ['монітор'],
    'кронштейны': ['кронштейн'], 'кронштейн': ['кронштейн'], 'кріплення': ['кронштейн', 'кріплення'], 'крепеж': ['кронштейн', 'кріплення'], 'распределительная': ['розподільна'], 'монтажная': ['монтажна', 'розподільна'], 'коробка': ['коробка'], 'бокс': ['коробка', 'бокс'],
    'ик': ['іч'], 'инфракрасный': ['іч'], 'інфрачервоний': ['іч'], 'прожектор': ['прожектор'], 'подсветки': ['прожектор'], 'приемопередатчик': ['передавач', 'приймач'], 'передатчик': ['передавач'], 'удлинитель': ['подовжувач'], 'сплиттер': ['сплітер', 'розгалужувач'], 'сплітер': ['сплітер', 'розгалужувач'], 'разветвитель': ['розгалужувач'], 'конвертер': ['конвертер'], 'преобразователь': ['конвертер', 'перетворювач'],
    // домофонія
    'домофоны': ['відеодомофон', 'домофон'], 'аудиодомофон': ['аудіодомофон'], 'трубка': ['аудіодомофон', 'трубка'], 'вызывные': ['відеопанель'], 'вызывная': ['відеопанель'], 'панель': ['відеопанель', 'панель'], 'консьерж': ['консьєржа'], 'sip': ['sip'],
    // доступ
    'контроль': ['контролер', 'доступу'], 'доступа': ['доступу'], 'скуд': ['контролер', 'зчитувач', 'доступу'], 'считыватели': ['зчитувач'], 'биометрический': ['біометричний'], 'біометричний': ['біометричний'], 'отпечатка': ['відбитків', 'біометричний'], 'відбитка': ['відбитків', 'біометричний'], 'терминал': ['термінал'],
    'ключ': ['ключ', 'ідентифікатор', 'брелок'], 'ключи': ['ключ', 'ідентифікатор'], 'тм': ['touch', 'memory'], 'тач': ['touch'], 'мемори': ['memory'], 'touchmemory': ['touch', 'memory'], 'идентификатор': ['ідентифікатор'], 'карта': ['карта', 'картка', 'microsd'], 'карточки': ['картка', 'карта'], 'mifare': ['mifare'], 'em-marine': ['em-marine'], 'емарин': ['em-marine'],
    'замок': ['замок'], 'замки': ['замок'], 'смартзамок': ['біометричний', 'замок'], 'умный': ['розумний', 'smart'], 'электромеханический': ['електромеханічний'], 'електромеханічний': ['електромеханічний'], 'засов': ['замок'], 'кодовый': ['кодовий'], 'кодова': ['кодова', 'кодовий'], 'клавиатура': ['клавіатура'], 'клавіатура': ['клавіатура'],
    'доводчик': ['доводчик'], 'дотягувач': ['доводчик'], 'дотягувачі': ['доводчик'], 'дотягиватель': ['доводчик'], 'турникет': ['турнікет'], 'трипод': ['трипод'], 'калитка': ['хвіртка', 'турнікет'], 'калітка': ['хвіртка', 'турнікет'], 'хвіртка': ['хвіртка', 'турнікет'], 'шлагбаум': ['шлагбаум'], 'металлодетектор': ['металодетектор'], 'металошукач': ['металодетектор'], 'рамка': ['металодетектор', 'рамка'], 'арочный': ['арочний'],
    // сигналізація
    'сигнализации': ['сигналізація', 'сигналізації', 'сигнальний'], 'сигналізації': ['сигналізація', 'сигналізації', 'сигнальний'], 'охранной': ['охоронна', 'охоронної'], 'охоронна': ['охоронна', 'охоронної'], 'охоронної': ['охоронна', 'охоронної', 'сигнальний'], 'охоронної,': ['охоронна'], 'gsm': ['gsm', '2g'], 'беспроводная': ['бездротовий', 'бездротова'], 'бездротова': ['бездротовий', 'бездротова'], 'беспроводной': ['бездротовий'],
    'извещатель': ['сповіщувач', 'датчик'], 'извещатели': ['сповіщувач', 'датчик'], 'сповіщувачі': ['сповіщувач', 'датчик'], 'датчики': ['датчик', 'сповіщувач'], 'пожарный': ['пожежний'], 'пожежний': ['пожежний'], 'дымовой': ['диму'], 'газа': ['газу'], 'утечки': ['витоку', 'протікання'], 'витоку': ['витоку', 'протікання'], 'вибрации': ['вібрації'], 'барьер': ['бар\'єр'], 'бар\'єр': ['бар\'єр'],
    'тревожная': ['тривожна'], 'тревожные': ['тривожна'], 'тривожні': ['тривожна'], 'паника': ['тривожна'], 'оповещатель': ['оповіщувач'], 'оповіщувач': ['оповіщувач', 'сирена'], 'светозвуковой': ['світлозвуковий', 'світлозвукова'], 'світлозвуковий': ['світлозвуковий', 'світлозвукова'], 'табло': ['покажчик', 'табло'], 'выход': ['покажчик', 'виходу'],
    'огнетушитель': ['вогнегасник'], 'вогнегасник': ['вогнегасник'], 'спринклер': ['спринклер'], 'сплінкерна': ['спринклер'], 'спринклерна': ['спринклер'], 'пожаротушение': ['пожежогасіння'], 'шланг': ['шланг'],
    // мережа
    'коммутаторы': ['комутатор'], 'свичи': ['комутатор'], 'світчі': ['комутатор'], 'управляемый': ['керований'], 'неуправляемый': ['некерований'], 'роутеры': ['маршрутизатор'], 'wifi-роутер': ['маршрутизатор'], 'вайфай': ['wi-fi'], 'mesh-система': ['mesh'], 'точка': ['точка'], 'репитер': ['ретранслятор'], 'ретранслятор': ['ретранслятор'], 'усилитель': ['підсилювач', 'ретранслятор'],
    'медиаконвертер': ['медіаконвертер'], 'sfp': ['sfp'], 'оптоволокно': ['оптичний'], 'onu': ['onu', 'оптичний'], 'poe-инжектор': ['poe'], 'инжектор': ['poe', 'інжектор'], 'удлинитель-poe': ['poe-подовжувач'],
    'кабель': ['кабель'], 'провод': ['кабель'], 'дріт': ['кабель'], 'мережевий': ['мережевий'], 'utp': ['utp'], 'ftp': ['ftp'], 'кат5': ['cat5e', 'cat.5'], 'кат6': ['cat6', 'cat.6'], 'cat5': ['cat5e', 'cat.5'], 'cat6': ['cat6', 'cat.6'], 'сигнальный': ['сигнальний'], 'охранный': ['сигнальний', 'охоронної'], 'огнестойкий': ['вогнестійкий'], 'вогнетривкий': ['вогнестійкий'], 'силовой': ['силовий'], 'коаксиальный': ['коаксіальний'], 'коаксіал': ['коаксіальний'], 'rg59': ['rg-59'],
    'шкаф': ['шафа'], 'шкафы': ['шафа'], 'телекоммуникационный': ['комутаційна'], 'серверный': ['комутаційна', 'шафа'], 'серверна': ['комутаційна', 'шафа'], 'ящик': ['ящик', 'шафа'], 'антивандальный': ['антивандальний'], 'щиток': ['щиток', 'електрощиток'], 'щит': ['щиток', 'шафа'],
    'гофра': ['гнучкий перехід'], 'кабельканал': ['кабель-канал'],
    // електрика, розумний дім, звук
    'автоматы': ['автоматичний вимикач'], 'автоматический': ['автоматичний'], 'выключатель': ['вимикач'], 'двухполюсный': ['2p', 'двополюсний'], 'двополюсний': ['2p', 'двополюсний'], 'однополюсный': ['1p'], 'узо': ['пзв', 'диференційний'], 'диф': ['диференційний'], 'дифавтомат': ['диференційний'],
    'реле': ['реле'], 'напряжения': ['напруги'], 'напруги': ['напруги'], 'розетка': ['розетка'], 'розумна': ['розумна', 'розумний', 'smart'], 'розумний': ['розумний', 'розумна', 'smart'], 'смарт': ['smart', 'розумний'], 'tuya': ['tuya'], 'выключатели': ['вимикач'],
    'громкоговорители': ['гучномовець'], 'гучномовці': ['гучномовець'], 'колонки': ['гучномовець', 'акустична'], 'акустика': ['акустична'], 'микшер': ['мікшер'], 'оповещение': ['оповіщення'], 'мікрофони': ['мікрофон'],
    'старлинк': ['starlink'], 'старлінк': ['starlink'], 'starlink': ['starlink'], 'мини': ['mini'], 'міні': ['mini'], 'тарелка': ['starlink'], 'кейс': ['кейс', 'чохол', 'сумка'], 'чехол': ['чохол', 'кейс'], 'чохол': ['чохол', 'кейс'],
    'жесткие': ['жорсткий'], 'жорсткі': ['жорсткий'], 'терабайт': ['tb'], 'гигабайт': ['gb']
  };
  // з реальних запитів: пошук на сайті (GA4 sc_search) і Google (Search Console), 10.11.2026
  var SYN4 = {
    'battery': ['акумулятор'], 'batteries': ['акумулятор'], 'batteria': ['акумулятор'], 'lithium': ['lifepo4', 'li-ion', 'літієвий'], 'iron': ['lifepo4'], 'lifepo': ['lifepo4'],
    'inverter': ['інвертор'], 'cable': ['кабель'], 'monitor': ['монітор'], 'monitors': ['монітор'], 'мониторы': ['монітор'], 'siren': ['сирена'], 'card': ['карта'], 'micro': ['microsd', 'microsdxc'], 'sdxc': ['microsdxc'], 'microsdxc': ['microsdxc'],
    'lock': ['замок'], 'charger': ['зарядний'], 'bracket': ['кронштейн'], 'camera': ['відеокамера'], 'recorder': ['відеореєстратор'], 'intercom': ['домофон'], 'doorbell': ['відеодзвінок'], 'sensor': ['датчик'], 'detector': ['датчик'],
    'solar': ['сонячна'], 'panel': ['панель'], 'station': ['зарядна'], 'adapter': ['адаптер', 'перехідник'], 'mount': ['кріплення', 'кронштейн'], 'case': ['кейс', 'чохол'], 'speaker': ['гучномовець'],
    'розподільчий': ['розподільна'], 'розподільча': ['розподільна'], 'розподільчу': ['розподільна'], 'розподільчі': ['розподільна'], 'распределительный': ['розподільна'], 'распределительная': ['розподільна'],
    'коммутационная': ['комутаційна', 'монтажна', 'розподільна'], 'коммутационный': ['комутаційна', 'монтажна'], 'комутаційний': ['комутаційна', 'монтажна'], 'комутаційна': ['комутаційна', 'монтажна'],
    'екранований': ['ftp', 'екранований'], 'экранированный': ['ftp', 'екранований'], 'перекидний': ['перемикач', 'авр'], 'перекидной': ['перемикач', 'авр'], 'виносний': ['кронштейн'], 'выносной': ['кронштейн'],
    'відкриття': ['відчинення', 'відкриття'], 'открытия': ['відчинення', 'відкриття'], 'відчинення': ['відчинення', 'відкриття'], 'двері': ['відчинення', 'дверей'], 'дверей': ['відчинення', 'дверей'],
    'виклику': ['відеопанель', 'виклична', 'виклику'], 'вызова': ['відеопанель', 'виклична', 'виклику'], 'вызывная': ['відеопанель', 'виклична'], 'викликна': ['відеопанель', 'виклична'], 'виклична': ['виклична', 'відеопанель'],
    'куди': ['cudy'], 'кади': ['cudy'], 'кюди': ['cudy'], 'кудi': ['cudy'],
    'прикурювач': ['прикурювач'], 'прикуриватель': ['прикурювач'], 'прикулювач': ['прикурювач'], 'триподы': ['трипод'], 'турникеты': ['турнікет'], 'напряжения': ['напруги'], 'защиты': ['захисту'], 'нагрудный': ['нагрудний']
  };
  Object.keys(SYN4).forEach(function (k) { SYN3[k] = SYN3[k] ? SYN3[k].concat(SYN4[k]) : SYN4[k]; });
  Object.keys(SYN3).forEach(function (k) { SYN2[k] = SYN2[k] ? SYN2[k].concat(SYN3[k]) : SYN3[k]; });
  Object.keys(SYN2).forEach(function (k) { SYN[k] = SYN[k] ? SYN[k].concat(SYN2[k].filter(function (x) { return SYN[k].indexOf(x) < 0; })) : SYN2[k]; });
  var SYN_KEYS = Object.keys(SYN).filter(function (k) { return k.length >= 4 && /^[a-zа-яіїєґ']+$/.test(k); });
  var STOP = { 'для': 1, 'і': 1, 'и': 1, 'та': 1, 'з': 1, 'с': 1, 'на': 1, 'в': 1, 'у': 1, 'до': 1, 'по': 1, 'от': 1, 'від': 1, 'купити': 1, 'купить': 1, 'ціна': 1, 'цена': 1, 'price': 1, 'buy': 1, 'ціни': 1, 'цены': 1, 'недорого': 1 };
  var ENDINGS = ['ями', 'ами', 'ові', 'ого', 'ому', 'ими', 'ій', 'ий', 'их', 'ів', 'ах', 'ям', 'ам', 'ою', 'ею', 'ой', 'ая', 'яя', 'ое', 'ые', 'ие', 'а', 'я', 'и', 'і', 'у', 'ю', 'е', 'о', 'ь', 'ы'];
  var L2C = { q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з', '[': 'х', ']': 'ї', a: 'ф', s: 'і', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д', ';': 'ж', "'": 'є', z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю' };
  var C2L = {};
  Object.keys(L2C).forEach(function (k) { C2L[L2C[k]] = k; });
  C2L['ы'] = 's'; C2L['э'] = "'"; C2L['ъ'] = ']';
  var TR_L2C = [['shch', 'щ'], ['sch', 'щ'], ['zh', 'ж'], ['kh', 'х'], ['ts', 'ц'], ['ch', 'ч'], ['sh', 'ш'], ['yu', 'ю'], ['ya', 'я'], ['ye', 'є'], ['yi', 'ї'], ['ph', 'ф'], ['ck', 'к'], ['ee', 'і'], ['oo', 'у'],
    ['a', 'а'], ['b', 'б'], ['c', 'к'], ['d', 'д'], ['e', 'е'], ['f', 'ф'], ['g', 'г'], ['h', 'х'], ['i', 'і'], ['j', 'дж'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['q', 'к'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'], ['v', 'в'], ['w', 'в'], ['x', 'кс'], ['y', 'й'], ['z', 'з']];
  var TR_C2L = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ye', 'ж': 'zh', 'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'yi', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ь': '', 'ю': 'yu', 'я': 'ya', 'ы': 'y', 'э': 'e', 'ё': 'e', 'ъ': '' };

  function lower(s) { return String(s || '').toLowerCase().replace(/[’`ʼ]/g, "'").replace(/ё/g, 'е'); }
  function stem(w) {
    if (w.length < 5 || /[\da-z]/.test(w)) return w;
    for (var i = 0; i < ENDINGS.length; i++) { var e = ENDINGS[i]; if (w.length - e.length >= 4 && w.slice(-e.length) === e) return w.slice(0, -e.length); }
    return w;
  }
  function compact(s) { return lower(s).replace(/[^a-z0-9а-яіїєґ]/g, ''); }
  function lat2cyr(w) {
    var out = '', i = 0;
    while (i < w.length) {
      var hit = null;
      for (var k = 0; k < TR_L2C.length; k++) if (w.substr(i, TR_L2C[k][0].length) === TR_L2C[k][0]) { hit = TR_L2C[k]; break; }
      if (hit) { out += hit[1]; i += hit[0].length; } else { out += w[i]; i++; }
    }
    return out;
  }
  function cyr2lat(w) { return w.split('').map(function (c) { return TR_C2L[c] !== undefined ? TR_C2L[c] : c; }).join(''); }
  function layoutFix(w) {
    if (/^[a-z;'\[\],.]+$/.test(w)) return w.split('').map(function (c) { return L2C[c] || c; }).join('');
    if (/^[а-яіїєґыэъ]+$/.test(w)) return w.split('').map(function (c) { return C2L[c] || c; }).join('');
    return null;
  }
  function normText(s) {
    s = ' ' + lower(s) + ' ';
    s = s.replace(/(\d),(\d)/g, '$1.$2').replace(/(?<![0-9a-zа-яіїєґ.])(\d{1,3}) (\d{3})(?!\d)/g, '$1$2');   // «30 000» → 30000, але не «lifepo4 200ah»
    for (var i = 0; i < PHRASES.length; i++) s = s.replace(PHRASES[i][0], PHRASES[i][1]);
    return s.replace(/[^a-z0-9а-яіїєґ.\-+/' ]/g, ' ').split(/[\s/]+/)
      .map(function (t) { return t.replace(/^[.\-+']+|[.\-+']+$/g, ''); }).filter(Boolean);
  }
  // toks — уже нормалізовані слова (з індексу: wn/wo/wx, їх готує tools/build_search_index.py) або текст
  function tokSet(toks, set) {
    (typeof toks === 'string' ? normText(toks) : toks).forEach(function (t) {
      set[t] = 1; set[stem(t)] = 1;
      t.split(/[-+]/).forEach(function (p) { if (p) set[p] = 1; });   // «em-marine+mifare» → em, marine, mifare
      var c = compact(t); if (c.length > 2) set[c] = 1;
    });
    return set;
  }

  // Збирає індекс частинами по ~30 мс, віддаючи браузеру керування між ними, — сторінка не «замерзає» (на телефоні збірка ≈1 с)
  // наступна порція — через MessageChannel (setTimeout у фонових вкладках гальмується до 1 с)
  var later = (function () {
    if (!window.MessageChannel) return function (fn) { setTimeout(fn, 0); };
    var ch = new MessageChannel(), q = [];
    ch.port1.onmessage = function () { var f = q.shift(); if (f) f(); };
    return function (fn) { q.push(fn); ch.port2.postMessage(0); };
  })();
  function buildIndex(data, done) {
    var f = data.f, vocab = {}, rows = data.items, docs = [], i = 0;
    function one(row) {
      var it = {};
      f.forEach(function (k, j) { it[k] = row[j]; });
      var pre = typeof it.wn === 'string';
      var nameToks = pre ? (it.wn ? it.wn.split(' ') : []) : normText(it.n), codes = [];
      var main = tokSet(nameToks.concat(pre ? (it.wo ? it.wo.split(' ') : []) : normText((it.b || '') + ' ' + (it.k || ''))), {});
      var extra = tokSet(pre ? (it.wx ? it.wx.split(' ') : []) : (it.x || ''), {});
      nameToks.forEach(function (t, j) {
        if (/[a-z]/.test(t) && /\d/.test(t)) codes.push(compact(t));
        if (j + 1 < nameToks.length) { var pr = compact(t + nameToks[j + 1]); if (/\d/.test(pr) && /[a-z]/.test(pr)) codes.push(pr); }
      });
      var sku = [];
      if (it.c) String(it.c).split(' ').forEach(function (c) { if (c) sku.push(compact(c)); });   // артикул на сайті + внутрішній
      Object.keys(main).forEach(function (t) { vocab[t] = 1; });
      var first = [];
      // слово-тип — серед перших слів назви до «для / з / під» («ДБЖ для роутера» — це ДБЖ, не роутер)
      for (var j = 0; j < Math.min(3, nameToks.length); j++) {
        var t = nameToks[j];
        if (/^(для|з|із|під|на|та|і)$/.test(t)) break;
        if (j === 0) first.push(stem(t));
        if (/[а-яіїєґ]{4}/.test(t)) t.split('-').forEach(function (p) { if (p.length > 3) first.push(stem(p)); });
      }
      return { it: it, toks: Object.keys(main), xt: Object.keys(extra), first: first, len: it.n.length, codes: codes, sku: sku, cat: lower(it.k) };
    }
    (function chunk() {
      var t0 = Date.now();
      while (i < rows.length && Date.now() - t0 < 30) docs.push(one(rows[i++]));
      if (i < rows.length) return later(scSafe(37, chunk));
      var byUrl = {};
      docs.forEach(function (d) { byUrl[d.it.u] = d.it; });
      var vocabList = Object.keys(vocab).sort();
      done({ docs: docs, vocab: vocab, vocabList: vocabList, words: vocabList.filter(function (v) { return v.length >= 3 && !/\d/.test(v); }), fuzzy: {}, byUrl: byUrl });
    })();
  }

  function dl(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) d[i] = [i];
    for (j = 0; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) {
      var best = 99;
      for (j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        if (d[i][j] < best) best = d[i][j];
      }
      if (best > max) return max + 1;
    }
    return d[a.length][b.length];
  }

  function alternatives(q, idx) {
    var alts = [], seen = {};
    function add(t, w) { if (t && !seen[t]) { seen[t] = 1; alts.push({ t: t, w: w }); } }
    add(q, 1); add(stem(q), 0.95);
    (SYN[q] || SYN[stem(q)] || []).forEach(function (s) { normText(s).forEach(function (x) { add(x, 0.9); add(stem(x), 0.85); }); });
    if (/^[a-z]+$/.test(q) && q.length > 2) add(lat2cyr(q), 0.8);
    // російське написання → українське: инвертор → інвертор, видеокамера → відеокамера
    if (/[иыэъ]/.test(q)) { var ua = q.replace(/и/g, 'і').replace(/ы/g, 'и').replace(/э/g, 'е').replace(/ъ/g, ''); add(ua, 0.85); add(stem(ua), 0.8); }
    if (/^[а-яіїєґ]+$/.test(q) && q.length > 2) { var l = cyr2lat(q); add(l, 0.8); add(l.replace(/y/g, 'i'), 0.75); add(l.replace(/h/g, 'g'), 0.7); }
    if ((/[a-z]/.test(q) && /\d/.test(q)) || (q.length >= 5 && /\d/.test(q))) add(compact(q), 1);
    var tail = compact(q).match(/^[a-z]{2,5}(\d[a-z0-9]{2,})$/);   // «wgp103c» → 103c (бренд злитий з моделлю)
    if (tail) add(tail[1], 0.8);
    var lf = layoutFix(q);
    if (lf && lf.length > 2 && !idx.vocab[q]) {
      var hit = idx.vocab[lf] || hasPrefix(idx, lf);
      if (hit) { add(lf, 0.85); (SYN[lf] || []).forEach(function (s) { add(s, 0.8); }); alts.fix = lf; }
    }
    // опечатки (10.11.2026): жоден варіант не знайшовся в словнику — шукаємо найближчі слова словника
    // і ключі синонімів («камрера» → камера → відеокамера), а не порівнюємо з кожним товаром
    if (q.length >= 4 && !/\d/.test(q) && !alts.some(function (x) { return idx.vocab[x.t] || hasPrefix(idx, x.t); })) {
      var fw = fuzzyWords(idx, q);
      // показуємо покупцеві слово, як він його мав написати: ключ синонімів («камера»), інакше слово з назв
      if (fw.length) alts.fix = (fw.filter(function (f) { return SYN[f.t]; })[0] || fw[0]).t;
      fw.forEach(function (f) {
        var w = f.d === 1 ? 0.62 : 0.5;
        add(f.t, w); add(stem(f.t), w - 0.02);
        (SYN[f.t] || SYN[stem(f.t)] || []).forEach(function (s) { normText(s).forEach(function (x) { add(x, w - 0.04); add(stem(x), w - 0.06); }); });
      });
    }
    return alts;
  }
  // чи є в словнику слово, що починається з p (словник відсортований — двійковий пошук)
  function hasPrefix(idx, p) {
    var a = idx.vocabList, lo = 0, hi = a.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (a[mid] < p) lo = mid + 1; else hi = mid; }
    return lo < a.length && a[lo].indexOf(p) === 0;
  }
  // найближчі за написанням слова: відстань ≤ 1 (≤ 2 для слів від 8 літер); лише найкраща відстань
  function fuzzyWords(idx, q) {
    if (idx.fuzzy[q]) return idx.fuzzy[q];
    var max = q.length >= 8 ? 2 : 1, found = [], best = max + 1;
    function check(t) {
      if (t === q) return;
      var d = dl(q, t, max);
      // недописане слово з опечаткою: «акумулят» ~ «акумулятор» — порівнюємо з початком довшого слова
      if (d > max && t.length > q.length + 1) d = dl(q, t.slice(0, q.length), max) + 0.5;
      if (d <= max + 0.5 && d <= best) { if (d < best) { best = d; found = []; } found.push({ t: t, d: Math.ceil(d) }); }
    }
    idx.words.forEach(check);
    SYN_KEYS.forEach(function (k) { if (!idx.vocab[k]) check(k); });
    return (idx.fuzzy[q] = found.slice(0, 6));
  }

  function matchIn(toks, t) {
    var best = 0;
    for (var k = 0; k < toks.length; k++) {
      var d = toks[k];
      if (d === t) return 1;
      // початок слова; число — лише ціле: «450» ≠ «4500wp», але «450» = «450w»
      if ((t.length >= 2 || /\d/.test(t)) && d.indexOf(t) === 0 && !(/\d$/.test(t) && /\d/.test(d.charAt(t.length)))) best = /\d/.test(t) ? 0.9 : 0.8;
    }
    return best;
  }

  function tokenScore(alts, doc, q) {
    var best = 0;
    for (var a = 0; a < alts.length; a++) {
      var t = alts[a].t, w = alts[a].w;
      best = Math.max(best, w * matchIn(doc.toks, t), w * 0.45 * matchIn(doc.xt, t));
      if ((t.length >= 4 && /\d/.test(t)) || /^\d{3}$/.test(t)) {
        best = Math.max(best, w * codeMatch(doc.codes, t, false), w * codeMatch(doc.sku, t, true));
      }
      if (best >= w) return best;
    }
    return best;   // опечатки тепер виправляються в alternatives() через словник
  }
  // частина коду моделі / артикулу. Лише цифри («1000», «103») — не всередині іншого числа:
  // «ups 1000» не повинен знаходити артикул 41-00040 (4100040), а «krf1000va» — так
  function codeMatch(codes, t, isSku) {
    var digits = /^\d+$/.test(t), best = 0;
    for (var c = 0; c < codes.length; c++) {
      var s = codes[c], p = s.indexOf(t);
      while (p >= 0) {
        var ok = !digits || ((p === 0 || !/\d/.test(s[p - 1])) && (p + t.length === s.length || !/\d/.test(s[p + t.length])));
        if (digits && isSku && p === 0 && t.length >= 5) ok = true;                                           // артикул, що набирається: 42001 → 42-00163
        if (digits && isSku && p + t.length === s.length && (t[0] === '0' || t.length >= 5)) ok = true;   // хвіст артикулу: 00163 → 42-00163
        if (ok) { best = Math.max(best, p === 0 ? 1 : 0.85); break; }
        p = s.indexOf(t, p + 1);
      }
    }
    return best;
  }

  // запити з реального пошуку, які означають інший товар: «акб для роутера» — це ДБЖ для роутера
  var QUERY_FIX = [
    [/(?:^|\s)(?:акб|акум\S*|аккум\S*|батаре\S*|живлення|питание)\s+(?:для|на)\s+(роутер\S*|маршрутизатор\S*|модем\S*|onu|ону|термінал\S*)/i, ' дбж для $1'],
    // «2в1», «3 in 1» — як у назвах: «2 в 1»
    [/(^|[^0-9])([2-9])\s*(?:в|in|v)\s*1(?![0-9])/gi, '$1$2 в 1']
  ];
  /* ---------- пошук за числовими характеристиками (10.11.2026) ----------
   * «доводчик на двері 30 кг», «ДБЖ для котла 150 Вт», «реєстратор на 6 камер», «камера 50 м», «кабель hdmi 15 м»…
   * Число з одиницею — умова, а не слово з назви. Шукаємо без нього, а серед знайденого лишаємо товари,
   * у яких характеристика підходить. Дані: поля r (діапазон ваги дверей) і q («pw:600,ch:8») індексу — з фіду
   * постачальника; якщо там порожньо — з назви (600W, 100Ah, 8-канальний, 15м). Якщо серед знайденого такої
   * характеристики майже ні в кого немає («жорсткий диск 8 тб», «замок 280 кг» без даних) — звичайний пошук. */
  // одиниця з запиту → характеристики, які можуть під неї підходити (береться та, що є в більшості знайденого);
  // mode: min — «від N» (найближче більше — першим), eq — рівно N, range — N у діапазоні товару
  var QTY = {
    w: { keys: ['pw'], mul: 1 }, kw: { keys: ['pw'], mul: 1000 }, va: { keys: ['va', 'pw'], mul: 1 }, kva: { keys: ['va', 'pw'], mul: 1000 },
    wh: { keys: ['wh'], mul: 1 }, kwh: { keys: ['wh'], mul: 1000 }, ah: { keys: ['ah'], mul: 1 }, mah: { keys: ['mah'], mul: 1 },
    a: { keys: ['ai', 'al', 'ao'], mul: 1 }, канал: { keys: ['ch'], mul: 1 }, tb: { keys: ['hdd'], mul: 1 },
    м: { keys: ['ir', 'boom', 'len'], mul: 1 }, kg: { keys: ['r', 'hold', 'kg'], mul: 1 }, ab: { keys: ['ab'], mul: 1 }
  };
  var QTY_EQ = { ai: 1 };                                   // номінал автомата: 25 А — саме 25 А
  var QTY_TXT = {
    pw: 'потужність від {} Вт', va: 'потужність від {} ВА', wh: 'ємність від {} Вт·год', ah: 'ємність від {} Ah', mah: 'ємність від {} mAh',
    ai: 'номінальний струм {} А', al: 'струм навантаження від {} А', ao: 'вихідний струм від {} А', ch: 'від {} каналів',
    hdd: 'підтримка дисків від {} ТБ', ir: 'ІЧ-підсвічування від {} м', boom: 'стріла від {} м', len: 'довжина від {} м',
    r: 'для дверей вагою {} кг', hold: 'сила утримання від {} кг', kg: 'навантаження від {} кг', ab: 'від {} абонентів'
  };
  // значення характеристики товару: з фіду постачальника, інакше з назви
  function qtyOf(it, key) {
    if (!it._q) {
      var q = {};
      String(it.q || '').split(',').forEach(function (kv) { var p = kv.split(':'); if (p[1]) q[p[0]] = parseFloat(p[1]); });
      String(it.wn || '').split(' ').forEach(function (t) {
        var m = t.match(/^(\d+(?:\.\d+)?)(kw|w|wh|kwh|ah|mah|канал|м)$/);
        if (!m) return;
        var v = parseFloat(m[1]), u = m[2];
        if (u === 'kw' && !q.pw) q.pw = v * 1000;
        else if (u === 'w' && !q.pw) q.pw = v;
        else if ((u === 'wh' || u === 'kwh') && !q.wh) q.wh = v * (u === 'kwh' ? 1000 : 1);
        else if (u === 'ah' && !q.ah) q.ah = v;
        else if (u === 'mah' && !q.mah) q.mah = v;
        else if (u === 'канал') q.ch = v;                   // «16-канальний» у назві точніше за «Кількість каналів IP»
        else if (u === 'м' && !q.len) q.len = v;
      });
      if (it.r) { var rr = String(it.r).split('-'); q.r = [parseFloat(rr[0]), parseFloat(rr[1])]; }
      it._q = q;
    }
    return it._q[key];
  }
  // умови з запиту: [{ key: одиниця з QTY, v: число, raw: слова запиту }]
  function parseQty(query) {
    var toks = normText(query), conds = [], rest = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], m = t.match(/^(\d+(?:\.\d+)?)(kw|w|va|kva|wh|kwh|ah|mah|a|канал|tb|м|kg)$/), nx = toks[i + 1] || '';
      if (m) { conds.push({ key: m[2], v: parseFloat(m[1]), raw: t }); continue; }
      // «на 6 камер», «на 4 квартири / абоненти»
      if (/^\d{1,3}$/.test(t) && /^(?:камер|кам$|відеокамер)/.test(nx)) { conds.push({ key: 'канал', v: +t, raw: t + ' ' + nx }); i++; continue; }
      if (/^\d{1,3}$/.test(t) && /^(?:квартир|абонент|кварт)/.test(nx)) { conds.push({ key: 'ab', v: +t, raw: t + ' ' + nx }); i++; continue; }
      rest.push(t);
    }
    return { conds: conds, rest: rest };
  }
  function search(idx, query) {
    query = String(query);
    QUERY_FIX.forEach(function (f) { query = query.replace(f[0], f[1]); });
    var pq = parseQty(query);
    if (!pq.conds.length || !pq.rest.length) return searchCore(idx, query);
    var base = searchCore(idx, pq.rest.join(' '));
    // для кожної умови — перша за порядком характеристика, яка є в помітної частини знайденого
    // (щонайменше 5 товарів або 30 %): «1000 ВА» — ВА, а не Вт; «15 м» у кабелів — довжина, у камер — ІЧ
    var use = [], back = [];
    pq.conds.forEach(function (c) {
      var pick = null;
      QTY[c.key].keys.some(function (k) {
        var n = 0;
        base.items.forEach(function (it) { if (qtyOf(it, k) != null) n++; });
        if (n >= 2 && (n >= 5 || n >= base.items.length * 0.3)) { pick = k; return true; }
        return false;
      });
      if (pick) use.push({ k: pick, v: c.v * QTY[c.key].mul, raw: c.raw });
      else back.push(c.raw);
    });
    if (!use.length) return searchCore(idx, query);
    if (back.length) base = searchCore(idx, pq.rest.concat(back).join(' '));
    function ok(it, u) {
      var x = qtyOf(it, u.k);
      if (x == null) return false;
      if (u.k === 'r') return u.v >= x[0] && u.v <= x[1];
      return QTY_EQ[u.k] ? Math.abs(x - u.v) < 0.01 : x >= u.v - 1e-9;
    }
    var main = use[0];
    function dist(it) { var x = qtyOf(it, main.k); return main.k === 'r' ? x[1] - x[0] : x - main.v; }
    var items = base.items.filter(function (it) { return use.every(function (u) { return ok(it, u); }); });
    // найближче до потрібного — першим, серед однакових — у наявності
    items = items.map(function (it, i) { return [it, i, dist(it)]; }).sort(function (a, b) {
      return (a[2] - b[2]) || (b[0].s - a[0].s) || (a[1] - b[1]);
    }).map(function (x) { return x[0]; });
    var note = use.map(function (u) { return QTY_TXT[u.k].replace('{}', String(+u.v.toFixed(2)).replace('.', ',')); }).join(', ');
    return { total: items.length, partial: base.partial, items: items, cats: facet(items, 'k'), brands: facet(items, 'b'), fixed: base.fixed, qnote: note };
  }
  function searchCore(idx, query) {
    var qt = [];
    normText(query).forEach(function (t) {
      if (STOP[t]) return;
      // «wgp103» → «wgp» + «103», якщо літерна частина — відоме слово (бренд, серія)
      var m = t.match(/^([a-z]{2,6})(\d[a-z0-9]*)$/);
      if (m && idx.vocab[m[1]] && !idx.vocab[t]) qt.push(m[1], m[2]);
      // слова через дефіс, яких немає в назвах: «mc4-запобіжники», «турникеты-триподы» → окремі слова
      else if (/-/.test(t) && !idx.vocab[t] && !hasPrefix(idx, t) && /[a-zа-яіїєґ]{3}/.test(t)) t.split('-').forEach(function (p) { if (p.length > 1 && !STOP[p]) qt.push(p); });
      else qt.push(t);
    });
    if (!qt.length) return { total: 0, items: [] };
    var alts = qt.map(function (q) { return alternatives(q, idx); });
    // виправлені слова (опечатка / розкладка) — для рядка «Показано для: …»
    var fixed = [];
    alts.forEach(function (al, i) { if (al.fix) fixed.push([qt[i], al.fix]); });
    // число в запиті («акб 100») — це значення з одиницею (100Ah, 100W) або окреме число; якщо такі
    // товари є, не беремо ті, де число лише всередині коду моделі («…-4-A100» у LiTime 165Ah)
    var UNITS = '(?:ah|mah|wh|kwh|w|kw|va|kva|v|a|mp|tb|gb|g|м|мм|см|канал|порт)';
    var numRe = {};
    function numHit(doc, q) {
      // одразу після літер (код моделі) — лише багатолітерні одиниці: «krf-t1000va» так, «ups103a» ні
      var re = numRe[q] || (numRe[q] = new RegExp('(?:^|[^0-9.a-zа-яіїєґ])' + q + UNITS + '(?![0-9a-zа-яіїєґ])|[a-zа-яіїєґ]' + q + '(?:ah|mah|wh|kwh|kw|va|kva|mp|tb|gb)(?![0-9a-zа-яіїєґ])'));
      for (var k = 0; k < doc.toks.length; k++) { var d = doc.toks[k]; if (d === q || re.test(d)) return true; }
      return false;
    }
    var unitOnly = qt.map(function (q) {
      return /^\d{2,4}$/.test(q) && qt.length > 1 && idx.docs.some(function (d) { return numHit(d, q); });
    });
    var wantAcc = alts.some(function (al) { return al.some(function (a) { return ACC_RE.test(a.t); }); });
    var res = [];
    idx.docs.forEach(function (doc) {
      var sum = 0, hit = 0;
      var inName = 0;                                   // слів, знайдених у назві / бренді / категорії (не лише в характеристиках)
      for (var i = 0; i < qt.length; i++) {
        if (unitOnly[i] && !numHit(doc, qt[i])) continue;
        var s = tokenScore(alts[i], doc, qt[i]); if (s) { hit++; sum += s; if (s >= 0.5) inName++; }
      }
      if (!hit) return;
      var score = sum / qt.length + (hit === qt.length ? 1 : 0);
      // слово-тип (відеокамера, комутатор…) з будь-якого місця запиту = перше слово назви
      if (alts.some(function (al) { return al.some(function (a) { return a.t.length >= 3 && doc.first.some(function (f) { return f === a.t || f.indexOf(stem(a.t)) === 0; }); }); })) score += 0.35;
      if (alts.some(function (al) { return al.some(function (a) { return a.t.length > 3 && doc.cat.indexOf(a.t) >= 0; }); })) score += 0.3;
      if (doc.it.s) score += 0.4;   // у наявності — вище за «тип у назві» (0.35)
      if (qt.length > 1 && inName === qt.length) score += 0.3;   // усі слова в назві — вище, ніж збіг лише за характеристиками
      // аксесуари (кронштейни, коробки, корпуси, кріплення) — нижче, якщо їх не шукали: «дахуа», «ajax» → спершу самі пристрої
      if (!wantAcc && ACC_RE.test(doc.cat + ' ' + doc.first.join(' '))) score -= 0.45;
      res.push({ doc: doc, score: score, hit: hit, full: hit === qt.length });
    });
    var full = res.filter(function (r) { return r.full; }), list = full;
    if (!full.length && qt.length > 1) {
      // точного збігу немає: лише товари з найбільшою кількістю збіглих слів
      // («сонячна панель 450» → сонячні панелі, а не будь-яка «панель»)
      var maxHit = 0;
      res.forEach(function (r) { if (r.hit > maxHit) maxHit = r.hit; });
      list = res.filter(function (r) { return r.hit === maxHit && r.score > 0.9; });
    }
    list.sort(function (a, b) { return b.score - a.score || a.doc.len - b.doc.len; });
    var items = list.map(function (r) { return r.doc.it; });
    return { total: items.length, partial: !full.length && items.length > 0, items: items, cats: facet(items, 'k'), brands: facet(items, 'b'), fixed: items.length ? fixed : [] };
  }
  // характеристики для фільтрів на сторінці результатів — з уже нормалізованих слів індексу (wn — назва,
  // wx — характеристики постачальника), тож індекс не росте; рахуються лише для знайдених товарів
  var ATTR_NUM = [
    { id: 'mp', label: 'Мегапікселі', re: /^(\d+(?:\.\d+)?)mp$/, fmt: function (v) { return v + ' Мп'; } },
    { id: 'ch', label: 'Канали', re: /^(\d+)канал/, fmt: function (v) { return v + ' кан.'; } },
    { id: 'pt', label: 'Порти', re: /^(\d+)порт/, fmt: function (v) { return v + ' порт.'; } },
    { id: 'ah', label: 'Ємність', re: /^(\d+(?:\.\d+)?)ah$/, fmt: function (v) { return v + ' Ah'; } },
    { id: 'mah', label: 'Ємність', re: /^(\d+)mah$/, fmt: function (v) { return v + ' mAh'; } },
    { id: 'w', label: 'Потужність', re: /^(\d+(?:\.\d+)?)(k?)w$/, val: function (m) { return String(+(parseFloat(m[1]) * (m[2] ? 1000 : 1)).toFixed(1)); },
      fmt: function (v) { return v >= 1000 ? (v / 1000) + ' кВт' : v + ' Вт'; } }
  ];
  var ATTR_FLAGS = [['poe', 'PoE'], ['wifi', 'Wi-Fi'], ['4g', '4G'], ['вуличне', 'Вулична', 'вулична'], ['внутрішнє', 'Внутрішня', 'внутрішня'],
    ['мікрофон', 'З мікрофоном', 'мікрофоном'], ['купольна', 'Купольна'], ['циліндрична', 'Циліндрична'], ['ptz', 'PTZ', 'ptz-відеокамера'],
    ['lifepo4', 'LiFePO4'], ['agm', 'AGM'], ['gel', 'GEL'], ['бездротовий', 'Бездротові', 'бездротова', 'бездротове']];
  function attrs(it) {
    if (it._a) return it._a;
    var a = { f: {} }, nt = String(it.wn || '').split(' '), xt = String(it.wx || '').split(' '), all = {};
    nt.concat(xt).forEach(function (t) { all[t] = 1; t.split('-').forEach(function (p) { all[p] = 1; }); });
    ATTR_NUM.forEach(function (g) {
      for (var i = 0; i < nt.length; i++) { var m = nt[i].match(g.re); if (m) { a[g.id] = g.val ? g.val(m) : m[1]; break; } }
    });
    ATTR_FLAGS.forEach(function (fl) { for (var i = 0; i < fl.length; i++) if (i !== 1 && all[fl[i]]) { a.f[fl[0]] = 1; break; } });
    return (it._a = a);
  }
  var ACC_RE = /аксесуар(?!и для старлінк)|задн|накладн|модул|піддаш|рамк|чохол|кронштейн|монтажн|коробк|кріплен|корпус|бокс|адаптер|козирок|тримач|smartbracket|dummybox|кліпс/;
  // категорії / бренди серед знайденого: що частіше у верхніх результатах — вище
  function facet(items, key) {
    var w = {}, n = {};
    items.forEach(function (it, i) { var v = it[key]; if (!v) return; w[v] = (w[v] || 0) + (i < 30 ? 2 : 1); n[v] = (n[v] || 0) + 1; });
    return Object.keys(w).sort(function (a, b) { return w[b] - w[a]; }).map(function (v) { return { name: v, count: n[v] }; });
  }

  /* ---------- завантаження індексу ---------- */
  var IDX = null, loading = null, waiters = [];
  function load(cb) {
    if (IDX) return cb(IDX);
    waiters.push(cb);
    if (loading) return;
    // наявність (stock.json, щогодини з фідів) — паралельно з індексом; не вдалося — лишається нічна з індексу
    var stockP = fetch(SC_SEARCH_STOCK + '?h=' + Math.floor(Date.now() / 6e5), { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })['catch'](function () { return null; });
    loading = fetch(SC_SEARCH_INDEX).then(function (r) { if (!r.ok) throw new Error('index ' + r.status); return r.json(); })
      .then(scSafe(37, function (data) {
        buildIndex(data, scSafe(37, function (idx) {
          stockP.then(scSafe(37, function (st) {
            IDX = idx;
            if (st && st['in'] && Date.now() - Date.parse(st.t) < 36 * 3600e3) {
              var inS = {};
              st['in'].forEach(function (u) { inS[u] = 1; });
              idx.docs.forEach(function (d) { d.it.s = inS[d.it.u] ? 1 : 0; });
            }
            applyLive(IDX);                                    // з карток сайту — найсвіжіше, поверх stock.json
            document.documentElement.classList.add('sc-srch');
            waiters.splice(0).forEach(function (f) { f(IDX); });
          }));
        }));
      }))['catch'](function (e) { loading = null; scErr(37, e); });
  }
  // для блоку 39 (доповнення в кошику)
  window.scSearchApi = {
    load: load,
    search: function (q) { return search(IDX, q); },
    byUrl: function (u) { return IDX && IDX.byUrl[u]; }
  };
  // для перевірки з консолі: SC_SEARCH_TEST('павербанк') → перші 10 назв
  window.SC_SEARCH_TEST = function (q, n) { return IDX ? search(IDX, q).items.slice(0, n || 10).map(function (it) { return (it.s ? '+ ' : '- ') + it.n; }) : (load(function () {}), 'індекс ще вантажиться'); };
  // r — результат search(); окремі події для «нічого не знайшли» і «лише схожі» — їх тижневий звіт
  // (apps-script/health/search-report.gs) бере з GA4 без власних вимірів
  function ga(q, r, place) {
    try {
      if (typeof window.gtag !== 'function') return;
      var p = { search_term: String(q).slice(0, 100), results: r.total, place: place };
      window.gtag('event', 'sc_search', p);
      if (!r.total) window.gtag('event', 'sc_search_zero', p);
      else if (r.partial) window.gtag('event', 'sc_search_partial', p);
      if (r.fixed && r.fixed.length) window.gtag('event', 'sc_search_fixed', p);
    } catch (x) {}
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function price(p) { return String(p).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' грн'; }
  // k — категорія, b — бренд (фільтри нашої сторінки результатів; Хорошоп їх ігнорує)
  function plural(n, f) { var a = n % 100, b = n % 10; return (a > 10 && a < 20) ? f[2] : b === 1 ? f[0] : (b >= 2 && b <= 4) ? f[1] : f[2]; }
  // «Показано для: камера» — запит з виправленими словами (опечатка / розкладка)
  function fixedText(q, r) {
    if (!r.fixed || !r.fixed.length) return '';
    var map = {};
    r.fixed.forEach(function (f) { map[f[0]] = f[1]; });
    return normText(q).map(function (t) { return map[t] || t; }).join(' ');
  }
  function resultsUrl(q, k, b, a) { return '/katalog/search/?q=' + encodeURIComponent(q) + (k ? '&k=' + encodeURIComponent(k) : '') + (b ? '&b=' + encodeURIComponent(b) : '') + (a ? '&a=' + encodeURIComponent(a) : ''); }

  /* ---------- наявність «наживо» (10.11.2026) ----------
   * Індекс збирається з фіду Хорошопу, а фід оновлюється раз на добу — товар, що з'явився вдень, у пошуку був
   * «немає в наявності». Тому беремо наявність зі сторінок, які покупець і так відкриває: картки каталогу
   * (категорії, сторінка пошуку Хорошопу) і сама картка товару. Пам'ятаємо 12 год у localStorage (sc37-live)
   * і підставляємо в результати пошуку замість даних фіду. Жодних додаткових запитів. */
  var LIVE_KEY = 'sc37-live', LIVE_TTL = 12 * 3600e3, live = null;
  function liveLoad() {
    if (live) return live;
    try { live = JSON.parse(localStorage.getItem(LIVE_KEY) || '{}') || {}; } catch (e) { live = {}; }
    var now = Date.now();
    Object.keys(live).forEach(function (u) { if (!live[u] || now - live[u][1] > LIVE_TTL) delete live[u]; });
    return live;
  }
  function liveSave() { try { localStorage.setItem(LIVE_KEY, JSON.stringify(live)); } catch (e) {} }
  function stockText(t) {
    t = lower(t || '');
    if (!t) return null;
    if (/немає|відсутн|нет в наличии|под заказ|під замовлення|очікується|ожидается/.test(t)) return 0;
    if (/в наявності|є в наявності|закінчується|в наличии|заканчивается|достатньо/.test(t)) return 1;
    return null;
  }
  function pathOf(href) { try { return new URL(href, location.href).pathname; } catch (e) { return ''; } }
  // зібрати наявність з карток каталогу і картки товару на поточній сторінці
  function harvestLive() {
    liveLoad();
    var now = Date.now(), n = 0;
    [].forEach.call(document.querySelectorAll('.catalogCard, .catalog-card, .productsSlider-item, .product-card'), function (c) {
      if (c.closest('.sc37-res, .sc37-dd')) return;
      var a = c.querySelector('a[href]'), av = c.querySelector('[class*="availability"], [class*="Availability"]');
      var s = av ? stockText(av.textContent) : null, u = a ? pathOf(a.getAttribute('href')) : '';
      if (u && s != null) { live[u] = [s, now]; n++; }
    });
    var pa = document.querySelector('.product-header__availability, .product__availability, [class*="product"][class*="availability"]');
    if (pa && !pa.closest('.catalogCard, .catalog-card')) {
      var cs = stockText(pa.textContent), cu = pathOf((document.querySelector('link[rel=canonical]') || {}).href || location.href);
      if (cs != null && cu) { live[cu] = [cs, now]; n++; }
    }
    if (n) { liveSave(); if (IDX) applyLive(IDX); }
    return n;
  }
  // підставити свіжу наявність у товари індексу (до пошуку — щоб «в наявності» й піднімало вище)
  function applyLive(idx) {
    if (!idx) return;
    liveLoad();
    Object.keys(live).forEach(function (u) { var d = idx.byUrl && idx.byUrl[u]; if (d) d.s = live[u][0]; });
  }
  scReady(scSafe(37, function () { harvestLive(); setTimeout(scSafe(37, harvestLive), 2500); }));

  /* ---------- «Ви шукали» — останні запити в цьому браузері ---------- */
  var HIST_KEY = 'sc37-hist';
  function histGet() { try { var h = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); return Array.isArray(h) ? h : []; } catch (e) { return []; } }
  function histAdd(q) {
    q = String(q || '').trim().slice(0, 80);
    if (q.length < 2) return;
    var h = histGet().filter(function (x) { return lower(x) !== lower(q); });
    h.unshift(q);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 6))); } catch (e) {}
  }
  function histClear() { try { localStorage.removeItem(HIST_KEY); } catch (e) {} }

  scStyle('sc37-css', [
    'html.sc-srch .search-results{display:none!important}',
    '.sc37-dd{position:absolute;z-index:10050;background:#fff;border:1px solid #e3e3e3;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);overflow:auto;font-size:14px;line-height:1.3;text-align:left}',
    '.sc37-dd a{display:flex;align-items:center;gap:10px;padding:8px 12px;color:#222;text-decoration:none;border-bottom:1px solid #f1f1f1}',
    '.sc37-dd a:hover,.sc37-dd a.is-active{background:#f3f8f3}',
    '.sc37-dd img{width:44px;height:44px;object-fit:contain;flex:0 0 44px}',
    '.sc37-dd .sc37-n{flex:1;min-width:0}',
    '.sc37-dd .sc37-p{font-weight:700;white-space:nowrap;margin-top:2px}',
    '.sc37-dd .sc37-out{color:#999;font-weight:400;font-size:12px;margin-left:6px}',
    '.sc37-dd .sc37-all{justify-content:center;font-weight:600;color:#2a9d4a;border-bottom:0}',
    '.sc37-dd .sc37-none{padding:12px;color:#666}',
    '.sc37-res{margin:0 0 30px}',
    '.sc37-res__bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:0 0 14px;color:#555}',
    '.sc37-res__bar label{display:flex;gap:6px;align-items:center;cursor:pointer;white-space:nowrap}',
    '.sc37-res__bar input[type=checkbox]{appearance:auto;-webkit-appearance:checkbox;position:static;opacity:1;width:16px;height:16px;margin:0}',
    '.sc37-res__bar select{width:auto;padding:6px 8px;border:1px solid #ddd;border-radius:6px;background:#fff;font-size:14px}',
    '.sc37-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}',
    '.sc37-card{display:flex;flex-direction:column;border:1px solid #e6e6e6;border-radius:8px;padding:10px;color:#222;text-decoration:none;background:#fff}',
    '.sc37-card:hover{border-color:#2a9d4a}',
    '.sc37-card img{width:100%;aspect-ratio:1/1;object-fit:contain;margin-bottom:8px}',
    // немає фото / не відкрилось — сіра заглушка того ж розміру, щоб картки не «стрибали»
    '.sc37-noimg{display:block;width:100%;aspect-ratio:1/1;margin-bottom:8px;border-radius:6px;background:#f4f5f4 url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27%3E%3Cpath fill=%27%23c8ccc8%27 d=%27M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z%27/%3E%3C/svg%3E") center/32% no-repeat}',
    '.sc37-dd .sc37-noimg{width:44px;height:44px;flex:0 0 44px;margin:0;aspect-ratio:auto}',
    '.sc37-card .sc37-b{font-size:12px;color:#888}',
    '.sc37-card .sc37-t{font-size:14px;line-height:1.3;margin:4px 0 8px;flex:1}',
    '.sc37-card .sc37-pr{font-weight:700;font-size:16px}',
    '.sc37-card .sc37-st{font-size:12px;margin-top:4px;color:#2a9d4a}',
    '.sc37-card .sc37-st.is-out{color:#999}',
    '.sc37-more{display:block;margin:16px auto 0;padding:10px 24px;border:1px solid #2a9d4a;border-radius:6px;background:#fff;color:#2a9d4a;font-weight:600;cursor:pointer}',
    '.sc37-note{margin:0 0 12px;color:#666}',
    // категорії / бренди у підказках і на сторінці результатів (10.11.2026)
    '.sc37-dd .sc37-fac{padding:8px 12px 4px;border-bottom:1px solid #f1f1f1}',
    '.sc37-dd .sc37-h{display:flex;justify-content:space-between;align-items:center;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#999;margin:0 0 6px}',
    '.sc37-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 6px}',
    '.sc37-dd a.sc37-chip,.sc37-res a.sc37-chip,.sc37-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border:1px solid #dfe5df;border-radius:14px;background:#f7faf7;color:#333;font-family:inherit;font-size:13px;font-weight:400;margin:0;line-height:1.3;text-decoration:none;white-space:nowrap;cursor:pointer}',
    '.sc37-dd a.sc37-chip:hover,.sc37-chip:hover,.sc37-chip.is-on{border-color:#2a9d4a;background:#eaf6ee;color:#1f7a39}',
    '.sc37-chip i{font-style:normal;color:#999;font-size:12px}',
    '.sc37-dd button.sc37-clr{all:unset;cursor:pointer;color:#2a9d4a;text-transform:none;letter-spacing:0;font-size:12px}',
    '.sc37-dd a.sc37-hist{padding:7px 12px;color:#444}',
    '.sc37-dd a.sc37-hist:before{content:"\\21BA";color:#bbb;margin-right:2px}',
    '.sc37-res .sc37-chips{margin:0 0 10px}',
    '.sc37-dd a.sc37-go{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:8px;padding:11px 14px;border-radius:10px;background:#2a9d4a;color:#fff;font-weight:600;font-size:15px;text-decoration:none}',
    '.sc37-dd a.sc37-go span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
    '.sc37-dd a.sc37-go b{flex:0 0 auto;font-weight:600;opacity:.9;font-size:13px}',
    '.sc37-dd a.sc37-go.is-active,.sc37-dd a.sc37-go:hover{background:#1f7a39;color:#fff}',
    '.sc37-dd .sc37-fix{padding:7px 12px;font-size:13px;color:#666;background:#fafafa;border-bottom:1px solid #f1f1f1}',
    '.sc37-res .sc37-lbl{color:#888;font-size:13px;margin-right:2px;align-self:center}',
    '@media (max-width:767px){.sc37-grid{grid-template-columns:repeat(2,1fr);gap:8px}.sc37-card{padding:8px}.sc37-dd{position:fixed;left:0!important;right:0;width:auto!important;border-radius:0}',
    '.sc37-chips{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}.sc37-chips::-webkit-scrollbar{display:none}}'
  ].join('\n'));

  /* ---------- підказки під полем ---------- */
  var dd = null, ddInput = null, active = -1, lastQ = '', timer = 0;
  function hide() { if (dd) dd.style.display = 'none'; active = -1; }
  function place(input) {
    var r = input.getBoundingClientRect(), mobile = window.innerWidth < 768;
    if (mobile) { dd.style.top = (r.bottom + 4) + 'px'; dd.style.maxHeight = (window.innerHeight - r.bottom - 8) + 'px'; }
    else {
      var form = input.closest('form') || input;
      var fr = form.getBoundingClientRect();
      dd.style.left = (fr.left + window.pageXOffset) + 'px';
      dd.style.top = (fr.bottom + window.pageYOffset + 4) + 'px';
      dd.style.width = Math.max(fr.width, 520) + 'px';
      dd.style.maxHeight = '70vh';
    }
  }
  function ensureDd() {
    if (dd) return;
    dd = document.createElement('div');
    dd.className = 'sc37-dd';
    document.body.appendChild(dd);
    dd.addEventListener('mousedown', function (e) { e.preventDefault(); });   // не втрачати фокус поля
    dd.addEventListener('click', scSafe(37, function (e) {
      if (e.target.closest('.sc37-clr')) {                       // «Очистити» історію
        histClear(); hide();
        if (ddInput) ddInput.focus();
        return;
      }
      var h = e.target.closest('a.sc37-hist');
      if (h) return;                                              // перехід за запитом з історії — звичайне посилання
      var a = e.target.closest('a[data-i]');
      if (a) try { if (typeof window.gtag === 'function') window.gtag('event', 'sc_search_click', { search_term: lastQ.slice(0, 100), position: +a.getAttribute('data-i') + 1, place: 'dropdown' }); } catch (x) {}
      var f = e.target.closest('a[data-f]');
      if (f) try { if (typeof window.gtag === 'function') window.gtag('event', 'sc_search_facet', { search_term: lastQ.slice(0, 100), facet: f.getAttribute('data-f'), place: 'dropdown' }); } catch (x) {}
      if (a || f || e.target.closest('a.sc37-all')) histAdd(lastQ);
    }));
  }
  function render(input, q) {
    ensureDd();
    ddInput = input;
    var r = search(IDX, q), top = r.items.slice(0, 8), html = '';
    // категорії (до 4) і бренди (до 4, лише якщо їх кілька й бренд не вказано в самому запиті)
    if (top.length && r.total > 3) {
      var cats = r.cats.slice(0, 4), qn = ' ' + normText(q).join(' ') + ' ';
      var brands = r.brands.length > 1 ? r.brands.filter(function (b) { return qn.indexOf(' ' + lower(b.name) + ' ') < 0; }).slice(0, 4) : [];
      if (cats.length > 1 || brands.length) {
        html += '<div class="sc37-fac">';
        if (cats.length > 1) html += '<div class="sc37-h">Категорії</div><div class="sc37-chips">' + cats.map(function (c) {
          return '<a class="sc37-chip" data-f="cat" href="' + esc(resultsUrl(q, c.name)) + '">' + esc(c.name) + ' <i>' + c.count + '</i></a>';
        }).join('') + '</div>';
        if (brands.length) html += '<div class="sc37-h">Бренди</div><div class="sc37-chips">' + brands.map(function (b) {
          return '<a class="sc37-chip" data-f="brand" href="' + esc(resultsUrl(q, '', b.name)) + '">' + esc(b.name) + ' <i>' + b.count + '</i></a>';
        }).join('') + '</div>';
        html += '</div>';
      }
    }
    // мобільна версія Хорошопу не має видимої кнопки «шукати» (лише Enter на клавіатурі) — велика кнопка
    // одразу під полем, над клавіатурою; «Усі результати» внизу списку на телефоні не видно
    if (top.length && window.innerWidth < 768) html = '<a class="sc37-go sc37-nav" href="' + resultsUrl(q) + '"><span>Шукати «' + esc(q.slice(0, 40)) + '»</span><b>' + r.total + ' ' + plural(r.total, ['товар', 'товари', 'товарів']) + ' →</b></a>' + html;
    var fx = top.length ? fixedText(q, r) : '';
    if (fx) html += '<div class="sc37-fix">Показано для: <b>' + esc(fx) + '</b></div>';
    if (r.qnote && top.length) html += '<div class="sc37-fix">Підходять: <b>' + esc(r.qnote) + '</b></div>';
    top.forEach(function (it, i) {
      html += '<a class="sc37-nav" href="' + esc(it.u) + '" data-i="' + i + '">' + (it.i ? '<img src="' + esc(it.i) + '" alt="" loading="lazy">' : '<span class="sc37-noimg"></span>') +
        '<span class="sc37-n">' + esc(it.n) + '<div class="sc37-p">' + price(it.p) + (it.s ? '' : '<span class="sc37-out">немає в наявності</span>') + '</div></span></a>';
    });
    if (top.length) html += (r.partial ? '<div class="sc37-none" style="padding:6px 12px;font-size:13px">Точного збігу немає — показуємо схожі.</div>' : '') +
      '<a class="sc37-all sc37-nav" href="' + resultsUrl(q) + '">Усі результати (' + r.total + ') →</a>';
    else html = '<div class="sc37-none">Нічого не знайшли за «' + esc(q) + '». Спробуйте інакше або <a class="sc37-all" href="' + resultsUrl(q) + '" style="display:inline;padding:0">шукати по всьому сайту</a>.</div>';
    dd.innerHTML = html;
    dd.style.display = 'block';
    active = -1;
    place(input);
    if (q !== lastQ) { lastQ = q; clearTimeout(render.t); render.t = setTimeout(function () { ga(q, r, 'dropdown'); }, 1500); }
  }
  function onInput(e) {
    var input = e.target;
    if (!input.matches || !input.matches('input[name="q"]')) return;
    var q = input.value.trim();
    clearTimeout(timer);
    if (q.length < 2) return q.length ? hide() : showHist(input);
    timer = setTimeout(function () { load(scSafe(37, function () { if (input.value.trim() === q) render(input, q); })); }, 120);
  }
  // фото не відкрилось (застаріла мініатюра) — заглушка замість «битої» картинки
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.closest && t.closest('.sc37-card, .sc37-dd')) {
      var ph = document.createElement('span');
      ph.className = 'sc37-noimg';
      t.parentNode.replaceChild(ph, t);
    }
  }, true);
  // порожнє поле — «Ви шукали» (останні запити з цього браузера)
  function showHist(input) {
    var h = histGet();
    if (!h.length) return hide();
    ensureDd();
    ddInput = input;
    dd.innerHTML = '<div class="sc37-fac" style="border:0;padding-bottom:0"><div class="sc37-h">Ви шукали <button type="button" class="sc37-clr">Очистити</button></div></div>' +
      h.map(function (q) { return '<a class="sc37-hist sc37-nav" href="' + esc(resultsUrl(q)) + '">' + esc(q) + '</a>'; }).join('');
    dd.style.display = 'block';
    active = -1;
    place(input);
  }
  document.addEventListener('focusin', scSafe(37, function (e) {
    if (!(e.target.matches && e.target.matches('input[name="q"]'))) return;
    // клавіша Enter на телефоні — з написом/лупою «Пошук», а не «Далі»/«↵»
    if (!e.target.getAttribute('enterkeyhint')) e.target.setAttribute('enterkeyhint', 'search');
    load(function () {});
    var v = e.target.value.trim();
    if (v.length >= 2 && IDX) render(e.target, v);
    else if (!v) showHist(e.target);
  }));
  document.addEventListener('input', scSafe(37, onInput), true);
  document.addEventListener('focusout', function (e) { if (e.target === ddInput) setTimeout(hide, 150); });
  document.addEventListener('keydown', scSafe(37, function (e) {
    if (!dd || dd.style.display === 'none' || e.target !== ddInput) return;
    var links = dd.querySelectorAll('a.sc37-nav');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
      [].forEach.call(links, function (a, i) { a.classList.toggle('is-active', i === active); });
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      var q = ddInput.value.trim();
      if (!q && !(active >= 0 && links[active])) return hide();   // порожнє поле, відкрита лише історія
      if (q.length >= 2) histAdd(q);
      location.href = active >= 0 && links[active] ? links[active].getAttribute('href') : resultsUrl(q);
    } else if (e.key === 'Escape') hide();
  }), true);
  window.addEventListener('resize', function () { if (dd && dd.style.display !== 'none' && ddInput) place(ddInput); });

  /* ---------- голосовий пошук (10.11.2026) ----------
   * Кнопка-мікрофон у полі пошуку — лише там, де браузер уміє розпізнавати мову (Chrome / Android,
   * Safari на iPhone з увімкненою диктовкою). Розпізнає українську (і російську — браузер сам).
   * Сказане → сторінка результатів. Нічого не вантажить, поки не натиснули. GA4: sc_search_voice. */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    scStyle('sc37-mic-css', [
      '.sc37-mic{position:absolute;top:50%;transform:translateY(-50%);z-index:2;width:30px;height:30px;padding:0;margin:0;border:0;border-radius:50%;background:transparent;color:#8a8a8a;cursor:pointer;display:flex;align-items:center;justify-content:center}',
      '.sc37-mic:hover{color:#2a9d4a}',
      '.sc37-mic svg{width:18px;height:18px;fill:currentColor}',
      '.sc37-mic.is-on{color:#fff;background:#d6322b;animation:sc37pulse 1.2s infinite}',
      '@keyframes sc37pulse{0%{box-shadow:0 0 0 0 rgba(214,50,43,.5)}100%{box-shadow:0 0 0 10px rgba(214,50,43,0)}}'
    ].join('\n'));
    var MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';
    var rec = null, recBtn = null;
    var addMic = function (input) {
      if (!input || input._scMic || !input.offsetParent) return;
      var box = input.parentElement;
      if (!box) return;
      input._scMic = 1;
      if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sc37-mic';
      btn.setAttribute('aria-label', 'Голосовий пошук');
      btn.title = 'Голосовий пошук';
      btn.innerHTML = MIC;
      box.appendChild(btn);
      var pr0 = parseInt(getComputedStyle(input).paddingRight, 10) || 0;
      // праворуч від поля бувають кнопки «шукати» і «очистити» (на мобільній — хрестик з'являється, коли є текст),
      // тож місце перераховуємо при кожному введенні: мікрофон завжди лівіше від них
      var place = function () {
        var right = 4, ir = input.getBoundingClientRect();
        [].forEach.call(box.parentNode.querySelectorAll('button, [type=submit]'), function (b) {
          if (b === btn) return;
          var br = b.getBoundingClientRect();
          if (br.width && br.top < ir.bottom && br.bottom > ir.top && br.left >= ir.left + ir.width / 2 && br.right <= ir.right + 2) right = Math.max(right, Math.round(ir.right - br.left) + 2);
        });
        var br0 = box.getBoundingClientRect();
        btn.style.right = (right + Math.round(br0.right - ir.right)) + 'px';
        input.style.paddingRight = Math.max(pr0, right + 32) + 'px';
      };
      place();
      ['input', 'focus', 'keyup'].forEach(function (ev) { input.addEventListener(ev, function () { setTimeout(place, 0); }); });
      btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      btn.addEventListener('click', scSafe(37, function (e) {
        e.preventDefault(); e.stopPropagation();
        if (rec) { rec.stop(); return; }
        rec = new SR();
        rec.lang = /^ru/i.test(document.documentElement.lang || '') ? 'ru-RU' : 'uk-UA';
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        recBtn = btn;
        btn.classList.add('is-on');
        var said = '';
        rec.onresult = function (ev) {
          said = '';
          for (var i = 0; i < ev.results.length; i++) said += ev.results[i][0].transcript;
          input.value = said;
        };
        rec.onerror = function () { said = ''; };
        rec.onend = scSafe(37, function () {
          btn.classList.remove('is-on');
          rec = null; recBtn = null;
          said = said.replace(/[.?!]+$/, '').trim();
          if (said.length < 2) return;
          try { if (typeof window.gtag === 'function') window.gtag('event', 'sc_search_voice', { search_term: said.slice(0, 100) }); } catch (x) {}
          histAdd(said);
          location.href = resultsUrl(said);
        });
        try { rec.start(); } catch (x) { btn.classList.remove('is-on'); rec = null; }
      }));
    };
    var addMics = function () { [].forEach.call(document.querySelectorAll('input[name="q"]'), addMic); };
    scReady(scSafe(37, addMics));
    setTimeout(scSafe(37, addMics), 2000);                      // Хорошоп дорендерює шапку
    document.addEventListener('focusin', scSafe(37, function (e) { if (e.target.matches && e.target.matches('input[name="q"]')) addMic(e.target); }));
  }

  /* ---------- сторінка результатів ---------- */
  if (/^\/katalog\/search\/?$/.test(location.pathname)) {
    var sp = new URLSearchParams(location.search);
    var q = (sp.get('q') || '').trim(), selCat = sp.get('k') || '', selBrand = sp.get('b') || '';
    var selA = {}, selF = {};                                   // характеристики: &a=mp:4,f:poe
    (sp.get('a') || '').split(',').forEach(function (x) { var p = x.split(':'); if (p.length === 2 && p[1]) { if (p[0] === 'f') selF[p[1]] = 1; else selA[p[0]] = p[1]; } });
    if (!q) return;
    histAdd(q);
    load(scSafe(37, function () {
      harvestLive(); applyLive(IDX);                           // картки Хорошопу на цій сторінці — найсвіжіша наявність
      var r = search(IDX, q);
      ga(q, r, 'page');
      if (!r.total) return;                        // нічого — лишаємо результати Хорошопу
      if (document.querySelector('.sc37-res')) return;
      // ПК: ховаємо .catalog__middle (фільтри + сітка), заголовок лишається; мобільна: у section.catalog
      // ховаємо все, крім заголовка й хлібних крихт
      var hideEls = [], anchor = null, mid = document.querySelector('.catalog__middle');
      if (mid) { hideEls = [mid]; anchor = mid; }
      else {
        var cat = document.querySelector('section.catalog, .catalog'), h1 = cat && cat.querySelector('h1');
        if (!cat) return;
        [].forEach.call(cat.children, function (ch) { if (!ch.querySelector('h1') && ch.tagName !== 'H1' && !/breadcrumb/.test(ch.className)) hideEls.push(ch); });
        anchor = hideEls[0];
        if (!anchor) return;
      }
      var box = document.createElement('div');
      box.className = 'sc37-res';
      var onlyStock = false, sort = 'rel', shown = 0, list = r.items, PAGE = 24;
      [].forEach.call(document.querySelectorAll('.catalog__top-col--right'), function (el) { el.style.visibility = 'hidden'; });   // сортування Хорошопу не діє на наш список
      function cards(from, to, arr) {
        return arr.slice(from, to).map(function (it, i) {
          return '<a class="sc37-card" href="' + esc(it.u) + '" data-i="' + (from + i) + '">' + (it.i ? '<img src="' + esc(it.i) + '" alt="' + esc(it.n) + '" loading="lazy">' : '<span class="sc37-noimg"></span>') +
            (it.b ? '<span class="sc37-b">' + esc(it.b) + '</span>' : '') + '<span class="sc37-t">' + esc(it.n) + '</span>' +
            '<span class="sc37-pr">' + price(it.p) + '</span><span class="sc37-st' + (it.s ? '' : ' is-out') + '">' + (it.s ? 'В наявності' : 'Немає в наявності') + '</span></a>';
        }).join('');
      }
      // фільтр з посилання (категорія / бренд з підказок), якого серед знайденого немає, — ігноруємо
      if (selCat && !r.cats.some(function (c) { return c.name === selCat; })) selCat = '';
      if (selBrand && !r.brands.some(function (b) { return b.name === selBrand; })) selBrand = '';
      function chips(label, key, all, sel) {
        if (all.length < 2) return '';
        return '<div class="sc37-chips"><span class="sc37-lbl">' + label + ':</span>' +
          '<button type="button" class="sc37-chip' + (sel ? '' : ' is-on') + '" data-' + key + '="">Усі</button>' +
          all.slice(0, 12).map(function (x) {
            return '<button type="button" class="sc37-chip' + (x.name === sel ? ' is-on' : '') + '" data-' + key + '="' + esc(x.name) + '">' + esc(x.name) + ' <i>' + x.count + '</i></button>';
          }).join('') + '</div>';
      }
      // чи проходить товар усі фільтри, крім групи skip (щоб у кожній групі рахувати з урахуванням інших)
      function pass(it, skip) {
        if (skip !== 'k' && selCat && it.k !== selCat) return false;
        if (skip !== 'b' && selBrand && it.b !== selBrand) return false;
        if (onlyStock && !it.s) return false;
        var a = attrs(it);
        for (var g in selA) if (skip !== g && a[g] !== selA[g]) return false;
        for (var f in selF) if (skip !== 'f:' + f && !a.f[f]) return false;
        return true;
      }
      function aParam() {
        var p = [];
        Object.keys(selA).forEach(function (g) { p.push(g + ':' + selA[g]); });
        Object.keys(selF).forEach(function (f) { p.push('f:' + f); });
        return p.join(',');
      }
      // рядки фільтрів за характеристиками: лише ті, що справді ділять знайдене
      function attrRows() {
        var html = '';
        ATTR_NUM.forEach(function (g) {
          var base = list.filter(function (it) { return pass(it, g.id); }), cnt = {}, have = 0;
          base.forEach(function (it) { var v = attrs(it)[g.id]; if (v) { cnt[v] = (cnt[v] || 0) + 1; have++; } });
          var vals = Object.keys(cnt);
          if (!selA[g.id] && (vals.length < 2 || have < base.length * 0.4)) return;
          vals = vals.sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 10).sort(function (a, b) { return a - b; });
          html += '<div class="sc37-chips"><span class="sc37-lbl">' + g.label + ':</span>' + vals.map(function (v) {
            return '<button type="button" class="sc37-chip' + (selA[g.id] === v ? ' is-on' : '') + '" data-a="' + g.id + ':' + esc(v) + '">' + esc(g.fmt(v)) + ' <i>' + cnt[v] + '</i></button>';
          }).join('') + '</div>';
        });
        var fl = [];
        ATTR_FLAGS.forEach(function (f) {
          var base = list.filter(function (it) { return pass(it, 'f:' + f[0]); }), c = 0;
          base.forEach(function (it) { if (attrs(it).f[f[0]]) c++; });
          if (selF[f[0]] || (c >= 2 && c <= base.length * 0.95 && c >= base.length * 0.05)) fl.push([f[0], f[1], c]);
        });
        if (fl.length) html += '<div class="sc37-chips"><span class="sc37-lbl">Особливості:</span>' + fl.slice(0, 8).map(function (f) {
          return '<button type="button" class="sc37-chip' + (selF[f[0]] ? ' is-on' : '') + '" data-a="f:' + f[0] + '">' + f[1] + ' <i>' + f[2] + '</i></button>';
        }).join('') + '</div>';
        return html;
      }
      function draw() {
        // кількість у фільтрах — з урахуванням інших фільтрів
        var byBrand = list.filter(function (it) { return pass(it, 'k'); });
        var byCat = list.filter(function (it) { return pass(it, 'b'); });
        var arr = list.filter(function (it) { return pass(it); });
        if (sort === 'asc') arr.sort(function (a, b) { return a.p - b.p; });
        else if (sort === 'desc') arr.sort(function (a, b) { return b.p - a.p; });
        shown = Math.min(PAGE, arr.length);
        var fx = fixedText(q, r);
        box.innerHTML = (fx ? '<p class="sc37-note">Показано результати для «<b>' + esc(fx) + '</b>»</p>' : '') +
          (r.qnote ? '<p class="sc37-note">Лише ті, що підходять: <b>' + esc(r.qnote) + '</b> (за характеристиками виробника)</p>' : '') +
          (r.partial ? '<p class="sc37-note">Точного збігу немає — схожі товари:</p>' : '') +
          chips('Категорія', 'k', facet(byBrand, 'k'), selCat) + chips('Бренд', 'b', facet(byCat, 'b'), selBrand) + attrRows() +
          '<div class="sc37-res__bar"><span>Знайдено: ' + arr.length + '</span><label><input type="checkbox"' + (onlyStock ? ' checked' : '') + '> лише в наявності</label>' +
          '<select aria-label="Сортування"><option value="rel">За відповідністю</option><option value="asc">Спочатку дешевші</option><option value="desc">Спочатку дорожчі</option></select></div>' +
          '<div class="sc37-grid">' + cards(0, shown, arr) + '</div>' + (arr.length > shown ? '<button type="button" class="sc37-more">Показати ще</button>' : '');
        box.querySelector('select').value = sort;
        box._arr = arr;
      }
      box.addEventListener('change', scSafe(37, function (e) {
        if (e.target.type === 'checkbox') onlyStock = e.target.checked;
        else if (e.target.tagName === 'SELECT') sort = e.target.value;
        draw();
      }));
      box.addEventListener('click', scSafe(37, function (e) {
        var chip = e.target.closest('button.sc37-chip');
        if (chip) {
          var facetName;
          if (chip.hasAttribute('data-k')) { selCat = chip.getAttribute('data-k'); facetName = 'cat'; }
          else if (chip.hasAttribute('data-b')) { selBrand = chip.getAttribute('data-b'); facetName = 'brand'; }
          else {                                                    // характеристика: повторне натискання знімає
            var p = chip.getAttribute('data-a').split(':');
            facetName = p[0] === 'f' ? p[1] : p[0];
            if (p[0] === 'f') { if (selF[p[1]]) delete selF[p[1]]; else selF[p[1]] = 1; }
            else if (selA[p[0]] === p[1]) delete selA[p[0]]; else selA[p[0]] = p[1];
          }
          // фільтр — у посиланні: «Назад» з товару повертає до того ж списку
          try { history.replaceState(history.state, '', resultsUrl(q, selCat, selBrand, aParam())); } catch (x) {}
          try { if (typeof window.gtag === 'function') window.gtag('event', 'sc_search_facet', { search_term: q.slice(0, 100), facet: facetName, place: 'page' }); } catch (x) {}
          draw();
          return;
        }
        if (e.target.classList.contains('sc37-more')) {
          var arr = box._arr, grid = box.querySelector('.sc37-grid');
          grid.insertAdjacentHTML('beforeend', cards(shown, shown + PAGE, arr));
          shown = Math.min(shown + PAGE, arr.length);
          if (shown >= arr.length) e.target.remove();
          return;
        }
        var a = e.target.closest('a[data-i]');
        if (a) try { if (typeof window.gtag === 'function') window.gtag('event', 'sc_search_click', { search_term: q.slice(0, 100), position: +a.getAttribute('data-i') + 1, place: 'page' }); } catch (x) {}
      }));
      draw();
      anchor.parentElement.insertBefore(box, anchor);
      hideEls.forEach(function (el) { el.style.display = 'none'; });
    }));
  }
});

/* =====================================================================
 * 38. Швидкість відповіді сервера у реальних відвідувачів (10.11.2026)
 *     На форумі Хорошопу (club.horoshop.ua/t/497): один із двох серверів (51.68.107.5) відповідає 5–7 с
 *     замість 0,2 с; наш домен якраз на ньому і на 51.68.97.214. Браузер обирає сервер навмання,
 *     тож у частини відвідувачів білий екран. Міряємо час від запиту до першого байта сторінки і
 *     надсилаємо в GA4 подією з кошиком у назві (звіт «Події» без налаштувань):
 *     sc_ttfb_fast (< 1 с), sc_ttfb_slow (1–3 с), sc_ttfb_vslow (≥ 3 с); параметр ttfb_ms — точне значення.
 * ===================================================================== */
scModule(38, function () {
  'use strict';
  scIdle(scSafe(38, function () {
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (!nav || !nav.responseStart || nav.type === 'back_forward' || nav.transferSize === 0) return;   // з кешу — не показово
    var ms = Math.round(nav.responseStart - nav.requestStart);
    if (!(ms >= 0 && ms < 120000)) return;
    var bucket = ms < 1000 ? 'fast' : ms < 3000 ? 'slow' : 'vslow';
    var send = function () {
      if (typeof window.gtag !== 'function') return false;
      window.gtag('event', 'sc_ttfb_' + bucket, { ttfb_ms: ms, page_kind: document.querySelector('[itemtype*="schema.org/Product"]') ? 'product' : 'other', non_interaction: true });
      return true;
    };
    if (!send()) setTimeout(send, 3000);
  }));
});


/* =====================================================================
 * 39. Кошик → «До цього знадобиться» (10.11.2026)
 *     Щойно покупець натиснув «Купити», у вікні кошика (ПК і мобільна) над «Рекомендуємо придбати»
 *     Хорошопу (там схожі товари) показуємо доповнення до того, що вже в кошику: до реєстратора —
 *     жорсткий диск, до IP-камери — PoE-комутатор і кабель, до Wi-Fi-камери — карту пам'яті, до хаба
 *     Ajax — датчики того ж кольору, до відеодомофону — панель того ж бренду й типу (IP / аналог)…
 *     Товари — з індексу пошуку (блок 37), лише в наявності, яких ще немає в кошику, до 4 шт.
 *     «До кошика» — штатний AjaxCart.appendProduct Хорошопу; id товару беремо зі сторінки товару
 *     (j-buy-button-widget-<id>) у мить натискання. Не вийшло — відкриваємо сторінку товару.
 *     GA4: sc_upsell_view, sc_upsell_add.
 * ===================================================================== */
scModule(39, function () {
  'use strict';
  var MAX = 4;

  function color(n) { return /чорн|black|graphite|графіт/i.test(n) ? 'чорний' : 'білий'; }
  function R(q, n, note, f) { return { q: q, n: n, note: note, f: f }; }
  function has(cart, re) { return cart.some(function (it) { return re.test(it.k + ' ' + it.n); }); }
  var NOTE = {
    poe: 'Живлення й мережа для камер одним кабелем',
    utp: 'Кабель від камер до комутатора',
    patch: 'Підключити реєстратор / роутер',
    sd: 'Запис на саму камеру',
    hdd: 'Без диска реєстратор не записує',
    hdmi: 'Підключити монітор / телевізор',
    exitBtn: 'Відчинити двері зсередини',
    psu12: 'Живлення замка 12 В',
    lock: 'Відчинення дверей кнопкою з монітора',
    closer: 'Двері зачиняються самі — замок спрацює'
  };
  // що запропонувати до товару в кошику: R(запит до пошуку, скільки, підпис, фільтр); cart — усі товари кошика
  function rules(it, cart) {
    var n = it.n, k = it.k, b = it.b, ip = /^IP-/.test(n), out = [];
    var noSwitch = !has(cart, /комутатор/i), noLock = !has(cart, /замок|защіпка/i), noPsu = !has(cart, /блок живлення/i);
    switch (k) {
      case 'Відеокамери':
        if (/wi-?fi|imou|ezviz/i.test(n)) return [R("карта пам'яті microsd", 2, NOTE.sd)];
        if (/^IP/.test(n)) return [b === 'Ajax' && !has(cart, /nvr|реєстратор/i) && R('відеореєстратор ajax nvr', 1, 'Запис камер Ajax'), noSwitch && R('poe-комутатор некерований', 1, NOTE.poe), R('кабель вита пара utp cat5e', 1, NOTE.utp), R('патч-корд мережевий utp', 1, NOTE.patch)];
        return [R('блок живлення 12v', 1, 'Живлення камер 12 В'), R('кабель коаксіальний rg-59', 1, 'Кабель від камери до реєстратора')];
      case 'Відеореєстратори':
        if (/^Нагрудний/.test(n)) return [];
        return [R('жорсткий диск purple', 2, NOTE.hdd), ip && !/poe/i.test(n) && noSwitch && R('poe-комутатор некерований', 1, NOTE.poe), R('кабель hdmi 2.0', 1, NOTE.hdmi)];
      case 'Відеодомофони':
        if (/^відеодзвінок|дзвінок/i.test(n)) return [];   // відеодзвінок сам по собі, замок і панель йому не потрібні
        return [R('відеопанель ' + b, 2, 'Панель того ж бренду', function (x) { return /^IP-/.test(x.n) === ip && x.k === 'Відеопанелі'; }),
          noLock && R('замок електромагнітний', 1, NOTE.lock), R("карта пам'яті microsd", 1, 'Запис відвідувачів (якщо є слот microSD)')];
      case 'Відеопанелі':
        return [R('відеодомофон ' + b, 2, 'Монітор того ж бренду', function (x) { return /^IP-/.test(x.n) === ip && x.k === 'Відеодомофони'; }),
          noLock && R('замок електромагнітний', 1, NOTE.lock), R('кнопка виходу', 1, NOTE.exitBtn)];
      case 'Комплекти відеодомофонів':
        return [noLock && R('замок електромагнітний', 1, NOTE.lock), R('кнопка виходу', 1, NOTE.exitBtn), noPsu && R('блок живлення 12v', 1, NOTE.psu12)];
      case 'Електромагнітні замки': {
        // кронштейн під модель — та сама відповідність, що й у блоці 19 на картці замка
        var kr = /kraft/i.test(n) ? 'kraft' : 'trinix', br = null;
        if (/\bTML-300LED\s*\(DS\)/i.test(n)) br = '/kronshtein-k-300lds-trinix/';
        else if (/\b(KRF|TML)-200\b/i.test(n)) br = '/kronshtein-k-200l-' + kr + '/';
        else if (/\b(KRF|TML)-300LED\b/i.test(n)) br = '/kronshtein-k-300l-' + kr + '/';
        else if (/\b(KRF|TML)-500LED\b/i.test(n)) br = '/kronshtein-k-500l-' + kr + '/';
        return [br && { u: br, n: 1, note: 'Кронштейн саме під цей замок (L — якщо двері відчиняються від замка)' }, R('кнопка виходу', 1, NOTE.exitBtn), noPsu && R('блок живлення 12v', 1, NOTE.psu12), R('дверний доводчик', 1, NOTE.closer)];
      }
      case 'Електромеханічні замки': case 'Електрозащіпки':
        return [R('кнопка виходу', 1, NOTE.exitBtn), noPsu && R('блок живлення 12v', 1, NOTE.psu12)];
      case 'Кнопки виходу': case 'Кодові клавіатури':
        return [noLock && R('замок електромагнітний', 1, 'Замок, яким керує кнопка / клавіатура'), noPsu && R('блок живлення 12v', 1, NOTE.psu12)];
      case 'Зчитувачі': case 'Контролери': {
        var key = /mifare/i.test(n) && !/em/i.test(n) ? 'картка mifare' : /mifare/i.test(n) ? 'ключ-брелок em-marine mifare' : 'ключ-брелок em-marine';
        return [R(key, 1, 'Ключі під стандарт зчитувача'), noLock && R('замок електромагнітний', 1, 'Замок, яким керує контролер'), R('кнопка виходу', 1, NOTE.exitBtn)];
      }
      case 'ДБЖ 12-24V': {
        var ah = (n.match(/під АКБ\s*(\d+(?:\.\d+)?)Ah/i) || [])[1];
        return ah ? [R('акумулятор 12v ' + ah + 'ah', 1, 'Акумулятор потрібної ємності — купується окремо')] : [];
      }
      case 'Маршрутизатори':
        return /маршрутизатор|роутер/i.test(n) && !/4g|lte/i.test(n) ? [R('дбж для роутера', 1, 'Інтернет працює без світла')] : [];
      case 'Точки доступу':
        return [noSwitch && R('poe-інжектор', 1, 'Живлення точки доступу по кабелю'), R('патч-корд мережевий utp', 1, NOTE.patch)];
      case 'Комутатори':
        return [R('патч-корд мережевий utp', 1, NOTE.patch), R('кабель вита пара utp cat5e', 1, 'Кабель до камер / точок доступу')];
      case 'Кабель вита пара':
        return [R('кримпер', 1, 'Обтиснути конектори RJ-45')];
      case 'Шафи та стійки':
        return [R('серверна полиця', 1, 'Полиця для реєстратора / роутера'), R('патч-панель', 1, 'Акуратне підключення кабелів'), R('блок розеток', 1, 'Живлення обладнання в шафі')];
      case 'Сигналізація Ajax':
        if (/\bhub\b|централь/i.test(n)) {
          var c = color(n), dev = function (x) { return !/smartbracket|кріпильна|кронштейн/i.test(x.n); };
          return [R('датчик руху ajax motionprotect ' + c, 1, 'Датчик руху в приміщення', dev), R('датчик відкриття ajax doorprotect ' + c, 1, 'На вхідні двері / вікна', dev),
            R('сирена ajax homesiren ' + c, 1, 'Гучне сповіщення в будинку', dev), R('клавіатура ajax keypad ' + c, 1, 'Ставити й знімати з охорони', dev)];
        }
        if (/датчик|сповіщувач|сирена|клавіатура|keypad|брелок|кнопка|реле|розетка|вимикач/i.test(n) && !/smartbracket|кріпильна/i.test(n) && !has(cart, /\bhub\b|централь/i))
          return [R('централь ajax hub 2 ' + color(n), 1, 'Без хаба пристрої Ajax не працюють (якщо хаба ще немає)')];
        return [];
      case 'Сигналізація U-Prox':
        return !/центр охорони/i.test(n) && !has(cart, /центр охорони/i) ? [R('центр охорони u-prox mpx', 1, 'Без центру пристрої U-Prox не працюють (якщо ще немає)')] : [];
      case "ІЧ-бар'єри":
        return /бар'єр/i.test(n) ? [R("кронштейн для іч-бар'єрів", 1, 'Кріплення бар\'єра'), R('термоелемент', 1, 'Обігрів узимку на вулиці')] : [];
      case 'Інвертори гібридні та автономні': {
        var v = (n.match(/(\d+)V\b/) || [])[1];
        var bat = v === '48' ? 'акумулятор lifepo4 51.2v' : v === '24' ? 'акумулятор lifepo4 25.6v' : v === '12' ? 'акумулятор lifepo4 12.8v' : null;
        return [bat && !/мережевий|on-grid/i.test(n) && R(bat, 1, 'Акумулятор під напругу інвертора ' + v + ' В'), R('кабель силовий awg', 1, 'Підключення акумулятора'), R('авр', 1, 'Автоматичне перемикання на інвертор')];
      }
      case 'Акумулятори для ДБЖ':
        return /lifepo4/i.test(n) && /12\.8V/.test(n) ? [R('зарядний пристрій lifepo4', 1, 'Зарядка LiFePO4 12.8 В')] : [];
      case 'Сонячні панелі':
        if (/^сонячна панель/i.test(n)) return [R('конектор mc4 для сонячних панелей', 1, 'Підключення панелей', function (x) { return /^конектор/i.test(x.n); }), R('кабель силовий для сонячних панелей', 1, 'Кабель від панелей до інвертора'), R('ключ для конектора mc4', 1, 'Монтаж конекторів')];
        if (/^конектор/i.test(n)) return [R('ключ для конектора mc4', 1, 'Затягнути й розібрати конектори'), R('кабель силовий для сонячних панелей', 1, 'Кабель під ці конектори')];
        return [];
      case 'Повербанки':
        return /\b(6[5-9]|[7-9]\d|1\d\d)W\b/.test(n) ? [R('перехідник starlink mini type-c dc', 1, 'Живлення Starlink Mini від цього повербанка')] : [];
      case 'Гучномовці':
        return [R('мікшуючий підсилювач cmx', 1, 'Гучномовцям потрібен підсилювач')];
      case 'Мікшери і підсилювачі':
        return [R('гучномовець cmx', 2, 'Гучномовці до підсилювача')];
    }
    return out;
  }

  function pick(api, inCart) {
    // «тип» = перші три слова назви: якщо в кошику вже є «Кабель HDMI 2.0», інший такий не пропонуємо
    function kind(n) { return String(n).toLowerCase().split(/\s+/).slice(0, 3).join(' '); }
    var have = {}, kinds = {}, out = [];
    inCart.forEach(function (it) { have[it.u] = 1; kinds[kind(it.n)] = 1; });
    inCart.forEach(function (it) {
      rules(it, inCart).forEach(function (r) {
        if (!r || out.length >= MAX) return;
        if (r.u) {                                        // конкретний товар за посиланням
          var y = api.byUrl(r.u);
          if (y && y.s && !have[y.u]) { have[y.u] = 1; kinds[kind(y.n)] = 1; out.push({ it: y, note: r.note }); }
          return;
        }
        var res = api.search(r.q);
        if (res.partial) return;
        var got = 0;
        for (var i = 0; i < res.items.length && got < r.n && out.length < MAX; i++) {
          var x = res.items[i];
          if (!x.s || have[x.u] || kinds[kind(x.n)] || (r.f && !r.f(x))) continue;
          have[x.u] = 1; kinds[kind(x.n)] = 1; out.push({ it: x, note: r.note }); got++;
        }
      });
    });
    return out;
  }
  window.SC_UPSELL_TEST = function (urls) {
    var api = window.scSearchApi;
    if (!api) return 'немає пошуку';
    var cart = urls.map(api.byUrl).filter(Boolean);
    return pick(api, cart).map(function (p) { return p.it.n.slice(0, 50) + ' — ' + p.note; });
  };

  // id товару для AjaxCart — зі сторінки товару (читаємо потік до першої появи j-buy-button-widget-<id>)
  var ids = {};
  function productId(url) {
    if (ids[url]) return Promise.resolve(ids[url]);
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } }).then(function (r) {
      if (!r.body || !r.body.getReader || !window.TextDecoder) return r.text().then(function (h) { return (h.match(/j-buy-button-widget-(\d+)/) || [])[1]; });
      var reader = r.body.getReader(), dec = new TextDecoder('utf-8'), html = '';
      return (function step() {
        return reader.read().then(function (c) {
          if (c.done) return (html.match(/j-buy-button-widget-(\d+)/) || [])[1];
          html += dec.decode(c.value, { stream: true });
          var m = html.match(/j-buy-button-widget-(\d+)/);
          if (m) { try { var p = reader.cancel(); if (p && p.catch) p.catch(function () {}); } catch (e) {} return m[1]; }
          return step();
        });
      })();
    }).then(function (id) { if (id) ids[url] = id; return id; });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function price(p) { return String(p).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' грн'; }
  function ga(ev, p) { try { if (typeof window.gtag === 'function') window.gtag('event', ev, p); } catch (x) {} }

  scStyle('sc39-css', [
    '.sc39{margin:12px 0 16px}',
    '.sc39__h{font-weight:700;font-size:16px;margin:0 0 10px}',
    '.sc39__row{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}',
    '.sc39__c{flex:0 0 150px;display:flex;flex-direction:column;border:1px solid #e6e6e6;border-radius:8px;padding:8px;background:#fff}',
    '.sc39__c img{width:100%;height:90px;object-fit:contain}',
    '.sc39__n{font-size:13px;line-height:1.3;color:#222;text-decoration:none;margin:6px 0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;flex:1}',
    '.sc39__note{font-size:12px;line-height:1.25;color:#2a7a3f;margin:0 0 6px}',
    '.sc39__p{font-weight:700;font-size:14px;margin-bottom:6px}',
    '.sc39__b{border:0;border-radius:6px;background:#2a9d4a;color:#fff;font-weight:600;font-size:13px;padding:7px 6px;cursor:pointer}',
    '.sc39__b[disabled]{opacity:.7;cursor:default}'
  ].join('\n'));

  function inject() {
    var api = window.scSearchApi;
    if (!api) return;
    [].forEach.call(document.querySelectorAll('.j-cart-additional'), function (anchor) {
      if (!anchor.offsetParent) return;                     // кошик закритий
      var cart = anchor.closest('.cart, .cart__container, #cart') || anchor.parentElement;
      var links = cart.querySelectorAll('.j-cart-product a[href]'), seen = {}, urls = [];
      [].forEach.call(links, function (a) {
        var u = (a.getAttribute('href') || '').replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '');
        if (u && !seen[u]) { seen[u] = 1; urls.push(u); }
      });
      var key = urls.join('|');
      var old = cart.querySelector('.sc39');
      if (old && old.getAttribute('data-key') === key) return;
      api.load(scSafe(39, function () {
        var inCart = urls.map(api.byUrl).filter(Boolean);
        var items = pick(api, inCart);
        var cur = cart.querySelector('.sc39');
        if (cur) cur.remove();
        if (!items.length) return;
        var box = document.createElement('div');
        box.className = 'sc39';
        box.setAttribute('data-key', key);
        box.innerHTML = '<div class="sc39__h">До цього знадобиться</div><div class="sc39__row">' + items.map(function (p) {
          var x = p.it;
          return '<div class="sc39__c">' + (x.i ? '<img src="' + esc(x.i) + '" alt="" loading="lazy">' : '') +
            '<a class="sc39__n" href="' + esc(x.u) + '">' + esc(x.n) + '</a>' + (p.note ? '<div class="sc39__note">' + esc(p.note) + '</div>' : '') + '<div class="sc39__p">' + price(x.p) + '</div>' +
            '<button type="button" class="sc39__b" data-u="' + esc(x.u) + '">До кошика</button></div>';
        }).join('') + '</div>';
        anchor.parentElement.insertBefore(box, anchor);
        ga('sc_upsell_view', { items: items.length, for_category: (inCart[0] || {}).k || '' });
      }));
    });
  }

  document.addEventListener('click', scSafe(39, function (e) {
    var b = e.target.closest && e.target.closest('.sc39__b');
    if (b) {
      e.preventDefault(); e.stopPropagation();
      if (b.disabled) return;
      var u = b.getAttribute('data-u');
      b.disabled = true; b.textContent = 'Додаємо…';
      productId(u).then(function (id) {
        if (!id || typeof window.AjaxCart === 'undefined') throw new Error('no id');
        window.AjaxCart.getInstance().appendProduct({ type: 'product', id: +id }, undefined, true);
        ga('sc_upsell_add', { item_url: u });
        [900, 2200].forEach(function (t) { setTimeout(scSafe(39, inject), t); });   // кошик перемальовується
      })['catch'](function () { location.href = u; });
      return;
    }
    // будь-який клік (Купити, іконка кошика) — кошик може з'явитися/оновитися
    [400, 1200, 2500].forEach(function (t) { setTimeout(scSafe(39, inject), t); });
  }), true);
  scIdle(scSafe(39, inject));   // сторінка /checkout або відкритий кошик після перезавантаження
});


/* =====================================================================
 * 40. «Ваш кошик чекає» — нагадування гостям про незавершене замовлення (10.11.2026)
 *     Лист Хорошопу про покинутий кошик ходить лише зареєстрованим з e-mail (Horoshop Club t/492),
 *     а більшість купує без реєстрації. Кошик Хорошоп зберігає на сервері, тож при поверненні він на місці:
 *     - повернувся на сайт через ≥ 1 год після останнього перегляду з товарами в кошику → плашка внизу
 *       «У кошику 2 товари на 4 350 грн · Оформити замовлення»;
 *     - ПК: курсор пішов за верх вікна (закрити вкладку / перейти) — та сама плашка, раз за сеанс,
 *       не раніше ніж через 20 с на сайті.
 *     Не показуємо на оформленні, сторінці «замовлення отримано» й коли відкрите вікно кошика.
 *     Закрили ✕ — до наступного повернення. GA4: sc_cartrem_view / sc_cartrem_click (why: return | exit).
 * ===================================================================== */
scModule(40, function () {
  'use strict';
  if (/\/checkout/i.test(location.pathname)) return;
  var LS = 'sc40', SS = 'sc40-shown', GAP = 3600e3, EXIT_AFTER = 20e3, t0 = Date.now();

  function ga(ev, p) { try { if (typeof window.gtag === 'function') window.gtag('event', ev, p); } catch (x) {} }
  function get(st, k) { try { return st.getItem(k); } catch (e) { return null; } }
  function set(st, k, v) { try { st.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // стан кошика з шапки й прихованого вікна кошика Хорошопу
  function cart() {
    var q = document.querySelector('.j-basket-quantity, .j-mini-cart-quantity'),        // ПК / мобільна
        s = document.querySelector('.j-basket-total-sum, .j-mini-cart-total');
    var n = q ? parseInt(q.textContent.replace(/\D/g, ''), 10) || 0 : 0;
    if (!n) return null;
    var li = document.querySelector('#cart .j-cart-product');
    var a = li && (li.querySelector('.cart-title a, .cart-item__title a, .order-i-title a') || li.querySelector('a[href^="/"]'));
    var img = li && li.querySelector('img');
    return {
      n: n, sum: s ? scSum(s.textContent) : 0,
      name: a ? a.textContent.replace(/\s+/g, ' ').trim() : '',
      img: img ? img.getAttribute('src') || img.getAttribute('data-src') || '' : ''
    };
  }
  function cartOpen() {
    if (/mm-wrapper_opened|mm-opened/.test(document.documentElement.className + ' ' + document.body.className)) return true;   // мобільне меню/кошик
    var c = document.getElementById('cart');
    return !!(c && c.offsetParent !== null && c.getBoundingClientRect().height > 50);
  }

  var CSS =
    '#sc40{position:fixed;z-index:360;left:50%;bottom:16px;transform:translate(-50%,140%);width:min(460px,calc(100% - 24px));box-sizing:border-box;' +
    'display:flex;align-items:center;gap:12px;padding:12px 40px 12px 12px;background:#fff;border:1px solid #cfe5cf;border-radius:12px;' +
    'box-shadow:0 8px 28px rgba(0,0,0,.16);transition:transform .25s ease;font-size:14px;line-height:1.35;color:#1d2733}' +
    '#sc40.on{transform:translate(-50%,0)}' +
    '#sc40.top{bottom:auto;top:16px;transform:translate(-50%,-140%)}#sc40.top.on{transform:translate(-50%,0)}' +
    '#sc40 img{flex:0 0 52px;width:52px;height:52px;object-fit:contain;border-radius:6px;background:#f6f8f6}' +
    '#sc40 .sc40-t{flex:1;min-width:0}' +
    '#sc40 .sc40-h{font-weight:700;font-size:15px}' +
    '#sc40 .sc40-n{display:block;color:#5f6b78;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}' +
    '#sc40 .sc40-go{display:inline-block;margin-top:7px;padding:7px 14px;border-radius:8px;background:#2a9d4a;color:#fff;font-weight:600;text-decoration:none}' +
    '#sc40 .sc40-go:hover{background:#1f7a39;color:#fff}' +
    '#sc40 .sc40-x{position:absolute;top:6px;right:6px;width:30px;height:30px;border:0;background:none;font-size:20px;line-height:30px;color:#8a95a1;cursor:pointer;padding:0}';

  function show(why) {
    var c = cart();
    if (!c || document.getElementById('sc40') || cartOpen() || get(sessionStorage, SS)) return;
    set(sessionStorage, SS, why);
    scStyle('sc40-css', CSS);
    var box = document.createElement('div');
    box.id = 'sc40';
    if (why === 'exit') box.className = 'top';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Ваш кошик');
    var goods = c.n + ' ' + (c.n % 10 === 1 && c.n % 100 !== 11 ? 'товар' : c.n % 10 >= 2 && c.n % 10 <= 4 && (c.n % 100 < 10 || c.n % 100 >= 20) ? 'товари' : 'товарів');
    box.innerHTML = (c.img ? '<img src="' + esc(c.img) + '" alt="">' : '') +
      '<div class="sc40-t"><div class="sc40-h">' + (why === 'exit' ? 'Не забудьте про кошик' : 'Ваш кошик чекає') + '</div>' +
      '<span class="sc40-n">' + goods + (c.sum ? ' на ' + Math.round(c.sum).toLocaleString('uk-UA') + ' грн' : '') +
      (c.name ? ' · ' + esc(c.name) : '') + '</span>' +
      '<a class="sc40-go" href="' + SC_LANG + '/checkout/">Оформити замовлення →</a></div>' +
      '<button type="button" class="sc40-x" aria-label="Закрити">×</button>';
    box.querySelector('.sc40-x').addEventListener('click', function () { box.classList.remove('on'); setTimeout(function () { box.remove(); }, 300); });
    box.querySelector('.sc40-go').addEventListener('click', function () { ga('sc_cartrem_click', { why: why, items: c.n, value: c.sum }); });
    document.body.appendChild(box);
    // над смугою cookie і закріпленою «Купити» (блоки 13, 18), щоб не перекривали
    var lift = scSafe(40, function () {
      if (!box.isConnected) return clearInterval(iv);
      if (box.classList.contains('top')) return;
      var h = 0;
      ['#cookies-modal.is-visible .modal__box', '#cookies-panel', '#sc-sticky.on'].forEach(function (s) {
        var el = document.querySelector(s), r = el && getComputedStyle(el).visibility !== 'hidden' ? el.getBoundingClientRect() : null;   // fixed: offsetParent = null
        if (r && r.height && r.bottom >= window.innerHeight - 2) h = Math.max(h, window.innerHeight - r.top);
      });
      var b = (h ? Math.round(h) + 10 : 16) + 'px';
      if (box.style.bottom !== b) box.style.bottom = b;
    });
    var iv = setInterval(lift, 700);
    lift();
    setTimeout(function () { box.classList.add('on'); }, 30);
    ga('sc_cartrem_view', { why: why, items: c.n, value: c.sum, non_interaction: true });
  }

  function start() {
    if (/checkout.*complete|complete.*order/i.test(location.pathname)) { set(localStorage, LS, ''); return; }
    var prev = parseInt(get(localStorage, LS), 10) || 0;
    var c = cart();
    set(localStorage, LS, c ? String(Date.now()) : '');            // останній перегляд із товарами в кошику
    if (c && prev && Date.now() - prev >= GAP) setTimeout(scSafe(40, function () { show('return'); }), 2500);

    // ПК: курсор вийшов за верх вікна
    if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      document.addEventListener('mouseout', scSafe(40, function (e) {
        if (e.relatedTarget || e.clientY > 0 || Date.now() - t0 < EXIT_AFTER) return;
        show('exit');
      }));
    }
    // кошик змінився на цій сторінці — оновлюємо мітку часу
    document.addEventListener('click', function () {
      setTimeout(function () { if (cart()) set(localStorage, LS, String(Date.now())); }, 2500);
    }, true);
  }
  scIdle(scSafe(40, start));
});

/* =====================================================================
 * 20. Сторож: чи на місці опорні елементи верстки Хорошопа
 *     Хорошоп змінив шаблон — блоки мовчки перестають з'являтися. Раз за перегляд, через ~5 с після
 *     завантаження (сторінка дорисована), перевіряємо те, без чого блоки не працюють, і надсилаємо звіт
 *     через scHealth. Без спостерігачів за DOM. Те, що блок підбору не показався, — НЕ проблема
 *     (на більшості товарів так і має бути). Власні помилки — мовчки, без scErr.
 * ===================================================================== */
function scHealthCheck() {
  try {
    var miss = [], q = function (s) { return document.querySelector(s); };
    var path = location.pathname;
    if (q('[itemtype*="schema.org/Product"]')) {
      if (!SC_ORDER_SELS.some(function (s) { return q(s); })) miss.push('блок «Купити» (SC_ORDER_SELS)');
      if (!q('h1')) miss.push('h1');
      if (!q('[itemprop="availability"]')) miss.push('[itemprop="availability"]');
      if (miss.length) scHealth('перевірка: картка товару', 'не знайдено: ' + miss.join(', '));
    } else if (path.indexOf('/checkout') !== -1 && !/checkout.*complete|complete.*order/i.test(path)) {
      if (!q('#checkout-container')) miss.push('#checkout-container');
      if (!q('.j-total-sum')) miss.push('.j-total-sum');
      if (!q('[name="Recipient[delivery_city]"]')) miss.push('поле міста [name="Recipient[delivery_city]"]');
      if (miss.length) scHealth('перевірка: оформлення', 'не знайдено: ' + miss.join(', '));
    }
  } catch (x) {}
}
(function () {
  try {
    if (!(window.SC_HEALTH_URL_TEST || SC_HEALTH_URL)) return;
    var run = function () { setTimeout(function () { scIdle(scHealthCheck); }, 5000); };
    if (document.readyState === 'complete') run();
    else window.addEventListener('load', run);
  } catch (x) {}
})();
