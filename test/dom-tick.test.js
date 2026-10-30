/**
 * 大卡片的秒级计时（设置项 tick，默认关）。
 *   node test/dom-tick.test.js
 *
 * 这里要钉住的不只是「能显示」，还有「不该算的时候一律不算」——
 * 关着不建表、页面不可见停表、卡片被详情盖住时不刷看不见的那张。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const Core = require('../src/event-core.js');

let fail = 0;
function eq(a, b, label) {
  if (a !== b) { fail++; console.log(`  ✗ ${label}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
}
function ok(c, label) { if (!c) { fail++; console.log(`  ✗ ${label}`); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms || 60));

const html = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8');

const SEED = {
  version: 1,
  settings: { lang: 'zh' },
  events: [
    // 未来的倒数日 → 倒计时（mode=remaining）
    { id: 'c1', title: '项目上线', kind: 'countdown', calendar: 'solar', date: '2099-12-01',
      repeat: false, color: '#1c7ed6', note: '' },
    // 过去的纪念日 → 正计时（mode=elapsed）
    { id: 'a1', title: '结婚纪念日', kind: 'anniversary', calendar: 'solar', date: '2018-06-16',
      repeat: true, color: '#c92a2a', note: '' }
  ]
};

const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (m) => errors.push('console.error: ' + m));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://localhost/',
  virtualConsole: vc,
  beforeParse(window) {
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    window.__STORE__ = JSON.stringify(SEED);
    window.PluginAPI = {
      Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged' },
      onReady(fn) { setTimeout(fn, 0); },
      registerHook() {},
      showIndexHtmlAsView() {},
      loadSyncedData() { return Promise.resolve(window.__STORE__); },
      persistDataSynced(s) { window.__STORE__ = s; return Promise.resolve(); },
      openDialog() { return Promise.resolve('取消'); }
    };
  }
});

const { window } = dom;
const document = window.document;
const $ = (s) => document.querySelector(s);
const heroTick = () => $('#mlHero .ml-hero-tick');

/** 「01时50分32秒」/「01h50m32s」→ 秒数；不是这个格式就返回 -1 */
function tickSecs(txt) {
  const m = /^(\d{2})\D+(\d{2})\D+(\d{2})\D+$/.exec((txt || '').trim());
  if (!m) return -1;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}

/** 此刻「到今天零点 / 到明天零点」的秒数，用来核对卡片上的读数 */
function expectedSecs(up) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return up ? Math.floor((now.getTime() - from) / 1000) : Math.ceil((to - now.getTime()) / 1000);
}

/** 让页面在 jsdom 眼里变成「后台」/「前台」 */
function setHidden(hidden) {
  if (hidden) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  } else {
    delete document.visibilityState;
    delete document.hidden;
  }
  document.dispatchEvent(new window.Event('visibilitychange'));
}

