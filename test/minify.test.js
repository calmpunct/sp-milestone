/**
 * 压缩保真测试：把 src 里的模块压缩后放进独立 vm 环境跑一遍，
 * 与未压缩版本的输出逐项比对 —— 压缩只允许改变空白与注释，不允许改变行为。
 *   node test/minify.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const build = require('../build.js');

let fail = 0;
function same(a, b, label) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) {
    fail++;
    if (fail <= 8) {
      console.log('  ✗ ' + label +
        '\n     原文: ' + String(sa).slice(0, 160) +
        '\n     压缩: ' + String(sb).slice(0, 160));
    }
  }
}
function eq(a, b, label) {
  if (a !== b) {
    fail++;
    console.log('  ✗ ' + label + ': got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b));
  }
}
function ok(c, label) {
  if (!c) { fail++; console.log('  ✗ ' + label); }
}

/* ---------------- 工具 ---------------- */

/** 把一段 UMD 代码放进独立 vm 环境，返回挂上 Lunar / EventCore 的全局对象 */
function loadInSandbox(code) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  new vm.Script(code, { filename: 'bundle.js' }).runInContext(sandbox);
  return sandbox;
}

// 语言包必须在 i18n.js 之前：事件核心的文案常量取自注册表
const localeFiles = fs.readdirSync(path.join(__dirname, '..', 'src', 'locales'))
  .filter((f) => /\.js$/.test(f))
  .sort((a, b) => (a === 'zh.js' ? -1 : b === 'zh.js' ? 1 : a < b ? -1 : 1))
  .map((f) => 'locales/' + f);

const rawCore = localeFiles.concat(['i18n.js', 'lunar.js', 'event-core.js', 'reminder-tasks.js'])
  .map((f) => build.read(f)).join('\n\n');
const minCore = build.minifyJs(rawCore);

const RAW = loadInSandbox(rawCore);
const MIN = loadInSandbox(minCore);

const L = RAW.Lunar;
const M = MIN.Lunar;
const C = RAW.EventCore;
const D = MIN.EventCore;
const R = RAW.ReminderTasks;
const T = MIN.ReminderTasks;

const EVENTS = [
  { id: 'a', title: '生日', kind: 'birthday', calendar: 'solar', date: '1971-05-14', lunar: null, repeat: true, color: '#d6336c', note: '', remind: { task: true, snack: false, offsets: [0, 1, 3] }, createdAt: 1 },
  { id: 'b', title: '农历生日', kind: 'birthday', calendar: 'lunar', date: '1968-05-14', lunar: { year: 1968, month: 4, day: 18, isLeap: false }, repeat: true, color: '#f59f00', note: '', remind: { task: true, snack: true, offsets: [0, 7] }, createdAt: 2 },
  { id: 'c', title: '倒数', kind: 'countdown', calendar: 'solar', date: '2026-12-01', lunar: null, repeat: false, color: '#1c7ed6', note: '', remind: { task: false, snack: false, offsets: [0] }, createdAt: 3 },
  { id: 'd', title: '纪念', kind: 'anniversary', calendar: 'solar', date: '2018-06-16', lunar: null, repeat: true, color: '#c92a2a', note: '', remind: { task: true, snack: true, offsets: [0, 1] }, createdAt: 4 },
  { id: 'e', title: '中秋', kind: 'festival', calendar: 'lunar', date: '2026-09-25', lunar: { year: 2026, month: 8, day: 15, isLeap: false }, term: null, preset: 'zhongqiu', repeat: true, color: '#7048e8', note: '', remind: { task: true, snack: true, offsets: [0, 1, 7] }, createdAt: 5 },
  { id: 'f', title: '清明', kind: 'festival', calendar: 'solar', date: '2026-04-05', lunar: null, term: 'qingming', preset: 'qingming', repeat: true, color: '#0ca678', note: '', remind: { task: true, snack: false, offsets: [0] }, createdAt: 6 }
];

/* ---------------- 1. 压缩产物本身 ---------------- */

