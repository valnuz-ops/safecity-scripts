/* SafeCity — скрипти сайту (safecity.in.ua)
 * Підключення в Хорошопі (одне поле, один рядок):
 * <script src="https://cdn.jsdelivr.net/gh/valnuz-ops/safecity-scripts@main/safecity.js" defer></script>
 */

/* ===== Загальні налаштування ===== */
var SC_TG_BOT = 'SafeCityOrderBot'; // username Telegram-бота БЕЗ @

/* ===== Спільні помічники (швидкість) ===== */
// Запуск після повного завантаження сторінки, коли браузер вільний — не заважає основному контенту
function scIdle(fn) {
  var run = function () {
    (window.requestIdleCallback || function (f) { setTimeout(f, 300); })(fn, { timeout: 3000 });
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run);
}

// Дані товару за URL (назва, наявність, ціна, фото). Кешуються в браузері на 1 год,
// тож повторні перегляди карток не завантажують сторінки товарів знову.
var scProduct = (function () {
  var TTL = 3600 * 1000, mem = {};
  function read(k) {
    try {
      var v = JSON.parse(localStorage.getItem('scp:' + k));
      if (v && Date.now() - v.t < TTL) return v.d;
    } catch (e) {}
    return null;
  }
  function write(k, d) {
    try { localStorage.setItem('scp:' + k, JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
  }
  return function (url) {
    if (mem[url]) return mem[url];
    var cached = read(url);
    if (cached) return (mem[url] = Promise.resolve(cached));
    return (mem[url] = fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var d = new DOMParser().parseFromString(html, 'text/html');
        var name = ((d.querySelector('h1') || {}).textContent || '').trim();
        if (!name) return null;
        var res = {
          name: name,
          avail: ((d.querySelector('.product-header__availability') || {}).textContent || '').trim(),
          price: ((d.querySelector('.product-price__item') || {}).textContent || '').trim().replace(/\s+/g, ' ').replace(/\/шт/, ''),
          img: (d.querySelector('meta[property="og:image"]') || {}).content || ''
        };
        write(url, res);
        return res;
      })
      .catch(function () { return null; }));
  };
})();


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

  function features() {
    var map = {};
    document.querySelectorAll('.product-features__table .product-features__row').forEach(function (r) {
      var th = r.querySelector('th'), td = r.querySelector('td');
      if (th && td) map[th.textContent.trim().toLowerCase()] = td.textContent.trim();
    });
    return map;
  }
  function get(map, re) { for (var k in map) if (re.test(k)) return map[k]; return ''; }

  function needsPsu() {
    var f = features();
    var type = get(f, /^тип (пристрою|устройства)$/);
    if (!/безперебійн|бесперебойн/i.test(type)) return false;

    var vin = get(f, /^вхідна напруга$|^входное напряжение$/);
    if (!/dc|12\s?(в|v)/i.test(vin) || /220|230|240/.test(vin)) return false;

    var title = ((document.querySelector('h1') || {}).textContent || '');
    if (/з блоком живлення|с блоком питания/i.test(title)) return false;

    var desc = ((document.querySelector('.product-description') || {}).textContent || '').replace(/\s+/g, ' ');
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
    var anchor = document.querySelector('.product__section--order');
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
    Promise.all(CFG.picks.map(loadProduct)).then(function (items) {
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
    });
  }

  scIdle(init);
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

  function features() {
    var map = {};
    document.querySelectorAll('.product-features__table .product-features__row').forEach(function (r) {
      var th = r.querySelector('th'), td = r.querySelector('td');
      if (th && td) map[th.textContent.trim().toLowerCase()] = td.textContent.trim();
    });
    return map;
  }
  function get(map, re) { for (var k in map) if (re.test(k)) return map[k]; return ''; }

  function detect() {
    var f = features();
    var type = get(f, /^тип (пристрою|устройства)$/);
    var title = ((document.querySelector('h1') || {}).textContent || '');
    var desc = ((document.querySelector('.product-description') || {}).textContent || '').replace(/\s+/g, ' ');

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

      return { list: list, links: links, title: '🔋 Акумулятор не входить у комплект', text: text };
    }
    return null;
  }

  function loadProduct(pick) {
    var u = langPrefix + pick.url;
    return scProduct(u).then(function (p) {
      if (!p || !/в наявності|в наличии|закінчується|заканчивается/i.test(p.avail)) return null;
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
    var anchor = document.querySelector('.product__section--order');
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
    pickInStock(cfg.list, function (items) {
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
    });
  }

  scIdle(init);
})();


/* =====================================================================
 * 4. Сторінка «Ваше замовлення отримано» → кнопка підтвердження в Telegram
 * ===================================================================== */
(function () {
  'use strict';
  if (location.pathname.indexOf('/checkout/complete/') === -1) return;

  function inject() {
    if (document.getElementById('sc-tg')) return true;
    var m = ((document.body && document.body.innerText) || '').match(/замовлен\S*\s*№\s*(\d{3,10})/i);
    if (!m) return false;
    var num = m[1];

    var box = document.createElement('div');
    box.id = 'sc-tg';
    box.style.cssText = 'margin:0 0 24px;padding:18px;border:1px solid #d6ecf8;border-radius:12px;background:#f3faff;text-align:center;max-width:1100px';
    box.innerHTML =
      '<div style="font-size:17px;font-weight:600;margin-bottom:6px">Підтвердіть замовлення №' + num + ' в один клік</div>' +
      '<div style="font-size:14px;color:#555;margin-bottom:14px">Без дзвінка менеджера — перевірте склад замовлення та доставку в Telegram</div>' +
      '<a href="https://t.me/' + SC_TG_BOT + '?start=order_' + num + '" target="_blank" rel="noopener" ' +
      'style="display:inline-block;background:#2AABEE;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:16px;font-weight:600">' +
      '✈️ Підтвердити в Telegram</a>';

    var h1 = document.querySelector('h1');
    if (h1 && h1.parentNode) h1.parentNode.insertBefore(box, h1.nextSibling);
    else (document.querySelector('main') || document.body).prepend(box);
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