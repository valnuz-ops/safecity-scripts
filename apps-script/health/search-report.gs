/**
 * SafeCity — тижневий звіт про пошук на сайті в Telegram.
 *
 * Що надсилає щопонеділка: які запити не знайшли нічого, які знайшли лише «схожі товари», найчастіші
 * запити й скільки шукали голосом. Дані — з GA4 (події sc_search, sc_search_zero, sc_search_partial,
 * sc_search_voice, які шле блок 37 safecity.js), тож нічого додатково налаштовувати в GA4 не треба.
 *
 * ЯК НАЛАШТУВАТИ (у тому ж проєкті Apps Script, що й «сторож» health/Code.gs — там уже є TG_TOKEN і TG_CHAT)
 * 1. «+» біля «Файли» → «Скрипт» → назва search-report → вставте весь цей файл → «Зберегти».
 * 2. Ліворуч «Служби» (Services) → «+» → «Google Analytics Data API» → «Додати» (ідентифікатор AnalyticsData).
 * 3. Виберіть функцію testSearchReport → «Виконати» → дайте дозволи. У Telegram має прийти звіт.
 *    Обліковий запис Google, від якого працює скрипт, має бачити GA4-ресурс SafeCity (хоча б «Переглядач»).
 * 4. Виберіть функцію setupSearchReportTrigger → «Виконати» — звіт ходитиме щопонеділка о 9:00.
 * Повторний запуск setupSearchReportTrigger не створює дублів.
 */

var GA4_PROPERTY = 'properties/517401487';
var SEARCH_PAGE = 'https://safecity.in.ua/katalog/search/?q=';

function testSearchReport() { sendSearchReport(); }

function setupSearchReportTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendSearchReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendSearchReport').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
}

function sendSearchReport() {
  var rows = gaSearchRows_('7daysAgo', 'yesterday');
  var by = { sc_search: {}, sc_search_zero: {}, sc_search_partial: {}, sc_search_voice: {} };
  rows.forEach(function (r) {
    var ev = r[0], term = cleanTerm_(r[1]), n = r[2];
    if (!term || !by[ev]) return;
    by[ev][term] = (by[ev][term] || 0) + n;
  });

  var all = by.sc_search, total = sum_(all);
  var zero = dropTypedPrefixes_(by.sc_search_zero, all);
  var partial = dropTypedPrefixes_(by.sc_search_partial, all);
  var top = dropTypedPrefixes_(all, all);
  var voice = sum_(by.sc_search_voice);

  var tz = Session.getScriptTimeZone(), now = new Date();
  var from = Utilities.formatDate(new Date(now.getTime() - 7 * 864e5), tz, 'dd.MM');
  var to = Utilities.formatDate(new Date(now.getTime() - 864e5), tz, 'dd.MM');

  var msg = ['🔎 <b>Пошук на safecity.in.ua</b>, ' + from + '–' + to,
    'Пошуків: ' + total + ', різних запитів: ' + Object.keys(top).length + (voice ? ', голосом: ' + voice : '')];
  msg.push(section_('❌ <b>Нічого не знайшли</b> — додати синонім або товар', zero, 15));
  msg.push(section_('⚠️ <b>Лише схожі товари</b> — перевірити, чи є потрібне', partial, 10));
  msg.push(section_('🔝 <b>Найчастіші запити</b>', top, 10));
  if (!total) msg.push('За тиждень пошуком ніхто не користувався (або GA4 ще не віддав дані).');

  tgSend_(msg.filter(String).join('\n\n'));
}

/* ---------- GA4 ---------- */
function gaSearchRows_(start, end) {
  var req = {
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: 'eventName' }, { name: 'searchTerm' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: ['sc_search', 'sc_search_zero', 'sc_search_partial', 'sc_search_voice'] } } },
    limit: 10000
  };
  var res = AnalyticsData.Properties.runReport(req, GA4_PROPERTY);
  return (res.rows || []).map(function (r) {
    return [r.dimensionValues[0].value, r.dimensionValues[1].value, Number(r.metricValues[0].value) || 0];
  });
}

/* ---------- обробка запитів ---------- */
// GA4 інколи зберігає запит закодованим (%D0%BA+…), з табами й пробілами по краях
function cleanTerm_(t) {
  t = String(t || '');
  if (/%[0-9A-F]{2}/i.test(t)) { try { t = decodeURIComponent(t.replace(/\+/g, ' ')); } catch (e) {} }
  t = t.replace(/\s+/g, ' ').trim().toLowerCase();
  return t === '(not set)' ? '' : t;
}
// підказки під полем пишуть і недописані слова («автомат ре» → «автомат резерв»): лишаємо дописане
function dropTypedPrefixes_(terms, all) {
  var keys = Object.keys(all), out = {};
  Object.keys(terms).forEach(function (t) {
    var longer = keys.some(function (k) { return k !== t && k.length > t.length && k.indexOf(t) === 0; });
    if (!longer || t.length >= 15) out[t] = terms[t];
  });
  return out;
}
function section_(title, terms, limit) {
  var list = Object.keys(terms).sort(function (a, b) { return terms[b] - terms[a] || a.localeCompare(b); });
  if (!list.length) return '';
  return title + '\n' + list.slice(0, limit).map(function (t) {
    return '• <a href="' + SEARCH_PAGE + encodeURIComponent(t) + '">' + esc_(t.slice(0, 60)) + '</a>' + (terms[t] > 1 ? ' ×' + terms[t] : '');
  }).join('\n') + (list.length > limit ? '\n… ще ' + (list.length - limit) : '');
}
function sum_(o) { var n = 0; for (var k in o) n += o[k]; return n; }
function esc_(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ---------- Telegram ---------- */
function tgSend_(text) {
  var p = PropertiesService.getScriptProperties();
  var token = p.getProperty('TG_TOKEN'), chat = p.getProperty('TG_CHAT');
  if (!token || !chat) throw new Error('Немає TG_TOKEN / TG_CHAT у властивостях скрипту');
  if (text.length > 4000) text = text.slice(0, 3990) + '\n…';
  UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    payload: { chat_id: chat, text: text, parse_mode: 'HTML', disable_web_page_preview: 'true' },
    muteHttpExceptions: true
  });
}
