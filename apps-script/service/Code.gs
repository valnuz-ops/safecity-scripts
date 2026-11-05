/**
 * SafeCity — сервісні заявки: приймає заявки з форми на сторінці «Сервісний центр»
 * (safecity.js, блок 34), дає номер (SC-0001, SC-0002…), пише в Google-таблицю і надсилає в Telegram.
 *
 * ЯК НАЛАШТУВАТИ
 * 1. script.google.com → «Новий проєкт» → назва «SafeCity — сервісні заявки» →
 *    вставте весь цей файл замість вмісту Code.gs.
 * 2. Впишіть свої значення в блок «НАЛАШТУВАННЯ» нижче (TG_TOKEN, TG_CHAT; SHEET_ID — за бажанням) → «Зберегти».
 *    Увага: у публічний репозиторій GitHub цей файл зі справжнім токеном НЕ комітимо.
 * 3. Виберіть функцію setup → «Виконати», дайте дозволи. Скрипт створить у вашому Google Диску таблицю
 *    «SafeCity — сервісні заявки» (якщо SHEET_ID порожній) і надішле в Telegram тестове повідомлення
 *    з посиланням на неї.
 * 4. «Розгорнути» → «Нове розгортання» → тип «Веб-застосунок»:
 *      «Виконувати як» — «Я»; «Хто має доступ» — «Усі» → «Розгорнути».
 * 5. Скопіюйте URL веб-застосунку (https://script.google.com/macros/s/…/exec) і вставте його
 *    в текст сторінки «Сервісний центр» у Хорошопі: <div data-sc-service-form data-url="…/exec"></div>.
 *    Відкрийте цей URL у браузері — має показати «SafeCity service: ok».
 * Після змін у цьому коді: «Розгорнути» → «Керувати розгортаннями» → ✏️ → «Нова версія»
 * (URL лишається той самий).
 *
 * Захист від спаму: приймаємо лише заявки зі сторінок safecity.in.ua, поле-пастка website має бути
 * порожнім; повтор тієї самої заявки (телефон + модель) протягом 30 хв повертає той самий номер;
 * не більше 20 заявок на годину.
 */

/* ===== НАЛАШТУВАННЯ ===== */
var TG_TOKEN = '';   // токен Telegram-бота від @BotFather, напр. '123456789:AAH…'
var TG_CHAT  = '';   // chat_id, куди писати: ваш id або id групи, напр. '-1001234567890'
var SHEET_ID = '';   // id своєї таблиці (з адреси …/spreadsheets/d/ID/edit); порожньо — setup створить нову
/* ======================== */

var MAX_PER_HOUR = 20;
var REPEAT_SECONDS = 30 * 60;
var SITE = /^https:\/\/(www\.)?safecity\.in\.ua\//;
var SHEET_NAME = 'Заявки';
var STATUS_NEW = 'Нова';

// [ключ у формі, назва колонки, макс. довжина] — порядок колонок у таблиці після «Дата», «№», «Статус»
var FIELDS = [
  ['name', 'ПІБ', 120],
  ['phone', 'Телефон', 40],
  ['email', 'Email', 120],
  ['company', 'Компанія', 160],
  ['order', 'Замовлення / дата покупки', 80],
  ['kind', 'Вид звернення', 80],
  ['model', 'Модель', 160],
  ['serial', 'Серійний номер', 80],
  ['problem', 'Несправність', 2000],
  ['kit', 'Комплектація', 1000],
  ['extra', 'Додатково', 1000],
  ['how', 'Як передає', 80],
  ['ttn', 'ТТН', 40],
  ['back', 'Куди повернути', 200]
];
var REQUIRED = ['name', 'phone', 'kind', 'model', 'problem', 'how'];

