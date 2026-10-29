const L = require('../src/lunar.js');
const Core = require('../src/event-core.js');

// 本文件默认按「显示农历」跑：农历相关的换算与文案是这里的主要考点。
// 「关掉农历」的行为集中在 [12] 单独验证。
Core.setLunar(true);

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
eq(Core.titleOf(mom, Core.ageOn(mom, TODAY)), '我妈生日（55岁）', '名称带年龄，年龄收尾');

const kid = mk({ title: '小米', date: '2019-11-08' });
eq(Core.ageOn(kid, TODAY), 6, '生日未到 -> 6 岁');
eq(Core.titleOf(kid, Core.ageOn(kid, TODAY)), '小米生日（6岁）', '名称带年龄（未到生日）');

const onDay = mk({ title: '当天', date: '2019-10-26' });
eq(Core.ageOn(onDay, TODAY), 7, '生日当天即为新年龄');

// 16.1 括号里的年龄 = 这次生日（下次发生那天）多少岁
console.log('[7.0] 这次生日多少岁');
const momOcc = Core.nextOccurrence(mom, TODAY);
eq(Core.ageAt(mom, momOcc, TODAY), 56, '生日已过：今天 55，这次过 56');
eq(Core.titleOf(mom, Core.ageAt(mom, momOcc, TODAY)), '我妈生日（56岁）', '名称用这次生日的年龄');

const kidOcc = Core.nextOccurrence(kid, TODAY);
eq(Core.ageAt(kid, kidOcc, TODAY), 7, '生日未到：今天 6，这次过 7');
eq(Core.titleOf(kid, Core.ageAt(kid, kidOcc, TODAY)), '小米生日（7岁）', '名称用这次生日的年龄（未到生日）');

eq(Core.ageAt(onDay, Core.nextOccurrence(onDay, TODAY), TODAY), 7, '生日当天：今天多大就过多少岁');
eq(Core.ageAt(mk({ date: '2000-02-29' }), Core.nextOccurrence(mk({ date: '2000-02-29' }), TODAY), TODAY), 27,
  '闰日生日在平年也长一岁');
const unborn = mk({ date: '2030-01-01' });
eq(Core.ageAt(unborn, Core.nextOccurrence(unborn, TODAY), TODAY), null, '还没出生不算年龄');
eq(Core.ageAt(lunarEv, Core.nextOccurrence(lunarEv, TODAY), TODAY), 37, '农历生日按农历年差算');
eq(Core.ageAt(mom, null, TODAY), null, '没有发生日就不给年龄');

// 16.2 生日标签显示「这次生日」的日期，而不是出生那天
console.log('[7.0] 生日标签用发生日');
ok(Core.dateLabel(mom, momOcc).indexOf('2027-05-14') === 0, '生日标签 = 下次生日日期（公历在前）');
ok(Core.dateLabel(kid, kidOcc).indexOf(Core.ymd(kidOcc.date)) === 0, '今年内的生日同样用发生日');
const lunarOcc = Core.nextOccurrence(lunarEv, TODAY);
ok(Core.dateLabel(lunarEv, lunarOcc).indexOf('农历四月十八') === 0, '农历生日以农历日期开头（农历在前）');
ok(Core.dateLabel(lunarEv, lunarOcc).includes(Core.ymd(lunarOcc.date)), '农历生日的括号里是这次生日的公历日期');
ok(Core.dateLabel(mom).indexOf('1971-05-14') === 0, '没给发生日时回落到原始日期');

const ann = mk({ title: '结婚纪念日', kind: 'anniversary', date: '2018-06-16' });
eq(Core.titleOf(ann, 8), '结婚纪念日', '纪念日名称不加年龄');
ok(Core.dateLabel(ann, Core.nextOccurrence(ann, TODAY)).indexOf('2018-06-16') === 0, '纪念日仍显示起始日');

// 农历生日年龄
eq(Core.ageOn(lunarEv, TODAY), 36, '农历生日年龄（1990 年生）');
eq(Core.titleOf(mk({ title: '妈妈生日', calendar: 'lunar', lunar: { year: 1968, month: 4, day: 18 } }), 58),
  '妈妈生日（58岁）', '农历名称带年龄');

// 尚未出生
eq(Core.ageOn(mk({ date: '2030-01-01' }), TODAY), null, '未来日期无年龄');
eq(Core.titleOf(mk({ title: '未来', date: '2030-01-01' }), null), '未来生日', '无年龄时不加括号');

