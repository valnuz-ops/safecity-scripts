/**
 * SafeCity — сторож: приймає звіти з safecity.js (блок 20 / scHealth) і пересилає їх у Telegram.
 *
 * ЯК НАЛАШТУВАТИ
 * 1. script.google.com → «Новий проєкт» → вставте весь цей файл замість вмісту Code.gs → «Зберегти».
 * 2. ⚙️ «Налаштування проєкту» → «Властивості скрипту» → «Додати властивість скрипту»:
 *      TG_TOKEN — токен Telegram-бота від @BotFather (123456:ABC…);
 *      TG_CHAT  — chat_id, куди писати (ваш id або id групи, напр. -1001234567890).
 *    Бот має бути доданий у групу або ви маєте хоч раз написати йому /start.
 *    Ключі — ЛИШЕ тут, у властивостях: репозиторій публічний, у коді їх бути не повинно.
 * 3. (Необов'язково) Перевірка: виберіть функцію testTelegram → «Виконати», дайте дозволи —
 *    у Telegram має прийти тестове повідомлення.
 * 4. «Розгорнути» → «Нове розгортання» → тип «Веб-застосунок»:
 *      «Виконувати як» — «Я»; «Хто має доступ» — «Усі» → «Розгорнути».
 * 5. Скопіюйте URL веб-застосунку (https://script.google.com/macros/s/…/exec) і вставте його
 *    в src/safecity.js: var SC_HEALTH_URL = '…/exec'; → ./build.sh → коміт.
 *    Відкрийте цей URL у браузері — має показати «SafeCity health: ok».
 * Після змін у цьому коді: «Розгорнути» → «Керувати розгортаннями» → ✏️ → «Нова версія»
 * (URL лишається той самий).
 *
 * Захист: приймаємо лише звіти зі сторінок safecity.in.ua; одна й та сама проблема — не частіше
 * разу на 6 годин для всіх відвідувачів разом; не більше 30 повідомлень на годину.
 */

var DEDUP_SECONDS = 6 * 3600;   // максимум CacheService — 6 годин
var MAX_PER_HOUR = 30;
var SITE = /^https:\/\/(www\.)?safecity\.in\.ua\//;

function doPost(e) {
  try {
    handle_(JSON.parse((e && e.postData && e.postData.contents) || '{}'));
  } catch (err) {
    console.error(err);
  }
  return ContentService.createTextOutput('ok');
}

function doGet() {
  return ContentService.createTextOutput('SafeCity health: ok');
}

function handle_(r) {
  var block = clip_(r.block, 80), msg = clip_(r.msg, 300), url = clip_(r.url, 300);
  var device = r.device === 'mobile' ? '📱 моб' : '🖥 десктоп';
  var build = clip_(r.build, 40);
  if (!block || !SITE.test(url)) return;                       // чужі або порожні звіти ігноруємо

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var cache = CacheService.getScriptCache();
    var key = 'p:' + hash_(block + '|' + msg);
    if (cache.get(key)) return;                                // ця проблема вже була за останні 6 год
    var hourKey = 'h:' + Math.floor(Date.now() / 3600000);
    var count = Number(cache.get(hourKey) || 0);
    if (count >= MAX_PER_HOUR) return;
    cache.put(key, '1', DEDUP_SECONDS);
    cache.put(hourKey, String(count + 1), 3600);
  } finally {
    lock.releaseLock();
  }

  send_('⚠️ SafeCity: ' + block + '\n' + (msg || '—') + '\n' + url + '\n' + device + (build ? ' · збірка ' + build : ''));
}

function send_(text) {
  var p = PropertiesService.getScriptProperties();
  var token = p.getProperty('TG_TOKEN'), chat = p.getProperty('TG_CHAT');
  if (!token || !chat) throw new Error('Задайте TG_TOKEN і TG_CHAT у властивостях скрипту');
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    payload: { chat_id: chat, text: text, disable_web_page_preview: 'true' },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) console.error('Telegram: ' + res.getResponseCode() + ' ' + res.getContentText());
}

function clip_(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n); }

function hash_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8));
}

// Ручна перевірка зв'язки з Telegram (запуск із редактора Apps Script)
function testTelegram() {
  send_('⚠️ SafeCity: тест сторожа\nЯкщо ви це бачите — TG_TOKEN і TG_CHAT налаштовані правильно.');
}
