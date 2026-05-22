(function () {
  'use strict';

  const AUTH_SESSION_KEY = 'daycare-parent-auth-v1';
  const LANGUAGE_KEY = 'daycare-parent-language-v1';

  const state = {
    token: '',
    user: null,
    clientId: '',
    vapidPublicKey: '',
    children: [],
    activeChildId: '',
    feed: [],
    score: null,
    rankingPeriod: 'week',
    language: loadLanguage(),
  };

  const $ = (sel) => document.querySelector(sel);
  const elAuthGate = $('#auth-gate');
  const elAuthStatus = $('#auth-status');
  const elGoogleButton = $('#google-signin-button');
  const elShell = $('#app-shell');
  const elCurrentUser = $('#current-user');
  const elChildrenMeta = $('#children-meta');
  const elChildrenList = $('#children-list');
  const elActiveChildName = $('#active-child-name');
  const elActiveChildMeta = $('#active-child-meta');
  const elScoreStrip = $('#score-strip');
  const elFeed = $('#feed');
  const elRankingList = $('#ranking-list');
  const elLanguage = $('#language-select');
  const elRefresh = $('#refresh');
  const elSignOut = $('#sign-out');
  const elNotify = $('#notify-btn');

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function loadLanguage() {
    try {
      return localStorage.getItem(LANGUAGE_KEY) || 'zh';
    } catch {
      return 'zh';
    }
  }

  function saveLanguage(value) {
    state.language = value === 'en' ? 'en' : 'zh';
    try {
      localStorage.setItem(LANGUAGE_KEY, state.language);
    } catch {}
  }

  function t(zh, en) {
    return state.language === 'en' ? en : zh;
  }

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    return headers;
  }

  function saveToken(token) {
    state.token = token || '';
    try {
      if (state.token) localStorage.setItem(AUTH_SESSION_KEY, state.token);
      else localStorage.removeItem(AUTH_SESSION_KEY);
    } catch {}
  }

  function loadToken() {
    try {
      state.token = localStorage.getItem(AUTH_SESSION_KEY) || '';
    } catch {
      state.token = '';
    }
  }

  function setAuthUi(locked, message) {
    elAuthGate.hidden = !locked;
    elShell.hidden = locked;
    if (elAuthStatus) elAuthStatus.textContent = message || '';
    if (elCurrentUser) elCurrentUser.textContent = state.user ? (state.user.email || '') : '';
  }

  function loadGoogleScript() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        resolve();
        return;
      }
      const existing = document.querySelector('script[data-google-identity]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = 'true';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function renderGoogleButton() {
    if (!state.clientId || !elGoogleButton) return;
    await loadGoogleScript();
    window.google.accounts.id.initialize({
      client_id: state.clientId,
      callback: window.handleParentGoogleCredential,
      auto_select: false,
    });
    elGoogleButton.innerHTML = '';
    window.google.accounts.id.renderButton(elGoogleButton, {
      theme: 'filled_blue',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      width: Math.min(320, Math.max(240, window.innerWidth - 56)),
    });
  }

  async function checkAuth() {
    loadToken();
    try {
      const resp = await fetch('/api/parent-auth', {
        cache: 'no-store',
        headers: authHeaders(),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      state.clientId = data.clientId || '';
      state.vapidPublicKey = data.vapidPublicKey || '';
      state.user = data.authenticated ? data.user : null;
      state.children = data.children || [];
      if (!state.user) {
        setAuthUi(true, t('请使用爸爸或妈妈绑定的 Google 账号登录', 'Please sign in with a linked parent Google account'));
        await renderGoogleButton();
        return;
      }
      setAuthUi(false, '');
      startApp();
    } catch (err) {
      if (state.token) {
        saveToken('');
        return checkAuth();
      }
      setAuthUi(true, `${t('登录检查失败', 'Sign-in check failed')}：${err.message}`);
    }
  }

  async function handleGoogleCredential(response) {
    try {
      setAuthUi(true, t('正在验证 Google 登录…', 'Verifying Google sign-in...'));
      const resp = await fetch('/api/parent-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response && response.credential }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      saveToken(data.token || '');
      state.user = data.user || null;
      state.children = data.children || [];
      setAuthUi(false, '');
      startApp();
    } catch (err) {
      saveToken('');
      setAuthUi(true, `${t('登录失败', 'Sign-in failed')}：${err.message}`);
      await renderGoogleButton();
    }
  }

  window.handleParentGoogleCredential = handleGoogleCredential;

  function startApp() {
    if (elLanguage) elLanguage.value = state.language;
    renderChildren();
    if (!state.activeChildId && state.children[0]) {
      state.activeChildId = state.children[0].recordId;
    }
    renderActiveChildShell();
    if (state.activeChildId) loadChildData();
  }

  function activeChild() {
    return state.children.find((child) => child.recordId === state.activeChildId) || null;
  }

  function initials(name) {
    return (name || '?').trim().slice(0, 1).toUpperCase();
  }

  function renderChildren() {
    elChildrenMeta.textContent = t(`${state.children.length} 个孩子`, `${state.children.length} child${state.children.length === 1 ? '' : 'ren'}`);
    if (!state.children.length) {
      elChildrenList.innerHTML = `<div class="empty">${escapeHtml(t('这个 Google 账号还没有绑定孩子。', 'This Google account is not linked to any child.'))}</div>`;
      return;
    }
    elChildrenList.innerHTML = state.children.map((child) => `
      <button class="child-card ${child.recordId === state.activeChildId ? 'active' : ''}" type="button"
        data-child="${escapeHtml(child.recordId)}">
        <span class="avatar">${escapeHtml(initials(child.studentName))}</span>
        <span>
          <strong>${escapeHtml(child.studentName || '宝贝')}</strong>
          <span>${escapeHtml([child.campus, child.block, child.period].filter(Boolean).join(' · ') || '-')}</span>
        </span>
      </button>
    `).join('');
    elChildrenList.querySelectorAll('[data-child]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeChildId = btn.getAttribute('data-child') || '';
        state.feed = [];
        state.score = null;
        renderChildren();
        renderActiveChildShell();
        loadChildData();
      });
    });
  }

  function renderActiveChildShell() {
    const child = activeChild();
    if (!child) {
      elActiveChildName.textContent = t('请选择孩子', 'Choose a child');
      elActiveChildMeta.textContent = '';
      elScoreStrip.innerHTML = '';
      elFeed.innerHTML = `<div class="empty">${escapeHtml(t('没有孩子资料。', 'No child profile.'))}</div>`;
      return;
    }
    elActiveChildName.textContent = child.studentName || t('宝贝', 'Child');
    elActiveChildMeta.textContent = [child.year, child.campus, child.block, child.period].filter(Boolean).join(' · ') || t('点名动态', 'Attendance updates');
    renderScore();
    renderFeed();
  }

  async function loadChildData() {
    const child = activeChild();
    if (!child) return;
    elFeed.innerHTML = `<div class="empty">${escapeHtml(t('正在读取动态…', 'Loading updates...'))}</div>`;
    try {
      const [feedResp, scoreResp] = await Promise.all([
        fetch(`/api/parent-feed?studentRecordId=${encodeURIComponent(child.recordId)}&t=${Date.now()}`, {
          cache: 'no-store',
          headers: authHeaders(),
        }),
        fetch(`/api/parent-score?studentRecordId=${encodeURIComponent(child.recordId)}&t=${Date.now()}`, {
          cache: 'no-store',
          headers: authHeaders(),
        }),
      ]);
      const feedData = await feedResp.json();
      const scoreData = await scoreResp.json();
      if (!feedResp.ok || !feedData.success) throw new Error(feedData.error || `HTTP ${feedResp.status}`);
      if (!scoreResp.ok || !scoreData.success) throw new Error(scoreData.error || `HTTP ${scoreResp.status}`);
      state.feed = feedData.items || [];
      state.score = scoreData;
      renderScore();
      renderFeed();
      renderRanking();
    } catch (err) {
      elFeed.innerHTML = `<div class="empty">${escapeHtml(t('读取失败', 'Load failed'))}：${escapeHtml(err.message)}</div>`;
    }
  }

  function fmtPoints(value) {
    const num = Number(value || 0);
    return Number.isInteger(num) ? String(num) : num.toFixed(1);
  }

  function renderScore() {
    const total = state.score ? state.score.total : 0;
    const rankings = state.score ? state.score.rankings || {} : {};
    elScoreStrip.innerHTML = [
      { label: t('总 Noble Star', 'Total Noble Star'), value: fmtPoints(total) },
      { label: t('本周排名', 'Weekly rank'), value: rankings.week && rankings.week.ownRank ? `#${rankings.week.ownRank}` : '-' },
      { label: t('本月排名', 'Monthly rank'), value: rankings.month && rankings.month.ownRank ? `#${rankings.month.ownRank}` : '-' },
      { label: t('永久排名', 'All-time rank'), value: rankings.all && rankings.all.ownRank ? `#${rankings.all.ownRank}` : '-' },
    ].map((card) => `
      <div class="score-card">
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(card.value)}</strong>
      </div>
    `).join('');
  }

  function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(state.language === 'en' ? 'en-MY' : 'zh-MY', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function renderFeed() {
    if (!state.feed.length) {
      elFeed.innerHTML = `<div class="empty">${escapeHtml(t('暂时还没有动态。', 'No updates yet.'))}</div>`;
      return;
    }
    let lastDate = '';
    const html = [];
    state.feed.slice().reverse().forEach((item) => {
      const date = item.date || String(item.createdAt || '').slice(0, 10);
      if (date && date !== lastDate) {
        lastDate = date;
        html.push(`<div class="day-divider">${escapeHtml(date)}</div>`);
      }
      const negative = item.type === 'score' && Number(item.points || 0) < 0;
      const teacher = item.teacher || t('老师', 'Teacher');
      const timeText = formatTime(item.createdAt);
      html.push(`
        <article class="message ${item.type === 'score' ? 'score' : ''} ${negative ? 'negative' : ''}">
          <div class="message-meta">
            <strong>${escapeHtml(teacher)}</strong>
            ${timeText ? `<time>${escapeHtml(timeText)}</time>` : ''}
          </div>
          <p>${escapeHtml(item.message || '')}</p>
        </article>
      `);
    });
    elFeed.innerHTML = html.join('');
    elFeed.scrollTop = elFeed.scrollHeight;
  }

  function renderRanking() {
    const rankings = state.score ? state.score.rankings || {} : {};
    const data = rankings[state.rankingPeriod] || { rows: [] };
    if (!data.rows.length) {
      elRankingList.innerHTML = `<div class="empty">${escapeHtml(t('还没有排行榜资料。', 'No ranking data yet.'))}</div>`;
      return;
    }
    elRankingList.innerHTML = data.rows.slice(0, 10).map((row) => `
      <div class="ranking-row ${row.isOwnChild ? 'own' : ''}">
        <span>#${escapeHtml(row.rank)}</span>
        <span>${escapeHtml(row.studentName)}</span>
        <strong>${escapeHtml(fmtPoints(row.points))}</strong>
      </div>
    `).join('');
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  async function enableNotifications() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error(t('这个浏览器不支持 Web Push。', 'This browser does not support Web Push.'));
      }
      if (!state.vapidPublicKey) {
        throw new Error(t('还没有设置 VAPID_PUBLIC_KEY。', 'VAPID_PUBLIC_KEY is not configured yet.'));
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error(t('通知权限没有开启。', 'Notification permission was not granted.'));
      const registration = await navigator.serviceWorker.register('/parent-sw.js');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(state.vapidPublicKey),
      });
      const resp = await fetch('/api/parent-push-subscription', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(subscription.toJSON()),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      elNotify.textContent = t('通知已开启', 'Notifications on');
    } catch (err) {
      elNotify.textContent = t('开启通知', 'Enable alerts');
      alert(`${t('通知设置失败', 'Notification setup failed')}：${err.message}`);
    }
  }

  function bindEvents() {
    if (elRefresh) elRefresh.addEventListener('click', loadChildData);
    if (elSignOut) {
      elSignOut.addEventListener('click', () => {
        saveToken('');
        state.user = null;
        state.children = [];
        if (window.google && window.google.accounts && window.google.accounts.id) {
          window.google.accounts.id.disableAutoSelect();
        }
        checkAuth();
      });
    }
    if (elLanguage) {
      elLanguage.addEventListener('change', () => {
        saveLanguage(elLanguage.value);
        renderActiveChildShell();
        renderFeed();
        renderRanking();
      });
    }
    if (elNotify) elNotify.addEventListener('click', enableNotifications);
    document.querySelectorAll('[data-ranking]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.rankingPeriod = btn.getAttribute('data-ranking') || 'week';
        document.querySelectorAll('[data-ranking]').forEach((item) => {
          item.classList.toggle('active', item === btn);
        });
        renderRanking();
      });
    });
  }

  bindEvents();
  checkAuth();
})();
