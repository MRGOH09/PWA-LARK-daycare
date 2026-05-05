(function () {
  'use strict';

  const AXIS_START = 420;
  const AXIS_END = 1320;
  const AUTO_REFRESH_MS = 30 * 1000;
  const STUDENTS_CACHE_KEY = 'daycare-students-cache-v1';
  const DEFAULT_TEACHER_THRESHOLD = 30;
  const DEFAULT_MANPOWER_THRESHOLD = 15;
  const DAY_LABELS = {
    1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU',
    5: 'FRI', 6: 'SAT', 7: 'SUN'
  };
  const DAY_CN = {
    1: '星期一', 2: '星期二', 3: '星期三', 4: '星期四',
    5: '星期五', 6: '星期六', 7: '星期日'
  };
  const DAY_VALUES = [1, 2, 3, 4, 5, 6, 7].map((d) => `${d}.${DAY_LABELS[d]}`);
  const ROLE_KEYS = ['daycare', 'teaching', 'assistant', 'assistantTeacher'];
  const ROLE_FIELD = {
    daycare: 'daycareTeachers',
    teaching: 'teachingTeachers',
    assistant: 'assistants',
    assistantTeacher: 'assistantTeachers'
  };
  const ROLE_LABEL = {
    daycare: 'DAYCARE',
    teaching: '教书',
    assistant: '助理',
    assistantTeacher: '助教'
  };
  const LARK_FIELDS = {
    day: '礼拜几',
    block: 'BLOCK',
    studentCount: '时段人数',
    timeRange: '时间段',
    daycare: 'DAYCARE老师',
    teaching: '教书老师',
    assistant: '助理',
    assistantTeacher: '助教'
  };
  const STUDENT_FIELDS = {
    no: 'NO',
    name: '学生名字',
    year: 'YEAR / FORM',
    teacher: '负责老师',
    time: '时间段',
    note: 'Text 3',
    campus: '分院',
    stopMonth: 'Stop 月份'
  };
  const STUDENT_WEEKDAYS = [
    { key: 'MON', label: '一' },
    { key: 'TUE', label: '二' },
    { key: 'WED', label: '三' },
    { key: 'THUR', label: '四' },
    { key: 'FRI', label: '五' }
  ];
  const STUDENT_MONTHS = [
    '1. JAN', '2. FEB', '3. MAR', '4. APR', '5. MAY', '6. JUNE',
    '7. JULY', '8. AUG', '9. SEP', '10. OCT', '11. NOV', '12. DEC'
  ];
  const PRIMARY_YEAR_FILTER = '总小学人数';
  const SECONDARY_YEAR_FILTER = '总中学人数';
  const PRIMARY_YEARS = ['PA', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'];
  const SECONDARY_YEARS = ['F1', 'F2', 'F3', 'F4', 'F5'];
  const FIXED_YEAR_ORDER = [...PRIMARY_YEARS, ...SECONDARY_YEARS];

  const state = {
    records: [],
    staffRoles: { daycare: [], teaching: [], assistant: [], assistantTeacher: [] },
    students: [],
    studentColumns: [],
    studentUpdatedAt: null,
    studentSearch: '',
    studentFilters: { year: '', teacher: '', time: '', campus: '', weekday: '', stop: '' },
    stopSearch: '',
    stopFilters: { month: '', teacher: '', year: '', campus: '' },
    updatedAt: null,
    teacherThreshold: DEFAULT_TEACHER_THRESHOLD,
    manpowerThreshold: DEFAULT_MANPOWER_THRESHOLD,
    filters: { day: '', block: '', role: '', teacher: '', status: '' },
    view: 'gantt',
    teacherView: 'overview',
    teacherSort: { key: 'hours', dir: 'desc' },
    lastPayloadHash: '',
    lastStudentsHash: '',
    refreshTimer: null,
    modalOpen: false
  };

  const $ = (sel) => document.querySelector(sel);

  const elDay = $('#filter-day');
  const elBlock = $('#filter-block');
  const elRole = $('#filter-role');
  const elTeacher = $('#filter-teacher');
  const elStatus = $('#filter-status');
  const elThresholdTeacher = $('#threshold-teacher');
  const elThresholdManpower = $('#threshold-manpower');
  const elRefresh = $('#refresh');
  const elReset = $('#reset');
  const elAddSlot = $('#add-slot');
  const elAddStaff = $('#add-staff');
  const elGantt = $('#gantt-root');
  const elSummary = $('#summary');
  const elTeachersSummary = $('#teachers-summary');
  const elTeacherFilterContext = $('#teacher-filter-context');
  const elTeacherSubtabs = $('#teacher-subtabs');
  const elRoleWorkload = $('#role-workload');
  const elTeachersTable = $('#teachers-table');
  const elTeachersHeatmap = $('#teachers-heatmap');
  const elTeachersWeeklySchedule = $('#teachers-weekly-schedule');
  const elStudentsSummary = $('#students-summary');
  const elStudentSearch = $('#student-search');
  const elStudentYear = $('#student-filter-year');
  const elStudentTeacher = $('#student-filter-teacher');
  const elStudentTime = $('#student-filter-time');
  const elStudentCampus = $('#student-filter-campus');
  const elStudentWeekday = $('#student-filter-weekday');
  const elStudentStop = $('#student-filter-stop');
  const elStudentMonthlyTrend = $('#student-monthly-trend');
  const elStudentTeacherSummary = $('#student-teacher-summary');
  const elStudentsMeta = $('#students-meta');
  const elStudentsTable = $('#students-table');
  const elStopsSummary = $('#stops-summary');
  const elStopSearch = $('#stop-search');
  const elStopMonth = $('#stop-filter-month');
  const elStopTeacher = $('#stop-filter-teacher');
  const elStopYear = $('#stop-filter-year');
  const elStopCampus = $('#stop-filter-campus');
  const elStopReset = $('#stop-reset');
  const elStopsMeta = $('#stops-meta');
  const elStopsMonthly = $('#stops-monthly');
  const elStopsTable = $('#stops-table');
  const elMeta = $('#meta');
  const elModalRoot = $('#modal-root');
  const elViewGantt = $('#view-gantt');
  const elViewTeachers = $('#view-teachers');
  const elViewStudents = $('#view-students');
  const elViewStops = $('#view-stops');

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtRatio(r) {
    if (!isFinite(r)) return '∞';
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }

  function fmtHours(h) {
    if (!h) return '0';
    return Number.isInteger(h) ? String(h) : h.toFixed(1);
  }

  function shortBlock(name) {
    if (!name) return '';
    return name.replace(/\s*BLOCK\s*/i, ' ').trim();
  }

  function recordHours(rec) {
    if (rec.startMinutes == null || rec.endMinutes == null) return 0;
    return Math.max(0, (rec.endMinutes - rec.startMinutes) / 60);
  }

  function calculateRatios(rec) {
    const teacherCount = rec.daycareTeachers.length + rec.teachingTeachers.length;
    const manpowerCount = teacherCount + rec.assistants.length + rec.assistantTeachers.length;
    const teacherRatio = teacherCount > 0 ? rec.studentCount / teacherCount : Infinity;
    const manpowerRatio = manpowerCount > 0 ? rec.studentCount / manpowerCount : Infinity;
    return { teacherCount, manpowerCount, teacherRatio, manpowerRatio };
  }

  function getRecordStatus(rec) {
    const tT = state.teacherThreshold;
    const mT = state.manpowerThreshold;
    const r = calculateRatios(rec);
    if (rec.studentCount === 0) {
      return { kind: 'no-student', label: '无学生', detail: '无学生', ...r };
    }
    if (r.manpowerCount === 0) {
      return { kind: 'crisis', label: '危机', detail: '危机：没有任何人手', ...r };
    }
    if (r.teacherCount === 0) {
      return { kind: 'crisis', label: '危机', detail: '危机：没有正式老师', ...r };
    }
    if (r.teacherRatio > tT || r.manpowerRatio > mT) {
      return { kind: 'overloaded', label: '超标', detail: '超标', ...r };
    }
    if (r.teacherRatio >= tT * 0.8 || r.manpowerRatio >= mT * 0.8) {
      return { kind: 'warning', label: '警戒', detail: '警戒', ...r };
    }
    return { kind: 'normal', label: '正常', detail: '正常', ...r };
  }

  function recordHasTeacher(rec, role, teacher) {
    if (!teacher) return true;
    const fields = role
      ? [roleField(rec, role)]
      : [rec.daycareTeachers, rec.teachingTeachers, rec.assistants, rec.assistantTeachers];
    return fields.some((arr) => arr && arr.includes(teacher));
  }

  function roleField(rec, role) {
    const k = ROLE_FIELD[role];
    return k ? rec[k] : [];
  }

  function applyFilters(records) {
    const f = state.filters;
    return records.filter((rec) => {
      if (f.day && rec.day !== f.day) return false;
      if (f.block && rec.block !== f.block) return false;
      if (f.role && f.teacher && !recordHasTeacher(rec, f.role, f.teacher)) return false;
      if (f.role && !f.teacher) {
        if ((roleField(rec, f.role) || []).length === 0) return false;
      }
      if (!f.role && f.teacher && !recordHasTeacher(rec, '', f.teacher)) return false;
      if (f.status) {
        const s = getRecordStatus(rec);
        if (s.kind !== f.status) return false;
      }
      return true;
    });
  }

  function unique(arr) { return Array.from(new Set(arr)); }

  function staffTeachers() {
    return ROLE_KEYS.flatMap((role) => state.staffRoles[role] || []);
  }

  function allTeachers() {
    return unique([
      ...staffTeachers(),
      ...state.records.flatMap((r) => [
        ...r.daycareTeachers, ...r.teachingTeachers, ...r.assistants, ...r.assistantTeachers
      ])
    ]).sort((a, b) => a.localeCompare(b, 'zh'));
  }

  function teacherRoleMap() {
    const map = new Map();
    for (const role of ROLE_KEYS) {
      for (const name of state.staffRoles[role] || []) {
        if (!name) continue;
        const prev = map.get(name);
        if (prev && prev !== role) map.set(name, 'conflict');
        else map.set(name, role);
      }
    }
    for (const rec of state.records) {
      for (const role of ROLE_KEYS) {
        for (const name of rec[ROLE_FIELD[role]] || []) {
          if (!name) continue;
          const prev = map.get(name);
          if (prev && prev !== role) map.set(name, 'conflict');
          else map.set(name, role);
        }
      }
    }
    return map;
  }

  function knownTeacherRole(name) {
    return teacherRoleMap().get(name) || '';
  }

  function allBlocks() {
    return unique(state.records.map((r) => r.block).filter(Boolean)).sort();
  }

  function blockOptions(current) {
    const blocks = allBlocks();
    if (current && !blocks.includes(current)) blocks.push(current);
    return blocks.sort((a, b) => a.localeCompare(b, 'zh'));
  }

  function timeOptions() {
    const out = [];
    for (let m = AXIS_START; m <= AXIS_END; m += 30) {
      out.push({ value: m, label: minutesToClock(m) });
    }
    return out;
  }

  function minutesToClock(total) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function parseDayOption(day) {
    const n = parseInt(day);
    return isFinite(n) && n >= 1 && n <= 7 ? `${n}.${DAY_LABELS[n]}` : (day || '1.MON');
  }

  function populateFilterOptions() {
    const days = unique(state.records.map((r) => r.day).filter(Boolean))
      .sort((a, b) => (parseInt(a) || 99) - (parseInt(b) || 99));
    const blocks = unique(state.records.map((r) => r.block).filter(Boolean)).sort();
    const teachers = allTeachers();

    fillSelect(elDay, days, state.filters.day);
    fillSelect(elBlock, blocks, state.filters.block);
    fillSelect(elTeacher, teachers, state.filters.teacher);
    syncFilterControls();
  }

  function fillSelect(el, options, current) {
    el.innerHTML = '<option value="">全部</option>' +
      options.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    el.value = current && options.includes(current) ? current : '';
  }

  function fillSelectWithAll(el, options, current, allLabel = '全部') {
    if (!el) return;
    el.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` +
      options.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    el.value = current && options.includes(current) ? current : '';
  }

  function syncFilterControls() {
    elDay.value = state.filters.day || '';
    elBlock.value = state.filters.block || '';
    elRole.value = state.filters.role || '';
    elTeacher.value = state.filters.teacher || '';
    elStatus.value = state.filters.status || '';
    elThresholdTeacher.value = String(state.teacherThreshold);
    elThresholdManpower.value = String(state.manpowerThreshold);
  }

  /* ============================================================
     GANTT VIEW
  ============================================================ */

  function renderSummary(filtered) {
    const total = filtered.length;
    let crisis = 0, overloaded = 0, warning = 0, noStudent = 0;
    let maxTeacherRatio = 0, maxManpowerRatio = 0;
    let maxTeacherRecord = null, maxManpowerRecord = null;
    for (const rec of filtered) {
      const s = getRecordStatus(rec);
      if (s.kind === 'crisis') crisis++;
      else if (s.kind === 'overloaded') overloaded++;
      else if (s.kind === 'warning') warning++;
      else if (s.kind === 'no-student') noStudent++;
      if (rec.studentCount > 0) {
        if (isFinite(s.teacherRatio) && s.teacherRatio > maxTeacherRatio) {
          maxTeacherRatio = s.teacherRatio;
          maxTeacherRecord = rec;
        }
        if (isFinite(s.manpowerRatio) && s.manpowerRatio > maxManpowerRatio) {
          maxManpowerRatio = s.manpowerRatio;
          maxManpowerRecord = rec;
        }
      }
    }
    const cards = [
      { label: '总时段数', value: total, cls: '', action: 'status', status: '' },
      { label: '危机时段数', value: crisis, cls: 'crisis', action: 'status', status: 'crisis' },
      { label: '超标时段数', value: overloaded, cls: 'overloaded', action: 'status', status: 'overloaded' },
      { label: '警戒时段数', value: warning, cls: 'warning', action: 'status', status: 'warning' },
      { label: '无学生时段数', value: noStudent, cls: 'no-student', action: 'status', status: 'no-student' },
      { label: '最高老师学生比', value: maxTeacherRatio > 0 ? `${fmtRatio(maxTeacherRatio)}:1` : '—', cls: '', action: 'record', record: maxTeacherRecord },
      { label: '最高人手学生比', value: maxManpowerRatio > 0 ? `${fmtRatio(maxManpowerRatio)}:1` : '—', cls: '', action: 'record', record: maxManpowerRecord }
    ];
    elSummary.innerHTML = cards.map((c, idx) => `
      <div class="card ${c.cls} clickable ${c.action === 'status' && state.filters.status === c.status ? 'active' : ''}"
        data-summary-idx="${idx}" title="${c.action === 'status' ? '点击筛选对应时段' : '点击打开对应时段'}">
        <div class="label">${escapeHtml(c.label)}</div>
        <div class="value">${escapeHtml(String(c.value))}</div>
      </div>
    `).join('');
    elSummary.querySelectorAll('[data-summary-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        const card = cards[parseInt(el.getAttribute('data-summary-idx'))];
        if (!card) return;
        if (card.action === 'status') {
          state.filters.status = card.status;
          elStatus.value = card.status;
          rerender();
        } else if (card.record) {
          openSlotDetail(card.record);
        }
      });
    });
  }

  function buildAxis() {
    const ticks = [];
    for (let m = AXIS_START; m <= AXIS_END; m += 60) {
      const h = Math.floor(m / 60);
      ticks.push(`<div class="tick" style="left: calc(${m - AXIS_START} * var(--minute-w))">${h}:00</div>`);
    }
    return `<div class="axis">${ticks.join('')}</div>`;
  }

  function groupByDayAndBlock(records) {
    const map = new Map();
    for (const rec of records) {
      const dayKey = rec.day || '未指定';
      if (!map.has(dayKey)) map.set(dayKey, new Map());
      const blockMap = map.get(dayKey);
      const blockKey = rec.block || '未指定';
      if (!blockMap.has(blockKey)) blockMap.set(blockKey, []);
      blockMap.get(blockKey).push(rec);
    }
    const days = Array.from(map.entries())
      .sort((a, b) => (parseInt(a[0]) || 99) - (parseInt(b[0]) || 99));
    return days.map(([day, blockMap]) => ({
      day,
      blocks: Array.from(blockMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    }));
  }

  function layoutRecordLanes(records) {
    const lanes = [];
    return records
      .slice()
      .sort((a, b) => ((a.startMinutes ?? 99999) - (b.startMinutes ?? 99999)) || ((a.endMinutes ?? 99999) - (b.endMinutes ?? 99999)))
      .map((rec) => {
        const start = rec.startMinutes ?? 0;
        const end = rec.endMinutes ?? start;
        let lane = lanes.findIndex((laneEnd) => start >= laneEnd);
        if (lane === -1) {
          lane = lanes.length;
          lanes.push(end);
        } else {
          lanes[lane] = end;
        }
        return { rec, lane };
      });
  }

  function renderBar(rec, idx, lane) {
    if (rec.startMinutes == null || rec.endMinutes == null || rec.endMinutes <= rec.startMinutes) return '';
    const start = Math.max(rec.startMinutes, AXIS_START);
    const end = Math.min(rec.endMinutes, AXIS_END);
    if (end <= start) return '';
    const left = start - AXIS_START;
    const width = end - start;
    const status = getRecordStatus(rec);

    const teacherStr = status.teacherCount > 0 ? `T ${fmtRatio(status.teacherRatio)}:1` : 'T 无老师';
    const manpowerStr = status.manpowerCount > 0 ? `M ${fmtRatio(status.manpowerRatio)}:1` : 'M 无人手';
    const block = shortBlock(rec.block) || rec.block;

    return `<div class="bar ${status.kind}" data-idx="${idx}"
      style="left: calc(${left} * var(--minute-w)); width: calc(${width} * var(--minute-w)); top: ${4 + lane * 52}px; bottom: auto; height: 48px;"
      title="${escapeHtml(rec.day)} ${escapeHtml(rec.block)} ${escapeHtml(rec.timeRange)}">
      <div class="b1">${escapeHtml(block)}</div>
      <div class="b2">${escapeHtml(rec.studentCount + '人')}</div>
      <div class="b3">${escapeHtml(teacherStr)} / ${escapeHtml(manpowerStr)}</div>
    </div>`;
  }

  function renderGantt(filtered) {
    if (!filtered.length) {
      elGantt.innerHTML = '<div class="empty-state">没有匹配的记录。</div>';
      return;
    }
    const groups = groupByDayAndBlock(filtered);
    const indexMap = new Map();
    filtered.forEach((rec, i) => indexMap.set(rec, i));

    const labelsHtml = ['<div class="axis-spacer"></div>'];
    const rowsHtml = [];

    for (const grp of groups) {
      const dayLabel = DAY_LABELS[parseInt(grp.day)] || grp.day;
      labelsHtml.push(`<div class="day-header">${escapeHtml(dayLabel)} · ${escapeHtml(grp.day)}</div>`);
      rowsHtml.push('<div class="day-divider"></div>');
      for (const [block, recs] of grp.blocks) {
        const laneItems = layoutRecordLanes(recs);
        const laneCount = Math.max(1, ...laneItems.map((it) => it.lane + 1));
        const rowHeight = Math.max(56, laneCount * 52 + 4);
        labelsHtml.push(`<div class="row-label" style="height:${rowHeight}px">${escapeHtml(shortBlock(block))}</div>`);
        const bars = laneItems.map(({ rec, lane }) => renderBar(rec, indexMap.get(rec), lane)).join('');
        rowsHtml.push(`<div class="row" style="height:${rowHeight}px">${bars}</div>`);
      }
    }

    elGantt.innerHTML = `
      <div class="gantt">
        <div class="gantt-labels">${labelsHtml.join('')}</div>
        <div class="gantt-timeline-wrap">
          <div class="gantt-timeline">
            ${buildAxis()}
            ${rowsHtml.join('')}
          </div>
        </div>
      </div>
    `;

    elGantt.querySelectorAll('.bar').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-idx'));
        if (!isNaN(idx) && filtered[idx]) openSlotDetail(filtered[idx]);
      });
    });
  }

  /* ============================================================
     TEACHERS VIEW
  ============================================================ */

  function computeTeacherStats(records) {
    const map = new Map();
    const activeRole = state.filters.role || '';

    for (const role of ROLE_KEYS) {
      if (activeRole && role !== activeRole) continue;
      for (const name of state.staffRoles[role] || []) {
        if (!name || map.has(name)) continue;
        map.set(name, {
          name,
          role,
          roles: new Set([role]),
          slots: 0,
          hours: 0,
          studentHours: 0,
          sharedStudentHours: 0,
          byDay: {},
          records: [],
          rosterOnly: true
        });
      }
    }

    for (const rec of records) {
      const hours = recordHours(rec);
      if (hours <= 0) continue;
      const totalManpower = ROLE_KEYS.reduce(
        (sum, k) => sum + (rec[ROLE_FIELD[k]] || []).length, 0);
      const sharePerPerson = totalManpower > 0 ? rec.studentCount / totalManpower : 0;

      for (const role of activeRole ? [activeRole] : ROLE_KEYS) {
        const list = rec[ROLE_FIELD[role]] || [];
        for (const name of list) {
          if (!map.has(name)) {
            map.set(name, {
              name,
              role,
              roles: new Set([role]),
              slots: 0,
              hours: 0,
              studentHours: 0,
              sharedStudentHours: 0,
              byDay: {},
              records: [],
              rosterOnly: false
            });
          }
          const s = map.get(name);
          s.roles.add(role);
          s.rosterOnly = false;
          s.slots += 1;
          s.hours += hours;
          s.studentHours += rec.studentCount * hours;
          s.sharedStudentHours += sharePerPerson * hours;
          s.byDay[rec.dayOrder] = (s.byDay[rec.dayOrder] || 0) + hours;
          s.records.push(rec);
        }
      }
    }
    const out = [];
    for (const s of map.values()) {
      out.push({
        ...s,
        rolesArr: Array.from(s.roles),
        avgStudents: s.hours > 0 ? s.studentHours / s.hours : 0
      });
    }
    return out;
  }

  function sortTeacherStats(list) {
    const { key, dir } = state.teacherSort;
    const factor = dir === 'desc' ? -1 : 1;
    return list.slice().sort((a, b) => {
      let cmp;
      if (key === 'name') cmp = a.name.localeCompare(b.name, 'zh');
      else if (key === 'role') cmp = a.role.localeCompare(b.role);
      else cmp = (a[key] || 0) - (b[key] || 0);
      return cmp * factor;
    });
  }

  function renderTeachersSummary(stats, filtered) {
    const totalTeachers = stats.length;
    const totalHours = stats.reduce((s, t) => s + t.hours, 0);
    const totalSlots = filtered.length;
    const avgHours = totalTeachers > 0 ? totalHours / totalTeachers : 0;

    const byRole = { daycare: 0, teaching: 0, assistant: 0, assistantTeacher: 0 };
    for (const t of stats) byRole[t.role] = (byRole[t.role] || 0) + 1;

    const roleCards = state.filters.role
      ? [{ label: `${ROLE_LABEL[state.filters.role]} 人数`, value: byRole[state.filters.role], cls: '' }]
      : [
        { label: 'DAYCARE 老师', value: byRole.daycare, cls: '' },
        { label: '教书老师', value: byRole.teaching, cls: '' },
        { label: '助理', value: byRole.assistant, cls: '' },
        { label: '助教', value: byRole.assistantTeacher, cls: '' }
      ];

    const cards = [
      { label: '老师总数', value: totalTeachers, cls: '' },
      ...roleCards,
      { label: '总工时', value: `${fmtHours(totalHours)}h`, cls: '' },
      { label: '人均工时', value: `${fmtHours(avgHours)}h`, cls: '' },
      { label: '总时段数', value: totalSlots, cls: '' }
    ];
    elTeachersSummary.innerHTML = cards.map((c) => `
      <div class="card ${c.cls}">
        <div class="label">${escapeHtml(c.label)}</div>
        <div class="value">${escapeHtml(String(c.value))}</div>
      </div>
    `).join('');
  }

  function setRoleFilter(role, teacherView) {
    state.filters.role = role || '';
    state.filters.teacher = '';
    if (teacherView) state.teacherView = teacherView;
    syncFilterControls();
    rerender();
  }

  function renderRoleWorkload(stats) {
    const byRole = Object.fromEntries(ROLE_KEYS.map((role) => [role, []]));
    for (const t of stats) {
      if (!byRole[t.role]) byRole[t.role] = [];
      byRole[t.role].push(t);
    }

    const rolesToShow = state.filters.role ? [state.filters.role] : ROLE_KEYS;
    const cards = rolesToShow.map((role) => {
      const list = byRole[role] || [];
      const total = list.length;
      const assigned = list.filter((t) => t.hours > 0).length;
      const unassigned = list.filter((t) => t.hours <= 0);
      const totalHours = list.reduce((sum, t) => sum + t.hours, 0);
      const avgHours = total ? totalHours / total : 0;
      const maxHours = Math.max(0, ...list.map((t) => t.hours));
      const minAssignedHours = Math.min(...list.filter((t) => t.hours > 0).map((t) => t.hours));
      const minText = isFinite(minAssignedHours) ? `${fmtHours(minAssignedHours)}h` : '0h';
      const names = unassigned.map((t) => `
        <button type="button" data-role-person="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>
      `).join('');
      return `
        <div class="role-workload-card ${state.filters.role === role ? 'active' : ''}" data-role-card="${role}">
          <div class="role-title">
            <strong><span class="role-pill ${role}">${escapeHtml(ROLE_LABEL[role])}</span></strong>
            <span class="role-total">${assigned}/${total} 已排班</span>
          </div>
          <div class="role-metrics">
            <div class="metric"><span>总工时</span><b>${escapeHtml(fmtHours(totalHours))}h</b></div>
            <div class="metric"><span>人均工时</span><b>${escapeHtml(fmtHours(avgHours))}h</b></div>
            <div class="metric"><span>最高工时</span><b>${escapeHtml(fmtHours(maxHours))}h</b></div>
            <div class="metric"><span>最低已排</span><b>${escapeHtml(minText)}</b></div>
          </div>
          ${unassigned.length ? `
            <details class="unassigned-list">
              <summary>未排班：${unassigned.length} 人</summary>
              <div>${names}</div>
            </details>
          ` : '<div class="unassigned-collapsed">未排班：无</div>'}
          <div class="role-card-actions">
            <button type="button" data-role-action="${role}" data-target-view="ranking">排行</button>
            <button type="button" data-role-action="${role}" data-target-view="schedule">时间表</button>
          </div>
        </div>
      `;
    }).join('');

    elRoleWorkload.innerHTML = `<div class="role-workload-grid">${cards}</div>`;
    elRoleWorkload.querySelectorAll('[data-role-card]').forEach((card) => {
      card.addEventListener('click', () => openRoleDetail(card.getAttribute('data-role-card'), stats));
    });
    elRoleWorkload.querySelectorAll('[data-role-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setRoleFilter(btn.getAttribute('data-role-action'), btn.getAttribute('data-target-view'));
      });
    });
    elRoleWorkload.querySelectorAll('.unassigned-list').forEach((details) => {
      details.addEventListener('click', (e) => e.stopPropagation());
    });
    elRoleWorkload.querySelectorAll('[data-role-person]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTeacherDetail(btn.getAttribute('data-role-person'), stats);
      });
    });
  }

  function openRoleDetail(role, stats) {
    const list = stats.filter((t) => t.role === role);
    const assigned = list.filter((t) => t.hours > 0).sort((a, b) => b.hours - a.hours);
    const unassigned = list.filter((t) => t.hours <= 0).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    const totalHours = list.reduce((sum, t) => sum + t.hours, 0);
    const avgHours = list.length ? totalHours / list.length : 0;

    const personRow = (t) => `
      <div class="role-modal-person">
        <div class="main">
          <span class="name">${escapeHtml(t.name)}</span>
          <span class="hours">${escapeHtml(fmtHours(t.hours))}h</span>
        </div>
        <div class="tools">
          <button type="button" data-role-modal-person="${escapeHtml(t.name)}">查看</button>
        </div>
      </div>
    `;

    state.modalOpen = true;
    elModalRoot.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal wide" role="dialog" aria-modal="true">
          <h2><span class="role-pill ${role}">${escapeHtml(ROLE_LABEL[role])}</span> 工作量详情</h2>
          <div class="role-modal-grid">
            <div class="role-modal-metric"><span>总人数</span><b>${list.length}</b></div>
            <div class="role-modal-metric"><span>已排班</span><b>${assigned.length}</b></div>
            <div class="role-modal-metric"><span>总工时</span><b>${escapeHtml(fmtHours(totalHours))}h</b></div>
            <div class="role-modal-metric"><span>人均工时</span><b>${escapeHtml(fmtHours(avgHours))}h</b></div>
          </div>
          <div class="role-modal-columns">
            <div class="role-modal-list">
              <h3>工时最高</h3>
              ${assigned.slice(0, 8).map(personRow).join('') || '<div class="empty-state">无已排班人员</div>'}
            </div>
            <div class="role-modal-list">
              <h3>未排班（${unassigned.length}）</h3>
              ${unassigned.map(personRow).join('') || '<div class="empty-state">无未排班人员</div>'}
            </div>
          </div>
          <div class="actions split">
            <button type="button" class="primary" data-create-staff-role="${role}">新增人手</button>
            <div class="right">
              <button type="button" data-role-modal-view="ranking" data-role="${role}">看排行</button>
              <button type="button" data-role-modal-view="schedule" data-role="${role}">看时间表</button>
              <button id="modal-close" type="button">关闭</button>
            </div>
          </div>
        </div>
      </div>
    `;
    bindModalCommon();
    elModalRoot.querySelectorAll('[data-role-modal-person]').forEach((btn) => {
      btn.addEventListener('click', () => openTeacherDetail(btn.getAttribute('data-role-modal-person'), stats));
    });
    elModalRoot.querySelectorAll('[data-create-staff-role]').forEach((btn) => {
      btn.addEventListener('click', () => openCreateStaffModal(btn.getAttribute('data-create-staff-role')));
    });
    elModalRoot.querySelectorAll('[data-role-modal-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeModal();
        setRoleFilter(btn.getAttribute('data-role'), btn.getAttribute('data-role-modal-view'));
      });
    });
  }

  function openCreateStaffModal(role) {
    const selectedRole = role || state.filters.role || 'daycare';
    state.modalOpen = true;
    elModalRoot.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <h2>新增人手</h2>
          <form class="edit-form" id="create-staff-form">
            <div class="tag-field">
              <div class="tag-field-title">角色</div>
              <select name="role">
                ${ROLE_KEYS.map((key) => `<option value="${key}" ${key === selectedRole ? 'selected' : ''}>${escapeHtml(ROLE_LABEL[key])}</option>`).join('')}
              </select>
            </div>
            <label>姓名
              <input name="name" type="text" autocomplete="off" placeholder="输入新老师 / 助理名字" required />
            </label>
            <div class="form-error" id="form-error"></div>
            <div class="actions split">
              <button type="button" id="modal-close">取消</button>
              <div class="right">
                <button type="submit" class="primary">加入名单</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    `;
    bindModalCommon();
    const form = document.getElementById('create-staff-form');
    form.elements.name.focus();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveCreateStaff(form.elements.role.value, form.elements.name.value);
    });
  }

  async function saveCreateStaff(role, rawName) {
    const name = (rawName || '').trim();
    if (!name) {
      showFormError('姓名不能为空');
      return;
    }
    try {
      showFormError('');
      setFormBusy(true);
      await postJson('/api/create-staff', { role, name });
      closeModal();
      state.lastPayloadHash = '';
      await loadSchedule(false);
    } catch (err) {
      setFormBusy(false);
      showFormError(err.message);
    }
  }

  function renderTeacherFilterContext() {
    const bits = [
      state.filters.role ? ROLE_LABEL[state.filters.role] : '全部角色',
      state.filters.teacher || '全部老师',
      state.filters.day || '全部星期',
      state.filters.block || '全部 BLOCK'
    ];
    elTeacherFilterContext.innerHTML = `当前查看：<b>${bits.map(escapeHtml).join(' · ')}</b>`;
  }

  function syncTeacherViewControls() {
    document.querySelectorAll('[data-teacher-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-teacher-panel') !== state.teacherView;
    });
    if (!elTeacherSubtabs) return;
    elTeacherSubtabs.querySelectorAll('[data-teacher-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-teacher-view') === state.teacherView);
    });
  }

  function renderTeachersTable(stats) {
    const sorted = sortTeacherStats(stats);
    const maxHours = Math.max(1, ...sorted.map((t) => t.hours));

    const cols = [
      { key: 'name',               label: '老师',     align: 'left',  fmt: (t) => `<span class="teacher-link">${escapeHtml(t.name)}</span>` },
      { key: 'role',               label: '角色',     align: 'left',  fmt: (t) => `<span class="role-pill ${t.role}">${escapeHtml(ROLE_LABEL[t.role])}</span>` },
      { key: 'slots',              label: '时段数',   align: 'right', fmt: (t) => String(t.slots) },
      { key: 'hours',              label: '总工时(h)', align: 'right', fmt: (t) => fmtHours(t.hours) },
      { key: 'avgStudents',        label: '平均带生', align: 'right', fmt: (t) => fmtRatio(t.avgStudents) },
      { key: 'sharedStudentHours', label: '生·时(分摊)', align: 'right', fmt: (t) => fmtRatio(t.sharedStudentHours) },
      { key: 'studentHours',       label: '生·时(总)',   align: 'right', fmt: (t) => fmtRatio(t.studentHours) }
    ];

    const head = `<tr>${cols.map((c) => {
      const isSorted = state.teacherSort.key === c.key;
      const arrow = isSorted ? (state.teacherSort.dir === 'desc' ? '▼' : '▲') : '';
      return `<th data-sort="${c.key}" class="${isSorted ? 'sorted' : ''}" style="text-align:${c.align}">${escapeHtml(c.label)}<span class="arrow">${arrow}</span></th>`;
    }).join('')}<th>工时占比</th></tr>`;

    const body = sorted.map((t) => {
      const pct = (t.hours / maxHours) * 100;
      const cells = cols.map((c) => {
        const cls = c.align === 'right' ? 'num' : '';
        return `<td class="${cls}">${c.fmt(t)}</td>`;
      }).join('');
      return `<tr data-name="${escapeHtml(t.name)}" class="${t.hours <= 0 ? 'zero-hours' : ''}">${cells}<td class="bar-cell"><div class="hbar"><span style="width:${pct.toFixed(1)}%; background: var(--role-${t.role})"></span></div></td></tr>`;
    }).join('');

    elTeachersTable.querySelector('thead').innerHTML = head;
    elTeachersTable.querySelector('tbody').innerHTML = body
      || '<tr><td colspan="8" class="empty-state">没有匹配的老师。</td></tr>';

    elTeachersTable.querySelectorAll('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort');
        if (state.teacherSort.key === key) {
          state.teacherSort.dir = state.teacherSort.dir === 'desc' ? 'asc' : 'desc';
        } else {
          state.teacherSort.key = key;
          state.teacherSort.dir = (key === 'name' || key === 'role') ? 'asc' : 'desc';
        }
        renderTeachersTable(stats);
      });
    });

    elTeachersTable.querySelectorAll('tbody tr[data-name]').forEach((tr) => {
      tr.addEventListener('click', () => openTeacherDetail(tr.getAttribute('data-name'), stats));
    });
  }

  function renderTeachersHeatmap(stats) {
    const sorted = sortTeacherStats(stats);
    const maxDayHours = Math.max(1, ...sorted.flatMap((t) => Object.values(t.byDay)));

    const headerCells = ['<div class="cell head">老师</div>']
      .concat([1,2,3,4,5,6,7].map((d) => `<div class="cell head">${DAY_LABELS[d]}</div>`))
      .concat(['<div class="cell head">总工时</div>']);

    const rows = sorted.map((t) => {
      const cells = [`<div class="cell name" data-name="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>`];
      for (let d = 1; d <= 7; d++) {
        const h = t.byDay[d] || 0;
        const intensity = h > 0 ? Math.min(0.95, 0.15 + 0.85 * (h / maxDayHours)) : 0;
        const bg = h > 0
          ? `background: rgba(56,189,248,${intensity.toFixed(2)})`
          : 'background: var(--panel-2); color: var(--muted)';
        cells.push(`<div class="cell" style="${bg}">${h > 0 ? fmtHours(h) + 'h' : '·'}</div>`);
      }
      cells.push(`<div class="cell total">${fmtHours(t.hours)}h</div>`);
      return cells.join('');
    }).join('');

    elTeachersHeatmap.innerHTML = `<div class="heatmap">${headerCells.join('')}${rows}</div>`;

    elTeachersHeatmap.querySelectorAll('.cell.name').forEach((el) => {
      el.addEventListener('click', () => openTeacherDetail(el.getAttribute('data-name'), stats));
    });
  }

  function blockClass(block) {
    const text = (block || '').toUpperCase();
    if (text.includes('HM')) return 'block-hm';
    if (text.includes('PU')) return 'block-pu';
    if (text.includes('SUBANG')) return 'block-subang';
    return 'block-other';
  }

  function blockScheduleLabel(block) {
    const text = (block || '').trim();
    if (/HM/i.test(text)) return 'HM';
    if (/PU/i.test(text)) return 'PU';
    if (/SUBANG/i.test(text)) return 'SUBANG';
    return shortBlock(text) || text || '-';
  }

  function renderTeachersWeeklySchedule(stats) {
    const sorted = sortTeacherStats(stats);
    const headers = ['<div class="weekly-cell weekly-head">老师</div>']
      .concat([1,2,3,4,5,6,7].map((d) => `<div class="weekly-cell weekly-head">${DAY_CN[d]}</div>`));

    const rows = sorted.map((t) => {
      const first = `
        <div class="weekly-cell weekly-teacher" data-name="${escapeHtml(t.name)}">
          <div class="name">${escapeHtml(t.name)}</div>
          <div class="hours">周总工时: ${escapeHtml(fmtHours(t.hours))}h</div>
        </div>
      `;
      const days = [1,2,3,4,5,6,7].map((d) => {
        const recs = t.records
          .filter((r) => r.dayOrder === d)
          .slice()
          .sort((a, b) => (a.startMinutes || 0) - (b.startMinutes || 0));
        const slots = recs.map((rec) => `
          <button type="button" class="weekly-slot ${blockClass(rec.block)}" data-record-id="${escapeHtml(rec.recordId)}">
            ${escapeHtml(blockScheduleLabel(rec.block))}
            <span class="time">${escapeHtml(rec.timeRange || '-')} (${escapeHtml(fmtHours(recordHours(rec)))}h)</span>
          </button>
        `).join('');
        const dayTotal = recs.reduce((sum, rec) => sum + recordHours(rec), 0);
        const total = dayTotal > 0 ? `<div class="weekly-day-total">当天: ${escapeHtml(fmtHours(dayTotal))}h</div>` : '';
        return `<div class="weekly-cell">${slots}${total}</div>`;
      }).join('');
      return first + days;
    }).join('');

    elTeachersWeeklySchedule.innerHTML = `<div class="weekly-schedule">${headers.join('')}${rows || '<div class="weekly-cell">没有匹配的老师。</div>'}</div>`;
    elTeachersWeeklySchedule.querySelectorAll('[data-record-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rec = state.records.find((r) => r.recordId === btn.getAttribute('data-record-id'));
        if (rec) openSlotDetail(rec);
      });
    });
    elTeachersWeeklySchedule.querySelectorAll('.weekly-teacher[data-name]').forEach((el) => {
      el.addEventListener('click', () => openTeacherDetail(el.getAttribute('data-name'), stats));
    });
  }

  function renderTeachersView(filtered) {
    const stats = computeTeacherStats(filtered);
    renderTeachersSummary(stats, filtered);
    renderTeacherFilterContext();
    syncTeacherViewControls();
    renderRoleWorkload(stats);
    renderTeachersTable(stats);
    renderTeachersHeatmap(stats);
    renderTeachersWeeklySchedule(stats);
  }

  /* ============================================================
     STUDENTS VIEW
  ============================================================ */

  function studentValue(rec, field) {
    return String((rec.fields || {})[field] || '').trim();
  }

  function studentWeekdays(rec) {
    return STUDENT_WEEKDAYS
      .filter((day) => studentValue(rec, day.key))
      .map((day) => day.label);
  }

  function isStoppedStudent(rec) {
    return Boolean(studentValue(rec, STUDENT_FIELDS.stopMonth));
  }

  function studentMonthStatuses(rec) {
    return STUDENT_MONTHS
      .map((month) => ({ month, value: studentValue(rec, month) }))
      .filter((item) => item.value);
  }

  function shortMonth(month) {
    return month.replace(/^\d+\.\s*/, '');
  }

  function stopMonthLabel(rec) {
    const stoppedMonths = studentMonthStatuses(rec)
      .filter((item) => item.value.toUpperCase() === 'STOP')
      .map((item) => shortMonth(item.month));
    if (stoppedMonths.length) return stoppedMonths.join(', ');
    return isStoppedStudent(rec) ? '已停止' : '';
  }

  function incrementCount(map, key) {
    const clean = key || '未填';
    map.set(clean, (map.get(clean) || 0) + 1);
  }

  function topCountLabel(map) {
    const items = Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
    return items.slice(0, 3).map(([key, count]) => `${key} ${count}`).join('、') || '-';
  }

  function countMap(records, field, fallback = '未填') {
    const map = new Map();
    for (const rec of records) incrementCount(map, studentValue(rec, field) || fallback);
    return map;
  }

  function countByYearGroups(records) {
    const primary = records.filter((rec) => PRIMARY_YEARS.includes(normalizedStudentYear(rec))).length;
    const secondary = records.filter((rec) => SECONDARY_YEARS.includes(normalizedStudentYear(rec))).length;
    return { primary, secondary };
  }

  function computeStudentTeacherSummary(list) {
    const map = new Map();
    for (const rec of list) {
      const teacher = studentValue(rec, STUDENT_FIELDS.teacher) || '未填负责老师';
      if (!map.has(teacher)) {
        map.set(teacher, {
          teacher,
          total: 0,
          active: 0,
          stopped: 0,
          noWeekday: 0,
          years: new Map(),
          campuses: new Map(),
          times: new Map(),
          weekdays: new Map()
        });
      }
      const stat = map.get(teacher);
      stat.total++;
      if (isStoppedStudent(rec)) stat.stopped++;
      else stat.active++;
      if (!studentWeekdays(rec).length) stat.noWeekday++;
      incrementCount(stat.years, studentValue(rec, STUDENT_FIELDS.year));
      incrementCount(stat.campuses, studentValue(rec, STUDENT_FIELDS.campus));
      incrementCount(stat.times, studentValue(rec, STUDENT_FIELDS.time));
      for (const day of studentWeekdays(rec)) incrementCount(stat.weekdays, day);
    }
    return Array.from(map.values()).sort((a, b) =>
      b.active - a.active || b.total - a.total || a.teacher.localeCompare(b.teacher, 'zh')
    );
  }

  function studentMonthValue(rec, month) {
    return studentValue(rec, month).toUpperCase();
  }

  function normalizedStudentYear(rec) {
    return studentValue(rec, STUDENT_FIELDS.year).toUpperCase();
  }

  function activeStudentMonths(list) {
    const rows = STUDENT_MONTHS.map((month) => {
      const active = list.filter((rec) => studentMonthValue(rec, month) === 'ACTIVE').length;
      const stopped = list.filter((rec) => studentMonthValue(rec, month) === 'STOP').length;
      const archived = list.filter((rec) => studentMonthValue(rec, month) === 'ARCHIVED').length;
      return { month, label: shortMonth(month), active, stopped, archived };
    });
    const visible = rows.filter((row) => row.active || row.stopped || row.archived);
    return visible.map((row, idx) => ({
      ...row,
      delta: idx === 0 ? null : row.active - visible[idx - 1].active,
      gained: idx === 0 ? null : list.filter((rec) =>
        studentMonthValue(rec, visible[idx - 1].month) !== 'ACTIVE' &&
        studentMonthValue(rec, row.month) === 'ACTIVE'
      ).length,
      lost: idx === 0 ? null : list.filter((rec) =>
        studentMonthValue(rec, visible[idx - 1].month) === 'ACTIVE' &&
        studentMonthValue(rec, row.month) !== 'ACTIVE'
      ).length
    }));
  }

  function monthlyTrendRow(group, records, months) {
    const counts = months.map((m) => records.filter((rec) => studentMonthValue(rec, m.month) === 'ACTIVE').length);
    const gained = months.map((m, idx) => idx === 0 ? null : records.filter((rec) =>
      studentMonthValue(rec, months[idx - 1].month) !== 'ACTIVE' &&
      studentMonthValue(rec, m.month) === 'ACTIVE'
    ).length);
    const lost = months.map((m, idx) => idx === 0 ? null : records.filter((rec) =>
      studentMonthValue(rec, months[idx - 1].month) === 'ACTIVE' &&
      studentMonthValue(rec, m.month) !== 'ACTIVE'
    ).length);
    const latest = counts.length ? counts[counts.length - 1] : 0;
    const first = counts.length ? counts[0] : 0;
    return { group, counts, gained, lost, latest, change: latest - first };
  }

  function lostStudentsForMonth(records, months, idx) {
    if (idx <= 0 || !months[idx - 1] || !months[idx]) return [];
    const prevMonth = months[idx - 1].month;
    const month = months[idx].month;
    return records.filter((rec) =>
      studentMonthValue(rec, prevMonth) === 'ACTIVE' &&
      studentMonthValue(rec, month) !== 'ACTIVE'
    );
  }

  function recordsForGroup(records, label, group) {
    if (label === '负责老师') {
      return records.filter((rec) => (studentValue(rec, STUDENT_FIELDS.teacher) || '未填负责老师') === group);
    }
    if (label === '分院') {
      return records.filter((rec) => (studentValue(rec, STUDENT_FIELDS.campus) || '未填分院') === group);
    }
    if (label === '年级') {
      if (group === '总小学人数') return records.filter((rec) => PRIMARY_YEARS.includes(normalizedStudentYear(rec)));
      if (group === '总中学人数') return records.filter((rec) => SECONDARY_YEARS.includes(normalizedStudentYear(rec)));
      return records.filter((rec) => normalizedStudentYear(rec) === group);
    }
    return records;
  }

  function pctText(count, total) {
    if (count === null || count === undefined) return '-';
    if (!total) return `${count} (0%)`;
    return `${count} (${((count / total) * 100).toFixed(1)}%)`;
  }

  function stopListButton(count, attrs, total) {
    if (count === null || count === undefined) return '-';
    const attrText = Object.entries(attrs)
      .map(([key, value]) => {
        const attr = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        return `data-${attr}="${escapeHtml(String(value))}"`;
      })
      .join(' ');
    return `<button class="trend-stop-link" type="button" ${attrText}>${escapeHtml(pctText(count, total))}</button>`;
  }

  function monthlyTrendByGroup(list, months, field, fallback) {
    const groups = unique(list.map((rec) => studentValue(rec, field) || fallback))
      .sort((a, b) => a.localeCompare(b, 'zh'));
    return groups.map((group) => {
      const records = list.filter((rec) => (studentValue(rec, field) || fallback) === group);
      return monthlyTrendRow(group, records, months);
    }).sort((a, b) => b.latest - a.latest || b.change - a.change || a.group.localeCompare(b.group, 'zh'));
  }

  function monthlyTrendByYear(list, months) {
    const primaryRecords = list.filter((rec) => PRIMARY_YEARS.includes(normalizedStudentYear(rec)));
    const secondaryRecords = list.filter((rec) => SECONDARY_YEARS.includes(normalizedStudentYear(rec)));
    const rows = [
      monthlyTrendRow('总小学人数', primaryRecords, months),
      ...PRIMARY_YEARS.map((year) => monthlyTrendRow(year, list.filter((rec) => normalizedStudentYear(rec) === year), months)),
      monthlyTrendRow('总中学人数', secondaryRecords, months),
      ...SECONDARY_YEARS.map((year) => monthlyTrendRow(year, list.filter((rec) => normalizedStudentYear(rec) === year), months))
    ];
    const known = new Set(FIXED_YEAR_ORDER);
    const otherYears = unique(list.map(normalizedStudentYear).filter((year) => year && !known.has(year)))
      .sort((a, b) => a.localeCompare(b, 'zh'));
    return [
      ...rows,
      ...otherYears.map((year) => monthlyTrendRow(year, list.filter((rec) => normalizedStudentYear(rec) === year), months))
    ];
  }

  function deltaText(delta) {
    if (delta === null || delta === undefined) return '-';
    if (delta > 0) return `+${delta}`;
    return String(delta);
  }

  function deltaClass(delta) {
    if (delta > 0) return 'up';
    if (delta < 0) return 'down';
    return 'flat';
  }

  function renderStudentFilterOptions() {
    const values = (field) => unique(state.students.map((rec) => studentValue(rec, field)).filter(Boolean))
      .sort((a, b) => a.localeCompare(b, 'zh'));
    const years = unique([
      PRIMARY_YEAR_FILTER,
      ...PRIMARY_YEARS,
      SECONDARY_YEAR_FILTER,
      ...SECONDARY_YEARS,
      ...values(STUDENT_FIELDS.year).map((year) => year.toUpperCase()).filter((year) => !FIXED_YEAR_ORDER.includes(year))
    ]);
    fillSelectWithAll(elStudentYear, years, state.studentFilters.year, '全部年级');
    fillSelectWithAll(elStudentTeacher, values(STUDENT_FIELDS.teacher), state.studentFilters.teacher, '全部老师');
    fillSelectWithAll(elStudentTime, values(STUDENT_FIELDS.time), state.studentFilters.time, '全部时间段');
    fillSelectWithAll(elStudentCampus, values(STUDENT_FIELDS.campus), state.studentFilters.campus, '全部分院');
  }

  function filteredStudents() {
    const q = state.studentSearch.trim().toLowerCase();
    const f = state.studentFilters;
    return state.students.filter((rec) => {
      if (q && !Object.values(rec.fields || {}).some((value) => String(value || '').toLowerCase().includes(q))) return false;
      if (f.year === PRIMARY_YEAR_FILTER && !PRIMARY_YEARS.includes(normalizedStudentYear(rec))) return false;
      if (f.year === SECONDARY_YEAR_FILTER && !SECONDARY_YEARS.includes(normalizedStudentYear(rec))) return false;
      if (f.year && f.year !== PRIMARY_YEAR_FILTER && f.year !== SECONDARY_YEAR_FILTER && normalizedStudentYear(rec) !== f.year) return false;
      if (f.teacher && studentValue(rec, STUDENT_FIELDS.teacher) !== f.teacher) return false;
      if (f.time && studentValue(rec, STUDENT_FIELDS.time) !== f.time) return false;
      if (f.campus && studentValue(rec, STUDENT_FIELDS.campus) !== f.campus) return false;
      if (f.weekday && !studentValue(rec, f.weekday)) return false;
      if (f.stop === 'active' && isStoppedStudent(rec)) return false;
      if (f.stop === 'stopped' && !isStoppedStudent(rec)) return false;
      return true;
    });
  }

  function renderStudentsSummary(list) {
    const stopped = state.students.filter(isStoppedStudent).length;
    const active = state.students.length - stopped;
    const noTeacher = state.students.filter((rec) => !studentValue(rec, STUDENT_FIELDS.teacher)).length;
    const cards = [
      { label: '学生总数', value: state.students.length },
      { label: '目前显示', value: list.length },
      { label: '活跃学生', value: active },
      { label: '已停止', value: stopped },
      { label: '未填负责老师', value: noTeacher },
      { label: '更新时间', value: state.studentUpdatedAt || '-' }
    ];
    elStudentsSummary.innerHTML = cards.map((c) => `
      <div class="card">
        <div class="label">${escapeHtml(c.label)}</div>
        <div class="value">${escapeHtml(String(c.value))}</div>
      </div>
    `).join('');
  }

  function renderStudentsTable(list) {
    if (!state.students.length) {
      elStudentsTable.querySelector('thead').innerHTML = '';
      elStudentsTable.querySelector('tbody').innerHTML = '<tr><td class="empty-state">没有学生记录。</td></tr>';
      return;
    }
    elStudentsTable.querySelector('thead').innerHTML = `
      <tr>
        <th>NO</th>
        <th>学生</th>
        <th>年级</th>
        <th>负责老师</th>
        <th>时间段</th>
        <th>分院</th>
        <th>星期</th>
        <th>月份状态</th>
        <th>状态</th>
        <th>备注</th>
      </tr>
    `;
    elStudentsTable.querySelector('tbody').innerHTML = list.map((rec) => `
      <tr>
        <td class="num">${escapeHtml(studentValue(rec, STUDENT_FIELDS.no))}</td>
        <td><strong class="student-name">${escapeHtml(studentValue(rec, STUDENT_FIELDS.name) || '-')}</strong></td>
        <td>${escapeHtml(studentValue(rec, STUDENT_FIELDS.year) || '-')}</td>
        <td>${escapeHtml(studentValue(rec, STUDENT_FIELDS.teacher) || '-')}</td>
        <td>${escapeHtml(studentValue(rec, STUDENT_FIELDS.time) || '-')}</td>
        <td>${escapeHtml(studentValue(rec, STUDENT_FIELDS.campus) || '-')}</td>
        <td>
          <div class="student-day-badges">
            ${studentWeekdays(rec).map((day) => `<span>${escapeHtml(day)}</span>`).join('') || '<em>-</em>'}
          </div>
        </td>
        <td>
          <div class="student-month-badges">
            ${studentMonthStatuses(rec).map((item) => `
              <span class="${escapeHtml(item.value.toLowerCase())}" title="${escapeHtml(item.month)}">${escapeHtml(shortMonth(item.month))}</span>
            `).join('') || '<em>-</em>'}
          </div>
        </td>
        <td>${isStoppedStudent(rec)
          ? `<span class="student-status stopped">Stop ${escapeHtml(stopMonthLabel(rec))}</span>`
          : '<span class="student-status active">Active</span>'}
        </td>
        <td class="student-note">${escapeHtml(studentValue(rec, STUDENT_FIELDS.note) || '-')}</td>
      </tr>
    `).join('') || '<tr><td colspan="10" class="empty-state">没有匹配的学生。</td></tr>';
  }

  function renderStudentTeacherSummary(list) {
    if (!elStudentTeacherSummary) return;
    const stats = computeStudentTeacherSummary(list);
    if (!stats.length) {
      elStudentTeacherSummary.innerHTML = '<div class="empty-state">没有老师总结。</div>';
      return;
    }
    elStudentTeacherSummary.innerHTML = `
      <div class="student-teacher-grid">
        ${stats.map((s) => `
          <button class="student-teacher-card" type="button" data-student-teacher="${escapeHtml(s.teacher === '未填负责老师' ? '' : s.teacher)}">
            <div class="student-teacher-head">
              <strong>${escapeHtml(s.teacher)}</strong>
              <span>${escapeHtml(String(s.total))} 人</span>
            </div>
            <div class="student-teacher-metrics">
              <span>Active <b>${escapeHtml(String(s.active))}</b></span>
              <span>Stop <b>${escapeHtml(pctText(s.stopped, s.total))}</b></span>
              <span>无星期 <b>${escapeHtml(String(s.noWeekday))}</b></span>
            </div>
            <dl>
              <dt>年级</dt><dd>${escapeHtml(topCountLabel(s.years))}</dd>
              <dt>分院</dt><dd>${escapeHtml(topCountLabel(s.campuses))}</dd>
              <dt>时间</dt><dd>${escapeHtml(topCountLabel(s.times))}</dd>
              <dt>星期</dt><dd>${escapeHtml(topCountLabel(s.weekdays))}</dd>
            </dl>
          </button>
        `).join('')}
      </div>
    `;
    elStudentTeacherSummary.querySelectorAll('[data-student-teacher]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openStudentTeacherAnalysis(btn.getAttribute('data-student-teacher') || '');
      });
    });
  }

  function openStudentTeacherAnalysis(teacher) {
    const teacherName = teacher || '未填负责老师';
    const records = state.students.filter((rec) => (studentValue(rec, STUDENT_FIELDS.teacher) || '未填负责老师') === teacherName);
    if (!records.length) return;
    const months = activeStudentMonths(records);
    const active = records.filter((rec) => !isStoppedStudent(rec)).length;
    const stopped = records.length - active;
    const noWeekday = records.filter((rec) => !studentWeekdays(rec).length).length;
    const noTime = records.filter((rec) => !studentValue(rec, STUDENT_FIELDS.time)).length;
    const noYear = records.filter((rec) => !studentValue(rec, STUDENT_FIELDS.year)).length;
    const noMonthStatus = records.filter((rec) => !studentMonthStatuses(rec).length).length;
    const yearGroups = countByYearGroups(records);
    const yearRows = monthlyTrendByYear(records, months);
    const campusRows = monthlyTrendByGroup(records, months, STUDENT_FIELDS.campus, '未填分院');
    const monthHtml = months.length ? `
      <div class="student-trend-wrap">
        <table class="student-trend-table teacher-trend">
          <thead>
            <tr>
              <th>月份</th>
              ${months.map((m) => `<th>${escapeHtml(m.label)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Active</th>
              ${months.map((m, idx) => `<td><strong>${escapeHtml(String(m.active))}</strong><span class="trend-delta ${deltaClass(m.delta)}">${escapeHtml(deltaText(m.delta))}</span><span class="trend-move-line">进 ${escapeHtml(m.gained === null ? '-' : String(m.gained))} / 停 ${stopListButton(m.lost, { stopScope: 'analysisOverall', stopMonthIndex: idx }, idx === 0 ? 0 : months[idx - 1].active)}</span></td>`).join('')}
            </tr>
            <tr>
              <th>Stop</th>
              ${months.map((m) => `<td>${escapeHtml(pctText(m.stopped, m.active + m.stopped + m.archived))}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>
    ` : '<div class="empty-state">没有月份状态数据。</div>';
    const studentRows = records
      .slice()
      .sort((a, b) =>
        normalizedStudentYear(a).localeCompare(normalizedStudentYear(b), 'zh') ||
        studentValue(a, STUDENT_FIELDS.name).localeCompare(studentValue(b, STUDENT_FIELDS.name), 'zh')
      )
      .map((rec) => `
        <tr>
          <td><strong>${escapeHtml(studentValue(rec, STUDENT_FIELDS.name) || '-')}</strong></td>
          <td>${escapeHtml(studentValue(rec, STUDENT_FIELDS.year) || '-')}</td>
          <td>${escapeHtml(studentValue(rec, STUDENT_FIELDS.campus) || '-')}</td>
          <td>${escapeHtml(studentWeekdays(rec).join('、') || '-')}</td>
          <td>${isStoppedStudent(rec) ? `<span class="student-status stopped">Stop ${escapeHtml(stopMonthLabel(rec))}</span>` : '<span class="student-status active">Active</span>'}</td>
        </tr>
      `).join('');

    state.modalOpen = true;
    elModalRoot.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal wide" role="dialog" aria-modal="true">
          <h2>${escapeHtml(teacherName)} · 负责学生分析</h2>
          <div class="student-analysis-grid">
            <div class="role-modal-metric"><span>总学生</span><b>${records.length}</b></div>
            <div class="role-modal-metric"><span>Active</span><b>${active}</b></div>
            <div class="role-modal-metric"><span>Stop</span><b>${escapeHtml(pctText(stopped, records.length))}</b></div>
            <div class="role-modal-metric"><span>小学</span><b>${yearGroups.primary}</b></div>
            <div class="role-modal-metric"><span>中学</span><b>${yearGroups.secondary}</b></div>
            <div class="role-modal-metric"><span>无星期</span><b>${noWeekday}</b></div>
          </div>
          <dl style="margin-top:12px;">
            <dt>分院结构</dt><dd>${escapeHtml(topCountLabel(countMap(records, STUDENT_FIELDS.campus)))}</dd>
            <dt>年级结构</dt><dd>${escapeHtml(topCountLabel(countMap(records, STUDENT_FIELDS.year)))}</dd>
            <dt>时间段</dt><dd>${escapeHtml(topCountLabel(countMap(records, STUDENT_FIELDS.time)))}</dd>
            <dt>提醒</dt><dd>${escapeHtml(`无时间 ${noTime} · 无年级 ${noYear} · 无月份状态 ${noMonthStatus}`)}</dd>
          </dl>
          <h3 class="student-trend-title">每月表现</h3>
          ${monthHtml}
          ${renderTrendGroupTable('年级结构变化', '年级', yearRows, months)}
          ${renderTrendGroupTable('分院结构变化', '分院', campusRows, months)}
          <h3 class="student-trend-title">学生名单（${records.length}）</h3>
          <div class="students-table-wrap modal-student-list">
            <table class="students-table">
              <thead><tr><th>学生</th><th>年级</th><th>分院</th><th>星期</th><th>状态</th></tr></thead>
              <tbody>${studentRows}</tbody>
            </table>
          </div>
          <div class="actions split">
            <button id="student-analysis-filter" type="button">查看这位老师学生名单</button>
            <button id="modal-close" type="button">关闭</button>
          </div>
        </div>
      </div>
    `;
    bindModalCommon();
    bindStopListButtons(elModalRoot, records, months);
    const filterBtn = document.getElementById('student-analysis-filter');
    if (filterBtn) {
      filterBtn.addEventListener('click', () => {
        state.studentFilters.teacher = teacherName === '未填负责老师' ? '' : teacherName;
        closeModal();
        renderStudentsView();
      });
    }
  }

  function bindStopListButtons(root, baseRecords, months) {
    if (!root) return;
    root.querySelectorAll('[data-stop-month-index]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-stop-month-index'));
        if (!isFinite(idx)) return;
        const label = btn.getAttribute('data-stop-group-label') || '';
        const group = btn.getAttribute('data-stop-group') || '';
        const scopedRecords = group ? recordsForGroup(baseRecords, label, group) : baseRecords;
        const lost = lostStudentsForMonth(scopedRecords, months, idx);
        const base = idx > 0 && months[idx - 1]
          ? scopedRecords.filter((rec) => studentMonthValue(rec, months[idx - 1].month) === 'ACTIVE').length
          : 0;
        const month = months[idx];
        const prevMonth = months[idx - 1];
        const title = `${group || '全部学生'} · ${prevMonth ? prevMonth.label : '-'} 到 ${month ? month.label : '-'} 停步名单`;
        openStudentStopList(title, lost, prevMonth, month, base);
      });
    });
  }

  function openStudentStopList(title, records, prevMonth, month, baseCount) {
    const rows = records
      .slice()
      .sort((a, b) =>
        studentValue(a, STUDENT_FIELDS.teacher).localeCompare(studentValue(b, STUDENT_FIELDS.teacher), 'zh') ||
        normalizedStudentYear(a).localeCompare(normalizedStudentYear(b), 'zh') ||
        studentValue(a, STUDENT_FIELDS.name).localeCompare(studentValue(b, STUDENT_FIELDS.name), 'zh')
      )
      .map((rec) => `
        <tr>
          <td><strong>${escapeHtml(studentValue(rec, STUDENT_FIELDS.name) || '-')}</strong></td>
          <td>${escapeHtml(studentValue(rec, STUDENT_FIELDS.teacher) || '-')}</td>
          <td>${escapeHtml(studentValue(rec, STUDENT_FIELDS.year) || '-')}</td>
          <td>${escapeHtml(studentValue(rec, STUDENT_FIELDS.campus) || '-')}</td>
          <td>${escapeHtml(prevMonth ? studentValue(rec, prevMonth.month) || '-' : '-')}</td>
          <td>${escapeHtml(month ? studentValue(rec, month.month) || '空' : '-')}</td>
        </tr>
      `).join('');

    state.modalOpen = true;
    elModalRoot.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal wide" role="dialog" aria-modal="true">
          <h2>${escapeHtml(title)}</h2>
          <div class="student-analysis-grid" style="margin-bottom:12px;">
            <div class="role-modal-metric"><span>停步人数</span><b>${escapeHtml(pctText(records.length, baseCount))}</b></div>
            <div class="role-modal-metric"><span>上个月</span><b>${escapeHtml(prevMonth ? prevMonth.label : '-')}</b></div>
            <div class="role-modal-metric"><span>这个月</span><b>${escapeHtml(month ? month.label : '-')}</b></div>
          </div>
          <div class="students-table-wrap modal-student-list">
            <table class="students-table">
              <thead>
                <tr><th>学生</th><th>负责老师</th><th>年级</th><th>分院</th><th>上月</th><th>本月</th></tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="6" class="empty-state">没有停步学生。</td></tr>'}</tbody>
            </table>
          </div>
          <div class="actions">
            <button id="modal-close" type="button">关闭</button>
          </div>
        </div>
      </div>
    `;
    bindModalCommon();
  }

  function studentMatchesYearFilter(rec, year) {
    if (!year) return true;
    if (year === '未填年级') return !normalizedStudentYear(rec);
    if (year === PRIMARY_YEAR_FILTER) return PRIMARY_YEARS.includes(normalizedStudentYear(rec));
    if (year === SECONDARY_YEAR_FILTER) return SECONDARY_YEARS.includes(normalizedStudentYear(rec));
    return normalizedStudentYear(rec) === year;
  }

  function stopEventMonths() {
    return activeStudentMonths(state.students);
  }

  function buildStopEvents(records, months = stopEventMonths()) {
    const events = [];
    months.forEach((month, idx) => {
      if (idx === 0) return;
      const prevMonth = months[idx - 1];
      for (const rec of records) {
        if (studentMonthValue(rec, prevMonth.month) !== 'ACTIVE') continue;
        if (studentMonthValue(rec, month.month) === 'ACTIVE') continue;
        events.push({
          id: `${rec.recordId || studentValue(rec, STUDENT_FIELDS.no) || studentValue(rec, STUDENT_FIELDS.name)}-${month.month}`,
          rec,
          month: month.month,
          monthLabel: month.label,
          prevMonth: prevMonth.month,
          prevMonthLabel: prevMonth.label,
          teacher: studentValue(rec, STUDENT_FIELDS.teacher) || '未填负责老师',
          year: normalizedStudentYear(rec) || '未填年级',
          campus: studentValue(rec, STUDENT_FIELDS.campus) || '未填分院',
          name: studentValue(rec, STUDENT_FIELDS.name) || '-',
          currentStatus: studentValue(rec, month.month) || '空',
          previousStatus: studentValue(rec, prevMonth.month) || '-'
        });
      }
    });
    return events;
  }

  function stopBaseStudents({ includeSearch = true, includeMonth = false } = {}) {
    const q = state.stopSearch.trim().toLowerCase();
    const f = state.stopFilters;
    return state.students.filter((rec) => {
      if (includeSearch && q) {
        const haystack = [
          studentValue(rec, STUDENT_FIELDS.no),
          studentValue(rec, STUDENT_FIELDS.name),
          studentValue(rec, STUDENT_FIELDS.teacher),
          studentValue(rec, STUDENT_FIELDS.year),
          studentValue(rec, STUDENT_FIELDS.campus),
          studentValue(rec, STUDENT_FIELDS.time)
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (f.teacher && (studentValue(rec, STUDENT_FIELDS.teacher) || '未填负责老师') !== f.teacher) return false;
      if (!studentMatchesYearFilter(rec, f.year)) return false;
      if (f.campus && (studentValue(rec, STUDENT_FIELDS.campus) || '未填分院') !== f.campus) return false;
      if (includeMonth && f.month) {
        const months = stopEventMonths();
        const idx = months.findIndex((m) => m.month === f.month);
        if (idx <= 0) return false;
        if (studentMonthValue(rec, months[idx - 1].month) !== 'ACTIVE') return false;
      }
      return true;
    });
  }

  function filteredStopEvents() {
    const events = buildStopEvents(stopBaseStudents());
    return events.filter((event) => !state.stopFilters.month || event.month === state.stopFilters.month);
  }

  function stopBaseCountForMonth(records, months, monthValue) {
    const idx = months.findIndex((m) => m.month === monthValue);
    if (idx <= 0 || !months[idx - 1]) return 0;
    return records.filter((rec) => studentMonthValue(rec, months[idx - 1].month) === 'ACTIVE').length;
  }

  function stopBaseCountForFilters(records, months) {
    if (state.stopFilters.month) return stopBaseCountForMonth(records, months, state.stopFilters.month);
    return months.slice(1).reduce((sum, month) => sum + stopBaseCountForMonth(records, months, month.month), 0);
  }

  function renderStopFilterOptions() {
    const values = (field, fallback) => unique(state.students.map((rec) => studentValue(rec, field) || fallback).filter(Boolean))
      .sort((a, b) => a.localeCompare(b, 'zh'));
    const years = unique([
      PRIMARY_YEAR_FILTER,
      ...PRIMARY_YEARS,
      SECONDARY_YEAR_FILTER,
      ...SECONDARY_YEARS,
      ...values(STUDENT_FIELDS.year, '未填年级').map((year) => year.toUpperCase()).filter((year) => !FIXED_YEAR_ORDER.includes(year))
    ]);
    const months = stopEventMonths().slice(1).map((month) => ({ value: month.month, label: month.label }));
    if (elStopMonth) {
      elStopMonth.innerHTML = '<option value="">全部月份</option>' +
        months.map((month) => `<option value="${escapeHtml(month.value)}">${escapeHtml(month.label)}</option>`).join('');
      elStopMonth.value = state.stopFilters.month || '';
    }
    fillSelectWithAll(elStopTeacher, values(STUDENT_FIELDS.teacher, '未填负责老师'), state.stopFilters.teacher, '全部老师');
    fillSelectWithAll(elStopYear, years, state.stopFilters.year, '全部年级');
    fillSelectWithAll(elStopCampus, values(STUDENT_FIELDS.campus, '未填分院'), state.stopFilters.campus, '全部分院');
  }

  function renderStopsSummary(events, baseCount) {
    if (!elStopsSummary) return;
    const students = new Set(events.map((event) => event.rec.recordId || event.name));
    const teachers = countMap(events.map((event) => event.rec), STUDENT_FIELDS.teacher, '未填负责老师');
    const monthCounts = new Map();
    for (const event of events) incrementCount(monthCounts, event.monthLabel);
    const cards = [
      { label: '停步事件', value: pctText(events.length, baseCount) },
      { label: '涉及学生', value: students.size },
      { label: '涉及老师', value: unique(events.map((event) => event.teacher)).length },
      { label: '最高月份', value: topCountLabel(monthCounts) },
      { label: '最高老师', value: topCountLabel(teachers) },
      { label: '更新时间', value: state.studentUpdatedAt || '-' }
    ];
    elStopsSummary.innerHTML = cards.map((c) => `
      <div class="card">
        <div class="label">${escapeHtml(c.label)}</div>
        <div class="value">${escapeHtml(String(c.value))}</div>
      </div>
    `).join('');
  }

  function renderStopsMonthly(baseRecords, months) {
    if (!elStopsMonthly) return;
    const rows = months.slice(1).map((month) => {
      const events = buildStopEvents(baseRecords, months).filter((event) => event.month === month.month);
      const base = stopBaseCountForMonth(baseRecords, months, month.month);
      const teacherCounts = new Map();
      const yearCounts = new Map();
      for (const event of events) {
        incrementCount(teacherCounts, event.teacher);
        incrementCount(yearCounts, event.year);
      }
      return { month, events, base, teacherCounts, yearCounts };
    }).filter((row) => row.base || row.events.length);
    if (!rows.length) {
      elStopsMonthly.innerHTML = '<div class="empty-state">没有停步月份数据。</div>';
      return;
    }
    elStopsMonthly.innerHTML = `
      <div class="student-trend-wrap">
        <table class="student-trend-table">
          <thead>
            <tr>
              <th>月份</th>
              <th>上月 Active</th>
              <th>停步人数（%）</th>
              <th>最高老师</th>
              <th>最高年级</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <th>${escapeHtml(row.month.label)}</th>
                <td>${escapeHtml(String(row.base))}</td>
                <td>${stopListButton(row.events.length, { stopPageMonth: row.month.month }, row.base)}</td>
                <td>${escapeHtml(topCountLabel(row.teacherCounts))}</td>
                <td>${escapeHtml(topCountLabel(row.yearCounts))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    elStopsMonthly.querySelectorAll('[data-stop-page-month]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.stopFilters.month = btn.getAttribute('data-stop-page-month') || '';
        renderStopsView();
      });
    });
  }

  function renderStopsTable(events) {
    if (!elStopsTable) return;
    elStopsTable.querySelector('thead').innerHTML = `
      <tr>
        <th>月份</th>
        <th>学生</th>
        <th>负责老师</th>
        <th>年级</th>
        <th>分院</th>
        <th>时间段</th>
        <th>上月</th>
        <th>本月</th>
        <th>Stop 月份</th>
      </tr>
    `;
    const rows = events
      .slice()
      .sort((a, b) =>
        a.month.localeCompare(b.month) ||
        a.teacher.localeCompare(b.teacher, 'zh') ||
        a.year.localeCompare(b.year, 'zh') ||
        a.name.localeCompare(b.name, 'zh')
      )
      .map((event) => `
        <tr>
          <td><strong>${escapeHtml(event.prevMonthLabel)} → ${escapeHtml(event.monthLabel)}</strong></td>
          <td><strong class="student-name">${escapeHtml(event.name)}</strong></td>
          <td><button class="trend-link" type="button" data-stop-teacher-analysis="${escapeHtml(event.teacher === '未填负责老师' ? '' : event.teacher)}">${escapeHtml(event.teacher)}</button></td>
          <td>${escapeHtml(event.year)}</td>
          <td>${escapeHtml(event.campus)}</td>
          <td>${escapeHtml(studentValue(event.rec, STUDENT_FIELDS.time) || '-')}</td>
          <td>${escapeHtml(event.previousStatus)}</td>
          <td><span class="student-status stopped">${escapeHtml(event.currentStatus)}</span></td>
          <td>${escapeHtml(stopMonthLabel(event.rec) || '-')}</td>
        </tr>
      `).join('');
    elStopsTable.querySelector('tbody').innerHTML = rows || '<tr><td colspan="9" class="empty-state">没有匹配的停步学生。</td></tr>';
    elStopsTable.querySelectorAll('[data-stop-teacher-analysis]').forEach((btn) => {
      btn.addEventListener('click', () => openStudentTeacherAnalysis(btn.getAttribute('data-stop-teacher-analysis') || ''));
    });
  }

  function renderStopsView() {
    renderStopFilterOptions();
    const months = stopEventMonths();
    const baseRecords = stopBaseStudents();
    const events = filteredStopEvents();
    const baseCount = stopBaseCountForFilters(baseRecords, months);
    renderStopsSummary(events, baseCount);
    renderStopsMonthly(baseRecords, months);
    renderStopsTable(events);
    if (elStopsMeta) {
      elStopsMeta.textContent = `停步名单 ${events.length} 条 · 基数 ${baseCount} · 来源学生 ${state.students.length} 人`;
    }
  }

  function renderTrendGroupTable(title, label, rows, months) {
    if (!rows.length) return '';
    return `
      <h4 class="student-trend-title">${escapeHtml(title)}</h4>
      <div class="student-trend-wrap">
        <table class="student-trend-table teacher-trend">
          <thead>
            <tr>
              <th>${escapeHtml(label)}</th>
              ${months.map((m) => `<th>${escapeHtml(m.label)}</th>`).join('')}
              <th>首尾变化</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="${row.group.startsWith('总') ? 'trend-total-row' : ''}">
                <th>${label === '负责老师'
                  ? `<button class="trend-link" type="button" data-student-teacher-analysis="${escapeHtml(row.group === '未填负责老师' ? '' : row.group)}">${escapeHtml(row.group)}</button>`
                  : escapeHtml(row.group)}
                </th>
                ${row.counts.map((count, idx) => {
                  const prev = idx === 0 ? null : row.counts[idx - 1];
                  const delta = prev === null ? null : count - prev;
                  return `<td>
                    <strong>${escapeHtml(String(count))}</strong>
                    <span class="trend-delta ${deltaClass(delta)}">${escapeHtml(deltaText(delta))}</span>
                    <span class="trend-move-line">
                      进 ${escapeHtml(row.gained[idx] === null ? '-' : String(row.gained[idx]))}
                      / 停 ${stopListButton(row.lost[idx], { stopGroupLabel: label, stopGroup: row.group, stopMonthIndex: idx }, idx === 0 ? 0 : row.counts[idx - 1])}
                    </span>
                  </td>`;
                }).join('')}
                <td><span class="trend-delta ${deltaClass(row.change)}">${escapeHtml(deltaText(row.change))}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderStudentMonthlyTrend(list) {
    if (!elStudentMonthlyTrend) return;
    const months = activeStudentMonths(list);
    if (!months.length) {
      elStudentMonthlyTrend.innerHTML = '<div class="empty-state">没有月份状态数据。</div>';
      return;
    }
    const yearRows = monthlyTrendByYear(list, months);
    const campusRows = monthlyTrendByGroup(list, months, STUDENT_FIELDS.campus, '未填分院');
    const teacherRows = monthlyTrendByGroup(list, months, STUDENT_FIELDS.teacher, '未填负责老师');
    elStudentMonthlyTrend.innerHTML = `
      <h4 class="student-trend-title">整体表现</h4>
      <div class="student-trend-wrap">
        <table class="student-trend-table">
          <thead>
            <tr>
              <th>月份</th>
              ${months.map((m) => `<th>${escapeHtml(m.label)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Active 人数</th>
              ${months.map((m) => `<td><strong>${escapeHtml(String(m.active))}</strong></td>`).join('')}
            </tr>
            <tr>
              <th>比上月</th>
              ${months.map((m) => `<td><span class="trend-delta ${deltaClass(m.delta)}">${escapeHtml(deltaText(m.delta))}</span></td>`).join('')}
            </tr>
            <tr>
              <th>进步人数</th>
              ${months.map((m) => `<td><span class="trend-move gained">${escapeHtml(m.gained === null ? '-' : String(m.gained))}</span></td>`).join('')}
            </tr>
            <tr>
              <th>停步人数</th>
              ${months.map((m, idx) => `<td><span class="trend-move lost">${stopListButton(m.lost, { stopScope: 'overall', stopMonthIndex: idx }, idx === 0 ? 0 : months[idx - 1].active)}</span></td>`).join('')}
            </tr>
            <tr>
              <th>Stop</th>
              ${months.map((m) => `<td>${escapeHtml(pctText(m.stopped, m.active + m.stopped + m.archived))}</td>`).join('')}
            </tr>
            <tr>
              <th>Archived</th>
              ${months.map((m) => `<td>${escapeHtml(String(m.archived))}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>
      ${renderTrendGroupTable('年级表现', '年级', yearRows, months)}
      ${renderTrendGroupTable('分院表现', '分院', campusRows, months)}
      ${renderTrendGroupTable('负责老师表现', '负责老师', teacherRows, months)}
    `;
    elStudentMonthlyTrend.querySelectorAll('[data-student-teacher-analysis]').forEach((btn) => {
      btn.addEventListener('click', () => openStudentTeacherAnalysis(btn.getAttribute('data-student-teacher-analysis') || ''));
    });
    bindStopListButtons(elStudentMonthlyTrend, state.students, months);
  }

  function renderStudentsView() {
    renderStudentFilterOptions();
    const list = filteredStudents();
    renderStudentsSummary(list);
    renderStudentMonthlyTrend(state.students);
    renderStudentTeacherSummary(state.students);
    renderStudentsTable(list);
    elStudentsMeta.textContent = `名单显示 ${list.length}/${state.students.length} · 来源字段 ${state.studentColumns.length} 个`;
  }

  function applyStudentsPayload(data) {
    state.students = data.records || [];
    state.studentColumns = data.columns || [];
    state.studentUpdatedAt = data.updatedAt || null;
    state.lastStudentsHash = String(data.count || 0) + '|' + (data.updatedAt || '');
    if (state.view === 'stops') renderStopsView();
    else renderStudentsView();
  }

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
      if (state.view === 'stops' && elStopsMeta) {
        elStopsMeta.textContent = `先显示本机缓存 ${state.students.length} 条 · 正在更新最新停步名单…`;
      } else {
        elStudentsMeta.textContent = `先显示本机缓存 ${state.students.length} 条 · 正在更新最新名单…`;
      }
      return true;
    } catch {
      return false;
    }
  }

  /* ============================================================
     DETAIL MODALS
  ============================================================ */

  function openSlotDetail(rec) {
    const s = getRecordStatus(rec);
    const teacherLink = (name) => `<span class="teacher-link" data-teacher="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
    const dash = (arr) => (arr && arr.length)
      ? arr.map(teacherLink).join('、')
      : '<span style="color:var(--muted)">-</span>';
    const teacherRatioStr = s.teacherCount > 0 ? `${fmtRatio(s.teacherRatio)} : 1` : '— (无老师)';
    const manpowerRatioStr = s.manpowerCount > 0 ? `${fmtRatio(s.manpowerRatio)} : 1` : '— (无人手)';

    state.modalOpen = true;
    elModalRoot.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <h2>${escapeHtml(rec.day)} · ${escapeHtml(rec.block)}</h2>
          <dl>
            <dt>礼拜</dt><dd>${escapeHtml(rec.day)}</dd>
            <dt>Block</dt><dd>${escapeHtml(rec.block)}</dd>
            <dt>时间</dt><dd>${escapeHtml(rec.timeRange || '-')}</dd>
            <dt>人数</dt><dd>${escapeHtml(String(rec.studentCount))}</dd>
            <dt>DAYCARE老师</dt><dd>${dash(rec.daycareTeachers)}</dd>
            <dt>教书老师</dt><dd>${dash(rec.teachingTeachers)}</dd>
            <dt>助理</dt><dd>${dash(rec.assistants)}</dd>
            <dt>助教</dt><dd>${dash(rec.assistantTeachers)}</dd>
            <dt>老师学生比</dt><dd>${escapeHtml(teacherRatioStr)}</dd>
            <dt>人手学生比</dt><dd>${escapeHtml(manpowerRatioStr)}</dd>
            <dt>状态</dt><dd><span class="status-pill ${s.kind}" style="background: var(--status-${s.kind})">${escapeHtml(s.detail)}</span></dd>
          </dl>
          <div class="actions split">
            <button id="modal-edit" class="primary" type="button">编辑</button>
            <div class="right">
              <button id="modal-close" type="button">关闭</button>
            </div>
          </div>
        </div>
      </div>
    `;
    bindModalCommon();
    const editBtn = document.getElementById('modal-edit');
    if (editBtn) editBtn.addEventListener('click', () => openScheduleEditor(rec));
    elModalRoot.querySelectorAll('[data-teacher]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = el.getAttribute('data-teacher');
        closeModal();
        switchView('teachers');
        const stats = computeTeacherStats(applyFilters(state.records));
        openTeacherDetail(name, stats);
      });
    });
  }

  function defaultNewRecord() {
    const day = state.filters.day || '1.MON';
    const block = state.filters.block || (allBlocks()[0] || '');
    return {
      recordId: '',
      day,
      dayOrder: parseInt(day) || 1,
      block,
      studentCount: 0,
      timeRange: '07:30-09:30',
      startMinutes: 450,
      endMinutes: 570,
      daycareTeachers: [],
      teachingTeachers: [],
      assistants: [],
      assistantTeachers: []
    };
  }

  function compatibleTeachers(role) {
    const roleMap = teacherRoleMap();
    const staffList = state.staffRoles[role] || [];
    const source = staffList.length ? staffList : allTeachers();
    return unique(source).filter((name) => roleMap.get(name) === role).sort((a, b) => a.localeCompare(b, 'zh'));
  }

  function renderTimeSelect(name, current, min) {
    const opts = timeOptions()
      .filter((opt) => min == null || opt.value > min)
      .map((opt) => `<option value="${opt.value}" ${opt.value === current ? 'selected' : ''}>${opt.label}</option>`);
    return `<select name="${name}" data-time-select="${name}">${opts.join('')}</select>`;
  }

  function renderTagField(role, values) {
    const title = ROLE_LABEL[role];
    const tags = (values || []).map((name) => `
      <span class="tag" data-role="${role}" data-name="${escapeHtml(name)}">
        ${escapeHtml(name)}
        <button type="button" data-remove-tag="${role}" data-name="${escapeHtml(name)}" aria-label="移除 ${escapeHtml(name)}">×</button>
      </span>
    `).join('');
    return `
      <div class="tag-field" data-role-field="${role}">
        <div class="tag-field-title">${escapeHtml(title)}</div>
        <div class="tag-list" data-tag-list="${role}">${tags}</div>
        <div class="tag-input-row">
          <input type="text" data-tag-input="${role}" autocomplete="off" placeholder="输入老师名字" />
          <button type="button" data-add-tag="${role}">加入</button>
          <div class="suggest-menu" data-suggest-menu="${role}"></div>
        </div>
      </div>
    `;
  }

  function openScheduleEditor(rec, mode) {
    const isNew = mode === 'new' || !rec || !rec.recordId;
    const data = rec || defaultNewRecord();
    const start = data.startMinutes || 450;
    const end = data.endMinutes && data.endMinutes > start ? data.endMinutes : start + 30;
    const dayValue = parseDayOption(data.day);
    const blocks = blockOptions(data.block);
    state.modalOpen = true;

    elModalRoot.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <h2>${isNew ? '新增时段' : '编辑时段'}</h2>
          <form class="edit-form" id="schedule-form">
            <div class="edit-grid">
              <label>礼拜
                <select name="day">
                  ${DAY_VALUES.map((v) => `<option value="${v}" ${v === dayValue ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}
                </select>
              </label>
              <label>BLOCK
                <select name="block" required>
                  ${blocks.map((b) => `<option value="${escapeHtml(b)}" ${b === data.block ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('')}
                </select>
              </label>
              <label>开始时间
                ${renderTimeSelect('startMinutes', start)}
              </label>
              <label>结束时间
                ${renderTimeSelect('endMinutes', end, start)}
              </label>
              <label>时段人数
                <input name="studentCount" type="number" min="0" step="1" value="${escapeHtml(String(data.studentCount || 0))}" required />
              </label>
            </div>
            ${renderTagField('daycare', data.daycareTeachers)}
            ${renderTagField('teaching', data.teachingTeachers)}
            ${renderTagField('assistant', data.assistants)}
            ${renderTagField('assistantTeacher', data.assistantTeachers)}
            <div class="form-error" id="form-error"></div>
            <div class="actions split">
              ${isNew ? '<span></span>' : '<button id="delete-slot" class="danger" type="button">删除</button>'}
              <div class="right">
                <button id="modal-close" type="button">取消</button>
                <button class="primary" id="save-slot" type="submit">保存</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    `;
    bindModalCommon();
    bindScheduleEditor(data, isNew);
  }

  function bindScheduleEditor(rec, isNew) {
    const form = document.getElementById('schedule-form');
    const startSelect = form.querySelector('[data-time-select="startMinutes"]');
    const endWrap = startSelect.closest('label').nextElementSibling;

    startSelect.addEventListener('change', () => {
      const currentEnd = parseInt(form.elements.endMinutes.value);
      const start = parseInt(startSelect.value);
      endWrap.innerHTML = `结束时间${renderTimeSelect('endMinutes', currentEnd > start ? currentEnd : start + 30, start)}`;
    });

    form.querySelectorAll('[data-add-tag]').forEach((btn) => {
      btn.addEventListener('click', () => addTag(btn.getAttribute('data-add-tag')));
    });
    form.querySelectorAll('[data-tag-input]').forEach((input) => {
      input.addEventListener('input', () => renderTeacherSuggestions(input.getAttribute('data-tag-input')));
      input.addEventListener('focus', () => renderTeacherSuggestions(input.getAttribute('data-tag-input')));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closeTeacherSuggestions();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          addTag(input.getAttribute('data-tag-input'));
        }
      });
    });
    form.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-tag]');
      if (!btn) return;
      btn.closest('.tag').remove();
    });
    form.addEventListener('mousedown', (e) => {
      const item = e.target.closest('[data-suggest-name]');
      if (!item) return;
      e.preventDefault();
      const role = item.getAttribute('data-suggest-role');
      const input = elModalRoot.querySelector(`[data-tag-input="${role}"]`);
      input.value = item.getAttribute('data-suggest-name');
      closeTeacherSuggestions();
      input.focus();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveScheduleForm(rec, isNew);
    });
    const deleteBtn = document.getElementById('delete-slot');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => deleteScheduleRecord(rec));
    }
  }

  function renderTeacherSuggestions(role) {
    const input = elModalRoot.querySelector(`[data-tag-input="${role}"]`);
    const menu = elModalRoot.querySelector(`[data-suggest-menu="${role}"]`);
    if (!input || !menu) return;
    const query = (input.value || '').trim().toLowerCase();
    const already = new Set([
      ...collectTags(role),
      ...ROLE_KEYS.filter((key) => key !== role).flatMap((key) => collectTags(key))
    ]);
    const suggestions = compatibleTeachers(role)
      .filter((name) => !already.has(name))
      .filter((name) => !query || name.toLowerCase().includes(query))
      .slice(0, 10);
    if (!suggestions.length) {
      menu.classList.remove('open');
      menu.innerHTML = '';
      return;
    }
    menu.innerHTML = suggestions.map((name) => `
      <button type="button" class="suggest-item" data-suggest-role="${role}" data-suggest-name="${escapeHtml(name)}">
        <span>${escapeHtml(name)}</span>
        <span class="role">${escapeHtml(ROLE_LABEL[role])}</span>
      </button>
    `).join('');
    menu.classList.add('open');
  }

  function closeTeacherSuggestions() {
    elModalRoot.querySelectorAll('.suggest-menu').forEach((menu) => {
      menu.classList.remove('open');
      menu.innerHTML = '';
    });
  }

  function addTag(role) {
    const input = elModalRoot.querySelector(`[data-tag-input="${role}"]`);
    const list = elModalRoot.querySelector(`[data-tag-list="${role}"]`);
    const name = (input.value || '').trim();
    if (!name) return;
    const knownRole = knownTeacherRole(name);
    if (knownRole === 'conflict') {
      showFormError(`老师 ${name} 在现有 Lark 数据里已有多个角色，请先清理`);
      return;
    }
    if (knownRole && knownRole !== role) {
      showFormError(`老师 ${name} 已绑定为 ${ROLE_LABEL[knownRole]}，不能加入 ${ROLE_LABEL[role]}`);
      return;
    }
    const duplicateRole = ROLE_KEYS.find((key) => key !== role && collectTags(key).includes(name));
    if (duplicateRole) {
      showFormError(`老师 ${name} 已在 ${ROLE_LABEL[duplicateRole]}，同一时段不能重复绑定角色`);
      return;
    }
    const exists = Array.from(list.querySelectorAll('.tag'))
      .some((tag) => tag.getAttribute('data-name') === name);
    if (!exists) {
      const span = document.createElement('span');
      span.className = 'tag';
      span.setAttribute('data-role', role);
      span.setAttribute('data-name', name);
      span.innerHTML = `${escapeHtml(name)} <button type="button" data-remove-tag="${role}" data-name="${escapeHtml(name)}" aria-label="移除 ${escapeHtml(name)}">×</button>`;
      list.appendChild(span);
    }
    closeTeacherSuggestions();
    showFormError('');
    input.value = '';
    input.focus();
  }

  function collectTags(role) {
    return Array.from(elModalRoot.querySelectorAll(`[data-tag-list="${role}"] .tag`))
      .map((tag) => tag.getAttribute('data-name'))
      .filter(Boolean);
  }

  function buildFieldsFromForm() {
    const form = document.getElementById('schedule-form');
    const start = parseInt(form.elements.startMinutes.value);
    const end = parseInt(form.elements.endMinutes.value);
    if (!isFinite(start) || !isFinite(end) || end <= start) {
      throw new Error('结束时间必须晚过开始时间');
    }
    const count = parseInt(form.elements.studentCount.value);
    if (!isFinite(count) || count < 0) {
      throw new Error('时段人数必须是 0 或以上');
    }
    const seen = new Map();
    for (const role of ROLE_KEYS) {
      for (const name of collectTags(role)) {
        const knownRole = knownTeacherRole(name);
        if (knownRole === 'conflict') {
          throw new Error(`老师 ${name} 在现有 Lark 数据里已有多个角色，请先清理`);
        }
        if (knownRole && knownRole !== role) {
          throw new Error(`老师 ${name} 已绑定为 ${ROLE_LABEL[knownRole]}，不能写入 ${ROLE_LABEL[role]}`);
        }
        const prev = seen.get(name);
        if (prev && prev !== role) {
          throw new Error(`老师 ${name} 在同一时段里重复绑定了 ${ROLE_LABEL[prev]} 和 ${ROLE_LABEL[role]}`);
        }
        seen.set(name, role);
      }
    }
    return {
      [LARK_FIELDS.day]: form.elements.day.value,
      [LARK_FIELDS.block]: form.elements.block.value.trim(),
      [LARK_FIELDS.timeRange]: `${minutesToClock(start)}-${minutesToClock(end)}`,
      [LARK_FIELDS.studentCount]: count,
      [LARK_FIELDS.daycare]: collectTags('daycare'),
      [LARK_FIELDS.teaching]: collectTags('teaching'),
      [LARK_FIELDS.assistant]: collectTags('assistant'),
      [LARK_FIELDS.assistantTeacher]: collectTags('assistantTeacher')
    };
  }

  async function postJson(url, payload) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('接口返回非 JSON 数据'); }
    if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  }

  function setFormBusy(busy) {
    elModalRoot.querySelectorAll('button, input, select').forEach((el) => { el.disabled = busy; });
  }

  function showFormError(message) {
    const el = document.getElementById('form-error');
    if (el) el.textContent = message || '';
  }

  async function saveScheduleForm(rec, isNew) {
    try {
      showFormError('');
      const fields = buildFieldsFromForm();
      if (!fields[LARK_FIELDS.block]) throw new Error('BLOCK 不能为空');
      setFormBusy(true);
      await postJson(isNew ? '/api/create-schedule' : '/api/update-schedule', {
        recordId: rec.recordId,
        fields
      });
      closeModal();
      state.lastPayloadHash = '';
      await loadSchedule(false);
    } catch (err) {
      setFormBusy(false);
      showFormError(err.message);
    }
  }

  async function deleteScheduleRecord(rec) {
    if (!rec || !rec.recordId) return;
    const ok = window.confirm(`确定删除 ${rec.day} · ${rec.block} · ${rec.timeRange || '-'}？`);
    if (!ok) return;
    try {
      showFormError('');
      setFormBusy(true);
      await postJson('/api/delete-schedule', { recordId: rec.recordId });
      closeModal();
      state.lastPayloadHash = '';
      await loadSchedule(false);
    } catch (err) {
      setFormBusy(false);
      showFormError(err.message);
    }
  }

  function openTeacherDetail(name, statsList) {
    const t = statsList.find((s) => s.name === name);
    if (!t) return;
    state.modalOpen = true;

    const byDayList = [1,2,3,4,5,6,7].map((d) => {
      const recs = t.records.filter((r) => r.dayOrder === d)
        .sort((a, b) => (a.startMinutes || 0) - (b.startMinutes || 0));
      return { d, recs };
    });

    const miniRows = byDayList.map(({ d, recs }) => {
      if (!recs.length) return '';
      const segs = recs.map((rec) => {
        if (rec.startMinutes == null || rec.endMinutes == null) return '';
        const s = Math.max(rec.startMinutes, AXIS_START);
        const e = Math.min(rec.endMinutes, AXIS_END);
        if (e <= s) return '';
        const left = ((s - AXIS_START) / (AXIS_END - AXIS_START)) * 100;
        const width = ((e - s) / (AXIS_END - AXIS_START)) * 100;
        return `<div class="seg" style="left:${left.toFixed(2)}%; width:${width.toFixed(2)}%; background: var(--role-${t.role})" title="${escapeHtml(rec.block)} ${escapeHtml(rec.timeRange)}">${escapeHtml(shortBlock(rec.block))}</div>`;
      }).join('');
      return `<div class="row-mini">
        <div class="day-name">${DAY_LABELS[d]}</div>
        <div class="track">${segs}</div>
      </div>`;
    }).filter(Boolean).join('');

    const slotList = t.records
      .slice()
      .sort((a, b) => (a.dayOrder - b.dayOrder) || ((a.startMinutes || 0) - (b.startMinutes || 0)))
      .map((rec) => `<li>${escapeHtml(rec.day)} · ${escapeHtml(rec.block)} · ${escapeHtml(rec.timeRange || '-')} · ${rec.studentCount}人</li>`)
      .join('');

    elModalRoot.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <h2>${escapeHtml(t.name)} <span class="role-pill ${t.role}" style="margin-left:6px;">${escapeHtml(ROLE_LABEL[t.role])}</span></h2>
          <dl>
            <dt>时段数</dt><dd>${t.slots}</dd>
            <dt>总工时</dt><dd>${fmtHours(t.hours)} h</dd>
            <dt>平均带生</dt><dd>${fmtRatio(t.avgStudents)} 人 / 时</dd>
            <dt>生·时 (分摊)</dt><dd>${fmtRatio(t.sharedStudentHours)}</dd>
            <dt>生·时 (总)</dt><dd>${fmtRatio(t.studentHours)}</dd>
          </dl>
          <h3 style="margin: 16px 0 6px; font-size: 13px; color: var(--muted)">本周时间表</h3>
          <div class="mini-gantt">${miniRows || '<div class="empty-state">无时段</div>'}</div>
          <h3 style="margin: 16px 0 6px; font-size: 13px; color: var(--muted)">所有时段（${t.records.length}）</h3>
          <ul style="margin:0; padding-left: 18px; font-size: 12px; line-height: 1.7;">${slotList}</ul>
          <div class="actions">
            <button id="modal-close" type="button">关闭</button>
          </div>
        </div>
      </div>
    `;
    bindModalCommon();
  }

  function bindModalCommon() {
    const backdrop = document.getElementById('modal-backdrop');
    const closeBtn = document.getElementById('modal-close');
    if (backdrop) backdrop.addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    document.addEventListener('keydown', escClose);
  }

  function escClose(e) { if (e.key === 'Escape') closeModal(); }

  function closeModal() {
    state.modalOpen = false;
    elModalRoot.innerHTML = '';
    document.removeEventListener('keydown', escClose);
  }

  /* ============================================================
     VIEW SWITCH + RERENDER
  ============================================================ */

  function switchView(view) {
    state.view = view;
    elViewGantt.hidden = view !== 'gantt';
    elViewTeachers.hidden = view !== 'teachers';
    elViewStudents.hidden = view !== 'students';
    elViewStops.hidden = view !== 'stops';
    document.querySelectorAll('.tabs button').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === view);
    });
    document.querySelectorAll('[data-view-only]').forEach((el) => {
      const views = el.getAttribute('data-view-only').split(/\s+/);
      el.style.display = views.includes(view) ? '' : 'none';
    });
    if ((view === 'students' || view === 'stops') && !state.lastStudentsHash) loadStudents(true);
    rerender();
  }

  function rerender() {
    const filtered = applyFilters(state.records);
    if (state.view === 'gantt') {
      renderSummary(filtered);
      renderGantt(filtered);
    } else if (state.view === 'teachers') {
      renderTeachersView(filtered);
    } else if (state.view === 'students') {
      renderStudentsView();
    } else {
      renderStopsView();
    }
  }

  /* ============================================================
     LOAD + AUTO REFRESH
  ============================================================ */

  async function loadSchedule(initial) {
    try {
      const resp = await fetch('/api/schedule?t=' + Date.now(), { cache: 'no-store' });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('返回非 JSON 数据'); }
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);

      const hash = String(data.records.length) + '|' + (data.updatedAt || '');
      if (hash === state.lastPayloadHash && !initial) return;
      state.lastPayloadHash = hash;
      state.records = data.records || [];
      state.staffRoles = Object.assign(
        { daycare: [], teaching: [], assistant: [], assistantTeacher: [] },
        data.staffRoles || {}
      );
      state.updatedAt = data.updatedAt || null;
      elMeta.textContent = `共 ${state.records.length} 条记录　|　更新时间 ${state.updatedAt || '-'}`;
      populateFilterOptions();
      rerender();
    } catch (err) {
      if (initial) {
        elGantt.innerHTML = `<div class="error-state">无法读取 Lark Base 数据：${escapeHtml(err.message)}<br/>请检查 App 权限、Base Token、Table ID 或字段名称。</div>`;
      }
      elMeta.textContent = `加载失败：${err.message}`;
    }
  }

  async function loadStudents(initial, forceRefresh = false) {
    try {
      if (initial && !state.students.length) loadStudentsCache();
      const params = new URLSearchParams({ t: String(Date.now()) });
      if (forceRefresh) params.set('refresh', '1');
      const resp = await fetch('/api/students?' + params.toString(), { cache: 'no-store' });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('返回非 JSON 数据'); }
      if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);

      const hash = String(data.count || 0) + '|' + (data.updatedAt || '');
      if (hash === state.lastStudentsHash && !initial) return;
      applyStudentsPayload(data);
      saveStudentsCache(data);
    } catch (err) {
      elStudentsMeta.textContent = `学生名单加载失败：${err.message}`;
      if (elStopsMeta) elStopsMeta.textContent = `停步名单加载失败：${err.message}`;
      if (!state.students.length) {
        elStudentsTable.querySelector('tbody').innerHTML = `<tr><td class="error-state">无法读取学生名单：${escapeHtml(err.message)}</td></tr>`;
        if (elStopsTable) elStopsTable.querySelector('tbody').innerHTML = `<tr><td class="error-state">无法读取停步名单：${escapeHtml(err.message)}</td></tr>`;
      }
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshTimer = setInterval(() => {
      if (document.hidden || state.modalOpen) return;
      if (state.view === 'students' || state.view === 'stops') loadStudents(false);
      else loadSchedule(false);
    }, AUTO_REFRESH_MS);
  }
  function stopAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  function bindFilters() {
    elDay.addEventListener('change', () => { state.filters.day = elDay.value; rerender(); });
    elBlock.addEventListener('change', () => { state.filters.block = elBlock.value; rerender(); });
    elRole.addEventListener('change', () => { state.filters.role = elRole.value; rerender(); });
    elTeacher.addEventListener('change', () => { state.filters.teacher = elTeacher.value; rerender(); });
    elStatus.addEventListener('change', () => { state.filters.status = elStatus.value; rerender(); });
    elThresholdTeacher.addEventListener('input', () => {
      const v = parseFloat(elThresholdTeacher.value);
      state.teacherThreshold = isFinite(v) && v > 0 ? v : DEFAULT_TEACHER_THRESHOLD;
      rerender();
    });
    elThresholdManpower.addEventListener('input', () => {
      const v = parseFloat(elThresholdManpower.value);
      state.manpowerThreshold = isFinite(v) && v > 0 ? v : DEFAULT_MANPOWER_THRESHOLD;
      rerender();
    });
    elRefresh.addEventListener('click', () => {
      if (state.view === 'students' || state.view === 'stops') loadStudents(false, true);
      else loadSchedule(false);
    });
    elAddSlot.addEventListener('click', () => openScheduleEditor(defaultNewRecord(), 'new'));
    elAddStaff.addEventListener('click', () => openCreateStaffModal(state.filters.role || ''));
    elReset.addEventListener('click', () => {
      state.filters = { day: '', block: '', role: '', teacher: '', status: '' };
      syncFilterControls();
      rerender();
    });
    document.querySelectorAll('.tabs button').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.getAttribute('data-view')));
    });
    if (elTeacherSubtabs) {
      elTeacherSubtabs.querySelectorAll('[data-teacher-view]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.teacherView = btn.getAttribute('data-teacher-view') || 'overview';
          rerender();
        });
      });
    }
    if (elStudentSearch) {
      elStudentSearch.addEventListener('input', () => {
        state.studentSearch = elStudentSearch.value || '';
        renderStudentsView();
      });
    }
    [
      [elStudentYear, 'year'],
      [elStudentTeacher, 'teacher'],
      [elStudentTime, 'time'],
      [elStudentCampus, 'campus'],
      [elStudentWeekday, 'weekday'],
      [elStudentStop, 'stop']
    ].forEach(([el, key]) => {
      if (!el) return;
      el.addEventListener('change', () => {
        state.studentFilters[key] = el.value || '';
        renderStudentsView();
      });
    });
    if (elStopSearch) {
      elStopSearch.addEventListener('input', () => {
        state.stopSearch = elStopSearch.value || '';
        renderStopsView();
      });
    }
    [
      [elStopMonth, 'month'],
      [elStopTeacher, 'teacher'],
      [elStopYear, 'year'],
      [elStopCampus, 'campus']
    ].forEach(([el, key]) => {
      if (!el) return;
      el.addEventListener('change', () => {
        state.stopFilters[key] = el.value || '';
        renderStopsView();
      });
    });
    if (elStopReset) {
      elStopReset.addEventListener('click', () => {
        state.stopSearch = '';
        state.stopFilters = { month: '', teacher: '', year: '', campus: '' };
        if (elStopSearch) elStopSearch.value = '';
        renderStopsView();
      });
    }
  }

  function init() {
    syncFilterControls();
    bindFilters();
    switchView('gantt');
    loadSchedule(true);
    startAutoRefresh();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        if (state.view === 'students' || state.view === 'stops') loadStudents(false);
        else loadSchedule(false);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
