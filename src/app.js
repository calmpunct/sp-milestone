(function () {
  'use strict';

  var L = window.Lunar;
  var Core = window.EventCore;
  var DEV_KEY = 'cd-preview-v1';

  function $(s) { return document.querySelector(s); }

  var state = {
    data: Core.emptyData(),
    filter: 'all',
    editingId: null,
    draft: null,
    lastWritten: ''
  };

  /* ================= 插件 API 桥 ================= */

  function hasSync() {
    return !!(window.PluginAPI && typeof window.PluginAPI.loadSyncedData === 'function');
  }

  function apiCall(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    var P = window.PluginAPI;
    if (!P || typeof P[name] !== 'function') {
      return Promise.reject(new Error('API 不可用: ' + name));
    }
    try {
      return Promise.resolve(P[name].apply(P, args));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  var Store = {
    load: function () {
      if (hasSync()) {
        return apiCall('loadSyncedData').then(function (s) { return s || null; }, function () { return null; });
      }
      try { return Promise.resolve(window.localStorage.getItem(DEV_KEY)); }
      catch (e) { return Promise.resolve(null); }
    },
    save: function (str) {
      if (hasSync()) {
        return apiCall('persistDataSynced', str).then(function () { return true; }, function () { return false; });
      }
      try { window.localStorage.setItem(DEV_KEY, str); return Promise.resolve(true); }
      catch (e) { return Promise.resolve(false); }
    }
  };

  /* ================= 工具 ================= */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return [63, 81, 181];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function parseColor(v) {
    if (!v) return null;
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
    if (m) return hexToRgb(v);
    m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(v);
    if (m) return [+m[1], +m[2], +m[3]];
    return null;
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#cdToast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 1800);
  }

  function detectTheme() {
    var html = document.documentElement;
    var cs = window.getComputedStyle(html);
    var flag = (cs.getPropertyValue('--is-dark-theme') || '').trim();
    var dark = null;
    if (flag === '1') dark = true;
    else if (flag === '0') dark = false;
    if (dark === null) {
      var rgb = parseColor((cs.getPropertyValue('--bg') || '').trim());
      if (rgb) dark = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) < 128;
    }
    if (dark === null) {
      dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    var next = dark ? 'dark' : 'light';
    if (html.getAttribute('data-cd-theme') !== next) html.setAttribute('data-cd-theme', next);
  }

  /* ================= 渲染 ================= */

  /**
   * 每条记录的时间语义
   *   · 倒数 / 生日  → 剩余天数（还没到）
   *   · 纪念日       → 已过天数（从最初那天算起，只会变大）
   *   · 一次性倒数已过期 → 转成已过天数
   */
  function metricOf(ev, occ, today) {
    if (!occ || !occ.date) return { mode: 'none', days: 0, date: null };
    if (ev.kind === 'anniversary') {
      var base = Core.parseYMD(ev.date);
      if (!base) return { mode: 'none', days: 0, date: null };
      var passed = Core.diffDays(base, today);
      return passed >= 0
        ? { mode: 'elapsed', days: passed, date: base }
        : { mode: 'remaining', days: -passed, date: base };
    }
    if (occ.isPast) return { mode: 'elapsed', days: -occ.days, date: occ.date };
    return { mode: 'remaining', days: occ.days, date: occ.date };
  }

  function computeRows() {
    var today = new Date();
    return state.data.events.map(function (ev) {
      var occ = Core.nextOccurrence(ev, today);
      return {
        ev: ev, occ: occ,
        years: Core.yearsSince(ev, occ),
        metric: metricOf(ev, occ, today)
      };
    });
  }

  /** 排序：倒数在前（剩余越少越前），已过的在后（越久越前） */
  function sortRows(list) {
    function group(r) {
      return r.metric.mode === 'remaining' ? 0 : (r.metric.mode === 'elapsed' ? 1 : 2);
    }
    return list.sort(function (a, b) {
      var ga = group(a), gb = group(b);
      if (ga !== gb) return ga - gb;
      return ga === 1 ? b.metric.days - a.metric.days : a.metric.days - b.metric.days;
    });
  }

  function ageText(r) {
    if (!r.years) return '';
    // 生日的年龄已并入名称，这里只处理纪念日
    if (r.ev.kind === 'anniversary') return r.years + ' 周年';
    return '';
  }

  /** 名称（生日带年龄，如「我妈生日（55岁）」） */
  function nameOf(ev) {
    return Core.titleOf(ev, Core.ageOn(ev, new Date()));
  }

  function renderSub(rows, archivedCount) {
    var el = $('#cdSub');
    if (isArchiveView()) {
      el.textContent = archivedCount
        ? archivedCount + ' 个已归档 · 不参与提醒'
        : '归档里还没有日子';
      return;
    }
    if (!rows.length) {
      el.textContent = state.filter === 'all'
        ? '还没有记录，添加一个重要的日子吧'
        : '这个分类还没有记录';
      return;
    }
    var kindName = Core.KINDS[state.filter];
    var txt = rows.length + ' 个' + (kindName || '日子');

    var todayCount = rows.filter(function (r) { return r.metric.days === 0 && r.metric.mode !== 'none'; }).length;
    var near = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].metric.mode === 'remaining') { near = rows[i]; break; }
    }
    if (todayCount) txt += ' · 今天 ' + todayCount + ' 个';
    else if (near) txt += ' · 最近 ' + near.metric.days + ' 天';
    if (state.filter === 'all' && archivedCount) txt += ' · 归档 ' + archivedCount + ' 个';
    el.textContent = txt;
  }

  /** 归档筛选胶囊上的计数 */
  function renderArchiveEntry(count) {
    var chip = document.querySelector('.cd-chip[data-f="archive"]');
    if (chip) chip.textContent = count ? '归档 ' + count : '归档';
  }

  /** 分区为空时的等高占位，避免切换分类时卡片突然消失、页面跳动 */
  function renderHeroPlaceholder(title, hint) {
    var el = $('#cdHero');
    el.style.setProperty('--cd-rc', '128, 138, 155');
    el.innerHTML =
      '<div class="cd-hero cd-hero--empty">' +
        '<div class="cd-hero-label">' + esc(title) + '</div>' +
        '<div class="cd-hero-num cd-hero-num--empty">—</div>' +
        '<div class="cd-hero-meta">' + esc(hint) + '</div>' +
      '</div>';
  }

  function heroEmptyText() {
    if (isArchiveView()) return ['归档', '归档里的日子不参与置顶'];
    var kindName = Core.KINDS[state.filter];
    if (kindName) return [kindName, '这个分类还没有记录'];
    return ['里程碑', '点右上角「添加」记下第一个日子'];
  }

  function renderHero(row) {
    var el = $('#cdHero');
    if (!row || row.metric.mode === 'none') {
      var t = heroEmptyText();
      renderHeroPlaceholder(t[0], t[1]);
      return;
    }

    var ev = row.ev;
    var occ = row.occ;
    var m = row.metric;
    var remain = m.mode === 'remaining';
    var rgb = hexToRgb(ev.color).join(',');
    el.style.setProperty('--cd-rc', rgb);

    var label = remain
      ? '距离 <b>' + esc(nameOf(ev)) + '</b> 还有'
      : '<b>' + esc(nameOf(ev)) + '</b> 已经走过';

    var heroCls = remain ? 'cd-hero-num cd-hero-num--remain' : 'cd-hero-num cd-hero-num--elapsed';
    var num = '<div class="' + heroCls + '">' +
        m.days + '<span>' + (remain ? '剩余天数' : '已过天数') + '</span></div>';

    var lf = L.solarToLunar(occ.date);
    var meta = [
      Core.cnDate(occ.date),
      L.lunarText(lf.month, lf.day, lf.isLeap),
      ageText(row)
    ].filter(Boolean).join('<i class="sep">·</i>');

    var bar = '';
    var p = Core.cycleProgress(ev, occ);
    if (p !== null) {
      bar =
        '<div class="cd-bar"><i style="width:' + Math.round(p * 100) + '%"></i></div>' +
        '<div class="cd-bar-text"><span>本年度已过 ' + Math.round(p * 100) + '%</span><span>共 365 天</span></div>';
    }

    el.innerHTML =
      '<div class="cd-hero" data-id="' + esc(ev.id) + '">' +
        '<div class="cd-hero-label">' + label + '</div>' +
        num +
        '<div class="cd-hero-meta">' + meta + '</div>' +
        bar +
      '</div>';
  }

  /** 倒数日已经过期（关掉了「过期后重新开始倒数」，且日子已经过去） */
  function isExpiredCountdown(ev, m) {
    return ev.kind === 'countdown' && m.mode === 'elapsed';
  }

  /** 过期倒数日是否要划掉名称，取决于设置 */
  function isDoneCountdown(ev, m) {
    if (!isExpiredCountdown(ev, m)) return false;
    var st = state.data.settings || Core.emptySettings();
    return st.strikeExpired !== false;
  }

  function itemHtml(r) {
    var ev = r.ev;
    var m = r.metric;
    var rgb = hexToRgb(ev.color).join(',');
    var isToday = m.mode !== 'none' && m.days === 0;
    var expired = isExpiredCountdown(ev, m);
    var done = isDoneCountdown(ev, m);

    var numText, unitText, numCls = '';
    if (m.mode === 'none') {
      numText = '—';
      unitText = '超出可算年限';
    } else if (m.mode === 'remaining') {
      numText = String(m.days);
      unitText = m.days === 0 ? '就是今天' : '剩余天数';
      numCls = ' cd-item-num--remain';
    } else {
      numText = String(m.days);
      unitText = m.days === 0 ? '就在今天' : '已过天数';
      numCls = ' cd-item-num--elapsed';
    }

    var sub = Core.dateLabel(ev, r.occ);
    var age = ageText(r);
    if (age) sub += ' · ' + age;

    var bell = Core.hasReminder(ev)
      ? '<svg class="cd-bell" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
        ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>'
      : '';

    var tag;
    if (isArchiveView()) {
      tag = '<span class="cd-tag cd-tag--muted">已归档 · ' + esc(Core.KINDS[ev.kind]) + '</span>';
    } else if (expired) {
      // 过期了就把类型标签换成更直白的说法，一眼看得出这条已经结束
      tag = '<span class="cd-tag cd-tag--expired">过期的倒数日</span>';
    } else {
      tag = '<span class="cd-tag">' + esc(Core.KINDS[ev.kind]) + '</span>';
    }

    return '<div class="cd-item' + (isToday ? ' is-today' : '') + '" data-id="' + esc(ev.id) + '"' +
        ' style="--cd-rc:' + rgb + ';--cd-rc-color:rgb(' + rgb + ')" role="button" tabindex="0">' +
        '<div class="cd-item-main">' +
          '<div class="cd-item-title"><em' + (done ? ' class="cd-item-name--done"' : '') + '>' +
            '<span>' + esc(nameOf(ev)) + '</span>' +
            '</em>' + bell + tag + '</div>' +
          '<div class="cd-item-sub">' + esc(sub) + '</div>' +
        '</div>' +
        '<div class="cd-item-num' + numCls + '">' +
          '<b' + (m.mode === 'none' ? ' class="is-txt"' : '') + '>' + numText + '</b>' +
          '<i>' + unitText + '</i>' +
        '</div>' +
      '</div>';
  }

  function emptyHtml() {
    if (isArchiveView()) {
      return '<div class="cd-empty">' +
          '<div class="cd-empty-ico">' +
            '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
              '<rect x="3" y="4" width="18" height="4" rx="1.4"/><path d="M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8"/>' +
              '<path d="M10 12h4"/></svg>' +
          '</div>' +
          '<h3>归档里还没有日子</h3>' +
          '<p>把不重要的日子归档后，它们不会出现在「全部」里，也不会提醒。随时可以取消归档。</p>' +
          '<button type="button" class="cd-btn-ghost" data-add>添加一个归档的日子</button>' +
        '</div>';
    }
    var filtered = state.filter !== 'all';
    var kindName = Core.KINDS[state.filter] || '';
    var head = filtered ? '这个分类还是空的' : '记录第一个重要的日子';
    var desc = filtered ? '点下面的按钮，会自动按「' + kindName + '」新建；也可以换一个筛选看看。' : '生日、纪念日、考试倒数，都能自动帮你算好还有多久。';
    return '<div class="cd-empty">' +
        '<div class="cd-empty-ico">' +
          '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
            '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>' +
            '<circle cx="12" cy="16" r="2.2"/></svg>' +
        '</div>' +
        '<h3>' + head + '</h3>' +
        '<p>' + desc + '</p>' +
        '<button type="button" class="cd-btn-ghost" data-add>添加一个' + (kindName || '日子') + '</button>' +
      '</div>';
  }

  function renderList(list) {
    var el = $('#cdList');
    el.innerHTML = list.length ? list.map(itemHtml).join('') : emptyHtml();
  }

  /** 当前是否在「归档」视图 */
  function isArchiveView() {
    return state.filter === 'archive';
  }

  /** 按当前视图与分类筛选出要显示的行 */
  function visibleRows(all) {
    if (isArchiveView()) {
      return all.filter(function (r) { return !!r.ev.archived; });
    }
    return all.filter(function (r) {
      if (r.ev.archived) return false;
      return state.filter === 'all' || r.ev.kind === state.filter;
    });
  }

  function renderAll() {
    var all = sortRows(computeRows());
    var active = all.filter(function (r) { return !r.ev.archived; });
    var archivedCount = all.length - active.length;
    var rows = visibleRows(all);
    var settings = state.data.settings || Core.emptySettings();

    if (settings.hero === false) {
      var hero = $('#cdHero');
      hero.innerHTML = '';
    } else {
      // 置顶卡片跟随当前分区：取该分区排序后的第一条；归档视图不置顶
      var first = null;
      if (!isArchiveView()) {
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].metric.mode !== 'none') { first = rows[i]; break; }
        }
      }
      renderHero(first);
    }

    renderList(rows);
    renderSub(rows, archivedCount);
    renderArchiveEntry(archivedCount);

    Array.prototype.forEach.call(document.querySelectorAll('.cd-chip'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.f === state.filter));
    });
  }

  /* ================= 表单 ================= */

  function segValue(sel) {
    var b = document.querySelector(sel + ' button[aria-pressed="true"]');
    return b ? b.dataset.v : null;
  }

  function setSeg(sel, v) {
    Array.prototype.forEach.call(document.querySelectorAll(sel + ' button'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.v === v));
    });
  }

  /** 新建记录的默认类型；「全部」视图下沿用生日作为默认 */
  var DEFAULT_KIND = 'birthday';

  function kindOfFilter(f) {
    return Core.KINDS[f] ? f : DEFAULT_KIND;
  }

  function newDraft(kind) {
    var today = new Date();
    var lf = L.solarToLunar(today);
    return {
      id: null,
      title: '',
      kind: Core.KINDS[kind] ? kind : DEFAULT_KIND,
      calendar: 'solar',
      date: Core.ymd(today),
      lunar: { year: lf.year, month: lf.month, day: lf.day, isLeap: false },
      term: null,
      preset: null,
      // 节日预设的多选列表（批量添加用），保存时每个预设生成一条
      presets: [],
      repeat: true,
      color: Core.COLORS[0],
      note: '',
      pinned: false,
      // 新日子默认加入任务列表，渠道可在此页单独改
      remind: Core.defaultRemind(),
      // 在归档视图里新建，默认就是归档状态，符合「我要放一个不重要的日子」
      archived: isArchiveView()
    };
  }

  function buildYearSelect() {
    var html = '';
    for (var y = L.MIN_YEAR; y <= L.MAX_YEAR; y++) html += '<option value="' + y + '">' + y + ' 年</option>';
    $('#fLY').innerHTML = html;
  }

  function buildMonthSelect() {
    var html = '';
    for (var m = 1; m <= 12; m++) html += '<option value="' + m + '">' + L.monthName(m, false) + '</option>';
    $('#fLM').innerHTML = html;
  }

  function buildDaySelect(y, m, isLeap, keep) {
    var dim = isLeap ? L.leapDays(y) : L.monthDays(y, m);
    if (!dim) dim = 30;
    var html = '';
    for (var d = 1; d <= dim; d++) html += '<option value="' + d + '">' + L.dayName(d) + '</option>';
    var sel = $('#fLD');
    sel.innerHTML = html;
    sel.value = String(Math.min(keep || 1, dim));
  }

  function buildColors(selected) {
    $('#fColors').innerHTML = Core.COLORS.map(function (c) {
      return '<button type="button" class="cd-color" data-c="' + c + '" aria-pressed="' +
        (c === selected ? 'true' : 'false') + '" style="background:' + c + ';color:' + c +
        '" aria-label="颜色 ' + c + '"></button>';
    }).join('');
  }

  /** 渲染两个提醒渠道的开关与天数多选 */
  function renderRemind(remind) {
    var rm = remind || Core.defaultRemind();
    $('#fTask').checked = rm.task !== false;
    $('#fSnack').checked = rm.snack === true;
    $('#fOffsets').hidden = !(rm.task || rm.snack);
    var list = rm.offsets || [];
    Array.prototype.forEach.call(document.querySelectorAll('#fOffsets button'), function (b) {
      b.setAttribute('aria-pressed', String(list.indexOf(+b.dataset.d) !== -1));
    });
  }

  function currentLunar() {
    return {
      year: +$('#fLY').value,
      month: +$('#fLM').value,
      day: +$('#fLD').value,
      isLeap: $('#fLeap').checked && !$('#fLeapWrap').hidden
    };
  }

  function updateLunarPreview() {
    var l = currentLunar();
    var p = $('#fLunarPreview');
    var solar = L.lunarToSolar(l.year, l.month, l.day, l.isLeap);
    if (!solar) {
      p.className = 'cd-hint warn';
      p.textContent = '这个农历日期不存在，请调整年份或月份';
      return;
    }
    var dim = l.isLeap ? L.leapDays(l.year) : L.monthDays(l.year, l.month);
    p.className = 'cd-hint';
    p.textContent = L.lunarText(l.month, l.day, l.isLeap) +
      '，对应公历 ' + Core.ymd(solar) + ' ' + Core.WEEK[solar.getDay()] +
      ' · ' + L.ganzhiOf(l.year) + '年 · 属' + L.zodiacOf(l.year) +
      (l.day > dim ? '（该月仅 ' + dim + ' 天，按' + L.dayName(dim) + '计）' : '');
  }

  function syncLunarControls(resetDay) {
    var y = +$('#fLY').value;
    var m = +$('#fLM').value;
    var canLeap = L.leapMonth(y) === m;
    $('#fLeapWrap').hidden = !canLeap;
    if (!canLeap) $('#fLeap').checked = false;
    buildDaySelect(y, m, canLeap && $('#fLeap').checked, resetDay ? 1 : (+$('#fLD').value || 1));
    updateLunarPreview();
  }

  function solarToLunarFields(solar) {
    var lf = L.solarToLunar(solar);
    $('#fLY').value = String(lf.year);
    $('#fLM').value = String(lf.month);
    $('#fLeap').checked = !!lf.isLeap;
    $('#fLeapWrap').hidden = !(L.leapMonth(lf.year) === lf.month);
    buildDaySelect(lf.year, lf.month, !!lf.isLeap, lf.day);
    $('#fLD').value = String(lf.day);
    updateLunarPreview();
  }

  /* ---- 节日预设 ---- */

  /** 预设按钮按 公历 / 农历 / 节气 分组渲染，末尾是「自定义」 */
  function buildPresets() {
    var html = '';
    ['solar', 'lunar', 'term'].forEach(function (g) {
      var items = Core.FESTIVALS.filter(function (f) { return f.group === g; });
      if (!items.length) return;
      html += '<div class="cd-preset-group">' + Core.FESTIVAL_GROUPS[g] + '</div>' +
        '<div class="cd-preset-list">' + items.map(function (f) {
          return '<button type="button" class="cd-preset" data-k="' + f.key + '" aria-pressed="false">' +
            esc(f.name) + '</button>';
        }).join('') + '</div>';
    });
    html += '<div class="cd-preset-group">自定义</div>' +
      '<div class="cd-preset-list">' +
        '<button type="button" class="cd-preset cd-preset--free" data-k="" aria-pressed="false">自定义节日</button>' +
      '</div>';
    $('#fPresets').innerHTML = html;
  }

  /** 高亮选中的预设；「自定义」在没有选中任何预设时是按下态 */
  function markPreset(keys) {
    var on = keys || [];
    Array.prototype.forEach.call(document.querySelectorAll('#fPresets .cd-preset'), function (b) {
      var k = b.dataset.k || '';
      var pressed = k === '' ? on.length === 0 : on.indexOf(k) !== -1;
      b.setAttribute('aria-pressed', String(pressed));
    });
  }

  /** 草稿里选中的预设列表 */
  function selectedPresets() {
    var d = state.draft;
    if (!d || !d.presets) return [];
    return d.presets;
  }

  function refreshPresetRow(kind) {
    var on = (kind || segValue('#fKind')) === 'festival';
    $('#fPresetWrap').hidden = !on;
    if (on) {
      markPreset(selectedPresets());
      refreshPresetHint();
    }
    refreshArchiveRow();
    refreshSaveLabel();
  }

  /** 节日每年都会再来，不存在「归档」这回事，所以直接不显示这个开关 */
  function refreshArchiveRow() {
    var wrap = $('#fArchiveWrap');
    if (!wrap) return;
    var kind = segValue('#fKind') || 'countdown';
    wrap.hidden = kind === 'festival';
    if (kind === 'festival') $('#fArchived').checked = false;
  }

  /** 保存按钮在批量添加时显示数量，避免用户以为只加了一个 */
  function refreshSaveLabel() {
    var el = $('#cdSave');
    if (!el) return;
    var kind = segValue('#fKind') || 'countdown';
    var n = (!state.editingId && kind === 'festival') ? selectedPresets().length : 0;
    el.textContent = n > 1 ? '添加 ' + n + ' 个' : '保存';
  }

  function refreshPresetHint() {
    var el = $('#fPresetHint');
    if (!el) return;
    var keys = selectedPresets();
    el.className = 'cd-hint';

    if (!keys.length) {
      el.textContent = '选一个节日自动填好日期；也可多选几个一次加入，或选「自定义节日」自己填。';
      return;
    }

    if (keys.length > 1) {
      var names = keys.map(function (k) {
        var f = Core.festivalByKey(k);
        return f ? f.name : k;
      });
      el.textContent = '已选 ' + keys.length + ' 个：' + names.join('、') + '，保存后一次全部加入。';
      return;
    }

    var f = Core.festivalByKey(keys[0]);
    var when = (state.draft && state.draft.date) ? '下一次 ' + state.draft.date + '。' : '';
    var text;
    if (!f) {
      text = '自定义节日：自己填名称和日期，每年自动倒数。';
    } else if (f.group === 'term') {
      text = f.name + '按节气推算，每年落在 4 月 4-5 日，日期会自动更新。';
    } else if (f.key === 'chuxi') {
      text = '除夕按腊月最后一天计算，腊月是廿九天的年份自动按廿九。';
    } else if (f.group === 'lunar') {
      text = f.name + '按农历计算，每年公历日期不同。';
    } else {
      text = f.name + '每年 ' + f.month + ' 月 ' + f.day + ' 日。';
    }
    el.textContent = text + when;
  }

  /**
   * 点预设：创建时多选（再点一次取消），编辑时单选（点别的就换）
   * 「自定义」清空选择，回到自己填日期
   */
  function togglePreset(key) {
    var d = state.draft;
    if (!d) return;
    if (!d.presets) d.presets = [];

    if (!key) {
      d.presets = [];
    } else if (state.editingId) {
      d.presets = d.presets.length === 1 && d.presets[0] === key ? [] : [key];
    } else {
      var i = d.presets.indexOf(key);
      if (i === -1) d.presets.push(key); else d.presets.splice(i, 1);
    }

    applyPresets();
  }

  /** 把当前选中的预设回填到表单：单选填名称/历法/日期/颜色，多选只留在提示里 */
  function applyPresets() {
    var d = state.draft;
    var keys = selectedPresets();

    if (keys.length !== 1) {
      d.preset = null;
      d.term = null;
      if (keys.length > 1) d.title = '';
      markPreset(keys);
      refreshCalendarRow();
      refreshPresetHint();
      refreshSaveLabel();
      return;
    }

    var f = Core.festivalFields(keys[0]);
    if (!f) return;

    d.preset = keys[0];
    d.term = f.term;
    d.title = f.title;
    d.color = f.color;
    d.calendar = f.calendar;
    d.date = f.date;
    d.lunar = f.lunar;
    d.repeat = true;

    $('#fTitle').value = d.title;
    setSeg('#fCalendar', d.calendar);
    $('#fDate').value = d.date;
    buildColors(d.color);

    if (f.calendar === 'lunar' && f.lunar) {
      $('#fLY').value = String(f.lunar.year);
      $('#fLM').value = String(f.lunar.month);
      $('#fLeap').checked = false;
      $('#fLeapWrap').hidden = !(L.leapMonth(f.lunar.year) === f.lunar.month);
      buildDaySelect(f.lunar.year, f.lunar.month, false, f.lunar.day);
      updateLunarPreview();
    } else {
      solarToLunarFields(Core.parseYMD(d.date) || new Date());
    }

    markPreset(keys);
    refreshCalendarRow();
    refreshPresetHint();
    refreshSaveLabel();
  }

  function refreshRepeatRow() {
    var kind = segValue('#fKind');
    $('#fRepeatWrap').hidden = kind !== 'countdown';
    if (kind !== 'countdown') $('#fRepeat').checked = true;
  }

  /**
   * 公历/农历控件只在「自定义」时出现：预设已经把日期算好了，再摆一堆下拉框只会让人困惑
   * 多选时名称也没有意义（每个节日用自己的名字），一并隐藏
   */
  function isCustomDate() {
    var kind = segValue('#fKind') || 'countdown';
    if (kind !== 'festival') return true;
    return selectedPresets().length === 0;
  }

  function refreshCalendarRow() {
    var cal = segValue('#fCalendar');
    var custom = isCustomDate();
    var multi = selectedPresets().length > 1;
    if ($('#fTitleWrap')) $('#fTitleWrap').hidden = multi;
    // 多选时每条用自己的节日配色，颜色选择器没有意义
    if ($('#fColorWrap')) $('#fColorWrap').hidden = multi;
    $('#fCalendarWrap').hidden = !custom;
    $('#fSolarWrap').hidden = !custom || cal !== 'solar';
    $('#fLunarWrap').hidden = !custom || cal !== 'lunar';
  }

  function fillSheet(d, isEdit) {
    $('#cdSheetTitle').textContent = isEdit ? '编辑日子' : '新建' + (Core.KINDS[d.kind] || '日子');
    $('#fTitle').value = d.title || '';
    $('#fNote').value = d.note || '';
    setSeg('#fKind', d.kind);
    setSeg('#fCalendar', d.calendar);
    $('#fDate').value = d.date || Core.ymd(new Date());
    $('#fRepeat').checked = !!d.repeat;
    buildColors(d.color);
    renderRemind(d.remind);
    $('#fArchived').checked = !!d.archived;
    if (!d.presets) d.presets = d.preset ? [d.preset] : [];
    refreshRepeatRow();
    refreshCalendarRow();
    refreshPresetRow(d.kind);
    if (d.calendar === 'lunar' && d.lunar) {
      $('#fLY').value = String(d.lunar.year);
      $('#fLM').value = String(d.lunar.month);
      $('#fLeapWrap').hidden = !(L.leapMonth(d.lunar.year) === d.lunar.month);
      $('#fLeap').checked = !!d.lunar.isLeap && !$('#fLeapWrap').hidden;
      buildDaySelect(d.lunar.year, d.lunar.month, $('#fLeap').checked, d.lunar.day);
      $('#fLD').value = String(d.lunar.day);
      updateLunarPreview();
    } else {
      solarToLunarFields(Core.parseYMD(d.date) || new Date());
    }
    $('#cdDelete').hidden = !isEdit;
    refreshRemindHint();
  }

  /* ================= 提醒设置 ================= */

  /** 表单里的说明随渠道组合实时变化，避免用户以为关掉了却还在被提醒 */
  function refreshRemindHint() {
    var el = $('#fRemindHint');
    if (!el) return;
    var taskOn = !!($('#fTask') && $('#fTask').checked);
    var snackOn = !!($('#fSnack') && $('#fSnack').checked);
    var archived = !!($('#fArchived') && $('#fArchived').checked);
    var project = (state.data.settings || Core.emptySettings()).taskProject;

    if (archived) {
      el.className = 'cd-hint warn';
      el.textContent = '已归档：不在「全部」里显示，也不会提醒，任务列表里的对应任务会被删除。';
      return;
    }
    if (taskOn && snackOn) {
      el.className = 'cd-hint';
      el.textContent = '到日子会生成一条任务放进「' + project + '」，并在打开应用时额外弹提示条。';
    } else if (taskOn) {
      el.className = 'cd-hint';
      el.textContent = '到日子会生成一条任务放进「' + project + '」项目，随应用同步；关掉这个开关，任务会被删除。';
    } else if (snackOn) {
      el.className = 'cd-hint';
      el.textContent = '只在打开应用时弹提示条；插件没有系统级后台推送权限，应用没开就不推送。';
    } else {
      el.className = 'cd-hint warn';
      el.textContent = '这个日子不会提醒你（两个渠道都关着）。';
    }
  }

  /* ================= 设置 ================= */

  var setTimer = null;

  function refreshSettingsForm() {
    var st = state.data.settings || Core.emptySettings();
    $('#sHero').checked = st.hero !== false;
    $('#sStrike').checked = st.strikeExpired !== false;
    var meta = document.querySelector('meta[name="cd-version"]');
    var ver = meta ? (meta.getAttribute('content') || '') : '';
    $('#sAbout').textContent = '里程碑' + (ver ? ' v' + ver : '') +
      ' · 提醒任务写入项目「' + st.taskProject + '」· 数据随应用同步';
  }

  function openSettings() {
    refreshSettingsForm();
    var layer = $('#cdSetLayer');
    clearTimeout(setTimer);
    layer.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { document.body.classList.add('cd-open'); });
    });
  }

  function closeSettings() {
    document.body.classList.remove('cd-open');
    document.body.style.overflow = '';
    clearTimeout(setTimer);
    setTimer = setTimeout(function () { $('#cdSetLayer').hidden = true; }, 340);
  }

  function updateSetting(key, value) {
    if (!state.data.settings) state.data.settings = Core.emptySettings();
    state.data.settings[key] = value;
    renderAll();
    persist();
    refreshSettingsForm();
    toast('已保存');
  }

  var sheetTimer = null;
  function openSheet(id) {
    state.editingId = id || null;
    var ev = null;
    if (id) {
      for (var i = 0; i < state.data.events.length; i++) {
        if (state.data.events[i].id === id) { ev = state.data.events[i]; break; }
      }
    }
    state.draft = ev ? JSON.parse(JSON.stringify(ev)) : newDraft(kindOfFilter(state.filter));
    fillSheet(state.draft, !!ev);

    var layer = $('#cdLayer');
    clearTimeout(sheetTimer);
    layer.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { document.body.classList.add('cd-open'); });
    });
  }

  function closeSheet() {
    document.body.classList.remove('cd-open');
    document.body.style.overflow = '';
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(function () {
      $('#cdLayer').hidden = true;
      state.editingId = null;
    }, 340);
  }

  /** 表单里的提醒渠道与天数（批量添加时每条共用同一份） */
  function formRemind() {
    var offs = Array.prototype.slice.call(
      document.querySelectorAll('#fOffsets button[aria-pressed="true"]')
    ).map(function (b) { return +b.dataset.d; });
    offs.sort(function (a, b) { return a - b; });
    // 两个渠道各自独立；选了渠道但没勾天数时，默认按当天提醒
    var taskOn = $('#fTask').checked;
    var snackOn = $('#fSnack').checked;
    return {
      task: taskOn,
      snack: snackOn,
      // 兼容字段：仍在使用 2.0 的客户端读到 on 才知道「有提醒」
      on: taskOn || snackOn,
      offsets: offs.length ? offs : [0]
    };
  }

  function collect() {
    var d = state.draft;
    d.kind = segValue('#fKind') || 'countdown';
    // 名称只存纯文本，年龄不写入数据（仅在渲染时拼接），这里顺手清掉手动输入的年龄后缀
    d.title = Core.cleanTitle(d.kind, $('#fTitle').value.trim().slice(0, 40));
    d.calendar = segValue('#fCalendar') || 'solar';
    d.note = $('#fNote').value.trim().slice(0, 200);
    d.repeat = d.kind !== 'countdown' ? true : $('#fRepeat').checked;
    // 只有节日保留预设标识；切到别的类型时清掉，避免带着节气/预设走
    if (d.kind !== 'festival') { d.preset = null; d.term = null; }
    // 手动改成农历时不可能是节气
    if (d.calendar !== 'solar') d.term = null;

    // 用户手动改了历法，就不再算这个预设（否则提示与实际日期对不上）
    var fp = d.preset ? Core.festivalByKey(d.preset) : null;
    if (fp && (fp.group === 'lunar' ? 'lunar' : 'solar') !== d.calendar) {
      d.preset = null;
      fp = null;
    }
    var picked = document.querySelector('#fColors .cd-color[aria-pressed="true"]');
    if (picked) d.color = picked.dataset.c;

    d.remind = formRemind();
    // 节日不参与归档（表单里也不显示这个开关）
    d.archived = d.kind === 'festival' ? false : $('#fArchived').checked;

    if (d.calendar === 'lunar') {
      d.lunar = currentLunar();
      // 除夕这类「月最后一天」的预设：腊月只有廿九天时也记作三十，由核心逻辑回落
      if (fp && fp.group === 'lunar' && fp.day === 30) d.lunar.day = 30;
      var s = L.lunarToSolar(d.lunar.year, d.lunar.month, d.lunar.day, d.lunar.isLeap) ||
        Core.resolveLunar(d.lunar.year, d.lunar.month, d.lunar.day, d.lunar.isLeap, 'regular');
      d.date = s ? Core.ymd(s) : '';
    } else {
      d.date = $('#fDate').value || '';
    }
    return d;
  }

  /**
   * 批量添加选中的预设节日：每个预设一条，名称/历法/日期/颜色各按自己的预设，
   * 提醒渠道、备注、归档这类公共设置共用当前表单
   */
  function saveBatch(keys) {
    var note = $('#fNote').value.trim().slice(0, 200);
    // 节日永远不会归档，不看那个开关
    var archived = false;
    var remind = formRemind();
    var base = Date.now();
    var created = [];

    keys.forEach(function (k) {
      var f = Core.festivalFields(k);
      if (!f) return;
      created.push({
        id: Core.uid(),
        title: f.title,
        kind: 'festival',
        calendar: f.calendar,
        date: f.date,
        lunar: f.lunar,
        term: f.term,
        preset: k,
        repeat: true,
        color: f.color,
        note: note,
        pinned: false,
        remind: {
          task: remind.task,
          snack: remind.snack,
          on: remind.on,
          offsets: remind.offsets.slice()
        },
        archived: archived,
        createdAt: base + created.length
      });
    });

    if (!created.length) { toast('请选择节日'); return; }

    Array.prototype.push.apply(state.data.events, created);
    closeSheet();
    persist();
    renderAll();
    toast('已添加 ' + created.length + ' 个节日');
  }

  function saveSheet() {
    var editing = state.editingId;
    // 新建 + 类型是节日 + 多选了预设 → 一次批量加入
    var kind = segValue('#fKind') || 'countdown';
    var keys = (editing || kind !== 'festival') ? [] : selectedPresets();
    if (keys.length > 1) { saveBatch(keys); return; }

    var d = collect();
    delete d.presets;

    if (!d.title) {
      var pf = d.preset ? Core.festivalByKey(d.preset) : null;
      d.title = pf ? pf.name : Core.KINDS[d.kind];
    }
    if (!d.date) { toast('请选择日期'); return; }

    var events = state.data.events;
    if (editing) {
      for (var i = 0; i < events.length; i++) {
        if (events[i].id === editing) {
          d.id = editing;
          d.createdAt = events[i].createdAt || Date.now();
          events[i] = d;
          break;
        }
      }
    } else {
      d.id = Core.uid();
      d.createdAt = Date.now();
      events.push(d);
    }

    closeSheet();
    persist();
    renderAll();
    toast(editing ? '已更新' : '已添加');
  }

  function confirmDialog(title, okLabel) {
    var label = okLabel || '删除';
    if (window.PluginAPI && typeof window.PluginAPI.openDialog === 'function') {
      return apiCall('openDialog', {
        title: '删除确认',
        htmlContent: '<p>' + esc(title) + '</p>',
        buttons: [{ label: '取消' }, { label: label, color: 'warn', raised: true }]
      }).then(function (r) { return r === label; }, function () { return false; });
    }
    return Promise.resolve(window.confirm(title));
  }

  function deleteEvent() {
    var id = state.editingId;
    if (!id) return;
    var ev = null;
    var events = state.data.events;
    for (var i = 0; i < events.length; i++) if (events[i].id === id) { ev = events[i]; break; }
    if (!ev) return;

    confirmDialog('确定删除「' + nameOf(ev) + '」吗？').then(function (ok) {
      if (!ok) return;
      state.data.events = state.data.events.filter(function (x) { return x.id !== id; });
      closeSheet();
      persist();
      renderAll();
      toast('已删除');
    });
  }

  /* ================= 持久化 ================= */

  var saveTimer = null;

  function persist() {
    var json = JSON.stringify(state.data);
    if (json === state.lastWritten) return;
    state.lastWritten = json;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      Store.save(json).then(function (ok) {
        if (!ok) { state.lastWritten = ''; toast('保存失败，请稍后重试'); }
      });
    }, 200);
  }

  function load() {
    return Store.load().then(function (raw) {
      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          state.data = Core.normalize(parsed);
          state.lastWritten = JSON.stringify(state.data);
        } catch (e) {
          state.data = Core.emptyData();
        }
      }
      renderAll();
    }, function () { renderAll(); });
  }

  function registerHooks() {
    var P = window.PluginAPI;
    if (!P || typeof P.registerHook !== 'function' || !P.Hooks) return;
    var key = P.Hooks.PERSISTED_DATA_CHANGED;
    if (!key) return;
    try {
      P.registerHook(key, function () {
        Store.load().then(function (raw) {
          if (!raw || raw === state.lastWritten) return;
          try {
            var next = Core.normalize(JSON.parse(raw));
            var nextJson = JSON.stringify(next);
            if (nextJson === JSON.stringify(state.data)) return;
            state.data = next;
            state.lastWritten = nextJson;
            renderAll();
            if (!state.editingId) toast('已同步到最新数据');
          } catch (e) { /* 忽略损坏数据 */ }
        });
      });
    } catch (e) { /* 旧版本宿主不支持 */ }
  }

  /* ================= 事件绑定 ================= */

  function bind() {
    $('#cdAdd').addEventListener('click', function () { openSheet(null); });

    $('#cdChips').addEventListener('click', function (e) {
      var b = e.target.closest('.cd-chip');
      if (!b) return;
      state.filter = b.dataset.f;
      renderAll();
    });

    $('#cdList').addEventListener('click', function (e) {
      if (e.target.closest('[data-add]')) { openSheet(null); return; }
      var item = e.target.closest('.cd-item');
      if (item) openSheet(item.dataset.id);
    });

    $('#cdList').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var item = e.target.closest('.cd-item');
      if (item) { e.preventDefault(); openSheet(item.dataset.id); }
    });

    $('#cdHero').addEventListener('click', function (e) {
      var h = e.target.closest('.cd-hero');
      if (h) openSheet(h.dataset.id);
    });

    $('#fKind').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      setSeg('#fKind', b.dataset.v);
      // 预设选择保留（切走再切回不用重选），是否走批量只由保存时的类型决定
      if (!state.draft.presets) state.draft.presets = [];
      refreshRepeatRow();
      refreshPresetRow(b.dataset.v);
      refreshCalendarRow();
      // 新建时标题跟着类型走，编辑时保持「编辑日子」
      if (!state.editingId) $('#cdSheetTitle').textContent = '新建' + (Core.KINDS[b.dataset.v] || '日子');
    });

    $('#fPresets').addEventListener('click', function (e) {
      var b = e.target.closest('.cd-preset');
      if (!b) return;
      togglePreset(b.dataset.k || null);
    });

    $('#fCalendar').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var prev = segValue('#fCalendar');
      setSeg('#fCalendar', b.dataset.v);
      refreshCalendarRow();
      if (b.dataset.v === 'lunar' && prev !== 'lunar') {
        solarToLunarFields(Core.parseYMD($('#fDate').value) || new Date());
      }
    });

    $('#fDate').addEventListener('change', function () {
      if (segValue('#fCalendar') === 'lunar') {
        solarToLunarFields(Core.parseYMD($('#fDate').value) || new Date());
      }
    });

    $('#fLY').addEventListener('change', function () { syncLunarControls(true); });
    $('#fLM').addEventListener('change', function () { syncLunarControls(true); });
    $('#fLD').addEventListener('change', updateLunarPreview);
    $('#fLeap').addEventListener('change', function () { syncLunarControls(false); });

    $('#fColors').addEventListener('click', function (e) {
      var b = e.target.closest('.cd-color');
      if (!b) return;
      buildColors(b.dataset.c);
    });

    function syncOffsets() {
      $('#fOffsets').hidden = !($('#fTask').checked || $('#fSnack').checked);
      refreshRemindHint();
    }
    $('#fTask').addEventListener('change', syncOffsets);
    $('#fSnack').addEventListener('change', syncOffsets);
    $('#fArchived').addEventListener('change', refreshRemindHint);

    $('#fOffsets').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var on = b.getAttribute('aria-pressed') === 'true';
      b.setAttribute('aria-pressed', on ? 'false' : 'true');
    });

    $('#cdSettings').addEventListener('click', openSettings);
    $('#cdSetClose').addEventListener('click', closeSettings);
    $('#cdSetMask').addEventListener('click', closeSettings);
    $('#sHero').addEventListener('change', function () {
      updateSetting('hero', this.checked);
    });
    $('#sStrike').addEventListener('change', function () {
      updateSetting('strikeExpired', this.checked);
    });

    $('#cdSave').addEventListener('click', saveSheet);
    $('#cdCancel').addEventListener('click', closeSheet);
    $('#cdMask').addEventListener('click', closeSheet);
    $('#cdDelete').addEventListener('click', deleteEvent);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#cdLayer').hidden) closeSheet();
      else if (!$('#cdSetLayer').hidden) closeSettings();
    });
  }

  /* ================= 启动 ================= */

  function init() {
    detectTheme();
    buildYearSelect();
    buildMonthSelect();
    buildColors(Core.COLORS[0]);
    buildPresets();
    bind();
    load();
    registerHooks();
    setInterval(detectTheme, 3000);
    window.addEventListener('resize', detectTheme);
  }

  var tries = 0;
  function boot() {
    if (!window.PluginAPI && tries < 40) {
      tries++;
      setTimeout(boot, 50);
      return;
    }
    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
