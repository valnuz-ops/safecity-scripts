#!/usr/bin/env python3
"""Збирає search/index.json для пошуку на сайті (модуль 37 safecity.js).

Джерела:
  1. Facebook-фід Хорошопа (усі товари з прапорцем «Facebook Feed»): назва, посилання, ціна, наявність, фото, бренд, розділ.
  2. Google-фід Хорошопа: id = артикул на сайті (для нових товарів, яких немає в search/codes.json).
  3. search/codes.json — внутрішній артикул Хорошопа → артикул на сайті (з експорту каталогу).
  4. Повний фід постачальника: ключові характеристики (вулична/купольна, PoE, Wi-Fi, мікрофон…) — лише для пошуку.

Запуск: FB_FEED_URL=... GOOGLE_FEED_URL=... python3 tools/build_search_index.py
"""
import json, os, re, sys, urllib.request, xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'search', 'index.json')
CODES = os.path.join(ROOT, 'search', 'codes.json')
SUPPLIER = 'https://triniti-sb.com.ua/media/feed/triniti-sb-xml-price-full-catalog.xml'
G = '{http://base.google.com/ns/1.0}'

# характеристики постачальника, що допомагають пошуку (значення додаються як текст)
SPEC_KEYS = ['Тип пристрою', 'Встановлення', 'Тип встановлення відеокамери', 'Зовнішній вигляд', 'Тип підсвічування',
             'Тип виконання', 'Тип відеосигналу', 'Тип акумулятора', 'Тип датчика', 'Тип кабелю', 'Серія', 'Колір',
             'Особливості', 'Smart функції', 'Монтаж', 'Підключення', 'Матеріал корпусу']
FLAG_KEYS = {'PoE': 'PoE', 'Wi-Fi': 'Wi-Fi', 'Мікрофон': 'мікрофон', 'Підтримка PoE': 'PoE'}
# діапазон ваги, під який підходить товар (поле r індексу): «доводчик на двері 30 кг» → лише ті, де 30 кг у діапазоні
RANGE_KEYS = {'Маса дверного полотна'}

# числові характеристики для пошуку «від N» (поле q індексу, «pw:600,va:1000,ch:8»): «ДБЖ для котла 150 Вт»,
# «реєстратор на 6 камер», «камера 50 м», «кабель hdmi 15 м»… Ключ: (параметр постачальника, що з нього брати)
def _nums(v):
    return [float(x.replace(',', '.')) for x in re.findall(r'\d+(?:[.,]\d+)?', v)]
def _unit(v, units, mult=1):
    """найбільше число, за яким іде одиниця з units (регулярний вираз), помножене на mult"""
    vals = [float(m.group(1).replace(',', '.')) * mult for m in re.finditer(r'(\d+(?:[.,]\d+)?)\s*(?:' + units + r')(?![а-яa-z])', v, re.I)]
    return max(vals) if vals else None
QTY_RULES = [
    # (ключ, параметри у порядку пріоритету, функція)
    ('pw', ['Номінальна потужність', 'Потужність', 'Вихід змінного струму (AC)', 'Максимальна потужність', 'Вихідна потужність'],
        lambda v: _unit(v, 'квт|kw', 1000) or _unit(v, 'вт|w')),
    ('va', ['Потужність', 'Максимальна потужність'], lambda v: _unit(v, 'ква|kva', 1000) or _unit(v, 'ва|va')),
    ('wh', ['Ємність', 'Максимальна енергоємність'], lambda v: _unit(v, r'квт\s?[*·]?\s?год|kwh', 1000) or _unit(v, r'вт\s?[*·]?\s?год|втг|wh')),
    ('ah', ['Ємність акумулятора'], lambda v: _unit(v, r'ah|аг|а\s?[*·]?\s?год')),
    ('mah', ['Ємність батареї'], lambda v: _unit(v, r'mah|ма\s?[*·]?\s?год|маг')),
    ('ao', ['Вихідний струм'], lambda v: _unit(v, 'а|a')),
    ('al', ['Максимальний струм навантаження'], lambda v: _unit(v, 'а|a')),
    ('ai', ['Номінальний струм'], lambda v: _unit(v, 'а|a')),
    ('ch', ['Кількість каналів IP'], lambda v: (_nums(v) or [None])[0]),
    ('ir', ['Дальність підсвічування'], lambda v: _unit(v, 'м|m')),
    ('hdd', ['Внутрішні HDD'], lambda v: _unit(v, 'тб|tb')),
    ('kg', ['Навантаження'], lambda v: _unit(v, 'кг|kg')),
    ('hold', ['Сила утримання'], lambda v: _unit(v, 'кг|kg')),
    ('ab', ['Кількість абонентів'], lambda v: (_nums(v) or [None])[0]),
    ('boom', ['Довжина стріли'], lambda v: _unit(v, 'м|m')),
    ('len', ['Довжина кабелю', 'Довжина'], lambda v: _unit(v, 'м|m')),
]
def qty_of(params):
    out = []
    for key, names, fn in QTY_RULES:
        for n in names:
            v = params.get(n)
            if not v:
                continue
            try:
                x = fn(v)
            except Exception:
                x = None
            if x:
                out.append('%s:%g' % (key, x))
                break
    return ','.join(out)


