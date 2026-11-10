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


def get(url, timeout=180):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; SafeCitySearchIndex/1.0)'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def text(el, tag):
    x = el.find(G + tag)
    return (x.text or '').strip() if x is not None and x.text else ''


def thumb(url):
    # /content/images/13/21860255606531_+b891c032b4.jpg -> /content/images/13/160x160l80nn0/21860255606531.webp
    m = re.search(r'/content/images/(\d+)/(\d+)[^/]*\.\w+$', url or '')
    return '/content/images/%s/160x160l80nn0/%s.webp' % (m.group(1), m.group(2)) if m else ''


def main():
    fb_url, g_url = os.environ.get('FB_FEED_URL'), os.environ.get('GOOGLE_FEED_URL')
    if not fb_url:
        sys.exit('FB_FEED_URL not set')
    codes = json.load(open(CODES, encoding='utf-8')) if os.path.exists(CODES) else {}

    link2code = {}
    if g_url:
        try:
            groot = ET.fromstring(get(g_url))
            for it in groot.iter('item'):
                link2code[text(it, 'link')] = text(it, 'id')
        except Exception as e:
            print('google feed failed:', e)

    specs = {}
    try:
        sroot = ET.fromstring(get(SUPPLIER, 300))
        for o in sroot.iter('offer'):
            vals = []
            for p in o.findall('param'):
                n, v = p.get('name', '').strip(), (p.text or '').strip()
                if not v or v == '-':
                    continue
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
            1 if text(it, 'availability') == 'in stock' else 0,
            thumb(text(it, 'image_link')),
            text(it, 'brand'),
            cat,
            code,
            specs.get(code, ''),
        ])
    if len(items) < 1000:
        sys.exit('too few items (%d) — keeping old index' % len(items))
    data = {'v': 1, 'f': ['n', 'u', 'p', 's', 'i', 'b', 'k', 'c', 'x'], 'items': items}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('items', len(items), 'without code', nocode, 'with specs', sum(1 for i in items if i[8]), 'bytes', os.path.getsize(OUT))


if __name__ == '__main__':
    main()
