(function () {
  'use strict';

  const AXIS_START = 420;
  const AXIS_END = 1320;
  const AUTO_REFRESH_MS = 30 * 1000;
  const DEFAULT_THRESHOLD = 30;
  const DAY_LABELS = {
    1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU',
    5: 'FRI', 6: 'SAT', 7: 'SUN'
  };
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

  const state = {
    records: [],
    updatedAt: null,
    threshold: DEFAULT_THRESHOLD,
    filters: { day: '', block: '', role: '', teacher: '', status: '' },
    view: 'gantt',
    teacherSort: { key: 'hours', dir: 'desc' },
    lastPayloadHash: '',
    refreshTimer: null,
    modalOpen: false
  };

  const $ = (sel) => document.querySelector(sel);

  const elDay = $('#filter-day');
  const elBlock = $('#filter-block');
  const elRole = $('#filter-role');
  const elTeacher = $('#filter-teacher');
  const elStatus = $('#filter-status');
  const elThreshold = $('#threshold');
  const elRefresh = $('#refresh');
  const elReset = $('#reset');
  const elGantt = $('#gantt-root');
  const elSummary = $('#summary');
  const elTeachersSummary = $('#teachers-summary');
  const elTeachersTable = $('#teachers-table');
  const elTeachersHeatmap = $('#teachers-heatmap');
  const elMeta = $('#meta');
  const elModalRoot = $('#modal-root');
  const elViewGantt = $('#view-gantt');
  const elViewTeachers = $('#view-teachers');

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

  function getRecordStatus(rec, threshold) {
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
    if (r.teacherRatio > threshold || r.manpowerRatio > threshold) {
      return { kind: 'overloaded', label: '超标', detail: '超标', ...r };
    }
    if (r.teacherRatio >= threshold * 0.8 || r.manpowerRatio >= threshold * 0.8) {
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
        const s = getRecordStatus(rec, state.threshold);
        if (s.kind !== f.status) return false;
      }
      return true;
    });
  }

  function unique(arr) { return Array.from(new Set(arr)); }

  function populateFilterOptions() {
    const days = unique(state.records.map((r) => r.day).filter(Boolean))
      .sort((a, b) => (parseInt(a) || 99) - (parseInt(b) || 99));
    const blocks = unique(state.records.map((r) => r.block).filter(Boolean)).sort();
    const teachers = unique(state.records.flatMap((r) => [
      ...r.daycareTeachers, ...r.teachingTeachers, ...r.assistants, ...r.assistantTeachers
    ])).sort((a, b) => a.localeCompare(b, 'zh'));

    fillSelect(elDay, days, state.filters.day);
    fillSelect(elBlock, blocks, state.filters.block);
    fillSelect(elTeacher, teachers, state.filters.teacher);
  }

  function fillSelect(el, options, current) {
    const previous = current || el.value;
    el.innerHTML = '<option value="">全部</option>' +
      options.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (previous && options.includes(previous)) el.value = previous;
  }

  /* ============================================================
     GANTT VIEW
  ============================================================ */

  function renderSummary(filtered) {
    const total = filtered.length;
    let crisis = 0, overloaded = 0, warning = 0, noStudent = 0;
    let maxTeacherRatio = 0, maxManpowerRatio = 0;
    for (const rec of filtered) {
      const s = getRecordStatus(rec, state.threshold);
      if (s.kind === 'crisis') crisis++;
      else if (s.kind === 'overloaded') overloaded++;
      else if (s.kind === 'warning') warning++;
      else if (s.kind === 'no-student') noStudent++;
      if (rec.studentCount > 0) {
        if (isFinite(s.teacherRatio) && s.teacherRatio > maxTeacherRatio) maxTeacherRatio = s.teacherRatio;
        if (isFinite(s.manpowerRatio) && s.manpowerRatio > maxManpowerRatio) maxManpowerRatio = s.manpowerRatio;
      }
    }
    const cards = [
      { label: '总时段数', value: total, cls: '' },
      { label: '危机时段数', value: crisis, cls: 'crisis' },
      { label: '超标时段数', value: overloaded, cls: 'overloaded' },
      { label: '警戒时段数', value: warning, cls: 'warning' },
      { label: '无学生时段数', value: noStudent, cls: 'no-student' },
      { label: '最高老师学生比', value: maxTeacherRatio > 0 ? `${fmtRatio(maxTeacherRatio)}:1` : '—', cls: '' },
      { label: '最高人手学生比', value: maxManpowerRatio > 0 ? `${fmtRatio(maxManpowerRatio)}:1` : '—', cls: '' }
    ];
    elSummary.innerHTML = cards.map((c) => `
      <div class="card ${c.cls}">
        <div class="label">${escapeHtml(c.label)}</div>
        <div class="value">${escapeHtml(String(c.value))}</div>
      </div>
    `).join('');
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

  function renderBar(rec, idx) {
    if (rec.startMinutes == null || rec.endMinutes == null || rec.endMinutes <= rec.startMinutes) return '';
    const start = Math.max(rec.startMinutes, AXIS_START);
    const end = Math.min(rec.endMinutes, AXIS_END);
    if (end <= start) return '';
    const left = start - AXIS_START;
    const width = end - start;
    const status = getRecordStatus(rec, state.threshold);

    const teacherStr = status.teacherCount > 0 ? `T ${fmtRatio(status.teacherRatio)}:1` : 'T 无老师';
    const manpowerStr = status.manpowerCount > 0 ? `M ${fmtRatio(status.manpowerRatio)}:1` : 'M 无人手';
    const block = shortBlock(rec.block) || rec.block;

    return `<div class="bar ${status.kind}" data-idx="${idx}"
      style="left: calc(${left} * var(--minute-w)); width: calc(${width} * var(--minute-w));"
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
        labelsHtml.push(`<div class="row-label">${escapeHtml(shortBlock(block))}</div>`);
        const bars = recs.map((rec) => renderBar(rec, indexMap.get(rec))).join('');
        rowsHtml.push(`<div class="row">${bars}</div>`);
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
    for (const rec of records) {
      const hours = recordHours(rec);
      if (hours <= 0) continue;
      const totalManpower = ROLE_KEYS.reduce(
        (sum, k) => sum + (rec[ROLE_FIELD[k]] || []).length, 0);
      const sharePerPerson = totalManpower > 0 ? rec.studentCount / totalManpower : 0;

      for (const role of ROLE_KEYS) {
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
              records: []
            });
          }
          const s = map.get(name);
          s.roles.add(role);
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

    const cards = [
      { label: '老师总数', value: totalTeachers, cls: '' },
      { label: 'DAYCARE 老师', value: byRole.daycare, cls: '' },
      { label: '教书老师', value: byRole.teaching, cls: '' },
      { label: '助理', value: byRole.assistant, cls: '' },
      { label: '助教', value: byRole.assistantTeacher, cls: '' },
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
      return `<tr data-name="${escapeHtml(t.name)}">${cells}<td class="bar-cell"><div class="hbar"><span style="width:${pct.toFixed(1)}%; background: var(--role-${t.role})"></span></div></td></tr>`;
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

  function renderTeachersView(filtered) {
    const stats = computeTeacherStats(filtered);
    renderTeachersSummary(stats, filtered);
    renderTeachersTable(stats);
    renderTeachersHeatmap(stats);
  }

  /* ============================================================
     DETAIL MODALS
  ============================================================ */

  function openSlotDetail(rec) {
    const s = getRecordStatus(rec, state.threshold);
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
          <div class="actions">
            <button id="modal-close" type="button">关闭</button>
          </div>
        </div>
      </div>
    `;
    bindModalCommon();
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
    document.querySelectorAll('.tabs button').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === view);
    });
    document.querySelectorAll('[data-view-only]').forEach((el) => {
      el.style.display = el.getAttribute('data-view-only') === view ? '' : 'none';
    });
    rerender();
  }

  function rerender() {
    const filtered = applyFilters(state.records);
    if (state.view === 'gantt') {
      renderSummary(filtered);
      renderGantt(filtered);
    } else {
      renderTeachersView(filtered);
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

  function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshTimer = setInterval(() => {
      if (document.hidden || state.modalOpen) return;
      loadSchedule(false);
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
    elThreshold.addEventListener('input', () => {
      const v = parseFloat(elThreshold.value);
      state.threshold = isFinite(v) && v > 0 ? v : DEFAULT_THRESHOLD;
      rerender();
    });
    elRefresh.addEventListener('click', () => loadSchedule(false));
    elReset.addEventListener('click', () => {
      state.filters = { day: '', block: '', role: '', teacher: '', status: '' };
      elDay.value = ''; elBlock.value = ''; elRole.value = '';
      elTeacher.value = ''; elStatus.value = '';
      rerender();
    });
    document.querySelectorAll('.tabs button').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.getAttribute('data-view')));
    });
  }

  function init() {
    bindFilters();
    switchView('gantt');
    loadSchedule(true);
    startAutoRefresh();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) loadSchedule(false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