// 17. 年龄与「生日」都不落库：名称里只留人，两者只在渲染时拼
console.log('[7.1] 名称只留人');
eq(Core.cleanTitle('birthday', '我妈生日（55岁）'), '我妈', '年龄与「生日」一起摘');
eq(Core.cleanTitle('birthday', '我妈生日(55岁)'), '我妈', '半角括号同样处理');
eq(Core.cleanTitle('birthday', '我妈生日'), '我妈', '只写生日也摘掉');
eq(Core.cleanTitle('birthday', '我妈的生日'), '我妈', '「的生日」一起摘');
eq(Core.cleanTitle('birthday', '我妈 生日'), '我妈', '带空格也摘');
eq(Core.cleanTitle('birthday', '生日'), '', '只剩「生日」时为空');
eq(Core.cleanTitle('birthday', "Mom's birthday"), 'Mom', '英文所有格');
eq(Core.cleanTitle('birthday', 'Mom birthday'), 'Mom', '英文裸 birthday');
eq(Core.cleanTitle('anniversary', '结婚纪念日（8岁）'), '结婚纪念日（8岁）', '非生日不剥离');
eq(Core.cleanTitle('birthday', '小（55岁）朋友'), '小（55岁）朋友', '只剥离结尾的年龄后缀');

console.log('[7.2] 拼接顺序：名字生日（几岁）');
eq(Core.titleOf(mk({ title: '妈妈', date: '1971-05-14' }), 55), '妈妈生日（55岁）', '「生日」在前、年龄收尾');
eq(Core.titleOf(mk({ title: '生日', date: '1971-05-14' }), 55), '生日（55岁）', '名字只剩生日时不重复拼接');
eq(Core.titleOf(mk({ title: '', kind: 'birthday', date: '1971-05-14' }), null), '生日', '没名字没年龄就只说生日');
eq(Core.titleOf(mk({ title: '妈妈生日', kind: 'countdown', date: '1971-05-14' }), 55), '妈妈生日', '非生日不补也不摘');
// 老数据（名称里带「生日」）在入库时就被洗干净，渲染层不再做兼容
eq(Core.titleOf(Core.normalize({ events: [{ id: 'o', title: '妈妈生日', kind: 'birthday', date: '1971-05-14' }] }).events[0], 55),
  '妈妈生日（55岁）', '带「生日」的旧数据入库即洗成纯名称');

// 17.0.1 生日进度条要用「还剩多少」，所以周期信息要给 left
console.log('[7.3] 周期进度含剩余量');
const bOcc = Core.nextOccurrence(mk({ date: '1971-05-14' }), TODAY);
const info = Core.cycleInfo(mk({ date: '1971-05-14' }), bOcc, TODAY);
ok(!!info, '每年重复有周期信息');
eq(info.total, 365, '周期 365 天');
eq(info.left, bOcc.days, '剩余天数 = 离下次发生还有几天');
eq(info.total, info.done + info.left, '已过 + 剩余 = 周期长度');
ok(Math.abs(info.ratio - info.done / info.total) < 1e-9, 'ratio 是已过占比');
eq(Core.cycleInfo(mk({ date: '1971-05-14', repeat: false }), bOcc, TODAY), null, '不重复没有周期');

const dirty = Core.normalize({ events: [
  { id: 'd1', title: '我妈生日（55岁）', kind: 'birthday', date: '1971-05-14' },
  { id: 'd2', title: '我妈生日', kind: 'birthday', date: '1971-05-14' }
] });
eq(dirty.events[0].title, '我妈', '导入时清掉年龄与「生日」');
eq(Core.titleOf(dirty.events[0], 55), '我妈生日（55岁）', '渲染时重新拼接，不重复');
eq(dirty.events[1].title, '我妈', '数据里始终是纯名称');

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

// 18. 提醒配置的容错（不兼容 2.0 数据：未发布的软件，只保留当前格式）
console.log('[9] 提醒配置容错');
const nd = Core.normalize({ events: [{ title: 'x', date: '2026-01-01' }] }).events[0];
eq(nd.remind.task, true, '缺省加入任务列表');
eq(nd.remind.snack, false, '缺省不弹提示条');
eq(nd.remind.offsets.join(','), '0,1', '默认当天 + 提前 1 天');
eq(nd.archived, false, '默认不归档');

