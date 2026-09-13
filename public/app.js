(() => {
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const RECENT_KEY = 'fastsend_recent';
  const FAV_KEY = 'fastsend_favorites';
  const SETTINGS_KEY = 'fastsend_settings';

  const $ = (id) => document.getElementById(id);

  // ---------- Иконки для динамически создаваемых элементов ----------
  const ICONS = {
    transfer: '<svg viewBox="0 0 24 24" class="i" aria-hidden="true"><path d="M4 8h13M13 4l4 4-4 4"/><path d="M20 16H7m6 4l-4-4 4-4"/></svg>',
    star: '<svg viewBox="0 0 24 24" class="i" aria-hidden="true"><path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.1 1.4-6.3-4.8-4.3 6.4-.6z"/></svg>',
    starFill: '<svg viewBox="0 0 24 24" class="i" fill="currentColor" aria-hidden="true"><path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.1 1.4-6.3-4.8-4.3 6.4-.6z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" class="i" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>',
    clock: '<svg viewBox="0 0 24 24" class="i" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/></svg>',
  };

  // ---------- Настройки интерфейса (акцент, плотность, память) ----------
  const defaultSettings = { accent: '#2f6feb', density: 'comfortable', remember: true, view: 'list' };
  let settings = { ...defaultSettings, ...readJSON(SETTINGS_KEY, {}) };

  const ACCENTS = ['#2f6feb', '#7c5cff', '#3ecf8e', '#ff8a3d', '#ff5c6c', '#22b8cf'];

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* хранилище недоступно — тихо игнорируем */ }
  }

  function shade(hex, percent) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + percent));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + percent));
    const b = Math.min(255, Math.max(0, (n & 0xff) + percent));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  function applySettings() {
    const root = document.documentElement.style;
    root.setProperty('--accent', settings.accent);
    root.setProperty('--accent-hover', shade(settings.accent, 25));
    root.setProperty('--accent-dim', shade(settings.accent, -70));
    document.body.classList.toggle('density-compact', settings.density === 'compact');

    document.querySelectorAll('.swatch').forEach((el) => {
      el.classList.toggle('active', el.dataset.color === settings.accent);
    });
    document.querySelectorAll('.seg-btn').forEach((el) => {
      el.classList.toggle('active', el.dataset.density === settings.density);
    });
    $('rememberRecent').checked = settings.remember;
    $('viewToggle').classList.toggle('active', settings.view === 'grid');
  }

  function saveSettings() { writeJSON(SETTINGS_KEY, settings); }

  // ---------- Недавние / избранное ----------
  let recent = readJSON(RECENT_KEY, []);
  let favorites = readJSON(FAV_KEY, []);
  let activeTab = 'recent';
  let searchQuery = '';

  function saveRecent() { writeJSON(RECENT_KEY, recent); }
  function saveFavorites() { writeJSON(FAV_KEY, favorites); }

  function isFavorite(code) { return favorites.some((f) => f.code === code); }

  function addRecent(code) {
    if (!settings.remember) return;
    recent = recent.filter((r) => r.code !== code);
    recent.unshift({ code, ts: Date.now() });
    recent = recent.slice(0, 10);
    saveRecent();
    renderList();
  }

  function toggleFavorite(code) {
    if (isFavorite(code)) {
      favorites = favorites.filter((f) => f.code !== code);
    } else {
      favorites.unshift({ code, label: 'Подключение', ts: Date.now() });
    }
    saveFavorites();
    renderList();
  }

  function removeEntry(code) {
    if (activeTab === 'recent') { recent = recent.filter((r) => r.code !== code); saveRecent(); }
    else { favorites = favorites.filter((f) => f.code !== code); saveFavorites(); }
    renderList();
  }

  function formatCodeDisplay(code) { return `${code.slice(0, 3)} ${code.slice(3)}`; }

  function renderList() {
    const listArea = $('listArea');
    const source = activeTab === 'recent' ? recent : favorites;
    const query = searchQuery.trim().toLowerCase();
    const items = source.filter((it) => !query || it.code.includes(query) || (it.label || '').toLowerCase().includes(query));

    listArea.className = 'list ' + (settings.view === 'grid' ? 'grid-view' : 'list-view');

    if (items.length === 0) {
      listArea.innerHTML = `<div class="empty-state">${ICONS.clock}<p>${
        activeTab === 'recent'
          ? 'Здесь появятся коды, к которым вы подключались'
          : 'Отмечайте звездой нужные подключения — они появятся здесь'
      }</p></div>`;
      return;
    }

    listArea.innerHTML = items.map((it) => {
      const fav = isFavorite(it.code);
      return `
        <div class="entry" data-code="${it.code}">
          <div class="entry-icon">${ICONS.transfer}</div>
          <div class="entry-main">
            <div class="entry-label">${it.label || 'Подключение'}</div>
            <div class="entry-code">${formatCodeDisplay(it.code)}</div>
          </div>
          <div class="entry-actions">
            <button class="icon-btn small star-btn ${fav ? 'active' : ''}" data-action="star" title="${fav ? 'Убрать из избранного' : 'Добавить в избранное'}">${fav ? ICONS.starFill : ICONS.star}</button>
            <button class="icon-btn small" data-action="delete" title="Удалить">${ICONS.trash}</button>
          </div>
        </div>`;
    }).join('');
  }

  $('listArea').addEventListener('click', (e) => {
    const entry = e.target.closest('.entry');
    if (!entry) return;
    const code = entry.dataset.code;
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'star') { toggleFavorite(code); return; }
    if (action === 'delete') { removeEntry(code); return; }
    joinCodeEl.value = formatCodeDisplay(code);
    joinPassEl.focus();
  });

  // ---------- Вкладки Недавние / Избранное / Настройки ----------
  document.querySelectorAll('.tab-icon[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-icon[data-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      const isSettings = activeTab === 'settings';
      $('settingsArea').hidden = !isSettings;
      $('listArea').hidden = isSettings;
      $('searchToggle').hidden = isSettings;
      $('viewToggle').hidden = isSettings;
      if (!isSettings) renderList();
    });
  });

  $('menuBtn').addEventListener('click', () => {
    document.querySelector('.tab-icon[data-tab="settings"]').click();
    $('menuBtn').classList.toggle('active');
  });

  $('searchToggle').addEventListener('click', () => {
    const row = $('searchRow');
    row.hidden = !row.hidden;
    $('searchToggle').classList.toggle('active', !row.hidden);
    if (!row.hidden) $('searchInput').focus();
    else { searchQuery = ''; $('searchInput').value = ''; renderList(); }
  });
  $('searchInput').addEventListener('input', (e) => { searchQuery = e.target.value; renderList(); });

  $('viewToggle').addEventListener('click', () => {
    settings.view = settings.view === 'grid' ? 'list' : 'grid';
    saveSettings();
    applySettings();
    renderList();
  });

  // ---------- Настройки: акцент, плотность, память, очистка ----------
  const swatchesEl = $('accentSwatches');
  swatchesEl.innerHTML = ACCENTS.map((c) => `<button class="swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('');
  swatchesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.swatch');
    if (!btn) return;
    settings.accent = btn.dataset.color;
    saveSettings();
    applySettings();
  });

  $('densitySeg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    settings.density = btn.dataset.density;
    saveSettings();
    applySettings();
  });

  $('rememberRecent').addEventListener('change', (e) => {
    settings.remember = e.target.checked;
    saveSettings();
  });

  $('clearHistoryBtn').addEventListener('click', () => {
    recent = []; favorites = [];
    saveRecent(); saveFavorites();
    renderList();
  });

  applySettings();
  renderList();

  // ================= Основная логика соединения (как раньше) =================
  const hostCodeEl = $('hostCode');
  const hostPassEl = $('hostPass');
  const requireAuthEl = $('requireAuth');
  const timerFill = $('timerFill');
  const timerLabel = $('timerLabel');
  const rotateNowBtn = $('rotateNow');

  const connectBox = $('connectBox');
  const connectArea = $('connectArea');
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

  const footDot = $('footDot');
  const footStatusText = $('footStatusText');

  let ws = null;
  let countdownTimer = null;
  let expiresAt = 0;
  let currentJoinCode = null;

  function setFootStatus(state, text) {
    footDot.className = 'dot ' + state;
    footStatusText.textContent = text;
  }

  function connectSocket() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'create' })));
    ws.addEventListener('message', (ev) => handleMessage(JSON.parse(ev.data)));
    ws.addEventListener('close', () => { setStatus(false); setFootStatus('error', 'Соединение с сервером потеряно'); });
  }

  function setStatus(connected) {
    // визуальный статус теперь только в нижней статус-строке (иконка + текст),
    // верхняя панель остаётся полностью иконочной
    if (!connected) setFootStatus('ready', 'Готово к подключению');
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'created':
        hostCodeEl.textContent = msg.code;
        hostPassEl.textContent = msg.password;
        requireAuthEl.checked = msg.requireAuth;
        startCountdown(msg.expiresInMs);
        setFootStatus('ready', 'Готово к подключению');
        break;
      case 'code-updated':
        hostCodeEl.textContent = msg.code;
        hostPassEl.textContent = msg.password;
        startCountdown(msg.expiresInMs);
        logSystem('Код и пароль обновлены');
        break;
      case 'password-updated':
        hostPassEl.textContent = msg.password;
        exitPassEditMode();
        flashCopied($('editPassBtn'));
        break;
      case 'auth-updated':
        break;
      case 'joined':
        if (currentJoinCode) addRecent(currentJoinCode);
        onPaired();
        break;
      case 'peer-joined':
        onPaired();
        break;
      case 'peer-left':
        setStatus(false);
        logSystem('Собеседник отключился');
        break;
      case 'error':
        handleServerError(msg);
        break;
      case 'data':
        renderIncoming(msg.payload);
        break;
    }
  }

  function handleServerError(msg) {
    if (msg.code === 'bad_password_format') {
      $('passError').textContent = msg.message;
      return;
    }
    if (msg.code === 'too_large' || msg.code === 'no_peer') {
      logSystem(msg.message);
      return;
    }
    joinError.textContent = msg.message;
    joinBtn.disabled = false;
    setFootStatus('error', msg.message);
  }

  function onPaired() {
    setFootStatus('connected', `Подключено — ${formatCodeDisplay(currentJoinCode || '')}`.trim());
    connectArea.hidden = true;
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
    timerLabel.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  // ---------- Копирование по клику и иконкой ----------
  function flashCopied(btn) {
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 900);
  }
  function flashValue(el) {
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 700);
  }
  function copyText(text, btn, valueEl) {
    navigator.clipboard.writeText(text);
    if (btn) flashCopied(btn);
    if (valueEl) flashValue(valueEl);
  }
  $('copyCode').addEventListener('click', () => copyText(hostCodeEl.textContent.replace(/\s/g, ''), $('copyCode'), hostCodeEl));
  hostCodeEl.addEventListener('click', () => copyText(hostCodeEl.textContent.replace(/\s/g, ''), $('copyCode'), hostCodeEl));
  hostPassEl.addEventListener('click', () => copyText(hostPassEl.textContent, rotateNowBtn, hostPassEl));

  rotateNowBtn.addEventListener('click', () => {
    ws.send(JSON.stringify({ type: 'rotate-now' }));
  });

  // ---------- Свой пароль (карандаш → сохранить/отмена) ----------
  const passEditInput = $('passEditInput');
  const editPassBtn = $('editPassBtn');
  const savePassBtn = $('savePassBtn');
  const cancelPassBtn = $('cancelPassBtn');

  function enterPassEditMode() {
    $('passError').textContent = '';
    passEditInput.value = hostPassEl.textContent;
    hostPassEl.hidden = true;
    passEditInput.hidden = false;
    rotateNowBtn.hidden = true;
    editPassBtn.hidden = true;
    savePassBtn.hidden = false;
    cancelPassBtn.hidden = false;
    passEditInput.focus();
    passEditInput.select();
  }
  function exitPassEditMode() {
    hostPassEl.hidden = false;
    passEditInput.hidden = true;
    rotateNowBtn.hidden = false;
    editPassBtn.hidden = false;
    savePassBtn.hidden = true;
    cancelPassBtn.hidden = true;
    $('passError').textContent = '';
  }
  function submitPassEdit() {
    const value = passEditInput.value.trim();
    if (value.length < 4) { $('passError').textContent = 'Пароль должен быть не короче 4 символов'; return; }
    ws.send(JSON.stringify({ type: 'set-password', password: value }));
  }
  editPassBtn.addEventListener('click', enterPassEditMode);
  cancelPassBtn.addEventListener('click', exitPassEditMode);
  savePassBtn.addEventListener('click', submitPassEdit);
  passEditInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPassEdit();
    if (e.key === 'Escape') exitPassEditMode();
  });

  // ---------- Настройка пароля ----------
  requireAuthEl.addEventListener('change', () => {
    ws.send(JSON.stringify({ type: 'toggle-auth', enabled: requireAuthEl.checked }));
  });

  // ---------- Подключение по коду ----------
  joinBtn.addEventListener('click', attemptJoin);
  joinCodeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptJoin(); });
  joinPassEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptJoin(); });

  function attemptJoin() {
    const code = joinCodeEl.value.replace(/\D/g, '');
    if (code.length !== 6) {
      joinError.textContent = 'Введите 6-значный код';
      return;
    }
    joinError.textContent = '';
    joinBtn.disabled = true;
    currentJoinCode = code;
    setFootStatus('pending', `Подключение к ${formatCodeDisplay(code)}…`);
    ws.send(JSON.stringify({ type: 'join', code, password: joinPassEl.value.trim() }));
  }

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
  textInput.addEventListener('input', () => {
    textInput.style.height = 'auto';
    textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
  });

  function sendText() {
    const value = textInput.value.trim();
    if (!value) return;
    ws.send(JSON.stringify({ type: 'data', payload: { kind: 'text', text: value } }));
    logMessage(value, true);
    textInput.value = '';
    textInput.style.height = 'auto';
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
    connectArea.hidden = false;
    setStatus(false);
    logEl.innerHTML = '';
  });

  connectSocket();
})();