function doPost(e) {
  var res;
  try {
    res = handle_(JSON.parse((e && e.postData && e.postData.contents) || '{}'));
  } catch (err) {
    console.error(err);
    res = { ok: false, error: 'server' };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('SafeCity service: ok');
}

function handle_(r) {
  var page = clip_(r.page, 300);
  if (!SITE.test(page)) return { ok: false, error: 'site' };
  if (r.website) return { ok: true, num: 'SC-0000' };          // бот заповнив пастку: «приймаємо», але нікуди не пишемо

  var f = r.form || {}, d = {};
  FIELDS.forEach(function (x) { d[x[0]] = clipMulti_(f[x[0]], x[2]); });
  for (var i = 0; i < REQUIRED.length; i++) if (!d[REQUIRED[i]]) return { ok: false, error: 'required:' + REQUIRED[i] };
  if (d.phone.replace(/\D/g, '').length < 10) return { ok: false, error: 'phone' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
  var num;
  try {
    var cache = CacheService.getScriptCache();
    var repeatKey = 'r:' + hash_(d.phone.replace(/\D/g, '') + '|' + d.model.toLowerCase());
    var prev = cache.get(repeatKey);
    if (prev) return { ok: true, num: prev };                  // подвійне натискання / повторна відправка

    var hourKey = 'h:' + Math.floor(Date.now() / 3600000);
    var count = Number(cache.get(hourKey) || 0);
    if (count >= MAX_PER_HOUR) return { ok: false, error: 'limit' };

    var props = PropertiesService.getScriptProperties();
    var n = Number(props.getProperty('LAST_NUM') || 0) + 1;
    num = 'SC-' + ('000' + n).slice(-4);

    var sh = sheet_();
    sh.appendRow([new Date(), num, STATUS_NEW].concat(FIELDS.map(function (x) { return cell_(d[x[0]]); })).concat([page]));

    props.setProperty('LAST_NUM', String(n));
    cache.put(repeatKey, num, REPEAT_SECONDS);
    cache.put(hourKey, String(count + 1), 3600);
  } finally {
    lock.releaseLock();
  }

  try {
    send_(message_(num, d));
  } catch (err) {
    console.error(err);                                         // заявка вже в таблиці — клієнту відповідаємо «ок»
  }
  return { ok: true, num: num };
}

// Текст для Telegram: усі поля — його ж зручно переслати в сервіс TRINITI-SB
function message_(num, d) {
  var lines = ['🛠 Сервісна заявка ' + num, ''];
  FIELDS.forEach(function (x) {
    if (d[x[0]]) lines.push(x[1] + ': ' + d[x[0]]);
  });
  var digits = d.phone.replace(/\D/g, '');
  if (digits.length === 10 && digits.charAt(0) === '0') digits = '38' + digits;
  lines.push('', 'Viber: viber://chat?number=%2B' + digits);
  var id = conf_('SHEET_ID', SHEET_ID);
  if (id) lines.push('Таблиця: https://docs.google.com/spreadsheets/d/' + id);
  return lines.join('\n').slice(0, 4000);
}

// Значення з блоку НАЛАШТУВАННЯ, інакше — з властивостей скрипту (там setup зберігає id створеної таблиці)
function conf_(name, val) {
  return val || PropertiesService.getScriptProperties().getProperty(name) || '';
}

function sheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = conf_('SHEET_ID', SHEET_ID);
  var ss;
  if (id) ss = SpreadsheetApp.openById(id);
  else {
    ss = SpreadsheetApp.create('SafeCity — сервісні заявки');
    props.setProperty('SHEET_ID', ss.getId());
  }
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.getSheets()[0];
    if (sh.getLastRow() > 0) sh = ss.insertSheet(SHEET_NAME);
    else sh.setName(SHEET_NAME);
  }
  if (sh.getLastRow() === 0) {
    var head = ['Дата', '№', 'Статус'].concat(FIELDS.map(function (x) { return x[1]; })).concat(['Сторінка', 'Примітки']);
    sh.appendRow(head);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#e8f0fe');
    sh.getRange('A:A').setNumberFormat('dd.mm.yyyy HH:mm');
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList([STATUS_NEW, 'Підтверджено', 'Відправлено в сервіс', 'У сервісі', 'Готово', 'Повернуто клієнту', 'Відмова'], true)
      .build();
    sh.getRange('C2:C').setDataValidation(rule);
    sh.getRange('L:N').setWrap(true);
    sh.setColumnWidth(12, 300);
  }
  return sh;
}

// Перший запуск вручну: створює таблицю і перевіряє Telegram
function setup() {
  var sh = sheet_();
  var url = sh.getParent().getUrl();
  console.log('Таблиця: ' + url);
  send_('✅ SafeCity: сервісні заявки підключено.\nТаблиця: ' + url);
}

function send_(text) {
  var token = conf_('TG_TOKEN', TG_TOKEN), chat = conf_('TG_CHAT', TG_CHAT);
  if (!token || !chat) throw new Error('Впишіть TG_TOKEN і TG_CHAT у блок НАЛАШТУВАННЯ');
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    payload: { chat_id: chat, text: text, disable_web_page_preview: 'true' },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) console.error('Telegram: ' + res.getResponseCode() + ' ' + res.getContentText());
}

// Одним рядком (для коротких полів) / з переносами (для описів)
function clip_(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n); }
function clipMulti_(s, n) {
  return String(s == null ? '' : s).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
}

// Текст, що починається з = + - @, таблиця сприйняла б як формулу
function cell_(s) { return /^[=+\-@]/.test(s) ? "'" + s : s; }

function hash_(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
