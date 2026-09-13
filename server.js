'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

// ---------- Конфигурация ----------
const PORT = process.env.PORT || 3000;
const CODE_TTL_MS = 15 * 60 * 1000;       // код и пароль живут 15 минут
const MAX_FILE_BYTES = 5 * 1024 * 1024;   // лимит файла — 5 МБ
const MAX_PAYLOAD_BYTES = Math.ceil(MAX_FILE_BYTES * 1.40); // запас на base64 + JSON

// Rate-limit на попытки ввода кода/пароля (защита от перебора)
const RATE_WINDOW_MS = 60 * 1000;   // окно наблюдения
const RATE_MAX_ATTEMPTS = 8;        // допустимых попыток в окне
const RATE_LOCKOUT_MS = 5 * 60 * 1000; // блокировка при превышении

// ---------- Состояние в памяти (ничего не пишется на диск) ----------
/** code(string) -> session */
const sessions = new Map();
/** ip(string) -> { attempts: number[], blockedUntil: number } */
const rateBuckets = new Map();

function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket) return false;
  if (bucket.blockedUntil && bucket.blockedUntil > now) return true;
  return false;
}

function registerAttempt(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket) {
    bucket = { attempts: [], blockedUntil: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.attempts = bucket.attempts.filter((t) => now - t < RATE_WINDOW_MS);
  bucket.attempts.push(now);
  if (bucket.attempts.length > RATE_MAX_ATTEMPTS) {
    bucket.blockedUntil = now + RATE_LOCKOUT_MS;
  }
}

// периодическая уборка старых бакетов
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if ((!bucket.blockedUntil || bucket.blockedUntil < now) && bucket.attempts.every((t) => now - t > RATE_WINDOW_MS)) {
      rateBuckets.delete(ip);
    }
  }
}, 60 * 1000).unref();

function randomDigits(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += crypto.randomInt(0, 10);
  return s;
}

function randomPassword() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 5; i++) s += letters[crypto.randomInt(0, letters.length)];
  s += crypto.randomInt(0, 10);
  return s;
}

function generateUniqueCode() {
  let code;
  do {
    code = randomDigits(6);
  } while (sessions.has(code));
  return code;
}

function formatCode(code) {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function safeSend(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function destroySession(session) {
  clearInterval(session.rotateTimer);
  sessions.delete(session.code);
}

function scheduleRotation(session) {
  clearInterval(session.rotateTimer);
  session.rotateTimer = setInterval(() => rotateCode(session), CODE_TTL_MS);
}

function rotateCode(session, { manual = false } = {}) {
  sessions.delete(session.code);
  session.code = generateUniqueCode();
  session.password = randomPassword();
  session.createdAt = Date.now();
  sessions.set(session.code, session);
  if (manual) scheduleRotation(session);
  safeSend(session.hostWs, {
    type: 'code-updated',
    code: formatCode(session.code),
    password: session.password,
    expiresInMs: CODE_TTL_MS,
  });
}

// ---------- HTTP + статика ----------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  ws.ip = getIp(req);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return safeSend(ws, { type: 'error', code: 'bad_json', message: 'Некорректное сообщение' });
    }
    handleMessage(ws, msg);
  });

  ws.on('close', () => handleDisconnect(ws));
});

// keepalive
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'create': {
      const code = generateUniqueCode();
      const password = randomPassword();
      const session = {
        code,
        password,
        requireAuth: true,
        hostWs: ws,
        guestWs: null,
        createdAt: Date.now(),
        rotateTimer: null,
      };
      scheduleRotation(session);
      sessions.set(code, session);
      ws.session = session;
      ws.role = 'host';
      safeSend(ws, {
        type: 'created',
        code: formatCode(code),
        password,
        requireAuth: true,
        expiresInMs: CODE_TTL_MS,
      });
      break;
    }

    case 'rotate-now': {
      const session = ws.session;
      if (!session || ws.role !== 'host') return;
      rotateCode(session, { manual: true });
      break;
    }

    case 'toggle-auth': {
      const session = ws.session;
      if (!session || ws.role !== 'host') return;
      session.requireAuth = !!msg.enabled;
      safeSend(ws, { type: 'auth-updated', requireAuth: session.requireAuth });
      break;
    }

    case 'join': {
      if (isRateLimited(ws.ip)) {
        return safeSend(ws, { type: 'error', code: 'rate_limited', message: 'Слишком много попыток. Попробуйте позже.' });
      }
      const rawCode = String(msg.code || '').replace(/\D/g, '');
      const session = sessions.get(rawCode);

      if (!session) {
        registerAttempt(ws.ip);
        return safeSend(ws, { type: 'error', code: 'not_found', message: 'Код не найден или истёк' });
      }
      if (session.requireAuth && msg.password !== session.password) {
        registerAttempt(ws.ip);
        return safeSend(ws, { type: 'error', code: 'bad_password', message: 'Неверный пароль' });
      }
      if (session.guestWs) {
        return safeSend(ws, { type: 'error', code: 'busy', message: 'К этому коду уже подключено устройство' });
      }

      session.guestWs = ws;
      ws.session = session;
      ws.role = 'guest';
      safeSend(ws, { type: 'joined' });
      safeSend(session.hostWs, { type: 'peer-joined' });
      break;
    }

    case 'data': {
      const session = ws.session;
      if (!session) return;
      const peer = ws.role === 'host' ? session.guestWs : session.hostWs;
      if (!peer) return safeSend(ws, { type: 'error', code: 'no_peer', message: 'Нет подключённого устройства' });

      const size = Buffer.byteLength(raw_size_probe(msg));
      if (size > MAX_PAYLOAD_BYTES) {
        return safeSend(ws, { type: 'error', code: 'too_large', message: 'Файл превышает лимит 5 МБ' });
      }
      safeSend(peer, { type: 'data', payload: msg.payload });
      break;
    }

    case 'leave': {
      handleDisconnect(ws, { keepSession: ws.role === 'host' });
      break;
    }

    default:
      safeSend(ws, { type: 'error', code: 'unknown_type', message: 'Неизвестный тип сообщения' });
  }
}

function raw_size_probe(msg) {
  try {
    return JSON.stringify(msg.payload || {});
  } catch {
    return '';
  }
}

function handleDisconnect(ws, opts = {}) {
  const session = ws.session;
  if (!session) return;

  if (ws.role === 'host') {
    safeSend(session.guestWs, { type: 'peer-left', reason: 'host_disconnected' });
    if (session.guestWs) session.guestWs.session = null;
    destroySession(session);
  } else if (ws.role === 'guest') {
    session.guestWs = null;
    safeSend(session.hostWs, { type: 'peer-left', reason: 'guest_disconnected' });
  }
  ws.session = null;
}

server.listen(PORT, () => {
  console.log(`FastSend relay запущен на порту ${PORT}`);
});
