(() => {
  const MAX_FILE_BYTES = 5 * 1024 * 1024;

  const $ = (id) => document.getElementById(id);
  const statusPill = $('statusPill');
  const tabs = document.querySelectorAll('.tab');
  const panels = { host: $('panel-host'), join: $('panel-join') };

  const hostCodeEl = $('hostCode');
  const hostPassEl = $('hostPass');
  const passRow = $('passRow');
  const requireAuthEl = $('requireAuth');
  const timerFill = $('timerFill');
  const timerLabel = $('timerLabel');

  const joinCodeEl = $('joinCode');
  const joinPassEl = $('joinPass');
  const joinBtn = $('joinBtn');
  const joinError = $('joinError');

  const exchange = $('exchange');
  const logEl = $('log');
  const textInput = $('textInput');
  const sendBtn = $('sendBtn');
  const dropZone = $('dropZone');
  const fileInput = $('fileInput');
  const disconnectBtn = $('disconnectBtn');

  let ws = null;
  let role = null; // 'host' | 'guest'
  let countdownTimer = null;
  let expiresAt = 0;

  function connectSocket() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'create' })));
    ws.addEventListener('message', (ev) => handleMessage(JSON.parse(ev.data)));
    ws.addEventListener('close', () => setStatus(false));
  }

  function setStatus(connected) {
    statusPill.textContent = connected ? 'подключено' : 'не подключено';
    statusPill.classList.toggle('connected', connected);
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'created':
        hostCodeEl.textContent = msg.code;
        hostPassEl.textContent = msg.password;
        startCountdown(msg.expiresInMs);
        break;
      case 'code-updated':
        hostCodeEl.textContent = msg.code;
        hostPassEl.textContent = msg.password;
        startCountdown(msg.expiresInMs);
        logSystem('Код и пароль обновлены');
        break;
      case 'auth-updated':
        passRow.style.opacity = msg.requireAuth ? '1' : '0.4';
        break;
      case 'joined':
        role = 'guest';
        onPaired();
        break;
      case 'peer-joined':
        role = 'host';
        onPaired();
        break;
      case 'peer-left':
        setStatus(false);
        logSystem('Собеседник отключился');
        break;
      case 'error':
        joinError.textContent = msg.message;
        joinBtn.disabled = false;
        break;
      case 'data':
        renderIncoming(msg.payload);
        break;
    }
  }

  function onPaired() {
    setStatus(true);
    exchange.hidden = false;
    joinError.textContent = '';
    joinBtn.disabled = false;
    logSystem('Соединение установлено');
  }

  function startCountdown(ms) {
    clearInterval(countdownTimer);
    expiresAt = Date.now() + ms;
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function tick() {
    const remaining = Math.max(0, expiresAt - Date.now());
    const pct = Math.max(0, Math.min(100, (remaining / (15 * 60 * 1000)) * 100));
    timerFill.style.width = pct + '%';
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    timerLabel.textContent = `обновление через ${m}:${String(s).padStart(2, '0')}`;
  }

  // ---------- Вкладки ----------
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      Object.values(panels).forEach((p) => p.classList.remove('active'));
      panels[tab.dataset.tab].classList.add('active');
    });
  });

  // ---------- Копирование ----------
  function flashCopied(btn) {
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 900);
  }
  $('copyCode').addEventListener('click', () => {
    navigator.clipboard.writeText(hostCodeEl.textContent.replace(/\s/g, ''));
    flashCopied($('copyCode'));
  });
  $('copyPass').addEventListener('click', () => {
    navigator.clipboard.writeText(hostPassEl.textContent);
    flashCopied($('copyPass'));
  });

  // ---------- Настройка пароля ----------
  requireAuthEl.addEventListener('change', () => {
    ws.send(JSON.stringify({ type: 'toggle-auth', enabled: requireAuthEl.checked }));
  });

  // ---------- Подключение по коду ----------
  joinBtn.addEventListener('click', () => {
    const code = joinCodeEl.value.replace(/\D/g, '');
    if (code.length !== 6) {
      joinError.textContent = 'Введите 6-значный код';
      return;
    }
    joinError.textContent = '';
    joinBtn.disabled = true;
    ws.send(JSON.stringify({ type: 'join', code, password: joinPassEl.value.trim() }));
  });

  // ---------- Обмен текстом ----------
  function logSystem(text) {
    const div = document.createElement('div');
    div.className = 'msg sys';
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function logMessage(text, outgoing) {
    const div = document.createElement('div');
    div.className = 'msg' + (outgoing ? ' out' : '');
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function logFile(name, url, outgoing) {
    const div = document.createElement('div');
    div.className = 'msg file' + (outgoing ? ' out' : '');
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.textContent = '📎 ' + name;
    div.appendChild(link);
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  sendBtn.addEventListener('click', sendText);
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  });

  function sendText() {
    const value = textInput.value.trim();
    if (!value) return;
    ws.send(JSON.stringify({ type: 'data', payload: { kind: 'text', text: value } }));
    logMessage(value, true);
    textInput.value = '';
  }

  function renderIncoming(payload) {
    if (payload.kind === 'text') {
      logMessage(payload.text, false);
    } else if (payload.kind === 'file') {
      const blob = base64ToBlob(payload.data, payload.mime);
      const url = URL.createObjectURL(blob);
      logFile(payload.name, url, false);
    }
  }

  // ---------- Файлы ----------
  function sendFile(file) {
    if (file.size > MAX_FILE_BYTES) {
      logSystem(`Файл «${file.name}» больше 5 МБ`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      ws.send(JSON.stringify({
        type: 'data',
        payload: { kind: 'file', name: file.name, mime: file.type || 'application/octet-stream', data: base64 },
      }));
      const url = URL.createObjectURL(file);
      logFile(file.name, url, true);
    };
    reader.readAsDataURL(file);
  }

  function base64ToBlob(base64, mime) {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    return new Blob([new Uint8Array(byteNumbers)], { type: mime });
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) sendFile(fileInput.files[0]);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('drag'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('drag'); })
  );
  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) sendFile(file);
  });

  disconnectBtn.addEventListener('click', () => {
    ws.send(JSON.stringify({ type: 'leave' }));
    exchange.hidden = true;
    setStatus(false);
    logEl.innerHTML = '';
  });

  connectSocket();
})();
