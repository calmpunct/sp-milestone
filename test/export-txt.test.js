/**
 * 导出文本测试
 *   node test/export-txt.test.js
 */
'use strict';
const Core = require('../src/event-core.js');
const I = require('../src/i18n.js');
const Ex = require('../src/export-txt.js');

let fail = 0;
function eq(a, b, label) {
  if (a !== b) { fail++; console.log(`  ✗ ${label}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
}
function ok(c, label) { if (!c) { fail++; console.log('  ✗ ' + label); } }

const NOW = new Date(2026, 9, 30, 18, 5);

function ev(o) {
  return Object.assign({
    id: 'x', title: 't', kind: 'countdown', calendar: 'solar',
    date: '2026-12-01', lunar: null, repeat: false, color: '#e8590c', note: '',
    pinned: false, remind: { task: true, offsets: [0] }
  }, o);
}

function build(list, settings) {
  return Ex.build(Core.normalize({ settings: settings || { lang: 'zh' }, events: list }), { now: NOW });
}

console.log('[1] 结构：表头 + 分类 + 条目');
{
  const txt = build([
    ev({ id: 'a', title: '妈妈', kind: 'birthday', date: '1971-05-14', repeat: true,
      remind: { task: true, offsets: [0, 1, 3] }, note: '喜欢百合' }),
    ev({ id: 'b', title: '结婚纪念日', kind: 'anniversary', date: '2018-06-16', repeat: true,
      remind: { task: false, offsets: [] }, archived: true }),
    ev({ id: 'c', title: '项目上线', date: '2026-12-01', remind: { task: true, offsets: [7] } })
  ]);
  const lines = txt.split('\n');
  eq(lines[0], '里程碑 · 事项备份', '第一行是标题');
  eq(lines[1], '导出时间：2026-10-30 18:05', '导出时间按传入的 now');
  eq(lines[2], '共 3 个事项', '总数');
  ok(txt.includes('【生日（1）】'), '生日分组带数量');
  ok(txt.includes('【纪念日（1）】'), '纪念日分组');
  ok(txt.includes('【倒数日（1）】'), '倒数日分组');
  ok(!txt.includes('【节日'), '没有节日时不输出空分组');
  ok(txt.includes('1. 妈妈生日（56岁）'), '条目标题与列表一致（生日带年龄）');
  ok(txt.includes('日期：1971-05-14'), '日期');
  ok(txt.includes('重复：每年'), '重复');
  ok(txt.includes('提醒：当天 / 提前 1 天 / 提前 3 天'), '提醒档位按天数升序');
  ok(txt.includes('状态：提醒中'), '状态');
  ok(txt.includes('备注：喜欢百合'), '备注');
  ok(txt.includes('提醒：不提醒'), '关掉提醒写「不提醒」');
  ok(txt.includes('状态：已归档 · 不提醒'), '归档单独标注');
}

console.log('[2] 农历信息不因显示开关而丢');
{
  Core.setLunar(false);
  const txt = build([ev({
    id: 'l', title: '奶奶', kind: 'birthday', calendar: 'lunar', date: '1940-02-08',
    lunar: { year: 1940, month: 1, day: 1, isLeap: false }, repeat: true
  })]);
  ok(txt.includes('农历正月初一'), '界面上关着农历，导出仍然保留：' + txt.split('\n').filter((l) => l.includes('日期'))[0]);
  Core.setLunar(true);
}

console.log('[3] 归档沉底，其余按下次发生时间排');
{
  const txt = build([
    ev({ id: 'z1', title: '很久以后', date: '2027-06-01', archived: true }),
    ev({ id: 'z2', title: '最近的', date: '2026-11-05' }),
    ev({ id: 'z3', title: '稍远', date: '2027-01-05' })
  ]);
  const i1 = txt.indexOf('1. 最近的');
  const i2 = txt.indexOf('2. 稍远');
  const i3 = txt.indexOf('3. 很久以后');
  ok(i1 !== -1 && i2 !== -1 && i3 !== -1 && i1 < i2 && i2 < i3, '顺序：近 → 远 → 归档');
}

console.log('[4] 多行备注保持缩进');
{
  const txt = build([ev({ id: 'n', title: '多行', note: '第一行\n第二行', date: '2026-12-01' })]);
  ok(txt.includes('备注：第一行\n    第二行'), '第二行缩进对齐：' + JSON.stringify(txt.slice(txt.indexOf('备注'))));
}

console.log('[5] 空数据与边界');
{
  const txt = build([]);
  ok(txt.startsWith('里程碑 · 事项备份'), '空库也有表头');
  ok(txt.includes('共 0 个事项'), '总数 0');
  eq(txt.trim().split('\n').length, 3, '空库只有三行');
  ok(Build_NoThrow(), '坏数据不抛异常');
}

function Build_NoThrow() {
  try {
    Ex.build({ events: [null, 'x', { id: 'y' }] }, { now: NOW });
    Ex.build(null, { now: NOW });
    return true;
  } catch (e) {
    return false;
  }
}

console.log('[6] 英文');
{
  I.setLang('en');
  Core.setLang('en');
  const txt = Ex.build(Core.normalize({
    settings: { lang: 'en' },
    events: [ev({ id: 'e', title: 'Mom', kind: 'birthday', date: '1971-05-14', repeat: true,
      remind: { task: true, offsets: [3] } })]
  }), { now: NOW });
  ok(txt.includes('Milestone · entry backup'), '英文表头');
  ok(txt.includes('Birthday (1)'), '英文分类名（半角括号）');
  ok(txt.includes('Repeat：yearly'), '英文重复');
  ok(txt.includes('3 days before'), '英文档位');
  Core.setLang('zh');
  I.setLang('zh');
}

console.log(fail === 0 ? '\n✅ 全部通过' : `\n❌ 失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
