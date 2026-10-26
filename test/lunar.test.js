const L = require('../src/lunar.js');

let fail = 0;
function eq(actual, expected, label) {
  const ok = actual === expected;
  if (!ok) { fail++; console.log(`  ✗ ${label}: got ${actual}, want ${expected}`); }
  return ok;
}
function d(y, m, dd) { return new Date(y, m - 1, dd); }
function fmt(x) { return `${x.getFullYear()}-${L.pad2(x.getMonth() + 1)}-${L.pad2(x.getDate())}`; }

// ---- 1. 春节（农历正月初一）日期校验 ----
const CNY = {
  1900: '1900-01-31', 1950: '1950-02-17', 1960: '1960-01-28', 1970: '1970-02-06',
  1980: '1980-02-16', 1990: '1990-01-27',
  2000: '2000-02-05', 2001: '2001-01-24', 2002: '2002-02-12', 2003: '2003-02-01',
  2004: '2004-01-22', 2005: '2005-02-09', 2006: '2006-01-29', 2007: '2007-02-18',
  2008: '2008-02-07', 2009: '2009-01-26', 2010: '2010-02-14', 2011: '2011-02-03',
  2012: '2012-01-23', 2013: '2013-02-10', 2014: '2014-01-31', 2015: '2015-02-19',
  2016: '2016-02-08', 2017: '2017-01-28', 2018: '2018-02-16', 2019: '2019-02-05',
  2020: '2020-01-25', 2021: '2021-02-12', 2022: '2022-02-01', 2023: '2023-01-22',
  2024: '2024-02-10', 2025: '2025-01-29', 2026: '2026-02-17', 2027: '2027-02-06',
  2028: '2028-01-26', 2029: '2029-02-13', 2030: '2030-02-03',
};
console.log('[1] 春节日期');
for (const y of Object.keys(CNY)) {
  const s = L.lunarToSolar(+y, 1, 1, false);
  if (!s) { fail++; console.log(`  ✗ ${y}: 换算返回 null`); continue; }
  eq(fmt(s), CNY[y], `${y} 正月初一`);
}

// ---- 2. 中秋（八月十五） ----
console.log('[2] 中秋日期');
const MID = { 2024: '2024-09-17', 2025: '2025-10-06', 2026: '2026-09-25' };
for (const y of Object.keys(MID)) {
  const l = L.solarToLunar(d(+y, +MID[y].slice(5, 7), +MID[y].slice(8, 10)));
  eq(`${l.month}/${l.day}`, '8/15', `${y} 中秋`);
}

// ---- 3. 闰月 ----
console.log('[3] 闰月');
eq(L.leapMonth(2025), 6, '2025 应有闰六月');
eq(L.leapMonth(2023), 2, '2023 应有闰二月');
eq(L.leapMonth(2020), 4, '2020 应有闰四月');
eq(L.leapMonth(2026), 0, '2026 无闰月');
eq(L.leapMonth(2024), 0, '2024 无闰月');
// 2025 闰六月初一
const leapS = L.lunarToSolar(2025, 6, 1, true);
console.log(`     2025 闰六月初一 = ${leapS ? fmt(leapS) : 'null'}`);
if (leapS) {
  const back = L.solarToLunar(leapS);
  eq(`${back.month}/${back.day}/${back.isLeap}`, '6/1/true', '闰六月往返');
}
// 同年的六月与闰六月必须相差 30 天
if (leapS) {
  const normal = L.lunarToSolar(2025, 6, 1, false);
  eq(leapS - normal, L.monthDays(2025, 6) * 86400000, '闰六月紧随六月');
}

// ---- 4. 全域往返一致性（73k 天） ----
console.log('[4] 1900-2100 逐日往返一致性');
const start = Date.UTC(1900, 0, 31);
const end = Date.UTC(2100, 11, 31);
let bad = 0, days = 0, lastBad = '';
for (let t = start; t <= end; t += 86400000) {
  days++;
  const u = new Date(t);
  const local = new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  const l = L.solarToLunar(local);
  const s = L.lunarToSolar(l.year, l.month, l.day, l.isLeap);
  if (!s || fmt(s) !== fmt(local)) {
    bad++;
    if (bad <= 5) lastBad += `\n      ${fmt(local)} -> 农历${l.year}-${l.month}-${l.day}${l.isLeap ? '(闰)' : ''} -> ${s ? fmt(s) : 'null'}`;
  }
}
console.log(`     共 ${days} 天，失败 ${bad} 天${lastBad}`);
if (bad > 0) fail += bad;

// ---- 5. 每年天数合理性 ----
console.log('[5] 农历年天数范围');
let badLen = 0;
for (let y = 1900; y <= 2100; y++) {
  const n = L.yearDays(y);
  const valid = [353, 354, 355, 383, 384, 385];
  if (!valid.includes(n)) { badLen++; if (badLen <= 5) console.log(`  ✗ ${y}年 ${n}天`); }
}
console.log(`     异常年份 ${badLen} 个`);
fail += badLen;

// ---- 6. 天干地支 / 生肖 ----
console.log('[6] 干支生肖');
eq(L.zodiacOf(2026), '马', '2026 属马');
eq(L.ganzhiOf(2026), '丙午', '2026 丙午年');
eq(L.zodiacOf(2024), '龙', '2024 属龙');

// ---- 7. 中文名 ----
console.log('[7] 中文表示');
eq(L.lunarText(1, 1, false), '农历正月初一', '正月初一');
eq(L.lunarText(6, 10, true), '农历闰六月初十', '闰六月初十');
eq(L.lunarText(12, 30, false), '农历腊月三十', '腊月三十');
eq(L.lunarText(11, 23, false), '农历冬月廿三', '冬月廿三');

console.log(fail === 0 ? '\n✅ 全部通过' : `\n❌ 失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