async function run() {  await new Promise((r) => {
    if (document.readyState === 'complete') r();
    else window.addEventListener('load', r);
  });
  await wait(220);

  console.log('[1] 默认关：一个计时节点都没有');
  ok(!!$('#mlHero .ml-hero'), '置顶卡正常渲染');
  eq(heroTick(), null, '设置关着时卡片上没有秒级计时');

  console.log('[2] 打开开关后出现，读数与当前时刻对得上');
  $('#mlSettings').click();
  await wait(120);
  eq($('#sTick').checked, false, '设置里的开关默认是关的');
  $('#sTick').click();
  await wait(160);
  ok(!!heroTick(), '打开后卡片出现计时行');
  const first = heroTick().textContent;
  ok(tickSecs(first) >= 0, '读数是「时 分 秒」格式：' + first);
  ok(Math.abs(tickSecs(first) - expectedSecs(false)) <= 2, '倒计时读数是「今天还剩多少」：' + first);
  eq(heroTick().getAttribute('data-up'), '0', '倒计时标 data-up=0');

  console.log('[3] 每秒走一格');
  await wait(1150);
  const second = heroTick().textContent;
  ok(second !== first, '一秒后读数变了：' + first + ' → ' + second);
  ok(Math.abs(tickSecs(second) - expectedSecs(false)) <= 2, '走动后仍与真实时间一致：' + second);

  console.log('[4] 页面切到后台：停表');
  setHidden(true);
  await wait(120);
  const hiddenAt = heroTick().textContent;
  await wait(1300);
  eq(heroTick().textContent, hiddenAt, '后台期间读数冻结（不产生任何计算）');
  setHidden(false);
  await wait(80);
  ok(heroTick().textContent !== hiddenAt, '回到前台立刻补到当前时间');
  ok(Math.abs(tickSecs(heroTick().textContent) - expectedSecs(false)) <= 2, '补上的读数是对的');

  console.log('[5] 纪念日：正计时');
  $('#mlChips [data-f="anniversary"]').click();
  await wait(140);
  ok(!!heroTick(), '纪念日写分区也有计时行');
  eq(heroTick().getAttribute('data-up'), '1', '已过语义标 data-up=1');
  const up1 = heroTick().textContent;
  ok(Math.abs(tickSecs(up1) - expectedSecs(true)) <= 2, '正计时是「今天已过多少」：' + up1);
  await wait(1150);
  ok(tickSecs(heroTick().textContent) > tickSecs(up1), '正计时在变大：' + up1 + ' → ' + heroTick().textContent);

  console.log('[6] 详情页：只给看得见的那张卡片计时');
  $('#mlHero .ml-hero').click();
  await wait(200);
  const detailTick = () => $('#mlDetailBody .ml-hero-tick');
  ok(!!detailTick(), '详情大卡片上也有计时行');
  const listAt = heroTick().textContent;
  const d1 = detailTick().textContent;
  await wait(1150);
  ok(detailTick().textContent !== d1, '详情那张在走：' + d1 + ' → ' + detailTick().textContent);
  eq(heroTick().textContent, listAt, '被详情盖住的置顶卡不再刷新（看不见就不算）');

  console.log('[7] 关掉开关：计时行消失');
  await wait(380);
  $('#mlDetailBack').click();
  await wait(400);
  $('#mlSettings').click();
  await wait(120);
  eq($('#sTick').checked, true, '设置里是打开的');
  $('#sTick').click();
  await wait(160);
  eq(heroTick(), null, '关掉后计时行从卡片上消失');
  $('#mlSetClose').click();
  await wait(360);

  console.log('[8] 语言锁定：设置里只剩只读展示');
  $('#mlSettings').click();
  await wait(140);
  eq($('#sLangNow').textContent, '简体中文', '只读展示当前语言');
  eq($('#sLang'), null, '没有可点的语言按钮（锁定后不再提供切换）');
  $('#mlSetClose').click();
  await wait(360);

  console.log('[9] 无运行时错误');
  eq(errors.length, 0, '控制台无报错' + (errors.length ? '：\n     ' + errors.join('\n     ') : ''));

  dom.window.close();
}

/* =====================================================================
 * 第二块：今天 / 后天 的计时口径，以及详情大卡片的「换档读数」
 * 用独立的一台 jsdom —— 这几条要的种子（今天、后天各一条）会改变
 * 「全部」视图里的置顶顺序，塞进上面那台会把前面的断言全带偏。
 * ===================================================================== */
