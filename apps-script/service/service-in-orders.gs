// SafeCity: сервісні заявки з форми на сторінці «Сервісний центр» (safecity.js, блок 34)
// → номер заявки (SC-0001…), рядок у Google-таблиці, повідомлення в Telegram.
// Окремий файл у проєкті замовлень: токен і chat_id беруться з config.gs (TG_TOKEN, TG_CHAT_ID).
// Усі імена з префіксом svc / SVC — не перетинаються з файлами замовлень і посилок.
//
// ЯК ПІДКЛЮЧИТИ
// 1. У проєкті замовлень: «+» біля «Файли» → «Скрипт» → назва service → вставте весь цей файл → «Зберегти».
// 2. Виберіть функцію svcSetup → «Виконати», дайте дозволи (Таблиці). Створиться таблиця
//    «SafeCity — сервісні заявки», у Telegram прийде повідомлення з посиланням на неї.
// 3. «Розгорнути» → «Нове розгортання» → тип «Веб-застосунок»: «Виконувати як» — «Я»,
//    «Хто має доступ» — «Усі» → «Розгорнути». URL (…/exec) вставте в сторінку «Сервісний центр»:
//    <div data-sc-service-form data-url="…/exec"></div>
// Після змін у коді: «Розгорнути» → «Керувати розгортаннями» → ✏️ → «Нова версія» (URL той самий).

// ===================== НАЛАШТУВАННЯ =====================
const SVC_SHEET_ID = '';   // id своєї таблиці; порожньо — svcSetup створить нову
// ========================================================

var SVC_MAX_PER_HOUR = 20;
var SVC_REPEAT_SECONDS = 30 * 60;
var SVC_SITE = /^https:\/\/(www\.)?safecity\.in\.ua\//;
var SVC_SHEET_NAME = 'Заявки';
var SVC_STATUS_NEW = 'Нова';

