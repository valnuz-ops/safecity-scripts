#!/bin/sh
# Збірка: src/safecity.js (читабельний код, редагуємо тут) → safecity.js (стиснений, підключений на сайті)
set -e
cd "$(dirname "$0")"
ESBUILD=${ESBUILD:-esbuild}
# Версія збірки (SC_BUILD у коді): дата й час UTC; можна задати вручну: SC_BUILD=… ./build.sh
SC_BUILD=${SC_BUILD:-$(date -u '+%Y-%m-%d %H:%M')}
{ printf '/* SafeCity — стиснена збірка. Код для редагування: src/safecity.js, збірка: ./build.sh */\n'
  "$ESBUILD" src/safecity.js --minify --target=es2015 --legal-comments=none --charset=utf8 --log-level=warning \
    "--define:__SC_BUILD__=\"$SC_BUILD\""
} > safecity.js
node --check safecity.js
echo "SC_BUILD = $SC_BUILD"
wc -c src/safecity.js safecity.js
