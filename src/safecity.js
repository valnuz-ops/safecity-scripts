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
  function go() {
    if (done) return; done = true;
    window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll);
    if (io) io.disconnect();
    fn();
  }
  function check() {
    t = 0;
    if (done || !el.isConnected) return;
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
  var TTL = 3600 * 1000, mem = {}, MAXC = 2, active = 0, queue = [], holdUntil = 0;
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
    if (wait > 0) { setTimeout(pump, wait + 50); return; }
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
          if (i !== -1 && html.length > i + 200) { try { ctrl && ctrl.abort(); reader.cancel(); } catch (e) {} return html; }
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
        readHead(url).then(function (html) {
          var res = parse(html);
          if (res) write(url, res);
          resolve(res);
        }).catch(function () { resolve(null); }).then(function () { active--; pump(); });
      });
      pump();
    }));
  };
})();

// Характеристики товару: десктопна таблиця або будь-які пари «назва — значення» (мобільна версія)
function scFeatures() {
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

// Куди ставити блоки підказок: після блоку з кнопкою «Купити» (десктоп і мобільна версія)
function scAnchor() {
  if (!document.querySelector('[itemtype*="schema.org/Product"]')) return null;
  var sels = ['.product__section--order', '.product-card--main .product-card__order-box',
              '.product__section--price', '.product-card--main .product-card__price-box'];
  for (var i = 0; i < sels.length; i++) {
    var el = document.querySelector(sels[i]);
    if (el && el.parentNode) return el;
  }
  return null;
}


/* =====================================================================
 * 1. Плашка відправки на картці товару
 * ===================================================================== */
(function () {
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
    targetSelectors: [
      '.product__section--order',
      '.product-card--main .product-card__order-box',
      '.product__section--price',
      '.product-card--main .product-card__price-box'
    ],
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

  function getNow() {
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: CONFIG.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
    }).formatToParts(new Date());
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

  function render(box) {
    var t = buildText();
    box.innerHTML =
      '<span class="ship-info__icon" aria-hidden="true">🚚</span> ' +
      '<strong>' + t.main + '</strong>' +
      t.lines.map(function (l) {
        return '<div class="ship-info__sub">' + l + '</div>';
      }).join('');
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

  function addStyle() {
    if (document.getElementById('ship-info-style')) return;
    var style = document.createElement('style');
    style.id = 'ship-info-style';
    style.textContent =
      '#ship-info{box-sizing:border-box;width:100%;flex:0 0 100%;clear:both;margin:12px 0;padding:10px 14px;border-radius:8px;' +
      'background:#f1f8f1;border:1px solid #cfe5cf;font-size:15px;line-height:1.4}' +
      '#ship-info .ship-info__sub{font-size:13px;color:#555;margin-top:2px}';
    document.head.appendChild(style);
  }

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

    addStyle();
    var box = document.createElement('div');
    box.id = 'ship-info';
    render(box);
    target.el.insertAdjacentElement(target.pos, box);
  }

  function init() {
    mount();

    var timer;
    new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(mount, 200);
    }).observe(document.body, { childList: true, subtree: true });

    setInterval(function () {
      if (shouldHide()) { removeBox(); return; }
      var box = document.getElementById('ship-info');
      if (box) render(box);
      else mount();
    }, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


/* =====================================================================
 * 2. Картка ДБЖ для роутера без БП у комплекті → пропонуємо БП 12 В 2/3 А
 * ===================================================================== */
(function () {
  'use strict';

  var CFG = {
    picks: [
      { url: '/blok-zhyvlennia-krf-1202ps-kraft-12v-2a/', note: '2 А — для більшості роутерів' },
      { url: '/blok-zhyvlennia-krf-1203ps-kraft-12v-3a/', note: '3 А — із запасом: живить роутер і заряджає ДБЖ одночасно' }
    ],
    allUrl: '/bloky-zhyvlennia-12-24-48v/filter/presence=1;tipVikonannja=6;vixdnaNapruga=1;vixdniyStrum=8,11/'
  };

  var CSS =
    '#sc-psu{margin:16px 0 0;padding:14px 16px;border:1px solid #f0d58a;border-radius:10px;background:#fffbea;font-size:14px;line-height:1.4}' +
    '#sc-psu .sc-psu__title{font-weight:700;font-size:15px;margin:0 0 4px}' +
    '#sc-psu .sc-psu__text{color:#555;margin:0 0 10px;font-size:13px}' +
    '#sc-psu .sc-psu__list{display:flex;flex-direction:column;gap:8px}' +
    '#sc-psu a.sc-psu__item{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid #e8dcb0;border-radius:8px;background:#fff;color:#1a1a1a;text-decoration:none;transition:border-color .15s}' +
    '#sc-psu a.sc-psu__item:hover{border-color:#2b7de9}' +
    '#sc-psu .sc-psu__img{flex:0 0 48px;width:48px;height:48px;object-fit:contain}' +
    '#sc-psu .sc-psu__info{flex:1;min-width:0}' +
    '#sc-psu .sc-psu__name{font-size:13px;line-height:1.3;display:block}' +
    '#sc-psu .sc-psu__note{font-size:12px;color:#7a828c;display:block;margin-top:2px}' +
    '#sc-psu .sc-psu__price{flex:0 0 auto;font-weight:700;white-space:nowrap}' +
    '#sc-psu a.sc-psu__all{display:inline-block;margin-top:10px;font-size:13px;color:#2b7de9;text-decoration:none}' +
    '#sc-psu a.sc-psu__all:hover{text-decoration:underline}';

  var langPrefix = /^\/(ru|en)\//.test(location.pathname) ? '/' + location.pathname.split('/')[1] : '';

  function addStyle() {
    if (document.getElementById('sc-psu-style')) return;
    var s = document.createElement('style');
    s.id = 'sc-psu-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var features = scFeatures, get = scGet;

  function needsPsu() {
    var f = features();
    var type = get(f, /^тип (пристрою|устройства)$/);
    if (!/безперебійн|бесперебойн/i.test(type)) return false;

    var vin = get(f, /^вхідна напруга$|^входное напряжение$/);
    if (!/dc|12\s?(в|v)/i.test(vin) || /220|230|240/.test(vin)) return false;

    var title = ((document.querySelector('h1') || {}).textContent || '');
    if (/з блоком живлення|с блоком питания/i.test(title)) return false;

    var desc = scDesc();
    var kit = (desc.match(/Комплектаці[^.]{0,200}/i) || [''])[0];
    if (/блок живлення (не входить|окремо)|без блока живлення|блок питания не входит/i.test(desc)) return true;
    if (/блок живлення|блок питания|адаптер/i.test(kit)) return false;
    return true;
  }

  function loadProduct(pick) {
    var u = langPrefix + pick.url;
    return scProduct(u).then(function (p) {
      if (!p || /немає|нет в наличии/i.test(p.avail)) return null;
      return { url: u, name: p.name, price: p.price, img: p.img, note: pick.note };
    });
  }

  function init() {
    if (document.getElementById('sc-psu')) return;
    var anchor = scAnchor();
    if (!anchor || !needsPsu()) return;

    addStyle();
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
      items.filter(Boolean).forEach(function (p) {
        var a = document.createElement('a');
        a.className = 'sc-psu__item';
        a.href = p.url;
        a.innerHTML =
          (p.img ? '<img class="sc-psu__img" loading="lazy" alt="">' : '') +
          '<span class="sc-psu__info"><span class="sc-psu__name"></span><span class="sc-psu__note"></span></span>' +
          '<span class="sc-psu__price"></span>';
        if (p.img) a.querySelector('img').src = p.img;
        a.querySelector('.sc-psu__name').textContent = p.name;
        a.querySelector('.sc-psu__note').textContent = p.note;
        a.querySelector('.sc-psu__price').textContent = p.price;
        list.appendChild(a);
      });
      if (!list.children.length) list.remove();
    }); });
  }

  scIdle(function () { init(); setTimeout(init, 2000); });
})();


