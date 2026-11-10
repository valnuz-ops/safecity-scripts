#!/usr/bin/env python3
"""Збирає search/stock.json — наявність товарів для пошуку на сайті (модуль 37 safecity.js), щогодини вдень.

Індекс пошуку (search/index.json, 2.7 МБ) збирається раз на ніч, а наявність змінюється протягом дня.
Цей файл маленький: лише артикули сайту товарів у наявності. Джерела — фіди Хорошопу, які віддаються щоразу
свіжими (no-cache): Google-фід (свіжіший, але не всі товари) і Facebook-фід (решта товарів).
Сайт вантажить stock.json разом з індексом і підставляє наявність замість нічної.

Запуск: FB_FEED_URL=... GOOGLE_FEED_URL=... python3 tools/build_stock.py
"""
import json, os, re, sys, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'search', 'stock.json')
CODES = os.path.join(ROOT, 'search', 'codes.json')
G = '{http://base.google.com/ns/1.0}'


def get(url, timeout=180):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; SafeCitySearchIndex/1.0)'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def text(el, tag):
    v = el.find(G + tag)
    if v is None:
        v = el.find(tag)
    return (v.text or '').strip() if v is not None and v.text else ''


def main():
    fb_url, g_url = os.environ.get('FB_FEED_URL'), os.environ.get('GOOGLE_FEED_URL')
    if not fb_url or not g_url:
        sys.exit('FB_FEED_URL / GOOGLE_FEED_URL not set')
    codes = json.load(open(CODES, encoding='utf-8')) if os.path.exists(CODES) else {}
    g = {}
    for it in ET.fromstring(get(g_url)).iter('item'):
        g[text(it, 'link')] = (text(it, 'id'), text(it, 'availability') == 'in stock')
    ins, total = [], 0
    for it in ET.fromstring(get(fb_url)).iter('item'):
        total += 1
        link, sku = text(it, 'link'), text(it, 'id')
        code, s = codes.get(sku), text(it, 'availability') == 'in stock'
        if link in g:
            code = code or g[link][0]
            s = g[link][1]
        if s:
            ins.append(re.sub(r'^https?://[^/]+', '', link))
    if total < 1000:
        sys.exit('too few items (%d) — keeping old stock' % total)
    ins.sort()
    data = {'t': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), 'n': total, 'in': ins}
    old = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    if old.get('in') == ins:
        print('stock unchanged:', len(ins), 'of', total)
        return
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('in stock', len(ins), 'of', total, 'bytes', os.path.getsize(OUT))


if __name__ == '__main__':
    main()
