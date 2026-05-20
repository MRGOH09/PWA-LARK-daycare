(function () {
  'use strict';

  const AUTH_SESSION_KEY = 'daycare-attendance-auth-v1';
  const MAIN_API_ORIGIN = 'https://pwa-lark-daycare.vercel.app';
  const state = {
    auth: { enabled: false, clientId: '', token: '', user: null, error: '' },
    range: 'day',
    data: null
  };

  const $ = (sel) => document.querySelector(sel);
  const elAuthGate = $('#auth-gate');
  const elAuthStatus = $('#auth-status');
  const elGoogleButton = $('#google-signin-button');
  const elDate = $('#date');
  const elMonth = $('#month');
  const elRangeDay = $('#range-day');
  const elRangeMonth = $('#range-month');
  const elRefresh = $('#refresh');
  const elSignOut = $('#sign-out');
  const elMeta = $('#meta');
  const elSummary = $('#summary');
  const elContent = $('#content');

  function getApiOrigin() {
    const host = window.location.hostname;
    return host.endsWith('.vercel.app') && host.includes('attendance') ? MAIN_API_ORIGIN : '';
  }

  function apiUrl(path) {
    return `${getApiOrigin()}${path}`;
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function monthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function dateValue() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(now).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function labelForRange(data) {
    if ((data && data.range) === 'month' || state.range === 'month') return data.month || elMonth.value || monthValue();
    return data.date || elDate.value || dateValue();
  }

  function setRange(range) {
    state.range = range === 'month' ? 'month' : 'day';
    if (elDate) elDate.hidden = state.range !== 'day';
    if (elMonth) elMonth.hidden = state.range !== 'month';
    if (elRangeDay) elRangeDay.classList.toggle('active', state.range === 'day');
    if (elRangeMonth) elRangeMonth.classList.toggle('active', state.range === 'month');
  }

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    if (state.auth.token) headers.Authorization = `Bearer ${state.auth.token}`;
    return headers;
  }

  function loadAuthToken() {
    try {
      state.auth.token = localStorage.getItem(AUTH_SESSION_KEY) || '';
    } catch {
      state.auth.token = '';
    }
  }

  function saveAuthToken(token) {
    state.auth.token = token || '';
    try {
      if (state.auth.token) localStorage.setItem(AUTH_SESSION_KEY, state.auth.token);
      else localStorage.removeItem(AUTH_SESSION_KEY);
    } catch {}
  }

  function setAuthUi() {
    const locked = state.auth.enabled && !state.auth.user;
    if (elAuthGate) elAuthGate.hidden = !locked;
    if (elSignOut) elSignOut.hidden = !(state.auth.enabled && state.auth.user);
    if (elAuthStatus) {
      if (state.auth.user) elAuthStatus.textContent = `已登录：${state.auth.user.email || '-'}`;
      else elAuthStatus.textContent = state.auth.error || '请使用白名单内的 Google 账号登录';
    }
  }

  function loadGoogleScript() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function renderGoogleButton() {
    if (!state.auth.enabled || state.auth.user || !elGoogleButton) return;
    await loadGoogleScript();
    window.google.accounts.id.initialize({
      client_id: state.auth.clientId,
      callback: window.handleGoogleCredential,
      auto_select: false
    });
    elGoogleButton.innerHTML = '';
    window.google.accounts.id.renderButton(elGoogleButton, {
      theme: 'filled_black',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      width: Math.min(320, Math.max(240, window.innerWidth - 56))
    });
  }

  async function checkAuth() {
    loadAuthToken();
    try {
      const resp = await fetch(apiUrl('/api/auth'), { cache: 'no-store', headers: authHeaders() });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      state.auth.enabled = Boolean(data.enabled);
      state.auth.clientId = data.clientId || '';
      state.auth.user = data.authenticated ? data.user : null;
      state.auth.error = '';
      setAuthUi();
      if (state.auth.enabled && !state.auth.user) await renderGoogleButton();
      return !state.auth.enabled || Boolean(state.auth.user);
    } catch (err) {
      if (state.auth.token) {
        saveAuthToken('');
        return checkAuth();
      }
      state.auth.enabled = true;
      state.auth.user = null;
      state.auth.error = `登录检查失败：${err.message}`;
      setAuthUi();
      await renderGoogleButton();
      return false;
    }
  }

  async function handleGoogleCredential(response) {
    try {
      state.auth.error = '正在验证 Google 登录与 Lark 白名单…';
      setAuthUi();
      const resp = await fetch(apiUrl('/api/auth'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response && response.credential })
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      saveAuthToken(data.token || '');
      state.auth.user = data.user || null;
      state.auth.error = '';
      setAuthUi();
      loadStats();
    } catch (err) {
      saveAuthToken('');
      state.auth.user = null;
      state.auth.error = `登录失败：${err.message}`;
      setAuthUi();
      await renderGoogleButton();
    }
  }

  window.handleGoogleCredential = handleGoogleCredential;

  function renderSummary(data) {
    const totals = data.totals || {};
    const steps = statsSteps(data);
    const byStep = totals.byStep || {};
    const cards = [
      ['记录人数', (data.people || []).length],
      ['点名操作', totals.attendanceActions || 0],
      ['影响学生', totals.uniqueStudents || 0],
      ...steps.map((step) => [step.label, byStep[step.key] || 0]),
      ['功课完成', totals.homeworkCompleted || 0],
      ['功课没完成', totals.homeworkNotCompleted || 0]
    ];
    elSummary.innerHTML = cards.map(([label, value]) => `<article class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join('');
  }

  function statsSteps(data) {
    const labels = data && data.stepLabels ? data.stepLabels : {};
    return Object.keys(labels)
      .filter((key) => key !== 'note')
      .map((key) => ({ key, label: labels[key] || key }));
  }

  function renderTable(data) {
    const people = data.people || [];
    if (!people.length) {
      elContent.className = 'empty';
      elContent.textContent = `这个${state.range === 'month' ? '月份' : '日期'}暂时没有点名操作记录。`;
      return;
    }
    const steps = statsSteps(data);
    elContent.className = 'table-wrap';
    elContent.innerHTML = `<table>
      <thead>
        <tr>
          <th>老师</th>
          <th>点名操作</th>
          <th>影响学生</th>
          ${steps.map((step) => `<th>${escapeHtml(step.label)}</th>`).join('')}
          <th>功课完成</th>
          <th>功课没完成</th>
        </tr>
      </thead>
      <tbody>
        ${people.map((person) => {
          const byStep = person.byStep || {};
          return `<tr>
            <td class="name"><strong>${escapeHtml(person.name || person.email || '未记录')}</strong><span>${escapeHtml(person.email || '')}</span></td>
            <td class="num">${escapeHtml(person.attendanceActions || 0)}</td>
            <td class="num">${escapeHtml(person.uniqueStudents || 0)}</td>
            ${steps.map((step) => `<td class="num">${escapeHtml(byStep[step.key] || 0)}</td>`).join('')}
            <td class="num">${escapeHtml(person.homeworkCompleted || 0)}</td>
            <td class="num">${escapeHtml(person.homeworkNotCompleted || 0)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  }

  async function loadStats() {
    try {
      elMeta.textContent = '加载统计中…';
      const params = new URLSearchParams({ range: state.range, t: String(Date.now()) });
      if (state.range === 'month') params.set('month', elMonth.value || monthValue());
      else params.set('date', elDate.value || dateValue());
      const resp = await fetch(apiUrl('/api/attendance-stats?' + params.toString()), {
        cache: 'no-store',
        headers: authHeaders()
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      state.data = data;
      elMeta.textContent = `${labelForRange(data)} · 更新于 ${data.updatedAt || '-'}`;
      renderSummary(data);
      renderTable(data);
    } catch (err) {
      elMeta.textContent = `加载失败：${err.message}`;
      elContent.className = 'empty';
      elContent.textContent = `无法读取统计：${err.message}`;
    }
  }

  async function init() {
    elDate.value = dateValue();
    elMonth.value = monthValue();
    setRange('day');
    elRangeDay.addEventListener('click', () => {
      setRange('day');
      loadStats();
    });
    elRangeMonth.addEventListener('click', () => {
      setRange('month');
      loadStats();
    });
    elRefresh.addEventListener('click', loadStats);
    elDate.addEventListener('change', loadStats);
    elMonth.addEventListener('change', loadStats);
    elSignOut.addEventListener('click', () => {
      saveAuthToken('');
      state.auth.user = null;
      setAuthUi();
      renderGoogleButton();
    });
    const canStart = await checkAuth();
    if (canStart) loadStats();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
