/*!
 * 提醒 → 任务列表：投影与对账逻辑（纯函数，便于单测）
 *
 * 设计原则：插件数据是唯一真相（source of truth），任务列表只是投影。
 * 每次对账都拿「期望任务集合」和「现有任务」做 diff，因此：
 *   · 事件被删除        → 对应任务被识别为孤儿并删除
 *   · 事件被修改        → 标题/日期/备注差异触发 updateTask
 *   · 关掉该日子的任务提醒 → 该事件不再出现在期望集合 → 任务删除
 *   · 该日子被归档      → 同上，任务删除
 *   · 任务在列表被改动  → 下次对账按数据覆盖回正确状态
 * 不需要删除时特意记账，也不会出现「删了提醒但任务还在」。
 */
(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./event-core.js'));
  } else {
    global.ReminderTasks = factory(global.EventCore);
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  var PROJECT_TITLE = '纪念日提醒';

  // 备注里的机器标记，用于跨设备识别「这条任务是谁生成的」
  // 形如：cd:ev=e1;cy=2026-05-14   （cy = 本轮事件发生的公历日期）
  var MARK_RE = /cd:ev=([A-Za-z0-9_\-:]+);cy=(\d{4}-\d{2}-\d{2})/;

  var ICONS = { birthday: '🎂', anniversary: '🎉', countdown: '⏳', festival: '🎊' };

  var OFFSET_TEXT = { 0: '当天', 1: '提前 1 天', 3: '提前 3 天', 7: '提前 7 天', 30: '提前 30 天' };

  /** 生成备注里的标记行 */
  function markLine(eventId, cycle) {
    return 'cd:ev=' + eventId + ';cy=' + cycle;
  }

  /** 从备注解析标记；不是本插件管理的任务返回 null */
  function parseMark(notes) {
    if (typeof notes !== 'string') return null;
    var m = MARK_RE.exec(notes);
    if (!m) return null;
    return { eventId: m[1], cycle: m[2] };
  }

  function iconOf(kind) {
    return ICONS[kind] || '📌';
  }

  function shiftDay(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function sortedOffsets(ev) {
    var list = (ev && ev.remind && ev.remind.offsets) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var n = +list[i];
      if (OFFSET_TEXT[n] && out.indexOf(n) === -1) out.push(n);
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  /**
   * 下一个提醒档位：把每个「提前 N 天」换算成提醒日期，取今天及以后最近的一个
   * 全部已过期时（例如今天就是正日子而只配了提前 3 天）回落到最晚的那个，任务显示为逾期
   * 归档的日子、只开了提示条的日子都不产生任务
   * @returns {{offset:number, date:Date, cycle:string, occ:object}|null}
   */
  function nextSlot(ev, today) {
    if (!ev || ev.archived) return null;
    if (!ev.remind || !ev.remind.task) return null;
    var offsets = sortedOffsets(ev);
    if (!offsets.length) return null;

    var t = Core.startOfDay(today || new Date());
    var occ = Core.nextOccurrence(ev, t);
    if (!occ || !occ.date || occ.isPast) return null;

    var cands = offsets.map(function (o) {
      return { offset: o, date: shiftDay(occ.date, -o) };
    });

    var future = cands.filter(function (c) { return Core.diffDays(t, c.date) >= 0; });
    var pool = future.length ? future : cands;
    var pick = pool[0];
    for (var i = 1; i < pool.length; i++) {
      // 有未来档位时取最早的（最近的提醒），否则取最晚的（最小的逾期档位）
      var better = future.length
        ? pick.date.getTime() > pool[i].date.getTime()
        : pick.date.getTime() < pool[i].date.getTime();
      if (better) pick = pool[i];
    }

    return {
      offset: pick.offset,
      date: pick.date,
      cycle: Core.ymd(occ.date),
      occ: occ
    };
  }

  /** 某个事件此刻在任务列表里应该长什么样；不该有任务时返回 null */
  function desiredTask(ev, today) {
    var slot = nextSlot(ev, today);
    if (!slot) return null;

    var t = Core.startOfDay(today);
    var title = iconOf(ev.kind) + ' ' + Core.titleOf(ev, Core.ageOn(ev, t));
    var typeText = Core.KINDS[ev.kind] || '日子';
    var line2 = Core.dateLabel(ev, slot.occ) + (ev.repeat ? ' · 每年' : '');
    var notes = [
      typeText + ' · ' + line2,
      OFFSET_TEXT[slot.offset] + '提醒 · 应处理日 ' + Core.ymd(slot.date),
      markLine(ev.id, slot.cycle)
    ].join('\n');

    return {
      eventId: ev.id,
      kind: ev.kind,
      title: title,
      dueDay: Core.ymd(slot.date),
      notes: notes,
      offset: slot.offset,
      cycle: slot.cycle
    };
  }

  /**
   * 对账：期望集合 vs 现有任务
   * @param {{events:Array, existing:Array, today:Date}} params
   *        existing 为宿主里的任务对象（需含 id/title/notes/dueDay/isDone/created）
   * @returns {{add:Array, update:Array, remove:Array, wanted:number}}
   */
  function plan(params) {
    params = params || {};
    var today = params.today || new Date();
    var events = params.events || [];
    var existing = params.existing || [];

    // 1. 期望集合
    var desired = [];
    for (var i = 0; i < events.length; i++) {
      var d = desiredTask(events[i], today);
      if (d) desired.push(d);
    }

    // 2. 现有任务按 eventId 归组（同一事件出现多条视为历史重复，只保留最早的一条）
    var groups = {};
    for (var j = 0; j < existing.length; j++) {
      var task = existing[j];
      var mark = parseMark(task.notes);
      if (!mark) continue;
      if (!groups[mark.eventId]) groups[mark.eventId] = [];
      groups[mark.eventId].push({ task: task, mark: mark });
    }

    var add = [];
    var update = [];
    var remove = [];
    var wanted = {};

    // 3. 按期望逐条比对
    desired.forEach(function (d) {
      wanted[d.eventId] = true;
      var rows = groups[d.eventId];

      if (!rows || !rows.length) {
        add.push(d);
        return;
      }

      rows.sort(function (a, b) {
        return (+a.task.created || 0) - (+b.task.created || 0);
      });

      for (var k = 1; k < rows.length; k++) {
        remove.push({ task: rows[k].task, eventId: d.eventId, reason: 'duplicate' });
      }

      var task = rows[0].task;
      var mark = rows[0].mark;

      // 本轮已经处理完：同一年度周期内不再复活，避免「勾完又冒出来」
      if (task.isDone && mark.cycle === d.cycle) return;

      var patch = {};
      if (task.title !== d.title) patch.title = d.title;
      if ((task.dueDay || '') !== d.dueDay) patch.dueDay = d.dueDay;
      if ((task.notes || '') !== d.notes) patch.notes = d.notes;
      // 上一轮已完成，跨到新周期时重新打开
      if (mark.cycle !== d.cycle && task.isDone) patch.isDone = false;

      if (Object.keys(patch).length) {
        update.push({ task: task, eventId: d.eventId, patch: patch, reason: mark.cycle !== d.cycle ? 'new-cycle' : 'changed' });
      }
    });

    // 4. 孤儿任务：数据里已经没有这个事件，或它已经不需要提醒
    for (var m = 0; m < existing.length; m++) {
      var t2 = existing[m];
      var mk = parseMark(t2.notes);
      if (!mk) continue;
      if (wanted[mk.eventId]) continue;
      remove.push({ task: t2, eventId: mk.eventId, reason: 'orphan' });
    }

    return { add: add, update: update, remove: remove, wanted: desired.length };
  }

  return {
    PROJECT_TITLE: PROJECT_TITLE,
    OFFSET_TEXT: OFFSET_TEXT,
    markLine: markLine,
    parseMark: parseMark,
    iconOf: iconOf,
    nextSlot: nextSlot,
    desiredTask: desiredTask,
    plan: plan
  };
});
