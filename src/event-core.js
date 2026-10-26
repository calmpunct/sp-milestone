/*!
 * 日子核心逻辑：数据模型 + 下一次发生时间推算
 * 依赖 Lunar（农历换算）
 */
(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./lunar.js'));
  } else {
    global.EventCore = factory(global.Lunar);
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (Lunar) {
  'use strict';

  var DAY_MS = 86400000;
  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  var KINDS = { birthday: '生日', anniversary: '纪念日', countdown: '倒数日' };

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

  function ymd(d) {
    return d.getFullYear() + '-' + Lunar.pad2(d.getMonth() + 1) + '-' + Lunar.pad2(d.getDate());
  }

  function parseYMD(s) {
    if (!s || typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (isNaN(d.getTime())) return null;
    if (d.getMonth() !== +m[2] - 1) return null;
    return d;
  }

  function cnDate(d) {
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()];
  }

  function uid() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  var COLORS = ['#e8590c', '#d6336c', '#7048e8', '#1c7ed6', '#0ca678', '#f59f00', '#c92a2a', '#5c7cfa'];

  // 可选的提前提醒天数
  var REMIND_OFFSETS = [0, 1, 3, 7, 30];

  /**
   * 提醒渠道是「每个日子各自选择」的，不是一个全局总开关：
   *   task  = true → 在任务列表里生成一条任务（关闭即删除该任务）
   *   snack = true → 打开应用时若到点，弹一条提示条
   * 两个渠道可以同时开，也可以只开一个。
   */
  function defaultRemind() {
    return { task: true, snack: false, offsets: [0, 1] };
  }

  function emptySettings() {
    return {
      leapPolicy: 'regular',
      // 任务归属的项目名
      taskProject: '里程碑提醒',
      // 顶部是否放大显示当前分区的第一条
      hero: true
    };
  }

  function emptyData() {
    return { version: 4, events: [], settings: emptySettings() };
  }

  /** 规范化外部数据，容错处理历史/损坏数据 */
  function normalize(raw) {
    var data = emptyData();
    if (!raw || typeof raw !== 'object') return data;

    // 2.0 及更早版本用全局开关控制渠道（settings.taskSync / snackOnOpen）。
    // 这两个值现在只用于迁移旧事件：旧事件没有渠道信息时按当时的全局设置还原。
    var legacy = { task: true, snack: false };

    if (raw.settings && typeof raw.settings === 'object') {
      var s = raw.settings;
      data.settings.leapPolicy = s.leapPolicy === 'strict' ? 'strict' : 'regular';
      if (typeof s.taskProject === 'string' && s.taskProject.trim()) {
        data.settings.taskProject = s.taskProject.trim().slice(0, 40);
      }
      data.settings.hero = s.hero !== false;
      if (typeof s.taskSync === 'boolean') legacy.task = s.taskSync;
      if (typeof s.snackOnOpen === 'boolean') legacy.snack = s.snackOnOpen;
    }

    var list = Array.isArray(raw.events) ? raw.events : [];
    data.events = list.map(function (e, i) {
      if (!e || typeof e !== 'object') return null;
      var date = parseYMD(e.date) ? ymd(parseYMD(e.date)) : null;
      var lunar = null;
      if (e.lunar && typeof e.lunar === 'object') {
        var lm = Math.round(+e.lunar.month), ld = Math.round(+e.lunar.day), ly = Math.round(+e.lunar.year);
        if (lm >= 1 && lm <= 12 && ld >= 1 && ld <= 30) {
          lunar = { year: ly || new Date().getFullYear(), month: lm, day: ld, isLeap: !!e.lunar.isLeap };
        }
      }
      var calendar = e.calendar === 'lunar' ? 'lunar' : 'solar';
      if (calendar === 'lunar' && !lunar) calendar = 'solar';

      // 公历日期缺失时用农历反推；两者都不可用则丢弃该条
      if (!date && lunar) {
        var back = lunarToSolarOf(lunar);
        if (back) date = ymd(back);
      }
      if (!date) return null;

      var kind = KINDS[e.kind] ? e.kind : 'countdown';

      return {
        id: typeof e.id === 'string' && e.id ? e.id : 'e' + i + Date.now().toString(36),
        title: cleanTitle(kind, typeof e.title === 'string' ? e.title.slice(0, 80) : ''),
        kind: kind,
        calendar: calendar,
        date: date,
        lunar: lunar,
        repeat: e.repeat === 'yearly' || kind !== 'countdown',
        color: typeof e.color === 'string' && /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : COLORS[0],
        note: typeof e.note === 'string' ? e.note.slice(0, 300) : '',
        pinned: !!e.pinned,
        remind: normalizeRemind(e.remind, legacy),
        // 归档：只在归档视图里出现，不参与提醒
        archived: !!e.archived,
        createdAt: +e.createdAt || Date.now()
      };
    }).filter(Boolean);
    return data;
  }

  /**
   * 归一化提醒配置
   * 优先级：新字段 task/snack >（迁移）旧的 on + 当时的全局开关 > 默认值
   */
  function normalizeRemind(r, legacy) {
    var base = legacy || { task: true, snack: false };
    if (!r || typeof r !== 'object') {
      return { task: base.task !== false, snack: base.snack === true, offsets: [0, 1] };
    }

    var offs = Array.isArray(r.offsets) ? r.offsets.filter(function (x) {
      return REMIND_OFFSETS.indexOf(+x) !== -1;
    }).map(Number) : [];
    offs.sort(function (a, b) { return a - b; });

    var task, snack;
    if (typeof r.task === 'boolean' || typeof r.snack === 'boolean') {
      task = r.task === true;
      snack = r.snack === true;
    } else {
      // 旧版：remind.on 表示「要不要提醒」，渠道由全局开关决定
      var on = r.on === true || r.on === 'yearly';
      task = on && base.task !== false;
      snack = on && base.snack === true;
    }

    return {
      task: task,
      snack: snack,
      // 兼容字段：旧版本插件读到 on 也能正确判断「有没有提醒」
      on: task || snack,
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
    var base = parseYMD(ev.date);
    if (!base) return { date: null, days: 0, isPast: true, index: 0 };

    if (!ev.repeat) {
      var dd = diffDays(t, base);
      return { date: base, days: dd, isPast: dd < 0, index: 0 };
    }

    // 每年重复：从今年开始往后找，最多找 8 年
    for (var k = 0; k < 8; k++) {
      var year = t.getFullYear() + k;
      var cand = safeYM(year, base.getMonth(), base.getDate());
      if (diffDays(t, cand) >= 0) {
        return { date: cand, days: diffDays(t, cand), isPast: false, index: k };
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

    if (!ev.repeat) {
      // 一次性农历日期：就是指定农历年那天
      var fixed = resolveLunar(lunar.year, lunar.month, lunar.day, lunar.isLeap, 'regular');
      if (!fixed) return { date: null, days: 0, isPast: true, index: 0 };
      var d = diffDays(t, fixed);
      return { date: fixed, days: d, isPast: d < 0, index: 0, lunarYear: lunar.year };
    }

    var lf = Lunar.solarToLunar(t);
    // 从上一个农历年开始扫，覆盖跨年边界
    for (var k = -1; k <= 4; k++) {
      var ly = lf.year + k;
      if (ly < Lunar.MIN_YEAR || ly > Lunar.MAX_YEAR) continue;
      var cand = resolveLunar(ly, lunar.month, lunar.day, lunar.isLeap, policy);
      if (!cand) continue;
      if (diffDays(t, cand) >= 0) {
        return {
          date: cand,
          days: diffDays(t, cand),
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
   * 清洗名称：去掉误写进名称里的年龄后缀
   * 年龄不进数据，只在渲染时拼接，这里做兜底防止「（55岁）（55岁）」叠加
   */
  function cleanTitle(kind, title) {
    var s = typeof title === 'string' ? title : '';
    if (kind !== 'birthday') return s;
    return s.replace(/[（(]\s*\d{1,3}\s*岁\s*[)）]\s*$/, '').trim();
  }

  /**
   * 展示用名称：生日把年龄并进名字后面，如「我妈生日（55岁）」
   */
  function titleOf(ev, age) {
    var base = ev.title || KINDS[ev.kind];
    if (ev.kind === 'birthday' && age !== null && age !== undefined && age >= 0) {
      return base + '（' + age + '岁）';
    }
    return base;
  }

  /**
   * 这个日子此刻是否有任何提醒（归档 = 静音）
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
        title: titleOf(ev, ageOn(ev, t))
      });
    });
    out.sort(function (a, b) { return a.offset - b.offset; });
    return out;
  }

  /** 当前周期已过百分比（用于进度条），仅在每年重复时有意义 */
  function cycleProgress(ev, occ) {
    if (!ev.repeat || !occ || !occ.date || occ.days < 0) return null;
    var prev;
    if (ev.calendar === 'lunar' && ev.lunar) {
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
    var done = diffDays(prev, startOfDay(new Date()));
    return Math.max(0, Math.min(1, done / total));
  }

  /** 事件的日期描述，如「1990-05-12 · 农历四月十八」 */
  function dateLabel(ev) {
    if (ev.calendar === 'lunar' && ev.lunar) {
      var s = lunarToSolarOf(ev.lunar);
      return (s ? ymd(s) + ' · ' : '') + Lunar.lunarText(ev.lunar.month, ev.lunar.day, ev.lunar.isLeap);
    }
    var b = parseYMD(ev.date);
    if (!b) return '日期未设置';
    var l = Lunar.solarToLunar(b);
    return ymd(b) + ' · ' + Lunar.lunarText(l.month, l.day, l.isLeap);
  }

  /** 生肖/干支说明，仅农历生日有意义 */
  function zodiacLabel(ev) {
    if (ev.calendar !== 'lunar' || !ev.lunar) return '';
    return Lunar.ganzhiOf(ev.lunar.year) + '年 · 属' + Lunar.zodiacOf(ev.lunar.year);
  }

  /** 今天是否有事（用于启动提醒） */
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
    ageOn: ageOn,
    titleOf: titleOf,
    cleanTitle: cleanTitle,
    hasReminder: hasReminder,
    dueReminders: dueReminders,
    cycleProgress: cycleProgress,
    dateLabel: dateLabel,
    zodiacLabel: zodiacLabel,
    eventsOn: eventsOn
  };
});
