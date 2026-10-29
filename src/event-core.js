/*!
 * 事项核心逻辑：数据模型 + 下一次发生时间推算
 * 依赖 Lunar（农历换算）与 I18N（文案表）
 */
(function (global, factory) {
  /* node-only:start （仅供 test/*.js require，构建时剥离）*/
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./lunar.js'), require('./i18n.js'));
    return;
  }
  /* node-only:end */
  global.EventCore = factory(global.Lunar, global.I18N);
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (Lunar, I18N) {
  'use strict';

  var I = I18N;
  var lang = 'zh';

  /**
   * 农历显示开关（settings.lunar，默认关）。
   * 关掉时任何地方都不出现农历：日期只留公历，干支生肖、农历日期控件、
   * 农历与节气预设一并收起 —— 不用农历的人在界面上看不到任何相关元素。
   * 由界面（app.js）与宿主脚本（plugin-main.js）按数据里的设置同步。
   */
  var showLunar = false;

  var DAY_MS = 86400000;
  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var YMD_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  var HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

  var KINDS = { birthday: '生日', anniversary: '纪念日', countdown: '倒数日', festival: '节日' };

  /**
   * 节气表：目前只需要清明，用「通用寿星公式」推算每年的公历日
   * day = INT(Y × 0.2422 + C) − INT(Y ÷ 4)，Y 为年份后两位
   * 21 世纪 C = 4.81，20 世纪 C = 5.59（1900-2100 范围内误差 0）
   */
  var TERMS = {
    qingming: { name: '清明', month: 4 }
  };

  function termDay(term, year) {
    var t = TERMS[term];
    if (!t) return 0;
    var y = year % 100;
    var c = year >= 2000 ? 4.81 : 5.59;
    var d = Math.floor(y * 0.2422 + c) - Math.floor(y / 4);
    // 1900 年前后公式不适用，做个兜底
    return d >= 1 && d <= 30 ? d : 5;
  }

  /** 节气在某年的公历日期 */
  function termDate(term, year) {
    var t = TERMS[term];
    if (!t || year < Lunar.MIN_YEAR || year > Lunar.MAX_YEAR) return null;
    return new Date(year, t.month - 1, termDay(term, year));
  }

  /**
   * 预设节日
   *   group: solar 固定公历 / lunar 农历 / term 节气
   *   农历除夕记为「腊月三十」，遇到小月由 resolveLunar 自动落到廿九
   */
  var FESTIVALS = [
    { key: 'yuandan', name: '元旦', group: 'solar', month: 1, day: 1, color: '#e8590c' },
    { key: 'qingren', name: '情人节', group: 'solar', month: 2, day: 14, color: '#d6336c' },
    { key: 'funi', name: '妇女节', group: 'solar', month: 3, day: 8, color: '#7048e8' },
    { key: 'laodong', name: '劳动节', group: 'solar', month: 5, day: 1, color: '#c92a2a' },
    { key: 'ertong', name: '儿童节', group: 'solar', month: 6, day: 1, color: '#f59f00' },
    { key: 'guoqing', name: '国庆节', group: 'solar', month: 10, day: 1, color: '#c92a2a' },
    { key: 'shengdan', name: '圣诞节', group: 'solar', month: 12, day: 25, color: '#0ca678' },

    { key: 'chuxi', name: '除夕', group: 'lunar', month: 12, day: 30, color: '#c92a2a' },
    { key: 'chunjie', name: '春节', group: 'lunar', month: 1, day: 1, color: '#c92a2a' },
    { key: 'yuanxiao', name: '元宵节', group: 'lunar', month: 1, day: 15, color: '#e8590c' },
    { key: 'longtai', name: '龙抬头', group: 'lunar', month: 2, day: 2, color: '#0ca678' },
    { key: 'duanwu', name: '端午节', group: 'lunar', month: 5, day: 5, color: '#0ca678' },
    { key: 'qixi', name: '七夕', group: 'lunar', month: 7, day: 7, color: '#d6336c' },
    { key: 'zhongyuan', name: '中元节', group: 'lunar', month: 7, day: 15, color: '#7048e8' },
    { key: 'zhongqiu', name: '中秋节', group: 'lunar', month: 8, day: 15, color: '#7048e8' },
    { key: 'chongyang', name: '重阳节', group: 'lunar', month: 9, day: 9, color: '#f59f00' },
    { key: 'laba', name: '腊八节', group: 'lunar', month: 12, day: 8, color: '#1c7ed6' },

    { key: 'qingming', name: '清明', group: 'term', month: 4, day: 5, color: '#0ca678' }
  ];

  var FESTIVAL_GROUPS = { solar: '公历', lunar: '农历', term: '节气' };

  /**
   * 切换文案语言。
   * 做法是就地改写 KINDS / WEEK / TERMS / FESTIVALS 里的字符串，
   * 因此所有 `Core.KINDS[kind]` 形式的调用点无需改动。
   * @param {'zh'|'en'} l
   */
  function setLang(l) {
    lang = l === 'en' ? 'en' : 'zh';
    // 文案表与农历模块各自也持有语言状态，一起切
    if (I && typeof I.setLang === 'function') I.setLang(lang);
    if (Lunar && typeof Lunar.setLang === 'function') Lunar.setLang(lang);

    var kinds = ['birthday', 'anniversary', 'countdown', 'festival'];
    for (var i = 0; i < kinds.length; i++) KINDS[kinds[i]] = I.t('kind.' + kinds[i]);
    for (var w = 0; w < WEEK.length; w++) WEEK[w] = I.t('week.' + w);

    TERMS.qingming.name = I.t('term.qingming');
    FESTIVAL_GROUPS.solar = I.t('group.solar');
    FESTIVAL_GROUPS.lunar = I.t('group.lunar');
    FESTIVAL_GROUPS.term = I.t('group.term');
    for (var f = 0; f < FESTIVALS.length; f++) {
      FESTIVALS[f].name = I.t('fest.' + FESTIVALS[f].key);
    }
  }

  function getLang() {
    return lang;
  }

  /**
   * 打开 / 关闭农历显示
   * @param {boolean} on
   */
  function setLunar(on) {
    showLunar = on === true;
  }

  /**
   * 数据里的农历事项数量。
   * 大于 0 时不允许关掉农历显示：关掉之后这些记录在界面上既看不到农历日期，
   * 也没法再改历法（农历控件是收起的），只能靠改数据才能救回来。
   */
  function countLunarEvents(events) {
    var list = events || [];
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].calendar === 'lunar') n++;
    }
    return n;
  }

  function hasLunarEvents(events) {
    return countLunarEvents(events) > 0;
  }

  var FESTIVAL_MAP = null;
  function festivalByKey(key) {
    if (!FESTIVAL_MAP) {
      FESTIVAL_MAP = Object.create(null);
      for (var i = 0; i < FESTIVALS.length; i++) FESTIVAL_MAP[FESTIVALS[i].key] = FESTIVALS[i];
    }
    return (key && FESTIVAL_MAP[key]) || null;
  }

  // 日期 -> 当天零点（本地时区），用于天数差计算
  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function dayTs(d) {
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /** b - a 的天数差（按日历日，忽略夏令时） */
  function diffDays(a, b) {
    return Math.round((dayTs(b) - dayTs(a)) / DAY_MS);
  }

  /** 同上，但基准日期已经折算成 UTC 天数（避免循环里反复取 a 的日号） */
  function daysFromTs(aTs, b) {
    return Math.round((dayTs(b) - aTs) / DAY_MS);
  }

  function ymd(d) {
    return d.getFullYear() + '-' + Lunar.pad2(d.getMonth() + 1) + '-' + Lunar.pad2(d.getDate());
  }

  function parseYMD(s) {
    if (!s || typeof s !== 'string') return null;
    var m = YMD_RE.exec(s.trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, mo - 1, d);
    if (isNaN(dt.getTime())) return null;
    // 溢出（2 月 30 日等）会滚到下个月，回读月/日即可识别
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  function cnDate(d) {
    if (lang === 'en') {
      return MONTH_EN[d.getMonth()] + ' ' + d.getDate() + ', ' + WEEK[d.getDay()];
    }
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()];
  }

  var uidSeq = 0;
  function uid() {
    // 同一毫秒内连续 uid 也不会重复（随机段相同的情况下靠序号区分）
    uidSeq = (uidSeq + 1) % 1296;
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) +
      uidSeq.toString(36);
  }

  var COLORS = ['#e8590c', '#d6336c', '#7048e8', '#1c7ed6', '#0ca678', '#f59f00', '#c92a2a', '#5c7cfa'];

  // 可选的提前提醒天数
  var REMIND_OFFSETS = [0, 1, 3, 7, 30];

  /**
   * 提醒任务统一打这个标签，任务本身落在收件箱（不再建「里程碑提醒」项目）。
   * 固定英文常量、**不进语言包**：标签名是宿主机里的实体标识，跟着界面语言变会让同一份数据
   * 在不同语言下建出两个标签（历史教训：项目名 taskProject 就是随语言变的）。
   */
  var TAG_DEFAULT = 'milestone';

  /**
   * 提醒渠道是「每个事项各自选择」的，不是一个全局总开关：
   *   task  = true → 在任务列表里生成一条任务（关闭即删除该任务）
   *   snack = true → 打开应用时若到点，弹一条提示条
   * 两个渠道可以同时开，也可以只开一个。
   */
  function defaultRemind() {
    return { task: true, snack: false, offsets: [0, 1] };
  }

  function emptySettings() {
    return {
      // 提醒任务的标签名：任务落收件箱，靠这个标签归类（不存在时插件自动创建）
      taskTag: TAG_DEFAULT,
      // 顶部是否放大显示当前分区的第一条
      hero: true,
      // 语言偏好：auto 跟随系统，或强制 zh / en
      lang: 'auto',
      // 是否显示农历（默认关：不用农历的界面里一个农历元素都不出现）
      lunar: false,
      // 大卡片是否显示秒级的倒计时/正计时（默认关：不打开就一个定时器都不起）
      tick: false
    };
  }

  function emptyData() {
    return { version: 1, events: [], settings: emptySettings() };
  }

  /** 规范化外部数据：同步数据可能被截断或塞进坏值，逐字段校正 */
  function normalize(raw) {
    var data = emptyData();
    if (!raw || typeof raw !== 'object') return data;

    if (raw.settings && typeof raw.settings === 'object') {
      var s = raw.settings;
      // 标签名（老数据里的 taskProject 不再读取：项目 → 收件箱 + 标签）
      if (typeof s.taskTag === 'string' && s.taskTag.trim()) {
        data.settings.taskTag = s.taskTag.trim().slice(0, 40);
      }
      data.settings.hero = s.hero !== false;
      // 语言：只认 auto / zh / en，其余一律回到 auto（跟随系统）
      data.settings.lang = s.lang === 'en' || s.lang === 'zh' ? s.lang : 'auto';
      // 农历显示：只有明确的 true 才算开（缺省、旧数据、坏值都是关）
      data.settings.lunar = s.lunar === true;
      // 秒级计时：同上，缺省与坏值都按关处理（关着不建定时器）
      data.settings.tick = s.tick === true;
    }

    var list = Array.isArray(raw.events) ? raw.events : [];
    var usedIds = {};
    var now = Date.now();
    var thisYear = new Date().getFullYear();
    data.events = list.map(function (e, i) {
      if (!e || typeof e !== 'object') return null;

      var kind = KINDS[e.kind] ? e.kind : 'countdown';
      // 预设节日的标识（选了哪个预设），自定义节日为 null
      var preset = typeof e.preset === 'string' && festivalByKey(e.preset) ? e.preset : null;
      // 节气：日期由公式推算，不落死日期
      var term = typeof e.term === 'string' && TERMS[e.term] ? e.term : null;

      var parsed = parseYMD(e.date);
      var date = parsed ? ymd(parsed) : null;
      var lunar = null;
      if (!term && e.lunar && typeof e.lunar === 'object') {
        var lm = Math.round(+e.lunar.month), ld = Math.round(+e.lunar.day), ly = Math.round(+e.lunar.year);
        if (lm >= 1 && lm <= 12 && ld >= 1 && ld <= 30) {
          lunar = { year: ly || thisYear, month: lm, day: ld, isLeap: !!e.lunar.isLeap };
        }
      }
      var calendar = term ? 'solar' : (e.calendar === 'lunar' ? 'lunar' : 'solar');
      if (calendar === 'lunar' && !lunar) calendar = 'solar';

      // 公历日期缺失时用农历反推；两者都不可用则丢弃该条
      if (!date && lunar) {
        var back = lunarToSolarOf(lunar);
        if (back) date = ymd(back);
      }
      if (term) {
        lunar = null;
        if (!date) {
          var td = termDate(term, new Date().getFullYear());
          if (td) date = ymd(td);
        }
      }
      if (!date) return null;

      var id = typeof e.id === 'string' && e.id ? e.id : 'e' + i + Date.now().toString(36);
      // 历史数据里可能有重复 id：重复的重新发一个，否则编辑/删除会张冠李戴
      if (usedIds[id]) id = uid();
      usedIds[id] = true;

      return {
        id: id,
        title: cleanTitle(kind, typeof e.title === 'string' ? e.title.slice(0, 80) : ''),
        kind: kind,
        calendar: calendar,
        date: date,
        lunar: lunar,
        term: term,
        preset: preset,
        // 生日/纪念日/节日每年重来，只有倒数日可以选择是否滚动到明年
        repeat: kind !== 'countdown' ? true : e.repeat === true,
        color: typeof e.color === 'string' && HEX_COLOR_RE.test(e.color) ? e.color : COLORS[0],
        note: typeof e.note === 'string' ? e.note.slice(0, 300) : '',
        remind: normalizeRemind(e.remind),
        // 归档：只在归档视图里出现，不参与提醒
        archived: !!e.archived,
        createdAt: +e.createdAt || now
      };
    }).filter(Boolean);
    // 有农历事项就必须开着农历显示：否则这些记录会被迫只显示公历，
    // 界面上也没有农历控件可用（等于把数据藏起来）
    if (!data.settings.lunar && hasLunarEvents(data.events)) data.settings.lunar = true;
    return data;
  }

  /**
   * 归一化提醒配置：只认 { task, snack, offsets }
   * 缺省为「加入任务列表 + 当天 / 提前 1 天」；非法档位直接丢弃
   */
  function normalizeRemind(r) {
    if (!r || typeof r !== 'object') {
      return { task: true, snack: false, offsets: [0, 1] };
    }

    var offs = [];
    if (Array.isArray(r.offsets)) {
      for (var i = 0; i < r.offsets.length; i++) {
        var n = +r.offsets[i];
        if (REMIND_OFFSETS.indexOf(n) !== -1 && offs.indexOf(n) === -1) offs.push(n);
      }
      offs.sort(function (a, b) { return a - b; });
    }

    return {
      task: r.task !== false,
      snack: r.snack === true,
      offsets: offs.length ? offs : [0]
    };
  }

  function lunarToSolarOf(lunar) {
    if (!lunar) return null;
    return Lunar.lunarToSolar(lunar.year, lunar.month, lunar.day, !!lunar.isLeap);
  }

  /**
   * 把「农历月日」解析到指定农历年的公历日期
   * 处理：闰月缺失回退、小月没有三十回退到廿九
   */
  function resolveLunar(ly, month, day, isLeap, policy) {
    var leapM = Lunar.leapMonth(ly);
    var useLeap = false;
    if (isLeap) {
      if (leapM === month) useLeap = true;
      else if (policy === 'strict') return null;   // 该年无此闰月 -> 本年不过
    }
    var dim = useLeap ? Lunar.leapDays(ly) : Lunar.monthDays(ly, month);
    if (!dim) return null;
    var d = Math.min(day, dim);
    return Lunar.lunarToSolar(ly, month, d, useLeap);
  }

  /**
   * 计算下一次发生的公历日期
   * @param {object} ev 事件
   * @param {Date} today 基准日
   * @returns {{date:Date|null, days:number, isPast:boolean, lunarYear:number, index:number}}
   */
  function nextOccurrence(ev, today) {
    var t = startOfDay(today || new Date());
    if (ev.calendar === 'lunar' && ev.lunar) return nextLunar(ev, t);
    return nextSolar(ev, t);
  }

  function nextSolar(ev, t) {
    var tTs = dayTs(t);

    // 节气节日（清明）：日期每年由公式推算
    if (ev.term && TERMS[ev.term]) {
      for (var k = 0; k < 8; k++) {
        var tc = termDate(ev.term, t.getFullYear() + k);
        if (tc && daysFromTs(tTs, tc) >= 0) {
          var kd = daysFromTs(tTs, tc);
          return { date: tc, days: kd, isPast: false, index: k };
        }
      }
      return { date: null, days: 0, isPast: true, index: 0 };
    }

    var base = parseYMD(ev.date);
    if (!base) return { date: null, days: 0, isPast: true, index: 0 };

    if (!ev.repeat) {
      var dd = daysFromTs(tTs, base);
      return { date: base, days: dd, isPast: dd < 0, index: 0 };
    }

    // 每年重复：从今年开始往后找，最多找 8 年
    for (var j = 0; j < 8; j++) {
      var year = t.getFullYear() + j;
      var cand = safeYM(year, base.getMonth(), base.getDate());
      var cd = daysFromTs(tTs, cand);
      if (cd >= 0) {
        return { date: cand, days: cd, isPast: false, index: j };
      }
    }
    return { date: null, days: 0, isPast: true, index: 0 };
  }

  /** 处理 2 月 29 日在平年落到 2 月 28 日 */
  function safeYM(year, month, day) {
    var last = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, last));
  }

  function nextLunar(ev, t) {
    var lunar = ev.lunar;
    var policy = 'regular';
    var tTs = dayTs(t);

    if (!ev.repeat) {
      // 一次性农历日期：就是指定农历年那天
      var fixed = resolveLunar(lunar.year, lunar.month, lunar.day, lunar.isLeap, 'regular');
      if (!fixed) return { date: null, days: 0, isPast: true, index: 0 };
      var d = daysFromTs(tTs, fixed);
      return { date: fixed, days: d, isPast: d < 0, index: 0, lunarYear: lunar.year };
    }

    var lf = Lunar.solarToLunar(t);
    // 从上一个农历年开始扫，覆盖跨年边界
    for (var k = -1; k <= 4; k++) {
      var ly = lf.year + k;
      if (ly < Lunar.MIN_YEAR || ly > Lunar.MAX_YEAR) continue;
      var cand = resolveLunar(ly, lunar.month, lunar.day, lunar.isLeap, policy);
      if (!cand) continue;
      var cd = daysFromTs(tTs, cand);
      if (cd >= 0) {
        return {
          date: cand,
          days: cd,
          isPast: false,
          index: k + 1,
          lunarYear: ly
        };
      }
    }
    return { date: null, days: 0, isPast: true, index: 0 };
  }

  /** 周年数 / 周岁数 */
  function yearsSince(ev, occ) {
    if (!occ || !occ.date) return null;
    if (ev.calendar === 'lunar' && ev.lunar) {
      var ly = occ.lunarYear;
      if (!ly) {
        var l = Lunar.solarToLunar(occ.date);
        ly = l.year;
      }
      var n = ly - ev.lunar.year;
      return n > 0 ? n : null;
    }
    var base = parseYMD(ev.date);
    if (!base) return null;
    var n2 = occ.date.getFullYear() - base.getFullYear();
    return n2 > 0 ? n2 : null;
  }

  /**
   * 纪念日截至 today 的「已满整年 + 零头天数」，不满一年返回 null
   * 例：2025-09-24 开始，到 2026-10-28 → { years: 1, days: 34 }
   * 与 yearsSince 的区别：yearsSince 算的是「下次发生那天是第几年」，
   * 纪念日要的是「今天已经过了几个整年」，下次发生日永远比已过的周年多一年
   * @returns {{years:number, days:number}|null}
   */
  function anniversarySpan(ev, when) {
    var w = startOfDay(when || new Date());
    var n, mark;

    if (ev.calendar === 'lunar' && ev.lunar) {
      var lw = Lunar.solarToLunar(w);
      n = lw.year - ev.lunar.year;
      var beforeDay = lw.month < ev.lunar.month ||
        (lw.month === ev.lunar.month && lw.day < ev.lunar.day);
      if (beforeDay) n--;
      if (n < 1) return null;
      // 第 n 个农历周年那天，零头天数从那天算到今天
      mark = resolveLunar(ev.lunar.year + n, ev.lunar.month, ev.lunar.day, ev.lunar.isLeap, 'regular');
    } else {
      var base = parseYMD(ev.date);
      if (!base) return null;
      n = w.getFullYear() - base.getFullYear();
      var notYet = w.getMonth() < base.getMonth() ||
        (w.getMonth() === base.getMonth() && w.getDate() < base.getDate());
      if (notYet) n--;
      if (n < 1) return null;
      mark = safeYM(base.getFullYear() + n, base.getMonth(), base.getDate());
    }

    if (!mark) return { years: n, days: 0 };
    return { years: n, days: Math.max(0, diffDays(mark, w)) };
  }

  /** 纪念日已满多少整年，不满一年返回 null（anniversarySpan 的薄封装，界面用 span，本函数留给测试） */
  function anniversaryYears(ev, when) {
    var span = anniversarySpan(ev, when);
    return span ? span.years : null;
  }

  /**
   * 截至 when 当天的实际年龄（整岁）
   * 与 yearsSince 的区别：这里算「现在多大」，而不是「下次生日时多大」
   * @returns {number|null} 无法计算或尚未出生时返回 null
   */
  function ageOn(ev, when) {
    var w = startOfDay(when || new Date());
    var n;

    if (ev.calendar === 'lunar' && ev.lunar) {
      var lw = Lunar.solarToLunar(w);
      n = lw.year - ev.lunar.year;
      var beforeBirthday = lw.month < ev.lunar.month ||
        (lw.month === ev.lunar.month && lw.day < ev.lunar.day);
      if (beforeBirthday) n--;
    } else {
      var base = parseYMD(ev.date);
      if (!base) return null;
      n = w.getFullYear() - base.getFullYear();
      var notYet = w.getMonth() < base.getMonth() ||
        (w.getMonth() === base.getMonth() && w.getDate() < base.getDate());
      if (notYet) n--;
    }

    return n >= 0 ? n : null;
  }

  /**
   * 这次生日多少岁（下一次发生那天的周岁）
   * 界面上的「（55岁）」说的是即将到来的这个生日，不是今天多大，
   * 所以通常比 ageOn 多一岁；正好生日当天两者相等。
   * @param {object} ev 事件
   * @param {object} occ nextOccurrence 的结果
   * @param {Date} [today] 基准日；给了才拦「还没出生」的记录
   * @returns {number|null}
   */
  function ageAt(ev, occ, today) {
    if (!occ || !occ.date) return null;

    if (ev.calendar === 'lunar' && ev.lunar) {
      var ly = occ.lunarYear;
      if (!ly) ly = Lunar.solarToLunar(occ.date).year;
      var n = ly - ev.lunar.year;
      return n >= 0 ? n : null;
    }

    var base = parseYMD(ev.date);
    if (!base) return null;
    // 生日还没到（出生日期在未来）不算年龄
    if (today && diffDays(startOfDay(today), base) > 0) return null;
    var n2 = occ.date.getFullYear() - base.getFullYear();
    return n2 >= 0 ? n2 : null;
  }

  /**
   * 清洗名称：生日的名称里只留人，年龄与「生日」二字都由界面拼
   * 年龄与「生日」都不进数据，所以入库前先摘掉 —— 否则会渲染成
   * 「妈妈生日（55岁）生日」「妈妈（55岁）（55岁）生日」
   */
  function cleanTitle(kind, title) {
    var s = typeof title === 'string' ? title : '';
    if (kind !== 'birthday') return s;
    return s
      .replace(/[（(]\s*\d{1,3}\s*岁\s*[)）]\s*$/, '')
      .replace(/(的|['’]s)?\s*birthday\s*$/i, '')
      .replace(/的?\s*生日\s*$/, '')
      .trim();
  }

  /**
   * 展示用名称：生日说成「名字（55岁）生日」，年龄放中间、「生日」收尾
   * 例：title「妈妈」+ age 55 → 「妈妈（55岁）生日」；农历、英文同理
   */
  function titleOf(ev, age) {
    var hasAge = age !== null && age !== undefined && age >= 0;
    var base = cleanTitle(ev.kind, ev.title);

    if (ev.kind === 'birthday') {
      // 名字是空的（理论上必填拦得住，导入数据可能没有）：只说「生日（55岁）」
      if (!base) return hasAge ? KINDS[ev.kind] + I.t('age.suffix', { n: age }) : KINDS[ev.kind];
      return I.t('name.birthday', {
        name: base,
        age: hasAge ? I.t('age.suffix', { n: age }) : ''
      });
    }

    return base || KINDS[ev.kind] || I.t('kind.generic');
  }

  /**
   * 这个事项此刻是否有任何提醒（归档 = 静音）
   * 仅用于界面显示小铃铛，与调度逻辑保持同一判断
   */
  function hasReminder(ev) {
    if (!ev || ev.archived || !ev.remind) return false;
    return !!(ev.remind.task || ev.remind.snack);
  }

  /**
   * 挑出当天该弹提示条的事件（只开「任务列表」的不算，归档的也不算）
   * @param {Array} events
   * @param {Date} today
   * @returns {Array<{ev:object, occ:object, offset:number, title:string}>}
   */
  function dueReminders(events, today) {
    var t = startOfDay(today || new Date());
    var out = [];
    (events || []).forEach(function (ev) {
      if (ev.archived) return;
      if (!ev.remind || !ev.remind.snack) return;
      var offsets = ev.remind.offsets || [];
      if (!offsets.length) return;

      var occ = nextOccurrence(ev, t);
      if (!occ.date || occ.isPast) return;
      if (offsets.indexOf(occ.days) === -1) return;

      out.push({
        ev: ev,
        occ: occ,
        offset: occ.days,
        title: titleOf(ev, ageAt(ev, occ, t))
      });
    });
    out.sort(function (a, b) { return a.offset - b.offset; });
    return out;
  }

  /**
   * 当前周期的长度与位置（进度条用），仅在每年重复时有意义
   *   total 上一回到这一回的天数 / done 已经过去的天数 / left 还剩下的天数
   * 生日要用 left 画（越接近生日越短），其余事项用 done 画，所以两个都留着
   * @returns {{total:number, done:number, left:number, ratio:number}|null}
   */
  function cycleInfo(ev, occ, today) {
    if (!ev.repeat || !occ || !occ.date || occ.days < 0) return null;
    var prev;
    if (ev.term && TERMS[ev.term]) {
      prev = termDate(ev.term, occ.date.getFullYear() - 1);
    } else if (ev.calendar === 'lunar' && ev.lunar) {
      var ly = occ.lunarYear - 1;
      if (ly < Lunar.MIN_YEAR) return null;
      prev = resolveLunar(ly, ev.lunar.month, ev.lunar.day, ev.lunar.isLeap, 'regular');
    } else {
      var base = parseYMD(ev.date);
      if (!base) return null;
      prev = safeYM(occ.date.getFullYear() - 1, base.getMonth(), base.getDate());
    }
    if (!prev) return null;
    var total = diffDays(prev, occ.date);
    if (total <= 0) return null;
    var left = Math.max(0, Math.min(total, diffDays(startOfDay(today || new Date()), occ.date)));
    var done = total - left;
    return { total: total, done: done, left: left, ratio: done / total };
  }

  /**
   * 一个公历日期的展示文本：公历与农历合成一段，谁在前由「当初按哪个历法填的」决定
   *   · 公历来源 → 「2026-05-12（农历四月初五）」  公历（农历）
   *   · 农历来源 → 「农历四月初五（2026-05-12）」  农历（公历）
   *   · 农历关闭 → 只有公历，不出现任何农历字样
   * @param {Date} solar 公历日期
   * @param {'solar'|'lunar'} source 这条记录是按哪种历法录入的
   * @param {{week?:boolean, cn?:boolean}} [opts] week 带星期；cn 用「5月12日 周二」这种短格式
   * @returns {string}
   */
  function dateText(solar, source, opts) {
    if (!solar) return '';
    var o = opts || {};
    var head = o.cn ? cnDate(solar) : ymd(solar) + (o.week ? ' · ' + WEEK[solar.getDay()] : '');
    if (!showLunar) return head;

    var lf = Lunar.solarToLunar(solar);
    // 超出农历查表年限（1900-2100）：只给公历，免得出现「腊月三十日第 500 天」这类脏值
    if (lf.outOfRange) return head;
    var lun = Lunar.lunarText(lf.month, lf.day, lf.isLeap);
    return source === 'lunar'
      ? I.t('date.pair', { a: lun, b: head })
      : I.t('date.pair', { a: head, b: lun });
  }

  /**
   * 事件的日期描述，如「2026-05-12（农历四月初五）」/「农历四月初五（2026-05-12）」
   * 生日例外：列表里该显示的是「这次生日」的日期，出生那天对倒数没有意义
   * @param {object} ev
   * @param {object} [occ] nextOccurrence 的结果
   * @param {{week?:boolean}} [opts]
   */
  function dateLabel(ev, occ, opts) {
    var week = !!(opts && opts.week);
    if (ev.term && TERMS[ev.term]) {
      var td = (occ && occ.date) || termDate(ev.term, new Date().getFullYear());
      return (td ? ymd(td) + ' · ' : '') + TERMS[ev.term].name;
    }
    var showOcc = ev.kind === 'birthday' && occ && occ.date;
    var d = showOcc ? occ.date : parseYMD(ev.date);
    if (!d) {
      // 公历日期缺失（只剩农历字段的导入数据）：农历关掉时也不能把农历漏出来
      if (ev.calendar === 'lunar' && ev.lunar) {
        return showLunar
          ? Lunar.lunarText(ev.lunar.month, ev.lunar.day, ev.lunar.isLeap)
          : I.t('date.notSet');
      }
      return I.t('date.notSet');
    }
    return dateText(d, ev.calendar, { week: week });
  }

  /**
   * 预设节日 → 事件字段（新建时用）
   * 返回的 date 是「下一次发生」的公历日期，农历节日同时给出 lunar 字段
   * @param {string} key FESTIVALS[].key
   * @param {Date} today 基准日
   * @returns {{title:string, calendar:string, date:string, lunar:object|null, term:string|null, color:string}|null}
   */
  function festivalFields(key, today) {
    var f = festivalByKey(key);
    if (!f) return null;
    var t = startOfDay(today || new Date());
    var out = { title: f.name, calendar: 'solar', date: null, lunar: null, term: null, color: f.color };

    if (f.group === 'lunar') {
      out.calendar = 'lunar';
      var lf = Lunar.solarToLunar(t);
      var ly = lf.year;
      var cand = resolveLunar(ly, f.month, f.day, false, 'regular');
      if (!cand || diffDays(t, cand) < 0) {
        var next = resolveLunar(ly + 1, f.month, f.day, false, 'regular');
        if (next) { ly = ly + 1; cand = next; }
      }
      // 除夕固定在腊月三十，小月由 resolveLunar 自动回落到廿九
      out.lunar = { year: ly, month: f.month, day: f.day, isLeap: false };
      out.date = cand ? ymd(cand) : ymd(t);
      return out;
    }

    if (f.group === 'term') {
      out.term = f.key;
      var td = termDate(f.key, t.getFullYear());
      if (!td || diffDays(t, td) < 0) td = termDate(f.key, t.getFullYear() + 1);
      out.date = td ? ymd(td) : ymd(t);
      return out;
    }

    var c = safeYM(t.getFullYear(), f.month - 1, f.day);
    if (diffDays(t, c) < 0) c = safeYM(t.getFullYear() + 1, f.month - 1, f.day);
    out.date = ymd(c);
    return out;
  }

  /** 生肖/干支说明，仅农历生日有意义；农历显示关掉时整块收起 */
  function zodiacLabel(ev) {
    if (!showLunar || ev.calendar !== 'lunar' || !ev.lunar) return '';
    return I.t('zodiac.label', { gz: Lunar.ganzhiOf(ev.lunar.year), z: Lunar.zodiacOf(ev.lunar.year) });
  }

  /** 今天是否有事（目前只被测试使用；运行时的提醒走 reminder-tasks 的期望集合） */
  function eventsOn(events, day) {
    var t = startOfDay(day || new Date());
    return events.filter(function (ev) {
      var occ = nextOccurrence(ev, t);
      return occ.date && occ.days === 0;
    });
  }

  return {
    COLORS: COLORS,
    KINDS: KINDS,
    WEEK: WEEK,
    DAY_MS: DAY_MS,
    REMIND_OFFSETS: REMIND_OFFSETS,
    TAG_DEFAULT: TAG_DEFAULT,
    FESTIVALS: FESTIVALS,
    FESTIVAL_GROUPS: FESTIVAL_GROUPS,
    TERMS: TERMS,
    setLang: setLang,
    getLang: getLang,
    setLunar: setLunar,
    countLunarEvents: countLunarEvents,
    hasLunarEvents: hasLunarEvents,
    festivalByKey: festivalByKey,
    festivalFields: festivalFields,
    termDate: termDate,
    defaultRemind: defaultRemind,
    startOfDay: startOfDay,
    diffDays: diffDays,
    ymd: ymd,
    parseYMD: parseYMD,
    cnDate: cnDate,
    uid: uid,
    emptyData: emptyData,
    emptySettings: emptySettings,
    normalize: normalize,
    normalizeRemind: normalizeRemind,
    nextOccurrence: nextOccurrence,
    resolveLunar: resolveLunar,
    lunarToSolarOf: lunarToSolarOf,
    yearsSince: yearsSince,
    anniversarySpan: anniversarySpan,
    anniversaryYears: anniversaryYears,
    ageOn: ageOn,
    ageAt: ageAt,
    titleOf: titleOf,
    cleanTitle: cleanTitle,
    hasReminder: hasReminder,
    dueReminders: dueReminders,
    cycleInfo: cycleInfo,
    dateText: dateText,
    dateLabel: dateLabel,
    zodiacLabel: zodiacLabel,
    eventsOn: eventsOn
  };
});