# --- нормалізація тексту — ТОЧНА копія normText() з модуля 37 safecity.js (PHRASES) ---
# Робимо її тут, щоб браузер не ганяв ~20 регулярних виразів по кожному з 4,6 тис. товарів (≈1 с на ПК, кілька — на телефоні).
_W = '0-9a-zа-яіїєґ'
_B, _E, _N = '(?<![' + _W + '])', '(?![' + _W + '])', r'(\d+(?:[.,]\d+)?)\s?'
def _R(src): return re.compile(src.replace('\\b<', _B).replace('\\b>', _E))
PHRASES = [
    (_R(r'\b<(?:power ?bank|павер ?банк|повер ?банк|пауер ?банк)\S*'), 'повербанк'),
    (_R(r'\b<(?:wi[\s-]?fi|вай[\s-]?фай|вифи|віфі)\b>'), 'wifi'),
    (_R(r'\b<(?:ip|іп)[\s-]?камер'), 'ip камер'),
    (_R(_N + r'(?:мп|mp|мегапікс\S*|мегапикс\S*|mpx)\b>'), r'\1mp'),
    (_R(_N + r'(?:ah|аг|а·год|а\*год|ач|а·ч|а\*ч|а год|ампер ?год\S*)\b>'), r'\1ah'),
    (_R(_N + r'(?:mah|маг|ма·год|мач|ма·ч|ма год)\b>'), r'\1mah'),
    (_R(_N + r'(?:kwh|квт·год|квт\*год|квт год|квтг|квтч)\b>'), r'\1kwh'),
    (_R(_N + r'(?:wh|вт·год|вт\*год|вт год|втг|втч)\b>'), r'\1wh'),
    (_R(_N + r'(?:kva|ква)\b>'), r'\1kva'),
    (_R(_N + r'(?:va|ва)\b>'), r'\1va'),
    (_R(_N + r'(?:kw|квт|кв)\b>'), r'\1kw'),
    (_R(_N + r'(?:w|вт|vt|ват\S*)\b>'), r'\1w'),
    (_R(_N + r'(?:v|в|вольт\S*)\b>'), r'\1v'),
    (_R(_N + r'(?:a|а|ампер\S*)\b>'), r'\1a'),
    (_R(_N + r'(?:mm|мм)\b>'), r'\1мм'),
    (_R(_N + r'(?:cm|см)\b>'), r'\1см'),
    (_R(_N + r'(?:kg|кг|кілограм\S*|килограм\S*)\b>'), r'\1kg'),
    (_R(_N + r'(?:m|м|метр\S*)\b>'), r'\1м'),
    (_R(r'(\d+)\s?-?\s?(?:х\s?)?(?:канал\S*|кан|ch|channel\S*)\b>'), r'\1канал'),
    (_R(r'(\d+)\s?-?\s?(?:порт\S*|port\S*)\b>'), r'\1порт'),
    (_R(r'(\d+)\s?(?:tb|тб)\b>'), r'\1tb'), (_R(r'(\d+)\s?(?:gb|гб)\b>'), r'\1gb'),
]
def norm_text(s):
    s = ' ' + re.sub('[’`ʼ]', "'", (s or '').lower()).replace('ё', 'е') + ' '
    s = re.sub(r'(\d),(\d)', r'\1.\2', s)
    s = re.sub(r'(?<![0-9a-zа-яіїєґ.])(\d{1,3}) (\d{3})(?!\d)', r'\1\2', s)   # «30 000» → 30000, але не «lifepo4 200ah»
    for rx, rep in PHRASES:
        s = rx.sub(rep, s)
    s = re.sub(r"[^a-z0-9а-яіїєґ.\-+/' ]", ' ', s)
    toks = [re.sub(r"^[.\-+']+|[.\-+']+$", '', t) for t in re.split(r'[\s/]+', s)]
    return ' '.join(t for t in toks if t)


def get(url, timeout=180):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; SafeCitySearchIndex/1.0)'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def text(el, tag):
    x = el.find(G + tag)
    return (x.text or '').strip() if x is not None and x.text else ''


