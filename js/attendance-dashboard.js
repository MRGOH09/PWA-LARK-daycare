(function () {
  'use strict';

  const AUTH_SESSION_KEY = 'daycare-attendance-auth-v1';
  const MAIN_API_ORIGIN = 'https://pwa-lark-daycare.vercel.app';
  const STEP_ORDER = ['pickup', 'arrival', 'tuition', 'shower', 'meal', 'homework', 'extra', 'home'];
  const state = {
    auth: { enabled: false, clientId: '', token: '', user: null, error: '' },
    range: 'day',
    view: 'students',
    data: null,
    filters: { search: '', campus: '', year: '', block: '', period: '', teacher: '', status: '' },
    selectedDate: '',
    monthData: null,
    studentMaster: null
  };

  const $ = (sel) => document.querySelector(sel);
  const elAuthGate = $('#auth-gate');
  const elAuthStatus = $('#auth-status');
  const elGoogleButton = $('#google-signin-button');
  const elDate = $('#date');
  const elMonth = $('#month');
  const elRangeDay = $('#range-day');
  const elRangeMonth = $('#range-month');
  const elQuickRefresh = $('#quick-refresh');
  const elRefresh = $('#refresh');
  const elSignOut = $('#sign-out');
  const elMeta = $('#meta');
  const elSummary = $('#summary');
  const elScopeNote = $('#scope-note');
  const elStudentAnalysis = $('#student-analysis');
  const elCalendar = $('#calendar');
  const elMatrix = $('#matrix');
  const elClearMatrixFilter = $('#clear-matrix-filter');
  const elSteps = $('#steps');
  const elContent = $('#content');
  const elStudentFilters = $('#student-filters');
  const elSearch = $('#student-search');
  const filterEls = {
    campus: $('#filter-campus'),
    year: $('#filter-year'),
    block: $('#filter-block'),
    teacher: $('#filter-teacher'),
    status: $('#filter-status')
  };
  const elStudentModal = $('#student-modal');
  const elStudentModalTitle = $('#student-modal-title');
  const elStudentModalMeta = $('#student-modal-meta');
  const elStudentModalBody = $('#student-modal-body');
  const elStudentModalClose = $('#student-modal-close');

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

  function monthFromDate(dateText) {
    const text = String(dateText || dateValue());
    return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : monthValue();
  }

  function previousMonth(monthText) {
    const [year, month] = String(monthText || monthValue()).split('-').map(Number);
    const date = new Date(year, month - 2, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function attendanceRecords(data) {
    return attendanceDataset(data).students || [];
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

  function studentDate(student) {
    return String((student && student.date) || '');
  }

  function activeDate() {
    return state.selectedDate || elDate.value || dateValue();
  }

  function statusClass(status) {
    return status === 'not-started' ? 'not-started' : status || '';
  }

  function setRange(range) {
    state.range = range === 'month' ? 'month' : 'day';
    if (elDate) elDate.hidden = state.range !== 'day';
    if (elMonth) elMonth.hidden = state.range !== 'month';
    if (elRangeDay) elRangeDay.classList.toggle('active', state.range === 'day');
    if (elRangeMonth) elRangeMonth.classList.toggle('active', state.range === 'month');
  }

  function setView(view) {
    state.view = view === 'teachers' ? 'teachers' : 'students';
    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.view === state.view));
    });
    if (elStudentFilters) elStudentFilters.hidden = state.view !== 'students';
    if (elStudentAnalysis) elStudentAnalysis.hidden = state.view !== 'students';
    if (elScopeNote) elScopeNote.hidden = state.view !== 'students';
    renderCurrentView();
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
    if (!state.auth.clientId) {
      elGoogleButton.innerHTML = '';
      state.auth.error = state.auth.error || 'Google 登录尚未配置：缺少 GOOGLE_CLIENT_ID';
      setAuthUi();
      return;
    }
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

  function statsSteps(data) {
    const labels = data && data.stepLabels ? data.stepLabels : {};
    return Object.keys(labels)
      .filter((key) => key !== 'note')
      .map((key) => ({ key, label: labels[key] || key }));
  }

  function cardHtml(label, value) {
    return `<article class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
  }

  function populateSelect(el, label, values, current) {
    if (!el) return;
    const options = [`<option value="">${escapeHtml(label)}</option>`]
      .concat((values || []).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`));
    el.innerHTML = options.join('');
    el.value = current || '';
  }

  function renderStudentFilters(attendance) {
    const filters = (attendance && attendance.filters) || {};
    populateSelect(filterEls.campus, '全部分院', filters.campuses, state.filters.campus);
    populateSelect(filterEls.year, '全部年级', filters.years, state.filters.year);
    populateSelect(filterEls.block, '全部 BLOCK', filters.blocks, state.filters.block);
    populateSelect(filterEls.teacher, '全部老师', filters.teachers, state.filters.teacher);
    if (filterEls.status) {
      const statuses = filters.statuses || [];
      filterEls.status.innerHTML = '<option value="">全部状态</option>' + statuses
        .map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`)
        .join('');
      filterEls.status.value = state.filters.status || '';
    }
  }

  function statusLabel(status) {
    return {
      complete: '已完成',
      partial: '部分未点',
      'not-started': '未开始',
      absent: '缺席/未接'
    }[status] || status;
  }

  function fallbackStudentStatus(missingSteps, steps) {
    if (Object.values(steps || {}).some((value) => value === '缺席' || value === '未接')) return 'absent';
    if (missingSteps.length === STEP_ORDER.length) return 'not-started';
    if (missingSteps.length) return 'partial';
    return 'complete';
  }

  function filtersFromStudents(students) {
    const unique = (values) => Array.from(new Set(values.filter(Boolean))).sort();
    return {
      campuses: unique(students.map((student) => student.campus)),
      years: unique(students.map((student) => student.year)),
      blocks: unique(students.map((student) => student.block)),
      teachers: unique(students.map((student) => student.teacher)),
      statuses: [
        { key: 'complete', label: '已完成' },
        { key: 'partial', label: '部分未点' },
        { key: 'not-started', label: '未开始' },
        { key: 'absent', label: '缺席/未接' }
      ]
    };
  }

  function fieldValue(fields, names) {
    for (const name of names) {
      const value = fields && fields[name];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return '';
  }

  function buildStudentMaster(records) {
    const lookup = {};
    (records || []).forEach((record) => {
      const fields = record.fields || {};
      const info = {
        studentRecordId: record.recordId || '',
        studentNo: fieldValue(fields, ['NO', '学生NO', 'Student No']),
        studentName: fieldValue(fields, ['学生名字', '学生姓名', 'Name']),
        year: fieldValue(fields, ['YEAR / FORM', 'Year / Form', '年级']),
        block: fieldValue(fields, ['BLOCK', 'Block']),
        campus: fieldValue(fields, ['分院', '校区', 'Campus']),
        period: fieldValue(fields, ['时间段', '时段', 'Time']),
        teacher: fieldValue(fields, ['负责老师', '老师', 'Teacher'])
      };
      if (info.studentRecordId) lookup[info.studentRecordId] = info;
      if (info.studentNo) lookup[`NO:${info.studentNo}`] = info;
      if (info.studentName) lookup[`NAME:${info.studentName}`] = info;
    });
    return lookup;
  }

  async function loadStudentMaster() {
    if (state.studentMaster) return state.studentMaster;
    try {
      const resp = await fetch(apiUrl('/api/students?t=' + Date.now()), {
        cache: 'no-store',
        headers: authHeaders()
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      state.studentMaster = buildStudentMaster(data.records || []);
    } catch {
      state.studentMaster = {};
    }
    return state.studentMaster;
  }

  function masterStudentInfo(detail) {
    const lookup = state.studentMaster || {};
    return lookup[detail.studentRecordId]
      || lookup[`NO:${detail.studentNo || ''}`]
      || lookup[`NAME:${detail.studentName || ''}`]
      || {};
  }

  function eventFallbackAttendance(data) {
    const labels = (data && data.stepLabels) || {};
    const byStudent = {};
    (data.people || []).forEach((person) => {
      (person.details || []).forEach((detail) => {
        const date = detail.date || '';
        const studentId = detail.studentRecordId || detail.studentNo || detail.studentName || '';
        const step = detail.stepKey || '';
        if (!date || !studentId || !STEP_ORDER.includes(step)) return;
        const master = masterStudentInfo(detail);
        const key = `${date}|||${studentId}`;
        const row = byStudent[key] || {
          date,
          studentRecordId: detail.studentRecordId || studentId,
          studentNo: detail.studentNo || master.studentNo || '',
          studentName: detail.studentName || master.studentName || studentId || '未记录学生',
          year: detail.year || master.year || '',
          block: detail.block || master.block || '未记录 BLOCK',
          campus: detail.campus || master.campus || '',
          period: detail.period || master.period || '未记录时间',
          teacher: detail.teacher || master.teacher || person.name || '',
          steps: {},
          updatedAt: detail.createdAt || '',
          updatedByName: person.name || '',
          updatedByEmail: person.email || ''
        };
        if (!row.steps[step]) row.steps[step] = detail.newValue || '未点';
        byStudent[key] = row;
      });
    });
    const students = Object.values(byStudent).map((row) => {
      const steps = {};
      const missingSteps = [];
      let checkedSteps = 0;
      STEP_ORDER.forEach((step) => {
        const value = row.steps[step] || '未点';
        steps[step] = value;
        if (value === '未点') missingSteps.push({ key: step, label: labels[step] || step });
        else checkedSteps += 1;
      });
      const status = fallbackStudentStatus(missingSteps, steps);
      return {
        ...row,
        steps,
        status,
        statusLabel: statusLabel(status),
        checkedSteps,
        totalSteps: STEP_ORDER.length,
        completionRate: STEP_ORDER.length ? Math.round((checkedSteps / STEP_ORDER.length) * 100) : 0,
        missingSteps,
        absentSteps: Object.entries(steps)
          .filter((entry) => entry[1] === '缺席' || entry[1] === '未接')
          .map((entry) => ({ key: entry[0], label: labels[entry[0]] || entry[0], value: entry[1] }))
      };
    }).sort((a, b) => `${a.date}|${a.block}|${a.period}|${a.studentName}`.localeCompare(`${b.date}|${b.block}|${b.period}|${b.studentName}`));
    return { students, filters: filtersFromStudents(students), source: 'events' };
  }

  function attendanceDataset(data) {
    const attendance = (data || {}).attendance || {};
    if ((attendance.students || []).length) return attendance;
    return eventFallbackAttendance(data || {});
  }

  function filteredStudents() {
    const students = attendanceDataset(state.data).students || [];
    const search = state.filters.search.trim().toLowerCase();
    return students.filter((student) => {
      if (state.range === 'day' && studentDate(student) !== activeDate()) return false;
      if (state.filters.campus && student.campus !== state.filters.campus) return false;
      if (state.filters.year && student.year !== state.filters.year) return false;
      if (state.filters.block && student.block !== state.filters.block) return false;
      if (state.filters.period && student.period !== state.filters.period) return false;
      if (state.filters.teacher && student.teacher !== state.filters.teacher) return false;
      if (state.filters.status && student.status !== state.filters.status) return false;
      if (!search) return true;
      return [student.studentName, student.studentNo, student.teacher, student.block, student.campus]
        .some((value) => String(value || '').toLowerCase().includes(search));
    });
  }

  function summarizeStudents(students) {
    const totals = {
      totalRecords: students.length,
      complete: 0,
      partial: 0,
      notStarted: 0,
      absent: 0,
      missingItems: 0,
      homeworkCompleted: 0,
      homeworkNotCompleted: 0,
      completionRate: 0
    };
    let checked = 0;
    let possible = 0;
    students.forEach((student) => {
      if (student.status === 'complete') totals.complete += 1;
      if (student.status === 'partial') totals.partial += 1;
      if (student.status === 'not-started') totals.notStarted += 1;
      if (student.status === 'absent') totals.absent += 1;
      totals.missingItems += (student.missingSteps || []).length;
      if ((student.steps || {}).homework === '完成了') totals.homeworkCompleted += 1;
      if ((student.steps || {}).homework === '没完成') totals.homeworkNotCompleted += 1;
      checked += Number(student.checkedSteps || 0);
      possible += Number(student.totalSteps || STEP_ORDER.length);
    });
    totals.completionRate = possible ? Math.round((checked / possible) * 100) : 0;
    return totals;
  }

  function renderStudentSummary(students) {
    const totals = summarizeStudents(students);
    elSummary.innerHTML = [
      ['学生记录', totals.totalRecords],
      ['完成率', `${totals.completionRate}%`],
      ['已完成', totals.complete],
      ['部分未点', totals.partial],
      ['未开始', totals.notStarted],
      ['缺席/未接', totals.absent],
      ['未点项目', totals.missingItems],
      ['功课完成', totals.homeworkCompleted],
      ['功课没完成', totals.homeworkNotCompleted]
    ].map(([label, value]) => cardHtml(label, value)).join('');
  }

  function completionClass(rate, count) {
    if (!count) return 'no-data';
    if (rate >= 90) return 'good';
    if (rate >= 70) return 'warn';
    return 'bad';
  }

  function groupByDate(students) {
    return students.reduce((acc, student) => {
      const date = studentDate(student);
      if (!date) return acc;
      (acc[date] = acc[date] || []).push(student);
      return acc;
    }, {});
  }

  function monthDays(monthText) {
    const [year, month] = String(monthText || monthValue()).split('-').map(Number);
    const first = new Date(year, month - 1, 1);
    const total = new Date(year, month, 0).getDate();
    return { year, month, firstWeekday: first.getDay(), total };
  }

  function renderCalendar() {
    if (!elCalendar) return;
    const attendance = attendanceDataset(state.monthData || state.data || {});
    const students = attendance.students || [];
    const monthText = (state.monthData && state.monthData.month) || elMonth.value || monthValue();
    const byDate = groupByDate(students);
    const { year, month, firstWeekday, total } = monthDays(monthText);
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const blanks = Array.from({ length: firstWeekday }, () => '<div class="calendar-day empty"></div>');
    const days = Array.from({ length: total }, (_, i) => {
      const day = i + 1;
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayStudents = byDate[date] || [];
      const totals = summarizeStudents(dayStudents);
      const klass = completionClass(totals.completionRate, dayStudents.length);
      const selected = date === activeDate() ? ' selected' : '';
      const line = dayStudents.length
        ? `${totals.completionRate}% · ${dayStudents.length}人<br>${totals.partial + totals.notStarted}未点 · ${totals.absent}异常`
        : '无数据';
      return `<button class="calendar-day ${klass}${selected}" type="button" data-calendar-date="${escapeHtml(date)}">
        <strong>${day}</strong>
        <span>${line}</span>
      </button>`;
    });
    elCalendar.innerHTML = `<div class="calendar-head">${weekdays.map((day) => `<div>${day}</div>`).join('')}</div><div class="calendar-grid">${blanks.concat(days).join('')}</div>`;
    elCalendar.querySelectorAll('[data-calendar-date]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedDate = btn.dataset.calendarDate;
        elDate.value = state.selectedDate;
        setRange('day');
        loadStats();
      });
    });
  }

  function groupByBlockPeriod(students) {
    const blocks = [];
    const periods = [];
    const cells = {};
    students.forEach((student) => {
      const block = student.block || '未记录 BLOCK';
      const period = student.period || '未记录时间';
      if (!blocks.includes(block)) blocks.push(block);
      if (!periods.includes(period)) periods.push(period);
      const key = `${block}|||${period}`;
      (cells[key] = cells[key] || []).push(student);
    });
    return {
      blocks: blocks.sort(),
      periods: periods.sort(),
      cells
    };
  }

  function renderMatrix(students) {
    if (!elMatrix) return;
    const { blocks, periods, cells } = groupByBlockPeriod(students);
    if (!blocks.length || !periods.length) {
      elMatrix.innerHTML = '<div class="empty">当前范围没有 BLOCK / 时间段数据。</div>';
      return;
    }
    elMatrix.innerHTML = `<table class="matrix">
      <thead>
        <tr>
          <th>时间段</th>
          ${blocks.map((block) => `<th>${escapeHtml(block)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${periods.map((period) => `<tr>
          <th>${escapeHtml(period)}</th>
          ${blocks.map((block) => {
            const key = `${block}|||${period}`;
            const list = cells[key] || [];
            const totals = summarizeStudents(list);
            const klass = completionClass(totals.completionRate, list.length);
            const disabled = list.length ? '' : ' disabled';
            return `<td><button class="${klass}" type="button" data-block="${escapeHtml(block)}" data-period="${escapeHtml(period)}"${disabled}>
              ${list.length ? `${totals.completionRate}%` : '-'}
              <span>${list.length}人 · ${totals.partial + totals.notStarted}未点 · ${totals.absent}异常</span>
            </button></td>`;
          }).join('')}
        </tr>`).join('')}
      </tbody>
    </table>`;
    elMatrix.querySelectorAll('[data-block][data-period]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filters.block = btn.dataset.block || '';
        state.filters.period = btn.dataset.period || '';
        renderCurrentView();
      });
    });
  }

  function renderScopeNote(totalStudents, visibleStudents) {
    if (!elScopeNote) return;
    const hasFilter = ['search', 'campus', 'year', 'block', 'period', 'teacher', 'status']
      .some((key) => Boolean(state.filters[key]));
    const periodText = state.filters.period ? ` · 时间段：${state.filters.period}` : '';
    const rangeLabel = state.range === 'month' ? '所选月份' : '所选日期';
    const scope = hasFilter ? '当前统计：筛选后的部分数据' : `当前统计：${rangeLabel}的全部点名记录`;
    const dataSource = attendanceDataset(state.data || {}).source === 'events'
      ? '数据来源：老师点名操作日志；未被操作过的学生不会被计入。'
      : '数据来源：已生成的 attendance_records；未生成记录的应到学生不会被计入。';
    elScopeNote.hidden = false;
    elScopeNote.innerHTML = `<span><strong>${escapeHtml(scope)}</strong>${escapeHtml(periodText)} · 显示 ${visibleStudents.length} / ${totalStudents.length} 条学生记录</span>
      <span>${escapeHtml(dataSource)}</span>`;
  }

  function renderStepOverview(students) {
    const labels = (state.data || {}).stepLabels || {};
    const counts = {};
    STEP_ORDER.forEach((step) => {
      counts[step] = { checked: 0, missing: 0 };
    });
    students.forEach((student) => {
      STEP_ORDER.forEach((step) => {
        const value = (student.steps || {})[step] || '未点';
        if (value === '未点') counts[step].missing += 1;
        else counts[step].checked += 1;
      });
    });
    elSteps.hidden = false;
    elSteps.innerHTML = STEP_ORDER.map((step) => {
      const item = counts[step];
      const total = item.checked + item.missing;
      const pct = total ? Math.round((item.checked / total) * 100) : 0;
      return `<article class="step-card">
        <strong>${escapeHtml(labels[step] || step)}</strong>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <p>${pct}% 已点 · ${escapeHtml(item.missing)} 未点</p>
      </article>`;
    }).join('');
  }

  function renderStudentTable(students) {
    if (!students.length) {
      elContent.className = 'empty';
      elContent.textContent = '当前筛选下没有学生点名记录。';
      return;
    }
    elContent.className = 'table-wrap';
    elContent.innerHTML = `<table>
      <thead>
        <tr>
          <th>学生</th>
          <th>日期</th>
          <th>分院</th>
          <th>年级</th>
          <th>BLOCK</th>
          <th>时间段</th>
          <th>负责老师</th>
          <th>状态</th>
          <th>完成度</th>
          <th>未点项目</th>
          <th>最后更新</th>
        </tr>
      </thead>
      <tbody>
        ${students.map((student, index) => `<tr class="student-row" data-student-index="${index}">
          <td class="name"><strong>${escapeHtml(student.studentName)}</strong><span>${escapeHtml(student.studentNo || student.studentRecordId || '')}</span></td>
          <td>${escapeHtml(student.date)}</td>
          <td>${escapeHtml(student.campus || '-')}</td>
          <td>${escapeHtml(student.year || '-')}</td>
          <td>${escapeHtml(student.block || '-')}</td>
          <td>${escapeHtml(student.period || '-')}</td>
          <td>${escapeHtml(student.teacher || '-')}</td>
          <td><span class="pill ${statusClass(student.status)}">${escapeHtml(student.statusLabel)}</span></td>
          <td><div class="progress" title="${escapeHtml(student.completionRate)}%"><span style="width:${Number(student.completionRate || 0)}%"></span></div></td>
          <td>${escapeHtml((student.missingSteps || []).map((step) => step.label).join('、') || '-')}</td>
          <td>${escapeHtml(student.updatedByName || student.updatedByEmail || student.updatedAt || '-')}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
    elContent.querySelectorAll('[data-student-index]').forEach((row) => {
      row.addEventListener('click', () => openStudentDetail(students[Number(row.dataset.studentIndex)]));
    });
  }

  function renderStudentsView() {
    const attendance = attendanceDataset(state.data || {});
    renderStudentFilters(attendance);
    renderCalendar();
    const totalStudents = (attendance.students || []).filter((student) => state.range !== 'day' || studentDate(student) === activeDate());
    const students = filteredStudents();
    renderStudentSummary(students);
    renderScopeNote(totalStudents, students);
    renderMatrix(totalStudents);
    renderStepOverview(students);
    renderStudentTable(students);
    if (elClearMatrixFilter) {
      elClearMatrixFilter.hidden = !(state.filters.block || state.filters.period);
    }
  }

  function renderTeacherSummary(data) {
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
    elSummary.innerHTML = cards.map(([label, value]) => cardHtml(label, value)).join('');
  }

  function renderTeacherTable(data) {
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

  function renderTeachersView() {
    if (elStudentAnalysis) elStudentAnalysis.hidden = true;
    if (elScopeNote) elScopeNote.hidden = true;
    elSteps.hidden = true;
    renderTeacherSummary(state.data || {});
    renderTeacherTable(state.data || {});
  }

  function renderCurrentView() {
    if (!state.data) return;
    if (state.view === 'teachers') renderTeachersView();
    else renderStudentsView();
  }

  function openStudentDetail(student) {
    if (!student) return;
    const labels = (state.data || {}).stepLabels || {};
    elStudentModalTitle.textContent = student.studentName || '学生点名细节';
    elStudentModalMeta.textContent = `${student.date || '-'} · ${student.block || '-'} · ${student.period || '-'}`;
    elStudentModalBody.innerHTML = `
      <div><span class="pill ${statusClass(student.status)}">${escapeHtml(student.statusLabel)}</span></div>
      <section class="detail-list">
        <div><span>学生编号</span><strong>${escapeHtml(student.studentNo || student.studentRecordId || '-')}</strong></div>
        <div><span>分院</span><strong>${escapeHtml(student.campus || '-')}</strong></div>
        <div><span>年级</span><strong>${escapeHtml(student.year || '-')}</strong></div>
        <div><span>负责老师</span><strong>${escapeHtml(student.teacher || '-')}</strong></div>
        <div><span>完成度</span><strong>${escapeHtml(student.completionRate || 0)}%</strong></div>
        <div><span>最后更新</span><strong>${escapeHtml(student.updatedByName || student.updatedByEmail || student.updatedAt || '-')}</strong></div>
      </section>
      <section class="steps-detail">
        ${STEP_ORDER.map((step) => {
          const value = (student.steps || {})[step] || '未点';
          return `<div class="step-line">
            <strong>${escapeHtml(labels[step] || step)}</strong>
            <span>${escapeHtml(value)}</span>
          </div>`;
        }).join('')}
      </section>
      ${student.note ? `<section class="step-card"><strong>备注</strong><p>${escapeHtml(student.note)}</p></section>` : ''}
    `;
    elStudentModal.hidden = false;
  }

  function closeStudentDetail() {
    elStudentModal.hidden = true;
  }

  async function loadStats() {
    try {
      elMeta.textContent = '加载统计中…';
      elContent.className = 'empty';
      elContent.textContent = '加载统计中…';
      const params = new URLSearchParams({ range: state.range, t: String(Date.now()) });
      if (state.range === 'month') params.set('month', elMonth.value || monthValue());
      else params.set('date', elDate.value || dateValue());
      const resp = await fetch(apiUrl('/api/attendance-stats?' + params.toString()), {
        cache: 'no-store',
        headers: authHeaders()
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
      await loadStudentMaster();
      state.data = data;
      if (state.range === 'month') state.monthData = data;
      elMeta.textContent = `${labelForRange(data)} · 更新于 ${data.updatedAt || '-'}`;
      renderCurrentView();
      if (state.range === 'day') loadMonthOverview(true);
      else if (!attendanceRecords(data).length) findLatestMonthWithData(data.month || elMonth.value || monthValue());
    } catch (err) {
      elMeta.textContent = `加载失败：${err.message}`;
      elSteps.hidden = true;
      elContent.className = 'empty';
      elContent.textContent = `无法读取统计：${err.message}`;
    }
  }

  async function updateVersion() {
    if (elQuickRefresh) {
      elQuickRefresh.disabled = true;
      elQuickRefresh.textContent = '更新中…';
    }
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch (err) {
      console.warn('version update cleanup failed', err);
    } finally {
      const url = new URL(window.location.href);
      url.searchParams.set('v', String(Date.now()));
      window.location.replace(url.toString());
    }
  }

  async function fetchStatsRange(range, value) {
    const params = new URLSearchParams({ range, t: String(Date.now()) });
    if (range === 'month') params.set('month', value || monthValue());
    else params.set('date', value || dateValue());
    const resp = await fetch(apiUrl('/api/attendance-stats?' + params.toString()), {
      cache: 'no-store',
      headers: authHeaders()
    });
    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  }

  async function loadMonthOverview(allowFallback) {
    const month = monthFromDate(activeDate());
    if (state.monthData && state.monthData.month === month) {
      renderCalendar();
      if (allowFallback && !attendanceRecords(state.monthData).length) findLatestMonthWithData(month);
      return;
    }
    try {
      const data = await fetchStatsRange('month', month);
      await loadStudentMaster();
      state.monthData = data;
      if (state.view === 'students') renderCalendar();
      if (allowFallback && !attendanceRecords(data).length) findLatestMonthWithData(month);
    } catch {
      // Day-level analysis still works if the month overview cannot be loaded.
    }
  }

  async function findLatestMonthWithData(startMonth) {
    let month = startMonth || monthValue();
    elMeta.textContent = `${month} 没有点名记录，正在寻找最近有数据的月份…`;
    for (let i = 0; i < 18; i += 1) {
      month = i === 0 ? month : previousMonth(month);
      try {
        const data = await fetchStatsRange('month', month);
        await loadStudentMaster();
        if (attendanceRecords(data).length) {
          state.range = 'month';
          state.data = data;
          state.monthData = data;
          elMonth.value = data.month || month;
          setRange('month');
          elMeta.textContent = `已自动切换到最近有数据的月份：${data.month || month} · 更新于 ${data.updatedAt || '-'}`;
          renderCurrentView();
          return;
        }
      } catch {
        return;
      }
    }
    elMeta.textContent = `最近 18 个月没有找到点名记录。`;
  }

  async function init() {
    elDate.value = dateValue();
    elMonth.value = monthValue();
    setRange('day');
    setView('students');
    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => setView(btn.dataset.view));
    });
    elRangeDay.addEventListener('click', () => {
      state.selectedDate = elDate.value || dateValue();
      setRange('day');
      loadStats();
    });
    elRangeMonth.addEventListener('click', () => {
      state.filters.period = '';
      setRange('month');
      loadStats();
    });
    elRefresh.addEventListener('click', loadStats);
    elQuickRefresh.addEventListener('click', updateVersion);
    elDate.addEventListener('change', () => {
      state.selectedDate = elDate.value || dateValue();
      loadStats();
    });
    elMonth.addEventListener('change', loadStats);
    elSearch.addEventListener('input', () => {
      state.filters.search = elSearch.value || '';
      renderCurrentView();
    });
    Object.entries(filterEls).forEach(([key, el]) => {
      if (!el) return;
      el.addEventListener('change', () => {
        state.filters[key] = el.value || '';
        renderCurrentView();
      });
    });
    elClearMatrixFilter.addEventListener('click', () => {
      state.filters.block = '';
      state.filters.period = '';
      renderCurrentView();
    });
    elStudentModalClose.addEventListener('click', closeStudentDetail);
    elStudentModal.addEventListener('click', (event) => {
      if (event.target === elStudentModal) closeStudentDetail();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !elStudentModal.hidden) closeStudentDetail();
    });
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
