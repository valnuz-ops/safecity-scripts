var SC_NP_LOGO='https://valnuz-ops.github.io/safecity-scripts/img/np.svg';
scModule(48, function () {
  'use strict';
  if (location.pathname.indexOf('/checkout') === -1) return;

  var SDK = 'https://integration-widget.novapost.com/sdk.min.js';
  var TYPE = { branch: '3', postomat: '17', courier: '16' };
  var $ = function () { return window.jQuery; };
  var widget = null, busy = false, sdkP = null;

  var CSS =
    '#sc-npmap{margin:6px 0 10px}' +
    '#sc-npmap .sc-npmap__btn{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border:1px solid #e3242b;border-radius:8px;' +
    'background:#fff;color:#c8161d;font-size:14px;font-weight:600;cursor:pointer;line-height:1.2}' +
    '#sc-npmap .sc-npmap__btn:hover{background:#fff3f3}' +
    '#sc-npmap .sc-npmap__btn img{width:20px;height:20px;display:block;object-fit:contain}' +
    '#sc-npmap .sc-npmap__btn[disabled]{opacity:.6;cursor:wait}' +
    '#sc-npmap .sc-npmap__msg{font-size:13px;margin-top:6px;color:#4c5a67}' +
    '#sc-npmap .sc-npmap__msg.ok{color:#1a7f37}#sc-npmap .sc-npmap__msg.err{color:#a0251a}' +
    '#sc-npmap-host{position:absolute;width:0;height:0;overflow:hidden}';

  function q(s) { return scCheckout().querySelector(s); }
  function typeSel() { return q('select[name="Delivery[delivery_type]"]'); }
  function whSel() { return q('select[name^="Delivery[delivery_method]"]'); }
  function ga(n, p) { try { if (typeof window.gtag === 'function') window.gtag('event', n, p || {}); } catch (x) {} }
  function wait(f, ms) {
    return new Promise(function (ok, no) {
      var t0 = Date.now();
      (function p() {
        var v; try { v = f(); } catch (x) {}
        if (v) return ok(v);
        if (Date.now() - t0 > ms) return no(new Error('timeout'));
        setTimeout(p, 150);
      })();
    });
  }
  function setSelect(s, v) {
    var jq = $();
    if (jq) {
      jq(s).val(v).trigger('change');
      try { var sb = jq(s).data('selectBoxSelectBoxIt'); if (sb) sb.refresh(); } catch (x) {}
    } else { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  // «місто Львів» / «село Сокільники» → { kind, base }
  function parseCity(t) {
    t = String(t || '').trim();
    var m = t.match(/^(місто|село|селище міського типу|селище)\s+(.+)$/i);
    var k = m ? m[1].toLowerCase() : '';
    return { kind: k === 'місто' ? 'м' : k === 'село' ? 'с' : k ? 'смт' : '', base: (m ? m[2] : t).trim() };
  }
  // мітка Хорошопа «с. Львів (Дніпропетровська обл., Криворізький р-н.)» → { kind, base, rest }
  function parseLabel(t) {
    t = String(t || '').trim();
    var m = t.match(/^(м\.|с\.|смт\.?|с-ще|сщ\.)\s*([^(]+?)\s*(?:\((.*)\))?$/i);
    if (!m) return { kind: '', base: t.replace(/\s*\(.*$/, ''), rest: '' };
    var k = m[1].toLowerCase();
    return { kind: k === 'м.' ? 'м' : k === 'с.' ? 'с' : 'смт', base: m[2], rest: m[3] || '' };
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[’'`ʼ]/g, '').replace(/\s+/g, ' ').trim(); }

  function pickCity(items, d) {
    var want = parseCity((d.settlement && d.settlement.name) || (d.addressParts && d.addressParts.city) || d.city);
    var region = norm(((d.addressParts && d.addressParts.region) || '').replace(/\s*область$/i, ''));
    var best = null, score = -1;
    items.forEach(function (li) {
      var L = parseLabel(li.textContent);
      if (norm(L.base) !== norm(want.base)) return;
      var sc = 1;
      if (want.kind && L.kind === want.kind) sc += 4;
      if (region && norm(L.rest).indexOf(region.slice(0, Math.max(5, region.length - 3))) !== -1) sc += 2;
      if (!L.rest) sc += 1;                                   // обласні центри — без уточнення в дужках
      if (sc > score) { score = sc; best = li; }
    });
    return best;
  }

  function hasRef(ref) {
    var w = whSel();
    return w && [].some.call(w.options, function (o) { return o.value === ref; }) && w;
  }

  function apply(d) {
    var ref = d.externalId;
    var t = d.divisionCategory === 'Postomat' ? TYPE.postomat : TYPE.branch;
    var ts = typeSel();
    var p = Promise.resolve();
    if (ts && ts.value !== t) {
      p = p.then(function () { setSelect(ts, t); return new Promise(function (r) { setTimeout(r, 600); }); });
    }
    return p.then(function () {
      if (hasRef(ref)) return;
      var jq = $(), inp = document.getElementById('checkout-city') || q('[name="Recipient[delivery_city]"]');
      var ac = jq && inp && jq(inp).data('ui-autocomplete');
      if (!ac) throw new Error('no autocomplete');
      var c = parseCity((d.settlement && d.settlement.name) || (d.addressParts && d.addressParts.city) || d.city);
      inp.value = c.base;
      ac.search(c.base);
      return wait(function () {
        var items = [].slice.call(ac.menu.element[0].querySelectorAll('li'));
        return items.length && pickCity(items, d);
      }, 8000).then(function (li) {
        ac.menu.focus(null, jq(li)); ac.menu.select();
      });
    }).then(function () {
      return wait(function () { return hasRef(ref); }, 12000);
    }).then(function () {
      var w = whSel();
      setSelect(w, ref);
      // блок 33: перше значення списку без кліку вважає «не обрано» — позначаємо вибір явно
      w.setAttribute('data-sc33', 'picked');
      return wait(function () { var x = whSel(); return x && x.value === ref; }, 3000);
    }).then(function () {
      var w = whSel(), t = w && (document.getElementById(w.id + 'SelectBoxItText') || w.parentElement.querySelector('.selectboxit-text, .select__text'));
      if (t && w.selectedIndex >= 0) t.textContent = w.options[w.selectedIndex].textContent;
      var c = t && t.closest('.selectboxit-container'); if (c) c.classList.remove('sc33-empty', 'sc33-err');
      var e = document.getElementById('sc33-wh-msg'); if (e) e.remove();
    });
  }

  // Хорошоп перемальовує блок доставки після кожної зміни — пишемо в поточну кнопку і пам'ятаємо текст
  var last = null;
  function msg(box, cls, text) {
    last = { cls: cls, text: text };
    box = document.getElementById('sc-npmap') || box;
    var m = box.querySelector('.sc-npmap__msg');
    if (!m) { m = document.createElement('div'); box.appendChild(m); }
    m.className = 'sc-npmap__msg ' + cls; m.textContent = text;
  }

  function loadSdk() {
    if (window.NovaPostWidget) return Promise.resolve();
    if (!sdkP) sdkP = new Promise(function (ok, no) {
      var s = document.createElement('script');
      s.src = SDK; s.async = true; s.onload = ok;
      s.onerror = function () { sdkP = null; no(new Error('sdk')); };
      document.head.appendChild(s);
    });
    return sdkP;
  }

  function currentCity() {
    var inp = document.getElementById('checkout-city');
    return inp && inp.value ? parseLabel(inp.value).base : '';
  }

  function open(box) {
    var btn = box.querySelector('button');
    btn.disabled = true;
    ga('sc_npmap_open');
    loadSdk().then(function () {
      btn.disabled = false;
      var bat = typeof window.scCoHasBattery === 'function' && window.scCoHasBattery();
      if (widget) { try { widget.destroy(); } catch (x) {} widget = null; }
      var host = document.getElementById('sc-npmap-host');
      if (!host) { host = document.createElement('div'); host.id = 'sc-npmap-host'; document.body.appendChild(host); }
      var cfg = {
        container: host, variant: 'widget', viewMode: 'popup', locale: 'uk', country: 'UA',
        divisionCategories: bat ? ['CargoBranch', 'PostBranch'] : ['PostBranch', 'CargoBranch', 'Postomat'],
        onSelect: function (d) { onPick(box, d); },
        onError: function (e) { scErr(48, e && e.message ? e : new Error(String(e))); }
      };
      var c = currentCity();
      if (c) cfg.city = c;
      widget = new window.NovaPostWidget.NovaPostWidget(cfg);
      widget.show();
    }).catch(function () {
      btn.disabled = false;
      msg(box, 'err', 'Карта зараз не завантажилась — оберіть місто й відділення у полях нижче.');
    });
  }

  function onPick(box, d) {
    if (busy || !d) return;
    if (d.source !== 'NPUA' || !d.externalId) {
      ga('sc_npmap_pick', { result: 'foreign' });
      msg(box, 'err', 'Це пункт іншого перевізника — оберіть, будь ласка, відділення чи поштомат Нової пошти.');
      return;
    }
    busy = true;
    var name = d.shortName || d.name || ('№' + d.number);
    msg(box, '', 'Підставляємо «' + name + '»…');
    apply(d).then(function () {
      ga('sc_npmap_pick', { result: 'ok', category: d.divisionCategory });
      msg(box, 'ok', '✓ Обрано: ' + name);
    }).catch(function (e) {
      ga('sc_npmap_pick', { result: 'fail', category: d.divisionCategory });
      scHealth('блок 48: не підставилось', (e && e.message || e) + ' | ' + name);
      msg(box, 'err', 'Не вдалося підставити автоматично. Оберіть, будь ласка, «' + name + '» у полі «Відділення» нижче.');
    }).then(function () { busy = false; });
  }

  function mount() {
    var ts = typeSel();
    var box = document.getElementById('sc-npmap');
    if (!ts || ts.value === TYPE.courier) { if (box) box.style.display = 'none'; return; }
    var row = ts.closest('.form-item, .form-row') || ts.parentElement;
    if (box && box.parentNode && box.previousElementSibling === row) { box.style.display = ''; return; }
    if (!box) {
      scStyle('sc-npmap-style', CSS);
      box = document.createElement('div');
      box.id = 'sc-npmap';
      box.innerHTML = '<button type="button" class="sc-npmap__btn"><img src="' + SC_NP_LOGO + '" alt="" aria-hidden="true">Обрати відділення на карті</button>';
      box.querySelector('img').onerror = function () { this.remove(); };
      box.querySelector('button').addEventListener('click', function (e) { e.preventDefault(); open(box); });
    }
    box.style.display = '';
    row.parentNode.insertBefore(box, row.nextSibling);
    if (last && !box.querySelector('.sc-npmap__msg')) msg(box, last.cls, last.text);
  }

  scReady(scSafe(48, function () {
    mount();
    setInterval(scSafe(48, mount), 1000);   // поля перемальовуються після кожної зміни — повертаємо кнопку на місце
  }));
});