/* =====================================================================
 * 3. Картки інверторів і ДБЖ 12-24V → підбір АКБ
 * ===================================================================== */
(function () {
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

  var CSS =
    '#sc-akb{margin:16px 0 0;padding:14px 16px;border:1px solid #f0d58a;border-radius:10px;background:#fffbea;font-size:14px;line-height:1.4}' +
    '#sc-akb .sc-akb__title{font-weight:700;font-size:15px;margin:0 0 4px}' +
    '#sc-akb .sc-akb__text{color:#555;margin:0 0 10px;font-size:13px}' +
    '#sc-akb .sc-akb__list{display:flex;flex-direction:column;gap:8px}' +
    '#sc-akb a.sc-akb__item{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid #e8dcb0;border-radius:8px;background:#fff;color:#1a1a1a;text-decoration:none;transition:border-color .15s}' +
    '#sc-akb a.sc-akb__item:hover{border-color:#2b7de9}' +
    '#sc-akb .sc-akb__img{flex:0 0 48px;width:48px;height:48px;object-fit:contain}' +
    '#sc-akb .sc-akb__info{flex:1;min-width:0}' +
    '#sc-akb .sc-akb__name{font-size:13px;line-height:1.3;display:block}' +
    '#sc-akb .sc-akb__note{font-size:12px;color:#7a828c;display:block;margin-top:2px}' +
    '#sc-akb .sc-akb__price{flex:0 0 auto;font-weight:700;white-space:nowrap}' +
    '#sc-akb .sc-akb__links{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:10px}' +
    '#sc-akb .sc-akb__links a{font-size:13px;color:#2b7de9;text-decoration:none}' +
    '#sc-akb .sc-akb__links a:hover{text-decoration:underline}';

  var langPrefix = /^\/(ru|en)\//.test(location.pathname) ? '/' + location.pathname.split('/')[1] : '';

  function addStyle() {
    if (document.getElementById('sc-akb-style')) return;
    var s = document.createElement('style');
    s.id = 'sc-akb-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var features = scFeatures, get = scGet;

  function detect() {
    var f = features();
    var type = get(f, /^тип (пристрою|устройства)$/);
    var title = ((document.querySelector('h1') || {}).textContent || '');
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

  function loadProduct(pick) {
    var u = langPrefix + pick.url;
    return scProduct(u).then(function (p) {
      if (!p || !scInStock(p.avail)) return null;
      return { url: u, name: p.name, price: p.price, img: p.img, note: pick.note || '' };
    });
  }

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

    addStyle();
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
      items.forEach(function (p) {
        var a = document.createElement('a');
        a.className = 'sc-akb__item'; a.href = p.url;
        a.innerHTML = (p.img ? '<img class="sc-akb__img" loading="lazy" alt="">' : '') +
          '<span class="sc-akb__info"><span class="sc-akb__name"></span><span class="sc-akb__note"></span></span>' +
          '<span class="sc-akb__price"></span>';
        if (p.img) a.querySelector('img').src = p.img;
        a.querySelector('.sc-akb__name').textContent = p.name;
        a.querySelector('.sc-akb__note').textContent = p.note;
        a.querySelector('.sc-akb__price').textContent = p.price;
        listEl.appendChild(a);
      });
      if (!listEl.children.length) listEl.remove();
      // Для калькулятора автономності (блок 8): ті самі сумісні АКБ у наявності
      if (cfg.slot !== undefined) {
        window.scAkb = { items: items, slot: cfg.slot, lfp: cfg.lfp };
        document.dispatchEvent(new CustomEvent('sc-akb'));
      }
    }); });
  }

  scIdle(function () { init(); setTimeout(init, 2000); });
})();


/* =====================================================================
 * 4. Сторінка «Ваше замовлення отримано» → кнопка підтвердження в Telegram
 * ===================================================================== */
