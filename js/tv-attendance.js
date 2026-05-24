(function () {
  'use strict';

  var REFRESH_MS = 8000;
  var ROTATE_MS = 8000;
  var PIN_KEY = 'tv-attendance-pin-v1';
  var SCOPE_KEY = 'tv-attendance-scope-v1';
  var STUDENT_FIELDS = ['pickup', 'arrival', 'tuition', 'shower', 'meal', 'homework', 'extra', 'home'];
  var FLOW_STEPS = [
    { key: 'pickup', label: '接', full: '接生', defaultValue: '未点' },
    { key: 'arrival', label: '到', full: '到校', defaultValue: '未点' },
    { key: 'tuition', label: '补', full: '补习', defaultValue: '未点' },
    { key: 'shower', label: '冲', full: '冲凉', defaultValue: '未点' },
    { key: 'meal', label: '餐', full: '用餐', defaultValue: '未点' },
    { key: 'homework', label: '功', full: '功课', defaultValue: '未点' },
    { key: 'extra', label: '复', full: '复习', defaultValue: '未点' },
    { key: 'home', label: '回', full: '回家/去学校', defaultValue: '未点' }
  ];
  var GROUPS = [
    { key: 'arrived', label: '已到', match: '到了' },
    { key: 'waiting', label: '还没有', match: '还没有' },
    { key: 'absent', label: '缺席', match: '缺席' },
    { key: 'koko', label: 'KOKO', match: 'KOKO' },
    { key: 'idle', label: '未点', match: '未点' }
  ];
  var YEAR_ORDER = ['PA', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'F1', 'F2', 'F3', 'F4', 'F5'];

  var state = {
    pin: '',
    date: todayDateString(),
    data: null,
    scope: { campus: '', block: '', period: '' },
    merged: [],
    filtered: [],
    pages: [],
    pageIndex: 0,
    refreshTimer: null,
    rotateTimer: null,
    lastHash: '',
    loading: false
  };

  var elPinScreen = $('#pin-screen');
  var elSetupScreen = $('#setup-screen');
  var elBoardScreen = $('#board-screen');
  var elPinForm = $('#pin-form');
  var elPinInput = $('#pin-input');
  var elPinMessage = $('#pin-message');
  var elSetupForm = $('#setup-form');
  var elSetupMessage = $('#setup-message');
  var elCampus = $('#campus-select');
  var elBlockField = $('#block-field');
  var elBlock = $('#block-select');
  var elPeriod = $('#period-select');
  var elBoardMeta = $('#board-meta');
  var elTeacherList = $('#teacher-list');
  var elStatsGrid = $('#stats-grid');
  var elStudentStage = $('#student-stage');
  var elRefreshLabel = $('#refresh-label');
  var elPageDots = $('#page-dots');
  var elChangeClass = $('#change-class');
  var elLogoutPin = $('#logout-pin');

  function $(selector) {
    return document.querySelector(selector);
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

  function todayDateString() {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    var byType = {};
    for (var i = 0; i < parts.length; i += 1) byType[parts[i].type] = parts[i].value;
    return byType.year + '-' + byType.month + '-' + byType.day;
  }

  function showScreen(name) {
    elPinScreen.classList.toggle('hidden', name !== 'pin');
    elSetupScreen.classList.toggle('hidden', name !== 'setup');
    elBoardScreen.classList.toggle('hidden', name !== 'board');
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch (err) {
      return '';
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {}
  }

  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (err) {}
  }

  function apiUrl() {
    var params = new URLSearchParams({
      pin: state.pin,
      date: state.date,
      t: String(Date.now())
    });
    return '/api/attendance-tv?' + params.toString();
  }

  function unique(values) {
    var seen = {};
    var out = [];
    for (var i = 0; i < values.length; i += 1) {
      var value = String(values[i] || '').trim();
      if (!value || seen[value]) continue;
      seen[value] = true;
      out.push(value);
    }
    return out.sort(function (a, b) {
      return a.localeCompare(b, 'zh', { numeric: true });
    });
  }

  function fillSelect(el, values, current, emptyLabel) {
    var safeValues = values.slice();
    var html = emptyLabel ? '<option value="">' + escapeHtml(emptyLabel) + '</option>' : '';
    for (var i = 0; i < safeValues.length; i += 1) {
      html += '<option value="' + escapeHtml(safeValues[i]) + '">' + escapeHtml(safeValues[i]) + '</option>';
    }
    el.innerHTML = html;
    if (current && safeValues.indexOf(current) >= 0) el.value = current;
    else if (!emptyLabel && safeValues.length) el.value = safeValues[0];
    else el.value = '';
  }

  function activeStudents() {
    return state.data && state.data.students ? state.data.students : [];
  }

  function studentsForCampus(campus) {
    var list = activeStudents();
    if (!campus) return list;
    return list.filter(function (student) {
      if (campus === '未填分院') return !student.campus;
      return (student.campus || '') === campus;
    });
  }

  function studentsForBlock(campus, block) {
    var list = studentsForCampus(campus);
    if (!block) return list;
    return list.filter(function (student) {
      return (student.block || '') === block;
    });
  }

  function renderSetupOptions() {
    var saved = loadSavedScope();
    var campuses = unique(activeStudents().map(function (student) { return student.campus || '未填分院'; }));
    fillSelect(elCampus, campuses, state.scope.campus || saved.campus, '');
    state.scope.campus = elCampus.value || '';

    refreshBlockOptions(saved.block);
    refreshPeriodOptions(saved.period);
  }

  function refreshBlockOptions(preferred) {
    var campusValue = elCampus.value || '';
    var source = studentsForCampus(campusValue);
    var blocks = unique(source.map(function (student) { return student.block; }));
    var hasBlocks = blocks.length > 0;
    elBlockField.classList.toggle('hidden', !hasBlocks);
    if (hasBlocks) {
      fillSelect(elBlock, blocks, state.scope.block || preferred, blocks.length > 1 ? '请选择 BLOCK' : '');
      state.scope.block = elBlock.value || '';
    } else {
      elBlock.innerHTML = '';
      state.scope.block = '';
    }
  }

  function refreshPeriodOptions(preferred) {
    var campusValue = elCampus.value || '';
    var blockValue = elBlockField.classList.contains('hidden') ? '' : (elBlock.value || '');
    var source = studentsForBlock(campusValue, blockValue);
    var periods = unique(source.map(function (student) { return student.period; }));
    fillSelect(elPeriod, periods, state.scope.period || preferred, periods.length > 1 ? '请选择时间段' : '');
    state.scope.period = elPeriod.value || '';
  }

  function loadSavedScope() {
    try {
      return JSON.parse(storageGet(SCOPE_KEY) || '{}') || {};
    } catch (err) {
      return {};
    }
  }

  function saveScope() {
    storageSet(SCOPE_KEY, JSON.stringify(state.scope));
  }

  function setMessage(el, text) {
    el.textContent = text || '';
  }

  async function loadData(options) {
    options = options || {};
    if (state.loading) return;
    state.loading = true;
    try {
      var resp = await fetch(apiUrl(), { cache: 'no-store' });
      var text = await resp.text();
      var data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error('返回非 JSON 数据');
      }
      if (!resp.ok || !data.success) throw new Error(data.error || '读取失败');

      state.data = data;
      state.date = data.date || state.date;
      var hash = JSON.stringify({
        students: data.counts ? data.counts.students : 0,
        attendance: data.counts ? data.counts.attendance : 0,
        updatedAt: data.updatedAt
      });
      state.lastHash = hash;

      if (options.afterPin) {
        storageSet(PIN_KEY, state.pin);
        renderSetupOptions();
        showScreen('setup');
      } else if (options.setup) {
        renderSetupOptions();
      } else if (!elBoardScreen.classList.contains('hidden')) {
        prepareBoard();
      }
    } catch (err) {
      if (options.afterPin) {
        setMessage(elPinMessage, err.message);
        storageRemove(PIN_KEY);
      } else if (!elSetupScreen.classList.contains('hidden')) {
        setMessage(elSetupMessage, err.message);
      } else {
        renderBoardError(err.message);
      }
    } finally {
      state.loading = false;
    }
  }

  function defaultAttendance() {
    return {
      pickup: '未点',
      arrival: '未点',
      tuition: '未点',
      shower: '未点',
      meal: '未点',
      homework: '未点',
      extra: '未点',
      home: '未点',
      updatedAt: ''
    };
  }

  function attendanceKey(record) {
    return record.studentRecordId || record.studentNo || record.studentName || '';
  }

  function mergeRecords() {
    var attendance = {};
    var records = state.data && state.data.attendance ? state.data.attendance : [];
    var scores = state.data && state.data.scoresByStudentRecordId ? state.data.scoresByStudentRecordId : {};
    for (var i = 0; i < records.length; i += 1) {
      var key = attendanceKey(records[i]);
      if (key) attendance[key] = records[i];
    }
    var students = activeStudents();
    state.merged = students.map(function (student) {
      var record = attendance[student.recordId] || attendance[student.no] || attendance[student.name] || {};
      var merged = {
        student: student,
        attendance: Object.assign(defaultAttendance(), record),
        score: scores[student.recordId] || null
      };
      for (var j = 0; j < STUDENT_FIELDS.length; j += 1) {
        var field = STUDENT_FIELDS[j];
        if (!merged.attendance[field]) merged.attendance[field] = defaultAttendance()[field];
      }
      return merged;
    });
  }

  function filteredRecords() {
    var campus = state.scope.campus || '';
    var block = state.scope.block || '';
    var period = state.scope.period || '';
    return state.merged.filter(function (item) {
      var student = item.student;
      if (campus === '未填分院' && student.campus) return false;
      if (campus && campus !== '未填分院' && (student.campus || '') !== campus) return false;
      if (block && (student.block || '') !== block) return false;
      if (period && (student.period || '') !== period) return false;
      return true;
    }).sort(compareStudents);
  }

  function yearRank(value) {
    var text = String(value || '').toUpperCase();
    var idx = YEAR_ORDER.indexOf(text);
    return idx >= 0 ? idx : 999;
  }

  function compareStudents(a, b) {
    var sa = a.student;
    var sb = b.student;
    return yearRank(sa.year) - yearRank(sb.year) ||
      String(sa.year || '').localeCompare(String(sb.year || ''), 'zh', { numeric: true }) ||
      String(sa.no || '').localeCompare(String(sb.no || ''), 'zh', { numeric: true }) ||
      String(sa.name || '').localeCompare(String(sb.name || ''), 'zh', { numeric: true });
  }

  function groupKey(item) {
    var arrival = item.attendance.arrival || '未点';
    if (arrival === '到了') return 'arrived';
    if (arrival === '还没有') return 'waiting';
    if (arrival === '缺席') return 'absent';
    if (arrival === 'KOKO') return 'koko';
    return 'idle';
  }

  function statusText(item) {
    var arrival = item.attendance.arrival || '未点';
    if (arrival === '到了') return '已到';
    return arrival;
  }

  function toneForValue(value) {
    if (value === '未点' || value === '未回家') return 'idle';
    if (value === '已接' || value === '到了' || value === '去了' || value === '冲了' || value === '吃饭了' ||
      value === '完成了' || value === 'extra复习了') return 'good';
    if (value === '回家' || value === '去学校') return 'home';
    if (value === '未接' || value === '还没有' || value === '迟进补习' || value === '今天没补习' || value === '没完成' || value === '没有复习') return 'warn';
    if (value === '缺席' || value === '不冲凉' || value === '不吃饭') return 'bad';
    if (value === 'KOKO') return 'koko';
    return 'idle';
  }

  function calcPageSize() {
    var width = window.innerWidth || 1280;
    var height = window.innerHeight || 720;
    var cols = Math.max(1, Math.floor((width - 80) / 280));
    var rows = Math.max(1, Math.floor((height - 360) / 178));
    return Math.max(6, Math.min(24, cols * rows));
  }

  function makePages(list) {
    var pageSize = calcPageSize();
    var pages = [];
    var current = [];
    var cardCount = 0;
    var currentGroupKey = '';

    function pushPage() {
      if (!current.length) return;
      pages.push(current);
      current = [];
      cardCount = 0;
      currentGroupKey = '';
    }

    for (var g = 0; g < GROUPS.length; g += 1) {
      var group = GROUPS[g];
      var rows = list.filter(function (item) { return groupKey(item) === group.key; });
      if (!rows.length) continue;

      for (var i = 0; i < rows.length; i += 1) {
        if (cardCount >= pageSize) pushPage();
        if (currentGroupKey !== group.key) {
          current.push({ type: 'group', group: group, count: rows.length });
          currentGroupKey = group.key;
        }
        current.push({ type: 'student', item: rows[i] });
        cardCount += 1;
      }
    }
    pushPage();
    return pages;
  }

  function prepareBoard() {
    if (!state.data) return;
    mergeRecords();
    state.filtered = filteredRecords();
    state.pages = makePages(state.filtered);
    if (state.pageIndex >= state.pages.length) state.pageIndex = 0;
    renderBoard();
  }

  function groupCounts(list) {
    var counts = { total: list.length, arrived: 0, waiting: 0, absent: 0, koko: 0, idle: 0 };
    for (var i = 0; i < list.length; i += 1) {
      counts[groupKey(list[i])] += 1;
    }
    return counts;
  }

  function renderStats(list) {
    var counts = groupCounts(list);
    var cards = [
      { label: '应到', value: counts.total, cls: 'stat-total' },
      { label: '已到', value: counts.arrived, cls: 'stat-arrived' },
      { label: '还没有', value: counts.waiting, cls: 'stat-waiting' },
      { label: '缺席', value: counts.absent, cls: 'stat-absent' },
      { label: 'KOKO', value: counts.koko, cls: 'stat-koko' },
      { label: '未点', value: counts.idle, cls: 'stat-idle' }
    ];
    elStatsGrid.innerHTML = cards.map(function (card) {
      return '<article class="stat-card ' + card.cls + '">' +
        '<div class="label">' + escapeHtml(card.label) + '</div>' +
        '<div class="value">' + escapeHtml(card.value) + '</div>' +
      '</article>';
    }).join('');
  }

  function renderMeta() {
    var campus = state.scope.campus || '全部地方';
    var block = state.scope.block || '无 BLOCK';
    var period = state.scope.period || '全部时间段';
    elBoardMeta.innerHTML = [
      campus,
      block,
      period,
      state.date
    ].map(function (item) {
      return '<span class="meta-pill">' + escapeHtml(item) + '</span>';
    }).join('');
  }

  function renderTeachers(list) {
    var teachers = unique(list.map(function (item) { return item.student.teacher; }));
    elTeacherList.textContent = teachers.length ? teachers.join('、') : '-';
  }

  function fmtPoints(value) {
    var num = Number(value || 0);
    return Number.isInteger(num) ? String(num) : num.toFixed(1);
  }

  function scoreTone(points) {
    if (points >= 5) return 'boost';
    if (points >= 2.5) return 'gold';
    if (points > 0) return 'earned';
    return 'zero';
  }

  function renderScoreBadge(score) {
    var today = score ? Number(score.todayEarnedPoints || 0) : 0;
    var tier = score && score.tier ? score.tier : null;
    var tierName = tier && tier.displayName ? tier.displayName : '新星 III';
    return '<div class="score-stack">' +
      '<div class="points ' + scoreTone(today) + '">' +
        '<span>今日</span><strong>' + escapeHtml(today > 0 ? '+' + fmtPoints(today) : '0') + '</strong>' +
      '</div>' +
      '<div class="tier-pill">' + escapeHtml(tierName) + '</div>' +
    '</div>';
  }

  function renderStudentCard(item) {
    var student = item.student;
    var record = item.attendance;
    var gkey = groupKey(item);
    var chips = FLOW_STEPS.map(function (step) {
      var value = record[step.key] || step.defaultValue;
      return '<span class="flow-chip ' + toneForValue(value) + '" title="' +
        escapeHtml(step.full + '：' + value) + '">' + escapeHtml(step.label) + '</span>';
    }).join('');
    return '<article class="student-card ' + escapeHtml(gkey) + '">' +
      '<div class="student-main">' +
        '<div class="student-name">' + escapeHtml(student.name || '-') + '</div>' +
        renderScoreBadge(item.score) +
      '</div>' +
      '<div class="status-line"><span class="status-dot"></span><span>' + escapeHtml(statusText(item)) + '</span></div>' +
      '<div class="flow-chips">' + chips + '</div>' +
    '</article>';
  }

  function renderPage() {
    if (!state.filtered.length) {
      elStudentStage.innerHTML = '<div class="empty-state">这个班级范围没有匹配学生。</div>';
      elPageDots.innerHTML = '';
      return;
    }
    var page = state.pages[state.pageIndex] || [];
    var html = '<div class="page-grid">';
    for (var i = 0; i < page.length; i += 1) {
      var entry = page[i];
      if (entry.type === 'group') {
        html += '<div class="group-header group-' + escapeHtml(entry.group.key) + '">' +
          '<strong>' + escapeHtml(entry.group.label) + '</strong>' +
          '<span>' + escapeHtml(entry.count) + ' 人</span>' +
        '</div>';
      } else {
        html += renderStudentCard(entry.item);
      }
    }
    html += '</div>';
    elStudentStage.innerHTML = html;

    elPageDots.innerHTML = state.pages.map(function (_page, idx) {
      return '<span class="page-dot ' + (idx === state.pageIndex ? 'active' : '') + '"></span>';
    }).join('');
  }

  function renderBoard() {
    renderMeta();
    renderTeachers(state.filtered);
    renderStats(state.filtered);
    renderPage();
    elRefreshLabel.textContent = '最后更新：' + formatTime(state.data ? state.data.updatedAt : '');
  }

  function renderBoardError(message) {
    elStudentStage.innerHTML = '<div class="empty-state">无法读取点名数据：' + escapeHtml(message) + '</div>';
    elRefreshLabel.textContent = '同步失败';
  }

  function formatTime(value) {
    if (!value) return '-';
    var date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  }

  function startTimers() {
    stopTimers();
    state.refreshTimer = window.setInterval(function () {
      if (document.hidden) return;
      loadData();
    }, REFRESH_MS);
    state.rotateTimer = window.setInterval(function () {
      if (document.hidden || !state.pages.length) return;
      state.pageIndex = (state.pageIndex + 1) % state.pages.length;
      renderPage();
    }, ROTATE_MS);
  }

  function stopTimers() {
    if (state.refreshTimer) window.clearInterval(state.refreshTimer);
    if (state.rotateTimer) window.clearInterval(state.rotateTimer);
    state.refreshTimer = null;
    state.rotateTimer = null;
  }

  function bindEvents() {
    elPinForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var pin = (elPinInput.value || '').trim();
      if (!pin) {
        setMessage(elPinMessage, '请输入 PIN');
        return;
      }
      state.pin = pin;
      setMessage(elPinMessage, '正在读取点名数据…');
      loadData({ afterPin: true });
    });

    elCampus.addEventListener('change', function () {
      state.scope.campus = elCampus.value || '';
      state.scope.block = '';
      state.scope.period = '';
      refreshBlockOptions('');
      refreshPeriodOptions('');
    });

    elBlock.addEventListener('change', function () {
      state.scope.block = elBlock.value || '';
      state.scope.period = '';
      refreshPeriodOptions('');
    });

    elPeriod.addEventListener('change', function () {
      state.scope.period = elPeriod.value || '';
    });

    elSetupForm.addEventListener('submit', function (event) {
      event.preventDefault();
      state.scope.campus = elCampus.value || '';
      state.scope.block = elBlockField.classList.contains('hidden') ? '' : (elBlock.value || '');
      state.scope.period = elPeriod.value || '';
      if (!state.scope.campus) {
        setMessage(elSetupMessage, '请选择地方');
        return;
      }
      if (!elBlockField.classList.contains('hidden') && !state.scope.block) {
        setMessage(elSetupMessage, '请选择 BLOCK');
        return;
      }
      if (!state.scope.period) {
        setMessage(elSetupMessage, '请选择时间段');
        return;
      }
      setMessage(elSetupMessage, '');
      saveScope();
      state.pageIndex = 0;
      prepareBoard();
      showScreen('board');
      startTimers();
    });

    elChangeClass.addEventListener('click', function () {
      stopTimers();
      renderSetupOptions();
      showScreen('setup');
    });

    elLogoutPin.addEventListener('click', function () {
      stopTimers();
      storageRemove(PIN_KEY);
      state.pin = '';
      elPinInput.value = '';
      setMessage(elPinMessage, '');
      showScreen('pin');
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !elBoardScreen.classList.contains('hidden')) loadData();
    });

    window.addEventListener('resize', function () {
      if (elBoardScreen.classList.contains('hidden')) return;
      state.pages = makePages(state.filtered);
      if (state.pageIndex >= state.pages.length) state.pageIndex = 0;
      renderPage();
    });
  }

  function init() {
    bindEvents();
    var savedPin = storageGet(PIN_KEY);
    if (savedPin) {
      state.pin = savedPin;
      setMessage(elPinMessage, '正在读取点名数据…');
      loadData({ afterPin: true });
    } else {
      showScreen('pin');
      window.setTimeout(function () { elPinInput.focus(); }, 50);
    }
  }

  init();
})();