console.log('[1] 压缩产物基本形状');
ok(minCore.length < rawCore.length, '确实变小了（' + rawCore.length + ' → ' + minCore.length + '）');
ok(!/^\s*\/\//m.test(minCore), '没有残留行注释');
ok(!/^\s*\/\*/m.test(minCore), '没有残留块注释');
ok(!/[ \t]+\n/.test(minCore), '没有行尾空白');
ok(!/\n\s*\n/.test(minCore), '没有连续空行');
try {
  new vm.Script(minCore);
} catch (e) {
  fail++;
  console.log('  ✗ 压缩后语法错误：' + e.message);
}

console.log('[2] 字符串 / 模板串 / 正则未被误伤');
eq(build.minifyJs("var s = 'a // b /* c */ d';"), "var s = 'a // b /* c */ d';", '字符串里的注释符');
eq(build.minifyJs('var s = "http://x/*y*/";'), 'var s = "http://x/*y*/";', '字符串里的 URL');
eq(build.minifyJs('var t = `x ${a} // y`;'), 'var t = `x ${a} // y`;', '模板串内容');
eq(build.minifyJs('var r = /a\\/b[/]/g;'), 'var r = /a\\/b[/]/g;', '正则里的转义与字符类');
eq(build.minifyJs('var d = a / b / c;'), 'var d = a / b / c;', '除号不被当正则');
eq(build.minifyJs('var x = 1; /* c */ var y = 2;'), 'var x = 1; var y = 2;', '块注释删除（原位留一个空格）');
eq(build.minifyJs('var a = 1; // tail\nvar b = 2;'), 'var a = 1;var b = 2;', '行注释删除（分号后的换行也是多余的）');
eq(build.minifyJs('var a=1;\n\n\n   var b=2;'), 'var a=1;var b=2;', '空行与缩进');
eq(build.minifyJs('a /*c*/ b'), 'a b', '注释两侧留空格（不粘词）');
eq(build.minifyJs('function f() {\n  return\n  1\n}\nvar g = 2'), 'function f() {return\n1\n}\nvar g = 2', 'return / } 之后的换行必须保留（ASI）');
eq(build.minifyJs('x = {a: 1,\nb: 2}'), 'x = {a: 1,b: 2}', '逗号后的换行可丢');

console.log('[3] 公历 → 农历（1900-2100 抽样 1984 天）');
let n = 0;
for (let t = Date.UTC(1900, 0, 30); t <= Date.UTC(2100, 11, 31); t += 37 * 86400000) {
  const u = new Date(t);
  const d = new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  same(L.solarToLunar(d), M.solarToLunar(d), 'solarToLunar ' + d.toDateString());
  n++;
}
console.log('     比对 ' + n + ' 天');

console.log('[4] 农历 → 公历（含闰月）');
for (let y = 1900; y <= 2100; y += 7) {
  for (let m = 1; m <= 12; m++) {
    for (const dd of [1, 15, 29, 30]) {
      const a = C.resolveLunar(y, m, dd, false, 'regular');
      const b = D.resolveLunar(y, m, dd, false, 'regular');
      same(a ? C.ymd(a) : null, b ? D.ymd(b) : null, 'resolveLunar ' + y + '-' + m + '-' + dd);
      const la = L.lunarToSolar(y, m, dd, true);
      const lb = M.lunarToSolar(y, m, dd, true);
      same(la ? C.ymd(la) : null, lb ? D.ymd(lb) : null, 'lunarToSolar(闰) ' + y + '-' + m + '-' + dd);
    }
  }
}

console.log('[5] 事件推算与展示文案');
for (const base of ['2026-10-26', '2027-01-01', '1999-12-31', '2049-06-15', '2099-12-31']) {
  const [y, mo, da] = base.split('-').map(Number);
  const today = new Date(y, mo - 1, da);
  for (const ev of EVENTS) {
    const a = C.normalize({ events: [ev] }).events[0];
    const b = D.normalize({ events: [ev] }).events[0];
    same(a, b, 'normalize ' + ev.id);
    const oa = C.nextOccurrence(a, today);
    const ob = D.nextOccurrence(b, today);
    same(
      { d: oa.date && C.ymd(oa.date), n: oa.days, p: oa.isPast, ly: oa.lunarYear },
      { d: ob.date && D.ymd(ob.date), n: ob.days, p: ob.isPast, ly: ob.lunarYear },
      'nextOccurrence ' + ev.id + ' @' + base
    );
    same(C.dateLabel(a, oa), D.dateLabel(b, ob), 'dateLabel ' + ev.id);
    same(C.ageOn(a, today), D.ageOn(b, today), 'ageOn ' + ev.id);
    same(C.yearsSince(a, oa), D.yearsSince(b, ob), 'yearsSince ' + ev.id);
    same(C.cycleProgress(a, oa, today), D.cycleProgress(b, ob, today), 'cycleProgress ' + ev.id);
    same(C.titleOf(a, C.ageOn(a, today)), D.titleOf(b, D.ageOn(b, today)), 'titleOf ' + ev.id);
  }
  same(
    C.dueReminders(EVENTS, today).map((x) => x.offset + '|' + x.title),
    D.dueReminders(EVENTS, today).map((x) => x.offset + '|' + x.title),
    'dueReminders @' + base
  );
}

console.log('[6] 正则相关：日期 / 颜色 / 节气 / 预设');
for (const s of ['2026-04-31', '2028-02-29', '2026-1-1', '2026-13-01', 'abc', ' 2026-12-01 ']) {
  const a = C.parseYMD(s);
  const b = D.parseYMD(s);
  same(a ? C.ymd(a) : null, b ? D.ymd(b) : null, 'parseYMD ' + JSON.stringify(s));
}
for (const s of ['#d6336c', 'red', '#ABC', '#12345g']) {
  same(
    C.normalize({ events: [{ title: 't', date: '2026-01-01', color: s }] }).events[0].color,
    D.normalize({ events: [{ title: 't', date: '2026-01-01', color: s }] }).events[0].color,
    'color ' + s
  );
}
for (const y of [1900, 2000, 2026, 2027, 2028, 2100]) {
  const a = C.termDate('qingming', y);
  const b = D.termDate('qingming', y);
  same(a ? C.ymd(a) : null, b ? D.ymd(b) : null, 'termDate ' + y);
}
for (const k of ['zhongqiu', 'chunjie', 'chuxi', 'qingming', 'nope']) {
  same(C.festivalFields(k, new Date(2026, 9, 26)), D.festivalFields(k, new Date(2026, 9, 26)), 'festivalFields ' + k);
}
same(C.emptyData(), D.emptyData(), 'emptyData');

console.log('[7] 宿主侧对账 plan');
{
  const build2 = (Core, RT) => {
    const existing = [];
    EVENTS.forEach((ev, i) => {
      const norm = Core.normalize({ events: [ev] }).events[0];
      const d = RT.desiredTask(norm, new Date(2026, 9, 26));
      if (d) existing.push({ id: 't' + i, title: d.title, notes: d.notes, dueDay: d.dueDay, isDone: false, created: i });
    });
    existing.push({ id: 'done1', title: existing[0].title, notes: existing[0].notes, dueDay: existing[0].dueDay, isDone: true, created: 99 });
    existing.push({ id: 'other', title: '别人的任务', notes: '普通备注', dueDay: null, isDone: false, created: 1 });
    const p = RT.plan({ events: EVENTS, existing, today: new Date(2026, 9, 26) });
    return {
      add: p.add.map((x) => x.eventId + '|' + x.title + '|' + x.dueDay),
      update: p.update.map((x) => x.eventId + '|' + JSON.stringify(x.patch) + '|' + x.reason),
      remove: p.remove.map((x) => x.task.id + '|' + x.reason),
      wanted: p.wanted
    };
  };
  same(build2(C, R), build2(D, T), 'plan 结果');
  same(R.PROJECT_TITLE, T.PROJECT_TITLE, '项目名常量');
}

console.log('[8] CSS 压缩');
{
  const rawCss = build.read('styles.css');
  const minCss = build.minifyCss(rawCss);
  const count = (s, ch) => s.split(ch).length - 1;
  ok(minCss.length < rawCss.length, 'CSS 变小（' + rawCss.length + ' → ' + minCss.length + '）');
  ok(rawCss.includes('/*') && !minCss.includes('/*'), '注释已删');
  eq(count(minCss, '{'), count(rawCss.replace(/\/\*[\s\S]*?\*\//g, ''), '{'), '规则数量不变');
  eq(count(minCss, '}'), count(minCss, '{'), '花括号配平');
  ok(minCss.includes("content:''"), "content: '' 保留");
  ok(minCss.includes('.cd-item{'), '类选择器保留');
  ok(minCss.includes('@media (min-width:600px)'), '媒体查询保留');
  ok(minCss.includes('@keyframes cd-in{'), '关键帧保留');
  ok(minCss.includes('rgb(var(--cd-rc))'), 'CSS 变量函数保留');
  ok(/\.cd-item-title em\{/.test(minCss), '后代选择器的空格保留');
}

console.log(fail === 0 ? '\n✅ 全部通过' : '\n❌ 失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