const nbad = Core.normalize({ events: [{ title: 'y', date: '2026-01-01', remind: { task: true, offsets: [2, 5, 99] } }] }).events[0];
eq(nbad.remind.offsets.join(','), '0', '非法档位回落当天');

const noff = Core.normalize({ events: [{ title: 'z', date: '2026-01-01', remind: { task: false, snack: false, offsets: [7] } }] }).events[0];
eq(noff.remind.task, false, '关闭任务列表被保留');
eq(noff.remind.offsets.join(','), '7', '关闭时保留档位');
eq('on' in noff.remind, false, '不再写兼容字段 on');

// 旧字段一律忽略：on / taskSync / snackOnOpen 不再被识别，也不会污染数据
const oldShape = Core.normalize({
  settings: { taskSync: true, snackOnOpen: true, leapPolicy: 'strict' },
  events: [{ title: 'a', date: '2026-01-01', remind: { on: true, offsets: [0, 3] } }]
});
eq(oldShape.events[0].remind.task, true, '旧 on 被忽略，按缺省加入任务列表');
eq(oldShape.events[0].remind.snack, false, '旧 on 不会打开提示条');
eq(oldShape.events[0].remind.offsets.join(','), '0,3', '合法档位仍被保留');
eq(Object.keys(oldShape.settings).sort().join(','), 'hero,lang,lunar,taskTag', 'settings 只有语言、标签名、置顶与农历开关');
eq('taskProject' in oldShape.settings, false, '旧的项目名已迁出：任务改落收件箱 + 标签');
eq(oldShape.settings.taskTag, 'milestone', '标签名默认 milestone');
eq(Core.normalize({ settings: { taskTag: '  ' } }).settings.taskTag, 'milestone', '空白标签名回落到默认值');
eq(Core.normalize({ settings: { taskTag: '生日提醒' } }).settings.taskTag, '生日提醒', '自定义标签名保留');
eq(oldShape.settings.hero, true, '缺省开启置顶卡片');
eq('strikeExpired' in Core.normalize({ settings: { strikeExpired: false } }).settings, false, '删除线开关已移除，旧字段不落库');
eq(Core.normalize({ settings: { hero: false } }).settings.hero, false, '关闭置顶被保留');
eq(Core.normalize({}).settings.hero, true, '没有 settings 时默认开启');
eq(Core.emptyData().version, 1, '数据版本 1');

// 旧字段不落库：pinned 已从数据模型移除
eq('pinned' in Core.normalize({ events: [{ title: 'p', date: '2026-01-01', pinned: true }] }).events[0], false, 'pinned 字段已移除');

// repeat 只认布尔：不再识别历史上的 'yearly'
eq(Core.normalize({ events: [{ title: 'r1', kind: 'countdown', date: '2026-01-01', repeat: 'yearly' }] }).events[0].repeat, false, 'countdown 的 yearly 不再当作 true');
eq(Core.normalize({ events: [{ title: 'r2', kind: 'countdown', date: '2026-01-01', repeat: true }] }).events[0].repeat, true, 'countdown 布尔 true 保留');
eq(Core.normalize({ events: [{ title: 'r3', kind: 'birthday', date: '2026-01-01', repeat: false }] }).events[0].repeat, true, '非倒数日强制每年重复');

// 归档字段
const arch = Core.normalize({ events: [{ title: 'd', date: '2026-01-01', archived: true }] }).events[0];
eq(arch.archived, true, '归档标记保留');
eq(Core.normalize({ events: [{ title: 'e', date: '2026-01-01', archived: 'yes' }] }).events[0].archived, true, '非空值视为归档');

// 19. 节日类型与预设
console.log('[10] 节日类型与预设');
eq(Core.KINDS.festival, '节日', '类型名');

const groups = {};
Core.FESTIVALS.forEach((f) => { groups[f.group] = (groups[f.group] || 0) + 1; });
ok(groups.solar >= 5, '公历预设至少 5 个');
ok(groups.lunar >= 8, '农历预设至少 8 个');
ok(groups.term >= 1, '节气预设至少 1 个');
eq(Core.festivalByKey('zhongqiu').name, '中秋节', '按 key 查预设');
eq(Core.festivalByKey('nope'), null, '未知 key 返回 null');
eq(Core.festivalFields('nope'), null, '未知 key 无字段');

