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
    activeTab: 'today',
    feed: [],
    messages: [],
    mentionTeachers: [],
    mentionTeachersChildId: '',
    selectedMentions: [],
    todayStatus: [],
    todayDate: '',
    score: null,
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
  const elChildrenPageList = $('#children-page-list');
  const elActiveChildName = $('#active-child-name');
  const elActiveChildMeta = $('#active-child-meta');
  const elTodayDashboard = $('#today-dashboard');
  const elScoreStrip = $('#score-strip');
  const elFeed = $('#feed');
  const elMessageForm = $('#message-form');
  const elMessageInput = $('#message-input');
  const elMessageSend = $('#message-send');
  const elMessageStatus = $('#message-status');
  const elScoreHistory = $('#score-history');
  const elAuthLanguage = $('#auth-language-select');
  const elLanguage = $('#language-select');
  const elRefresh = $('#refresh');
  const elVersionUpdate = $('#version-update');
  const elSignOut = $('#sign-out');
  const elNotify = $('#notify-btn');

  const UI_TEXT = {
    appTitle: ['宝贝动态', 'Baby Updates'],
    authIntro: [
      '请用爸爸或妈妈绑定的 Google 账号登录，只会显示自己孩子的点名和 Noble Star。',
      "Sign in with a linked parent Google account. You will only see your own child's attendance and Noble Star.",
    ],
    checkingAuth: ['正在检查登录状态…', 'Checking sign-in status...'],
    refresh: ['资料更新', 'Refresh'],
    updateApp: ['版本更新', 'Update app'],
    signOut: ['退出', 'Sign out'],
    chooseChild: ['请选择孩子', 'Choose a child'],
    statusHint: ['今天状态会显示在这里', "Today's status will appear here"],
    enableAlerts: ['开启通知', 'Enable alerts'],
    messagePlaceholder: ['输入给老师的留言', 'Message the teacher'],
    send: ['发送', 'Send'],
    myChildren: ['我的孩子', 'My children'],
    loading: ['加载中…', 'Loading...'],
    tabToday: ['今天', 'Today'],
    tabMessages: ['留言', 'Messages'],
    bottomNav: ['底部导航', 'Bottom navigation'],
    language: ['语言', 'Language'],
  };

  function setParentTabAttr() {
    document.documentElement.dataset.parentTab = state.activeTab || 'today';
  }

  function setParentComposeOpen(open) {
    document.documentElement.dataset.parentCompose = open ? 'open' : 'closed';
  }

  function updateVisualViewportVars() {
    const viewport = window.visualViewport;
    const height = viewport ? viewport.height : window.innerHeight;
    const top = viewport ? viewport.offsetTop : 0;
    const keyboardHeight = viewport
      ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      : 0;
    document.documentElement.style.setProperty('--visual-height', `${Math.round(height)}px`);
    document.documentElement.style.setProperty('--visual-top', `${Math.round(top)}px`);
    document.documentElement.style.setProperty('--keyboard-height', `${Math.round(keyboardHeight)}px`);
    scrollFeedToBottom();
  }

  function scrollFeedToBottom() {
    if (!elFeed) return;
    const scroll = () => {
      elFeed.scrollTop = Math.max(0, elFeed.scrollHeight - elFeed.clientHeight);
    };
    window.requestAnimationFrame(scroll);
    [0, 80, 240].forEach((delay) => window.setTimeout(scroll, delay));
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function currentParentLabel(child) {
    const email = normalizeEmail(state.user && state.user.email);
    const studentName = child && child.studentName ? child.studentName : t('宝贝', 'Child');
    const fatherEmails = new Set((child && child.fatherEmails ? child.fatherEmails : []).map(normalizeEmail));
    const motherEmails = new Set((child && child.motherEmails ? child.motherEmails : []).map(normalizeEmail));
    if (fatherEmails.has(email)) return parentRoleLabel(studentName, 'father');
    if (motherEmails.has(email)) return parentRoleLabel(studentName, 'mother');
    return t('我', 'Me');
  }

  function messageSenderLabel(message) {
    const child = activeChild();
    if (message.senderRole === 'parent') {
      const senderEmail = normalizeEmail(message.senderEmail);
      const myEmail = normalizeEmail(state.user && state.user.email);
      if (!senderEmail || senderEmail === myEmail) return currentParentLabel(child);
      const fatherEmails = new Set((child && child.fatherEmails ? child.fatherEmails : []).map(normalizeEmail));
      const motherEmails = new Set((child && child.motherEmails ? child.motherEmails : []).map(normalizeEmail));
      const studentName = child.studentName || t('宝贝', 'Child');
      if (fatherEmails.has(senderEmail)) return parentRoleLabel(studentName, 'father');
      if (motherEmails.has(senderEmail)) return parentRoleLabel(studentName, 'mother');
      return message.senderName || t('家长', 'Parent');
    }
    return message.senderName || t('老师', 'Teacher');
  }

  function parentRoleLabel(studentName, role) {
    if (state.language === 'en') {
      return role === 'father' ? `${studentName}'s dad` : `${studentName}'s mom`;
    }
    return role === 'father' ? `${studentName}爸爸` : `${studentName}妈妈`;
  }

  function mentionKey(item) {
    return normalizeEmail(item && item.email) || String((item && item.name) || '').trim().toLowerCase();
  }

  function sourceLabel(source) {
    if (source === 'primary_teacher') return t('负责老师', 'Primary teacher');
    if (source === 'recent_attendance') return t('最近照顾', 'Recent care');
    if (source === 'message_participant') return t('回复过', 'Replied');
    return '';
  }

  function selectedMentionsForBody(body) {
    return (state.selectedMentions || []).filter((mention) =>
      body.includes(`@${mention.name}`)
    );
  }

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

  function uiText(key) {
    const pair = UI_TEXT[key] || ['', ''];
    return state.language === 'en' ? pair[1] : pair[0];
  }

  function applyLanguage() {
    document.documentElement.lang = state.language === 'en' ? 'en' : 'zh';
    document.title = uiText('appTitle');
    const appTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appTitle) appTitle.setAttribute('content', uiText('appTitle'));
    if (elAuthLanguage) {
      elAuthLanguage.value = state.language;
      elAuthLanguage.setAttribute('aria-label', uiText('language'));
    }
    if (elLanguage) {
      elLanguage.value = state.language;
      elLanguage.setAttribute('aria-label', uiText('language'));
    }
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = uiText(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', uiText(el.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      el.setAttribute('aria-label', uiText(el.getAttribute('data-i18n-aria-label')));
    });
  }

  function refreshLanguageDependentUi() {
    applyLanguage();
    renderChildren();
    renderActiveChildShell();
    renderFeed();
    renderScore();
    renderScoreHistory();
    refreshNotificationState();
    if (!state.user) renderGoogleButton();
  }

  function changeLanguage(value) {
    saveLanguage(value);
    refreshLanguageDependentUi();
    if (!state.user && elAuthGate && !elAuthGate.hidden) {
      setAuthUi(true, t('请使用爸爸或妈妈绑定的 Google 账号登录', 'Please sign in with a linked parent Google account'));
    }
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
      locale: state.language === 'en' ? 'en' : 'zh_CN',
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
    applyLanguage();
    renderChildren();
    if (!state.activeChildId && state.children[0]) {
      state.activeChildId = state.children[0].recordId;
    }
    renderActiveChildShell();
    if (state.activeChildId) loadChildData();
    switchTab(state.activeTab);
    refreshNotificationState();
  }

  function activeChild() {
    return state.children.find((child) => child.recordId === state.activeChildId) || null;
  }

  function initials(name) {
    return (name || '?').trim().slice(0, 1).toUpperCase();
  }

  function renderChildren() {
    if (elChildrenMeta) elChildrenMeta.textContent = t(`${state.children.length} 个孩子`, `${state.children.length} child${state.children.length === 1 ? '' : 'ren'}`);
    if (!state.children.length) {
      elChildrenList.innerHTML = `<div class="empty">${escapeHtml(t('这个 Google 账号还没有绑定孩子。', 'This Google account is not linked to any child.'))}</div>`;
      if (elChildrenPageList) elChildrenPageList.innerHTML = elChildrenList.innerHTML;
      return;
    }
    const cards = state.children.map((child) => `
      <button class="child-card ${child.recordId === state.activeChildId ? 'active' : ''}" type="button"
        data-child="${escapeHtml(child.recordId)}">
        <span class="avatar">${escapeHtml(initials(child.studentName))}</span>
        <span>
          <strong>${escapeHtml(child.studentName || t('宝贝', 'Child'))}</strong>
          <span>${escapeHtml([child.campus, child.block, child.period].filter(Boolean).join(' · ') || '-')}</span>
        </span>
      </button>
    `).join('');
    elChildrenList.innerHTML = cards;
    if (elChildrenPageList) elChildrenPageList.innerHTML = cards;
    document.querySelectorAll('[data-child]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeChildId = btn.getAttribute('data-child') || '';
        state.feed = [];
        state.messages = [];
        state.mentionTeachers = [];
        state.mentionTeachersChildId = '';
        state.selectedMentions = [];
        state.todayStatus = [];
        state.todayDate = '';
        state.score = null;
        renderChildren();
        renderActiveChildShell();
        loadChildData();
        switchTab('today');
      });
    });
  }

  function renderActiveChildShell() {
    const child = activeChild();
    if (!child) {
      elActiveChildName.textContent = t('请选择孩子', 'Choose a child');
      elActiveChildMeta.textContent = '';
      if (elScoreStrip) elScoreStrip.innerHTML = '';
      if (elScoreHistory) elScoreHistory.innerHTML = '';
      if (elFeed) elFeed.innerHTML = `<div class="empty">${escapeHtml(t('没有孩子资料。', 'No child profile.'))}</div>`;
      if (elMessageForm) elMessageForm.hidden = true;
      if (elTodayDashboard) elTodayDashboard.innerHTML = `<div class="empty">${escapeHtml(t('没有孩子资料。', 'No child profile.'))}</div>`;
      return;
    }
    elActiveChildName.textContent = child.studentName || t('宝贝', 'Child');
    elActiveChildMeta.textContent = [child.year, child.campus, child.block, child.period].filter(Boolean).join(' · ') || t('点名动态', 'Attendance updates');
    renderTodayDashboard();
    renderScore();
    renderScoreHistory();
    renderFeed();
    if (elMessageForm) elMessageForm.hidden = false;
  }

  async function loadChildData() {
    const child = activeChild();
    if (!child) return;
    if (elTodayDashboard) elTodayDashboard.innerHTML = `<div class="empty">${escapeHtml(t('正在读取今天状态…', 'Loading today...'))}</div>`;
    if (elFeed) elFeed.innerHTML = `<div class="empty">${escapeHtml(t('正在读取留言…', 'Loading messages...'))}</div>`;
    if (elScoreStrip) elScoreStrip.innerHTML = `<div class="empty">${escapeHtml(t('正在读取 Noble Star…', 'Loading Noble Star...'))}</div>`;
    if (elScoreHistory) elScoreHistory.innerHTML = '';
    try {
      const feedResp = await fetch(`/api/parent-feed?studentRecordId=${encodeURIComponent(child.recordId)}&t=${Date.now()}`, {
        cache: 'no-store',
        headers: authHeaders(),
      });
      const feedData = await feedResp.json();
      if (!feedResp.ok || !feedData.success) throw new Error(feedData.error || `HTTP ${feedResp.status}`);
      state.feed = feedData.items || [];
      state.todayStatus = feedData.todayStatus || [];
      state.todayDate = feedData.today || '';
      renderTodayDashboard();
    } catch (err) {
      const errorHtml = `<div class="empty">${escapeHtml(t('读取失败', 'Load failed'))}：${escapeHtml(err.message)}</div>`;
      if (elFeed) elFeed.innerHTML = errorHtml;
      if (elTodayDashboard) elTodayDashboard.innerHTML = errorHtml;
    }

    try {
      const msgResp = await fetch(`/api/parent-messages?studentRecordId=${encodeURIComponent(child.recordId)}&t=${Date.now()}`, {
        cache: 'no-store',
        headers: authHeaders(),
      });
      const msgData = await msgResp.json();
      if (!msgResp.ok || !msgData.success) throw new Error(msgData.error || `HTTP ${msgResp.status}`);
      state.messages = msgData.messages || [];
      renderFeed();
    } catch (err) {
      if (elMessageStatus) {
        elMessageStatus.textContent = `${t('留言读取失败', 'Messages load failed')}：${err.message}`;
      }
    }

    try {
      const scoreResp = await fetch(`/api/parent-score?studentRecordId=${encodeURIComponent(child.recordId)}&t=${Date.now()}`, {
        cache: 'no-store',
        headers: authHeaders(),
      });
      const scoreData = await scoreResp.json();
      if (!scoreResp.ok || !scoreData.success) throw new Error(scoreData.error || `HTTP ${scoreResp.status}`);
      state.score = scoreData;
      renderScore();
      renderScoreHistory();
    } catch (err) {
      if (elScoreStrip) {
        elScoreStrip.innerHTML = `<div class="empty">${escapeHtml(t('Noble Star 读取失败', 'Noble Star load failed'))}：${escapeHtml(err.message)}</div>`;
      }
      if (elScoreHistory) elScoreHistory.innerHTML = '';
    }
  }

  async function updateAppVersion(button) {
    const originalText = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = t('更新中…', 'Updating...');
    }
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) =>
          registration.update().catch(() => {})
        ));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } finally {
      if (button) button.textContent = originalText || t('版本更新', 'Update app');
      window.location.reload();
    }
  }

  function fmtPoints(value) {
    const num = Number(value || 0);
    return Number.isInteger(num) ? String(num) : num.toFixed(1);
  }

  function tierDisplayName(tier) {
    if (!tier) return t('新星 III', 'New Star III');
    if (state.language !== 'en') return tier.displayName || tier.label || '-';
    const labels = {
      'new-star': 'New Star',
      'bronze-star': 'Bronze Star',
      'silver-star': 'Silver Star',
      'gold-star': 'Gold Star',
      'platinum-star': 'Platinum Star',
      'diamond-star': 'Diamond Star',
      'stellar-glory': 'Stellar Glory',
      'extraordinary-star': 'Extraordinary Star',
    };
    const label = labels[tier.name] || tier.label || '-';
    return tier.subtier ? `${label} ${tier.subtier}` : label;
  }

  function renderScore() {
    if (!elScoreStrip) return;
    const total = state.score ? state.score.total : 0;
    const weekPoints = state.score ? state.score.weekPoints : 0;
    const monthPoints = state.score ? state.score.monthPoints : 0;
    const tier = state.score && state.score.tier ? state.score.tier : {
      displayName: t('新星 III', 'New Star III'),
      label: t('新星', 'New Star'),
      pointsToNext: 10,
      progressPercent: 0,
      isTopTier: false,
    };
    const progress = Math.max(0, Math.min(100, Number(tier.progressPercent || 0)));
    const nextText = tier.isTopTier
      ? t('已达到最高段位，继续保持闪耀。', 'Top tier reached. Keep shining.')
      : t(`距离下一段还差 ${fmtPoints(tier.pointsToNext)} Noble Star`, `${fmtPoints(tier.pointsToNext)} Noble Star to the next tier`);
    elScoreStrip.innerHTML = `
      <section class="tier-hero">
        <span>${escapeHtml(t('当前段位', 'Current tier'))}</span>
        <strong>${escapeHtml(tierDisplayName(tier))}</strong>
        <p>${escapeHtml(nextText)}</p>
        <div class="tier-progress" aria-label="${escapeHtml(t('段位进度', 'Tier progress'))}">
          <span style="width: ${escapeHtml(progress)}%"></span>
        </div>
      </section>
      <div class="score-card">
        <span>${escapeHtml(t('本月 Noble Star', 'Monthly Noble Star'))}</span>
        <strong>${escapeHtml(fmtPoints(monthPoints))}</strong>
      </div>
      <div class="score-card">
        <span>${escapeHtml(t('本周获得', 'This week'))}</span>
        <strong>${escapeHtml(fmtPoints(weekPoints))}</strong>
      </div>
      <div class="score-card">
        <span>${escapeHtml(t('永久累计', 'All-time total'))}</span>
        <strong>${escapeHtml(fmtPoints(total))}</strong>
      </div>
    `;
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

  function formatClock(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(state.language === 'en' ? 'en-MY' : 'zh-MY', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function renderFeed() {
    if (!elFeed) return;
    const items = (state.messages || []).map((message) => ({
        id: message.id,
        type: 'parent_message',
        date: String(message.createdAt || '').slice(0, 10),
        createdAt: message.createdAt,
        senderRole: message.senderRole,
        teacher: messageSenderLabel(message),
        message: message.body || '',
        pending: !!message.pending,
      }));
    items.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    if (!items.length) {
      elFeed.innerHTML = `<div class="feed-stack"><div class="empty">${escapeHtml(t('暂时还没有动态。', 'No updates yet.'))}</div></div>`;
      return;
    }
    let lastDate = '';
    const html = [];
    items.forEach((item) => {
      const date = item.date || String(item.createdAt || '').slice(0, 10);
      if (date && date !== lastDate) {
        lastDate = date;
        html.push(`<div class="day-divider">${escapeHtml(date)}</div>`);
      }
      const negative = item.type === 'score' && Number(item.points || 0) < 0;
      const teacher = item.teacher || t('老师', 'Teacher');
      const timeText = formatTime(item.createdAt);
      const message = item.message || '';
      const roleClass = `parent-message ${item.senderRole === 'parent' ? 'mine' : 'teacher'} ${item.pending ? 'pending' : ''}`;
      html.push(`
        <article class="message ${negative ? 'negative' : ''} ${roleClass}">
          <strong class="message-sender">${escapeHtml(teacher)}</strong>
          <p>${escapeHtml(message)}</p>
          ${timeText ? `<time class="message-time">${escapeHtml(timeText)}</time>` : ''}
        </article>
      `);
    });
    elFeed.innerHTML = `<div class="feed-stack">${html.join('')}</div>`;
    scrollFeedToBottom();
  }

  async function loadMentionTeachers(force = false) {
    const child = activeChild();
    if (!child) return [];
    if (!force && state.mentionTeachersChildId === child.recordId) {
      return state.mentionTeachers || [];
    }
    try {
      const resp = await fetch(`/api/parent-mention-teachers?studentRecordId=${encodeURIComponent(child.recordId)}&t=${Date.now()}`, {
        cache: 'no-store',
        headers: authHeaders(),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      state.mentionTeachers = data.teachers || [];
      state.mentionTeachersChildId = child.recordId;
    } catch {
      state.mentionTeachers = [];
      state.mentionTeachersChildId = child.recordId;
    }
    return state.mentionTeachers;
  }

  function mentionTrigger() {
    if (!elMessageInput) return null;
    const cursor = elMessageInput.selectionStart || 0;
    const text = elMessageInput.value.slice(0, cursor);
    const at = text.lastIndexOf('@');
    if (at < 0) return null;
    const before = at === 0 ? '' : text[at - 1];
    if (before && !/\s/.test(before)) return null;
    const query = text.slice(at + 1);
    if (/[\s@]/.test(query)) return null;
    return { start: at, end: cursor, query: query.toLowerCase() };
  }

  function hideMentionMenu() {
    const menu = document.getElementById('mention-menu');
    if (menu) menu.hidden = true;
  }

  async function renderMentionMenu() {
    const menu = document.getElementById('mention-menu');
    if (!menu || !elMessageInput) return;
    const trigger = mentionTrigger();
    if (!trigger) {
      hideMentionMenu();
      return;
    }
    const teachers = await loadMentionTeachers(false);
    const selected = new Set((state.selectedMentions || []).map(mentionKey));
    const matches = teachers
      .filter((teacher) => !selected.has(mentionKey(teacher)))
      .filter((teacher) => !trigger.query || String(teacher.name || '').toLowerCase().includes(trigger.query))
      .slice(0, 8);
    if (!matches.length) {
      menu.innerHTML = `<div class="mention-empty">${escapeHtml(t('没有相关老师', 'No related teachers'))}</div>`;
      menu.hidden = false;
      return;
    }
    menu.innerHTML = matches.map((teacher, index) => `
      <button type="button" data-mention-index="${index}">
        <strong>${escapeHtml(teacher.name || '')}</strong>
        <span>${escapeHtml(sourceLabel(teacher.source))}</span>
      </button>
    `).join('');
    menu.hidden = false;
    menu.querySelectorAll('[data-mention-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const teacher = matches[Number(btn.getAttribute('data-mention-index') || 0)];
        insertMention(teacher, trigger);
      });
    });
  }

  function insertMention(teacher, trigger) {
    if (!elMessageInput || !teacher) return;
    const text = elMessageInput.value;
    const picked = `@${teacher.name} `;
    elMessageInput.value = text.slice(0, trigger.start) + picked + text.slice(trigger.end);
    const cursor = trigger.start + picked.length;
    elMessageInput.setSelectionRange(cursor, cursor);
    if (!(state.selectedMentions || []).some((item) => mentionKey(item) === mentionKey(teacher))) {
      state.selectedMentions.push({
        name: teacher.name || '',
        email: teacher.email || '',
        source: teacher.source || '',
      });
    }
    hideMentionMenu();
    elMessageInput.focus();
  }

  async function sendParentMessage() {
    const child = activeChild();
    const body = elMessageInput ? elMessageInput.value.trim() : '';
    if (!child) return;
    if (!body) {
      if (elMessageStatus) elMessageStatus.textContent = t('请先输入留言。', 'Please enter a message first.');
      return;
    }
    const mentions = selectedMentionsForBody(body);
    const tempId = `local-${Date.now()}`;
    const optimisticMessage = {
      id: tempId,
      studentRecordId: child.recordId,
      senderRole: 'parent',
      senderEmail: state.user && state.user.email,
      senderName: currentParentLabel(child),
      body,
      mentions,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    state.messages.push(optimisticMessage);
    if (elMessageInput) {
      elMessageInput.value = '';
      elMessageInput.style.height = 'auto';
    }
    if (elMessageStatus) elMessageStatus.textContent = '';
    state.selectedMentions = [];
    hideMentionMenu();
    renderFeed();
    if (elMessageSend) elMessageSend.disabled = true;
    try {
      const resp = await fetch('/api/parent-messages', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ studentRecordId: child.recordId, body, mentions }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      state.messages = state.messages.map((message) => (
        message.id === tempId ? data.message : message
      ));
      if (elMessageStatus) elMessageStatus.textContent = '';
      renderFeed();
    } catch (err) {
      state.messages = state.messages.map((message) => (
        message.id === tempId ? Object.assign({}, message, { pending: false, failed: true }) : message
      ));
      renderFeed();
      if (elMessageStatus) elMessageStatus.textContent = `${t('发送失败', 'Send failed')}：${err.message}`;
    } finally {
      if (elMessageSend) elMessageSend.disabled = false;
    }
  }

  function scoreSourceLabel(event) {
    if (event.source === 'attendance_auto') return t('自动点名', 'Attendance');
    if (event.source === 'teacher_manual') return t('老师加减分', 'Teacher');
    return event.source || '';
  }

  function scoreReason(event) {
    const reason = event.reasonLabel || event.reason_label || '';
    const note = event.note || '';
    return [reason, note].filter(Boolean).join(' · ') || t('Noble Star 调整', 'Noble Star update');
  }

  function renderScoreHistory() {
    if (!elScoreHistory) return;
    const events = state.score && state.score.events ? state.score.events.slice(0, 20) : [];
    if (!events.length) {
      elScoreHistory.innerHTML = `<div class="empty">${escapeHtml(t('还没有 Noble Star 记录。', 'No Noble Star records yet.'))}</div>`;
      return;
    }
    elScoreHistory.innerHTML = `
      <div class="score-history-head">
        <strong>${escapeHtml(t('最近 Noble Star 记录', 'Recent Noble Star records'))}</strong>
        <span>${escapeHtml(t('显示最近 20 条', 'Latest 20 records'))}</span>
      </div>
      ${events.map((event) => {
        const points = Number(event.points || 0);
        const sign = points > 0 ? '+' : '';
        const source = scoreSourceLabel(event);
        const actor = event.actorName || event.actor_name || event.actorEmail || event.actor_email || source;
        const meta = [formatTime(event.createdAt || event.date), actor].filter(Boolean).join(' · ');
        return `
          <article class="score-event ${points < 0 ? 'negative' : 'positive'}">
            <strong>${escapeHtml(`${sign}${fmtPoints(points)}`)}</strong>
            <div>
              <p>${escapeHtml(scoreReason(event))}</p>
              <span>${escapeHtml(meta)}</span>
            </div>
          </article>
        `;
      }).join('')}
    `;
  }

  function latestNote() {
    return state.feed.find((item) => item.stepKey === 'note') || null;
  }

  function statusMeta(item) {
    const parts = [];
    const timeText = formatTime(item.createdAt);
    if (item.teacher) parts.push(item.teacher);
    if (timeText) parts.push(timeText);
    return parts.join(' · ');
  }

  function renderTodayDashboard() {
    if (!elTodayDashboard) return;
    const child = activeChild();
    if (!child) {
      elTodayDashboard.innerHTML = `<div class="empty">${escapeHtml(t('没有孩子资料。', 'No child profile.'))}</div>`;
      return;
    }
    const statusCards = (state.todayStatus || []).map((item) => `
      <div class="status-card ${item.done ? 'done' : 'pending'}">
        <div class="status-label">${escapeHtml(item.label)}</div>
        <div class="status-value">${escapeHtml(item.value || '-')}</div>
        <div class="status-meta">${escapeHtml(statusMeta(item) || t('今天还没有更新', 'No update today'))}</div>
      </div>
    `).join('');
    const note = latestNote();
    const noteHtml = note ? `
      <div class="today-card">
        <h2>${escapeHtml(t('老师留言', 'Teacher message'))}</h2>
        <p>${escapeHtml(note.teacher || t('老师', 'Teacher'))} · ${escapeHtml(formatTime(note.createdAt))}</p>
        <p>${escapeHtml(note.message || '')}</p>
      </div>
    ` : '';
    elTodayDashboard.innerHTML = `
      <div class="today-card">
        <h2>${escapeHtml(t('今日状态', "Today's dashboard"))}</h2>
        <p>${escapeHtml([child.studentName, child.year, child.campus, child.block, child.period].filter(Boolean).join(' · '))}</p>
        <div class="quick-actions">
          <button type="button" data-jump-tab="messages">${escapeHtml(t('看留言', 'Messages'))}</button>
          <button type="button" data-jump-tab="stars">${escapeHtml(t('看 Noble Star', 'Noble Star'))}</button>
        </div>
      </div>
      <div class="status-grid">${statusCards || `<div class="empty">${escapeHtml(t('今天还没有点名状态。', 'No attendance status today.'))}</div>`}</div>
      ${noteHtml}
    `;
    elTodayDashboard.querySelectorAll('[data-jump-tab]').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.getAttribute('data-jump-tab') || 'today'));
    });
  }

  function switchTab(tab) {
    state.activeTab = ['today', 'messages', 'stars', 'children'].includes(tab) ? tab : 'today';
    setParentTabAttr();
    if (state.activeTab !== 'messages') setParentComposeOpen(false);
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `${state.activeTab}-panel`);
    });
    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === state.activeTab);
    });
    if (state.activeTab === 'messages') scrollFeedToBottom();
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  async function getReadyServiceWorkerRegistration() {
    await navigator.serviceWorker.register('/parent-sw.js');
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) {
      throw new Error(t('通知服务还在启动，请刷新后再试一次。', 'Notification service is still starting. Please refresh and try again.'));
    }
    return registration;
  }

  function setNotifyButton(label, disabled) {
    if (!elNotify) return;
    elNotify.textContent = label;
    elNotify.disabled = !!disabled;
  }

  function isIosDevice() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent || '');
  }

  function isStandaloneApp() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function unsupportedPushMessage() {
    if (isIosDevice() && !isStandaloneApp()) {
      return t(
        'iPhone 通知需要先加入主屏幕：按下面分享按钮 → 加入主屏幕 → 从桌面打开“宝贝动态” → 再点开启通知。',
        'On iPhone, add this app to Home Screen first: Share → Add to Home Screen → open Baby Updates from the Home Screen → enable alerts.'
      );
    }
    if (isIosDevice()) {
      return t(
        '这台 iPhone 目前不能开启通知，请确认 iOS 16.4 以上，并从主屏幕图标打开。',
        'This iPhone cannot enable notifications yet. Please use iOS 16.4+ and open from the Home Screen icon.'
      );
    }
    return t('这个浏览器不支持通知，请换 Chrome / Edge 或支持通知的浏览器。', 'This browser does not support notifications. Please use Chrome, Edge, or another browser with notification support.');
  }

  async function enableNotifications() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        throw new Error(unsupportedPushMessage());
      }
      if (!state.vapidPublicKey) {
        throw new Error(t('还没有设置 VAPID_PUBLIC_KEY。', 'VAPID_PUBLIC_KEY is not configured yet.'));
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error(t('通知权限没有开启。', 'Notification permission was not granted.'));
      const registration = await getReadyServiceWorkerRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(state.vapidPublicKey),
        });
      }
      const resp = await fetch('/api/parent-push-subscription', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(subscription.toJSON()),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      setNotifyButton(t('通知已开启', 'Notifications on'), false);
    } catch (err) {
      setNotifyButton(t('开启通知', 'Enable alerts'), false);
      alert(`${t('通知设置失败', 'Notification setup failed')}：${err.message}`);
    }
  }

  async function refreshNotificationState() {
    if (!elNotify) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setNotifyButton(t('开启通知', 'Enable alerts'), false);
      return;
    }
    if (Notification.permission === 'denied') {
      setNotifyButton(t('通知已关闭', 'Notifications blocked'), false);
      return;
    }
    if (Notification.permission !== 'granted' || !state.vapidPublicKey) {
      setNotifyButton(t('开启通知', 'Enable alerts'), false);
      return;
    }
    try {
      const registration = await getReadyServiceWorkerRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setNotifyButton(t('开启通知', 'Enable alerts'), false);
        return;
      }
      setNotifyButton(t('通知已开启', 'Notifications on'), true);
      const resp = await fetch('/api/parent-push-subscription', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(subscription.toJSON()),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      setNotifyButton(t('通知已开启', 'Notifications on'), false);
    } catch {
      setNotifyButton(t('开启通知', 'Enable alerts'), false);
    }
  }

  function bindEvents() {
    if (elRefresh) elRefresh.addEventListener('click', loadChildData);
    if (elVersionUpdate) elVersionUpdate.addEventListener('click', () => updateAppVersion(elVersionUpdate));
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
    if (elAuthLanguage) {
      elAuthLanguage.addEventListener('change', () => changeLanguage(elAuthLanguage.value));
    }
    if (elLanguage) {
      elLanguage.addEventListener('change', () => changeLanguage(elLanguage.value));
    }
    if (elNotify) elNotify.addEventListener('click', enableNotifications);
    if (elMessageForm) {
      elMessageForm.addEventListener('submit', (event) => {
        event.preventDefault();
        sendParentMessage();
      });
    }
    if (elMessageInput) {
      elMessageInput.addEventListener('focus', () => {
        setParentComposeOpen(true);
        updateVisualViewportVars();
        renderMentionMenu();
      });
      elMessageInput.addEventListener('blur', () => {
        window.setTimeout(() => {
          setParentComposeOpen(false);
          updateVisualViewportVars();
          hideMentionMenu();
        }, 120);
      });
      elMessageInput.addEventListener('input', () => {
        elMessageInput.style.height = 'auto';
        elMessageInput.style.height = `${Math.min(elMessageInput.scrollHeight, 96)}px`;
        state.selectedMentions = selectedMentionsForBody(elMessageInput.value);
        renderMentionMenu();
        scrollFeedToBottom();
      });
      elMessageInput.addEventListener('keyup', renderMentionMenu);
      elMessageInput.addEventListener('click', renderMentionMenu);
    }
    window.addEventListener('resize', updateVisualViewportVars);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateVisualViewportVars);
      window.visualViewport.addEventListener('scroll', updateVisualViewportVars);
    }
    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab') || 'today'));
    });
  }

  applyLanguage();
  bindEvents();
  checkAuth();
})();
