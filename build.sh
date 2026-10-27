#!/bin/sh
# Збірка: src/safecity.js (читабельний код, редагуємо тут) → safecity.js (стиснений, підключений на сайті)
set -e
cd "$(dirname "$0")"
ESBUILD=${ESBUILD:-esbuild}
{ printf '/* SafeCity — стиснена збірка. Код для редагування: src/safecity.js, збірка: ./build.sh */\n'
  "$ESBUILD" src/safecity.js --minify --target=es2015 --legal-comments=none --charset=utf8 --log-level=warning
} > safecity.js
node --check safecity.js
wc -c src/safecity.js safecity.js