// 公历节日
const gf = Core.festivalFields('guoqing', TODAY);
eq(gf.date, '2027-10-01', '国庆下一次公共日');
eq(gf.calendar, 'solar', '公历节日用公历');
const guoqingEv = Core.normalize({
  events: [{ title: gf.title, kind: 'festival', calendar: gf.calendar, date: gf.date, preset: 'guoqing' }]
}).events[0];
eq(guoqingEv.kind, 'festival', '节日类型保留');
eq(guoqingEv.repeat, true, '节日默认每年重复');
eq(guoqingEv.preset, 'guoqing', '预设标识保留');
let fo = Core.nextOccurrence(guoqingEv, TODAY);
eq(ymd(fo.date), '2027-10-01', '节日按年循环');
eq(Core.nextOccurrence(guoqingEv, new Date(2028, 0, 1)).date.getFullYear(), 2028, '过年后推下一年');

// 农历节日：必须落在正确的农历日
const cj = Core.festivalFields('chunjie', TODAY);
eq(cj.calendar, 'lunar', '春节是农历');
const cjEv = Core.normalize({
  events: [{ title: cj.title, kind: 'festival', calendar: 'lunar', date: cj.date, lunar: cj.lunar, preset: 'chunjie' }]
}).events[0];
fo = Core.nextOccurrence(cjEv, TODAY);
eq(ymd(fo.date), '2027-02-06', '2027 春节');
eq(L.solarToLunar(fo.date).month + '/' + L.solarToLunar(fo.date).day, '1/1', '落在正月初一');

let misLunar = 0;
Core.FESTIVALS.filter((f) => f.group === 'lunar').forEach((f) => {
  for (let yy = 2026; yy <= 2032; yy++) {
    const base = new Date(yy, 0, 1);
    const fd = Core.festivalFields(f.key, base);
    const ev = Core.normalize({
      events: [{ title: f.name, kind: 'festival', calendar: 'lunar', date: fd.date, lunar: fd.lunar }]
    }).events[0];
    const o = Core.nextOccurrence(ev, base);
    if (!o.date) { misLunar++; continue; }
    const l = L.solarToLunar(o.date);
    // 除夕（腊月三十）遇小月按廿九
    const wantDay = Math.min(f.day, L.monthDays(l.year, f.month));
    if (l.month !== f.month || l.day !== wantDay) misLunar++;
  }
});
eq(misLunar, 0, '农历节日 2026-2032 都落在正确农历日');

// 除夕：腊月只有廿九天时回落到廿九
const chuxi = Core.festivalFields('chuxi', TODAY);
eq(chuxi.lunar.day, 30, '除夕记录为腊月三十');
const chuxiEv = Core.normalize({
  events: [{ title: '除夕', kind: 'festival', calendar: 'lunar', date: chuxi.date, lunar: chuxi.lunar, preset: 'chuxi' }]
}).events[0];
const cxo = Core.nextOccurrence(chuxiEv, TODAY);
const cxl = L.solarToLunar(cxo.date);
const nextCny = Core.nextOccurrence(cjEv, TODAY).date;
eq(Core.diffDays(cxo.date, nextCny), 1, '除夕是春节前一天');

// 节气：清明按公式推算
eq(ymd(Core.termDate('qingming', 2026)), '2026-04-05', '2026 清明');
eq(ymd(Core.termDate('qingming', 2027)), '2027-04-05', '2027 清明');
eq(ymd(Core.termDate('qingming', 2028)), '2028-04-04', '2028 清明');
eq(Core.termDate('nope', 2026), null, '未知节气返回 null');

const qm = Core.festivalFields('qingming', TODAY);
eq(qm.term, 'qingming', '清明带节气标识');
const qmEv = Core.normalize({
  events: [{ title: '清明', kind: 'festival', calendar: 'solar', date: qm.date, term: 'qingming', preset: 'qingming' }]
}).events[0];
eq(qmEv.term, 'qingming', '节气标识保留');
eq(qmEv.calendar, 'solar', '节气算公历');
eq(qmEv.lunar, null, '节气不保留农历');
eq(ymd(Core.nextOccurrence(qmEv, TODAY).date), '2027-04-05', '清明下一次');
eq(ymd(Core.nextOccurrence(qmEv, new Date(2028, 5, 1)).date), '2029-04-04', '清明按年推且年度日期会变');
eq(Core.dateLabel(qmEv), '2026-04-05 · 清明', '清明日期文案');

