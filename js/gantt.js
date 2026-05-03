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

  const state = {
    records: [],
    updatedAt: null,
    threshold: DEFAULT_THRESHOLD,
    filters: { day: '', block: '', role: '', teacher: '', status: '' },
    lastPayloadHash: '',
    refreshTimer: null,
    modalOpen: false
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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
  const elMeta = $('#meta');
  const elModalRoot = $('#modal-root');

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

  function shortBlock(name) {
    if (!name) return '';
    return name.replace(/\s*BLOCK\s*/i, ' ').trim();
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
    switch (role) {
      case 'daycare': return rec.daycareTeachers;
      case 'teaching': return rec.teachingTeachers;
      case 'assistant': return rec.assistants;
      case 'assistantTeacher': return rec.assistantTeachers;
      default: return [];
    }
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
      .sort((a, b) => {
        const ao = parseInt(a) || 99;
        const bo = parseInt(b) || 99;
        return ao - bo;
      });
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
      const left = (m - AXIS_START) + 'px';
      const label = `${h}:00`;
      ticks.push(`<div class="tick" style="left: calc(${m - AXIS_START} * var(--minute-w))">${label}</div>`);
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
    const days = Array.from(map.entries()).sort((a, b) => {
      const ao = parseInt(a[0]) || 99;
      const bo = parseInt(b[0]) || 99;
      return ao - bo;
    });
    return days.map(([day, blockMap]) => {
      const blocks = Array.from(blockMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      return { day, blocks };
    });
  }

  function renderBar(rec, idx) {
    if (rec.startMinutes == null || rec.endMinutes == null || rec.endMinutes <= rec.startMinutes) {
      return '';
    }
    const start = Math.max(rec.startMinutes, AXIS_START);
    const end = Math.min(rec.endMinutes, AXIS_END);
    if (end <= start) return '';
    const left = start - AXIS_START;
    const width = end - start;
    const status = getRecordStatus(rec, state.threshold);

    const teacherStr = status.teacherCount > 0
      ? `T ${fmtRatio(status.teacherRatio)}:1`
      : 'T 无老师';
    const manpowerStr = status.manpowerCount > 0
      ? `M ${fmtRatio(status.manpowerRatio)}:1`
      : 'M 无人手';

    const block = shortBlock(rec.block) || rec.block;
    const studentTxt = `${rec.studentCount}人`;

    return `<div class="bar ${status.kind}"
      data-idx="${idx}"
      style="left: calc(${left} * var(--minute-w)); width: calc(${width} * var(--minute-w));"
      title="${escapeHtml(rec.day)} ${escapeHtml(rec.block)} ${escapeHtml(rec.timeRange)}">
      <div class="b1">${escapeHtml(block)}</div>
      <div class="b2">${escapeHtml(studentTxt)}</div>
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
        if (!isNaN(idx) && filtered[idx]) openDetail(filtered[idx]);
      });
    });
  }

  function openDetail(rec) {
    const s = getRecordStatus(rec, state.threshold);
    const dash = (arr) => (arr && arr.length) ? escapeHtml(arr.join('、')) : '<span style="color:var(--muted)">-</span>';
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
    const close = () => closeDetail();
    document.getElementById('modal-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') close();
    });
    document.getElementById('modal-close').addEventListener('click', close);
    document.addEventListener('keydown', escClose);
  }

  function escClose(e) {
    if (e.key === 'Escape') closeDetail();
  }

  function closeDetail() {
    state.modalOpen = false;
    elModalRoot.innerHTML = '';
    document.removeEventListener('keydown', escClose);
  }

  function rerender() {
    const filtered = applyFilters(state.records);
    renderSummary(filtered);
    renderGantt(filtered);
  }

  async function loadSchedule(initial) {
    try {
      const resp = await fetch('/api/schedule?t=' + Date.now(), { cache: 'no-store' });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error('返回非 JSON 数据'); }
      if (!resp.ok || !data.success) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      const hash = String(data.records.length) + '|' + (data.updatedAt || '');
      if (hash === state.lastPayloadHash && !initial) {
        return;
      }
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
  }

  function init() {
    bindFilters();
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
