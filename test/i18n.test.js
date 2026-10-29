/**
 * 国际化一致性测试
 *   1. 语言包的键与基准语言（zh）对齐、占位符一致、没有空值
 *   2. 源码里引用的每个键都真实存在（防止改名后界面出现裸键名）
 *   3. 语言解析优先级：显式偏好 > 宿主应用语言 > 系统语言 > 兜底
 *   node test/i18n.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const I = require('../src/i18n.js');

let fail = 0;
function ok(c, label, detail) {
  if (!c) { fail++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
}
function eq(a, b, label) {
  ok(a === b, label, 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b));
}

// 这两种语言由项目自己维护，必须 100% 完整；其它语言允许缺键（运行时回落中文）
const REQUIRED = ['zh', 'en'];
const BASE = 'zh';

const codes = I.codes();
const base = I.dictOf(BASE);
const baseKeys = Object.keys(base).filter((k) => k !== '__name');

console.log('[1] 语言包');
ok(codes.length >= 2, '至少注册两种语言', codes.join(','));
ok(codes[0] === BASE, '基准语言排在最前', codes.join(','));
codes.forEach((code) => {
  const d = I.dictOf(code);
  ok(d && typeof d === 'object', '语言包 ' + code + ' 已注册');
  ok(typeof d.__name === 'string' && d.__name.trim(), '语言包 ' + code + ' 有 __name（语言自称）');
});

console.log('[2] 键对齐与占位符');
codes.forEach((code) => {
  const d = I.dictOf(code);
  const keys = Object.keys(d).filter((k) => k !== '__name');
  const missing = baseKeys.filter((k) => !(k in d));
  const extra = keys.filter((k) => !(k in base));

  if (REQUIRED.indexOf(code) !== -1) {
    ok(missing.length === 0, code + ' 缺少键', missing.slice(0, 8).join(', '));
  } else if (missing.length) {
    console.log('     提示：' + code + ' 缺 ' + missing.length + ' 个键，运行时会回落中文');
  }
  ok(extra.length === 0, code + ' 有基准语言里不存在的键（多半是拼错）', extra.slice(0, 8).join(', '));

  keys.forEach((k) => {
    if (!(k in base)) return;
    ok(typeof d[k] === 'string' && d[k].length > 0, code + '.' + k + ' 不能为空');
    const want = placeholders(base[k]);
    const got = placeholders(d[k]);
    const bad = want.filter((v) => got.indexOf(v) === -1);
    ok(bad.length === 0, code + '.' + k + ' 占位符与基准语言不一致',
      '缺 ' + bad.join(',') + ' / 基准：' + base[k]);
    ok(got.length === want.length, code + '.' + k + ' 占位符数量不一致',
      got.join(',') + ' vs ' + want.join(','));
  });
});

function placeholders(s) {
  const out = [];
  String(s).replace(/\{(\w+)\}/g, (m, k) => { out.push(k); return m; });
  return out;
}

console.log('[3] 源码引用的键都存在');
const sources = ['src/app.js', 'src/event-core.js', 'src/reminder-tasks.js', 'src/plugin-main.js', 'src/index.tpl.html'];
const used = new Set();
sources.forEach((f) => {
  let src = read(f);
  // t('key' / I.t('key' / data-i18n*="key"
  let m;
  const callRe = /\bt\(\s*'([^']+)'/g;
  while ((m = callRe.exec(src))) used.add(m[1]);
  const attrRe = /data-i18n(?:-html|-ph|-aria|-title)?="([^"]+)"/g;
  while ((m = attrRe.exec(src))) used.add(m[1]);
});
// 动态拼出来的键（'plural.' + kind）只留前缀，不做存在性检查
const unknown = [...used].filter((k) => !/[.@]$/.test(k) && !(k in base));
ok(unknown.length === 0, '源码用到的键都在基准语言里', unknown.join(', '));
console.log(`     引用 ${used.size} 个静态键，基准语言共 ${baseKeys.length} 个键`);

// 动态拼出来的键族：offset.N / kind.X / kindl.X / plural.X / week.N
['0', '1', '3', '7', '30'].forEach((n) => ok('offset.' + n in base, '动态键 offset.' + n));
['birthday', 'anniversary', 'countdown', 'festival', 'generic'].forEach((k) => {
  ok('kind.' + k in base, '动态键 kind.' + k);
  ok('kindl.' + k in base, '动态键 kindl.' + k);
  ok('plural.' + k in base, '动态键 plural.' + k);
});
// 详情页第一个信息行的标签按类型拼（出生日期 / 那一天 / 目标日期 / 节日日期）
['birthday', 'anniversary', 'countdown', 'festival'].forEach((k) => {
  ok('detail.dateOf.' + k in base, '动态键 detail.dateOf.' + k);
});
for (let w = 0; w < 7; w++) ok('week.' + w in base, '动态键 week.' + w);
// 预设节日：FESTIVALS 里的 key 必须有对应文案
const Core = require('../src/event-core.js');
Core.FESTIVALS.forEach((f) => ok('fest.' + f.key in base, '预设节日文案 fest.' + f.key));

console.log('[4] 语言解析优先级');
eq(I.resolve('zh', 'en-US'), 'zh', '显式选中文优先于宿主语言');
eq(I.resolve('en', 'zh-CN'), 'en', '显式选英文优先于宿主语言');
eq(I.resolve('auto', 'zh-CN'), 'zh', '自动 + 宿主中文 -> 中文');
eq(I.resolve('auto', 'zh'), 'zh', '自动 + 宿主 zh -> 中文');
eq(I.resolve('auto', 'en-GB'), 'en', '自动 + 宿主英文 -> 英文');
eq(I.resolve('auto', 'de'), 'en', '自动 + 未支持的语言 -> 英文兜底');
eq(I.resolve(null, 'zh-TW'), 'zh', '没有偏好时按宿主语言（地区码归一）');
eq(I.resolve('fr', 'zh'), 'zh', '偏好的语言没装 -> 回落到宿主语言');
eq(I.resolve('auto', ''), 'en', '什么都拿不到 -> 英文兜底');
// 语言码形态：带地区码、大小写混写都要认（宿主 getCurrentLanguage() 返回字符串）
eq(I.resolve('zh-CN', 'en'), 'zh', '偏好带地区码也能命中');
eq(I.resolve('auto', 'zh-TW'), 'zh', '宿主语言带地区码也能归一');
eq(I.resolve('auto', 'EN-us'), 'en', '大小写不敏感');
eq(I.resolve(null, 'en-US'), 'en', '没有偏好时按宿主语言解析');

console.log('[4.1] 宿主语言判定（pickHostLang）');
// 核心场景：软件语言设成「跟随系统」时，宿主配置里 lng 为空，getCurrentLanguage() 只会
// 回报默认值 en —— 中文系统 + 中文界面却拿到 en。设定值（空）必须让位给系统语言。
eq(I.pickHostLang({ setting: '', cur: 'en', nav: 'zh-CN' }), 'zh', '跟随系统时按系统语言（中文）');
eq(I.pickHostLang({ setting: '', cur: 'en', nav: 'en-US' }), 'en', '跟随系统 + 英文系统 -> 英文');
eq(I.pickHostLang({ setting: 'zh', cur: 'en', nav: 'en-US' }), 'zh', '设定值优先于系统的错误回报');
eq(I.pickHostLang({ setting: 'en', cur: 'zh', nav: 'zh-CN' }), 'en', '软件显式设成英文就信英文（不猜系统）');
eq(I.pickHostLang({ setting: 'zh-tw', cur: '', nav: '' }), 'zh', '设定值带地区码也能归一');
eq(I.pickHostLang({ setting: '', cur: 'zh', nav: 'en-US' }), 'zh', '没有设定值时 getCurrentLanguage 的非默认值可信');
eq(I.pickHostLang({ setting: '', cur: 'en', switched: 'zh', nav: 'en-US' }), 'zh', 'languageChange 载荷兜底');
eq(I.pickHostLang({ setting: '', cur: '', nav: '' }), 'en', '全都拿不到 -> 英文');
eq(I.pickHostLang(), 'en', '空参数不崩');

console.log('[5] 取词与回落');
I.setLang('en');
eq(I.t('appName'), 'Milestone', '英文取词（品牌名单数）');
eq(I.t('offset.3'), '3 days before', '英文档位文案');
eq(I.t('years.n', { n: 7 }), '7 years', '占位符替换');
eq(I.t('不存在的键'), '不存在的键', '未知键原样返回（便于发现漏配）');

console.log('[6] 语言包不当可信 HTML');
eq(I.safeHtml('开<b>关</b>'), '开<b>关</b>', '保留 <b>');
eq(I.safeHtml('x<img src=x onerror=alert(1)>y'), 'xy', '剔除 img 与事件属性');
eq(I.safeHtml('<script>alert(1)</script>'), 'alert(1)', '剔除 script 标签');
eq(I.safeHtml('<b onclick="x()">t</b>'), '<b>t</b>', 'b 上的属性也被剔除');
eq(I.html('set.heroHint').indexOf('<img') , -1, '内置富文本键不含危险标签');
ok(I.html('set.heroHint').indexOf('<b>') !== -1, '内置富文本键保留加粗');
I.setLang('zh');
eq(I.t('appName'), '里程碑', '中文取词');
eq(I.t('years.n', { n: 7 }), '7 周年', '中文占位符替换');
eq(Core.KINDS.festival, '节日', '核心常量随语言切换（中文）');
Core.setLang('en');
eq(Core.KINDS.festival, 'Festival', '核心常量随语言切换（英文）');
eq(Core.FESTIVALS.filter((f) => f.key === 'zhongqiu')[0].name, 'Mid-Autumn Festival', '节日名随语言切换');
eq(Core.WEEK[1], 'Mon', '星期名随语言切换');
// 农历文案只在「显示农历」时出现，这里先打开再验英文包
Core.setLunar(true);
ok(Core.dateLabel({ calendar: 'lunar', lunar: { month: 8, day: 15 }, date: '2026-09-25' }).indexOf('Lunar') !== -1,
  '农历文案切换成英文');
eq(Core.dateText(new Date(2026, 8, 25), 'lunar', {}), 'Lunar month 8, day 15 (2026-09-25)', '英文的「农历（公历）」用半角括号');
Core.setLunar(false);
eq(Core.dateLabel({ calendar: 'lunar', lunar: { month: 8, day: 15 }, date: '2026-09-25' }), '2026-09-25',
  '关掉农历后英文界面同样只剩公历');
Core.setLunar(true);
eq(Core.titleOf({ title: 'Mom', kind: 'birthday' }, 55), "Mom's birthday (turning 55)", '年龄后缀切换成英文');
// 标签名是宿主机里的实体标识，必须与语言无关：否则切一次语言就多一个同名标签
eq(Core.emptySettings().taskTag, 'milestone', '标签名不随语言变（英文）');
Core.setLang('zh');
eq(Core.emptySettings().taskTag, 'milestone', '标签名不随语言变（中文）');
eq(Core.TAG_DEFAULT, 'milestone', '默认标签名常量');
I.setLang('zh');

console.log(fail === 0 ? '\n✅ 全部通过' : `\n❌ 失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
