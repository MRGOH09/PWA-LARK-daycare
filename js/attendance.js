(function () {
  'use strict';

  const AUTO_REFRESH_MS = 30 * 1000;
  const STUDENTS_CACHE_KEY = 'daycare-students-cache-v1';
  const ATTENDANCE_CACHE_KEY = 'daycare-attendance-draft-v1';
  const AUTH_SESSION_KEY = 'daycare-attendance-auth-v1';
  const STUDENT_FIELDS = {
    no: 'NO',
    name: '学生名字',
    year: 'YEAR / FORM',
    teacher: '负责老师',
    time: '时间段',
    block: 'BLOCK',
    campus: '分院',
    stopMonth: 'Stop 月份'
  };
  const ATTENDANCE_STEPS = [
    { key: 'arrival', label: '到了补习中心', defaultValue: '未点', options: ['未点', '到了', '还没有', '缺席', 'KOKO'] },
    { key: 'tuition', label: '去补习了', defaultValue: '未点', options: ['未点', '去了', '迟进补习'] },
    { key: 'shower', label: '冲凉了', defaultValue: '未点', options: ['未点', '冲了', '不冲凉'] },
    { key: 'meal', label: '吃饭', defaultValue: '未点', options: ['未点', '吃饭了', '不吃饭'] },
    { key: 'homework', label: '功课完成', defaultValue: '未点', options: ['未点', '完成了', '没完成'] },
    { key: 'extra', label: 'extra复习', defaultValue: '未点', options: ['未点', 'extra复习了', '没有复习'] },
    { key: 'home', label: '回家', defaultValue: '未回家', options: ['未回家', '回家'] }
  ];
  const FIXED_YEAR_ORDER = ['PA', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'F1', 'F2', 'F3', 'F4', 'F5'];
  const MAIN_API_ORIGIN = 'https://pwa-lark-daycare.vercel.app';
  const PERSIST_DEBOUNCE_MS = 450;
  const LONG_PRESS_MS = 520;
  const PRIMARY_STEP_VALUES = {
    arrival: '到了',
    tuition: '去了',
    shower: '冲了',
    meal: '吃饭了',
    homework: '完成了',
    extra: 'extra复习了',
    home: '回家'
  };
  const API_ORIGIN = getApiOrigin();

  const state = {
    students: [],
    attendance: {},
    attendanceDate: todayDateString(),
    attendanceSearch: '',
    attendanceFilters: { campus: '', block: '', year: '', time: '' },
    showUnfinishedOnly: false,
    unfinishedStep: 'arrival',
    attendanceLoaded: false,
    attendanceSavingKeys: new Set(),
    attendanceSyncText: '尚未同步点名记录',
    lastAttendanceHash: '',
    lastStudentsHash: '',
    refreshTimer: null,
    modalOpen: false,
    collapsedYears: new Set(),
    currentView: 'attendance',
    teacherStatsRange: 'day',
    teacherStatsDate: todayDateString(),
    teacherStatsMonth: currentMonthString(),
    teacherStatsLoadedKey: '',
    teacherStatsLoading: false,
    teacherStatsError: '',
    teacherStats: null,
    auth: {
      checked: false,
      enabled: false,
      clientId: '',
      token: '',
      user: null,
      error: ''
    },
    appStarted: false
  };
  const pendingPersistTimers = new Map();
  const pendingPersistStudents = new Map();

  const $ = (sel) => document.querySelector(sel);
  const elAttendanceSummary = $('#attendance-summary');
  const elAttendanceDate = $('#attendance-date');
  const elAttendanceCampus = $('#attendance-filter-campus');
  const elAttendanceBlock = $('#attendance-filter-block');
  const elAttendanceYear = $('#attendance-filter-year');
  const elAttendanceTime = $('#attendance-filter-time');
  const elAttendanceSearch = $('#attendance-search');
  const elAttendanceMeta = $('#attendance-meta');
  const elAttendanceScopeDate = $('#attendance-scope-date');
  const elAttendanceScopeWeekday = $('#attendance-scope-weekday');
  const elAttendanceScopeCampus = $('#attendance-scope-campus');
  const elAttendanceScopeBlock = $('#attendance-scope-block');
  const elAttendanceScopeYear = $('#attendance-scope-year');
  const elAttendanceScopeTime = $('#attendance-scope-time');
  const elAttendanceFlowList = $('#attendance-flow-list');
  const elAttendanceListMeta = $('#attendance-list-meta');
  const elAttendanceList = $('#attendance-list');
  const elAttendanceCurrentRange = $('#attendance-current-range');
  const elAttendanceMain = $('#attendance-main');
  const elAttendanceToolbar = $('.attendance-toolbar');
  const elAttendanceQuickTools = $('.attendance-quick-tools');
  const elUnfinishedStep = $('#attendance-unfinished-step');
  const elUnfinishedToggle = $('#attendance-unfinished-toggle');
  const elUnfinishedMeta = $('#attendance-unfinished-meta');
  const elRefresh = $('#refresh');
  const elViewAttendance = $('#view-attendance');
  const elViewStats = $('#view-stats');
  const elViewSettings = $('#view-settings');
  const elTeacherStatsPanel = $('#teacher-stats-panel');
  const elTeacherStatsRangeDay = $('#teacher-stats-range-day');
  const elTeacherStatsRangeMonth = $('#teacher-stats-range-month');
  const elTeacherStatsDate = $('#teacher-stats-date');
  const elTeacherStatsMonth = $('#teacher-stats-month');
  const elTeacherStatsRefresh = $('#teacher-stats-refresh');
  const elTeacherStatsMeta = $('#teacher-stats-meta');
  const elTeacherStatsTable = $('#teacher-stats-table');
  const elModalRoot = $('#modal-root');
  const elAuthGate = $('#auth-gate');
  const elAuthStatus = $('#auth-status');
  const elGoogleButton = $('#google-signin-button');
  const elSignOut = $('#sign-out');
  const elCurrentUser = $('#current-user');
  const elMobileSettingsPanel = $('#mobile-settings-panel');
  const elMobileCurrentUser = $('#mobile-current-user');
  const elMobileSignOut = $('#mobile-sign-out');
  const elMobileRefresh = $('#mobile-refresh');
  const elMobileSyncStatus = $('#mobile-sync-status');
  const elMobileFilterToggle = $('#mobile-filter-toggle');
  const elMobileFilterClose = $('#mobile-filter-close');

  function getApiOrigin() {
    const host = window.location.hostname;
    const isStandaloneVercelAttendance = host.endsWith('.vercel.app') &&
      host.includes('attendance') &&
      host !== 'pwa-lark-daycare.vercel.app';
    return isStandaloneVercelAttendance ? MAIN_API_ORIGIN : '';
  }

  function apiUrl(path) {
    return `${API_ORIGIN}${path}`;
  }

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    if (state.auth.token) headers.Authorization = `Bearer ${state.auth.token}`;
    return headers;
  }

  function apiFetch(path, options = {}) {
    const headers = authHeaders(options.headers);
    return fetch(apiUrl(path), Object.assign({}, options, { headers }));
  }

  function syncShellMode() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    const width = Math.min(window.innerWidth || 0, window.screen ? window.screen.width : Infinity);
    let device = 'desktop';
    if (width <= 720) device = 'phone';
    else if (width <= 1180) device = 'tablet';
    document.documentElement.dataset.displayMode = standalone ? 'pwa' : 'web';
    document.documentElement.dataset.device = device;
    syncMobileQuickToolsPlacement(device === 'phone');
  }

  function syncMobileQuickToolsPlacement(isPhone) {
    if (!elAttendanceToolbar || !elAttendanceQuickTools || !elAttendanceMain) return;
    if (isPhone) {
      if (elAttendanceQuickTools.parentElement !== elAttendanceToolbar) {
        const meta = elAttendanceToolbar.querySelector('#attendance-meta');
        elAttendanceToolbar.insertBefore(elAttendanceQuickTools, meta || null);
      }
      return;
    }
    if (elAttendanceQuickTools.parentElement === elAttendanceToolbar) {
      elAttendanceToolbar.after(elAttendanceQuickTools);
    }
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function unique(arr) {
    return Array.from(new Set(arr));
  }

  function fillSelectWithAll(el, options, current, allLabel = '全部') {
    if (!el) return;
    el.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` +
      options.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    el.value = current && options.includes(current) ? current : '';
  }

  function todayDateString() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }

  function currentMonthString() {
    return todayDateString().slice(0, 7);
  }

  function studentValue(rec, field) {
    return String((rec.fields || {})[field] || '').trim();
  }

  function normalizedStudentYear(rec) {
    return studentValue(rec, STUDENT_FIELDS.year).toUpperCase();
  }

  function isStoppedStudent(rec) {
    return Boolean(studentValue(rec, STUDENT_FIELDS.stopMonth));
  }

  function attendanceDateWeekday() {
    const date = new Date(`${state.attendanceDate}T12:00:00+08:00`);
    const idx = date.getDay();
    const labels = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return labels[idx] || '-';
  }

  function attendanceDateWeekdayKey() {
    const date = new Date(`${state.attendanceDate}T12:00:00+08:00`);
    const keys = ['', 'MON', 'TUE', 'WED', 'THUR', 'FRI', ''];
    return keys[date.getDay()] || '';
  }

  function attendanceTimeSegment(rec) {
    const raw = studentValue(rec, STUDENT_FIELDS.time);
    const text = raw.toLowerCase();
    if (raw.includes('早') || text.includes('morning') || text.includes('am')) return '早上';
    if (raw.includes('下') || text.includes('afternoon') || text.includes('pm')) return '下午';
    return raw || '未填时间段';
  }

  function attendanceYearLabel(rec) {
    return normalizedStudentYear(rec) || '未填年级';
  }

  function attendanceYearRank(year) {
    const idx = FIXED_YEAR_ORDER.indexOf(String(year || '').toUpperCase());
    if (idx >= 0) return idx;
    return year === '未填年级' ? 998 : 500;
  }

  function compareAttendanceYears(a, b) {
    const rankA = attendanceYearRank(a);
    const rankB = attendanceYearRank(b);
    return rankA - rankB || String(a || '').localeCompare(String(b || ''), 'zh', { numeric: true });
  }

  function attendanceStudentId(rec) {
    return rec.recordId || studentValue(rec, STUDENT_FIELDS.no) || studentValue(rec, STUDENT_FIELDS.name);
  }

  function attendanceKey(rec) {
    return [state.attendanceDate, attendanceStudentId(rec)].join('|');
  }

  function attendanceKeyFromRecord(record) {
    return [record.date || state.attendanceDate, record.studentRecordId || record.studentNo || record.studentName].join('|');
  }

  function defaultAttendanceRecord() {
    return ATTENDANCE_STEPS.reduce((out, step) => {
      out[step.key] = step.defaultValue;
      return out;
    }, { note: '', updatedAt: '' });
  }

  function attendanceRecordFor(rec) {
    const key = attendanceKey(rec);
    return Object.assign(defaultAttendanceRecord(), state.attendance[key] || {});
  }

  function loadAttendanceCache() {
    try {
      const raw = localStorage.getItem(ATTENDANCE_CACHE_KEY);
      state.attendance = raw ? JSON.parse(raw) || {} : {};
    } catch {
      state.attendance = {};
    }
  }

  function saveAttendanceCache() {
    try {
      localStorage.setItem(ATTENDANCE_CACHE_KEY, JSON.stringify(state.attendance));
    } catch {}
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
    document.documentElement.dataset.auth = locked ? 'locked' : 'ready';
    if (elAuthGate) elAuthGate.hidden = !locked;
    const userText = state.auth.user ? (state.auth.user.name || state.auth.user.email || '已登录') : '';
    if (elCurrentUser) {
      elCurrentUser.textContent = userText;
    }
    if (elMobileCurrentUser) {
      elMobileCurrentUser.textContent = userText || (state.auth.enabled ? '尚未登录' : '未启用登录限制');
    }
    if (elSignOut) elSignOut.hidden = !(state.auth.enabled && state.auth.user);
    if (elMobileSignOut) elMobileSignOut.hidden = !(state.auth.enabled && state.auth.user);
    if (elAuthStatus) {
      if (!state.auth.enabled) elAuthStatus.textContent = '未启用 Google 登录限制';
      else if (state.auth.user) elAuthStatus.textContent = `已登录：${state.auth.user.email || '-'}`;
      else elAuthStatus.textContent = state.auth.error || '请使用白名单内的 Google 账号登录';
    }
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
      const resp = await fetch(apiUrl('/api/auth'), {
        cache: 'no-store',
        headers: authHeaders()
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      state.auth.enabled = Boolean(data.enabled);
      state.auth.clientId = data.clientId || '';
      state.auth.user = data.authenticated ? data.user : null;
      state.auth.error = '';
      state.auth.checked = true;
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
      state.auth.checked = true;
      setAuthUi();
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
      startAppData();
    } catch (err) {
      saveAuthToken('');
      state.auth.user = null;
      state.auth.error = `登录失败：${err.message}`;
      setAuthUi();
      await renderGoogleButton();
    }
  }

  window.handleGoogleCredential = handleGoogleCredential;

  function saveStudentsCache(data) {
    try {
      localStorage.setItem(STUDENTS_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        data: {
          success: true,
          updatedAt: data.updatedAt || null,
          count: data.count || 0,
          columns: data.columns || [],
          records: data.records || []
        }
      }));
    } catch {}
  }

  function loadStudentsCache() {
    try {
      const raw = localStorage.getItem(STUDENTS_CACHE_KEY);
      if (!raw) return false;
      const cached = JSON.parse(raw);
      if (!cached || !cached.data || !cached.data.records) return false;
      applyStudentsPayload(cached.data);
      if (elAttendanceMeta) {
        elAttendanceMeta.textContent = `先显示本机缓存 ${state.students.length} 条 · 正在更新最新点名名单…`;
      }
      return true;
    } catch {
      return false;
    }
  }

  function attendanceScrollPosition() {
    const wrap = elAttendanceList ? elAttendanceList.querySelector('.attendance-board-wrap') : null;
    return wrap ? { top: wrap.scrollTop, left: wrap.scrollLeft } : null;
  }

  function restoreAttendanceScroll(position) {
    if (!position) return;
    window.requestAnimationFrame(() => {
      const wrap = elAttendanceList ? elAttendanceList.querySelector('.attendance-board-wrap') : null;
      if (!wrap) return;
      wrap.scrollTop = position.top;
      wrap.scrollLeft = position.left;
    });
  }

  function updateAttendanceByKey(key, patch, options = {}) {
    state.attendance[key] = Object.assign(defaultAttendanceRecord(), state.attendance[key] || {}, patch, {
      updatedAt: new Date().toISOString()
    });
    saveAttendanceCache();
    if (options.persist) {
      schedulePersistAttendanceRecord(options.student, key);
    }
    if (state.showUnfinishedOnly) {
      renderAttendanceView({ preserveScroll: true });
      return;
    }
    if (options.student) updateAttendanceDomForStudent(options.student);
    renderAttendanceStatusPanels(filteredAttendanceStudents());
  }

  function updateAttendanceForStudent(rec, patch) {
    updateAttendanceByKey(attendanceKey(rec), patch, { persist: true, student: rec });
  }

  function applyAttendancePayload(data) {
    const next = {};
    for (const record of data.records || []) {
      const key = attendanceKeyFromRecord(record);
      next[key] = Object.assign(defaultAttendanceRecord(), record);
    }
    Object.keys(state.attendance).forEach((key) => {
      if (pendingPersistTimers.has(key) || state.attendanceSavingKeys.has(key)) {
        next[key] = state.attendance[key];
      }
    });
    state.attendance = next;
    state.attendanceDate = data.date || state.attendanceDate;
    state.attendanceLoaded = true;
    state.lastAttendanceHash = String(data.count || 0) + '|' + (data.updatedAt || '');
    state.attendanceSyncText = `已同步 ${data.source === 'supabase' ? 'Supabase' : 'Lark'} · ${data.updatedAt || '-'}`;
    saveAttendanceCache();
    renderAttendanceView({ preserveScroll: true });
  }

  function applyStudentsPayload(data) {
    state.students = data.records || [];
    state.lastStudentsHash = String(data.count || 0) + '|' + (data.updatedAt || '');
    renderAttendanceView({ preserveScroll: true });
  }

  function attendanceStudentPayload(rec) {
    return {
      recordId: attendanceStudentId(rec),
      no: studentValue(rec, STUDENT_FIELDS.no),
      name: studentValue(rec, STUDENT_FIELDS.name),
      year: studentValue(rec, STUDENT_FIELDS.year),
      block: studentValue(rec, STUDENT_FIELDS.block),
      campus: studentValue(rec, STUDENT_FIELDS.campus),
      teacher: studentValue(rec, STUDENT_FIELDS.teacher),
      period: attendanceTimeSegment(rec)
    };
  }

  async function persistAttendanceRecord(rec, key) {
    if (!rec || !key) return;
    const sentUpdatedAt = state.attendance[key] ? state.attendance[key].updatedAt : '';
    state.attendanceSavingKeys.add(key);
    state.attendanceSyncText = '保存中…';
    renderAttendanceStatusPanels(filteredAttendanceStudents());
    try {
      const resp = await apiFetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: state.attendanceDate,
          weekday: attendanceDateWeekdayKey(),
          student: attendanceStudentPayload(rec),
          attendance: attendanceRecordFor(rec)
        })
      });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('返回非 JSON 数据'); }
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      const record = data.record || {};
      const returnedKey = attendanceKeyFromRecord(record);
      if (returnedKey && (!state.attendance[key] || state.attendance[key].updatedAt === sentUpdatedAt)) {
        state.attendance[returnedKey] = Object.assign(defaultAttendanceRecord(), record);
        updateAttendanceDomForStudent(rec);
      }
      state.attendanceSyncText = `${data.action === 'created' ? '已新增' : '已更新'} ${data.source === 'supabase' ? 'Supabase' : 'Lark'}`;
      if (data.duplicateCount > 1) {
        state.attendanceSyncText += ` · 发现重复 ${data.duplicateCount} 笔`;
      }
      if (Array.isArray(data.syncWarnings) && data.syncWarnings.length) {
        state.attendanceSyncText += ` · 同步提醒 ${data.syncWarnings.length} 条`;
      }
      saveAttendanceCache();
    } catch (err) {
      state.attendanceSyncText = `保存失败：${err.message}`;
    } finally {
      state.attendanceSavingKeys.delete(key);
      renderAttendanceStatusPanels(filteredAttendanceStudents());
    }
  }

  function schedulePersistAttendanceRecord(rec, key) {
    if (!rec || !key) return;
    const existing = pendingPersistTimers.get(key);
    if (existing) window.clearTimeout(existing);
    pendingPersistStudents.set(key, rec);
    state.attendanceSyncText = '已记录，准备保存…';
    renderAttendanceStatusPanels(filteredAttendanceStudents());
    const timer = window.setTimeout(() => {
      pendingPersistTimers.delete(key);
      const student = pendingPersistStudents.get(key);
      pendingPersistStudents.delete(key);
      persistAttendanceRecord(student, key);
    }, PERSIST_DEBOUNCE_MS);
    pendingPersistTimers.set(key, timer);
  }

  function attendanceTone(value) {
    if (value === '未点' || value === '未回家') return 'idle';
    if (value === '到了' || value === '去了' || value === '冲了' || value === '吃饭了' ||
        value === '完成了' || value === 'extra复习了') return 'good';
    if (value === '回家') return 'home';
    if (value === '还没有' || value === '迟进补习' || value === '没完成' || value === '没有复习') return 'warn';
    if (value === '缺席' || value === '不冲凉' || value === '不吃饭') return 'bad';
    if (value === 'KOKO') return 'koko';
    return 'idle';
  }

  function isAttendanceMarked(record) {
    return ATTENDANCE_STEPS.some((step) => record[step.key] !== step.defaultValue) ||
      Boolean((record.note || '').trim());
  }

  function unfinishedStepLabel() {
    const step = ATTENDANCE_STEPS.find((item) => item.key === state.unfinishedStep);
    return step ? step.label : '全部项目';
  }

  function unfinishedStepsForRecord(record, stepKey = state.unfinishedStep) {
    return ATTENDANCE_STEPS.filter((step) => {
      if (stepKey && step.key !== stepKey) return false;
      if (isAttendanceFollowupDisabled(step, record)) return false;
      return (record[step.key] || step.defaultValue) === step.defaultValue;
    });
  }

  function isAttendanceUnfinished(rec) {
    return unfinishedStepsForRecord(attendanceRecordFor(rec), state.unfinishedStep).length > 0;
  }

  function renderAttendanceFilterOptions() {
    const activeStudents = state.students.filter((rec) => !isStoppedStudent(rec));
    const values = (field, fallback = '') => unique(activeStudents
      .map((rec) => studentValue(rec, field) || fallback)
      .filter(Boolean))
      .sort((a, b) => a.localeCompare(b, 'zh'));
    const timeValues = unique(activeStudents.map(attendanceTimeSegment).filter(Boolean))
      .sort((a, b) => {
        const order = { '早上': 1, '下午': 2, '未填时间段': 99 };
        return (order[a] || 50) - (order[b] || 50) || a.localeCompare(b, 'zh');
      });
    const yearValues = unique(activeStudents.map(attendanceYearLabel).filter(Boolean))
      .sort(compareAttendanceYears);

    fillSelectWithAll(elAttendanceCampus, values(STUDENT_FIELDS.campus, '未填分院'), state.attendanceFilters.campus, '全部地点');
    fillSelectWithAll(elAttendanceBlock, values(STUDENT_FIELDS.block, '未填 BLOCK'), state.attendanceFilters.block, '全部 BLOCK');
    fillSelectWithAll(elAttendanceYear, yearValues, state.attendanceFilters.year, '全部年级');
    fillSelectWithAll(elAttendanceTime, timeValues, state.attendanceFilters.time, '全部时间段');
    if (elAttendanceDate) elAttendanceDate.value = state.attendanceDate;
  }

  function baseFilteredAttendanceStudents() {
    const f = state.attendanceFilters;
    const seen = new Set();
    return state.students.filter((rec) => {
      const id = attendanceStudentId(rec);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      if (isStoppedStudent(rec)) return false;
      if (f.campus && (studentValue(rec, STUDENT_FIELDS.campus) || '未填分院') !== f.campus) return false;
      if (f.block && (studentValue(rec, STUDENT_FIELDS.block) || '未填 BLOCK') !== f.block) return false;
      if (f.year && attendanceYearLabel(rec) !== f.year) return false;
      if (f.time && attendanceTimeSegment(rec) !== f.time) return false;
      return true;
    }).sort((a, b) =>
      compareAttendanceYears(attendanceYearLabel(a), attendanceYearLabel(b)) ||
      (studentValue(a, STUDENT_FIELDS.block) || '').localeCompare(studentValue(b, STUDENT_FIELDS.block) || '', 'zh') ||
      (studentValue(a, STUDENT_FIELDS.no) || '').localeCompare(studentValue(b, STUDENT_FIELDS.no) || '', 'zh', { numeric: true }) ||
      studentValue(a, STUDENT_FIELDS.name).localeCompare(studentValue(b, STUDENT_FIELDS.name), 'zh')
    );
  }

  function filteredAttendanceStudents() {
    const list = baseFilteredAttendanceStudents();
    return state.showUnfinishedOnly ? list.filter(isAttendanceUnfinished) : list;
  }

  function renderAttendanceSummary(list) {
    if (!elAttendanceSummary) return;
    const records = list.map(attendanceRecordFor);
    const count = (fn) => records.filter(fn).length;
    const marked = records.filter(isAttendanceMarked).length;
    const cards = [
      { label: '应点人数', value: list.length },
      { label: '已开始点名', value: marked },
      { label: '到了', value: count((rec) => rec.arrival === '到了'), cls: 'normal' },
      { label: '还没有/缺席', value: count((rec) => rec.arrival === '还没有' || rec.arrival === '缺席'), cls: 'warning' },
      { label: 'KOKO', value: count((rec) => rec.arrival === 'KOKO') },
      { label: '已去补习', value: count((rec) => rec.tuition === '去了' || rec.tuition === '迟进补习'), cls: 'normal' },
      { label: '已回家', value: count((rec) => rec.home === '回家'), cls: 'normal' },
      { label: '功课没完成', value: count((rec) => rec.homework === '没完成'), cls: 'warning' }
    ];
    elAttendanceSummary.innerHTML = cards.map((c) => `
      <div class="card ${escapeHtml(c.cls || '')}">
        <div class="label">${escapeHtml(c.label)}</div>
        <div class="value">${escapeHtml(String(c.value))}</div>
      </div>
    `).join('');
  }

  function renderAttendanceScope() {
    if (elAttendanceScopeDate) elAttendanceScopeDate.textContent = state.attendanceDate || todayDateString();
    if (elAttendanceScopeWeekday) elAttendanceScopeWeekday.textContent = attendanceDateWeekday();
    if (elAttendanceScopeCampus) elAttendanceScopeCampus.textContent = state.attendanceFilters.campus || '全部';
    if (elAttendanceScopeBlock) elAttendanceScopeBlock.textContent = state.attendanceFilters.block || '全部';
    if (elAttendanceScopeYear) elAttendanceScopeYear.textContent = state.attendanceFilters.year || '全部';
    if (elAttendanceScopeTime) elAttendanceScopeTime.textContent = state.attendanceFilters.time || '全部';
  }

  function renderAttendanceFlow(list) {
    if (!elAttendanceFlowList) return;
    const total = list.length;
    const progress = ATTENDANCE_STEPS.map((step) => {
      const done = list.filter((rec) => attendanceRecordFor(rec)[step.key] !== step.defaultValue).length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      return `<div class="attendance-flow-row">
        <span>${escapeHtml(step.label)}</span>
        <span class="attendance-flow-track"><span class="attendance-flow-fill" style="width:${pct}%"></span></span>
        <b>${escapeHtml(String(done))}/${escapeHtml(String(total))}</b>
      </div>`;
    }).join('');
    const alerts = [];
    for (const rec of list) {
      const record = attendanceRecordFor(rec);
      for (const step of ATTENDANCE_STEPS) {
        const value = record[step.key];
        if (['还没有', '缺席', 'KOKO', '迟进补习', '不冲凉', '不吃饭', '没完成', '没有复习'].includes(value)) {
          alerts.push({ rec, step, value });
        }
      }
    }
    const alertHtml = alerts.length ? `
      <div class="attendance-alert-list">
        ${alerts.slice(0, 8).map((item) => `
          <div class="attendance-alert-item">
            <strong>${escapeHtml(studentValue(item.rec, STUDENT_FIELDS.name) || '-')} · ${escapeHtml(item.step.label)}</strong>
            <span>${escapeHtml(item.value)}</span>
          </div>
        `).join('')}
      </div>
    ` : '<div class="attendance-alert-list"><div class="attendance-alert-item"><strong>暂无需要跟进</strong><span>OK</span></div></div>';
    elAttendanceFlowList.innerHTML = progress + alertHtml;
  }

  function attendanceSearchHaystack(rec) {
    return [
      studentValue(rec, STUDENT_FIELDS.no),
      studentValue(rec, STUDENT_FIELDS.name),
      studentValue(rec, STUDENT_FIELDS.year),
      studentValue(rec, STUDENT_FIELDS.teacher),
      studentValue(rec, STUDENT_FIELDS.block),
      studentValue(rec, STUDENT_FIELDS.campus),
      attendanceTimeSegment(rec)
    ].join(' ').toLowerCase();
  }

  function searchMatchesStudent(rec) {
    const q = state.attendanceSearch.trim().toLowerCase();
    return Boolean(q && attendanceSearchHaystack(rec).includes(q));
  }

  function firstSearchMatch(list) {
    const q = state.attendanceSearch.trim().toLowerCase();
    if (!q) return null;
    return list.find((rec) => attendanceSearchHaystack(rec).includes(q)) || null;
  }

  function renderAttendanceCurrentRange(list) {
    if (!elAttendanceCurrentRange) return;
    const base = baseFilteredAttendanceStudents();
    const baseCount = base.length;
    const unfinishedCount = base.filter(isAttendanceUnfinished).length;
    const parts = [
      state.attendanceFilters.year || '全部年级',
      state.attendanceFilters.block || '全部 BLOCK',
      state.attendanceFilters.campus || '全部地点',
      state.attendanceFilters.time || '全部时间段',
      `${list.length}人`
    ];
    if (state.showUnfinishedOnly) parts.push(`${unfinishedStepLabel()}未点 ${unfinishedCount}/${baseCount}`);
    const matched = firstSearchMatch(list);
    const q = state.attendanceSearch.trim();
    const searchText = q
      ? (matched
        ? ` · 已定位 ${studentValue(matched, STUDENT_FIELDS.name) || studentValue(matched, STUDENT_FIELDS.no) || q}`
        : ` · 找不到「${q}」`)
      : '';
    elAttendanceCurrentRange.textContent = parts.join(' · ') + searchText;
    elAttendanceCurrentRange.classList.toggle('no-match', Boolean(q && !matched));
  }

  function attendanceSyncLabel() {
    if (state.attendanceSavingKeys.size) return `保存中 ${state.attendanceSavingKeys.size}`;
    if (pendingPersistTimers.size) return `等待保存 ${pendingPersistTimers.size}`;
    return state.attendanceSyncText;
  }

  function renderAttendanceMeta(list) {
    const marked = list.map(attendanceRecordFor).filter(isAttendanceMarked).length;
    const modeText = state.showUnfinishedOnly ? ' · 只看未点' : '';
    const metaText = `当前筛选 ${list.length} 人${modeText} · Active 总数 ${state.students.filter((rec) => !isStoppedStudent(rec)).length} 人 · 已开始 ${marked} · ${attendanceSyncLabel()}`;
    if (elAttendanceMeta) elAttendanceMeta.textContent = metaText;
    if (elAttendanceListMeta) elAttendanceListMeta.textContent = metaText;
    if (elMobileSyncStatus) elMobileSyncStatus.textContent = attendanceSyncLabel();
  }

  function renderUnfinishedTools() {
    const base = baseFilteredAttendanceStudents();
    const unfinished = base.filter(isAttendanceUnfinished);
    if (elUnfinishedStep && elUnfinishedStep.value !== state.unfinishedStep) {
      elUnfinishedStep.value = state.unfinishedStep;
    }
    if (elUnfinishedToggle) {
      elUnfinishedToggle.classList.toggle('active', state.showUnfinishedOnly);
      elUnfinishedToggle.setAttribute('aria-pressed', state.showUnfinishedOnly ? 'true' : 'false');
      elUnfinishedToggle.textContent = state.showUnfinishedOnly ? '显示全部' : '只看未点';
    }
    if (elUnfinishedMeta) {
      const visible = state.showUnfinishedOnly ? ` · 正在显示 ${unfinished.length} 人` : '';
      elUnfinishedMeta.textContent = `${unfinishedStepLabel()}未点 ${unfinished.length}/${base.length} 人${visible}`;
    }
  }

  function renderAttendanceStatusPanels(list) {
    renderUnfinishedTools();
    renderAttendanceSummary(list);
    renderAttendanceFlow(list);
    renderAttendanceCurrentRange(list);
    renderAttendanceMeta(list);
    refreshAttendanceGroupMeta(list);
    updateSearchHighlightAndScroll(false);
  }

  function teacherStatsMonthLabel(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return '-';
    const parts = month.split('-');
    return `${parts[0]}年${parts[1]}月`;
  }

  function teacherStatsDateLabel(dateText) {
    if (!dateText || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return '-';
    const parts = dateText.split('-');
    return `${parts[0]}年${parts[1]}月${parts[2]}日`;
  }

  function teacherStatsKey() {
    return state.teacherStatsRange === 'month'
      ? `month:${state.teacherStatsMonth}`
      : `day:${state.teacherStatsDate}`;
  }

  function teacherStatsLabel(data) {
    if ((data && data.range) === 'month' || state.teacherStatsRange === 'month') {
      return teacherStatsMonthLabel((data && data.month) || state.teacherStatsMonth);
    }
    return teacherStatsDateLabel((data && data.date) || state.teacherStatsDate);
  }

  function isStatsView() {
    return state.currentView === 'stats';
  }

  function isSettingsView() {
    return state.currentView === 'settings';
  }

  function setViewUi() {
    const statsView = isStatsView();
    const settingsView = isSettingsView();
    document.documentElement.dataset.view = settingsView ? 'settings' : (statsView ? 'stats' : 'attendance');
    if (!settingsView) document.documentElement.dataset.filterOpen = 'false';
    if (elAttendanceSummary) elAttendanceSummary.hidden = statsView || settingsView;
    if (elAttendanceMain) elAttendanceMain.hidden = statsView || settingsView;
    if (elTeacherStatsPanel) elTeacherStatsPanel.hidden = !statsView;
    if (elMobileSettingsPanel) elMobileSettingsPanel.hidden = !settingsView;
    if (elViewAttendance) {
      elViewAttendance.classList.toggle('active', !statsView && !settingsView);
      elViewAttendance.setAttribute('aria-selected', (!statsView && !settingsView) ? 'true' : 'false');
    }
    if (elViewStats) {
      elViewStats.classList.toggle('active', statsView);
      elViewStats.setAttribute('aria-selected', statsView ? 'true' : 'false');
    }
    if (elViewSettings) {
      elViewSettings.classList.toggle('active', settingsView);
      elViewSettings.setAttribute('aria-selected', settingsView ? 'true' : 'false');
    }
    if (elTeacherStatsMonth && elTeacherStatsMonth.value !== state.teacherStatsMonth) {
      elTeacherStatsMonth.value = state.teacherStatsMonth;
    }
    if (elTeacherStatsDate && elTeacherStatsDate.value !== state.teacherStatsDate) {
      elTeacherStatsDate.value = state.teacherStatsDate;
    }
    if (elTeacherStatsMonth) elTeacherStatsMonth.hidden = state.teacherStatsRange !== 'month';
    if (elTeacherStatsDate) elTeacherStatsDate.hidden = state.teacherStatsRange !== 'day';
    if (elTeacherStatsRangeDay) {
      const active = state.teacherStatsRange === 'day';
      elTeacherStatsRangeDay.classList.toggle('active', active);
      elTeacherStatsRangeDay.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (elTeacherStatsRangeMonth) {
      const active = state.teacherStatsRange === 'month';
      elTeacherStatsRangeMonth.classList.toggle('active', active);
      elTeacherStatsRangeMonth.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function renderTeacherStats() {
    setViewUi();
    if (!elTeacherStatsMeta || !elTeacherStatsTable) return;
    if (!isStatsView()) return;
    if (state.teacherStatsLoading) {
      elTeacherStatsMeta.textContent = `${teacherStatsLabel(state.teacherStats)} · 正在载入老师点名统计…`;
      elTeacherStatsTable.innerHTML = '<div class="teacher-stats-empty">正在载入统计…</div>';
      return;
    }
    if (state.teacherStatsError) {
      elTeacherStatsMeta.textContent = `统计读取失败：${state.teacherStatsError}`;
      elTeacherStatsTable.innerHTML = '<div class="teacher-stats-empty">无法读取统计，请确认已登录并稍后再试。</div>';
      return;
    }
    const data = state.teacherStats;
    if (!data) {
      elTeacherStatsMeta.textContent = '打开后载入统计…';
      elTeacherStatsTable.innerHTML = '<div class="teacher-stats-empty">还没有载入统计。</div>';
      return;
    }
    const people = Array.isArray(data.people) ? data.people : [];
    const totals = data.totals || {};
    elTeacherStatsMeta.textContent = `${teacherStatsLabel(data)} · 总点名 ${totals.attendanceActions || 0} 次 · ${people.length} 位老师 · 更新 ${data.updatedAt || '-'}`;
    if (!people.length) {
      elTeacherStatsTable.innerHTML = `<div class="teacher-stats-empty">这个${state.teacherStatsRange === 'month' ? '月份' : '日期'}还没有点名记录。</div>`;
      return;
    }
    const rows = people
      .slice()
      .sort((a, b) => (b.attendanceActions || 0) - (a.attendanceActions || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh'))
      .map((person, index) => `
        <tr>
          <td>${escapeHtml(String(index + 1))}</td>
          <td>
            <div class="teacher-stats-name">
              <strong>${escapeHtml(person.name || person.email || '未记录')}</strong>
              <span>${escapeHtml(person.email || (person.key === 'unknown' ? '旧记录没有操作者' : ''))}</span>
            </div>
          </td>
          <td class="num"><strong>${escapeHtml(String(person.attendanceActions || 0))}</strong></td>
          <td class="num">${escapeHtml(String(person.uniqueStudents || 0))}</td>
          <td class="num">${escapeHtml(String(person.homeworkCompleted || 0))}</td>
          <td class="num">${escapeHtml(String(person.homeworkNotCompleted || 0))}</td>
          <td class="num">${escapeHtml(String(person.totalActions || 0))}</td>
        </tr>
      `).join('');
    elTeacherStatsTable.innerHTML = `<table class="teacher-stats-table">
      <thead>
        <tr>
          <th>#</th>
          <th>老师</th>
          <th class="num">点名次数</th>
          <th class="num">学生数</th>
          <th class="num">功课完成</th>
          <th class="num">功课没完成</th>
          <th class="num">总操作</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  async function loadTeacherStats(forceRefresh = false) {
    if (!isStatsView()) return;
    const key = teacherStatsKey();
    if (!forceRefresh && state.teacherStats && state.teacherStatsLoadedKey === key) {
      renderTeacherStats();
      return;
    }
    state.teacherStatsLoading = true;
    state.teacherStatsError = '';
    renderTeacherStats();
    try {
      const params = new URLSearchParams({ range: state.teacherStatsRange, t: String(Date.now()) });
      if (state.teacherStatsRange === 'month') params.set('month', state.teacherStatsMonth);
      else params.set('date', state.teacherStatsDate);
      const resp = await apiFetch('/api/attendance-stats?' + params.toString(), { cache: 'no-store' });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('返回非 JSON 数据'); }
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      state.teacherStats = data;
      state.teacherStatsLoadedKey = key;
    } catch (err) {
      state.teacherStatsError = err.message;
    } finally {
      state.teacherStatsLoading = false;
      renderTeacherStats();
    }
  }

  function switchView(view) {
    state.currentView = view === 'settings' ? 'settings' : (view === 'stats' ? 'stats' : 'attendance');
    setViewUi();
    if (isStatsView()) {
      loadTeacherStats(false);
    } else if (isSettingsView()) {
      renderAttendanceStatusPanels(filteredAttendanceStudents());
    } else {
      renderAttendanceView({ preserveScroll: true });
    }
  }

  function isAttendanceFollowupDisabled(step, record) {
    return record.arrival === '缺席' && step.key !== 'arrival';
  }

  function attendancePatchForStep(step, value) {
    const patch = { [step.key]: value };
    if (step.key === 'arrival' && value === '缺席') {
      ATTENDANCE_STEPS.filter((item) => item.key !== 'arrival').forEach((item) => {
        patch[item.key] = item.defaultValue;
      });
    }
    return patch;
  }

  function setAttendanceStepValue(studentId, stepKey, value) {
    const rec = attendanceStudentById(studentId);
    const step = ATTENDANCE_STEPS.find((item) => item.key === stepKey);
    if (!rec || !step) return;
    const record = attendanceRecordFor(rec);
    if (isAttendanceFollowupDisabled(step, record)) return;
    if ((record[step.key] || step.defaultValue) === value) return;
    updateAttendanceForStudent(rec, attendancePatchForStep(step, value));
  }

  function setPrimaryAttendanceStep(studentId, stepKey) {
    const step = ATTENDANCE_STEPS.find((item) => item.key === stepKey);
    const value = step ? PRIMARY_STEP_VALUES[step.key] : '';
    if (!value) return;
    setAttendanceStepValue(studentId, stepKey, value);
  }

  function renderAttendanceStatusCell(rec, step, record) {
    return `<td>${renderAttendanceStatusButton(rec, step, record)}</td>`;
  }

  function renderAttendanceStatusButton(rec, step, record) {
    const value = record[step.key] || step.defaultValue;
    const disabled = isAttendanceFollowupDisabled(step, record);
    const label = disabled && value === step.defaultValue ? '不用点' : value;
    const primary = PRIMARY_STEP_VALUES[step.key] || step.options[1] || step.defaultValue;
    const attrs = disabled
      ? 'disabled aria-disabled="true" title="学生缺席后不需要继续点后续流程"'
      : `data-att-primary-student="${escapeHtml(attendanceStudentId(rec))}" data-att-step="${escapeHtml(step.key)}" title="短按：${escapeHtml(primary)}；长按：其他选择" aria-label="${escapeHtml(step.label)}：${escapeHtml(label)}，短按设为${escapeHtml(primary)}，长按选择其他状态"`;
    return `<button class="attendance-status-pill ${escapeHtml(attendanceTone(value))} ${disabled ? 'disabled' : ''}" type="button"
      ${attrs}>${escapeHtml(label)}</button>`;
  }

  function cssAttr(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function attendanceYearCollapseKey(year) {
    return year || '未填年级';
  }

  function isAttendanceYearCollapsed(year) {
    return state.collapsedYears.has(attendanceYearCollapseKey(year));
  }

  function toggleAttendanceYear(year) {
    const key = attendanceYearCollapseKey(year);
    if (state.collapsedYears.has(key)) state.collapsedYears.delete(key);
    else state.collapsedYears.add(key);
    renderAttendanceView({ preserveScroll: true });
  }

  function expandAttendanceYearForStudent(rec) {
    const key = attendanceYearCollapseKey(attendanceYearLabel(rec));
    if (!state.collapsedYears.has(key)) return false;
    state.collapsedYears.delete(key);
    return true;
  }

  function attendanceGroupFor(rec) {
    const year = attendanceYearLabel(rec);
    const block = studentValue(rec, STUDENT_FIELDS.block) || '未填 BLOCK';
    return {
      key: `${year}||${block}`,
      year,
      label: block
    };
  }

  function buildAttendanceGroups(list) {
    const groups = [];
    for (const rec of list) {
      const group = attendanceGroupFor(rec);
      const last = groups[groups.length - 1];
      if (!last || last.key !== group.key) {
        groups.push({ key: group.key, label: group.label, rows: [rec] });
      } else {
        last.rows.push(rec);
      }
    }
    return groups;
  }

  function buildAttendanceYearGroups(list) {
    const yearGroups = [];
    for (const rec of list) {
      const year = attendanceYearLabel(rec);
      const lastYear = yearGroups[yearGroups.length - 1];
      let yearGroup = lastYear;
      if (!yearGroup || yearGroup.year !== year) {
        yearGroup = { key: attendanceYearCollapseKey(year), year, rows: [], groups: [] };
        yearGroups.push(yearGroup);
      }
      yearGroup.rows.push(rec);
      const group = attendanceGroupFor(rec);
      const lastGroup = yearGroup.groups[yearGroup.groups.length - 1];
      if (!lastGroup || lastGroup.key !== group.key) {
        yearGroup.groups.push({ key: group.key, label: group.label, rows: [rec] });
      } else {
        lastGroup.rows.push(rec);
      }
    }
    return yearGroups;
  }

  function updateAttendanceButton(btn, rec, step, record) {
    const value = record[step.key] || step.defaultValue;
    const disabled = isAttendanceFollowupDisabled(step, record);
    const label = disabled && value === step.defaultValue ? '不用点' : value;
    const primary = PRIMARY_STEP_VALUES[step.key] || step.options[1] || step.defaultValue;
    btn.className = `attendance-status-pill ${attendanceTone(value)} ${disabled ? 'disabled' : ''}`;
    btn.textContent = label;
    btn.disabled = disabled;
    btn.setAttribute('data-att-step', step.key);
    btn.setAttribute('data-att-primary-student', attendanceStudentId(rec));
    btn.setAttribute('title', disabled ? '学生缺席后不需要继续点后续流程' : `短按：${primary}；长按：其他选择`);
    btn.setAttribute('aria-label', disabled
      ? `${step.label}：不用点`
      : `${step.label}：${label}，短按设为${primary}，长按选择其他状态`);
    if (disabled) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
  }

  function updateAttendanceDomForStudent(rec) {
    if (!elAttendanceList || !rec) return;
    const studentId = attendanceStudentId(rec);
    const record = attendanceRecordFor(rec);
    const rows = elAttendanceList.querySelectorAll(`[data-att-row-student="${cssAttr(studentId)}"]`);
    rows.forEach((row) => {
      row.classList.toggle('marked', isAttendanceMarked(record));
      row.classList.toggle('search-match', searchMatchesStudent(rec));
      ATTENDANCE_STEPS.forEach((step) => {
        const btn = row.querySelector(`[data-att-primary-student="${cssAttr(studentId)}"][data-att-step="${cssAttr(step.key)}"]`);
        if (btn) updateAttendanceButton(btn, rec, step, record);
      });
      const noteBtn = row.querySelector(`.attendance-note-btn[data-att-open-student="${cssAttr(studentId)}"]`);
      if (noteBtn) {
        noteBtn.textContent = record.note ? '有备注' : '备注';
        noteBtn.classList.toggle('has-note', Boolean(record.note));
      }
    });
  }

  function renderAttendanceBoardRow(rec) {
    const record = attendanceRecordFor(rec);
    const markedClass = isAttendanceMarked(record) ? 'marked' : '';
    const unfinished = unfinishedStepsForRecord(record, state.unfinishedStep);
    const unfinishedClass = unfinished.length ? 'unfinished' : '';
    const matchClass = searchMatchesStudent(rec) ? 'search-match' : '';
    const no = studentValue(rec, STUDENT_FIELDS.no) || '-';
    const name = studentValue(rec, STUDENT_FIELDS.name) || '-';
    const unfinishedText = unfinished.length ? ` · 未点：${unfinished.map((step) => step.label).join('、')}` : '';
    return `<tr class="${markedClass} ${matchClass} ${unfinishedClass}" data-att-row-student="${escapeHtml(attendanceStudentId(rec))}">
      <td>
        <div class="attendance-student-cell">
          <button class="attendance-student-name attendance-student-name-trigger" type="button"
            data-att-open-student="${escapeHtml(attendanceStudentId(rec))}">${escapeHtml(name)}</button>
          <span>No.${escapeHtml(no)} · ${escapeHtml(studentValue(rec, STUDENT_FIELDS.year) || '-')} · ${escapeHtml(studentValue(rec, STUDENT_FIELDS.block) || '-')}</span>
          <span>${escapeHtml(studentValue(rec, STUDENT_FIELDS.campus) || '-')} · ${escapeHtml(attendanceTimeSegment(rec))}${escapeHtml(unfinishedText)}</span>
        </div>
      </td>
      ${ATTENDANCE_STEPS.map((step) => renderAttendanceStatusCell(rec, step, record)).join('')}
      <td>
        <button class="attendance-note-btn ${record.note ? 'has-note' : ''}" type="button"
          data-att-open-student="${escapeHtml(attendanceStudentId(rec))}">${record.note ? '有备注' : '备注'}</button>
      </td>
    </tr>`;
  }

  function renderAttendanceYearGroup(group) {
    const rows = group.rows;
    const marked = rows.map(attendanceRecordFor).filter(isAttendanceMarked).length;
    const colspan = ATTENDANCE_STEPS.length + 1;
    return `<tr class="attendance-year-row" data-att-group-key="${escapeHtml(group.key)}">
      <th scope="rowgroup">${escapeHtml(group.label)}</th>
      <td colspan="${colspan}"><strong>${escapeHtml(String(rows.length))}人</strong> · 已开始 ${escapeHtml(String(marked))}/${escapeHtml(String(rows.length))}</td>
    </tr>${rows.map(renderAttendanceBoardRow).join('')}`;
  }

  function renderAttendanceCollapsibleYear(yearGroup) {
    const rows = yearGroup.rows;
    const marked = rows.map(attendanceRecordFor).filter(isAttendanceMarked).length;
    const colspan = ATTENDANCE_STEPS.length + 1;
    const collapsed = isAttendanceYearCollapsed(yearGroup.year);
    const stateText = collapsed ? '已收起' : `${yearGroup.groups.length} 个 Block`;
    return `<tr class="attendance-grade-row ${collapsed ? 'is-collapsed' : ''}" data-att-year-key="${escapeHtml(yearGroup.key)}" data-att-year-label="${escapeHtml(yearGroup.year)}">
      <th scope="rowgroup">
        <button class="attendance-grade-toggle" type="button" data-att-toggle-year="${escapeHtml(yearGroup.year)}" aria-expanded="${collapsed ? 'false' : 'true'}">
          <span class="attendance-grade-caret">${collapsed ? '+' : '-'}</span>
          <span>${escapeHtml(yearGroup.year)}</span>
        </button>
      </th>
      <td colspan="${colspan}"><strong>${escapeHtml(String(rows.length))}人</strong> · 已开始 ${escapeHtml(String(marked))}/${escapeHtml(String(rows.length))} · ${escapeHtml(stateText)}</td>
    </tr>${collapsed ? '' : yearGroup.groups.map(renderAttendanceYearGroup).join('')}`;
  }

  function refreshAttendanceGroupMeta(list) {
    if (!elAttendanceList) return;
    for (const yearGroup of buildAttendanceYearGroups(list)) {
      const row = elAttendanceList.querySelector(`[data-att-year-key="${cssAttr(yearGroup.key)}"]`);
      if (!row) continue;
      const cell = row.querySelector('td');
      const button = row.querySelector('[data-att-toggle-year]');
      const caret = row.querySelector('.attendance-grade-caret');
      const collapsed = isAttendanceYearCollapsed(yearGroup.year);
      const marked = yearGroup.rows.map(attendanceRecordFor).filter(isAttendanceMarked).length;
      if (cell) {
        const stateText = collapsed ? '已收起' : `${yearGroup.groups.length} 个 Block`;
        cell.innerHTML = `<strong>${escapeHtml(String(yearGroup.rows.length))}人</strong> · 已开始 ${escapeHtml(String(marked))}/${escapeHtml(String(yearGroup.rows.length))} · ${escapeHtml(stateText)}`;
      }
      if (button) button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      if (caret) caret.textContent = collapsed ? '+' : '-';
    }
    for (const group of buildAttendanceGroups(list)) {
      const row = elAttendanceList.querySelector(`[data-att-group-key="${cssAttr(group.key)}"]`);
      if (!row) continue;
      const cell = row.querySelector('td');
      if (!cell) continue;
      const marked = group.rows.map(attendanceRecordFor).filter(isAttendanceMarked).length;
      cell.innerHTML = `<strong>${escapeHtml(String(group.rows.length))}人</strong> · 已开始 ${escapeHtml(String(marked))}/${escapeHtml(String(group.rows.length))}`;
    }
  }

  function updateSearchHighlightAndScroll(shouldScroll) {
    if (!elAttendanceList) return;
    const list = filteredAttendanceStudents();
    elAttendanceList.querySelectorAll('.search-match').forEach((row) => row.classList.remove('search-match'));
    const match = firstSearchMatch(list);
    if (!match) {
      renderAttendanceCurrentRange(list);
      return;
    }
    const row = elAttendanceList.querySelector(`[data-att-row-student="${cssAttr(attendanceStudentId(match))}"]`);
    if (!row) {
      if (expandAttendanceYearForStudent(match)) {
        renderAttendanceView({ preserveScroll: true });
        window.requestAnimationFrame(() => updateSearchHighlightAndScroll(shouldScroll));
        return;
      }
      renderAttendanceCurrentRange(list);
      return;
    }
    row.classList.add('search-match');
    if (shouldScroll) {
      const wrap = elAttendanceList.querySelector('.attendance-board-wrap');
      if (wrap) {
        wrap.scrollTop = Math.max(row.offsetTop - 82, 0);
      }
    }
    renderAttendanceCurrentRange(list);
  }

  function renderAttendanceCard(rec) {
    const record = attendanceRecordFor(rec);
    const markedClass = isAttendanceMarked(record) ? 'is-marked' : '';
    const unfinished = unfinishedStepsForRecord(record, state.unfinishedStep);
    const unfinishedClass = unfinished.length ? 'is-unfinished' : '';
    const no = studentValue(rec, STUDENT_FIELDS.no) || '-';
    const name = studentValue(rec, STUDENT_FIELDS.name) || '-';
    const year = studentValue(rec, STUDENT_FIELDS.year) || '-';
    const block = studentValue(rec, STUDENT_FIELDS.block) || '-';
    const campus = studentValue(rec, STUDENT_FIELDS.campus) || '-';
    const time = attendanceTimeSegment(rec);
    return `<article class="attendance-student-card ${markedClass} ${unfinishedClass}">
      <div class="attendance-card-head">
        <div class="attendance-card-name">
          <button class="attendance-card-name-trigger" type="button"
            data-att-open-student="${escapeHtml(attendanceStudentId(rec))}">${escapeHtml(name)}</button>
          <span>No.${escapeHtml(no)} · ${escapeHtml(year)}</span>
        </div>
        <button class="attendance-note-btn ${record.note ? 'has-note' : ''}" type="button"
          data-att-open-student="${escapeHtml(attendanceStudentId(rec))}">${record.note ? '有备注' : '备注'}</button>
      </div>
      <div class="attendance-card-meta">
        <span>${escapeHtml(block)}</span>
        <span>${escapeHtml(campus)}</span>
        <span>${escapeHtml(time)}</span>
        ${unfinished.length ? `<span>未点 ${escapeHtml(String(unfinished.length))} 项</span>` : ''}
      </div>
      <div class="attendance-card-steps">
        ${ATTENDANCE_STEPS.map((step) => `
          <div class="attendance-step-control">
            <span>${escapeHtml(step.label)}</span>
            ${renderAttendanceStatusButton(rec, step, record)}
          </div>
        `).join('')}
      </div>
    </article>`;
  }

  function renderAttendanceCardGroup(year, rows) {
    const marked = rows.map(attendanceRecordFor).filter(isAttendanceMarked).length;
    return `<section class="attendance-card-group">
      <div class="attendance-card-group-head">
        <strong>${escapeHtml(year)}</strong>
        <span>${escapeHtml(String(rows.length))}人 · 已开始 ${escapeHtml(String(marked))}/${escapeHtml(String(rows.length))}</span>
      </div>
      ${rows.map(renderAttendanceCard).join('')}
    </section>`;
  }

  function renderAttendanceCards(groups) {
    return `<div class="attendance-mobile-list">
      ${groups.map((group) => renderAttendanceCardGroup(group.year, group.rows)).join('')}
    </div>`;
  }

  function renderAttendanceBoard(list) {
    if (!list.length) {
      if (state.showUnfinishedOnly) {
        return '<div class="attendance-empty">当前筛选里没有未点学生。</div>';
      }
      return '<div class="attendance-empty">这个地点 / BLOCK / 时间段没有匹配学生。</div>';
    }
    const groups = buildAttendanceYearGroups(list);
    return `<div class="attendance-board-wrap">
      <table class="attendance-board">
        <thead>
          <tr>
            <th>学生</th>
            ${ATTENDANCE_STEPS.map((step) => `<th>${escapeHtml(step.label)}</th>`).join('')}
            <th>备注</th>
          </tr>
        </thead>
        <tbody>${groups.map(renderAttendanceCollapsibleYear).join('')}</tbody>
      </table>
    </div>`;
  }

  function renderAttendanceView(options = {}) {
    if (!elAttendanceList) return;
    const scrollPosition = options.scrollPosition || (options.preserveScroll ? attendanceScrollPosition() : null);
    renderAttendanceFilterOptions();
    renderAttendanceScope();
    const list = filteredAttendanceStudents();
    renderUnfinishedTools();
    renderAttendanceSummary(list);
    renderAttendanceFlow(list);

    if (!state.students.length) {
      elAttendanceList.innerHTML = '<div class="attendance-empty">加载学生名单中…</div>';
      if (elAttendanceListMeta) elAttendanceListMeta.textContent = '尚未加载';
      if (elAttendanceMeta) elAttendanceMeta.textContent = '尚未加载';
      return;
    }

    elAttendanceList.innerHTML = renderAttendanceBoard(list);
    elAttendanceList.querySelectorAll('[data-att-primary-student]').forEach((btn) => {
      bindAttendanceStatusButton(btn);
    });
    elAttendanceList.querySelectorAll('[data-att-toggle-year]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleAttendanceYear(btn.getAttribute('data-att-toggle-year') || '');
      });
    });
    elAttendanceList.querySelectorAll('[data-att-year-key]').forEach((row) => {
      row.addEventListener('click', () => {
        toggleAttendanceYear(row.getAttribute('data-att-year-label') || '');
      });
    });
    elAttendanceList.querySelectorAll('[data-att-open-student]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openAttendanceStudentModal(btn.getAttribute('data-att-open-student') || '');
      });
    });

    renderAttendanceMeta(list);
    renderAttendanceCurrentRange(list);
    updateSearchHighlightAndScroll(Boolean(state.attendanceSearch.trim()));
    restoreAttendanceScroll(scrollPosition);
  }

  function attendanceStudentById(studentId) {
    return state.students.find((rec) => attendanceStudentId(rec) === studentId) || null;
  }

  function bindAttendanceStatusButton(btn) {
    let longPressTimer = null;
    let longPressOpened = false;
    const clearTimer = () => {
      if (!longPressTimer) return;
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    };
    const studentId = () => btn.getAttribute('data-att-primary-student') || '';
    const stepKey = () => btn.getAttribute('data-att-step') || '';
    const openChoices = () => {
      clearTimer();
      longPressOpened = true;
      openAttendanceChoiceMenu(studentId(), stepKey(), btn.getBoundingClientRect());
    };
    btn.addEventListener('pointerdown', () => {
      longPressOpened = false;
      clearTimer();
      longPressTimer = window.setTimeout(openChoices, LONG_PRESS_MS);
    });
    btn.addEventListener('pointerup', () => {
      clearTimer();
      if (longPressOpened) return;
      setPrimaryAttendanceStep(studentId(), stepKey());
    });
    btn.addEventListener('pointercancel', clearTimer);
    btn.addEventListener('pointerleave', clearTimer);
    btn.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openChoices();
    });
    btn.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      setPrimaryAttendanceStep(studentId(), stepKey());
    });
  }

  function openAttendanceChoiceMenu(studentId, stepKey, rect) {
    const rec = attendanceStudentById(studentId);
    const step = ATTENDANCE_STEPS.find((item) => item.key === stepKey);
    if (!rec || !step) return;
    const record = attendanceRecordFor(rec);
    if (isAttendanceFollowupDisabled(step, record)) return;
    const menuWidth = 206;
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - menuWidth - 12);
    const top = Math.min(rect.bottom + 8, window.innerHeight - 290);
    state.modalOpen = true;
    elModalRoot.innerHTML = `<div class="attendance-choice-backdrop" id="attendance-choice-backdrop"></div>
      <div class="attendance-choice-menu" style="left:${left}px; top:${Math.max(12, top)}px;">
        <div class="attendance-choice-title">${escapeHtml(studentValue(rec, STUDENT_FIELDS.name) || '-')} · ${escapeHtml(step.label)}</div>
        ${step.options.map((option) => `
          <button type="button" class="${record[step.key] === option ? 'active' : ''}"
            data-att-choice="${escapeHtml(option)}">${escapeHtml(option)}</button>
        `).join('')}
      </div>`;
    const backdrop = document.getElementById('attendance-choice-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeModal);
    elModalRoot.querySelectorAll('[data-att-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = btn.getAttribute('data-att-choice') || step.defaultValue;
        closeModal();
        setAttendanceStepValue(studentId, stepKey, value);
      });
    });
  }

  function openAttendanceStudentModal(studentId) {
    const rec = attendanceStudentById(studentId);
    if (!rec) return;
    const record = attendanceRecordFor(rec);
    const name = studentValue(rec, STUDENT_FIELDS.name) || '-';
    state.modalOpen = true;
    elModalRoot.innerHTML = `<div class="modal-backdrop" id="modal-backdrop">
      <div class="modal wide" role="dialog" aria-modal="true">
        <h2>${escapeHtml(name)}</h2>
        <dl>
          <dt>NO</dt><dd>${escapeHtml(studentValue(rec, STUDENT_FIELDS.no) || '-')}</dd>
          <dt>年级</dt><dd>${escapeHtml(studentValue(rec, STUDENT_FIELDS.year) || '-')}</dd>
          <dt>BLOCK</dt><dd>${escapeHtml(studentValue(rec, STUDENT_FIELDS.block) || '-')}</dd>
          <dt>时间段</dt><dd>${escapeHtml(attendanceTimeSegment(rec))}</dd>
          <dt>分院</dt><dd>${escapeHtml(studentValue(rec, STUDENT_FIELDS.campus) || '-')}</dd>
          <dt>负责老师</dt><dd>${escapeHtml(studentValue(rec, STUDENT_FIELDS.teacher) || '-')}</dd>
          <dt>点名日期</dt><dd>${escapeHtml(state.attendanceDate)} · ${escapeHtml(attendanceDateWeekday())}</dd>
        </dl>
        <div class="edit-form" style="margin-top:14px;">
          ${ATTENDANCE_STEPS.map((step) => `
            <div class="tag-field">
              <div class="tag-field-title">${escapeHtml(step.label)}</div>
              <div class="attendance-options">
                ${step.options.map((option) => {
                  const active = record[step.key] === option;
                  const disabled = isAttendanceFollowupDisabled(step, record);
                  return `<button class="attendance-option ${active ? `active ${attendanceTone(option)}` : ''} ${disabled ? 'disabled' : ''}" type="button"
                    data-att-modal-step="${escapeHtml(step.key)}"
                    data-att-modal-value="${escapeHtml(option)}"
                    ${disabled ? 'disabled aria-disabled="true"' : ''}>${escapeHtml(option)}</button>`;
                }).join('')}
              </div>
            </div>
          `).join('')}
          <label>备注
            <input id="attendance-modal-note" type="text" value="${escapeHtml(record.note || '')}" placeholder="备注" />
          </label>
        </div>
        <div class="actions">
          <button id="modal-close" type="button">关闭</button>
          <button id="attendance-modal-save" class="primary" type="button">套用修改</button>
        </div>
      </div>
    </div>`;
    bindModalCommon();
    const patch = {};
    const syncModalDisabled = () => {
      const effectiveArrival = patch.arrival || record.arrival;
      elModalRoot.querySelectorAll('[data-att-modal-step]').forEach((btn) => {
        const stepKey = btn.getAttribute('data-att-modal-step') || '';
        const disabled = effectiveArrival === '缺席' && stepKey !== 'arrival';
        btn.disabled = disabled;
        btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        btn.classList.toggle('disabled', disabled);
      });
    };
    const resetModalStepSelection = (stepKey, value) => {
      elModalRoot.querySelectorAll('[data-att-modal-step]').forEach((item) => {
        if ((item.getAttribute('data-att-modal-step') || '') !== stepKey) return;
        item.classList.remove('active', 'idle', 'good', 'warn', 'bad', 'koko', 'home');
        if ((item.getAttribute('data-att-modal-value') || '') === value) {
          item.classList.add('active', attendanceTone(value));
        }
      });
    };
    elModalRoot.querySelectorAll('[data-att-modal-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const stepKey = btn.getAttribute('data-att-modal-step') || '';
        const value = btn.getAttribute('data-att-modal-value') || '';
        patch[stepKey] = value;
        if (stepKey === 'arrival' && value === '缺席') {
          ATTENDANCE_STEPS.filter((step) => step.key !== 'arrival').forEach((step) => {
            delete patch[step.key];
            resetModalStepSelection(step.key, record[step.key] || step.defaultValue);
          });
        }
        resetModalStepSelection(stepKey, value);
        syncModalDisabled();
      });
    });
    syncModalDisabled();
    const saveBtn = document.getElementById('attendance-modal-save');
    const noteInput = document.getElementById('attendance-modal-note');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        updateAttendanceForStudent(rec, Object.assign({}, patch, { note: noteInput ? noteInput.value.trim() : '' }));
        closeModal();
      });
    }
  }

  function bindModalCommon() {
    const backdrop = document.getElementById('modal-backdrop');
    const closeBtn = document.getElementById('modal-close');
    if (backdrop) backdrop.addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    document.addEventListener('keydown', escClose);
  }

  function escClose(e) {
    if (e.key === 'Escape') closeModal();
  }

  function closeModal() {
    state.modalOpen = false;
    elModalRoot.innerHTML = '';
    document.removeEventListener('keydown', escClose);
  }

  async function loadStudents(initial, forceRefresh = false) {
    try {
      if (initial && !state.students.length) loadStudentsCache();
      const params = new URLSearchParams({ t: String(Date.now()) });
      if (forceRefresh) params.set('refresh', '1');
      const resp = await apiFetch('/api/students?' + params.toString(), { cache: 'no-store' });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('返回非 JSON 数据'); }
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);

      const hash = String(data.count || 0) + '|' + (data.updatedAt || '');
      if (hash === state.lastStudentsHash && !initial && !forceRefresh) return;
      applyStudentsPayload(data);
      saveStudentsCache(data);
    } catch (err) {
      if (elAttendanceMeta) elAttendanceMeta.textContent = `点名名单加载失败：${err.message}`;
      if (!state.students.length && elAttendanceList) {
        elAttendanceList.innerHTML = `<div class="attendance-empty error-state">无法读取点名名单：${escapeHtml(err.message)}</div>`;
      }
    }
  }

  async function loadAttendance(initial, forceRefresh = false) {
    try {
      if (initial && !state.attendanceLoaded) {
        loadAttendanceCache();
        state.attendanceSyncText = '先显示本机草稿 · 正在同步记录…';
        renderAttendanceView();
      }
      const params = new URLSearchParams({
        date: state.attendanceDate,
        t: String(Date.now())
      });
      if (forceRefresh) params.set('refresh', '1');
      const resp = await apiFetch('/api/attendance?' + params.toString(), { cache: 'no-store' });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('返回非 JSON 数据'); }
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);

      const hash = String(data.count || 0) + '|' + (data.updatedAt || '');
      if (hash === state.lastAttendanceHash && !initial && !forceRefresh) return;
      applyAttendancePayload(data);
    } catch (err) {
      state.attendanceSyncText = `同步失败：${err.message}`;
      if (elAttendanceMeta) elAttendanceMeta.textContent = `点名记录同步失败：${err.message}`;
      renderAttendanceView();
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshTimer = setInterval(() => {
      if (document.hidden || state.modalOpen) return;
      if (isStatsView()) {
        loadTeacherStats(false);
      } else {
        loadStudents(false);
        loadAttendance(false);
      }
    }, AUTO_REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  function bindControls() {
    function refreshCurrentView() {
      if (isStatsView()) {
        loadTeacherStats(true);
      } else {
        loadStudents(false, true);
        loadAttendance(false, true);
      }
    }
    if (elRefresh) elRefresh.addEventListener('click', refreshCurrentView);
    if (elMobileRefresh) elMobileRefresh.addEventListener('click', refreshCurrentView);
    if (elViewAttendance) {
      elViewAttendance.addEventListener('click', () => switchView('attendance'));
    }
    if (elViewStats) {
      elViewStats.addEventListener('click', () => switchView('stats'));
    }
    if (elViewSettings) {
      elViewSettings.addEventListener('click', () => switchView('settings'));
    }
    if (elMobileFilterToggle) {
      elMobileFilterToggle.addEventListener('click', () => {
        document.documentElement.dataset.filterOpen = 'true';
      });
    }
    if (elMobileFilterClose) {
      elMobileFilterClose.addEventListener('click', () => {
        document.documentElement.dataset.filterOpen = 'false';
      });
    }
    function resetTeacherStatsCache() {
      state.teacherStats = null;
      state.teacherStatsLoadedKey = '';
      state.teacherStatsError = '';
    }
    function setTeacherStatsRange(range) {
      state.teacherStatsRange = range === 'month' ? 'month' : 'day';
      resetTeacherStatsCache();
      setViewUi();
      if (isStatsView()) loadTeacherStats(true);
    }
    if (elTeacherStatsRangeDay) {
      elTeacherStatsRangeDay.addEventListener('click', () => setTeacherStatsRange('day'));
    }
    if (elTeacherStatsRangeMonth) {
      elTeacherStatsRangeMonth.addEventListener('click', () => setTeacherStatsRange('month'));
    }
    if (elTeacherStatsDate) {
      elTeacherStatsDate.value = state.teacherStatsDate;
      elTeacherStatsDate.addEventListener('change', () => {
        state.teacherStatsDate = elTeacherStatsDate.value || todayDateString();
        resetTeacherStatsCache();
        if (isStatsView()) loadTeacherStats(true);
      });
    }
    if (elTeacherStatsMonth) {
      elTeacherStatsMonth.value = state.teacherStatsMonth;
      elTeacherStatsMonth.addEventListener('change', () => {
        state.teacherStatsMonth = elTeacherStatsMonth.value || currentMonthString();
        resetTeacherStatsCache();
        if (isStatsView()) loadTeacherStats(true);
      });
    }
    if (elTeacherStatsRefresh) {
      elTeacherStatsRefresh.addEventListener('click', () => {
        loadTeacherStats(true);
      });
    }
    if (elUnfinishedStep) {
      elUnfinishedStep.value = state.unfinishedStep;
      elUnfinishedStep.addEventListener('change', () => {
        state.unfinishedStep = elUnfinishedStep.value || '';
        if (state.showUnfinishedOnly) state.collapsedYears.clear();
        renderAttendanceView({ preserveScroll: false });
      });
    }
    if (elUnfinishedToggle) {
      elUnfinishedToggle.addEventListener('click', () => {
        state.showUnfinishedOnly = !state.showUnfinishedOnly;
        if (state.showUnfinishedOnly) state.collapsedYears.clear();
        renderAttendanceView({ preserveScroll: !state.showUnfinishedOnly });
      });
    }
    function signOut() {
      saveAuthToken('');
      state.auth.user = null;
      state.appStarted = false;
      state.currentView = 'attendance';
      state.teacherStats = null;
      state.teacherStatsLoadedKey = '';
      state.teacherStatsError = '';
      stopAutoRefresh();
      if (window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.disableAutoSelect();
      }
      setAuthUi();
      setViewUi();
      renderGoogleButton();
    }
    if (elSignOut) elSignOut.addEventListener('click', signOut);
    if (elMobileSignOut) elMobileSignOut.addEventListener('click', signOut);
    if (elAttendanceSearch) {
      elAttendanceSearch.addEventListener('input', () => {
        state.attendanceSearch = elAttendanceSearch.value || '';
        updateSearchHighlightAndScroll(true);
      });
    }
    if (elAttendanceDate) {
      elAttendanceDate.addEventListener('change', () => {
        state.attendanceDate = elAttendanceDate.value || todayDateString();
        state.attendanceLoaded = false;
        state.lastAttendanceHash = '';
        state.attendance = {};
        state.attendanceSyncText = '正在同步记录…';
        renderAttendanceView();
        loadAttendance(true, true);
      });
    }
    [
      [elAttendanceCampus, 'campus'],
      [elAttendanceBlock, 'block'],
      [elAttendanceYear, 'year'],
      [elAttendanceTime, 'time']
    ].forEach(([el, key]) => {
      if (!el) return;
      el.addEventListener('change', () => {
        state.attendanceFilters[key] = el.value || '';
        renderAttendanceView();
      });
    });
  }

  function startAppData() {
    if (state.appStarted) return;
    state.appStarted = true;
    loadAttendanceCache();
    setViewUi();
    renderAttendanceView();
    renderTeacherStats();
    loadStudents(true);
    loadAttendance(true);
    startAutoRefresh();
  }

  async function init() {
    syncShellMode();
    bindControls();
    const canStart = await checkAuth();
    if (canStart) startAppData();
    window.addEventListener('resize', syncShellMode);
    const displayMode = window.matchMedia('(display-mode: standalone)');
    if (displayMode.addEventListener) displayMode.addEventListener('change', syncShellMode);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        if (isStatsView()) {
          loadTeacherStats(false);
        } else {
          loadStudents(false);
          loadAttendance(false);
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