// 自定义节日：只有名称和日期
const custom = Core.normalize({
  events: [{ title: '公司年会', kind: 'festival', calendar: 'solar', date: '2027-01-20' }]
}).events[0];
eq(custom.kind, 'festival', '自定义节日类型');
eq(custom.preset, null, '自定义节日没有预设标识');
eq(custom.term, null, '自定义节日没有节气');
eq(ymd(Core.nextOccurrence(custom, TODAY).date), '2027-01-20', '自定义节日按年重复');

// 节日提醒：与倒数日一致
const festToday = {
  id: 'f1', title: '国庆节', kind: 'festival', calendar: 'solar', date: Core.ymd(TODAY),
  lunar: null, term: null, repeat: true, remind: { task: true, snack: true, offsets: [0, 1] }
};
eq(Core.dueReminders([festToday], TODAY).length, 1, '节日当天提醒');
eq(Core.hasReminder(festToday), true, '节日显示铃铛');

// 19. 农历往返一致性 + 输入边界
console.log('[11] 农历往返与边界');
let rtBad = 0;
let rtN = 0;
for (let t = Date.UTC(1900, 0, 30); t <= Date.UTC(2100, 11, 31); t += 37 * 86400000) {
  const u = new Date(t);
  const solar = new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  const lu = L.solarToLunar(solar);
  if (lu.outOfRange) continue;   // 支持范围之前的那几天
  const back = L.lunarToSolar(lu.year, lu.month, lu.day, lu.isLeap);
  if (!back || Core.ymd(back) !== Core.ymd(solar)) rtBad++;
  rtN++;
}
console.log(`     抽样 ${rtN} 天`);
eq(rtBad, 0, '公历 → 农历 → 公历 往返一致');

let lmBad = 0;
for (let y = 1900; y <= 2100; y += 7) {
  for (let m = 1; m <= 12; m++) {
    const dim = L.monthDays(y, m);
    for (const dd of [1, 15, 29, 30]) {
      const d = Core.resolveLunar(y, m, dd, false, 'regular');
      if (!d) { lmBad++; continue; }
      const back = L.solarToLunar(d);
      // 小月没有三十时回落到廿九，其余情况必须原样落回当月同日
      if (back.year !== y || back.month !== m || back.day !== Math.min(dd, dim)) lmBad++;
    }
  }
}
eq(lmBad, 0, '农历每月 1 / 15 / 29 / 30 都落在当月（小月回落到廿九）');

eq(Core.parseYMD('2026-04-31'), null, '4 月 31 日不存在');
eq(Core.parseYMD('2026-13-01'), null, '13 月不存在');
eq(Core.parseYMD('abc'), null, '非日期字符串返回 null');
eq(Core.parseYMD(''), null, '空字符串返回 null');
eq(Core.ymd(Core.parseYMD('2028-02-29')), '2028-02-29', '闰年 2 月 29 日有效');
eq(Core.ymd(Core.parseYMD(' 2026-12-01 ')), '2026-12-01', '首尾空格被容忍');
eq(Core.ymd(Core.parseYMD('2026-1-1')), '2026-01-01', '单位数月日被规范化');

// 纪念日周年：按「今天已满几个整年」，不满一年不显示
console.log('[N] 纪念日周年数');
const annEv = (o) => mk(Object.assign({ kind: 'anniversary' }, o));
eq(Core.anniversaryYears(annEv({ date: '2025-09-22' }), TODAY), 1, '1 年 34 天 → 1 周年（不是 2）');
eq(Core.anniversaryYears(annEv({ date: '2018-06-16' }), TODAY), 8, '2018-06-16 → 8 周年');
eq(Core.anniversaryYears(annEv({ date: '2026-09-22' }), TODAY), null, '差 34 天不满一年 → 不显示');
eq(Core.anniversaryYears(annEv({ date: '2026-10-26' }), TODAY), null, '当天 → 0 周年不显示');
eq(Core.anniversaryYears(annEv({ date: '2025-10-27' }), TODAY), null, '差一天满一年 → 不显示');
eq(Core.anniversaryYears(annEv({ date: '2024-10-26' }), TODAY), 2, '整两年的当天 → 2 周年');
eq(JSON.stringify(Core.anniversarySpan(annEv({ date: '2025-09-22' }), TODAY)), '{"years":1,"days":34}', '1 周年 34 天');
eq(JSON.stringify(Core.anniversarySpan(annEv({ date: '2024-10-26' }), TODAY)), '{"years":2,"days":0}', '整周年当天零头为 0');
eq(JSON.stringify(Core.anniversarySpan(annEv({ date: '2024-02-29' }), TODAY)), '{"years":2,"days":240}', '2 月 29 日按 2 月 28 日过，零头照算');
eq(Core.anniversarySpan(annEv({ date: '2026-09-22' }), TODAY), null, '不满一年没有整年与零头');
const annLunar = annEv({
  calendar: 'lunar', date: '2025-09-22',
  lunar: { year: 2025, month: 9, day: 1, isLeap: false }
});
eq(Core.anniversaryYears(annLunar, TODAY), 1, '农历纪念日：农历年差满一年');
eq(JSON.stringify(Core.anniversarySpan(annLunar, TODAY)), '{"years":1,"days":16}', '农历纪念日：零头按农历周年那天算');
eq(Core.anniversaryYears(Object.assign({}, annLunar, {
  lunar: { year: 2025, month: 9, day: 20, isLeap: false }
}), TODAY), null, '农历纪念日：还没到农历同一天');