// [ключ у формі, назва колонки, макс. довжина] — порядок колонок у таблиці після «Дата», «№», «Статус»
var SVC_FIELDS = [
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
var SVC_REQUIRED = ['name', 'phone', 'kind', 'model', 'problem', 'how'];

function doPost(e) {
  var res;
  try {
    res = svcHandle_(JSON.parse((e && e.postData && e.postData.contents) || '{}'));
  } catch (err) {
    console.error(err);
    res = { ok: false, error: 'server' };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('SafeCity service: ok');
}

function svcHandle_(r) {
  var page = svcClip_(r.page, 300);
  if (!SVC_SITE.test(page)) return { ok: false, error: 'site' };
  if (r.website) return { ok: true, num: 'SC-0000' };          // бот заповнив пастку: «приймаємо», але нікуди не пишемо

  var f = r.form || {}, d = {};
  SVC_FIELDS.forEach(function (x) { d[x[0]] = svcClipMulti_(f[x[0]], x[2]); });
  for (var i = 0; i < SVC_REQUIRED.length; i++) if (!d[SVC_REQUIRED[i]]) return { ok: false, error: 'required:' + SVC_REQUIRED[i] };
  if (d.phone.replace(/\D/g, '').length < 10) return { ok: false, error: 'phone' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
  var num;
  try {
    var cache = CacheService.getScriptCache();
    var repeatKey = 'r:' + svcHash_(d.phone.replace(/\D/g, '') + '|' + d.model.toLowerCase());
    var prev = cache.get(repeatKey);
    if (prev) return { ok: true, num: prev };                  // подвійне натискання / повторна відправка

    var hourKey = 'h:' + Math.floor(Date.now() / 3600000);
    var count = Number(cache.get(hourKey) || 0);
    if (count >= SVC_MAX_PER_HOUR) return { ok: false, error: 'limit' };

    var props = PropertiesService.getScriptProperties();
    var n = Number(props.getProperty('SVC_LAST_NUM') || 0) + 1;
    num = 'SC-' + ('000' + n).slice(-4);

    var sh = svcSheet_();
    sh.appendRow([new Date(), num, SVC_STATUS_NEW].concat(SVC_FIELDS.map(function (x) { return svcCell_(d[x[0]]); })).concat([page]));

    props.setProperty('SVC_LAST_NUM', String(n));
    cache.put(repeatKey, num, SVC_REPEAT_SECONDS);
    cache.put(hourKey, String(count + 1), 3600);
  } finally {
    lock.releaseLock();
  }

  try {
    svcSend_(svcMessage_(num, d));
  } catch (err) {
    console.error(err);                                         // заявка вже в таблиці — клієнту відповідаємо «ок»
  }
  return { ok: true, num: num };
}

// Текст для Telegram: усі поля — його ж зручно переслати в сервіс TRINITI-SB
function svcMessage_(num, d) {
  var lines = ['🛠 Сервісна заявка ' + num, ''];
  SVC_FIELDS.forEach(function (x) {
    if (d[x[0]]) lines.push(x[1] + ': ' + d[x[0]]);
  });
  var digits = d.phone.replace(/\D/g, '');
  if (digits.length === 10 && digits.charAt(0) === '0') digits = '38' + digits;
  lines.push('', 'Viber: viber://chat?number=%2B' + digits);
  var id = svcConf_('SVC_SHEET_ID', SVC_SHEET_ID);
  if (id) lines.push('Таблиця: https://docs.google.com/spreadsheets/d/' + id);
  return lines.join('\n').slice(0, 4000);
}

// Значення з блоку НАЛАШТУВАННЯ, інакше — з властивостей скрипту (там svcSetup зберігає id створеної таблиці)
function svcConf_(name, val) {
  return val || PropertiesService.getScriptProperties().getProperty(name) || '';
}

function svcSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = svcConf_('SVC_SHEET_ID', SVC_SHEET_ID);
  var ss;
  if (id) ss = SpreadsheetApp.openById(id);
  else {
    ss = SpreadsheetApp.create('SafeCity — сервісні заявки');
    props.setProperty('SVC_SHEET_ID', ss.getId());
  }
  var sh = ss.getSheetByName(SVC_SHEET_NAME);
  if (!sh) {
    sh = ss.getSheets()[0];
    if (sh.getLastRow() > 0) sh = ss.insertSheet(SVC_SHEET_NAME);
    else sh.setName(SVC_SHEET_NAME);
  }
  if (sh.getLastRow() === 0) {
    var head = ['Дата', '№', 'Статус'].concat(SVC_FIELDS.map(function (x) { return x[1]; })).concat(['Сторінка', 'Примітки']);
    sh.appendRow(head);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#e8f0fe');
    sh.getRange('A:A').setNumberFormat('dd.mm.yyyy HH:mm');
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList([SVC_STATUS_NEW, 'Підтверджено', 'Відправлено в сервіс', 'У сервісі', 'Готово', 'Повернуто клієнту', 'Відмова'], true)
      .build();
    sh.getRange('C2:C').setDataValidation(rule);
    sh.getRange('L:N').setWrap(true);
    sh.setColumnWidth(12, 300);
  }
  return sh;
}

// Перший запуск вручну: створює таблицю і перевіряє Telegram
function svcSetup() {
  var sh = svcSheet_();
  var url = sh.getParent().getUrl();
  console.log('Таблиця: ' + url);
  svcSend_('✅ SafeCity: сервісні заявки підключено.\nТаблиця: ' + url);
}

function svcSend_(text) {
  var token = String(TG_TOKEN).trim(), chat = String(TG_CHAT_ID).trim();   // з config.gs цього ж проєкту
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    payload: { chat_id: chat, text: text, disable_web_page_preview: 'true' },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) console.error('Telegram: ' + res.getResponseCode() + ' ' + res.getContentText());
}

// Одним рядком (для коротких полів) / з переносами (для описів)
function svcClip_(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n); }
function svcClipMulti_(s, n) {
  return String(s == null ? '' : s).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
}

// Текст, що починається з = + - @, таблиця сприйняла б як формулу
function svcCell_(s) { return /^[=+\-@]/.test(s) ? "'" + s : s; }

function svcHash_(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
