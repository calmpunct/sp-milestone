(function () {
  'use strict';

  var L = window.Lunar;
  var Core = window.EventCore;
  var I = window.I18N;
  var DEV_KEY = 'cd-preview-v1';

  function $(s) { return document.querySelector(s); }

  /** 当前语言下的文案 */
  function t(key, vars) { return I.t(key, vars); }

  /** 类型名的复数形式（用于「6 个生日」这类计数） */
  function pluralOf(kind) {
    return t('plural.' + (Core.KINDS[kind] ? kind : 'generic'));
  }

  /** 类型名的小写形式（用于「新建生日」「添加一个生日」这类句子） */
  function kindLower(kind) {
    return t('kindl.' + (Core.KINDS[kind] ? kind : 'generic'));
  }

  var state = {
    data: Core.emptyData(),
    filter: 'all',
    editingId: null,
    draft: null,
    lastWritten: '',
    // 清除数据后的一小段时间内忽略同步回写，避免刚清空的数据被旧值拉回来
    clearAt: 0
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

  /* ================= 语言 ================= */

  // 宿主没有给出语言时，用 languageChange 钩子带回的语言码兜底（见下方 hostLang）
  var hostLangCode = '';

  /** 本机系统语言（宿主没有给出语言时兜底） */
  function navLang() {
    try {
      return (window.navigator && window.navigator.language) || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 宿主应用的语言，即「软件里设定的语言」。
   * 19.x 的 PluginAPI.cfg 只有 { theme, appVersion, platform, isDev }，没有 lang，
   * 所以首选 getCurrentLanguage()；老宿主 / 测试桩可能只给 cfg.lang（字符串或 { code }）。
   * languageChange 钩子带回的语言码缓存在 hostLangCode 里，作为最后一道兜底。
   */
  function hostLang() {
    try {
      var P = window.PluginAPI;
      if (P && typeof P.getCurrentLanguage === 'function') {
        var cur = P.getCurrentLanguage();
        if (cur) return cur;
      }
      if (P && P.cfg) {
        var c = P.cfg.lang;
        if (c && typeof c === 'object' && c.code) return c.code;
        if (typeof c === 'string' && c) return c;
      }
    } catch (e) { /* ignore */ }
    return hostLangCode || navLang();
  }

  /** languageChange 的载荷：{ code, newLanguage }，两个字段都认 */
  function payloadLang(payload) {
    if (!payload) return '';
    if (typeof payload === 'string') return payload;
    return payload.code || payload.newLanguage || '';
  }

  /** 当前语言偏好（数据里可能没有这一项） */
  function langPref() {
    return (state.data.settings && state.data.settings.lang) || 'auto';
  }

  /** 设置面板里的语言选择：语言包加进来就自动多一个按钮 */
  function buildLangSeg() {
    var box = $('#sLang');
    if (!box) return;
    var list = I.codes();
    var html = '<button type="button" data-v="auto">' + esc(t('lang.auto')) + '</button>';
    for (var i = 0; i < list.length; i++) {
      html += '<button type="button" data-v="' + esc(list[i]) + '">' + esc(I.nameOf(list[i])) + '</button>';
    }
    box.innerHTML = html;
    setSeg('#sLang', langPref());
  }

  /**
   * 应用语言并刷新所有按语言生成的界面：
   * 静态文案（data-i18n）、农历下拉、节日预设、颜色按钮、语言列表、设置项提示。
   * @param {string} pref auto / 具体语言代码
   */
  function applyLang(pref) {
    var l = I.resolve(pref, hostLang());
    I.setLang(l);
    Core.setLang(l);
    document.documentElement.setAttribute('lang', l);
    document.title = t('appName');
    I.apply(document);
    buildLangSeg();

    buildYearSelect();
    buildMonthSelect();
    buildPresets();
    var layer = $('#cdLayer');
    if (!layer || layer.hidden) buildColors((state.draft && state.draft.color) || Core.COLORS[0]);
    // 表单开着时被切语言：标题是按语言拼的，补回来
    if (layer && !layer.hidden && state.draft) {
      var k = segValue('#fKind') || state.draft.kind;
      $('#cdSheetTitle').textContent = state.editingId
        ? t('sheet.edit')
        : t('sheet.new', { k: kindLower(k) });
    }
  }

  /** 用户切换语言：写进同步数据，让任务投影用同一种语言 */
  function setLangPref(pref) {
    if (!state.data.settings) state.data.settings = Core.emptySettings();
    state.data.settings.lang = I.dictOf(pref) ? pref : 'auto';
    applyLang(state.data.settings.lang);
    renderAll();
    refreshSettingsForm();
    persist();
    toast(t('toast.saved'));
  }

  /* ================= 工具 ================= */

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var ESC_RE = /[&<>"']/g;

  function escChar(c) {
    return ESC_MAP[c];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(ESC_RE, escChar);
  }

  // 颜色参与每次渲染，结果按 hex 缓存，避免重复 parseInt
  var rgbCache = Object.create(null);
  var rgbCacheCount = 0;

  function hexToRgb(hex) {
    var h = String(hex || '');
    var hit = rgbCache[h];
    if (hit) return hit;

    var s = h.replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    var out = isNaN(n) ? [63, 81, 181] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    // 用户自定义颜色理论上无限，缓存加个上限防止长期累积
    if (rgbCacheCount < 128) { rgbCache[h] = out; rgbCacheCount++; }
    return out;
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
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); toastTimer = null; }, 1800);
  }

  function detectTheme() {
    var html = document.documentElement;
    if (!html) return;
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

  /**
   * 主题跟随宿主：宿主切主题时会改 <html>/<body> 的属性或匹配系统深色，
   * 因此用「变化时触发 + 低频兜底」替代原来每 3 秒无条件读一次计算样式
   * （getComputedStyle 会强制样式重算，在后台标签页里纯属浪费）。
   */
  var themeTimer = null;
  var themeObserver = null;

  function isPageHidden() {
    return document.visibilityState === 'hidden' || document.hidden === true;
  }

  function onVisibility() {
    if (!isPageHidden()) detectTheme();
  }

  function watchTheme() {
    if (typeof window.MutationObserver === 'function') {
      try {
        themeObserver = new window.MutationObserver(detectTheme);
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'style', 'data-theme', 'data-cd-theme']
        });
        if (document.body) {
          themeObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'style', 'data-theme']
          });
        }
      } catch (e) {
        themeObserver = null;
      }
    }

    if (window.matchMedia) {
      try {
        var mq = window.matchMedia('(prefers-color-scheme: dark)');
        if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', detectTheme);
        else if (mq && typeof mq.addListener === 'function') mq.addListener(detectTheme);
      } catch (e) { /* 旧 WebView 不支持媒体查询监听 */ }
    }

    document.addEventListener('visibilitychange', onVisibility);

    // 宿主若只改 CSS 变量的值（属性不变），观察器收不到通知，靠这个低频兜底
    if (themeTimer) clearInterval(themeTimer);
    themeTimer = setInterval(function () {
      if (isPageHidden()) return;
      detectTheme();
    }, 8000);
  }

  /** 页面卸载时把定时器/观察器都收掉，避免 iframe 反复重建时残留 */
  function teardown() {
    if (themeTimer) { clearInterval(themeTimer); themeTimer = null; }
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (sheetTimer) { clearTimeout(sheetTimer); sheetTimer = null; }
    if (setTimer) { clearTimeout(setTimer); setTimer = null; }
    if (themeObserver) { themeObserver.disconnect(); themeObserver = null; }
    document.removeEventListener('visibilitychange', onVisibility);
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

  /**
   * 一次性算好这一屏用到的派生数据：下一次发生日、天数语义、日期标签、带年龄的名称。
   * 之前 itemHtml 与 renderHero 各自又算一遍，同一条记录每次渲染要重复换算 2-3 次农历。
   */
  function computeRows(today) {
    return state.data.events.map(function (ev) {
      var occ = Core.nextOccurrence(ev, today);
      return {
        ev: ev,
        occ: occ,
        // 纪念日看「今天已满几年 + 零头天数」，其余看「下次发生那天是第几年」
        span: ev.kind === 'anniversary'
          ? Core.anniversarySpan(ev, today)
          : null,
        metric: metricOf(ev, occ, today),
        label: Core.dateLabel(ev, occ),
        // 生日括号里放「这次生日多少岁」，不是今天多大
        name: Core.titleOf(ev, Core.ageAt(ev, occ, today))
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

  /** 纪念日：已满整年 + 零头天数（「1 周年 34 天」）；不满一年返回空，只显示已过天数 */
  function ageText(r) {
    if (r.ev.kind !== 'anniversary' || !r.span) return '';
    return r.span.days > 0
      ? t('years.nDays', { n: r.span.years, d: r.span.days })
      : t('years.n', { n: r.span.years });
  }

  /** 名称（生日带年龄，如「我妈生日（55岁）」） */
  function nameOf(ev, today) {
    var t = today || new Date();
    return Core.titleOf(ev, Core.ageAt(ev, Core.nextOccurrence(ev, t), t));
  }

  function renderSub(rows, archivedCount) {
    var el = $('#cdSub');
    if (isArchiveView()) {
      el.textContent = archivedCount
        ? t('sub.archived', { n: archivedCount })
        : t('sub.archivedEmpty');
      return;
    }
    if (!rows.length) {
      el.textContent = state.filter === 'all' ? t('sub.emptyAll') : t('sub.emptyFilter');
      return;
    }
    // 单数用 kindl（小写单数），复数用 plural；中文两者文字相同
    var k = rows.length === 1 ? kindLower(state.filter) : pluralOf(state.filter);
    var txt = t('sub.count', { n: rows.length, k: k });

    var todayCount = rows.filter(function (r) { return r.metric.days === 0 && r.metric.mode !== 'none'; }).length;
    var near = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].metric.mode === 'remaining') { near = rows[i]; break; }
    }
    if (todayCount) txt += t('sub.today', { n: todayCount });
    else if (near) txt += t('sub.near', { n: near.metric.days });
    if (state.filter === 'all' && archivedCount) txt += t('sub.archivedN', { n: archivedCount });
    el.textContent = txt;
  }

  /** 归档筛选胶囊上的计数 */
  function renderArchiveEntry(count) {
    var chip = document.querySelector('.cd-chip[data-f="archive"]');
    if (chip) chip.textContent = count ? t('chip.archiveN', { n: count }) : t('chip.archive');
  }

  /** 分区为空时的等高占位，避免切换分类时卡片突然消失、页面跳动 */
  function heroPlaceholderHtml(title, hint) {
    return '<div class="cd-hero cd-hero--empty">' +
        '<div class="cd-hero-label">' + esc(title) + '</div>' +
        '<div class="cd-hero-num cd-hero-num--empty">—</div>' +
        '<div class="cd-hero-meta">' + esc(hint) + '</div>' +
      '</div>';
  }

  function heroEmptyText() {
    if (isArchiveView()) return [t('chip.archive'), t('hero.emptyArchiveHint')];
    var kindName = Core.KINDS[state.filter];
    if (kindName) return [kindName, t('sub.emptyFilter')];
    return [t('appName'), t('hero.emptyHint')];
  }

  // 上一次渲染出的卡片内容：一致就不碰 DOM（省一次重排，也不会重播入场动画）
  var heroKey = '';

  function renderHero(row, today) {
    var el = $('#cdHero');
    var rc;
    var html;

    if (!row || row.metric.mode === 'none') {
      var empty = heroEmptyText();
      rc = '128, 138, 155';
      html = heroPlaceholderHtml(empty[0], empty[1]);
    } else {
      var ev = row.ev;
      var occ = row.occ;
      var m = row.metric;
      var remain = m.mode === 'remaining';
      rc = hexToRgb(ev.color).join(',');

      var label = remain
        ? I.html('hero.remainLabel', { name: esc(row.name) })
        : I.html('hero.elapsedLabel', { name: esc(row.name) });

      var heroCls = remain ? 'cd-hero-num cd-hero-num--remain' : 'cd-hero-num cd-hero-num--elapsed';
      var num = '<div class="' + heroCls + '">' +
          m.days + '<span>' + t(remain ? 'hero.unitRemain' : 'hero.unitElapsed') + '</span></div>';

      var lf = L.solarToLunar(occ.date);
      var meta = [
        Core.cnDate(occ.date),
        L.lunarText(lf.month, lf.day, lf.isLeap),
        ageText(row)
      ].filter(Boolean).join('<i class="sep">·</i>');

      var bar = '';
      var p = Core.cycleProgress(ev, occ, today);
      if (p !== null) {
        var pct = Math.round(p * 100);
        bar =
          '<div class="cd-bar"><i style="width:' + pct + '%"></i></div>' +
          '<div class="cd-bar-text"><span>' + t('hero.barDone', { p: pct }) + '</span><span>' +
            t('hero.barTotal') + '</span></div>';
      }

      html =
        '<div class="cd-hero" data-id="' + esc(ev.id) + '">' +
          '<div class="cd-hero-label">' + label + '</div>' +
          num +
          '<div class="cd-hero-meta">' + meta + '</div>' +
          bar +
        '</div>';
    }

    var key = rc + '|' + html;
    if (key === heroKey) return;
    heroKey = key;
    el.style.setProperty('--cd-rc', rc);
    el.innerHTML = html;
  }

  /**
   * 倒数日已经过期（关掉了「过期后重新开始倒数」，且日期已经过去）。
   * 过期即视为这件事已经结束，名称一律划掉，不再提供开关；
   * 打开了「过期后重新开始倒数」的倒数日永远算在剩余里（mode 为 remaining），
   * 不会走到这里，所以也不会被划掉。
   */
  function isExpiredCountdown(ev, m) {
    return ev.kind === 'countdown' && m.mode === 'elapsed';
  }

  function itemHtml(r) {
    var ev = r.ev;
    var m = r.metric;
    var rgb = hexToRgb(ev.color).join(',');
    var isToday = m.mode !== 'none' && m.days === 0;
    var expired = isExpiredCountdown(ev, m);

    var numText, unitText, numCls = '';
    if (m.mode === 'none') {
      numText = '—';
      unitText = t('unit.overflow');
    } else if (m.mode === 'remaining') {
      numText = String(m.days);
      unitText = m.days === 0 ? t('unit.todayRemain') : t('unit.remain');
      numCls = ' cd-item-num--remain';
    } else {
      numText = String(m.days);
      unitText = m.days === 0 ? t('unit.todayElapsed') : t('unit.elapsed');
      numCls = ' cd-item-num--elapsed';
    }

    // 日期标签在 computeRows 里已经算好，这里不再重复换算农历
    var sub = r.label;
    var age = ageText(r);
    if (age) sub += ' · ' + age;

    // 铃铛图标走 <symbol> + <use>，每条记录只输出一个 use，HTML 体积小一半以上
    var bell = Core.hasReminder(ev)
      ? '<svg class="cd-bell" aria-hidden="true"><use href="#cd-bell-ico"/></svg>'
      : '';

    var tag;
    if (isArchiveView()) {
      tag = '<span class="cd-tag cd-tag--muted">' + esc(t('tag.archived', { k: Core.KINDS[ev.kind] })) + '</span>';
    } else if (expired) {
      // 过期了就把类型标签换成更直白的说法，一眼看得出这条已经结束
      tag = '<span class="cd-tag cd-tag--expired">' + esc(t('tag.expired')) + '</span>';
    } else {
      tag = '<span class="cd-tag">' + esc(Core.KINDS[ev.kind]) + '</span>';
    }

    return '<div class="cd-item' + (isToday ? ' is-today' : '') + '" data-id="' + esc(ev.id) + '"' +
        ' style="--cd-rc:' + rgb + '" role="button" tabindex="0">' +
        '<div class="cd-item-main">' +
          '<div class="cd-item-title"><em' + (expired ? ' class="cd-item-name--done"' : '') + '>' +
            '<span>' + esc(r.name) + '</span>' +
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
          '<h3>' + esc(t('sub.archivedEmpty')) + '</h3>' +
          '<p>' + esc(t('empty.archiveHint')) + '</p>' +
          '<button type="button" class="cd-btn-ghost" data-add>' + esc(t('empty.archiveBtn')) + '</button>' +
        '</div>';
    }
    var filtered = state.filter !== 'all';
    var kindName = Core.KINDS[state.filter] || '';
    var head = filtered ? t('empty.filterTitle') : t('empty.allTitle');
    var desc = filtered
      ? t('empty.filterDesc', { k: kindLower(state.filter) })
      : t('empty.allDesc');
    return '<div class="cd-empty">' +
        '<div class="cd-empty-ico">' +
          '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
            '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>' +
            '<circle cx="12" cy="16" r="2.2"/></svg>' +
        '</div>' +
        '<h3>' + esc(head) + '</h3>' +
        '<p>' + esc(desc) + '</p>' +
        '<button type="button" class="cd-btn-ghost" data-add>' +
          esc(t('empty.btn', { k: filtered ? kindLower(state.filter) : kindLower('') })) + '</button>' +
      '</div>';
  }

  // 上一次渲染出的列表内容：没变化就不写 innerHTML，避免整表重建与动画重播
  var listKey = null;

  function renderList(list) {
    var el = $('#cdList');
    var html = list.length ? list.map(itemHtml).join('') : emptyHtml();
    if (html === listKey) return;
    listKey = html;
    el.innerHTML = html;
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
    var today = new Date();
    var all = sortRows(computeRows(today));
    var active = all.filter(function (r) { return !r.ev.archived; });
    var archivedCount = all.length - active.length;
    var rows = visibleRows(all);
    var settings = state.data.settings || Core.emptySettings();

    if (settings.hero === false) {
      if (heroKey !== '') {
        heroKey = '';
        $('#cdHero').innerHTML = '';
      }
    } else {
      // 置顶卡片跟随当前分区：取该分区排序后的第一条；归档视图不置顶
      var first = null;
      if (!isArchiveView()) {
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].metric.mode !== 'none') { first = rows[i]; break; }
        }
      }
      renderHero(first, today);
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
      // 新事项默认加入任务列表，渠道可在此页单独改
      remind: Core.defaultRemind(),
      // 在归档视图里新建，默认就是归档状态，符合「我要放一个不重要的事项」
      archived: isArchiveView()
    };
  }

  function buildYearSelect() {
    var html = '';
    for (var y = L.MIN_YEAR; y <= L.MAX_YEAR; y++) html += '<option value="' + y + '">' + t('lunar.yearOpt', { y: y }) + '</option>';
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
        '" aria-label="' + esc(t('form.colorAria', { c: c })) + '"></button>';
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
      p.textContent = t('lunar.invalid');
      return;
    }
    var dim = l.isLeap ? L.leapDays(l.year) : L.monthDays(l.year, l.month);
    p.className = 'cd-hint';
    p.textContent = t('lunar.preview', {
      lunar: L.lunarText(l.month, l.day, l.isLeap),
      date: Core.ymd(solar),
      week: Core.WEEK[solar.getDay()],
      gz: L.ganzhiOf(l.year),
      z: L.zodiacOf(l.year)
    }) + (l.day > dim ? t('lunar.dimSuffix', { n: dim, d: L.dayName(dim) }) : '');
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
    html += '<div class="cd-preset-group">' + esc(t('group.custom')) + '</div>' +
      '<div class="cd-preset-list">' +
        '<button type="button" class="cd-preset cd-preset--free" data-k="" aria-pressed="false">' +
          esc(t('form.customFestival')) + '</button>' +
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
    el.textContent = n > 1 ? t('saveN', { n: n }) : t('save');
  }

  function refreshPresetHint() {
    var el = $('#fPresetHint');
    if (!el) return;
    var keys = selectedPresets();
    el.className = 'cd-hint';

    if (!keys.length) {
      el.textContent = t('preset.none');
      return;
    }

    if (keys.length > 1) {
      var names = keys.map(function (k) {
        var f = Core.festivalByKey(k);
        return f ? f.name : k;
      });
      el.textContent = t('preset.multi', { n: keys.length, names: names.join(langListSep()) });
      return;
    }

    var f = Core.festivalByKey(keys[0]);
    var when = (state.draft && state.draft.date) ? t('preset.next', { date: state.draft.date }) : '';
    var text;
    if (!f) {
      text = t('preset.custom');
    } else if (f.group === 'term') {
      text = t('preset.term', { name: f.name });
    } else if (f.key === 'chuxi') {
      text = t('preset.chuxi');
    } else if (f.group === 'lunar') {
      text = t('preset.lunar', { name: f.name });
    } else {
      text = t('preset.solar', { name: f.name, m: f.month, d: f.day });
    }
    el.textContent = text + when;
  }

  /** 列举多项时的分隔符：中文用顿号，英文用逗号 */
  function langListSep() {
    return I.getLang() === 'en' ? ', ' : '、';
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
    $('#cdSheetTitle').textContent = isEdit ? t('sheet.edit') : t('sheet.new', { k: kindLower(d.kind) });
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
      el.textContent = t('remind.hintArchived');
      return;
    }
    if (taskOn && snackOn) {
      el.className = 'cd-hint';
      el.textContent = t('remind.hintBoth', { p: project });
    } else if (taskOn) {
      el.className = 'cd-hint';
      el.textContent = t('remind.hintTask', { p: project });
    } else if (snackOn) {
      el.className = 'cd-hint';
      el.textContent = t('remind.hintSnack');
    } else {
      el.className = 'cd-hint warn';
      el.textContent = t('remind.hintNone');
    }
  }

  /* ================= 设置 ================= */

  var setTimer = null;

  // 本机缓存键，与 plugin-main.js 里的 SEEN_KEY / MAP_KEY / DONE_KEY 保持一致
  var HOST_KEYS = ['cd-task-map-v1', 'cd-remind-seen', 'cd-handled-v1'];

  function refreshSettingsForm() {
    var st = state.data.settings || Core.emptySettings();
    $('#sHero').checked = st.hero !== false;
    setSeg('#sLang', st.lang || 'auto');

    var events = state.data.events || [];
    var archived = 0;
    for (var i = 0; i < events.length; i++) if (events[i].archived) archived++;
    $('#sDataInfo').textContent = events.length
      ? t('data.count', { n: events.length }) + (archived ? t('data.archivedN', { n: archived }) : '')
      : t('data.empty');

    var meta = document.querySelector('meta[name="cd-version"]');
    var ver = meta ? (meta.getAttribute('content') || '') : '';
    $('#sAbout').textContent = t('about', {
      name: t('appName'),
      ver: ver || '-'
    });
  }

  /** 清空同步数据与本机缓存。调用前必须已经过二次确认 */
  function clearAllData() {
    state.data = Core.emptyData();
    state.editingId = null;
    state.draft = null;
    state.filter = 'all';
    state.lastWritten = '';
    state.clearAt = Date.now();

    for (var i = 0; i < HOST_KEYS.length; i++) {
      try { window.localStorage.removeItem(HOST_KEYS[i]); } catch (e) { /* 存储不可用 */ }
    }
    try { window.localStorage.removeItem(DEV_KEY); } catch (e) { /* 存储不可用 */ }

    // 立刻落盘，不走防抖：这 200ms 里若有同步回写，旧数据会被又拉回来
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    saveNow(JSON.stringify(state.data));

    closeSettings();
    renderAll();
    toast(t('toast.cleared'));
  }

  /** 两段确认：先讲清影响面，再确认不可恢复 */
  function askClearData() {
    var n = (state.data.events || []).length;
    var head = n
      ? t('dialog.clearHeadN', { n: n })
      : t('dialog.clearHeadEmpty');
    return confirmDialog(
      head + ' ' + t('dialog.clearTail'),
      t('dialog.continue'),
      t('dialog.clearTitle1')
    ).then(function (go) {
      if (!go) return;
      return confirmDialog(
        t('dialog.clearConfirm'),
        t('dialog.clearOk'),
        t('dialog.clearTitle2')
      ).then(function (ok) {
        if (ok) clearAllData();
      });
    });
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
    toast(t('toast.saved'));
  }

  var sheetTimer = null;

  function findEventById(id) {
    if (!id) return null;
    var events = state.data.events;
    for (var i = 0; i < events.length; i++) {
      if (events[i].id === id) return events[i];
    }
    return null;
  }

  function openSheet(id) {
    var ev = findEventById(id);
    // 条目已被删除（或跨设备同步时被抹掉）：退回「新建」，否则保存会落到一个不存在的 id 上
    if (!ev) id = null;
    state.editingId = id;
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
        remind: {
          task: remind.task,
          snack: remind.snack,
          offsets: remind.offsets.slice()
        },
        archived: archived,
        createdAt: base + created.length
      });
    });

    if (!created.length) { toast(t('toast.pickFestival')); return; }

    // 逐个 push：一次加几十个也不会超出 apply 的参数上限
    for (var i = 0; i < created.length; i++) state.data.events.push(created[i]);
    closeSheet();
    persist();
    renderAll();
    toast(t('toast.batch', { n: created.length }));
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
    if (!d.date) { toast(t('toast.pickDate')); return; }

    var events = state.data.events;
    var replaced = false;
    if (editing) {
      for (var i = 0; i < events.length; i++) {
        if (events[i].id === editing) {
          d.id = editing;
          d.createdAt = events[i].createdAt || Date.now();
          events[i] = d;
          replaced = true;
          break;
        }
      }
    }
    if (!replaced) {
      // 编辑期间该条被同步删除：按新建落库，别让用户刚填的内容无声消失
      d.id = Core.uid();
      d.createdAt = Date.now();
      events.push(d);
    }

    closeSheet();
    persist();
    renderAll();
    toast(replaced ? t('toast.updated') : t('toast.added'));
  }

  function confirmDialog(title, okLabel, dialogTitle) {
    var label = okLabel || t('dialog.delete');
    if (window.PluginAPI && typeof window.PluginAPI.openDialog === 'function') {
      return apiCall('openDialog', {
        title: dialogTitle || t('dialog.deleteTitle'),
        // 纯文本 + <p>：不拼接调用方传来的 HTML，避免把数据当标签解析
        htmlContent: '<p>' + esc(title) + '</p>',
        buttons: [{ label: t('cancel') }, { label: label, color: 'warn', raised: true }]
      }).then(function (r) { return r === label; }, function () { return false; });
    }
    return Promise.resolve(window.confirm(title));
  }

  function deleteEvent() {
    var id = state.editingId;
    if (!id) return;
    var ev = findEventById(id);
    if (!ev) return;

    confirmDialog(t('dialog.deleteOne', { name: nameOf(ev) })).then(function (ok) {
      if (!ok) return;
      state.data.events = state.data.events.filter(function (x) { return x.id !== id; });
      closeSheet();
      persist();
      renderAll();
      toast(t('toast.deleted'));
    });
  }

  /* ================= 持久化 ================= */

  var saveTimer = null;

  /** 立即写盘；正常保存走 persist 的防抖，清除数据不走防抖 */
  function saveNow(json) {
    state.lastWritten = json;
    return Store.save(json).then(function (ok) {
      if (!ok) { state.lastWritten = ''; toast(t('toast.saveFail')); }
      return ok;
    });
  }

  function persist() {
    var json = JSON.stringify(state.data);
    if (json === state.lastWritten) return;
    state.lastWritten = json;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveNow(json);
    }, 200);
  }

  /** 宿主可能回传字符串，也可能直接给对象；两种都接受，坏数据返回 null */
  function parseStored(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function load() {
    return Store.load().then(function (raw) {
      if (raw) {
        var parsed = parseStored(raw);
        if (parsed) {
          // 先切语言再归一化：默认项目名等文案要跟随语言
          applyLang(parsed.settings && parsed.settings.lang);
          state.data = Core.normalize(parsed);
          state.lastWritten = JSON.stringify(state.data);
        } else {
          state.data = Core.emptyData();
        }
      }
      renderAll();
    }, function () { renderAll(); });
  }

  function registerHooks() {
    var P = window.PluginAPI;
    if (!P || typeof P.registerHook !== 'function' || !P.Hooks) return;

    // 宿主里切了语言：语言偏好是「自动」时跟着换，界面立刻重排。
    // 载荷里带新的语言码，先记下来 —— 不依赖 cfg 里有没有 lang。
    var lKey = P.Hooks.LANGUAGE_CHANGE;
    if (lKey) {
      try {
        P.registerHook(lKey, function (payload) {
          var code = payloadLang(payload);
          if (code) hostLangCode = code;
          if (langPref() !== 'auto') return;
          applyLang('auto');
          renderAll();
          refreshSettingsForm();
        });
      } catch (e) { /* 旧版本宿主无此钩子 */ }
    }

    var key = P.Hooks.PERSISTED_DATA_CHANGED;
    if (!key) return;
    try {
      P.registerHook(key, function () {
        // 刚清空数据：此刻到达的回写大概率是清除前的旧值
        if (state.clearAt && Date.now() - state.clearAt < 1500) return;
        Store.load().then(function (raw) {
          if (!raw || raw === state.lastWritten) return;
          var parsed = parseStored(raw);
          if (!parsed) return;   // 忽略损坏数据
          try {
            var next = Core.normalize(parsed);
            var nextJson = JSON.stringify(next);
            if (nextJson === JSON.stringify(state.data)) return;
            state.data = next;
            state.lastWritten = nextJson;
            applyLang(next.settings && next.settings.lang);
            renderAll();
            if (!state.editingId) toast(t('toast.synced'));
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
      // 新建时标题跟着类型走，编辑时保持「编辑事项」
      if (!state.editingId) {
        $('#cdSheetTitle').textContent = t('sheet.new', { k: kindLower(b.dataset.v) });
      }
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
    $('#sLang').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      setSeg('#sLang', b.dataset.v);
      setLangPref(b.dataset.v);
    });
    $('#sHero').addEventListener('change', function () {
      updateSetting('hero', this.checked);
    });
    $('#sClear').addEventListener('click', function () {
      askClearData();
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
    // 先用系统语言把骨架铺好，load() 拿到存下的偏好后会再切一次
    applyLang(state.data.settings && state.data.settings.lang);
    bind();
    load();
    registerHooks();
    // 主题改为「宿主属性变化即触发 + 8 秒兜底」，不再每 3 秒强制读一次计算样式
    watchTheme();
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

  window.addEventListener('pagehide', teardown);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