def thumb(url):
    # /content/images/13/21860255606531_+b891c032b4.jpg -> /content/images/13/160x160l80nn0/21860255606531.webp
    # SEO-назви (10.11.2026): /content/images/42/akumuljator-…-85129030621278.jpg -> …/160x160l80nn0/akumuljator-…-85129030621278.webp
    # (мініатюра Хорошопу відкривається лише з повною назвою файлу; без неї — 404, і в пошуку не було фото у 97 товарів)
    m = re.search(r'/content/images/(\d+)/([^/]+?)(?:_\+[0-9a-f]+)?\.\w+$', url or '')
    return '/content/images/%s/160x160l80nn0/%s.webp' % (m.group(1), m.group(2)) if m else ''


def main():
    fb_url, g_url = os.environ.get('FB_FEED_URL'), os.environ.get('GOOGLE_FEED_URL')
    if not fb_url:
        sys.exit('FB_FEED_URL not set')
    codes = json.load(open(CODES, encoding='utf-8')) if os.path.exists(CODES) else {}

    link2code, g_stock = {}, {}   # g_stock: наявність із Google-фіду — він свіжіший за Facebook-фід (10.11: 73-01018)
    if g_url:
        try:
            groot = ET.fromstring(get(g_url))
            for it in groot.iter('item'):
                link2code[text(it, 'link')] = text(it, 'id')
                g_stock[text(it, 'link')] = text(it, 'availability') == 'in stock'
        except Exception as e:
            print('google feed failed:', e)

    specs, ranges, qtys = {}, {}, {}
    try:
        sroot = ET.fromstring(get(SUPPLIER, 300))
        for o in sroot.iter('offer'):
            vals, params = [], {}
            for p in o.findall('param'):
                n, v = p.get('name', '').strip(), (p.text or '').strip()
                if not v or v == '-':
                    continue
                params.setdefault(n, v)
                if n in RANGE_KEYS:                           # «25-60 кг» → '25-60', «180 кг» → '0-180'
                    m = re.match(r'^\s*(?:(\d+(?:[.,]\d+)?)\s*[-–]\s*)?(\d+(?:[.,]\d+)?)\s*кг', v)
                    if m:
                        hi = float(m.group(2).replace(',', '.'))
                        # лише верхня межа («180 кг») — як у фільтрі «Вага дверей»: лише верхня група (150–180)
                        lo = float(m.group(1).replace(',', '.')) if m.group(1) else max([b for b in (0, 25, 45, 65, 85, 120, 150) if b < hi])
                        ranges[o.get('id')] = '%g-%g' % (lo, hi)
                if n in FLAG_KEYS:
                    if v.lower().startswith('так'):
                        vals.append(FLAG_KEYS[n])
                elif n in SPEC_KEYS and len(v) <= 60:
                    vals.append(v)
            seen, out = set(), []
            for v in vals:
                for part in re.split(r'[,;]\s*', v):
                    k = part.lower()
                    if part and k not in seen:
                        seen.add(k); out.append(part)
            specs[o.get('id')] = ' '.join(out)[:200]
            q = qty_of(params)
            if q:
                qtys[o.get('id')] = q
    except Exception as e:
        print('supplier feed failed:', e)

    root = ET.fromstring(get(fb_url))
    items, nocode = [], 0
    for it in root.iter('item'):
        sku, link = text(it, 'id'), text(it, 'link')
        code = codes.get(sku) or link2code.get(link, '')
        if not code:
            nocode += 1
        price = re.sub(r'[^\d.]', '', text(it, 'price').split(' ')[0]) or '0'
        cat = text(it, 'product_type').split('>')[-1].strip()
        items.append([
            text(it, 'title'),
            re.sub(r'^https?://[^/]+', '', link),
            int(round(float(price))),
            1 if g_stock.get(link, text(it, 'availability') == 'in stock') else 0,
            thumb(text(it, 'image_link')),
            text(it, 'brand'),
            cat,
            code + (' ' + sku if sku and sku != code else ''),   # артикул на сайті + внутрішній (його теж шукають)
            specs.get(code, ''),
        ])
        it_ = items[-1]
        it_.append(norm_text(it_[0]))                                   # wn — назва, нормалізована
        it_.append(norm_text((it_[5] or '') + ' ' + (it_[6] or '')))    # wo — бренд + розділ
        it_.append(norm_text(it_[8]))                                   # wx — характеристики
        it_.append(ranges.get(code, ''))                                # r — діапазон ваги дверей, кг («25-60»)
        it_.append(qtys.get(code, ''))                                  # q — числові характеристики («pw:600,va:1000»)
    if len(items) < 1000:
        sys.exit('too few items (%d) — keeping old index' % len(items))
    data = {'v': 2, 'f': ['n', 'u', 'p', 's', 'i', 'b', 'k', 'c', 'x', 'wn', 'wo', 'wx', 'r', 'q'], 'items': items}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('items', len(items), 'without code', nocode, 'with ranges', sum(1 for i in items if i[12]), 'with qty', sum(1 for i in items if i[13]), 'with specs', sum(1 for i in items if i[8]), 'bytes', os.path.getsize(OUT))


if __name__ == '__main__':
    main()
