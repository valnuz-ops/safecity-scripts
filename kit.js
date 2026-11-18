/* SafeCity — збирач комплекту відеоспостереження (блок 46 safecity.js підвантажує цей файл лише за потреби).
 * Відкривається: посилання/кнопка з href="#kit", кнопка в категоріях відеокамер і реєстраторів,
 * рядок у підказках пошуку («комплект відеоспостереження…»), або вбудовано на сторінці, де в тексті є
 * <div data-sc-kit="cctv"></div>.
 * Дані — індекс пошуку (window.scSearchApi): лише товари в наявності, ціни звідти ж.
 * Правила підбору:
 *   • камери — IP з PoE, того ж бренду, що й реєстратор (TVT, Hikvision, Dahua, Ajax), без PTZ / Wi-Fi / 4G;
 *   • реєстратор — каналів не менше, ніж камер, і роздільна здатність запису не нижча за камеру;
 *   • PoE-комутатор — лише якщо в реєстратора немає своїх PoE-портів на всі камери; портів PoE ≥ камер,
 *     бюджет PoE ≥ камер × 7 Вт;
 *   • диск — 1 Мбіт/с ≈ 10,8 ГБ на добу (як у статтях блогу); потік H.265: 2 Мп — 2, 4 Мп — 3, 5 Мп — 4,
 *     6 Мп — 5, 8 Мп — 6 Мбіт/с на камеру, постійний запис;
 *   • кабель — мідна (CU) вита пара Cat5e, бухта 305 м.
 */
