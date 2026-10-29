(function () {
  'use strict';

  var L = window.Lunar;
  var Core = window.EventCore;
  var I = window.I18N;
  // 脱离宿主（直接打开 dist/index.html）调试时的本地存档键；名与项目名保持一致
  var DEV_KEY = 'ml-local-v1';

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

  /* ---------------- 展示层：天数 → 人话 ----------------
   * 核心层（event-core）只给数字与语义（mode/days），「说成今天还是 1 天」属于界面措辞，
   * 一律在这里翻译，不回流到数据层，列表与置顶卡片共用同一份判断。
   */

  /** 剩余 0/1/2 天说成「今天 / 明天 / 后天」，更远的返回空串表示仍按数字显示 */
  var SOON_DAYS = 3;

  function remainWord(days) {
    return days >= 0 && days < SOON_DAYS ? t('when.' + days) : '';
  }

  /**
   * 剩余天数的展示形态
   * @returns {{text:string, unit:string, word:boolean}} word=true 表示 text 是文字而非数字
   */
  function remainDisplay(days) {
    var word = remainWord(days);
    return {
      text: word || String(days),
      // 文字本身已经把话说完了，再挂「剩余天数」会读成两遍
      unit: word ? '' : t('unit.remain'),
      word: !!word
    };
  }

  var state = {
    data: Core.emptyData(),
    filter: 'all',
    editingId: null,
    draft: null,
    // 详情页正在展示的那条记录（null = 详情页关着）
    detailId: null,
    // 打开详情前焦点所在的元素，关闭后还给它
    detailFocus: null,
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
  // 软件里设定的语言（globalConfig.localization.lng）；空串 = 设成「跟随系统」
  var hostLangSetting = '';
  // getCurrentLanguage() 的最近一次结果
  var hostLangCur = '';

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
   * 三个来源合起来判断（为什么不能只信 getCurrentLanguage，见 I18N.pickHostLang 的注释）：
   *   globalConfig.localization.lng（异步补读，最准）> getCurrentLanguage() > languageChange > 系统语言
   */
  function hostLang() {
    try {
      var P = window.PluginAPI;
      if (P && typeof P.getCurrentLanguage === 'function') {
        var cur = P.getCurrentLanguage();
        if (cur) hostLangCur = cur;
      }
    } catch (e) { /* 语言未就绪时继续用兜底值 */ }
    return I.pickHostLang({
      setting: hostLangSetting,
      cur: hostLangCur,
      switched: hostLangCode,
      nav: navLang()
    });
  }

  /**
   * 补读「软件里设定的语言」。
   * getCurrentLanguage() 在「跟随系统」时会一直回报默认值 en（中文界面也一样），
   * 只有 globalConfig.localization.lng 能区分「真的英文」和「跟随系统」。
   * @returns {Promise<boolean>} 设定值是否发生变化
   */
  function primeHostLang() {
    var P = window.PluginAPI;
    if (!P || typeof P.getAppState !== 'function') return Promise.resolve(false);
    return apiCall('getAppState').then(function (st) {
      var cfg = st && st.globalConfig;
      var loc = cfg && cfg.localization;
      var lng = loc && typeof loc.lng === 'string' ? loc.lng : '';
      if (lng === hostLangSetting) return false;
      hostLangSetting = lng;
      return true;
    }, function () { return false; });
  }

  /**
   * languageChange 的载荷：{ code, newLanguage }。
   * 两个字段都取 —— 实测切回同一批语言时宿主只带 newLanguage，只认 code 会一直用上一次的值。
   */
  function payloadLang(payload) {
    if (!payload) return '';
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

    // 表单开着时要重建下拉与预设按钮：重建会把用户当前的选择清空，先把农历三列存下来。
    // 这条路径现在不只在切语言时走 —— 补读语言设定值（primeHostLang）也会异步触发一次，
    // 所以不能假设「此刻用户没在填表」。
    var layer = $('#mlLayer');
    var drafting = !!(layer && !layer.hidden && state.draft);
    var keepLunar = null;
    if (drafting) {
      keepLunar = {
        y: +$('#fLY').value || 0,
        m: +$('#fLM').value || 0,
        d: +$('#fLD').value || 0,
        leap: !!$('#fLeap').checked
      };
    }

    buildYearSelect();
    buildMonthSelect();
    buildPresets();
    if (!layer || layer.hidden) buildColors((state.draft && state.draft.color) || Core.COLORS[0]);
    if (drafting) {
      // 恢复农历下拉的当前值（含该月天数变化后的日钳位）
      if (keepLunar.y) $('#fLY').value = String(keepLunar.y);
      if (keepLunar.m) {
        $('#fLM').value = String(keepLunar.m);
        buildDaySelect(keepLunar.y || L.MIN_YEAR, keepLunar.m, keepLunar.leap, keepLunar.d);
        if (keepLunar.leap) $('#fLeap').checked = true;
      }
      // 标题、保存按钮数量、预设提示、名称/颜色/历法行的显隐都是按语言或选中态派生的，一并补回来
      var k = segValue('#fKind') || state.draft.kind;
      $('#mlSheetTitle').textContent = state.editingId
        ? t('sheet.edit')
        : t('sheet.new', { k: kindLower(k) });
      refreshPresetRow(k);
      refreshCalendarRow();
      refreshSaveLabel();
      refreshRemindHint();
    }

    // 详情页的信息行都是按语言拼的（类型、历法、提醒、状态），切语言后要整段重排
    refreshDetail();
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
    var el = $('#mlToast');
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
    if (html.getAttribute('data-ml-theme') !== next) html.setAttribute('data-ml-theme', next);
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
          // 不要监听 data-ml-theme：那是 detectTheme 自己写的，监听它会自我触发一轮无谓的重算
          attributeFilter: ['class', 'style', 'data-theme']
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
    if (detailTimer) { clearTimeout(detailTimer); detailTimer = null; }
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
   * 进度条
   *   · 生日  → 画「还剩多少」：越接近生日，条越短（用户要的相反方向），
   *             文案带上此刻的年龄（「55岁还有 55%」），比标题里「这次生日几岁」少一岁
   *   · 其余  → 画「本年度已过多少」：随时间变长
   */
  function barOf(ev, occ, today) {
    var info = Core.cycleInfo(ev, occ, today);
    if (!info) return '';
    var bday = ev.kind === 'birthday';
    var pct = Math.round((bday ? info.left / info.total : info.ratio) * 100);
    var txt;
    if (bday) {
      var age = Core.ageOn(ev, today || new Date());
      txt = age == null
        ? t('hero.barLeft', { p: pct })
        : t('hero.barLeftAge', { n: age, p: pct });
    } else {
      txt = t('hero.barDone', { p: pct });
    }
    return '<div class="ml-bar' + (bday ? ' ml-bar--left' : '') + '"><i style="width:' + pct + '%"></i></div>' +
      '<div class="ml-bar-text"><span>' + esc(txt) + '</span><span>' + esc(t('hero.barTotal')) + '</span></div>';
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
    var el = $('#mlSub');
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

  /** 分区为空时的等高占位，避免切换分类时卡片突然消失、页面跳动 */
  function heroPlaceholderHtml(title, hint) {
    return '<div class="ml-hero ml-hero--empty">' +
        '<div class="ml-hero-label">' + esc(title) + '</div>' +
        '<div class="ml-hero-num ml-hero-num--empty">—</div>' +
        '<div class="ml-hero-meta">' + esc(hint) + '</div>' +
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

  /**
   * 大卡片主体：标签句 + 天数 + 日期行 + 进度条
   * 置顶卡与详情页共用这一份，两处样式与文案才不会各走一路
   */
  function cardBodyHtml(row, today) {
    var ev = row.ev;
    var occ = row.occ;
    var m = row.metric;

    if (m.mode === 'none') {
      return '<div class="ml-hero-label">' + esc(row.name) + '</div>' +
        '<div class="ml-hero-num ml-hero-num--empty">—<span>' + esc(t('unit.overflow')) + '</span></div>' +
        '<div class="ml-hero-meta">' + esc(Core.dateLabel(ev, occ)) + '</div>';
    }

    var remain = m.mode === 'remaining';
    // 三天内改说「就在 今天 / 明天 / 后天」，标签随之从「距离…还有」换成「…就在」
    var disp = remain ? remainDisplay(m.days) : null;

    var label;
    if (!remain) label = I.html('hero.elapsedLabel', { name: esc(row.name) });
    else if (disp.word) {
      label = I.html(m.days === 0 ? 'hero.todayLabel' : 'hero.soonLabel', { name: esc(row.name) });
    } else label = I.html('hero.remainLabel', { name: esc(row.name) });

    var numCls = remain
      ? 'ml-hero-num ml-hero-num--remain' + (disp.word ? ' ml-hero-num--word' : '')
      : 'ml-hero-num ml-hero-num--elapsed';
    // 文字状态（今天/明天/后天）已经把话说完了，不再挂单位
    var unit = disp && disp.word ? '' : '<span>' + esc(t(remain ? 'hero.unitRemain' : 'hero.unitElapsed')) + '</span>';
    var num = '<div class="' + numCls + '">' + esc(disp ? disp.text : String(m.days)) + unit + '</div>';

    var lf = L.solarToLunar(occ.date);
    // 超出农历查表年限时不再显示换算结果，避免出现「腊月三十日第 500 天」这类脏值
    var lunarMeta = lf.outOfRange ? esc(t('unit.overflow')) : L.lunarText(lf.month, lf.day, lf.isLeap);
    var meta = [
      Core.cnDate(occ.date),
      lunarMeta,
      ageText(row)
    ].filter(Boolean).join('<i class="sep">·</i>');

    return '<div class="ml-hero-label">' + label + '</div>' +
      num +
      '<div class="ml-hero-meta">' + meta + '</div>' +
      barOf(ev, occ, today);
  }

  function renderHero(row, today) {
    var el = $('#mlHero');
    var rc;
    var html;

    if (!row || row.metric.mode === 'none') {
      var empty = heroEmptyText();
      rc = '128, 138, 155';
      html = heroPlaceholderHtml(empty[0], empty[1]);
    } else {
      rc = hexToRgb(row.ev.color).join(',');
      html = '<div class="ml-hero" data-id="' + esc(row.ev.id) + '">' + cardBodyHtml(row, today) + '</div>';
    }

    var key = rc + '|' + html;
    if (key === heroKey) return;
    heroKey = key;
    el.style.setProperty('--ml-rc', rc);
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

    var numText, unitText, numCls = '', bAttr = '';
    if (m.mode === 'none') {
      numText = '—';
      unitText = t('unit.overflow');
      bAttr = ' class="is-txt"';
    } else if (m.mode === 'remaining') {
      numCls = ' ml-item-num--remain';
      var disp = remainDisplay(m.days);
      numText = disp.text;
      unitText = disp.unit;
      if (disp.word) bAttr = ' class="is-word"';
    } else {
      numText = String(m.days);
      unitText = m.days === 0 ? t('unit.todayElapsed') : t('unit.elapsed');
      numCls = ' ml-item-num--elapsed';
    }

    // 日期标签在 computeRows 里已经算好，这里不再重复换算农历
    var sub = r.label;
    var age = ageText(r);
    if (age) sub += ' · ' + age;

    // 铃铛图标走 <symbol> + <use>，每条记录只输出一个 use，HTML 体积小一半以上
    var bell = Core.hasReminder(ev)
      ? '<svg class="ml-bell" aria-hidden="true"><use href="#ml-bell-ico"/></svg>'
      : '';

    var tag;
    if (isArchiveView()) {
      tag = '<span class="ml-tag ml-tag--muted">' + esc(t('tag.archived', { k: Core.KINDS[ev.kind] })) + '</span>';
    } else if (expired) {
      // 过期了就把类型标签换成更直白的说法，一眼看得出这条已经结束
      tag = '<span class="ml-tag ml-tag--expired">' + esc(t('tag.expired')) + '</span>';
    } else {
      tag = '<span class="ml-tag">' + esc(Core.KINDS[ev.kind]) + '</span>';
    }

    return '<div class="ml-item' + (isToday ? ' is-today' : '') + '" data-id="' + esc(ev.id) + '"' +
        ' style="--ml-rc:' + rgb + '" role="button" tabindex="0">' +
        '<div class="ml-item-main">' +
          '<div class="ml-item-title"><em' + (expired ? ' class="ml-item-name--done"' : '') + '>' +
            '<span>' + esc(r.name) + '</span>' +
            '</em>' + bell + tag + '</div>' +
          '<div class="ml-item-sub">' + esc(sub) + '</div>' +
        '</div>' +
        '<div class="ml-item-num' + numCls + '">' +
          '<b' + bAttr + '>' + esc(numText) + '</b>' +
          (unitText ? '<i>' + esc(unitText) + '</i>' : '') +
        '</div>' +
      '</div>';
  }

  function emptyHtml() {
    if (isArchiveView()) {
      return '<div class="ml-empty">' +
          '<div class="ml-empty-ico">' +
            '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
              '<rect x="3" y="4" width="18" height="4" rx="1.4"/><path d="M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8"/>' +
              '<path d="M10 12h4"/></svg>' +
          '</div>' +
          '<h3>' + esc(t('sub.archivedEmpty')) + '</h3>' +
          '<p>' + esc(t('empty.archiveHint')) + '</p>' +
          '<button type="button" class="ml-btn-ghost" data-add>' + esc(t('empty.archiveBtn')) + '</button>' +
        '</div>';
    }
    var filtered = state.filter !== 'all';
    var kindName = Core.KINDS[state.filter] || '';
    var head = filtered ? t('empty.filterTitle') : t('empty.allTitle');
    var desc = filtered
      ? t('empty.filterDesc', { k: kindLower(state.filter) })
      : t('empty.allDesc');
    return '<div class="ml-empty">' +
        '<div class="ml-empty-ico">' +
          '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
            '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>' +
            '<circle cx="12" cy="16" r="2.2"/></svg>' +
        '</div>' +
        '<h3>' + esc(head) + '</h3>' +
        '<p>' + esc(desc) + '</p>' +
        '<button type="button" class="ml-btn-ghost" data-add>' +
          esc(t('empty.btn', { k: filtered ? kindLower(state.filter) : kindLower('') })) + '</button>' +
      '</div>';
  }

  // 上一次渲染出的列表内容：没变化就不写 innerHTML，避免整表重建与动画重播
  var listKey = null;

  function renderList(list) {
    var el = $('#mlList');
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
        $('#mlHero').innerHTML = '';
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
    // 归档胶囊不挂数量：数字由副标题「· 归档 N 个」承担，胶囊只做个入口

    Array.prototype.forEach.call(document.querySelectorAll('.ml-chip'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.f === state.filter));
    });

    // 详情页开着时内容也要跟着数据走（保存、归档、同步都可能改到同一条）
    refreshDetail();
  }

  /* ================= 详情页 =================
   * 点条目先看详情（只读），右上角「编辑」才进表单。
   * 详情是覆盖层而不是弹层：列表 DOM 不重建，返回后滚动位置与筛选状态都还在。
   */

  var detailTimer = null;

  /** 详情页是否开着 */
  function detailOpen() {
    return !!state.detailId;
  }

  /** 详情页当前对应的记录（可能已被删除，或被别的设备同步掉） */
  function detailEvent() {
    return findEventById(state.detailId);
  }

  /** 「2026-05-12 · 周六」 */
  function dateWithWeek(d) {
    return d ? Core.ymd(d) + ' · ' + Core.WEEK[d.getDay()] : '';
  }

  /**
   * 记录的农历说明：农历记录用存下来的月日（那才是用户填的），
   * 公历记录按公历日期换算。干支生肖只对农历记录有意义，公历记录不显示，
   * 否则换算出来的年份容易被当成用户填的年份。
   */
  function lunarLine(ev, base) {
    var lf = null;
    var y = 0;
    if (ev.calendar === 'lunar' && ev.lunar) {
      lf = { month: ev.lunar.month, day: ev.lunar.day, isLeap: !!ev.lunar.isLeap };
      y = ev.lunar.year;
    } else if (base) {
      var s = L.solarToLunar(base);
      if (!s.outOfRange) { lf = s; y = s.year; }
    }
    if (!lf) return '';
    var txt = L.lunarText(lf.month, lf.day, lf.isLeap);
    if (ev.calendar === 'lunar' && y) {
      txt += ' · ' + t('zodiac.label', { gz: L.ganzhiOf(y), z: L.zodiacOf(y) });
    }
    return txt;
  }

  /** 提醒渠道与档位的人话描述，如「提前 1 天、当天 · 加入任务列表」 */
  function remindLine(ev) {
    if (!Core.hasReminder(ev)) {
      return t(ev.archived ? 'detail.remindArchived' : 'detail.remindOff');
    }
    var rm = Core.normalizeRemind(ev.remind);
    var chans = [];
    if (rm.task) chans.push(t('detail.remindTask'));
    if (rm.snack) chans.push(t('detail.remindSnack'));
    var days = rm.offsets.map(function (d) { return t('offset.' + d); });
    return t('detail.remindLine', {
      ch: chans.join(langListSep()),
      days: days.join(langListSep())
    });
  }

  /** 剩余 / 已过天数说成人话（三天内用「今天 / 明天 / 后天」） */
  function metricLine(m, remain, disp) {
    if (m.mode === 'none') return '';
    if (remain && m.days === 0) return t('detail.todayLeft');
    if (!remain && m.days === 0) return t('detail.todayPast');
    return t(remain ? 'detail.daysLeft' : 'detail.daysPast', { n: m.days });
  }

  function detailHtml(ev, occ, m, span, name, today) {
    var rgb = hexToRgb(ev.color).join(',');
    var remain = m.mode === 'remaining';
    var disp = remain ? remainDisplay(m.days) : null;

    var tags = '<span class="ml-tag">' + esc(Core.KINDS[ev.kind]) + '</span>';
    if (ev.archived) {
      tags += '<span class="ml-tag ml-tag--muted">' + esc(t('detail.statusArchived')) + '</span>';
    } else if (isExpiredCountdown(ev, m)) {
      tags += '<span class="ml-tag ml-tag--expired">' + esc(t('detail.statusExpired')) + '</span>';
    }

    // 信息行：一律纯文本，拼接时统一 esc
    // 类型交给卡片顶部的标签、历法由「日期 / 农历」两行自明，不再各占一行
    var base = Core.parseYMD(ev.date);
    var rows = [];
    if (base) {
      var dateTxt = dateWithWeek(base);
      if (ev.term && Core.TERMS[ev.term]) dateTxt += ' · ' + Core.TERMS[ev.term].name;
      rows.push([t('detail.date'), dateTxt]);
    }
    var lunarTxt = lunarLine(ev, base);
    if (lunarTxt) rows.push([t('detail.lunar'), lunarTxt]);
    // 纪念日与已过期的倒数日，「上次」要指向起算那天（metric.date），而不是下一次发生日：
    // 否则会出现「2027-06-16 · 已过 3057 天」这种未来日期配过去天数
    var whenDate = m.date || (occ && occ.date);
    if (whenDate) {
      var nextTxt = dateWithWeek(whenDate);
      var mline = metricLine(m, remain, disp);
      if (mline) nextTxt += ' · ' + mline;
      rows.push([t(remain ? 'detail.next' : 'detail.last'), nextTxt]);
    }
    if (ev.kind === 'anniversary' && span) {
      rows.push([t('detail.span'), span.days > 0
        ? t('years.nDays', { n: span.years, d: span.days })
        : t('years.n', { n: span.years })]);
    }
    // 倒数日的「过期后重新开始倒数」原本挂在状态行上，状态行去掉后单独成行，信息不能丢
    if (ev.kind === 'countdown') {
      rows.push([t('detail.repeat'), ev.repeat ? t('repeat.on') : t('repeat.off')]);
    }
    rows.push([t('detail.remind'), remindLine(ev)]);

    // 状态只在归档时说一句：正常是默认值，写出来等于没信息（归档 / 过期另有标签兜底）
    if (ev.archived) rows.push([t('detail.status'), t('detail.statusArchived')]);

    // 备注单独成块：它是用户自己写的正文，混在「类型/日期」这类键值行里会被当成一行小字忽略掉；
    // 换行也原样保留，列表里挤成一行看不出层次
    var noteHtml = ev.note
      ? '<div class="ml-detail-note">' +
          '<div class="ml-detail-note-k">' + esc(t('detail.note')) + '</div>' +
          '<p class="ml-detail-note-v">' + esc(ev.note) + '</p>' +
        '</div>'
      : '';

    var rowsHtml = rows.map(function (r) {
      return '<div class="ml-detail-row"><span class="ml-detail-k">' + esc(r[0]) +
        '</span><span class="ml-detail-v">' + esc(r[1]) + '</span></div>';
    }).join('');

    // 头部大卡片与列表置顶卡同一份结构（cardBodyHtml）：标签句 + 天数 + 日期 + 进度条
    var row = { ev: ev, occ: occ, metric: m, span: span, name: name };

    return '<div class="ml-detail-inner" style="--ml-rc:' + rgb + '">' +
        '<section class="ml-hero ml-hero--detail">' +
          '<div class="ml-detail-tags">' + tags + '</div>' +
          cardBodyHtml(row, today) +
        '</section>' +
        '<div class="ml-detail-rows">' + rowsHtml + '</div>' +
        noteHtml +
      '</div>';
  }

  function renderDetail() {
    if (!state.detailId) return;
    var ev = detailEvent();
    if (!ev) { closeDetail(); return; }
    var today = new Date();
    var occ = Core.nextOccurrence(ev, today);
    var m = metricOf(ev, occ, today);
    var span = ev.kind === 'anniversary' ? Core.anniversarySpan(ev, today) : null;
    var name = Core.titleOf(ev, Core.ageAt(ev, occ, today));
    $('#mlDetailBody').innerHTML = detailHtml(ev, occ, m, span, name, today);
  }

  /**
   * 数据变动后刷新详情（保存、同步、切语言都会走到）。
   * 条目已经被删掉时直接退回列表，别让用户对着一条不存在的记录继续点「编辑」。
   */
  function refreshDetail() {
    if (!state.detailId) return;
    if (!detailEvent()) { closeDetail(); return; }
    renderDetail();
  }

  /**
   * 打开详情
   * @param {string} id 记录 id
   * @param {boolean} [focusIn] 是否把焦点移进详情（只有键盘操作才需要，鼠标/触摸打开
   *        时自动聚焦会让「返回」一直挂着一圈焦点环）
   */
  function openDetail(id, focusIn) {
    var ev = findEventById(id);
    if (!ev) return;
    state.detailId = ev.id;
    // 记住从哪一条点进来的：关闭后把焦点还回去，键盘用户不会掉回页面顶部
    state.detailFocus = document.activeElement;
    renderDetail();

    var layer = $('#mlDetailLayer');
    clearTimeout(detailTimer);
    detailTimer = null;
    layer.hidden = false;
    // 详情盖住了列表：让背后的列表不可聚焦，Tab 不会跳进看不见的条目里
    setAppInert(true);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { document.body.classList.add('ml-detail-open'); });
    });
    if (focusIn) {
      try { $('#mlDetailBack').focus(); } catch (e) { /* 聚焦失败不影响展示 */ }
    }
  }

  /** 详情打开时把主列表从 Tab 序列里摘出去（不支持 inert 的旧 WebView 上是个无害的属性） */
  function setAppInert(on) {
    var app = document.querySelector('.ml-app');
    if (!app) return;
    if (on) app.setAttribute('inert', '');
    else app.removeAttribute('inert');
  }

  function closeDetail() {
    if (!state.detailId) return;
    state.detailId = null;
    document.body.classList.remove('ml-detail-open');
    // 先解除 inert 再还焦点，否则 focus() 在 inert 子树里不生效
    setAppInert(false);
    clearTimeout(detailTimer);
    detailTimer = setTimeout(function () {
      $('#mlDetailLayer').hidden = true;
      detailTimer = null;
    }, 320);

    var back = state.detailFocus;
    state.detailFocus = null;
    if (back && typeof back.focus === 'function') {
      try { back.focus(); } catch (e) { /* 原来那条已经被删掉了 */ }
    }
  }

  /** 详情里的「编辑」：把表单叠在详情之上，关掉表单后仍回到详情 */
  function editFromDetail() {
    if (!state.detailId) return;
    openSheet(state.detailId);
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
    for (var y = L.MIN_YEAR; y <= L.MAX_YEAR; y++) html += '<option value="' + y + '">' + esc(t('lunar.yearOpt', { y: y })) + '</option>';
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
      return '<button type="button" class="ml-color" data-c="' + c + '" aria-pressed="' +
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
    var dim = l.isLeap ? L.leapDays(l.year) : L.monthDays(l.year, l.month);
    // 与保存口径一致：小月选了「三十」按当月最后一天回落（除夕以腊月三十存，遇小月自动落到廿九），
    // 否则预览报「日期不存在」而保存却成功，用户看到的两套结论互相矛盾
    var solar = Core.resolveLunar(l.year, l.month, l.day, l.isLeap, 'regular');
    if (!solar) {
      p.className = 'ml-hint warn';
      p.textContent = t('lunar.invalid');
      return;
    }
    p.className = 'ml-hint';
    p.textContent = t('lunar.preview', {
      lunar: L.lunarText(l.month, l.day, l.isLeap),
      date: Core.ymd(solar),
      week: Core.WEEK[solar.getDay()],
      gz: L.ganzhiOf(l.year),
      z: L.zodiacOf(l.year)
    }) + (dim && l.day > dim ? t('lunar.dimSuffix', { n: dim, d: L.dayName(dim) }) : '');
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
      html += '<div class="ml-preset-group">' + esc(Core.FESTIVAL_GROUPS[g]) + '</div>' +
        '<div class="ml-preset-list">' + items.map(function (f) {
          return '<button type="button" class="ml-preset" data-k="' + f.key + '" aria-pressed="false">' +
            esc(f.name) + '</button>';
        }).join('') + '</div>';
    });
    html += '<div class="ml-preset-group">' + esc(t('group.custom')) + '</div>' +
      '<div class="ml-preset-list">' +
        '<button type="button" class="ml-preset ml-preset--free" data-k="" aria-pressed="false">' +
          esc(t('form.customFestival')) + '</button>' +
      '</div>';
    $('#fPresets').innerHTML = html;
    // 重建后立刻恢复选中态：这段会在切语言 / 补读语言设定值时被重新调用，
    // 不恢复的话用户正选着的多个节日会整片变回未选中（看起来就是「多选坏了」）
    markPreset(selectedPresets());
  }

  /** 高亮选中的预设；「自定义」在没有选中任何预设时是按下态 */
  function markPreset(keys) {
    var on = keys || [];
    Array.prototype.forEach.call(document.querySelectorAll('#fPresets .ml-preset'), function (b) {
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
    var el = $('#mlSave');
    if (!el) return;
    var kind = segValue('#fKind') || 'countdown';
    var n = (!state.editingId && kind === 'festival') ? selectedPresets().length : 0;
    el.textContent = n > 1 ? t('saveN', { n: n }) : t('save');
  }

  function refreshPresetHint() {
    var el = $('#fPresetHint');
    if (!el) return;
    var keys = selectedPresets();
    el.className = 'ml-hint';

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
    $('#mlSheetTitle').textContent = isEdit ? t('sheet.edit') : t('sheet.new', { k: kindLower(d.kind) });
    $('#fTitle').value = d.title || '';
    markTitleInvalid(false);
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
      // 不要再用 d.lunar.day 覆盖下拉框的值：小月存了「三十」时该选项不存在，
      // 赋值会让 select.value 变成空串，进而让预览误报「日期不存在」。buildDaySelect 已按该月天数钳好
      updateLunarPreview();
    } else {
      solarToLunarFields(Core.parseYMD(d.date) || new Date());
    }
    $('#mlDelete').hidden = !isEdit;
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
    var tag = (state.data.settings || Core.emptySettings()).taskTag;

    if (archived) {
      el.className = 'ml-hint warn';
      el.textContent = t('remind.hintArchived');
      return;
    }
    if (taskOn && snackOn) {
      el.className = 'ml-hint';
      el.textContent = t('remind.hintBoth', { t: tag });
    } else if (taskOn) {
      el.className = 'ml-hint';
      el.textContent = t('remind.hintTask', { t: tag });
    } else if (snackOn) {
      el.className = 'ml-hint';
      el.textContent = t('remind.hintSnack');
    } else {
      el.className = 'ml-hint warn';
      el.textContent = t('remind.hintNone');
    }
  }

  /* ================= 设置 ================= */

  var setTimer = null;

  // 本机缓存键，与 plugin-main.js 里的 SEEN_KEY / MAP_KEY / DONE_KEY 保持一致
  var HOST_KEYS = ['ml-task-map-v1', 'ml-remind-seen', 'ml-handled-v1'];

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

    var meta = document.querySelector('meta[name="ml-version"]');
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
    var layer = $('#mlSetLayer');
    clearTimeout(setTimer);
    layer.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { document.body.classList.add('ml-open'); });
    });
  }

  function closeSettings() {
    document.body.classList.remove('ml-open');
    document.body.style.overflow = '';
    clearTimeout(setTimer);
    setTimer = setTimeout(function () { $('#mlSetLayer').hidden = true; }, 340);
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

    var layer = $('#mlLayer');
    clearTimeout(sheetTimer);
    layer.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { document.body.classList.add('ml-open'); });
    });
  }

  function closeSheet() {
    document.body.classList.remove('ml-open');
    document.body.style.overflow = '';
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(function () {
      $('#mlLayer').hidden = true;
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
    // 名称只存人：年龄与「生日」二字都由界面拼，这里顺手把手动输入的那部分清掉
    var raw = $('#fTitle').value.trim().slice(0, 40);
    d.title = Core.cleanTitle(d.kind, raw) || raw;
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
    var picked = document.querySelector('#fColors .ml-color[aria-pressed="true"]');
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

  /** 名称校验的成败反馈：红框 + 说明文字（说明文字由模板里的 data-i18n 提供） */
  function markTitleInvalid(bad) {
    var input = $('#fTitle');
    var err = $('#fTitleErr');
    if (!input) return;
    if (bad) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    if (err) err.hidden = !bad;
    if (bad) {
      try { input.focus(); } catch (e) { /* 聚焦失败不影响校验 */ }
    }
  }

  function saveSheet() {
    var editing = state.editingId;
    // 新建 + 类型是节日 + 多选了预设 → 一次批量加入（名称由各自预设提供）
    var kind = segValue('#fKind') || 'countdown';
    var keys = (editing || kind !== 'festival') ? [] : selectedPresets();
    if (keys.length > 1) { saveBatch(keys); return; }

    var d = collect();
    delete d.presets;

    // 名称必填：空名称进列表只会看到一排「倒数日」，认不出是什么事
    if (!d.title) { markTitleInvalid(true); return; }
    markTitleInvalid(false);
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
          // 设定值可能刚被写进 globalConfig，补读一次再定语言
          primeHostLang().then(function () {
            applyLang('auto');
            renderAll();
            refreshSettingsForm();
          });
        });
      } catch (e) { /* 单个钩子注册失败不影响其它钩子 */ }
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
    } catch (e) { /* 宿主拒绝时静默跳过 */ }
  }

  /* ================= 事件绑定 ================= */

  function bind() {
    $('#mlAdd').addEventListener('click', function () { openSheet(null); });

    $('#mlChips').addEventListener('click', function (e) {
      var b = e.target.closest('.ml-chip');
      if (!b) return;
      state.filter = b.dataset.f;
      renderAll();
    });

    $('#mlList').addEventListener('click', function (e) {
      if (e.target.closest('[data-add]')) { openSheet(null); return; }
      var item = e.target.closest('.ml-item');
      if (item) openDetail(item.dataset.id);
    });

    $('#mlList').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var item = e.target.closest('.ml-item');
      if (item) { e.preventDefault(); openDetail(item.dataset.id, true); }
    });

    $('#mlHero').addEventListener('click', function (e) {
      var h = e.target.closest('.ml-hero');
      if (h) openDetail(h.dataset.id);
    });

    $('#mlDetailBack').addEventListener('click', closeDetail);
    $('#mlDetailEdit').addEventListener('click', editFromDetail);

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
        $('#mlSheetTitle').textContent = t('sheet.new', { k: kindLower(b.dataset.v) });
      }
    });

    $('#fPresets').addEventListener('click', function (e) {
      var b = e.target.closest('.ml-preset');
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
      var b = e.target.closest('.ml-color');
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

    $('#mlSettings').addEventListener('click', openSettings);
    $('#mlSetClose').addEventListener('click', closeSettings);
    $('#mlSetMask').addEventListener('click', closeSettings);
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

    $('#mlSave').addEventListener('click', saveSheet);
    $('#mlCancel').addEventListener('click', closeSheet);
    $('#mlMask').addEventListener('click', closeSheet);
    $('#mlDelete').addEventListener('click', deleteEvent);
    // 一输入就撤掉红框，别让用户边填边看着报错
    $('#fTitle').addEventListener('input', function () {
      if ($('#fTitle').value.trim()) markTitleInvalid(false);
    });
    // 回车直接保存（键盘操作时不用再去点按钮）
    $('#fTitle').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveSheet(); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      // 编辑弹层叠在详情之上，Esc 先收最上面那层
      if (!$('#mlLayer').hidden) closeSheet();
      else if (!$('#mlSetLayer').hidden) closeSettings();
      else if (detailOpen()) closeDetail();
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
    // 「跟随系统」时 getCurrentLanguage() 只会给默认值 en，补读真实设定值再定一次语言
    primeHostLang().then(function (changed) {
      if (!changed || langPref() !== 'auto') return;
      applyLang('auto');
      renderAll();
      refreshSettingsForm();
    });
    // 主题改为「宿主属性变化即触发 + 8 秒兜底」，不再每 3 秒强制读一次计算样式
    watchTheme();
  }

  window.addEventListener('pagehide', teardown);

  // 宿主把 window.PluginAPI 注入在插件脚本之前，加载完即可直接用；
  // 直接打开 dist/index.html 调试时没有它，Store 会自动走 localStorage。
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
