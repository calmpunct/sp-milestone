/**
 * 任务投影对账逻辑测试（纯函数，不需要宿主）
 *   node test/reminder-tasks.test.js
 */
'use strict';
const Core = require('../src/event-core.js');
const RT = require('../src/reminder-tasks.js');

let fail = 0;
function eq(a, b, label) {
  if (a !== b) { fail++; console.log(`  ✗ ${label}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
}
function ok(c, label) { if (!c) { fail++; console.log('  ✗ ' + label); } }

const TODAY = new Date(2026, 9, 26); // 2026-10-26

function mk(o) {
  return Object.assign({
    id: 'x', title: 't', kind: 'birthday', calendar: 'solar',
    date: '1971-05-14', lunar: null, repeat: true, color: '#e8590c', note: '', pinned: false,
    remind: { task: true, snack: false, offsets: [0, 1, 3] }
  }, o);
}

/** 造一条「已经存在」的任务 */
function task(o) {
  return Object.assign({
    id: 't1', title: '', notes: '', dueDay: null, isDone: false, created: 1, projectId: 'p1'
  }, o);
}

/* ---------------- 1. 期望任务的形态 ---------------- */

console.log('[1] 期望任务');
const mom = mk({ id: 'e1', title: '妈妈生日' });
const d1 = RT.desiredTask(mom, TODAY);
eq(d1.title, '🎂 妈妈生日（55岁）', '标题带类型图标与年龄');
eq(d1.dueDay, '2027-05-11', '到期日 = 事件日 - 最近的提醒档位（提前 3 天）');
eq(d1.offset, 3, '选中的是提前 3 天档位');
eq(d1.cycle, '2027-05-14', '周期记的是事件发生日');
ok(d1.notes.includes('cd:ev=e1;cy=2027-05-14'), '备注带机器标记');
ok(d1.notes.includes('提前 3 天提醒'), '备注写清档位');

const ann = mk({ id: 'e2', kind: 'anniversary', title: '结婚纪念日', date: '2018-06-16', remind: { task: true, snack: false, offsets: [7, 30] } });
const d2 = RT.desiredTask(ann, TODAY);
eq(d2.title, '🎉 结婚纪念日', '纪念日图标，不加年龄');
eq(d2.dueDay, '2027-05-17', '提前 30 天（更早的档位）');

const cd = mk({ id: 'e3', kind: 'countdown', title: '项目上线', date: '2026-12-01', repeat: false, remind: { task: true, snack: false, offsets: [0, 1, 3, 7] } });
const d3 = RT.desiredTask(cd, TODAY);
eq(d3.title, '⏳ 项目上线', '倒数日图标');
eq(d3.dueDay, '2026-11-24', '一次性倒数日按提前 7 天');

/* ---------------- 2. 档位随时间推进 ---------------- */

console.log('[2] 档位推进');
const D = (y, m, d) => new Date(y, m - 1, d);
eq(RT.nextSlot(mom, D(2027, 5, 1)).offset, 3, '还早时取最早的档位');
eq(RT.nextSlot(mom, D(2027, 5, 11)).offset, 3, '恰好到提前 3 天');
eq(RT.nextSlot(mom, D(2027, 5, 12)).offset, 1, '过了 3 天档位 → 提前 1 天');
eq(RT.nextSlot(mom, D(2027, 5, 13)).offset, 1, '明天过生日 → 提前 1 天');
eq(RT.nextSlot(mom, D(2027, 5, 14)).offset, 0, '生日当天');

// 全部档位都过期（今天就是正日子，但只配了提前 3 天）→ 回落到最小的逾期档位
const late = RT.nextSlot(mk({ id: 'e9', remind: { task: true, snack: false, offsets: [3] } }), D(2027, 5, 14));
eq(late.offset, 3, '档位全过期时保留逾期任务');
eq(Core.ymd(late.date), '2027-05-11', '逾期任务的到期日仍是原提醒日');

// 一次性事件过期后不再有任务
eq(RT.nextSlot(cd, D(2026, 12, 2)), null, '一次性事件过后没有任务');
// 只开提示条渠道时没有任务（任务列表这一侧是关的）
eq(RT.nextSlot(mk({ remind: { task: false, snack: true, offsets: [0] } }), TODAY), null, '只开提示条不产生任务');
// 归档的日子不产生任务（归档 = 静音）
eq(RT.nextSlot(mk({ archived: true }), TODAY), null, '归档的日子不产生任务');
eq(RT.desiredTask(mk({ archived: true, remind: { task: true, snack: true, offsets: [0, 1] } }), TODAY), null, '归档优先于渠道开关');

/* ---------------- 3. 对账 ---------------- */

console.log('[3] 对账：新增');
let p = RT.plan({ events: [mom, ann], existing: [], today: TODAY });
eq(p.add.length, 2, '空列表 → 新增 2 条');
eq(p.update.length, 0, '无更新');
eq(p.remove.length, 0, '无删除');

console.log('[4] 对账：改名与改期');
let existing = [
  task({ id: 't1', title: '🎂 妈妈生日（55岁）', notes: d1.notes, dueDay: d1.dueDay, created: 1 })
];
p = RT.plan({ events: [mom], existing: existing, today: TODAY });
eq(p.add.length + p.update.length + p.remove.length, 0, '完全一致时零操作');

const renamed = mk({ id: 'e1', title: '妈妈生日（农历）' });
p = RT.plan({ events: [renamed], existing: existing, today: TODAY });
eq(p.update.length, 1, '改名触发更新');
eq(p.update[0].patch.title, '🎂 妈妈生日（农历）（55岁）'.replace('（农历）', '（农历）'), '标题同步');

const moved = mk({ id: 'e1', title: '妈妈生日', date: '1971-05-20' });
p = RT.plan({ events: [moved], existing: existing, today: TODAY });
eq(p.update[0].patch.dueDay, '2027-05-17', '改日期后到期日跟着变');

const remindChanged = mk({ id: 'e1', title: '妈妈生日', remind: { task: true, snack: false, offsets: [0, 30] } });
p = RT.plan({ events: [remindChanged], existing: existing, today: TODAY });
eq(p.update[0].patch.dueDay, '2027-04-14', '改档位后到期日跟着变（提前 30 天）');

console.log('[5] 对账：删除与关闭');
p = RT.plan({ events: [], existing: existing, today: TODAY });
eq(p.remove.length, 1, '事件删除 → 任务删除');
eq(p.remove[0].reason, 'orphan', '判定为孤儿');

p = RT.plan({ events: [mk({ id: 'e1', title: '妈妈生日', remind: { task: false, snack: true, offsets: [0, 1, 3] } })], existing: existing, today: TODAY });
eq(p.remove.length, 1, '关掉任务列表（只留提示条）→ 任务删除');

p = RT.plan({ events: [mk({ id: 'e1', title: '妈妈生日', archived: true })], existing: existing, today: TODAY });
eq(p.remove.length, 1, '归档 → 任务删除');

// 非本插件管理的任务（备注无标记）不碰
p = RT.plan({ events: [], existing: [task({ id: 'zz', title: '别人的任务', notes: '普通备注' })], today: TODAY });
eq(p.remove.length, 0, '不删除用户自己的任务');

console.log('[6] 对账：完成态');
const doneSameCycle = [task({ id: 't1', title: d1.title, notes: d1.notes, dueDay: d1.dueDay, isDone: true, created: 1 })];
p = RT.plan({ events: [mom], existing: doneSameCycle, today: TODAY });
eq(p.update.length, 0, '本轮已完成 → 不再复活');
eq(p.add.length, 0, '本轮已完成 → 不重复创建');

// 跨年：换到下一个周期时重新打开
const doneLastYear = [task({
  id: 't1', title: '🎂 妈妈生日（54岁）',
  notes: '生日 · 2026-05-14 · 每年\n提前 3 天提醒 · 应处理日 2026-05-11\ncd:ev=e1;cy=2026-05-14',
  dueDay: '2026-05-11', isDone: true, created: 1
})];
p = RT.plan({ events: [mom], existing: doneLastYear, today: TODAY });
eq(p.update.length, 1, '跨年触发更新');
eq(p.update[0].patch.isDone, false, '跨年后重新打开');
eq(p.update[0].patch.dueDay, '2027-05-11', '到期日推进到下一年');

console.log('[7] 对账：重复任务');
const dup = [
  task({ id: 't1', title: d1.title, notes: d1.notes, dueDay: d1.dueDay, created: 1 }),
  task({ id: 't2', title: d1.title, notes: d1.notes, dueDay: d1.dueDay, created: 2 })
];
p = RT.plan({ events: [mom], existing: dup, today: TODAY });
eq(p.remove.length, 1, '重复任务删掉多余的一条');
eq(p.remove[0].task.id, 't2', '保留最早创建的那条');
eq(p.add.length, 0, '不会因为重复而新建');

/* ---------------- 8. 标记解析容错 ---------------- */

console.log('[8] 标记解析');
eq(RT.parseMark(undefined), null, '备注缺失');
eq(RT.parseMark('随便写点'), null, '普通备注');
eq(RT.parseMark('cd:ev=e1;cy=2026-05-14').eventId, 'e1', '解析事件 id');
eq(RT.parseMark('cd:ev=e1;cy=2026-05-14').cycle, '2026-05-14', '解析周期');
eq(RT.parseMark('前缀\ncd:ev=a:b;cy=2026-01-02\n后缀').eventId, 'a:b', '备注被编辑过也能认出来');

/* ---------------- 9. 空数据安全 ---------------- */

console.log('[9] 边界');
eq(RT.plan({ events: [], existing: [], today: TODAY }).add.length, 0, '空数据不产生任务');
eq(RT.desiredTask(mk({ remind: { task: true, snack: false, offsets: [] } }), TODAY), null, '没有档位不产生任务');
eq(RT.desiredTask(mk({ remind: { task: true, snack: false, offsets: [99] } }), TODAY), null, '非法档位不产生任务');

console.log(fail === 0 ? '\n✅ 全部通过' : `\n❌ 失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
