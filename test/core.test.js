const L = require('../src/lunar.js');
const Core = require('../src/event-core.js');

let fail = 0;
function eq(a, b, label) {
  if (a !== b) { fail++; console.log(`  ✗ ${label}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
}
function ok(cond, label) { if (!cond) { fail++; console.log(`  ✗ ${label}`); } }
function ymd(d) { return d ? Core.ymd(d) : 'null'; }

const TODAY = new Date(2026, 9, 26); // 2026-10-26

function mk(o) {
  return Object.assign({
    id: 'x', title: 't', kind: 'birthday', calendar: 'solar',
    date: '1990-05-12', lunar: null, repeat: true, color: '#e8590c', note: '', pinned: false
  }, o);
}

// 1. 公历生日
console.log('[1] 公历每年重复');
let r = Core.nextOccurrence(mk({ date: '1990-05-12' }), TODAY);
eq(ymd(r.date), '2027-05-12', '下一次日期');
eq(r.days, 198, '天数');
eq(Core.yearsSince(mk({ date: '1990-05-12' }), r), 37, '周岁');

// 2. 今年还没到的生日
r = Core.nextOccurrence(mk({ date: '1990-12-25' }), TODAY);
eq(ymd(r.date), '2026-12-25', '今年内');
eq(r.days, 60, '天数');

// 3. 今天就是
r = Core.nextOccurrence(mk({ date: '1990-10-26' }), TODAY);
eq(ymd(r.date), '2026-10-26', '今天');
eq(r.days, 0, '0 天');
ok(!r.isPast, '不算过期');

// 4. 2 月 29 日在平年回落
r = Core.nextOccurrence(mk({ date: '2000-02-29' }), TODAY);
eq(ymd(r.date), '2027-02-28', '闰日回落到 2-28');

// 5. 一次性倒数日（未来）
r = Core.nextOccurrence(mk({ kind: 'countdown', repeat: false, date: '2027-01-01' }), TODAY);
eq(ymd(r.date), '2027-01-01', '倒数日');
eq(r.days, 67, '天数');
ok(!r.isPast, '未过期');

// 6. 已过的一次性倒数日
r = Core.nextOccurrence(mk({ kind: 'countdown', repeat: false, date: '2026-01-01' }), TODAY);
eq(r.days, -298, '已过天数');
ok(r.isPast, '标记过期');

// 7. 农历生日（1990 年四月十八）
console.log('[2] 农历生日');
const lunarEv = mk({ calendar: 'lunar', lunar: { year: 1990, month: 4, day: 18, isLeap: false }, date: '1990-05-12' });
r = Core.nextOccurrence(lunarEv, TODAY);
ok(r.date !== null, '有下一次日期');
const occLunar = L.solarToLunar(r.date);
eq(`${occLunar.month}/${occLunar.day}`, '4/18', '落在四月十八');
eq(occLunar.year, 2027, '落在 2027 农历年');
eq(r.days > 0, true, '天数大于 0');
console.log(`     2027 四月十八 = ${ymd(r.date)}，还有 ${r.days} 天`);
eq(Core.yearsSince(lunarEv, r), 37, '农历周岁');

// 8. 农历三十遇到小月
console.log('[3] 边界：小月与闰月');
const ev30 = mk({ calendar: 'lunar', lunar: { year: 1990, month: 1, day: 30, isLeap: false } });
const resolved = Core.resolveLunar(2027, 1, 30, false, 'regular');
const dim = L.monthDays(2027, 1);
console.log(`     2027 正月 ${dim} 天，三十解析为 ${ymd(resolved)}`);
ok(resolved !== null, '小月三十可解析');
if (dim === 29) eq(L.solarToLunar(resolved).day, 29, '回落廿九');

// 9. 闰月生日：2025 闰六月初十，2026 无闰六月 -> 回落六月
const leapEv = mk({ calendar: 'lunar', lunar: { year: 2025, month: 6, day: 10, isLeap: true } });
const in2025 = Core.resolveLunar(2025, 6, 10, true, 'regular');
const in2026 = Core.resolveLunar(2026, 6, 10, true, 'regular');
const in2026strict = Core.resolveLunar(2026, 6, 10, true, 'strict');
ok(L.solarToLunar(in2025).isLeap === true, '2025 落在闰六月');
ok(in2026 !== null && L.solarToLunar(in2026).isLeap === false, '2026 回落到平六月');
eq(in2026strict, null, '严格模式跳过无闰年');

// 10. 闰月生日在闰年正日的选择
r = Core.nextOccurrence(leapEv, TODAY);
console.log(`     闰六月初十 下一次 = ${ymd(r.date)}（${L.lunarText(L.solarToLunar(r.date).month, L.solarToLunar(r.date).day, L.solarToLunar(r.date).isLeap)}）`);

// 11. 跨年边界：农历腊月廿九，今天公历 1 月
const ev12 = mk({ calendar: 'lunar', lunar: { year: 1990, month: 12, day: 29, isLeap: false } });
const janDay = new Date(2027, 0, 20);
const r12 = Core.nextOccurrence(ev12, janDay);
ok(r12.date !== null && !r12.isPast, '跨年边界有结果');
console.log(`     腊月廿九（基准 2027-01-20）-> ${ymd(r12.date)}`);

// 12. normalize 容错
console.log('[4] 数据容错');
const bad = Core.normalize({
  events: [
    null,
    { title: 'A', date: '2026-02-30', color: 'red' },   // 非法日期 -> 丢弃
    { title: 'B', kind: 'weird', date: '2026-03-05', color: '#123456' },
    { title: 'C', calendar: 'lunar' },                  // 无任何日期 -> 丢弃
    { title: 'D', date: '2026-01-01', lunar: { month: 13, day: 1 } },
    { title: 'E', date: '2026-01-01', note: 'x'.repeat(500) },
    { title: 'F', calendar: 'lunar', lunar: { year: 1990, month: 4, day: 18 } } // 仅农历 -> 反推公历
  ]
});
const by = (t) => bad.events.filter((e) => e.title === t)[0];
eq(bad.events.length, 4, '保留 4 条合法记录');
ok(!by('A'), '非法日期被丢弃');
eq(by('B').color, '#123456', '合法颜色保留');
eq(by('B').kind, 'countdown', '未知类型回落');
eq(by('D').calendar, 'solar', '非法农历回落公历');
eq(by('E').note.length, 300, '备注截断');
eq(by('F').calendar, 'lunar', '农历记录保留');
eq(by('F').date, '1990-05-12', '由农历反推公历');

// 13. 时间旅行一致性：任意年份推算都不崩
console.log('[5] 多年遍历稳定性');
let bad2 = 0;
for (let y = 2026; y <= 2099; y++) {
  const t = new Date(y, 5, 15);
  const rr = Core.nextOccurrence(lunarEv, t);
  if (!rr.date || rr.days < 0 || rr.days > 400) bad2++;
}
eq(bad2, 0, '2026-2099 农历推算全部正常');

// 14. 生日累计提醒：同一天多件事
const list = [mk({ id: 'a', date: '1990-10-26' }), mk({ id: 'b', date: '2020-10-26' }), mk({ id: 'c', date: '1990-03-03' })];
eq(Core.eventsOn(list, TODAY).length, 2, '今天命中 2 件');

// 15. 日期标签
console.log('[6] 展示文案');
console.log('     ' + Core.dateLabel(lunarEv));
console.log('     ' + Core.dateLabel(mk({ date: '1990-05-12' })));
ok(Core.dateLabel(lunarEv).includes('四月十八'), '农历文案');
eq(Core.zodiacLabel(lunarEv), '庚午年 · 属马', '生肖文案');

// 16. 年龄与名称
console.log('[7] 年龄并入名称');
const mom = mk({ title: '我妈生日', date: '1971-05-14' });
eq(Core.ageOn(mom, TODAY), 55, '生日已过 -> 55 岁');
eq(Core.titleOf(mom, Core.ageOn(mom, TODAY)), '我妈生日（55岁）', '名称带年龄');

const kid = mk({ title: '小米', date: '2019-11-08' });
eq(Core.ageOn(kid, TODAY), 6, '生日未到 -> 6 岁');
eq(Core.titleOf(kid, Core.ageOn(kid, TODAY)), '小米（6岁）', '名称带年龄（未到生日）');

const onDay = mk({ title: '当天', date: '2019-10-26' });
eq(Core.ageOn(onDay, TODAY), 7, '生日当天即为新年龄');

const ann = mk({ title: '结婚纪念日', kind: 'anniversary', date: '2018-06-16' });
eq(Core.titleOf(ann, 8), '结婚纪念日', '纪念日名称不加年龄');

// 农历生日年龄
eq(Core.ageOn(lunarEv, TODAY), 36, '农历生日年龄（1990 年生）');
eq(Core.titleOf(mk({ title: '妈妈生日', calendar: 'lunar', lunar: { year: 1968, month: 4, day: 18 } }), 58),
  '妈妈生日（58岁）', '农历名称带年龄');

// 尚未出生
eq(Core.ageOn(mk({ date: '2030-01-01' }), TODAY), null, '未来日期无年龄');
eq(Core.titleOf(mk({ title: '未来', date: '2030-01-01' }), null), '未来', '无年龄时不加括号');

// 17. 年龄不落库：名称存的是纯文本，年龄只在渲染时拼接
console.log('[7.1] 年龄不写入数据');
eq(Core.cleanTitle('birthday', '我妈生日（55岁）'), '我妈生日', '去掉全角括号年龄');
eq(Core.cleanTitle('birthday', '我妈生日(55岁)'), '我妈生日', '去掉半角括号年龄');
eq(Core.cleanTitle('birthday', '我妈生日'), '我妈生日', '纯名称原样保留');
eq(Core.cleanTitle('anniversary', '结婚纪念日（8岁）'), '结婚纪念日（8岁）', '非生日不剥离');
eq(Core.cleanTitle('birthday', '小（55岁）朋友'), '小（55岁）朋友', '只剥离结尾的年龄后缀');

const dirty = Core.normalize({ events: [
  { id: 'd1', title: '我妈生日（55岁）', kind: 'birthday', date: '1971-05-14' },
  { id: 'd2', title: '我妈生日', kind: 'birthday', date: '1971-05-14' }
] });
eq(dirty.events[0].title, '我妈生日', '导入时清掉年龄后缀');
eq(Core.titleOf(dirty.events[0], 55), '我妈生日（55岁）', '渲染时重新拼接，不重复');
eq(dirty.events[1].title, '我妈生日', '数据里始终是纯名称');

// 17. 提醒渠道（每个日子独立）
console.log('[8] 自定义提醒渠道');
const evR = {
  id: 'r1', title: '项目上线', kind: 'countdown', calendar: 'solar', date: '2026-11-02',
  lunar: null, repeat: false, remind: { task: true, snack: true, offsets: [0, 1, 3, 7] }
};
let due = Core.dueReminders([evR], TODAY);
eq(due.length, 1, '提前 7 天命中的确提醒');
eq(due[0].offset, 7, '命中 7 天档位');
eq(due[0].title, '项目上线', '提醒文案名称');

evR.remind.offsets = [1, 3];
eq(Core.dueReminders([evR], TODAY).length, 0, '未配置的档位不提醒');

// 只开任务列表：进任务列表，但不弹提示条
evR.remind.offsets = [7];
evR.remind.snack = false;
eq(Core.dueReminders([evR], TODAY).length, 0, '只开任务列表的日子不弹提示条');
eq(Core.hasReminder(evR), true, '开了任务列表仍算有提醒');

// 只开提示条
evR.remind.snack = true;
evR.remind.task = false;
eq(Core.dueReminders([evR], TODAY).length, 1, '只开提示条的日子仍然弹');
evR.remind.task = true;

// 归档 = 静音（两个渠道都静音）
evR.archived = true;
eq(Core.dueReminders([evR], TODAY).length, 0, '归档的日子不弹提示条');
eq(Core.hasReminder(evR), false, '归档的日子不显示铃铛');
evR.archived = false;

eq(Core.hasReminder({ remind: { task: false, snack: false } }), false, '两个渠道都关着不显示铃铛');
eq(Core.hasReminder({ remind: { task: true, snack: false } }), true, '任一渠道开着就显示铃铛');

// 当天命中
const evToday = { id: 'r2', title: '今天的事', kind: 'anniversary', calendar: 'solar',
  date: Core.ymd(TODAY), lunar: null, repeat: true, remind: { task: true, snack: true, offsets: [0, 1] } };
eq(Core.dueReminders([evToday], TODAY)[0].offset, 0, '当天命中 0 档位');

// 过期的一次性日子不提醒
const evPast = { id: 'r3', title: '过期', kind: 'countdown', calendar: 'solar', date: '2026-01-01',
  lunar: null, repeat: false, remind: { task: true, snack: true, offsets: [0] } };
eq(Core.dueReminders([evPast], TODAY).length, 0, '过期不提醒');

// 排序：offset 小的在前
const many = Core.dueReminders([
  { id: 'a', title: 'A', kind: 'countdown', calendar: 'solar', date: '2026-11-02', lunar: null, repeat: false, remind: { task: true, snack: true, offsets: [7] } },
  { id: 'b', title: 'B', kind: 'countdown', calendar: 'solar', date: '2026-10-27', lunar: null, repeat: false, remind: { task: true, snack: true, offsets: [1] } }
], TODAY);
eq(many.map((x) => x.offset).join(','), '1,7', '按临近程度排序');

// 18. 提醒配置的容错与旧数据迁移
console.log('[9] 提醒配置容错与旧数据迁移');
const nd = Core.normalize({ events: [{ title: 'x', date: '2026-01-01' }] }).events[0];
eq(nd.remind.task, true, '旧数据默认加入任务列表');
eq(nd.remind.snack, false, '旧数据默认不弹提示条');
eq(nd.remind.offsets.join(','), '0,1', '默认当天 + 提前 1 天');
eq(nd.archived, false, '默认不归档');

const nbad = Core.normalize({ events: [{ title: 'y', date: '2026-01-01', remind: { task: true, offsets: [2, 5, 99] } }] }).events[0];
eq(nbad.remind.offsets.join(','), '0', '非法档位回落当天');

const noff = Core.normalize({ events: [{ title: 'z', date: '2026-01-01', remind: { task: false, snack: false, offsets: [7] } }] }).events[0];
eq(noff.remind.task, false, '关闭任务列表被保留');
eq(noff.remind.offsets.join(','), '7', '关闭时保留档位');
eq(noff.remind.on, false, '兼容字段 on 同步为 false');

// 2.0 旧数据：on + 全局 taskSync/snackOnOpen → 折算成每个日子的渠道
const legacy1 = Core.normalize({
  settings: { taskSync: true, snackOnOpen: false },
  events: [{ title: 'a', date: '2026-01-01', remind: { on: true, offsets: [0, 3] } }]
});
eq(legacy1.events[0].remind.task, true, '旧 on:true + taskSync → 任务列表');
eq(legacy1.events[0].remind.snack, false, '旧 snackOnOpen:false → 不弹提示条');
eq('taskSync' in legacy1.settings, false, '全局开关不再出现在数据里');
eq('defaultTask' in legacy1.settings, false, '不再保留新建默认值字段');

const legacy2 = Core.normalize({
  settings: { taskSync: false, snackOnOpen: true },
  events: [{ title: 'b', date: '2026-01-01', remind: { on: true, offsets: [1] } }]
});
eq(legacy2.events[0].remind.task, false, '旧 taskSync:false → 不建任务');
eq(legacy2.events[0].remind.snack, true, '旧 snackOnOpen:true → 弹提示条');
eq(Object.keys(legacy2.settings).sort().join(','), 'hero,leapPolicy,taskProject', 'settings 只剩历法策略、项目名与置顶开关');
eq(legacy2.settings.hero, true, '旧数据默认开启置顶卡片');
eq(Core.normalize({ settings: { hero: false } }).settings.hero, false, '关闭置顶被保留');
eq(Core.normalize({}).settings.hero, true, '没有 settings 时默认开启');

const legacyOff = Core.normalize({
  settings: { taskSync: true, snackOnOpen: false },
  events: [{ title: 'c', date: '2026-01-01', remind: { on: false, offsets: [0] } }]
}).events[0];
eq(legacyOff.remind.task, false, '旧 on:false 不建任务');
eq(legacyOff.remind.snack, false, '旧 on:false 不弹提示条');

// 归档字段
const arch = Core.normalize({ events: [{ title: 'd', date: '2026-01-01', archived: true }] }).events[0];
eq(arch.archived, true, '归档标记保留');
eq(Core.normalize({ events: [{ title: 'e', date: '2026-01-01', archived: 'yes' }] }).events[0].archived, true, '非空值视为归档');

console.log(fail === 0 ? '\n✅ 全部通过' : `\n❌ 失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
