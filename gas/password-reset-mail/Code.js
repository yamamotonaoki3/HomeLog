/**
 * HomeLog パスワード再設定メールの中継(Google Apps Script)。#401
 * 設計: docs/details/password-reset-mail-design.md / 設定手順: docs/details/password-reset-gas-setup.md
 *
 * - Workersから受けた要求のHMAC-SHA256署名・時刻・入力形式を検証し、固定文面のメールだけをMailAppで送る。
 *   任意の件名・本文・リンクは送れない。リンクは Script Properties の APP_URL から組み立てる。
 * - Script Properties: SHARED_SECRET(Workersと共有するHMAC鍵) / APP_URL(アプリの公開URL, https)
 *   実値はこのファイルにも、ログにも、チャットにも書かない。
 * - 署名対象: `v1.<timestamp>.<requestId>.<to>.<token>` (Workers側 lib/password-reset-mail.ts と同一)
 * - 同じ要求IDの再送は短時間検出して送らない。MailAppと重複検出の保存を跨ぐ厳密なexactly-onceは保証しない。
 */

var SIGNATURE_VERSION = 'v1';
var MAX_SKEW_SECONDS = 300;
var DEDUPE_TTL_SECONDS = 600;
var LOCK_WAIT_MS = 10000;
var MIN_REMAINING_QUOTA = 1;
var MAIL_SUBJECT = '【シェファミ】パスワード再設定のご案内';
var MAIL_SENDER_NAME = 'シェファミ';
var REQUEST_FIELDS = ['version', 'timestamp', 'requestId', 'to', 'token', 'signature'];

var REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var EMAIL_PATTERN = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
var TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
var SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

function doGet() {
  return jsonOutput_({ ok: false, code: 'method' });
}

function doPost(e) {
  var result;
  try {
    result = handleRequest_(e);
  } catch (err) {
    // 本文・宛先・トークンを出さないため、例外の中身は記録しない。
    console.error('internal error');
    result = { ok: false, code: 'internal' };
  }
  return jsonOutput_(result);
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function handleRequest_(e) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('SHARED_SECRET');
  var appUrl = props.getProperty('APP_URL');
  if (!secret || !appUrl || !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(appUrl)) {
    return { ok: false, code: 'config' };
  }

  var request = parseRequest_(e);
  if (!request) return { ok: false, code: 'invalid' };

  var nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - request.timestamp) > MAX_SKEW_SECONDS) {
    return { ok: false, code: 'expired' };
  }

  var payload = [SIGNATURE_VERSION, request.timestamp, request.requestId, request.to, request.token].join('.');
  var expected = hmacHex_(payload, secret);
  if (!constantTimeEquals_(expected, request.signature)) {
    return { ok: false, code: 'signature' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, code: 'busy' };
  try {
    var cache = CacheService.getScriptCache();
    var cacheKey = 'req:' + request.requestId;
    if (cache.get(cacheKey)) return { ok: true, duplicate: true };

    if (MailApp.getRemainingDailyQuota() < MIN_REMAINING_QUOTA) {
      return { ok: false, code: 'quota' };
    }

    // 送信前に記録して並行再送を抑える。送信に失敗したら消し、呼び出し側の判断で再申請できるようにする。
    cache.put(cacheKey, '1', DEDUPE_TTL_SECONDS);
    try {
      MailApp.sendEmail({
        to: request.to,
        subject: MAIL_SUBJECT,
        body: buildBody_(appUrl, request.token),
        name: MAIL_SENDER_NAME,
        noReply: true,
      });
    } catch (err) {
      cache.remove(cacheKey);
      console.error('send failed');
      return { ok: false, code: 'authorization' };
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function parseRequest_(e) {
  if (!e || !e.postData || typeof e.postData.contents !== 'string' || e.postData.contents.length > 2048) return null;
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  var keys = Object.keys(data);
  if (keys.length !== REQUEST_FIELDS.length) return null;
  for (var i = 0; i < REQUEST_FIELDS.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(data, REQUEST_FIELDS[i])) return null;
  }
  if (data.version !== SIGNATURE_VERSION) return null;
  if (typeof data.timestamp !== 'number' || !isFinite(data.timestamp) || Math.floor(data.timestamp) !== data.timestamp) return null;
  if (typeof data.requestId !== 'string' || !REQUEST_ID_PATTERN.test(data.requestId)) return null;
  if (typeof data.to !== 'string' || data.to.length > 254 || !EMAIL_PATTERN.test(data.to)) return null;
  if (typeof data.token !== 'string' || !TOKEN_PATTERN.test(data.token)) return null;
  if (typeof data.signature !== 'string' || !SIGNATURE_PATTERN.test(data.signature)) return null;
  return data;
}

function buildBody_(appUrl, token) {
  var link = appUrl.replace(/\/+$/, '') + '/password-reset#token=' + encodeURIComponent(token);
  return [
    'シェファミのパスワード再設定のお申し込みを受け付けました。',
    '次のリンクを開き、30分以内に新しいパスワードを設定してください。',
    '',
    link,
    '',
    '・このメールに心当たりがない場合は、何もせずこのメールを破棄してください。',
    '・再設定を申し込み直した場合、このメールのリンクは使えなくなります。最新のメールのリンクをご利用ください。',
    '・このメールは送信専用です。返信しても届きません。',
  ].join('\n');
}

function hmacHex_(payload, secret) {
  var bytes = Utilities.computeHmacSha256Signature(payload, secret);
  var hex = '';
  for (var i = 0; i < bytes.length; i += 1) {
    hex += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
  }
  return hex;
}

function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