// 18. 农历显示开关（默认关；关掉后任何地方都不出现农历）
console.log('[12] 农历显示开关');
eq(Core.emptySettings().lunar, false, '农历默认关闭');
eq(Core.normalize({}).settings.lunar, false, '没有这项设置时按下关闭');
eq(Core.normalize({ settings: { lunar: true } }).settings.lunar, true, '打开状态保留');
eq(Core.normalize({ settings: { lunar: 'yes' } }).settings.lunar, false, '非布尔真值不算打开');

const solarEv = mk({ title: '项目上线', kind: 'countdown', date: '2026-11-02', repeat: false });
const lunarData = Core.normalize({
  settings: { lunar: false },
  events: [{ title: '妈妈', kind: 'birthday', calendar: 'lunar', lunar: { year: 1968, month: 4, day: 18 }, date: '1968-05-14' }]
});
eq(lunarData.settings.lunar, true, '有农历事项时数据层自愈为「显示农历」（不允许关成空壳）');
eq(Core.countLunarEvents(lunarData.events), 1, '数出 1 个农历事项');
eq(Core.hasLunarEvents(lunarData.events), true, '判定有农历数据');
eq(Core.countLunarEvents([solarEv]), 0, '公历事项不算农历数据');
eq(Core.countLunarEvents(null), 0, '空数据不崩');

// 打开：按录入历法决定谁在前
const d0 = new Date(2026, 4, 12);
const lun0 = L.lunarText(L.solarToLunar(d0).month, L.solarToLunar(d0).day, L.solarToLunar(d0).isLeap);
eq(Core.dateText(d0, 'solar', {}), '2026-05-12（' + lun0 + '）', '公历来源：公历（农历）');
eq(Core.dateText(d0, 'lunar', {}), lun0 + '（2026-05-12）', '农历来源：农历（公历）');
ok(Core.dateText(d0, 'solar', { week: true }).indexOf('2026-05-12 · 周') === 0, '详情格式带星期');
ok(Core.dateText(d0, 'solar', { cn: true }).indexOf('5月12日 周') === 0, '置顶卡用「5月12日 周X」短格式');
eq(Core.dateText(null, 'solar', {}), '', '空日期返回空串');
ok(Core.dateLabel(lunarEv, Core.nextOccurrence(lunarEv, TODAY)).indexOf('农历四月十八') === 0, '农历来源的列表文案以农历开头');

// 关掉：只剩公历，干支生肖一并收起
Core.setLunar(false);
eq(Core.dateText(d0, 'solar', {}), '2026-05-12', '关掉后公历来源只剩公历');
eq(Core.dateText(d0, 'lunar', {}), '2026-05-12', '关掉后农历来源也只剩公历');
eq(Core.dateLabel(lunarEv), '1990-05-12', '关掉后农历记录的列表文案没有农历');
eq(Core.dateLabel(lunarEv, Core.nextOccurrence(lunarEv, TODAY)).indexOf('农历'), -1, '关掉后生日标签也不带农历');
ok(Core.dateLabel(mk({ date: '1990-05-12' })).indexOf('（') === -1, '关掉后公历记录没有括号对照');
eq(Core.zodiacLabel(lunarEv), '', '关掉后不显示干支生肖');
eq(Core.dateLabel(qmEv), '2026-04-05 · 清明', '节气记录与开关无关（它本来就走公历）');
Core.setLunar(true);

console.log(fail === 0 ? '\n✅ 全部通过' : `\n❌ 失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
