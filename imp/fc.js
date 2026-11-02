const FC_SITE='';const FC_MIN_FILL=0.3;const FC_IGNORE_FILTERS=['Ціна, грн','Наявність'];const FC_ALLOWED_COMMA=['DC 5.5/2.1, USB-C','Від короткого замикання, перевантаження'];const FC_NOT_DUPLICATES=[['2.5 мм²','25 мм²'],['802.3af/at','802.3af/at/bt']];// ---------- Категорії з меню сайту ----------
function fcCategories_() {
  const html = window.__home;
  const a = html.indexOf('productsMenu'), b = html.lastIndexOf('productsMenu');
  if (a < 0) throw new Error('Меню каталогу не знайдено на головній — можливо, сайт віддав сторінку-перевірку');
  const end = html.indexOf('</nav>', b) > 0 ? html.indexOf('</nav>', b) : b + 5000;
  const part = html.slice(a, end);
  const set = {};
  (part.match(/href="(\/[^"#?]+\/)"/g) || []).forEach(m => {
    const u = m.slice(6, -1);
    if (!/\/filter\/|\/blog\//.test(u)) set[u] = 1;
  });
  return Object.keys(set);
}

// ---------- Розбір фільтрів сторінки ----------
function fcParse_(html) {
  const sections = [];
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
  const title = h1 ? fcText_(h1) : '';

  // числові повзунки: назва з data-filer-name форми, межі з init_number_filter(uid, min, max, ...)
  const numRe = /data-filer-name="([^"]+)"[\s\S]*?filter-section-h">([\s\S]*?)<\/div>[\s\S]*?init_number_filter\(\s*"[^"]+",\s*([\d.]+),\s*([\d.]+)/g;
  let m;
  while ((m = numRe.exec(html))) {
    sections.push({ type: 'num', key: m[1], name: fcText_(m[2]), min: +m[3], max: +m[4] });
  }

  // списки значень з лічильниками
  const parts = html.split('j-filter-section').slice(1);
  parts.forEach(p => {
    const nm = p.match(/j-filter-collapse-trigger[^>]*>([\s\S]*?)<\/button>/);
    if (!nm) return;
    const name = fcText_(nm[1]);
    const values = [];
    const vr = /filter-title j-filter-title">([\s\S]*?)<\/span>[\s\S]*?filter-count">(\d+)</g;
    let v;
    const chunk = p.split(/class="filter-section[ "]/)[0];
    while ((v = vr.exec(chunk))) values.push({ label: fcText_(v[1]), count: +v[2] });
    if (values.length) sections.push({ type: 'list', name: name, values: values });
  });

  const pres = sections.find(s => s.name === 'Наявність');
  const total = pres ? pres.values.reduce((a, x) => a + x.count, 0) : 0;
  return { title: title, total: total, sections: sections };
}

// ---------- Перевірки ----------
function fcCheckPage_(url, page) {
  const out = [];
  const cat = page.title || url;
  page.sections.forEach(s => {
    if (FC_IGNORE_FILTERS.indexOf(s.name) >= 0) return;

    if (s.type === 'num') {
      if (s.min === 0 && s.max > 0) out.push(fcIssue_(cat, s.name, 'повзунок від 0 — у частини товарів значення не заповнене', url));
      return;
    }

    const vals = s.values;
    // дублі
    const seen = {};
    vals.forEach(v => {
      const k = fcNorm_(v.label);
      if (seen[k] && seen[k] !== v.label && !fcNotDup_(seen[k], v.label)) {
        out.push(fcIssue_(cat, s.name, 'дубль: «' + seen[k] + '» і «' + v.label + '»', url));
      } else seen[k] = v.label;
    });
    // склейки
    vals.forEach(v => {
      if (/, /.test(v.label) && FC_ALLOWED_COMMA.indexOf(v.label) < 0 && s.name !== 'Бренд') {
        out.push(fcIssue_(cat, s.name, 'склейка через кому: «' + v.label + '» (' + v.count + ')', url));
      }
    });
    // одне значення
    if (vals.length === 1 && vals[0].label !== 'Так' && page.total > 1) {
      out.push(fcIssue_(cat, s.name, 'лише одне значення «' + vals[0].label + '» — фільтр нічого не відсікає', url));
    }
    // мала заповненість
    const filled = vals.reduce((a, x) => a + x.count, 0);
    if (page.total >= 5 && vals.length > 1 && filled < page.total * FC_MIN_FILL) {
      out.push(fcIssue_(cat, s.name, 'заповнено ~' + Math.round(filled / page.total * 100) + '% товарів (' + filled + ' з ' + page.total + ')', url));
    }
  });
  return out;
}

function fcNorm_(s) {
  return s.toLowerCase()
    .replace(/[″”“"'’`ʼ]/g, '')
    .replace(/[\s\-_.,()\/]+/g, '')
    .replace(/х/g, 'x').replace(/с/g, 'c').replace(/а/g, 'a').replace(/о/g, 'o').replace(/р/g, 'p').replace(/е/g, 'e').replace(/і/g, 'i');
}

function fcNotDup_(a, b) {
  return FC_NOT_DUPLICATES.some(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
}

function fcIssue_(cat, filter, text, url) {
  return { cat: cat, filter: filter, text: text, url: url || cat, key: cat + '|' + filter + '|' + text.replace(/\(\d+\)|~\d+%|\d+ з \d+/g, '') };
}

function fcText_(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