async function runEdge() {
  const now = new Date();
  const ymd = (add) => Core.ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + add));
  const SEED2 = {
    version: 1,
    settings: { lang: 'zh', tick: true },
    events: [
      // 今天：大数字说「今天」，计时行必须整行消失
      { id: 'f0', title: '今天的事', kind: 'festival', calendar: 'solar', date: ymd(0),
        repeat: true, color: '#0ca678', note: '' },
      // 后天：计时行要再加一整天（今天剩余 + 24 小时）
      { id: 'c2', title: '后天的事', kind: 'countdown', calendar: 'solar', date: ymd(2),
        repeat: false, color: '#1c7ed6', note: '' },
      // 详情换档用：起算日固定在过去，年 / 周都有得算
      { id: 'a9', title: '结婚纪念日', kind: 'anniversary', calendar: 'solar', date: '2018-06-16',
        repeat: true, color: '#c92a2a', note: '' }
    ]
  };
  const vc2 = new VirtualConsole();
  const errors2 = [];
  vc2.on('jsdomError', (e) => errors2.push('jsdomError: ' + e.message));
  vc2.on('error', (m) => errors2.push('console.error: ' + m));
  const dom2 = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://localhost/',
    virtualConsole: vc2,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.PluginAPI = {
        Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged' },
        onReady(f) { setTimeout(f, 0); },
        registerHook() {},
        showIndexHtmlAsView() {},
        loadSyncedData() { return Promise.resolve(JSON.stringify(SEED2)); },
        persistDataSynced() { return Promise.resolve(); },
        openDialog() { return Promise.resolve('取消'); }
      };
    }
  });
  const w2 = dom2.window;
  const d2 = w2.document;
  const $2 = (s) => d2.querySelector(s);
  const tick2 = () => $2('#mlHero .ml-hero-tick');
  const num2 = () => $2('#mlDetailBody .ml-hero-num');
  // 「天」那一档是裸文本（没有 <b> 分段），当成一段看
  const partsOf = (el) => {
    const bs = Array.from(el.querySelectorAll('b')).map((b) => b.textContent);
    return bs.length ? bs : [el.textContent.replace(/\s+/g, '')];
  };

  await new Promise((r) => {
    if (d2.readyState === 'complete') r();
    else w2.addEventListener('load', r);
  });
  await new Promise((r) => setTimeout(r, 260));

  console.log('[10] 今天：不显示计时行');
  eq($2('.ml-hero-label').textContent.indexOf('就是') !== -1, true, '置顶是「今天」那条（节日）');
  eq(tick2(), null, '今天不显示计时（目标就是今天零点，没有可倒的余量）');

  console.log('[11] 后天：计时行再加一整天');
  $2('.ml-chip[data-f="countdown"]').click();
  await new Promise((r) => setTimeout(r, 160));
  eq($2('.ml-hero-label').textContent.indexOf('后天') !== -1, true, '倒数日分区置顶是「后天」那条');
  const secs2 = tickSecs(tick2() ? tick2().textContent : '');
  const want2 = expectedSecs(false) + 86400;
  ok(Math.abs(secs2 - want2) <= 2, '读数 = 今天剩余 + 24 小时：' + secs2 + ' vs ' + want2);

  console.log('[12] 详情大卡片：点一下换一档读数');
  $2('.ml-chip[data-f="anniversary"]').click();
  await new Promise((r) => setTimeout(r, 160));
  $2('#mlHero .ml-hero').click();
  await new Promise((r) => setTimeout(r, 220));
  ok(!!num2(), '详情大卡片渲染出来了');
  eq(partsOf(num2()).length, 1, '默认是「天」那一档：' + num2().textContent);
  ok(/天$/.test(num2().textContent), '默认读数是 N 天：' + num2().textContent);

  $2('#mlDetailBody .ml-hero--detail').click();
  await new Promise((r) => setTimeout(r, 120));
  eq(partsOf(num2()).length, 3, '第二档是「年 / 月 / 天」三段：' + num2().textContent);
  ok(/年/.test(num2().textContent) && /月/.test(num2().textContent), '带年月：' + num2().textContent);

  $2('#mlDetailBody .ml-hero--detail').click();
  await new Promise((r) => setTimeout(r, 120));
  eq(partsOf(num2()).length, 2, '第三档是「周 / 天」两段：' + num2().textContent);
  ok(/周/.test(num2().textContent), '带周：' + num2().textContent);

  $2('#mlDetailBody .ml-hero--detail').click();
  await new Promise((r) => setTimeout(r, 120));
  ok(/时/.test(num2().textContent) && /秒/.test(num2().textContent), '第四档是时分秒：' + num2().textContent);
  eq($2('#mlDetailBody .ml-hero-tick'), null, '这一档本身在走秒，不再另挂计时行');
  ok(!!num2().getAttribute('data-ts'), '大数字挂上了计时锚点（交给秒表刷新）');
  const live1 = partsOf(num2()).join('|');
  await new Promise((r) => setTimeout(r, 1150));
  ok(partsOf(num2()).join('|') !== live1, '这一档每秒在走：' + live1 + ' → ' + partsOf(num2()).join('|'));

  $2('#mlDetailBody .ml-hero--detail').click();
  await new Promise((r) => setTimeout(r, 120));
  eq(partsOf(num2()).length, 1, '转一圈回到「天」：' + num2().textContent);

  console.log('[13] 换档不记忆：关掉重开回到「天」');
  $2('#mlDetailBody .ml-hero--detail').click();
  await new Promise((r) => setTimeout(r, 120));
  eq(partsOf(num2()).length, 3, '先切到「年 / 月 / 天」');
  $2('#mlDetailBack').click();
  await new Promise((r) => setTimeout(r, 400));
  $2('#mlHero .ml-hero').click();
  await new Promise((r) => setTimeout(r, 220));
  eq(partsOf(num2()).length, 1, '重开又是「天」：' + num2().textContent);

  console.log('[14] 关掉秒级计时：不给「时/分/秒」那一档');
  $2('#mlDetailBack').click();
  await new Promise((r) => setTimeout(r, 400));
  $2('#mlSettings').click();
  await new Promise((r) => setTimeout(r, 120));
  $2('#sTick').click();
  await new Promise((r) => setTimeout(r, 160));
  $2('#mlSetClose').click();
  await new Promise((r) => setTimeout(r, 360));
  $2('#mlHero .ml-hero').click();
  await new Promise((r) => setTimeout(r, 220));
  const seen = [];
  for (let i = 0; i < 3; i++) {
    $2('#mlDetailBody .ml-hero--detail').click();
    await new Promise((r) => setTimeout(r, 100));
    seen.push(num2().textContent);
  }
  ok(seen.join('/').indexOf('时') === -1, '三档里没有时分秒：' + seen.join(' / '));
  eq(partsOf(num2()).length, 1, '转三下回到「天」：' + num2().textContent);

  console.log('[15] 无运行时错误');
  eq(errors2.length, 0, '控制台无报错' + (errors2.length ? '：\n     ' + errors2.join('\n     ') : ''));
  dom2.window.close();
}

(async function () {
  await run();
  await runEdge();
  console.log(fail === 0 ? '\n✅ 全部通过' : `\n❌ 失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