(function () {
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
    var obs = new MutationObserver(function () { if (inject()) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();


/* =====================================================================
 * 5. Кошик і оформлення → прогрес до безкоштовної доставки (від 3000 грн)
 * ===================================================================== */
(function () {
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

  function parseSum(text) {
    var m = String(text).replace(/[\s\u00a0]/g, '').match(/\d+(?:[.,]\d+)?/);
    return m ? parseFloat(m[0].replace(',', '.')) : 0;
  }

  function fmt(n) {
    return Math.ceil(n).toLocaleString('uk-UA');
  }

  function addStyle() {
    if (document.getElementById('free-ship-style')) return;
    var c = CONFIG.colors;
    var style = document.createElement('style');
    style.id = 'free-ship-style';
    style.textContent =
      '#free-ship{box-sizing:border-box;margin:12px 0;padding:10px 14px;border-radius:8px;' +
      'background:' + c.bg + ';border:1px solid ' + c.border + ';font-size:15px;line-height:1.4}' +
      '#free-ship .free-ship__track{height:8px;margin-top:8px;border-radius:4px;' +
      'background:' + c.track + ';overflow:hidden}' +
      '#free-ship .free-ship__bar{height:100%;border-radius:4px;background:' + c.bar + ';' +
      'transition:width .3s ease}';
    document.head.appendChild(style);
  }

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

    addStyle();
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
    update();

    // Корзина перерисовывается через AJAX (иногда целиком), поэтому следим за всей страницей.
    // update() ничего не меняет, если текст блока не изменился - зацикливания нет.
    var timer;
    new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(update, 150);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


/* =====================================================================
 * 6. Картка відеокамери → «Підберіть до цієї камери» (реєстратори TVT)
 * ===================================================================== */
(function () {
  'use strict';

  var CFG = {
    nvrCat: '/videoreiestratory/',
    nvrTypeIP: [47],               // NVR-відеореєстратор
    nvrTypeAnalog: [66],           // MHD-відеореєстратор
    tvt: 101, ajax: 96,
    // [кількість каналів, ID значення фільтра «Кількість каналів IP»]
    channels:     [[4, 5], [8, 1], [16, 2], [32, 4]],
    channelsAjax: [[8, 1], [16, 2]],
    switches: '/poe-prystroi/2364/',
    psu: '/bloky-zhyvlennia-12-24-48v/', psu12: 1,
    utp: '/kabel-vyta-para/2348/',
    coax: '/koaksialnyi-kabel/',
    connectors: '/kabeli-i-roziemy/',
    storage: '/nakopychuvachi/2297/', sd: 151
  };

  var CSS =
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

  var langPrefix = /^\/(ru|en)\//.test(location.pathname) ? '/' + location.pathname.split('/')[1] : '';

  function addStyle() {
    if (document.getElementById('sc-kit-style')) return;
    var s = document.createElement('style');
    s.id = 'sc-kit-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  // Хорошоп: /cat/filter/a=1,2;b=3/ — параметри за алфавітом
  function url(cat, params) {
    params = params || {};
    var keys = Object.keys(params).sort();
    var path = langPrefix + cat;
    if (!keys.length) return path;
    return path + 'filter/' + keys.map(function (k) {
      return k + '=' + [].concat(params[k]).sort(function (a, b) { return a - b; }).join(',');
    }).join(';') + '/';
  }

  function init() {
    if (document.getElementById('sc-cam')) return;
    var anchor = scAnchor();
    if (!anchor) return;

    var f = scFeatures();
    var type = scGet(f, /^тип (пристрою|устройства)$/);
    if (!/відеокамер|видеокамер/i.test(type) || /web/i.test(type)) return;

    var title    = ((document.querySelector('h1') || {}).textContent || '');
    var isAnalog = /hdtvi|hdcvi|ahd|mhd|аналог/i.test(type);
    var poe      = /так|да|yes/i.test(scGet(f, /^poe$/));
    var power    = scGet(f, /^(живлення|питание)$/);
    var wireless = /бездрот|беспровод|wi-?fi/i.test(scGet(f, /^(підключення|подключение)$/));
    var hasSD    = /sd|карт/i.test(scGet(f, /^карта пам/));
    var isAjax   = /ajax/i.test(title);

    addStyle();
    var box = document.createElement('div');
    box.id = 'sc-cam'; box.className = 'sc-kit';
    box.innerHTML = '<div class="sc-kit__title">Підберіть до цієї камери</div>';

    function row(label, hint) {
      var r = document.createElement('div');
      r.className = 'sc-kit__row';
      r.innerHTML = '<div class="sc-kit__label"></div>' + (hint ? '<div class="sc-kit__hint"></div>' : '');
      r.querySelector('.sc-kit__label').textContent = label;
      if (hint) r.querySelector('.sc-kit__hint').textContent = hint;
      box.appendChild(r);
      return r;
    }
    function chip(r, text, href) {
      var a = document.createElement('a');
      a.className = 'sc-chip'; a.href = href; a.textContent = text;
      r.appendChild(a);
      return a;
    }

    // 1. Відеореєстратор
    if (isAnalog) {
      var ar = row('Відеореєстратор', 'MHD-реєстратори TVT працюють з аналоговими HD-камерами');
      chip(ar, 'Реєстратори TVT →', url(CFG.nvrCat, { brand: CFG.tvt, tipPristrou: CFG.nvrTypeAnalog }));
    } else {
      var nr = row('Відеореєстратор', isAjax
        ? 'Для камер Ajax — реєстратори Ajax NVR. Оберіть кількість камер:'
        : 'Реєстратори TVT. Скільки камер плануєте підключити?');
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
          var p = isAjax ? { brand: CFG.ajax } : { brand: CFG.tvt, tipPristrou: CFG.nvrTypeIP };
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

    // 4. Карта пам'яті (якщо в камері є слот)
    if (hasSD) {
      var sr = row('Запис на камеру', 'Камера може писати на microSD без реєстратора');
      chip(sr, 'Карти пам’яті →', url(CFG.storage, { tipPristrou: CFG.sd }));
    }

    anchor.parentNode.insertBefore(box, anchor.nextSibling);
  }

  scIdle(function () { init(); setTimeout(init, 2000); });
})();


/* =====================================================================
 * 7. Картка відеореєстратора → «Підберіть до цього реєстратора» (камери TVT)
 * ===================================================================== */
(function () {
  'use strict';

  var CFG = {
    cams: '/videokamery/',
    tvt: 101, ajax: 96,
    ipCam: 50, ptz: 68,
    // групи роздільної здатності камер: [назва, макс. Мп, ID значень фільтра]
    res: [['4 Мп', 4, [3, 5]], ['5–6 Мп', 6, [1, 7, 9, 14]], ['8 Мп', 8, [2, 13]]],
    switches: '/poe-prystroi/2364/',
    utp: '/kabel-vyta-para/2348/',
    connectors: '/kabeli-i-roziemy/'
  };

  var langPrefix = /^\/(ru|en)\//.test(location.pathname) ? '/' + location.pathname.split('/')[1] : '';

  // Стилі спільні з блоком 6 (.sc-kit)
  var CSS =
    '.sc-kit{margin:16px 0 0;padding:14px 16px;border:1px solid #e3e6ea;border-radius:10px;background:#fafbfc;font-size:14px;line-height:1.4}' +
    '.sc-kit__title{font-weight:700;font-size:15px;margin:0 0 10px}' +
    '.sc-kit__row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:8px 0;border-top:1px dashed #e3e6ea}' +
    '.sc-kit__row:first-of-type{border-top:0;padding-top:0}' +
    '.sc-kit__label{flex:0 0 100%;font-weight:600;color:#333}' +
    '.sc-kit__hint{flex:0 0 100%;font-size:12px;color:#7a828c;margin-top:-2px}' +
    '.sc-kit a.sc-chip{display:inline-flex;align-items:center;padding:5px 11px;border:1px solid #cfd5dc;border-radius:16px;background:#fff;color:#1a1a1a;text-decoration:none;white-space:nowrap;transition:border-color .15s,background .15s}' +
    '.sc-kit a.sc-chip:hover{border-color:#2b7de9;background:#f0f6ff}';

  function addStyle() {
    if (document.getElementById('sc-kit-style')) return;
    var s = document.createElement('style');
    s.id = 'sc-kit-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function url(cat, params) {
    params = params || {};
    var keys = Object.keys(params).sort();
    var path = langPrefix + cat;
    if (!keys.length) return path;
    return path + 'filter/' + keys.map(function (k) {
      return k + '=' + [].concat(params[k]).sort(function (a, b) { return a - b; }).join(',');
    }).join(';') + '/';
  }
  function num(s) { var m = String(s).match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; }

  function init() {
    if (document.getElementById('sc-nvr')) return;
    var anchor = scAnchor();
    if (!anchor) return;

    var f = scFeatures();
    var title = ((document.querySelector('h1') || {}).textContent || '').trim();
    var type = scGet(f, /^тип (пристрою|устройства)$/) || title;   // у кількох карток характеристики не заповнені
    if (!/реєстратор|регистратор/i.test(type) || /нагрудн|автомоб|кабель|живлення/i.test(type)) return;

    var format = scGet(f, /^формат відеореєстратора$/);
    var isIP = /^ip$/i.test(format) || /nvr/i.test(type) || /^(ip-|мережев)/i.test(title) || /nvr|ds-7[6-9]\d\d/i.test(title);
    var isAjax = /ajax/i.test(title);
    var ipCh = num(scGet(f, /^кількість каналів ip$/)) || (isIP ? num((title.match(/(\d+)-канальн/) || [])[1]) : 0);
    var recMp = num(scGet(f, /^роздільна здатність запису$/)) || num((title.match(/(\d+)\s?mp/i) || [])[1]);
    var poe = /так|да|yes/i.test(scGet(f, /^poe$/)) || /poe/i.test(title);
    var poePorts = num(scGet(f, /^кількість poe-портів$/));

    if (!isAjax && !isIP && !ipCh) return;   // аналогові без IP-каналів — камер TVT для них немає

    addStyle();
    var box = document.createElement('div');
    box.id = 'sc-nvr'; box.className = 'sc-kit';
    box.innerHTML = '<div class="sc-kit__title">Підберіть до цього реєстратора</div>';

    function row(label, hint) {
      var r = document.createElement('div');
      r.className = 'sc-kit__row';
      r.innerHTML = '<div class="sc-kit__label"></div>' + (hint ? '<div class="sc-kit__hint"></div>' : '');
      r.querySelector('.sc-kit__label').textContent = label;
      if (hint) r.querySelector('.sc-kit__hint').textContent = hint;
      box.appendChild(r);
      return r;
    }
    function chip(r, text, href) {
      var a = document.createElement('a');
      a.className = 'sc-chip'; a.href = href; a.textContent = text;
      r.appendChild(a);
    }

    // 1. Камери
    if (isAjax) {
      var ar = row('Камери', 'Для Ajax NVR — камери Ajax');
      chip(ar, 'Камери Ajax →', url(CFG.cams, { brand: CFG.ajax, presence: 1 }));
    } else {
      var hint = isIP
        ? (ipCh ? 'До ' + ipCh + ' IP-камер' : 'Мережевий реєстратор') + (recMp ? ' · запис до ' + recMp + ' Мп' : '')
        : 'Гібридний: можна додати до ' + ipCh + ' IP-камер';
      var cr = row('IP-камери TVT', hint);
      CFG.res.forEach(function (g) {
        if (recMp && g[1] > recMp) return;          // реєстратор не запише таку роздільну здатність
        chip(cr, g[0], url(CFG.cams, { brand: CFG.tvt, presence: 1, rozdlnaZdatnstKameri: g[2], tipPristrou: CFG.ipCam }));
      });
      chip(cr, 'Поворотні PTZ', url(CFG.cams, { brand: CFG.tvt, presence: 1, tipPristrou: CFG.ptz }));
      chip(cr, 'Усі камери TVT →', url(CFG.cams, { brand: CFG.tvt, presence: 1, tipPristrou: [CFG.ipCam, CFG.ptz] }));
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

  scIdle(function () { init(); setTimeout(init, 2000); });
})();


/* =====================================================================
 * 8. Картки зарядних станцій, систем накопичення і ДБЖ 12 В → калькулятор автономності
 *    Коефіцієнти — як у текстах описів:
 *    станції ×0.85, системи накопичення ×0.9×0.9 = 0.81, ДБЖ 12 В — А·год ÷ А без втрат
 * ===================================================================== */
(function () {
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

  function num(s) { var m = String(s || '').replace(',', '.').match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; }
  function watts(s) { var v = num(s); return /к(Вт|ВА)/i.test(s) ? v * 1000 : v; }

  function detect() {
    var f = scFeatures(), get = scGet;
    var type = get(f, /^тип (пристрою|устройства)$/);
    var title = ((document.querySelector('h1') || {}).textContent || '');

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

  function init() {
    if (document.getElementById('sc-calc')) return;
    if (!document.querySelector('[itemtype*="schema.org/Product"]')) return;
    var cfg = detect();
    if (!cfg) return;
    if (cfg.mode === 'ah') {
      var bats = batteries();
      if (!bats) { document.addEventListener('sc-akb', init, { once: true }); return; }
      if (!bats.length) return;
      cfg.bats = bats;
    }
    if (!document.getElementById('sc-calc-style')) {
      var s = document.createElement('style'); s.id = 'sc-calc-style'; s.textContent = CSS; document.head.appendChild(s);
    }
    place(build(cfg, cfg.bats || []));
  }

  scIdle(function () { init(); setTimeout(init, 2000); });
})();


/* =====================================================================
 * 9. Ajax: сумісність хабів і пристроїв
 *    На картці хаба / стартового комплекту → сумісні датчики і пристрої
 *    На картці пристрою → з якими хабами працює + хаби в наявності
 *    Дані: таблиця сумісності ajax.systems/ua/tools/devices-compatibility (жовтень 2026)
 *    Класи: B — усі хаби; P — крім Hub (2G); G — лише Hub 2 / Hub 2 Plus / Hub BP;
 *           C — як G, а через ретранслятор лише ReX 2
 * ===================================================================== */
(function () {
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
    { k: 'curtainout', re: /(?<!Dual)Curtain Outdoor/i,       cls: 'G', url: U('/datchyk-shtora-ajax-curtain-outdoor-jeweller-white/') },
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

  var langPrefix = /^\/(ru|en)\//.test(location.pathname) ? '/' + location.pathname.split('/')[1] : '';

  function title() { return ((document.querySelector('h1') || {}).textContent || '').replace(/\s+/g, ' ').trim(); }

  // Не показуємо на аксесуарах і товарах, яким хаб не потрібен
  var SKIP = /Smartbracket|DummyBox|муляж|кріпильна|кронштейн|корпус|Case\b|JunctionBox|Holder|тримач|Hood|навіс|PSU|блок живлення|Акумулятор Ajax|Батарея CR|ExternalAntenna|антена|EN54|відеокамера|IP-відео|NVR|відеореєстратор|DoorBell|підписка|передплата|Frame|рамка|Cover|панель|SoloButton|SideButton|CenterButton|Bypass|ocBridge|uartBridge|SpaceControl S\b/i;

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
        var a = document.createElement('a');
        a.className = 'sca-i'; a.href = p.url;
        a.innerHTML = (p.img ? '<img class="sca-img" loading="lazy" alt="">' : '') + '<span class="sca-n"></span><span class="sca-p"></span>';
        if (p.img) a.querySelector('img').src = p.img;
        a.querySelector('.sca-n').textContent = p.name;
        a.querySelector('.sca-p').textContent = p.price;
        listEl.appendChild(a);
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
    if (!document.getElementById('sc-ajax-style')) {
      var s = document.createElement('style'); s.id = 'sc-ajax-style'; s.textContent = CSS; document.head.appendChild(s);
    }
    anchor.parentNode.insertBefore(build(cfg), anchor.nextSibling);
  }

  scIdle(function () { init(); setTimeout(init, 2000); });
})();


/* =====================================================================
 * 10. Оформлення замовлення: АКБ → вантажне відділення, підказки до оплати,
 *     термін відправки (як у плашці на картці, блок 1)
 * ===================================================================== */
(function () {
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
    var m = t && String(t.textContent).replace(/[\s\u00a0]/g, '').match(/\d+(?:[.,]\d+)?/);
    return m ? parseFloat(m[0].replace(',', '.')) : 0;
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
  function form() { return document.getElementById('checkout-container') || document; }
  function sel(q) { return form().querySelector(q); }
  function shown(s) {                          // select прихований плагіном — дивимося на його обгортку
    var box = s && s.parentElement;
    return !!(box && box.offsetParent !== null);
  }
  function optText(s) { return s && s.selectedIndex >= 0 ? s.options[s.selectedIndex].textContent.trim() : ''; }

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
    var foot = document.querySelector('#checkout-container .checkout-footer');
    if (!foot) {
      var btn = [].filter.call(document.querySelectorAll('#checkout-container button'), function (x) {
        return x.offsetParent !== null && /оформити|підтвердити/i.test(x.textContent);
      })[0];
      foot = btn && (btn.closest('.form-item') || btn);
    }
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
    var ship = document.getElementById('sc-co-ship');
    var btn = [].filter.call(document.querySelectorAll('#checkout-container button'), function (x) {
      return x.offsetParent !== null && /оформити|підтвердити/i.test(x.textContent);
    })[0];
    var foot = btn && (btn.closest('.form-item') || btn);
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
    if (!document.getElementById('sc-co-style')) {
      var s = document.createElement('style'); s.id = 'sc-co-style'; s.textContent = CSS; document.head.appendChild(s);
    }
    tick();
    // Поля оформлення — плагін selectboxit, події change ненадійні; перевіряємо стан щосекунди
    setInterval(tick, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();


/* =====================================================================
 * 11. Оформлення замовлення → орієнтовна вартість доставки Новою поштою з Києва
 *     Тарифи «Посилки до 30 кг» (між відділеннями, за кожне місце), жовтень 2026
 * ===================================================================== */
(function () {
  'use strict';
  if (location.pathname.indexOf('/checkout') === -1) return;

  var CFG = {
    defaultKg: 1,                 // вага товару, якщо в характеристиках немає «Вага»
    maxKg: 30,                    // більше — «вартість уточнимо»
    freeFrom: 3000,               // від цієї суми доставка безкоштовна (блок 5)
    local: [[2, 70], [10, 115], [30, 180]],     // Київ → Київ
    ukraine: [[2, 90], [10, 135], [30, 200]],   // Київ → інші міста
    village: 30,                  // доставка в селище / село
    postomat: 10,                 // доставка в поштомат
    courier: 60,                  // адресна доставка кур'єром (тарифи НП 2026: +60 грн до тарифу відділення)
    insFree: 500, insPct: 0.005,  // оголошена вартість: до 500 грн включно — без доплати, далі 0,5%
    extra: 15,                    // службова надбавка (не показується окремо)
    roundTo: 5
  };

  /* ---- вага товару з картки (кеш у браузері на 7 днів) ---- */
  var wMem = {};
  function parseKg(s) {
    var m = String(s).replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(кг|kg|г|g)(?![a-zа-яіїєґ])/i);
    if (!m) return 0;
    var v = parseFloat(m[1]);
    return /^(г|g)$/i.test(m[2]) ? v / 1000 : v;
  }
  function weightOf(url) {
    if (wMem[url]) return wMem[url];
    try {
      var c = JSON.parse(localStorage.getItem('scw:' + url));
      if (c && Date.now() - c.t < 7 * 86400000) return (wMem[url] = Promise.resolve(c.kg));
    } catch (e) {}
    return (wMem[url] = fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (html) {
      var d = new DOMParser().parseFromString(html, 'text/html'), kg = 0;
      [].some.call(d.querySelectorAll('tr'), function (tr) {
        if (tr.children.length === 2 && /^\s*вага\s*$/i.test(tr.children[0].textContent)) { kg = parseKg(tr.children[1].textContent); return kg > 0; }
        return false;
      });
      try { localStorage.setItem('scw:' + url, JSON.stringify({ t: Date.now(), kg: kg })); } catch (e) {}
      return kg;
    }).catch(function () { return 0; }));
  }

  function form() { return document.getElementById('checkout-container') || document; }
  function optText(s) { return s && s.selectedIndex >= 0 ? s.options[s.selectedIndex].textContent.trim() : ''; }
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
    var m = t && String(t.textContent).replace(/[\s ]/g, '').match(/\d+(?:[.,]\d+)?/);
    return m ? parseFloat(m[0].replace(',', '.')) : 0;
  }
  function tier(table, kg) { for (var i = 0; i < table.length; i++) if (kg <= table[i][0]) return table[i][1]; return 0; }

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
      var price = tier(local ? CFG.local : CFG.ukraine, kg);
      if (!local && /^(с\.|смт|сел\.|с-ще|селище)/i.test(city)) price += CFG.village;
      var courier = /кур/i.test(typeText);
      if (courier) price += CFG.courier;
      else if (/поштомат/i.test(typeText) || /поштомат/i.test(whText)) price += CFG.postomat;
      if (sum > CFG.insFree) price += sum * CFG.insPct;
      price += CFG.extra;
      price = Math.round(price / CFG.roundTo) * CFG.roundTo;   // до найближчих 5 грн
      window.scDlvPrice = price;
      render(lastText = (courier ? 'Доставка кур’єром Нової пошти' : 'Доставка Новою поштою') + ' — орієнтовно ' + price + ' грн, оплачується при отриманні за тарифами перевізника.', lastShort = 'орієнтовно ≈ ' + price + ' грн');
    }, function () { busy = false; });
  }

  function start() {
    if (!document.getElementById('sc-co-dlv-style')) {
      var s = document.createElement('style'); s.id = 'sc-co-dlv-style'; s.textContent = CSS; document.head.appendChild(s);
    }
    tick();
    setInterval(tick, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();


/* =====================================================================
 * 12. Google Customer Reviews — запрошення залишити відгук після замовлення
 *     Лише на сторінці «Ваше замовлення отримано», з реальним номером, e-mail і датою.
 *     Без e-mail Google опитування не надсилає — тоді нічого не показуємо.
 * ===================================================================== */
(function () {
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
})();


/* =====================================================================
 * 13. Мобільна картка → закріплена внизу панель «ціна + Купити»
 *     Видно, поки основної кнопки «Купити» немає на екрані (ще не догорнули або вже прогорнули)
 * ===================================================================== */
(function () {
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

  function init() {
    if (document.getElementById('sc-sticky')) return;
    var buy = document.querySelector('.product-card__buy-button button, button.j-buy-button-add[data-skin="mobile"]');
    if (!buy || window.innerWidth >= 768) return;                 // лише мобільна версія
    if (!document.querySelector('[itemprop="availability"][href*="InStock"], [itemprop="availability"][href*="Limited"]')) return;
    var priceMeta = document.querySelector('[itemprop="offers"] [itemprop="price"], .product-card__price [itemprop="price"]');
    var pn = priceMeta ? parseFloat(priceMeta.getAttribute('content')) : 0;
    if (!pn) return;

    var s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
    var bar = document.createElement('div');
    bar.id = 'sc-sticky';
    bar.innerHTML = '<span class="scs-i"><span class="scs-n"></span><span class="scs-p"></span></span>' +
      '<button type="button" class="btn btn--primary"></button>';
    bar.querySelector('.scs-n').textContent = ((document.querySelector('h1') || {}).textContent || '').trim();
    bar.querySelector('.scs-p').textContent = Math.round(pn).toLocaleString('uk-UA') + ' грн';
    var btn = bar.querySelector('button');
    function sync() {                                             // «Купити» / «В кошику» — як в основній кнопці
      var t = (buy.textContent || '').replace(/\s+/g, ' ').trim() || 'Купити';
      if (btn.textContent !== t) btn.textContent = t;
    }
    sync();
    btn.addEventListener('click', function () { buy.click(); setTimeout(sync, 1500); });
    document.body.appendChild(bar);
    document.body.classList.add('sc-sticky-pad');

    var ticking = false;
    function check() {                                            // показуємо, поки основної кнопки не видно (вище або нижче екрана)
      ticking = false;
      var r = buy.getBoundingClientRect();
      var hidden = r.bottom < 0 || r.top > window.innerHeight - 8;
      if (bar.classList.contains('on') !== hidden) { bar.classList.toggle('on', hidden); if (hidden) sync(); }
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; setTimeout(check, 60); }   // не rAF: у фонових вкладках він «засинає»
    }, { passive: true });
    check();
  }

  scIdle(init);
})();


/* =====================================================================
 * 14. Картка товару → «Знайшли дешевше? Напишіть нам»
 *     Telegram-бот (start=cheaper_<артикул>), Viber і WhatsApp з готовим текстом
 * ===================================================================== */
(function () {
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
    if (!document.querySelector('[itemprop="availability"][href*="InStock"], [itemprop="availability"][href*="Limited"]')) return;
    var name = ((document.querySelector('h1') || {}).textContent || '').replace(/\s+/g, ' ').trim();
    var art = ((document.body.innerText || '').match(/Артикул:?\s*([\w-]+)/) || [])[1] || '';
    if (!name) return;
    var url = location.origin + location.pathname;
    var msg = 'Добрий день! Знайшов дешевше: ' + name + (art ? ' (арт. ' + art + ')' : '') + '\n' + url +
              '\nПосилання на іншу пропозицію: ';

    var s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
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

  scIdle(function () { init(); setTimeout(init, 2000); });
})();


/* =====================================================================
 * 15. Картка товару → плашка довіри під «Купити» (картки як у TRINITI):
 *     Оплата при отриманні · Гарантія N місяців (з характеристик товару) · Повернення 14 днів
 * ===================================================================== */
(function () {
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

    if (!document.getElementById('sc-trust-style')) {
      var s = document.createElement('style'); s.id = 'sc-trust-style'; s.textContent = CSS; document.head.appendChild(s);
    }
    var lang = /^\/ru\//.test(location.pathname) ? '/ru' : '';
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

  scIdle(function () { init(); setTimeout(init, 2000); });
})();


/* =====================================================================
 * 16. Товар не в наявності → «Повідомити в Telegram, коли з'явиться»
 *     Клієнтський бот (start=stock_<артикул>) підписує клієнта і сам пише йому,
 *     щойно товар з'явиться у фіді TRINITI; менеджеру — сповіщення про попит.
 * ===================================================================== */
(function () {
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
    var art = ((document.body.innerText || '').match(/Артикул:?\s*([\w-]+)/) || [])[1] || '';
    art = art.replace(/[^\w-]/g, '').slice(0, 50);
    if (!art) return;

    if (!document.getElementById('sc-stock-style')) {
      var s = document.createElement('style'); s.id = 'sc-stock-style'; s.textContent = CSS; document.head.appendChild(s);
    }
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

  scIdle(function () { init(); setTimeout(init, 2000); });
})();


/* =====================================================================
 * 17. Картка товару → компактніший верх, щоб ціна і «Купити» були на першому екрані
 *     • назва товару дрібніше (довгі назви на 5–6 рядків)
 *     • вибір модифікації з одним-єдиним варіантом (напр. «Колір: Білий») ховаємо
 * ===================================================================== */
(function () {
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
    if (!document.getElementById('sc-head-style')) {
      var s = document.createElement('style'); s.id = 'sc-head-style'; s.textContent = CSS; document.head.appendChild(s);
    }
    hideSingle();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('load', hideSingle);
})();


/* =====================================================================
 * 18. Cookie-банер Хорошопа → вузька смуга внизу замість вікна посередині
 *     Той самий банер і та сама кнопка «Погодитися» (згода зберігається Хорошопом),
 *     змінюємо лише вигляд: без затемнення, сторінку можна гортати одразу.
 * ===================================================================== */
(function () {
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
  function style() {
    if (document.getElementById('sc-cookie-style')) return;
    var s = document.createElement('style'); s.id = 'sc-cookie-style'; s.textContent = CSS; document.head.appendChild(s);
  }

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

  function start() {
    if (apply() && !timer) timer = setInterval(apply, 500);          // Хорошоп може знову заблокувати прокрутку
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  window.addEventListener('load', start);
  setTimeout(start, 1500);
})();


/* =====================================================================
 * 19. Starlink Mini: живлення від повербанка
 *     • Перехідник Type-C → DC 65 Вт → повербанки Choetech з USB-C PD 20 В від 65 Вт
 *     • Кабелі з USB-C (Type-C/DC, 3 в 1, 2 в 1 з перехідником USB-C у комплекті) → ті самі повербанки
 *     • Подовжувачі DC/DC 18AWG → наш перехідник Type-C → DC + повербанки
 *     Повербанки Choetech на 22,5 Вт не підходять: їхній USB-C не видає 20 В, Mini від них не запуститься.
 *     Час роботи — орієнтовно при споживанні Mini 25–40 Вт (ККД перетворення ≈ 85 %).
 * ===================================================================== */
(function () {
  'use strict';

  var ADAPTER = { url: '/perekhidnyk-dlia-zhyvlennia-starlink-mini-type-c-na-dc-65-vt/',
                  note: 'Вставляється в USB-C повербанка, до гнізда DC — цей подовжувач' };
  var PB = {
    b733:  { url: '/power-bank-b733-50000mah-black-choetech/',
             note: 'USB-C 65 Вт (20 В) · ≈ 4–6 год роботи Mini' },
    b1012: { url: '/poverbank-20000mah-choetech-b1012-grey-100w-z-eu-adapterom-qc3.0-pd3.0-vbudovanyi-kabel/',
             note: 'USB-C 100 Вт (20 В / 5 А) · ≈ 1,5–2,5 год роботи Mini' },
    b815:  { url: '/poverbank-20000mah-choetech-b815-grey-130w-qc3.0-pd3.0-tft-smart-dysplei-vbudovanyi-kabel/',
             note: 'USB-C 100 Вт (20 В / 5 А) · ≈ 1,5–2,5 год роботи Mini' }
  };

  var CSS =
    '#sc-slk{margin:16px 0 0;padding:14px 16px;border:1px solid #f0d58a;border-radius:10px;background:#fffbea;font-size:14px;line-height:1.4}' +
    '#sc-slk .scs-t{font-weight:700;font-size:15px;margin:0 0 4px}' +
    '#sc-slk .scs-x{color:#555;margin:0 0 10px;font-size:13px}' +
    '#sc-slk .scs-l{display:flex;flex-direction:column;gap:8px}' +
    '#sc-slk a.scs-i{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid #e8dcb0;border-radius:8px;background:#fff;color:#1a1a1a;text-decoration:none;transition:border-color .15s}' +
    '#sc-slk a.scs-i:hover{border-color:#2b7de9}' +
    '#sc-slk .scs-img{flex:0 0 48px;width:48px;height:48px;object-fit:contain}' +
    '#sc-slk .scs-in{flex:1;min-width:0}' +
    '#sc-slk .scs-n{font-size:13px;line-height:1.3;display:block}' +
    '#sc-slk .scs-o{font-size:12px;color:#7a828c;display:block;margin-top:2px}' +
    '#sc-slk .scs-p{flex:0 0 auto;font-weight:700;white-space:nowrap}' +
    '#sc-slk .scs-s{font-size:12px;color:#7a828c;margin:10px 0 0}';

  var langPrefix = /^\/(ru|en)\//.test(location.pathname) ? '/' + location.pathname.split('/')[1] : '';

  function detect() {
    var t = ((document.querySelector('h1') || {}).textContent || '').replace(/\s+/g, ' ');
    if (!/Starlink Mini/i.test(t)) return null;
    // Перехідник Type-C → DC
    if (/^\s*(перехідник|переходник)/i.test(t) && /Type-C/i.test(t)) return {   // не «кабель … з перехідником Type-C»
      title: '🔋 Повербанк для Starlink Mini',
      text: 'Потрібен повербанк із USB-C Power Delivery 20 В від 65 Вт — звичайні на 20–22,5 Вт Mini не запустять. Ці перевірені за характеристиками:',
      list: [PB.b733, PB.b1012, PB.b815],
      foot: 'Підключайте перехідник до порту USB-C повербанка (не до вбудованого кабелю). Час роботи орієнтовний — залежить від погоди й навантаження.'
    };
    // Подовжувач DC/DC: потрібен перехідник і джерело
    if (/DC\s?\/\s?DC/i.test(t) && !/Type-C/i.test(t)) return {
      title: '🔌 Живлення від повербанка',
      text: 'Подовжувач з’єднує Mini з джерелом, що має гніздо DC 5.5×2.1. Щоб живити від повербанка, додайте перехідник Type-C → DC і повербанк з USB-C PD 20 В:',
      list: [ADAPTER, PB.b733, PB.b1012],
      foot: 'Перехідник розрахований на 65 Вт — для звичайної роботи Mini цього достатньо.'
    };
    // Кабелі з USB-C (вже з чипом PD або з перехідником у комплекті).
    // «прикурювач/DC з USB Type-C та LED» поки не чіпаємо — з опису не зрозуміло, чи USB-C там вхід живлення
    if (/Type-C\s?\/\s?DC|Type-C Plug|перехідником Type-C/i.test(t) && !/LED/i.test(t)) return {
      title: '🔋 Повербанк для цього кабелю',
      text: 'Для живлення Mini від USB-C потрібен повербанк з Power Delivery 20 В: за специфікацією Starlink — від 100 Вт, для звичайної роботи вистачає 65 Вт.',
      list: [PB.b1012, PB.b815, PB.b733],
      foot: 'Кабель під’єднуйте до порту USB-C повербанка (не до вбудованого кабелю). Час роботи орієнтовний.'
    };
    return null;
  }

  function load(pick) {
    var u = langPrefix + pick.url;
    return scProduct(u).then(function (p) {
      if (!p || !scInStock(p.avail)) return null;
      return { url: u, name: p.name, price: p.price, img: p.img, note: pick.note };
    });
  }

  function init() {
    if (document.getElementById('sc-slk')) return;
    var anchor = scAnchor();
    if (!anchor) return;
    var cfg = detect();
    if (!cfg) return;
    if (!document.getElementById('sc-slk-style')) {
      var s = document.createElement('style'); s.id = 'sc-slk-style'; s.textContent = CSS; document.head.appendChild(s);
    }
    var box = document.createElement('div');
    box.id = 'sc-slk';
    box.innerHTML = '<div class="scs-t"></div><div class="scs-x"></div><div class="scs-l"></div><div class="scs-s"></div>';
    box.querySelector('.scs-t').textContent = cfg.title;
    box.querySelector('.scs-x').textContent = cfg.text;
    box.querySelector('.scs-s').textContent = cfg.foot;
    // після плашки довіри / «Знайшли дешевше?» (блоки 14–15): вони підтягуються до «Купити» від'ємним відступом
    // і розраховують, що стоять одразу під ним — між них не вклинюємось
    var after = document.getElementById('sc-cheaper') || document.getElementById('sc-trust') || anchor;
    after.parentNode.insertBefore(box, after.nextSibling);

    var listEl = box.querySelector('.scs-l');
    scNear(box, function () { Promise.all(cfg.list.map(load)).then(function (items) {
      items.forEach(function (p) {
        if (!p) return;
        var a = document.createElement('a');
        a.className = 'scs-i'; a.href = p.url;
        a.innerHTML = (p.img ? '<img class="scs-img" loading="lazy" alt="">' : '') +
          '<span class="scs-in"><span class="scs-n"></span><span class="scs-o"></span></span><span class="scs-p"></span>';
        if (p.img) a.querySelector('img').src = p.img;
        a.querySelector('.scs-n').textContent = p.name;
        a.querySelector('.scs-o').textContent = p.note;
        a.querySelector('.scs-p').textContent = p.price;
        listEl.appendChild(a);
      });
      if (!listEl.children.length) box.remove();   // нічого немає в наявності — блок не показуємо
    }); });
  }

  scIdle(function () { init(); setTimeout(init, 2000); });
})();
