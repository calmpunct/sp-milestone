/*!
 * 导出为纯文本：把全部事项按分类拼成一份人可读的备份
 *
 * 为什么是 TXT：备份要的是「十年后还能打开」。JSON 只有本插件能读回，
 * PDF/图片要额外库且体积大，TXT 任何设备、任何编辑器都打得开，
 * 出问题还能直接对着抄回去。
 *
 * 纯函数、无宿主依赖：给 app.js 生成文本，给 test/*.js 直接断言。
 */
(function (global, factory) {
  /* node-only:start （仅供 test/*.js require，构建时剥离）*/
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./event-core.js'), require('./i18n.js'), require('./lunar.js'));
    return;
  }
  /* node-only:end */
  global.ExportTxt = factory(global.EventCore, global.I18N, global.Lunar);
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (Core, I18N, Lunar) {
  'use strict';

  var I = I18N;

  // 分类顺序固定：生日常年被翻，倒数日最少 —— 与界面筛选条一致
  var KINDS = ['birthday', 'anniversary', 'countdown', 'festival'];

  var OFFSETS = (Core.REMIND_OFFSETS || [0, 1, 3, 7, 30]);

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function stamp(d) {
    return Core.ymd(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** 提前档位的文案；认不出的档位原样写「提前 N 天」，不让数据凭空消失 */
  function offsetText(n) {
    var v = +n;
    if (OFFSETS.indexOf(v) !== -1) return I.t('offset.' + v);
    return v === 0 ? I.t('offset.0') : String(v);
  }

  /**
   * 日期行：公历 + 农历都写出来。
   * 不跟界面上的「显示农历」开关走 —— 备份必须完整，开关关着也要把农历留下。
   */
  function dateText(ev) {
    var d = Core.parseYMD(ev.date);
    var solar = d ? Core.ymd(d) : '';
    var lun = ev.lunar && Lunar && typeof Lunar.lunarText === 'function'
      ? Lunar.lunarText(ev.lunar.month, ev.lunar.day, ev.lunar.isLeap)
      : '';
    if (solar && lun) return solar + '（' + lun + '）';
    if (solar) return solar;
    if (lun) return lun;
    return I.t('date.notSet');
  }

  function remindText(ev) {
    var r = ev.remind || {};
    if (!r.task) return I.t('export.off');
    var list = [];
    var src = r.offsets || [];
    for (var i = 0; i < src.length; i++) {
      var n = +src[i];
      if (OFFSETS.indexOf(n) === -1 || list.indexOf(n) !== -1) continue;
      list.push(n);
    }
    list.sort(function (a, b) { return a - b; });
    if (!list.length) return I.t('export.on');
    var out = [];
    for (var j = 0; j < list.length; j++) out.push(offsetText(list[j]));
    return out.join(' / ');
  }

  function statusText(ev) {
    if (ev.archived) return I.t('export.archived');
    return ev.remind && ev.remind.task ? I.t('export.on') : I.t('export.off');
  }

  /** 条目标题：与任务/列表里看到的名字一致（生日带年龄） */
  function entryTitle(ev, today) {
    return Core.titleOf(ev, Core.ageAt(ev, Core.nextOccurrence(ev, today), today));
  }

  /** 单条事项的明细行（不含标题那一行，标题由 build 带序号输出） */
  function entryLines(ev) {
    var lines = [];
    lines.push(I.t('export.date') + '：' + dateText(ev));
    lines.push(I.t('export.repeat') + '：' + (ev.repeat ? I.t('export.repeatYes') : I.t('export.repeatNo')));
    lines.push(I.t('export.remind') + '：' + remindText(ev));
    lines.push(I.t('export.status') + '：' + statusText(ev));
    var note = typeof ev.note === 'string' ? ev.note.trim() : '';
    if (note) {
      // 备注可能是多行：后续行同缩进，读起来还是同一条
      lines.push(I.t('export.note') + '：' + note.split(/\r?\n/).join('\n    '));
    }
    return lines;
  }

  /**
   * 生成整份文本
   * @param {object} data 规范化后的数据（Core.normalize 的产物）
   * @param {{now?:Date}} [opts]
   * @returns {string}
   */
  function build(data, opts) {
    var now = (opts && opts.now) || new Date();
    var events = (data && data.events) || [];
    var today = Core.startOfDay(now);

    var groups = {};
    var counts = {};
    var i, k;
    for (i = 0; i < KINDS.length; i++) { groups[KINDS[i]] = []; counts[KINDS[i]] = 0; }

    for (i = 0; i < events.length; i++) {
      var ev = events[i];
      if (!ev || typeof ev !== 'object') continue;
      var kind = groups[ev.kind] ? ev.kind : 'countdown';
      groups[kind].push(ev);
      counts[kind]++;
    }

    var out = [];
    out.push(I.t('export.head'));
    out.push(I.t('export.at', { time: stamp(now) }));
    out.push(I.t('export.sum', { n: events.length }));
    out.push('');

    for (i = 0; i < KINDS.length; i++) {
      k = KINDS[i];
      var list = groups[k];
      if (!list.length) continue;

      // 先按「有没有归档」再按「下一次发生的远近」排：归档的沉到最后
      list.sort(function (a, b) {
        var ra = a.archived ? 1 : 0;
        var rb = b.archived ? 1 : 0;
        if (ra !== rb) return ra - rb;
        var oa = Core.nextOccurrence(a, today);
        var ob = Core.nextOccurrence(b, today);
        var ta = oa && oa.date ? oa.date.getTime() : 0;
        var tb = ob && ob.date ? ob.date.getTime() : 0;
        if (ta !== tb) return ta - tb;
        return String(a.title || '') < String(b.title || '') ? -1 : 1;
      });

      out.push(I.t('export.section', { name: Core.KINDS[k] || k, n: counts[k] }));
      for (var j = 0; j < list.length; j++) {
        out.push((j + 1) + '. ' + entryTitle(list[j], today));
        var lines = entryLines(list[j]);
        for (var n = 0; n < lines.length; n++) out.push('    ' + lines[n]);
        if (j < list.length - 1) out.push('');
      }
      out.push('');
    }

    // 结尾统一留一个换行，贴进任何编辑器都不会少最后一行
    return out.join('\n').replace(/\n+$/, '') + '\n';
  }

  return {
    build: build
  };
});