(function () {
  'use strict';
  if (window.scKit) return;

  var BRANDS = ['TVT', 'Hikvision', 'Dahua', 'Ajax'];
  var CAM_W = 7;                 // Вт на камеру для бюджету PoE (з запасом для камер з ІЧ)
  var GB_DAY = 10.8;             // ГБ на добу на 1 Мбіт/с
  var CABLE_M = 30;              // орієнтовно метрів кабелю на камеру
  var DAYS = [7, 14, 30];
  var S = { n: 4, brand: '', mp: 0, days: 14, cam: '', nvr: '', sw: '', hdd: '', cable: 'out', poe: '', off: {} };
  var D = null;                  // розібраний каталог
  var root = null, modal = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(p) { return String(Math.round(p)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' грн'; }
  function ga(ev, p) { try { if (typeof window.gtag === 'function') window.gtag('event', ev, p || {}); } catch (e) {} }
  function qv(it, key) { var m = String(it.q || '').match(new RegExp('(?:^|[ ,])' + key + ':([\\d.]+)')); return m ? parseFloat(m[1]) : 0; }
  function mbps(mp) { return mp <= 2 ? 2 : mp <= 4 ? 3 : mp <= 5 ? 4 : mp <= 6 ? 5 : 6; }
  function plural(n, f) { var a = n % 10, b = n % 100; return f[a === 1 && b !== 11 ? 0 : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 1 : 2]; }
  function byPrice(a, b) { return a.p - b.p; }

  function parse(items) {
    var d = { cams: [], nvrs: [], sws: [], hdds: [], cables: [] };
    items.forEach(function (it) {
      if (!it.s || !it.p) return;
      var n = it.n, x = it.x || '', m;
      if (/^IP-відеокамера/.test(n) && BRANDS.indexOf(it.b) >= 0 && /(^| )PoE( |$)/.test(x) &&
          !/PTZ|Wi-?Fi|4G|LTE|Fisheye|риб'?яче|панорамн|автономн|сонячн|розпізнаван|номерів|LPR|ANPR|теплов|підрахун|вибухо/i.test(n) && (m = n.match(/(\d+)\s?Mp/i))) {
        d.cams.push({ it: it, p: it.p, b: it.b, mp: +m[1], form: /Циліндрична/.test(x) ? 'циліндрична' : /Купольна/.test(x) ? 'купольна' : '', out: /Вуличне/.test(x) });
      } else if (/^IP-відеореєстратор/.test(n) && BRANDS.indexOf(it.b) >= 0) {
        var ch = qv(it, 'ch') || +((n.match(/(\d+)-канальний/) || [])[1] || 0);
        if (!ch) return;
        d.nvrs.push({ it: it, p: it.p, b: it.b, ch: ch, mp: +((n.match(/(\d+)\s?Mp/i) || [])[1] || 0), poe: +((n.match(/з (\d+) портами PoE/) || [])[1] || 0), hdd: qv(it, 'hdd') });
      } else if (/^PoE-комутатор/.test(n)) {
        var ports = +((n.match(/з (\d+) портами PoE/) || n.match(/(\d+)\s?[xх]\s?\d+\s?Mbps PoE/i) || n.match(/(\d+) порт(?:и|ів|а) PoE/) || [])[1] || 0);
        if (ports) d.sws.push({ it: it, p: it.p, ports: ports, pw: qv(it, 'pw') });
      } else if (/^Жорсткий диск/.test(n) && (m = n.match(/(\d+)\s?TB/i))) {
        d.hdds.push({ it: it, p: it.p, tb: +m[1] });
      } else if (/^Кабель вита пара/.test(n) && /CAT5E CU/.test(n) && /305м/.test(n) && !/2PR/.test(n)) {
        d.cables.push({ it: it, p: it.p, out: /Outdoor/i.test(n) });
      }
    });
    ['cams', 'nvrs', 'sws', 'hdds', 'cables'].forEach(function (k) { d[k].sort(byPrice); });
    // бренди, де є і камери, і реєстратори
    d.brands = BRANDS.filter(function (b) {
      return d.cams.some(function (c) { return c.b === b; }) && d.nvrs.some(function (r) { return r.b === b; });
    });
    return d;
  }

  function find(list, u) { for (var i = 0; i < list.length; i++) if (list[i].it.u === u) return list[i]; return null; }

  // Підбір під поточний стан; повертає набір рядків і підказки
  function solve() {
    var r = { rows: [], notes: [] };
    if (!D.brands.length) return r;
    if (D.brands.indexOf(S.brand) < 0) S.brand = D.brands[0];
    var cams = D.cams.filter(function (c) { return c.b === S.brand; });
    var mps = cams.map(function (c) { return c.mp; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    if (mps.indexOf(S.mp) < 0) S.mp = mps.indexOf(4) >= 0 ? 4 : mps[0];
    r.mps = mps;
    var camList = cams.filter(function (c) { return c.mp === S.mp; });
    var cam = find(camList, S.cam) || camList[0];
    S.cam = cam.it.u;
    r.rows.push({ id: 'cam', title: 'Камери', sel: cam, list: camList, qty: S.n,
      label: function (c) { return c.it.n.replace(/^IP-відеокамера\s*/, '') + ' — ' + money(c.p); } });

    var swOk = D.sws.filter(function (s) { return s.ports >= S.n && (!s.pw || s.pw >= S.n * CAM_W); });
    var nvrList = D.nvrs.filter(function (v) { return v.b === S.brand && v.ch >= S.n && (!v.mp || v.mp >= S.mp); });
    if (!nvrList.length) {
      r.notes.push('Реєстратора ' + S.brand + ' на ' + S.n + ' ' + plural(S.n, ['камеру', 'камери', 'камер']) + ' зараз немає в наявності — зменште кількість камер або оберіть інший бренд.');
      return r;
    }
    function cost(v) { return v.p + (v.poe >= S.n ? 0 : (swOk[0] ? swOk[0].p : 1e9)); }
    // живлення камер: від PoE-портів самого реєстратора або від окремого комутатора — вибір покупця,
    // якщо є обидва варіанти; типово — дешевший у сумі
    var withPoe = nvrList.filter(function (v) { return v.poe >= S.n; }), noPoe = nvrList.filter(function (v) { return v.poe < S.n; });
    r.poeChoice = withPoe.length && noPoe.length;
    if (r.poeChoice) {
      if (S.poe !== 'nvr' && S.poe !== 'sw') S.poe = nvrList.slice().sort(function (a, b) { return cost(a) - cost(b); })[0].poe >= S.n ? 'nvr' : 'sw';
      nvrList = S.poe === 'nvr' ? withPoe : noPoe;
    }
    var nvr = find(nvrList, S.nvr) || nvrList.slice().sort(function (a, b) { return cost(a) - cost(b); })[0];
    S.nvr = nvr.it.u;
    r.rows.push({ id: 'nvr', title: 'Відеореєстратор', sel: nvr, list: nvrList, qty: 1,
      label: function (v) { return v.it.n.replace(/^IP-відеореєстратор\s*/, '') + ' — ' + money(v.p); },
      hint: nvr.ch + ' ' + plural(nvr.ch, ['канал', 'канали', 'каналів']) + (nvr.poe >= S.n ? ', камери підключаються просто до нього' : '') });

    if (nvr.poe < S.n) {
      if (swOk.length) {
        var sw = find(swOk, S.sw) || swOk[0];
        S.sw = sw.it.u;
        r.rows.push({ id: 'sw', title: 'PoE-комутатор', sel: sw, list: swOk.slice(0, 12), qty: 1,
          label: function (s) { return s.it.n.replace(/^PoE-комутатор\s*/, '').slice(0, 70) + ' — ' + money(s.p); },
          hint: 'живлення й мережа для камер одним кабелем; ' + sw.ports + ' ' + plural(sw.ports, ['порт', 'порти', 'портів']) + ' PoE' + (sw.pw ? ', ' + sw.pw + ' Вт' : '') });
      } else r.notes.push('PoE-комутатора на ' + S.n + ' камер зараз немає в наявності — напишіть нам, підберемо.');
    }

    var need = S.n * mbps(S.mp) * S.days * GB_DAY / 1000;          // ТБ
    var hdds = D.hdds.filter(function (h) { return !nvr.hdd || h.tb <= nvr.hdd; });
    if (hdds.length) {
      var fit = hdds.filter(function (h) { return h.tb >= need; }).sort(function (a, b) { return a.tb - b.tb || a.p - b.p; });
      var hdd = find(hdds, S.hdd) || fit[0] || hdds.slice().sort(function (a, b) { return b.tb - a.tb; })[0];
      S.hdd = hdd.it.u;
      var days = Math.floor(hdd.tb * 1000 / (S.n * mbps(S.mp) * GB_DAY));
      r.rows.push({ id: 'hdd', title: 'Жорсткий диск', sel: hdd, list: hdds.slice().sort(function (a, b) { return a.tb - b.tb; }), qty: 1,
        label: function (h) { return h.tb + ' ТБ ' + h.it.n.replace(/^Жорсткий диск\s*(?:3\.5"\s*)?\d+TB\s*/, '') + ' — ' + money(h.p); },
        hint: 'архів приблизно ' + days + ' ' + plural(days, ['доба', 'доби', 'діб']) + ' постійного запису' + (days < S.days ? ' — менше, ніж ви хотіли: більшого диска в наявності немає' : ''),
        warn: days < S.days });
    }

    if (S.cable !== 'no') {
      var cl = D.cables.filter(function (c) { return c.out === (S.cable === 'out'); });
      if (cl.length) {
        var q = Math.max(1, Math.ceil(S.n * CABLE_M / 305));
        r.rows.push({ id: 'cable', title: 'Кабель', sel: cl[0], list: [cl[0]], qty: q,
          hint: 'мідна вита пара, бухта 305 м' + (q > 1 ? ' × ' + q : '') + ' — вистачить у середньому по ' + Math.min(100, Math.floor(305 * q / S.n)) + ' м на камеру (лінія до камери — не довша за 100 м)' });
      }
    }
    return r;
  }

  var CSS =
    '.sckit{font-size:14px;line-height:1.4;color:#1d2733;box-sizing:border-box;max-width:860px;margin:0 auto}.sckit *{box-sizing:border-box}' +
    '.sckit__h{font-weight:700;font-size:20px;margin:0 0 4px}.sckit__s{color:#5f6b78;margin:0 0 14px;font-size:13px}' +
    '.sckit__opts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 20px;margin:0 0 16px}' +
    '.sckit__opt b{display:block;font-size:13px;margin:0 0 6px}' +
    '.sckit__chips{display:flex;flex-wrap:wrap;gap:6px}' +
    '.sckit__chip{padding:7px 12px;border:1px solid #cfd8e2;border-radius:18px;background:#fff;cursor:pointer;font:inherit;color:#1d2733;line-height:1.2}' +
    '.sckit__chip.on{background:#1b7fd1;border-color:#1b7fd1;color:#fff}' +
    '.sckit__q{display:inline-flex;align-items:center;border:1px solid #cfd8e2;border-radius:8px;background:#fff}' +
    '.sckit__q button{width:38px;height:36px;border:0;background:none;font-size:20px;cursor:pointer;color:#1d2733;padding:0}' +
    '.sckit__q span{min-width:34px;text-align:center;font-weight:700;font-size:16px}' +
    '.sckit__row{display:grid;grid-template-columns:22px 56px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid #e6ebf1}' +
    '.sckit__row.off{opacity:.5}' +
    '.sckit .sckit__row>input[type=checkbox]{grid-column:1;-webkit-appearance:checkbox;appearance:auto;display:block!important;position:static!important;opacity:1!important;visibility:visible!important;width:18px;height:18px;margin:0;accent-color:#1b7fd1}' +
    '.sckit__row>.sckit__img{grid-column:2}.sckit__row>.sckit__body{grid-column:3;min-width:0}.sckit__row>.sckit__sum{grid-column:4}' +
    '.sckit__row img{width:56px;height:56px;object-fit:contain;border-radius:6px;background:#fff}' +
    '.sckit__t{font-size:12px;color:#5f6b78;text-transform:uppercase;letter-spacing:.03em}' +
    '.sckit__n{display:block;color:#1d2733;text-decoration:none;font-weight:500;overflow-wrap:anywhere}.sckit__n:hover{text-decoration:underline}' +
    '.sckit__hint{font-size:12px;color:#5f6b78;margin-top:2px}.sckit__hint.warn{color:#b45309}' +
    '.sckit__row select{width:100%;max-width:100%;margin-top:6px;padding:6px 8px;border:1px solid #cfd8e2;border-radius:6px;background:#fff;color:#1d2733;font:inherit;font-size:13px}' +
    '.sckit__sum{text-align:right;white-space:nowrap;font-weight:700}.sckit__sum small{display:block;font-weight:400;color:#5f6b78;font-size:12px}' +
    '.sckit__note{margin:10px 0 0;padding:10px 12px;border-radius:8px;background:#fdf2e3;font-size:13px}' +
    '.sckit__foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin-top:6px;padding:14px 0 0;border-top:2px solid #1d2733}' +
    '.sckit__total{font-size:22px;font-weight:700}.sckit__total small{display:block;font-size:12px;font-weight:400;color:#5f6b78}' +
    '.sckit__buy{padding:13px 22px;border:0;border-radius:8px;background:#1f8a4c;color:#fff;font:inherit;font-weight:700;font-size:16px;cursor:pointer}' +
    '.sckit__buy[disabled]{opacity:.6;cursor:default}a.sckit__buy{display:inline-block;text-decoration:none;margin:0 8px 8px 0}.sckit__done{padding:10px 0}' +
    '.sckit__f{font-size:12px;color:#7a828c;margin:12px 0 0}' +
    '.sckit-modal{position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,32,.55);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px;-webkit-overflow-scrolling:touch}' +
    '.sckit-modal__box{position:relative;width:100%;max-width:900px;background:#fff;border-radius:12px;padding:22px 24px 24px;box-shadow:0 12px 40px rgba(0,0,0,.25)}' +
    '.sckit-modal__x{position:absolute;top:8px;right:8px;width:40px;height:40px;border:0;background:none;font-size:28px;line-height:1;cursor:pointer;color:#5f6b78}' +
    '.sckit-inline{margin:20px 0;padding:18px 20px;border:1px solid #d6e4f0;border-radius:12px;background:#f7fbff}' +
    '@media(max-width:640px){.sckit__opts{grid-template-columns:1fr}.sckit-modal{padding:0}.sckit-modal__box{border-radius:0;min-height:100%;padding:18px 14px 90px}' +
    '.sckit__row{grid-template-columns:22px 44px minmax(0,1fr)}.sckit__row img{width:44px;height:44px}.sckit__row>.sckit__sum{grid-column:3;text-align:left}.sckit__sum small{display:inline;margin-left:6px}' +
    '.sckit__foot{position:sticky;bottom:0;background:#fff;padding:10px 0;margin-top:10px}.sckit__buy{flex:1 1 auto}.sckit__h{font-size:18px;padding-right:36px}}';

  function chips(name, vals, cur, fmt) {
    return '<div class="sckit__chips">' + vals.map(function (v) {
      return '<button type="button" class="sckit__chip' + (v === cur ? ' on' : '') + '" data-k="' + name + '" data-v="' + esc(v) + '">' + esc(fmt ? fmt(v) : v) + '</button>';
    }).join('') + '</div>';
  }

  function render() {
    if (!root) return;
    var r = solve(), total = 0;
    var h = '<div class="sckit__h">Зберіть комплект відеоспостереження</div>' +
      '<div class="sckit__s">Вкажіть, скільки камер потрібно, — підберемо сумісні між собою реєстратор, диск і комутатор з того, що є в наявності. Будь-яку позицію можна замінити або прибрати.</div>';
    if (!D.brands.length) { root.innerHTML = h + '<div class="sckit__note">Зараз не вистачає товарів у наявності, щоб зібрати комплект. Напишіть нам — підберемо вручну.</div>'; return; }
    h += '<div class="sckit__opts">' +
      '<div class="sckit__opt"><b>Скільки камер</b><span class="sckit__q"><button type="button" data-k="n" data-v="-1" aria-label="Менше">−</button><span>' + S.n + '</span><button type="button" data-k="n" data-v="1" aria-label="Більше">+</button></span></div>' +
      '<div class="sckit__opt"><b>Бренд</b>' + chips('brand', D.brands, S.brand) + '</div>' +
      '<div class="sckit__opt"><b>Чіткість зображення</b>' + chips('mp', r.mps || [], S.mp, function (v) { return v + ' Мп' + (v === 2 ? ' · Full HD' : v === 8 ? ' · 4K' : ''); }) + '</div>' +
      '<div class="sckit__opt"><b>Скільки зберігати запис</b>' + chips('days', DAYS, S.days, function (v) { return v + ' ' + plural(v, ['день', 'дні', 'днів']); }) + '</div>' +
      (r.poeChoice ? '<div class="sckit__opt"><b>Живлення камер (PoE)</b>' + chips('poe', ['nvr', 'sw'], S.poe, function (v) { return v === 'nvr' ? 'від реєстратора з PoE-портами' : 'окремий PoE-комутатор'; }) + '</div>' : '') +
      '<div class="sckit__opt"><b>Кабель</b>' + chips('cable', ['out', 'in', 'no'], S.cable, function (v) { return v === 'out' ? 'вуличний' : v === 'in' ? 'для приміщень' : 'не потрібен'; }) + '</div>' +
      '</div>';
    r.rows.forEach(function (row) {
      var x = row.sel.it, off = !!S.off[row.id], sum = row.sel.p * row.qty;
      if (!off) total += sum;
      h += '<div class="sckit__row' + (off ? ' off' : '') + '">' +
        '<input type="checkbox" data-k="off" data-v="' + row.id + '"' + (off ? '' : ' checked') + ' aria-label="' + esc(row.title) + '">' +
        (x.i ? '<img class="sckit__img" src="' + esc(x.i) + '" alt="" loading="lazy">' : '<span class="sckit__img"></span>') +
        '<div class="sckit__body"><div class="sckit__t">' + esc(row.title) + '</div><a class="sckit__n" href="' + esc(x.u) + '" target="_blank" rel="noopener">' + esc(x.n) + '</a>' +
        (row.hint ? '<div class="sckit__hint' + (row.warn ? ' warn' : '') + '">' + esc(row.hint) + '</div>' : '') +
        (row.list.length > 1 ? '<select data-k="' + row.id + '" aria-label="Замінити: ' + esc(row.title) + '">' + row.list.map(function (o) {
          return '<option value="' + esc(o.it.u) + '"' + (o === row.sel ? ' selected' : '') + '>' + esc(row.label(o)) + '</option>';
        }).join('') + '</select>' : '') + '</div>' +
        '<div class="sckit__sum">' + money(sum) + (row.qty > 1 ? '<small>' + row.qty + ' × ' + money(row.sel.p) + '</small>' : '') + '</div></div>';
    });
    r.notes.forEach(function (n) { h += '<div class="sckit__note">' + esc(n) + '</div>'; });
    root._rows = r.rows.filter(function (row) { return !S.off[row.id]; });
    root._total = total;
    h += '<div class="sckit__foot"><div class="sckit__total">' + money(total) + '<small>' + (total >= 3000 ? 'доставка Новою поштою безкоштовна' : 'ціни й наявність — на зараз') + '</small></div>' +
      '<button type="button" class="sckit__buy"' + (root._rows.length ? '' : ' disabled') + '>Додати все в кошик</button></div>' +
      '<p class="sckit__f">Розрахунок диска орієнтовний: постійний запис у H.265, ' + mbps(S.mp) + ' Мбіт/с на камеру ' + S.mp + ' Мп; запис лише за рухом займає в рази менше. ' +
      'Камери й реєстратор одного бренду працюють разом без налаштувань сумісності. Блок живлення камерам не потрібен — їх живить PoE.</p>';
    root.innerHTML = h;
  }

  function onClick(e) {
    var t = e.target;
    if (t.closest && t.closest('.sckit__again')) { render(); return; }
    if (t.closest && t.closest('button.sckit__buy')) { buy(t.closest('.sckit__buy')); return; }
    var b = t.closest && t.closest('button[data-k]');
    if (!b) return;
    var k = b.getAttribute('data-k'), v = b.getAttribute('data-v');
    if (k === 'n') { S.n = Math.max(1, Math.min(32, S.n + (+v))); S.nvr = S.sw = S.hdd = ''; }
    else if (k === 'brand') { S.brand = v; S.cam = S.nvr = S.sw = S.hdd = S.poe = ''; S.mp = 0; }
    else if (k === 'mp') { S.mp = +v; S.cam = S.nvr = S.hdd = ''; }
    else if (k === 'days') { S.days = +v; S.hdd = ''; }
    else if (k === 'cable') S.cable = v;
    else if (k === 'poe') { S.poe = v; S.nvr = S.sw = S.hdd = ''; }
    render();
  }
  function onChange(e) {
    var t = e.target, k = t.getAttribute && t.getAttribute('data-k');
    if (!k) return;
    if (k === 'off') S.off[t.getAttribute('data-v')] = !t.checked;
    else if (t.tagName === 'SELECT') { S[k] = t.value; if (k === 'nvr') { S.sw = ''; S.hdd = ''; } }
    render();
  }

  function buy(btn) {
    var rows = root._rows || [];
    if (!rows.length || btn.disabled) return;
    btn.disabled = true; btn.textContent = 'Додаємо…';
    var pid = window.scProductId;
    Promise.all(rows.map(function (row) { return pid(row.sel.it.u); })).then(function (ids) {
      if (ids.some(function (id) { return !id; }) || typeof window.AjaxCart === 'undefined') throw new Error('no id');
      var cart = window.AjaxCart.getInstance();
      var prods = rows.map(function (row, i) { return { type: 'product', id: +ids[i], quantity: row.qty }; });
      var last = prods.pop();
      if (prods.length) cart.appendProducts(prods);
      ga('sc_kit_add', { value: root._total, cams: S.n, brand: S.brand, items: rows.length });
      // останній товар — штатним «Купити»: Хорошоп сам відкриє вікно кошика з усім набором
      setTimeout(function () {
        cart.appendProduct(last, undefined, true);
        // кошик Хорошопу сам не відкривається — показуємо підтвердження з переходом до оформлення
        setTimeout(function () {
          if (!root) return;
          var lang = (location.pathname.match(/^\/(ru|en)\//) || [])[1];
          root.innerHTML = '<div class="sckit__done"><div class="sckit__h">Комплект у кошику ✓</div>' +
            '<div class="sckit__s">' + rows.length + ' ' + plural(rows.length, ['позиція', 'позиції', 'позицій']) + ' на ' + money(root._total) + '. Кількість і склад можна змінити в кошику.</div>' +
            '<a class="sckit__buy" href="' + (lang ? '/' + lang : '') + '/checkout/">Оформити замовлення</a> ' +
            '<button type="button" class="sckit__chip sckit__again">Змінити комплект</button></div>';
        }, 1200);
      }, prods.length ? 1500 : 0);
    })['catch'](function () {
      btn.disabled = false; btn.textContent = 'Не вдалося — спробуйте ще раз';
    });
  }

  function style() {
    if (document.getElementById('sckit-css')) return;
    var s = document.createElement('style'); s.id = 'sckit-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  function ready(fn) {
    var api = window.scSearchApi;
    if (!api || !api.items) return;
    api.load(function () { if (!D) D = parse(api.items()); fn(); });
  }
  function mount(el) {
    style();
    root = el; el.classList.add('sckit');
    el.addEventListener('click', onClick); el.addEventListener('change', onChange);
    el.innerHTML = '<div class="sckit__s">Завантажуємо товари…</div>';
    ready(render);
  }
  function close() {
    if (!modal) return;
    modal.remove(); modal = null; root = null;
    document.documentElement.style.overflow = '';
    if (/^#(sc-)?kit$/.test(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
  }
  function open(from) {
    if (modal) return;
    style();
    modal = document.createElement('div'); modal.className = 'sckit-modal';
    modal.innerHTML = '<div class="sckit-modal__box" role="dialog" aria-modal="true" aria-label="Комплект відеоспостереження"><button type="button" class="sckit-modal__x" aria-label="Закрити">×</button><div></div></div>';
    modal.addEventListener('click', function (e) { if (e.target === modal || (e.target.closest && e.target.closest('.sckit-modal__x'))) close(); });
    document.body.appendChild(modal);
    document.documentElement.style.overflow = 'hidden';
    mount(modal.querySelector('.sckit-modal__box > div'));
    ga('sc_kit_open', { from: from || '' });
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  window.scKit = {
    open: open, close: close,
    inline: function (el) { if (el.getAttribute('data-sc-kit-on')) return; el.setAttribute('data-sc-kit-on', '1'); el.classList.add('sckit-inline'); mount(el); ga('sc_kit_open', { from: 'page' }); },
    // для перевірки з консолі: scKit.test({n:8, brand:'TVT'}) → назви підібраного
    test: function (o) {
      var api = window.scSearchApi; if (!D) D = parse(api.items());
      for (var k in o) S[k] = o[k];
      return solve().rows.map(function (r) { return r.qty + ' × ' + r.sel.it.n + ' — ' + r.sel.p + (r.hint ? ' (' + r.hint + ')' : ''); });
    }
  };
})();
