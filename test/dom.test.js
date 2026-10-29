/**
 * 在 jsdom 中跑构建产物，验证真实 DOM 交互与同步写入。
 *   node test/dom.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const Core = require('../src/event-core.js');

let fail = 0;
const errors = [];
function eq(a, b, label) {
  if (a !== b) { fail++; console.log(`  ✗ ${label}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
}
function ok(c, label) { if (!c) { fail++; console.log(`  ✗ ${label}`); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms || 60));

const TODAY = new Date();
// 种子里凡是「今天」「昨天」都按运行当天现算：写死日期的话，隔一天再跑就会红（历史问题）
const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
const TODAY_MD = pad2(TODAY.getMonth() + 1) + '-' + pad2(TODAY.getDate());   // MM-DD
const YESTERDAY = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - 1);

const SEED = {
  version: 1,
  // 固定中文：jsdom 的 navigator.language 是 en-US，不写这一项界面会是英文。
  // 农历显示打开：下面有农历生日，也是 [3.5] / [5] / [6] 的考点
  settings: { lang: 'zh', lunar: true },
  events: [
    { id: 'b1', title: '妈妈', kind: 'birthday', calendar: 'lunar', date: '1968-05-14',
      lunar: { year: 1968, month: 4, day: 18, isLeap: false }, repeat: true, color: '#d6336c', note: '' },
    // 出生年取闰年 2000，这样 2 月 29 日运行时这个日期也成立
    { id: 'b2', title: '小米', kind: 'birthday', calendar: 'solar', date: '2000-' + TODAY_MD,
      repeat: true, color: '#f59f00', note: '' },
    { id: 'b3', title: '结婚纪念日', kind: 'anniversary', calendar: 'solar', date: '2018-06-16',
      repeat: true, color: '#c92a2a', note: '每年这天回老地方吃饭\n记得提前订位' },
    { id: 'b4', title: '项目上线', kind: 'countdown', calendar: 'solar', date: '2026-12-01',
      repeat: false, color: '#1c7ed6', note: '' },
    { id: 'b5', title: '昨天的事', kind: 'anniversary', calendar: 'solar', date: Core.ymd(YESTERDAY),
      repeat: true, color: '#0ca678', note: '' },
    { id: 'b6', title: '<img src=x onerror=alert(1)>恶意', kind: 'countdown', calendar: 'solar',
      date: '2027-05-05', repeat: false, color: '#5c7cfa', note: '' }
  ]
};

const rows = SEED.events.map((e) => Core.nextOccurrence(e, TODAY));
const todayCount = rows.filter((r) => r.date && r.days === 0).length;
const nearest = SEED.events
  .map((e, i) => ({ e, r: rows[i] }))
  .filter((x) => !x.r.isPast && x.r.date)
  .sort((a, b) => a.r.days - b.r.days)[0];

const html = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8');

const vc = new VirtualConsole();
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
    window.__SAVES__ = [];
    window.__hooks = {};
    window.__answer = '取消';
    window.__answers = [];
    window.PluginAPI = {
      Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged' },
      onReady(fn) { setTimeout(fn, 0); },
      registerHook(k, fn) { window.__hooks[k] = fn; },
      showIndexHtmlAsView() {},
      loadSyncedData() { return Promise.resolve(window.__STORE__); },
      persistDataSynced(s) { window.__STORE__ = s; window.__SAVES__.push(s); return Promise.resolve(); },
      showSnack() {},
      openDialog() {
        // __answers 优先：需要连续多次确认的流程按顺序取值；否则回落到 __answer
        const q = window.__answers;
        return Promise.resolve(q && q.length ? q.shift() : window.__answer);
      }
    };
  }
});

const { window } = dom;
const document = window.document;
const $ = (s) => document.querySelector(s);
const byId = (id) => document.querySelector('.ml-item[data-id="' + id + '"]');

/** 详情页里某一行的值（按左侧标签找） */
const detailRow = (label) => {
  const rows = Array.from(document.querySelectorAll('#mlDetailBody .ml-detail-row'));
  const hit = rows.find((r) => r.querySelector('.ml-detail-k').textContent === label);
  return hit ? hit.querySelector('.ml-detail-v').textContent : null;
};

/** 标签是动态生成的行（「3岁生日」「2 周年时间」）：按正则找 */
const detailRowMatch = (re) => {
  const rows = Array.from(document.querySelectorAll('#mlDetailBody .ml-detail-row'));
  const hit = rows.find((r) => re.test(r.querySelector('.ml-detail-k').textContent));
  return hit ? { k: hit.querySelector('.ml-detail-k').textContent, v: hit.querySelector('.ml-detail-v').textContent } : null;
};

/** 点条目 → 详情页 → 点右上角「编辑」进表单；列表点击已不再直接打开表单 */
async function editEntry(target) {
  if (target && target.click) target.click();
  else byId(target).click();
  await wait(120);
  const btn = $('#mlDetailEdit');
  if (!btn || $('#mlDetailLayer').hidden) return false;
  btn.click();
  await wait(180);
  return true;
}

/** 关掉详情页：编辑保存后仍停在详情，要回到列表得先「返回」 */
async function backToList() {
  if ($('#mlDetailLayer').hidden) return;
  $('#mlDetailBack').click();
  await wait(380);
}

(async function run() {
  await new Promise((r) => {
    if (document.readyState === 'complete') r();
    else window.addEventListener('load', r);
  });
  await wait(200);

  console.log('[1] 初始渲染');
  eq(document.querySelectorAll('.ml-item').length, 6, '渲染 6 条记录');
  ok($('.ml-hero'), '主视觉卡片存在');
  eq($('.ml-sub').textContent,
    '6 个事项 · ' + (todayCount ? '今天 ' + todayCount + ' 个' : '最近 ' + nearest.r.days + ' 天'),
    '副标题统计');
  ok($('.ml-hero-label').textContent.includes(Core.titleOf(nearest.e, Core.ageAt(nearest.e, nearest.r, TODAY))),
    '最近的事项在卡片上（名称含年龄与「生日」）');
  eq(document.querySelectorAll('.ml-item.is-today').length, todayCount, '今天条目高亮数量');

  // 生日的进度条反过来画：显示还剩多少，越接近生日越短
  eq(nearest.e.kind, 'birthday', '种子里的最近事项是生日（今天）');
  const heroBar = $('.ml-hero .ml-bar');
  ok(!!heroBar, '主视觉卡片上有进度条');
  ok(heroBar.classList.contains('ml-bar--left'), '生日进度条走「还剩」方向');
  eq(heroBar.querySelector('i').style.width, '0%', '生日当天剩余进度为 0%');
  const barText = $('.ml-hero .ml-bar-text').textContent;
  eq(barText.includes(Core.ageOn(nearest.e, TODAY) + '岁还有 0%'), true,
    '文案是「此刻几岁还有 0%」（此刻年龄比标题里的少一岁）');

  const subs = Array.from(document.querySelectorAll('.ml-item-sub')).map((n) => n.textContent);
  const titles = Array.from(document.querySelectorAll('.ml-item-title em')).map((n) => n.textContent);
  ok(subs.some((t) => t.includes('农历四月十八')), '农历条目显示农历日期');
  ok(titles.some((t) => /生日（\d+岁）$/.test(t)), '生日名称带年龄（如「小米生日（7岁）」）');
  ok(!subs.some((t) => t.includes('岁')), '年龄不再重复出现在副标题');
  ok(subs.some((t) => t.includes('周年')), '纪念日显示周年');

  // 周年按「今天已满整年」算：2018-06-16 到今天比「下次发生日的年份差」少一年
  const annSub = (id) => {
    const el = Array.from(document.querySelectorAll('.ml-item')).find((n) => n.dataset.id === id);
    return el ? el.querySelector('.ml-item-sub').textContent : '';
  };
  const now = new Date();
  let markYear = now.getFullYear();
  if (now.getMonth() < 5 || (now.getMonth() === 5 && now.getDate() < 16)) markYear--;
  const annYears = markYear - 2018;
  // 零头天数：从上一个周年（每年 6 月 16 日）数到今天
  const remDays = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(markYear, 5, 16)) / 86400000
  );
  ok(annSub('b3').includes(annYears + ' 周年'), '纪念日周年 = 已满整年（' + annYears + ' 周年）');
  ok(!annSub('b3').includes((annYears + 1) + ' 周年'), '不再多算一年（不是 ' + (annYears + 1) + ' 周年）');
  if (remDays > 0) {
    ok(annSub('b3').includes(annYears + ' 周年 ' + remDays + ' 天'), '周年后面带上零头天数（' + remDays + ' 天）');
  } else {
    ok(!annSub('b3').includes(' 天'), '正好是周年当天时不显示零头');
  }
  ok(!annSub('b5').includes('周年') && !annSub('b5').includes(' 天'), '不满一周年只显示天数');
  eq(document.querySelectorAll('.ml-bell').length, 6, '开启提醒的条目显示铃铛');

  console.log('[1.1] 时间语义与排序');
  const nums = Array.from(document.querySelectorAll('.ml-item')).map((el) => {
    const box = el.querySelector('.ml-item-num');
    const bEl = box.querySelector('b');
    const iEl = box.querySelector('i');
    // 三天内不再显示数字，而是「今天 / 明天 / 后天」
    const words = { '今天': 0, '明天': 1, '后天': 2 };
    return {
      id: el.dataset.id,
      mode: box.className.includes('--remain') ? 'remain' : (box.className.includes('--elapsed') ? 'elapsed' : 'none'),
      days: Object.prototype.hasOwnProperty.call(words, bEl.textContent)
        ? words[bEl.textContent]
        : parseInt(bEl.textContent, 10),
      word: bEl.className.includes('is-word') ? bEl.textContent : '',
      unit: iEl ? iEl.textContent : ''
    };
  });
  const firstElapsed = nums.findIndex((n) => n.mode === 'elapsed');
  ok(firstElapsed > 0, '倒数组排在前面，已过组在后面');
  ok(nums.slice(0, firstElapsed).every((n) => n.mode === 'remain'), '前半段全部是剩余天数');
  ok(nums.slice(firstElapsed).every((n) => n.mode === 'elapsed'), '后半段全部是已过天数');
  ok(nums.slice(0, firstElapsed).every((n, i, a) => i === 0 || a[i - 1].days <= n.days), '剩余天数升序（越近越前）');
  ok(nums.slice(firstElapsed).every((n, i, a) => i === 0 || a[i - 1].days >= n.days), '已过天数降序（越久越前）');
  ok(nums.filter((n) => n.mode === 'remain').every((n) => n.unit === '天' || n.word !== ''),
    '倒数类单位只说「天」（三天内改说今天/明天/后天）');
  ok(nums.filter((n) => n.mode === 'elapsed').every((n) => n.unit === '天' || n.unit === '就在今天'), '纪念类单位只说「天」');
  eq(nums.find((n) => n.id === 'b3').unit, '天', '纪念日显示「天」');
  eq(nums.find((n) => n.id === 'b3').mode, 'elapsed', '纪念日归入已过组');
  // 纪念日的已过天数 = 从最初日期到今天
  eq(nums.find((n) => n.id === 'b3').days, Core.diffDays(Core.parseYMD('2018-06-16'), TODAY), '已过天数按原始日期计算');
  eq(nums.find((n) => n.id === 'b2').days, 0, '今天生日剩余 0 天');
  eq(nums.find((n) => n.id === 'b2').word, '今天', '剩余 0 天显示「今天」');
  eq(nums.find((n) => n.id === 'b2').unit, '', '文字状态不再挂「剩余天数」单位');

  console.log('[2] XSS 防护');
  ok(!document.querySelector('.ml-item img'), '注入的 img 未被解析执行');
  ok(document.querySelector('.ml-list').textContent.includes('<img src=x'), '恶意标题作为纯文本渲染');

  console.log('[3] 筛选切换');
  const chips = document.querySelectorAll('.ml-chip');
  chips[1].click();
  await wait(40);
  eq(document.querySelectorAll('.ml-item').length, 2, '生日筛选 2 条');
  eq(chips[1].getAttribute('aria-pressed'), 'true', '筛选按钮激活');
  chips[0].click();
  await wait(40);
  eq(document.querySelectorAll('.ml-item').length, 6, '回到全部');

  console.log('[3.5] 点击条目先进入详情（只读），再点编辑');
  byId('b1').click();
  await wait(150);
  eq($('#mlDetailLayer').hidden, false, '详情页打开');
  eq($('#mlLayer').hidden, true, '编辑表单还没打开（详情是只读的）');
  ok(/妈妈生日（\d+岁）/.test($('#mlDetailBody').textContent), '详情显示名称（「生日」在前、年龄收尾）');
  eq(detailRow('类型'), null, '不再单列类型：卡片顶部已有标签');
  eq(detailRow('历法'), null, '不再单列历法：日期行已经说清');
  eq(detailRow('农历'), null, '农历不再单列一行（与日期合并）');
  // 生日的第一个信息行叫「出生日期」：它说的是出生那天，不是下一次生日
  eq(detailRow('日期'), null, '不再笼统地叫「日期」');
  ok(/农历四月十八/.test(detailRow('出生日期')), '出生日期行合并了农历：' + detailRow('出生日期'));
  ok(detailRow('出生日期').indexOf('农历四月十八') === 0, '农历记录把农历写在前面（农历（公历））');
  ok(/1968-05-14/.test(detailRow('出生日期')), '括号里是对应的公历日期：' + detailRow('出生日期'));
  ok(/属/.test(detailRow('出生日期')), '农历记录在日期行带上干支生肖：' + detailRow('出生日期'));
  ok(!/还有|已过/.test(detailRow('出生日期')), '出生日期就是那一天，不挂天数：' + detailRow('出生日期'));
  // 第二行是下一次生日：标签带年龄，值带「还有 N 天」
  const bdayRow = detailRowMatch(/^\d+岁生日$/);
  ok(!!bdayRow, '生日详情有「N岁生日」一行');
  ok(/^\d{4}-\d{2}-\d{2} · 周./.test(bdayRow.v), '生日行给日期与星期：' + bdayRow.v);
  ok(/还有 \d+ 天|就是今天/.test(bdayRow.v), '生日行带剩余天数：' + bdayRow.v);
  eq(detailRow('目标日期'), null, '生日没有「目标日期」行');
  ok(/任务/.test(detailRow('提醒')), '详情显示提醒渠道：' + detailRow('提醒'));
  eq(detailRow('状态'), null, '正常状态不占一行（只有归档才显示）');
  ok(!!$('#mlDetailBody .ml-hero-num'), '详情有天数大数字（与置顶卡同一套）');
  eq($('#fTitle').value, '', '详情页不把数据填进表单');

  // 右上角编辑才进表单
  $('#mlDetailEdit').click();
  await wait(200);
  eq($('#mlLayer').hidden, false, '点编辑后表单打开');
  eq($('#fTitle').value, '妈妈', '表单已填充（名称里只留人）');
  // 取消 → 回到详情，而不是退回列表
  $('#mlCancel').click();
  await wait(400);
  eq($('#mlLayer').hidden, true, '取消后表单收起');
  eq($('#mlDetailLayer').hidden, false, '取消编辑仍停在详情');
  // 返回 → 回到列表
  await backToList();
  eq($('#mlDetailLayer').hidden, true, '点返回回到列表');

  console.log('[3.6] 纪念日详情：「那一天」+「N 周年时间」+「已满」');
  byId('b3').click();
  await wait(150);
  eq(detailRow('类型'), null, '纪念日详情同样不列类型');
  eq(detailRow('上次'), null, '不再有「上次」这种叫法');
  ok(detailRow('那一天').indexOf('2018-06-16') === 0, '「那一天」是起算日，不是下次发生日：' + detailRow('那一天'));
  ok(/已过 \d+ 天/.test(detailRow('那一天')), '那一天配「已过 N 天」：' + detailRow('那一天'));
  const annRow = detailRowMatch(/^\d+ 周年时间$/);
  ok(!!annRow, '有「N 周年时间」一行');
  ok(!!annRow && /^\d{4}-\d{2}-\d{2} · 周./.test(annRow.v), '周年行给日期与星期：' + (annRow && annRow.v));
  ok(!!annRow && /还有 \d+ 天|就是今天/.test(annRow.v), '周年行带剩余天数：' + (annRow && annRow.v));
  // 周年行说的是「下一个」周年，所以比已满整年多一年（正日子当天两者相等）
  const nextNth = (now.getMonth() === 5 && now.getDate() === 16) ? annYears : annYears + 1;
  eq(!!annRow && annRow.k, nextNth + ' 周年时间', '周年行的数字是下一次那届');
  ok(/周年/.test(detailRow('已满')), '显示已满周年与零头：' + detailRow('已满'));
  // 行序：那一天 → 已满 → N 周年时间（先认起点，再说走了多久，最后说下一个节点）
  const annKeys = Array.from(document.querySelectorAll('#mlDetailBody .ml-detail-row'))
    .map((r) => r.querySelector('.ml-detail-k').textContent);
  ok(annKeys.indexOf('那一天') < annKeys.indexOf('已满'), '「已满」排在「那一天」之后：' + annKeys.join(' / '));
  ok(annKeys.indexOf('已满') < annKeys.findIndex((k) => /周年时间$/.test(k)),
    '「N 周年时间」排在「已满」之后：' + annKeys.join(' / '));
  // 进度条只给生日与纪念日；纪念日按「本周年」画
  ok(!!$('#mlDetailBody .ml-bar'), '纪念日详情有进度条');
  ok($('#mlDetailBody .ml-bar-text').textContent.includes('本周年已过'), '文案是「本周年已过 N%」：' +
    $('#mlDetailBody .ml-bar-text').textContent);
  // 备注：单独成块并保留换行，而不是挤进「类型 / 日期」那种键值行
  eq(detailRow('备注'), null, '备注不再混在键值行里');
  ok(!!$('#mlDetailBody .ml-detail-note'), '备注有独立的块');
  ok(/每年这天回老地方吃饭/.test($('#mlDetailBody .ml-detail-note').textContent), '详情显示备注正文');
  ok(/记得提前订位/.test($('#mlDetailBody .ml-detail-note').textContent), '换行后的第二行也在');
  await backToList();

  console.log('[3.7] 倒数日详情：「目标日期」带天数，不画进度条');
  byId('b4').click();
  await wait(150);
  eq(detailRow('日期'), null, '倒数日不再笼统地叫「日期」');
  const tgt = detailRow('目标日期');
  ok(!!tgt && /^2026-12-01/.test(tgt), '目标日期就是目标那天：' + tgt);
  ok(!!tgt && /还有 \d+ 天|就是今天|已过 \d+ 天/.test(tgt), '目标日期后面直接带天数：' + tgt);
  eq(detailRow('重复'), '不重复', '显示重复口径');
  eq(detailRow('下次'), null, '不再有「下次」行（天数已经挂在目标日期上）');
  eq($('#mlDetailBody .ml-bar'), null, '倒数日不画进度条');
  await backToList();
  eq($('#mlDetailLayer').hidden, true, '返回列表');

  console.log('[4] 打开农历条目');
  await editEntry('b1');
  await wait(150);
  eq($('#mlLayer').hidden, false, '弹层打开');
  eq($('#fTitle').value, '妈妈', '标题已填充（名称里只留人）');
  eq($('#mlDelete').hidden, false, '编辑态显示删除');
  eq(document.querySelectorAll('#fKind button[aria-pressed="true"]')[0].dataset.v, 'birthday', '类型回填');
  eq(document.querySelectorAll('#fCalendar button[aria-pressed="true"]')[0].dataset.v, 'lunar', '历法回填');

  console.log('[5] 农历控件');
  eq($('#fLunarWrap').hidden, false, '农历控件显示');
  eq($('#fSolarWrap').hidden, true, '公历控件隐藏');
  ok($('#fLunarPreview').textContent.includes('对应公历'), '农历预览已计算');
  eq(document.querySelectorAll('#fLY option').length, 201, '年份 1900-2100 共 201 项');
  eq($('#fLY').value, '1968', '农历年份回填');
  eq($('#fLM').value, '4', '农历月份回填');
  eq($('#fLD').value, '18', '农历日期回填');

  console.log('[6] 闰月联动');
  $('#fLY').value = '2025';
  $('#fLM').value = '6';
  $('#fLY').dispatchEvent(new window.Event('change'));
  await wait(40);
  eq($('#fLeapWrap').hidden, false, '2025 年六月可选闰月');
  eq(document.querySelectorAll('#fLD option').length, 30, '闰六月 30 天');
  $('#fLeap').checked = true;
  $('#fLeap').dispatchEvent(new window.Event('change'));
  await wait(40);
  ok($('#fLunarPreview').textContent.includes('闰六月'), '闰月预览正确');
  $('#fLM').value = '5';
  $('#fLM').dispatchEvent(new window.Event('change'));
  await wait(40);
  eq($('#fLeapWrap').hidden, true, '非闰月时隐藏闰月选项');
  eq($('#fLeap').checked, false, '切换月份自动取消闰月');

  console.log('[7] 保存修改');
  $('#fTitle').value = '妈妈生日（改正）';
  document.querySelectorAll('#fColors .ml-color')[3].click();
  const before = window.__SAVES__.length;
  $('#mlSave').click();
  await wait(450);
  eq(window.__SAVES__.length, before + 1, '触发一次同步写入');
  eq(document.querySelectorAll('.ml-item').length, 6, '条目数不变');
  const saved = JSON.parse(window.__STORE__);
  const mom = saved.events.filter((e) => e.id === 'b1')[0];
  eq(mom.title, '妈妈生日（改正）', '标题已写入');
  eq(mom.calendar, 'lunar', '历法已写入');
  eq(mom.color, Core.COLORS[3], '颜色已写入');
  eq(mom.lunar.month, 5, '农历月份已写入');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(mom.date), '公历日期已同步计算');
  // 保存后回到详情（不是直接回列表），且详情已经换成新数据
  eq($('#mlDetailLayer').hidden, false, '保存后仍停在详情页');
  ok($('#mlDetailBody').textContent.includes('妈妈生日（改正）'), '详情立即显示新名称');
  await backToList();

  console.log('[8] 每个事项的提醒渠道');
  await editEntry('b4');
  await wait(150);
  eq($('#fTask').checked, true, '默认加入任务列表');
  eq($('#fSnack').checked, false, '默认不弹提示条');
  eq($('#fOffsets').hidden, false, '有渠道开启时显示天数');
  eq($('#fArchived').checked, false, '默认不归档');
  eq(document.querySelector('#fOffsets button[data-d="0"]').getAttribute('aria-pressed'), 'true', '默认选中当天');
  eq(document.querySelector('#fOffsets button[data-d="1"]').getAttribute('aria-pressed'), 'true', '默认选中提前 1 天');
  ok($('#fRemindHint').textContent.includes('任务'), '说明提到任务列表');

  $('#fTask').click();
  await wait(60);
  eq($('#fTask').checked, false, '任务列表已关闭');
  eq($('#fOffsets').hidden, true, '两个渠道都关时隐藏天数');
  ok($('#fRemindHint').textContent.includes('不会提醒'), '提示两个渠道都关着');

  $('#fSnack').click();
  await wait(60);
  eq($('#fOffsets').hidden, false, '开了提示条后恢复天数');
  ok($('#fRemindHint').textContent.includes('提示条'), '说明切到提示条');

  Array.from(document.querySelectorAll('#fOffsets button')).forEach(function (b) {
    if (b.getAttribute('aria-pressed') === 'true') b.click();
  });
  await wait(40);
  document.querySelector('#fOffsets button[data-d="7"]').click();
  await wait(40);
  eq(document.querySelector('#fOffsets button[data-d="7"]').getAttribute('aria-pressed'), 'true', '提前 7 天已选中');
  $('#mlSave').click();
  await wait(450);

  const withRemind = JSON.parse(window.__STORE__).events.filter((e) => e.id === 'b4')[0];
  eq(withRemind.remind.task, false, '任务列表关闭已写入');
  eq(withRemind.remind.snack, true, '提示条开启已写入');
  eq(withRemind.remind.offsets.join(','), '7', '提醒天数已写入');
  eq(withRemind.archived, false, '未归档已写入');
  eq(document.querySelectorAll('.ml-bell').length, 6, '还有一个渠道开着 → 铃铛仍在');
  await backToList();

  console.log('[9] 新增记录');
  $('#mlAdd').click();
  await wait(150);
  eq($('#mlLayer').hidden, false, '新增弹层打开');
  eq($('#fTitle').value, '', '新表单标题为空');
  eq($('#mlDelete').hidden, true, '新建态隐藏删除');
  // 名称必填：空名称不落库，给出红框 + 说明
  $('#mlSave').click();
  await wait(450);
  eq(document.querySelectorAll('.ml-item').length, 6, '空名称不保存');
  eq($('#mlLayer').hidden, false, '弹层仍然开着，不丢用户已填的内容');
  eq($('#fTitleErr').hidden, false, '给出「请填写名称」提示');
  eq($('#fTitle').getAttribute('aria-invalid'), 'true', '输入框标记为无效');
  eq($('#fTitleErr').textContent, '请填写名称', '提示文案');

  // 只填空格也不算填
  $('#fTitle').value = '   ';
  $('#mlSave').click();
  await wait(200);
  eq(document.querySelectorAll('.ml-item').length, 6, '全是空格同样不保存');

  // 填了名称才保存；名称按纯文本存储（不被当成标签解析）
  const xssTitle = '<img src=x onerror=alert(1)>恶意';
  $('#fTitle').value = xssTitle;
  $('#fTitle').dispatchEvent(new window.Event('input'));
  eq($('#fTitleErr').hidden, true, '一输入就撤掉提示');
  eq($('#fTitle').getAttribute('aria-invalid'), null, '输入后恢复常态');
  $('#mlSave').click();
  await wait(450);
  eq(document.querySelectorAll('.ml-item').length, 7, '新增成功');
  const saved2 = JSON.parse(window.__STORE__);
  eq(saved2.events[saved2.events.length - 1].title, xssTitle, '名称按纯文本保存');

  console.log('[10] 删除（用户取消）');
  await editEntry('b4');
  await wait(150);
  $('#mlDelete').click();
  await wait(300);
  eq(document.querySelectorAll('.ml-item').length, 7, '取消后不删除');
  eq($('#mlDetailLayer').hidden, false, '取消删除仍停在详情');
  await backToList();

  console.log('[11] 删除（用户确认）');
  window.__answer = '删除';
  await editEntry('b4');
  await wait(150);
  $('#mlDelete').click();
  await wait(500);
  eq(document.querySelectorAll('.ml-item').length, 6, '确认后删除成功');
  eq($('#mlDetailLayer').hidden, true, '条目被删后详情自动退回列表');

  console.log('[12] 远程同步');
  const remote = JSON.parse(JSON.stringify(JSON.parse(window.__STORE__)));
  remote.events.push({ id: 'z9', title: '远程新增', kind: 'countdown', calendar: 'solar',
    date: '2027-01-01', repeat: false, color: '#7048e8', note: '' });
  window.__STORE__ = JSON.stringify(remote);
  ok(typeof window.__hooks.persistedDataChanged === 'function', '已注册同步钩子');
  window.__hooks.persistedDataChanged();
  await wait(350);
  ok($('.ml-list').textContent.includes('远程新增'), '远程数据已合并到界面');

  console.log('[13] 分类内新建默认类型');
  const kindOf = () => document.querySelector('#fKind button[aria-pressed="true"]').dataset.v;

  // 在「纪念日」分类点添加，类型默认就是纪念日
  document.querySelector('.ml-chip[data-f="anniversary"]').click();
  await wait(60);
  $('#mlAdd').click();
  await wait(150);
  eq(kindOf(), 'anniversary', '纪念日分类下新建默认选中纪念日');
  eq($('#mlSheetTitle').textContent, '新建纪念日', '标题显示新建纪念日');

  // 仍可手动改成别的类型，标题跟着变
  document.querySelector('#fKind button[data-v="countdown"]').click();
  await wait(60);
  eq(kindOf(), 'countdown', '可手动切换为倒数日');
  eq($('#mlSheetTitle').textContent, '新建倒数日', '标题跟随切换');
  document.querySelector('#fKind button[data-v="anniversary"]').click();
  await wait(60);

  // 保存后落到当前分类，且名称按纯文本存储
  $('#fTitle').value = '相识纪念日';
  $('#mlSave').click();
  await wait(450);
  const created = JSON.parse(window.__STORE__).events.filter((e) => e.title === '相识纪念日')[0];
  ok(!!created, '已保存');
  eq(created.kind, 'anniversary', '保存类型为纪念日');
  eq(created.title, '相识纪念日', '名称不含年龄等展示信息');
  ok($('.ml-list').textContent.includes('相识纪念日'), '新条目出现在当前分类列表');

  // 回到「全部」，新建默认仍是生日
  document.querySelector('.ml-chip[data-f="all"]').click();
  await wait(60);
  $('#mlAdd').click();
  await wait(150);
  eq(kindOf(), 'birthday', '全部视图下新建默认生日');
  eq($('#mlSheetTitle').textContent, '新建生日', '标题显示新建生日');

  // 名称里手输年龄会被清掉，避免渲染时叠加
  $('#fTitle').value = '测试生日（30岁）';
  $('#mlSave').click();
  await wait(450);
  const cleaned = JSON.parse(window.__STORE__).events.filter((e) => /测试/.test(e.title))[0];
  eq(cleaned.title, '测试', '名称里只留人：年龄与「生日」都不写入');
  ok(/测试生日（\d+岁）/.test($('.ml-list').textContent), '列表仍显示年龄，「生日」在前、年龄在后');

  console.log('[14] 归档');
  ok(!!$('#mlSettings'), '顶栏有设置入口');
  eq(!!$('#mlArchive'), false, '归档不再占用顶栏按钮');
  document.querySelector('.ml-chip[data-f="all"]').click();
  await wait(60);
  const total = document.querySelectorAll('.ml-item').length;
  eq(document.querySelector('.ml-chip[data-f="archive"]').textContent, '归档', '没有归档项时胶囊只显示「归档」');

  // 归档「结婚纪念日」
  await editEntry('b3');
  await wait(150);
  eq($('#fArchived').checked, false, '默认未归档');
  $('#fArchived').click();
  await wait(60);
  ok($('#fRemindHint').textContent.includes('已归档'), '归档时说明变为不再提醒');
  $('#mlSave').click();
  await wait(450);
  await backToList();

  eq(document.querySelectorAll('.ml-item').length, total - 1, '归档后不在「全部」里显示');
  ok(!byId('b3'), '归档的条目移出当前列表');
  // 胶囊只做入口，不挂数量（数字在副标题里）
  eq(document.querySelector('.ml-chip[data-f="archive"]').textContent, '归档', '归档胶囊不带数量');
  ok($('.ml-sub').textContent.includes('归档 1'), '归档数量改由副标题说明：' + $('.ml-sub').textContent);

  // 通过筛选胶囊进入归档视图
  document.querySelector('.ml-chip[data-f="archive"]').click();
  await wait(60);
  eq(document.querySelector('.ml-chip[data-f="archive"]').getAttribute('aria-pressed'), 'true', '归档胶囊进入按下态');
  eq(document.querySelectorAll('.ml-item').length, 1, '归档视图只有归档的事项');
  ok(byId('b3'), '归档的事项在归档视图里');
  ok($('.ml-sub').textContent.includes('已归档'), '副标题说明已归档');
  ok($('#mlHero').innerHTML.includes('ml-hero--empty'), '归档视图用占位卡，不置顶任何事项');
  ok(document.querySelector('.ml-list').textContent.includes('已归档 · 纪念日'), '条目带已归档标签');

  // 归档的事项才写状态行：正常状态不显示
  byId('b3').click();
  await wait(150);
  eq(detailRow('状态'), '已归档', '归档后详情显示「状态：已归档」');
  await backToList();

  // 归档视图里新建：默认就是归档状态
  $('#mlAdd').click();
  await wait(150);
  eq($('#fArchived').checked, true, '归档视图里新建默认归档');
  $('#mlCancel').click();
  await wait(380);

  // 取消归档 → 回到「全部」
  await editEntry('b3');
  await wait(150);
  $('#fArchived').click();
  await wait(40);
  $('#mlSave').click();
  await wait(450);
  await backToList();
  eq(document.querySelector('.ml-chip[data-f="archive"]').textContent, '归档', '没有归档项后计数消失');
  eq(document.querySelectorAll('.ml-item').length, 0, '取消归档后归档视图为空');
  document.querySelector('.ml-chip[data-f="all"]').click();
  await wait(60);
  eq(document.querySelectorAll('.ml-item').length, total, '回到全部，条目恢复');

  console.log('[15] 设置与置顶卡片');
  document.querySelector('.ml-chip[data-f="all"]').click();
  await wait(60);
  $('#mlSettings').click();
  await wait(150);
  eq($('#mlSetLayer').hidden, false, '设置面板打开');
  eq($('#sHero').checked, true, '默认开启置顶卡片');
  ok($('#sAbout').textContent.includes('里程碑'), '关于信息显示插件名');
  ok(/v\d+\.\d+\.\d+/.test($('#sAbout').textContent), '关于信息显示版本号');

  // 作者与反馈地址（设置 > 关于）
  const aboutBox = document.querySelector('.ml-about');
  ok(!!aboutBox, '关于是一张三行的信息卡');
  ok(aboutBox.textContent.includes('calmpunct'), '关于里显示插件作者');
  eq(aboutBox.querySelector('[data-i18n="about.author"]').textContent, '作者', '作者标签跟着语言走');
  eq(aboutBox.querySelector('[data-i18n="about.feedback"]').textContent, '反馈', '反馈标签跟着语言走');
  const fbLink = aboutBox.querySelector('a.ml-about-link');
  eq(!!fbLink, true, '反馈地址是可点链接');
  eq(fbLink.getAttribute('href'), 'https://github.com/calmpunct/sp-milestone/issues', '反馈地址指向仓库 issues');
  eq(fbLink.getAttribute('target'), '_blank', '反馈链接在新窗口打开');
  ok(/noopener/.test(fbLink.getAttribute('rel') || ''), '反馈链接断开 opener');
  $('#mlSetClose').click();
  await wait(420);
  eq($('#mlSetLayer').hidden, true, '设置面板关闭');

  // 置顶卡片跟随当前分区，而不是固定取「全部」的第一条
  ok(!!$('.ml-hero'), '全部视图有置顶卡片');
  const heroId = () => { const h = document.querySelector('.ml-hero'); return h ? h.dataset.id : null; };
  const firstId = () => { const it = document.querySelector('.ml-item'); return it ? it.dataset.id : null; };
  eq(heroId(), firstId(), '全部视图：置顶 = 全部的第一条');

  document.querySelector('.ml-chip[data-f="anniversary"]').click();
  await wait(60);
  ok($('.ml-hero-label').textContent.includes('已经走过'), '纪念日分区：置顶是已过语义');
  eq(heroId(), firstId(), '纪念日分区：置顶 = 该分区第一条');

  document.querySelector('.ml-chip[data-f="birthday"]').click();
  await wait(60);
  // 剩余 0/1/2 天时标签是「…就在 / …就是」，所以判「不是已过语义」而不是死抠「还有」
  ok(!!$('.ml-hero-num--remain'), '生日分区：置顶是剩余语义');
  ok(!$('.ml-hero-label').textContent.includes('已经走过'), '生日分区：置顶不按已过语义');
  eq(heroId(), firstId(), '生日分区：置顶 = 该分区第一条');

  // 关掉开关：卡片消失、列表贴顶，设置写入同步数据
  $('#mlSettings').click();
  await wait(150);
  $('#sHero').click();
  await wait(400);
  eq($('#mlHero').innerHTML, '', '关掉后不渲染置顶卡片');
  eq(JSON.parse(window.__STORE__).settings.hero, false, '开关写入同步数据');

  $('#sHero').click();
  await wait(400);
  ok(!!$('.ml-hero'), '重新打开后卡片回来');
  eq(JSON.parse(window.__STORE__).settings.hero, true, '开关值可恢复');
  $('#mlSetClose').click();
  await wait(420);

  console.log('[16] 空分区占位');
  {
    const seed = {
      version: 1,
      settings: { lang: 'zh', taskTag: 'milestone', hero: true },
      events: [{ id: 'x1', title: '甲生日', kind: 'birthday', calendar: 'solar', date: '2000-01-01',
        repeat: true, color: '#f59f00', note: '' }]
    };
    const dom2 = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://localhost/',
      virtualConsole: vc,
      beforeParse(w2) {
        w2.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        w2.PluginAPI = {
          Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged' },
          onReady(fn) { setTimeout(fn, 0); },
          registerHook() {}, showIndexHtmlAsView() {}, showSnack() {},
          loadSyncedData() { return Promise.resolve(JSON.stringify(seed)); },
          persistDataSynced() { return Promise.resolve(); },
          openDialog() { return Promise.resolve('取消'); }
        };
      }
    });
    const d2 = dom2.window.document;
    await new Promise((r) => setTimeout(r, 300));
    d2.querySelector('.ml-chip[data-f="anniversary"]').click();
    await new Promise((r) => setTimeout(r, 120));
    ok(!!d2.querySelector('.ml-hero--empty'), '空分区仍然渲染等高占位卡');
    ok(d2.querySelector('.ml-hero-label').textContent.includes('纪念日'), '占位卡标明当前分区');
    eq(d2.querySelector('.ml-hero-num').textContent.trim(), '—', '占位卡不显示天数');
    ok(d2.querySelector('.ml-hero-meta').textContent.includes('还没有记录'), '占位卡给出提示');
    eq(d2.querySelectorAll('.ml-item').length, 0, '空分区没有条目');
    ok(d2.querySelector('.ml-sub').textContent.includes('这个分类还没有记录'), '副标题说明分类为空');
    ok(d2.querySelector('.ml-list').textContent.includes('添加一个纪念日'), '空态按钮按纪念日新建');
    dom2.window.close();
  }

  console.log('[17] 节日类型：预设与自定义');
  document.querySelector('.ml-chip[data-f="all"]').click();
  await wait(60);
  const beforeFest = document.querySelectorAll('.ml-item').length;

  $('#mlAdd').click();
  await wait(150);
  document.querySelector('#fKind button[data-v="festival"]').click();
  await wait(60);
  eq($('#mlSheetTitle').textContent, '新建节日', '标题切到新建节日');
  eq($('#fPresetWrap').hidden, false, '节日类型显示预设列表');
  eq($('#fArchiveWrap').hidden, true, '节日不显示归档开关（节日每年都会再来）');
  eq($('#fRepeatWrap').hidden, true, '节日不显示「每年重复」开关（强制每年）');
  eq(document.querySelectorAll('#fPresets .ml-preset').length, Core.FESTIVALS.length + 1, '预设按钮 = 全部预设 + 自定义');
  eq(document.querySelector('#fPresets .ml-preset[data-k="zhongqiu"]').getAttribute('aria-pressed'), 'false', '初始未选中任何预设');
  eq(document.querySelector('#fPresets .ml-preset[data-k=""]').getAttribute('aria-pressed'), 'true', '未选预设时「自定义」为按下态');

  // 选中秋：名称、历法、日期、颜色一次填好
  document.querySelector('#fPresets .ml-preset[data-k="zhongqiu"]').click();
  await wait(80);
  eq($('#fTitle').value, '中秋节', '名称自动填入');
  eq(document.querySelector('#fKind button[aria-pressed="true"]').dataset.v, 'festival', '类型仍是节日');
  eq(document.querySelector('#fCalendar button[aria-pressed="true"]').dataset.v, 'lunar', '中秋按农历');
  eq($('#fLM').value, '8', '农历月份 8');
  eq($('#fLD').value, '15', '农历十五');
  eq($('#fDate').value, Core.festivalFields('zhongqiu', new Date()).date, '公历日期按下一次出现算出');
  ok($('#fPresetHint').textContent.includes('农历'), '提示说明按农历计算');
  eq(document.querySelector('#fPresets .ml-preset[data-k="zhongqiu"]').getAttribute('aria-pressed'), 'true', '中秋预设高亮');
  // 预设已经把日期算好：历法与日期控件收起，避免重复输入
  eq($('#fCalendarWrap').hidden, true, '选中预设时隐藏历法');
  eq($('#fSolarWrap').hidden, true, '选中预设时隐藏公历日期');
  eq($('#fLunarWrap').hidden, true, '选中预设时隐藏农历日期');
  eq($('#fTitleWrap').hidden, false, '单选时名称仍可改');

  // 切到生日应隐藏预设列表，切回来保留选择
  document.querySelector('#fKind button[data-v="birthday"]').click();
  await wait(60);
  eq($('#fPresetWrap').hidden, true, '非节日类型隐藏预设');
  document.querySelector('#fKind button[data-v="festival"]').click();
  await wait(60);
  eq($('#fPresetWrap').hidden, false, '切回节日恢复预设');
  eq(document.querySelector('#fPresets .ml-preset[data-k="zhongqiu"]').getAttribute('aria-pressed'), 'true', '切回后仍记住中秋');

  $('#mlSave').click();
  await wait(450);
  eq(document.querySelectorAll('.ml-item').length, beforeFest + 1, '节日已添加');
  const festSaved = JSON.parse(window.__STORE__).events.filter((e) => e.title === '中秋节')[0];
  ok(!!festSaved, '节日已写入数据');
  eq(festSaved.kind, 'festival', '类型为节日');
  eq(festSaved.preset, 'zhongqiu', '预设标识写入');
  eq(festSaved.calendar, 'lunar', '历法写入');
  eq(festSaved.lunar.month + '/' + festSaved.lunar.day, '8/15', '农历八月十五写入');
  eq(festSaved.repeat, true, '节日每年重复');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(festSaved.date), '公历日期已同步算出');

  // 节日筛选 + 展示语义
  document.querySelector('.ml-chip[data-f="festival"]').click();
  await wait(60);
  eq(document.querySelectorAll('.ml-item').length, 1, '节日筛选只有 1 条');
  ok($('.ml-list').textContent.includes('中秋节'), '节日在列表中');
  eq(document.querySelector('.ml-item .ml-tag').textContent, '节日', '条目标签显示节日');
  ok($('.ml-hero-label').textContent.includes('还有'), '节日按剩余天数倒数');
  eq(document.querySelector('.ml-item-num i').textContent === '天' ||
    document.querySelector('.ml-item-num i').textContent === '就是今天', true, '单位是「天」');
  ok($('.ml-sub').textContent.includes('节日'), '副标题按「节日」计数');

  // 节日不画进度条：它只有「还有 N 天」一个语义，没有可比的一年周期
  eq($('#mlHero .ml-bar'), null, '节日置顶卡没有进度条');
  document.querySelector('.ml-item').click();
  await wait(150);
  eq(detailRow('日期'), null, '节日不再笼统地叫「日期」');
  const festDate = detailRow('节日日期');
  ok(!!festDate && festDate.includes('周'), '节日详情叫「节日日期」并带星期：' + festDate);
  ok(!!festDate && /还有 \d+ 天|就是今天/.test(festDate), '节日也要倒数（日期后带剩余天数）：' + festDate);
  eq(detailRow('下次'), null, '节日没有「下次」行');
  eq($('#mlDetailBody .ml-bar'), null, '节日详情不画进度条');
  await backToList();

  // 自定义节日
  $('#mlAdd').click();
  await wait(150);
  eq(document.querySelector('#fKind button[aria-pressed="true"]').dataset.v, 'festival', '节日分区下新建默认节日');
  eq(document.querySelector('#fPresets .ml-preset[data-k=""]').getAttribute('aria-pressed'), 'true', '新记录默认是自定义');
  eq($('#fCalendarWrap').hidden, false, '自定义时显示历法');
  eq($('#fSolarWrap').hidden, false, '自定义时显示日期');
  $('#fTitle').value = '公司年会';
  $('#fDate').value = '2027-01-20';
  $('#fDate').dispatchEvent(new window.Event('change'));
  await wait(40);
  $('#mlSave').click();
  await wait(450);
  const customFest = JSON.parse(window.__STORE__).events.filter((e) => e.title === '公司年会')[0];
  ok(!!customFest, '自定义节日已保存');
  eq(customFest.kind, 'festival', '自定义节日类型');
  eq(customFest.preset, null, '自定义节日没有预设标识');
  eq(customFest.date, '2027-01-20', '自定义日期保留');
  eq(document.querySelectorAll('.ml-item').length, 2, '节日分区两条');
  document.querySelector('.ml-chip[data-f="all"]').click();
  await wait(60);

  console.log('[18] 预设节日批量添加（多选）');
  const beforeBatch = document.querySelectorAll('.ml-item').length;
  $('#mlAdd').click();
  await wait(150);
  document.querySelector('#fKind button[data-v="festival"]').click();
  await wait(60);

  // 一次勾三个
  document.querySelector('#fPresets .ml-preset[data-k="chunjie"]').click();
  await wait(60);
  document.querySelector('#fPresets .ml-preset[data-k="yuanxiao"]').click();
  await wait(60);
  document.querySelector('#fPresets .ml-preset[data-k="qingming"]').click();
  await wait(60);
  eq(document.querySelectorAll('#fPresets .ml-preset[aria-pressed="true"]').length, 3, '三个预设同时选中');
  eq(document.querySelector('#fPresets .ml-preset[data-k=""]').getAttribute('aria-pressed'), 'false', '多选时「自定义」不再是按下态');
  eq($('#mlSave').textContent, '添加 3 个', '保存按钮显示数量');
  eq($('#fTitleWrap').hidden, true, '多选时隐藏名称（每个节日用自己的名字）');
  eq($('#fColorWrap').hidden, true, '多选时隐藏颜色（各用预设配色）');
  eq($('#fCalendarWrap').hidden, true, '多选时隐藏历法');
  ok($('#fPresetHint').textContent.includes('春节') && $('#fPresetHint').textContent.includes('3 个'), '提示列出已选节日');

  // 再点一次取消选中
  document.querySelector('#fPresets .ml-preset[data-k="yuanxiao"]').click();
  await wait(60);
  eq($('#mlSave').textContent, '添加 2 个', '取消一个后数量跟着变');
  document.querySelector('#fPresets .ml-preset[data-k="yuanxiao"]').click();
  await wait(60);
  eq($('#mlSave').textContent, '添加 3 个', '重新选中恢复');

  $('#mlSave').click();
  await wait(500);
  eq(document.querySelectorAll('.ml-item').length, beforeBatch + 3, '一次加入 3 个节日');

  const batch = JSON.parse(window.__STORE__).events.filter((e) => e.title === '春节' || e.title === '元宵节' || e.title === '清明');
  eq(batch.length, 3, '三个节日都已写入');
  batch.forEach((e) => {
    eq(e.kind, 'festival', e.title + ' 类型为节日');
    eq(e.repeat, true, e.title + ' 每年重复');
    ok(!!e.preset, e.title + ' 带预设标识');
    ok(/^\d{4}-\d{2}-\d{2}$/.test(e.date), e.title + ' 日期已算好');
  });
  const cjSaved = batch.filter((e) => e.preset === 'chunjie')[0];
  eq(cjSaved.calendar, 'lunar', '春节按农历');
  eq(cjSaved.lunar.month + '/' + cjSaved.lunar.day, '1/1', '春节是正月初一');
  eq(cjSaved.remind.task, true, '批量创建共用表单的提醒设置');
  const qmSaved = batch.filter((e) => e.preset === 'qingming')[0];
  eq(qmSaved.term, 'qingming', '清明的节气标识写入');

  console.log('[18.1] 迟到的 applyLang 不能清掉正在进行的多选');
  {
    // 回归：补读语言设定值（getAppState → primeHostLang）会异步再跑一次 applyLang，
    // 它重建 #fPresets 时若不恢复选中态，用户刚勾的多个节日会整片变回未选中，
    // 保存按钮也从「添加 3 个」退回「保存」—— 看起来就是「节日多选被弄没了」。
    const seed2 = { version: 1, settings: { lang: 'auto', hero: true, lunar: true }, events: [] };
    const domB = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://localhost/',
      virtualConsole: vc,
      beforeParse(wB) {
        wB.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        wB.PluginAPI = {
          cfg: { theme: 'light', appVersion: '19.3.1', platform: 'desktop', isDev: false },
          Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged', LANGUAGE_CHANGE: 'languageChange' },
          getCurrentLanguage() { return 'en'; },
          // 宿主 IPC 慢：设定值晚到 200ms，模拟用户已经在填表时被重建
          getAppState() {
            return new Promise((res) => setTimeout(() => res({
              tasks: {}, tags: {}, projects: {},
              globalConfig: { localization: { lng: 'zh' } }
            }), 700));
          },
          onReady(fn) { setTimeout(fn, 0); },
          registerHook() {},
          showIndexHtmlAsView() {}, showSnack() {},
          loadSyncedData() { return Promise.resolve(JSON.stringify(seed2)); },
          persistDataSynced() { return Promise.resolve(); },
          openDialog() { return Promise.resolve('Cancel'); }
        };
      }
    });
    const dB = domB.window.document;
    const $B = (s) => dB.querySelector(s);
    const pressedB = () => Array.from(dB.querySelectorAll('#fPresets .ml-preset[aria-pressed="true"]'))
      .map((b) => b.dataset.k);

    await new Promise((r) => setTimeout(r, 120));
    const saveIdle = $B('#mlSave').textContent;   // 单条时的文案（宿主语言是 en，这里不断言具体词）
    $B('#mlAdd').click();
    await new Promise((r) => setTimeout(r, 80));
    dB.querySelector('#fKind button[data-v="festival"]').click();
    await new Promise((r) => setTimeout(r, 40));
    ['chunjie', 'yuanxiao', 'qingming'].forEach((k) => {
      dB.querySelector('#fPresets .ml-preset[data-k="' + k + '"]').click();
    });
    eq(pressedB().join(','), 'chunjie,yuanxiao,qingming', '先勾上三个');
    const saveMulti = $B('#mlSave').textContent;
    ok(saveMulti !== saveIdle && /3/.test(saveMulti), '保存按钮显示数量：' + saveMulti);

    // 等迟到的 applyLang 落地（getAppState 700ms，此刻还没回来）
    await new Promise((r) => setTimeout(r, 700));
    eq(pressedB().join(','), 'chunjie,yuanxiao,qingming', '重建后仍保持三个选中');
    // 迟到的设定值是 zh：界面会从 en 切成中文，所以只断言「数量还在」，不断言具体词
    ok(/3/.test($B('#mlSave').textContent), '保存按钮仍显示数量：' + $B('#mlSave').textContent);
    ok($B('#mlSave').textContent !== saveIdle, '也没有退回单条文案');
    ok(/3/.test($B('#fPresetHint').textContent), '提示文案仍是「已选 3 个」');
    eq($B('#fPresets .ml-preset[data-k=""]').getAttribute('aria-pressed'), 'false', '「自定义」不会变回按下态');
    eq($B('#fTitleWrap').hidden, true, '多选时名称仍然隐藏');

    // 真正保存仍然是批量加入
    $B('#mlSave').click();
    await new Promise((r) => setTimeout(r, 400));
    eq(dB.querySelectorAll('.ml-item').length, 3, '一次加入 3 个节日');
    domB.window.close();
  }

  console.log('[19] 倒数日过期删除线');
  eq($('#fRepeatWrap').hidden, true, '节日不显示倒数设置');
  eq($('#fArchiveWrap').hidden, true, '节日不显示归档开关');
  $('#mlAdd').click();
  await wait(150);
  document.querySelector('#fKind button[data-v="countdown"]').click();
  await wait(60);
  eq($('#fRepeatWrap').hidden, false, '倒数日显示倒数设置');
  eq($('#fArchiveWrap').hidden, false, '倒数日显示归档开关');
  ok($('#fRepeatWrap').textContent.includes('过期后重新开始倒数'), '重复开关文案改为「过期后重新开始倒数」');
  ok($('#fRepeatHint').textContent.includes('明年的同一天'), '文案说明了打开后的效果');

  $('#fRepeat').checked = false;
  $('#fTitle').value = '去年年会';
  $('#fDate').value = '2025-01-01';
  $('#fDate').dispatchEvent(new window.Event('change'));
  await wait(40);
  $('#mlSave').click();
  await wait(450);

  const expired = JSON.parse(window.__STORE__).events.filter((e) => e.title === '去年年会')[0];
  ok(!!expired, '过期倒数日已保存');
  eq(expired.repeat, false, '关掉了重新开始倒数');
  eq(byId(expired.id).querySelector('.ml-item-title em').textContent, '去年年会', '名称文字完整');
  ok(!!byId(expired.id).querySelector('.ml-item-name--done span'), '过期倒数日名称加删除线（画在内层 span 上）');
  eq(byId(expired.id).querySelector('.ml-tag').textContent, '过期的倒数日', '过期后标签改为「过期的倒数日」');
  eq(byId(expired.id).querySelector('.ml-item-num i').textContent, '天', '过期后仍只说「天」');

  // 过期即划掉，没有开关可关
  $('#mlSettings').click();
  await wait(150);
  eq($('#sStrike'), null, '设置里已没有删除线开关');
  ok($('#mlSetLayer').textContent.indexOf('删除线') === -1, '设置面板不再出现删除线文案');
  const setLabels = [].map.call(document.querySelectorAll('#mlSetLayer .ml-label'), (n) => n.textContent.trim());
  ok(setLabels.indexOf('显示') === -1, '「显示」分组随开关一并移除（现存分组：' + setLabels.join(' / ') + '）');
  $('#mlSetClose').click();
  await wait(420);
  eq(JSON.parse(window.__STORE__).settings.strikeExpired, undefined, '旧字段不再写回同步数据');
  ok(!!byId(expired.id).querySelector('.ml-item-name--done span'), '无需设置，过期倒数日默认带删除线');
  eq(byId(expired.id).querySelector('.ml-tag').textContent, '过期的倒数日', '标签仍标明过期');
  ok(!!byId(expired.id), '条目本身还在');

  // 打开了「过期后重新开始倒数」的倒数日不算过期，不划线
  $('#mlAdd').click();
  await wait(150);
  document.querySelector('#fKind button[data-v="countdown"]').click();
  await wait(60);
  eq($('#fRepeat').checked, true, '新建倒数日默认开启重复');
  $('#fTitle').value = '每年年会';
  $('#fDate').value = '2025-01-01';
  $('#fDate').dispatchEvent(new window.Event('change'));
  await wait(40);
  $('#mlSave').click();
  await wait(450);
  const repeatEv = JSON.parse(window.__STORE__).events.filter((e) => e.title === '每年年会')[0];
  ok(!!repeatEv && repeatEv.repeat === true, '重复倒数日已保存');
  ok(!byId(repeatEv.id).querySelector('.ml-item-name--done'), '开启了重复的过期日期不加删除线');
  eq(byId(repeatEv.id).querySelector('.ml-item-num i').textContent, '天', '重复倒数日只说「天」');

  // 生日/纪念日/节日不受影响
  ok(!document.querySelector('.ml-item[data-id="b2"] .ml-item-name--done'), '生日不加删除线');
  eq(document.querySelector('.ml-item[data-id="b2"] .ml-tag').textContent, '生日', '生日的标签不变');

  console.log('[20] 清除数据缓存（二次确认）');
  {
    const before = JSON.parse(window.__STORE__).events.length;
    ok(before > 0, '清除前有 ' + before + ' 条');
    window.localStorage.setItem('ml-task-map-v1', '{"task_1":"b1"}');
    window.localStorage.setItem('ml-remind-seen', '{"k":1}');
    window.localStorage.setItem('ml-handled-v1', '{"k":1}');

    $('#mlSettings').click();
    await wait(150);
    eq($('#sClear').textContent.trim(), '清除里程碑数据缓存', '设置里有清除按钮');
    ok(/当前共 \d+ 个事项/.test($('#sDataInfo').textContent), '数据概况显示条数：' + $('#sDataInfo').textContent);

    // 第一次确认点「取消」→ 什么都不该发生
    window.__answers = ['取消'];
    $('#sClear').click();
    await wait(200);
    eq(JSON.parse(window.__STORE__).events.length, before, '第一次确认取消后数据不变');
    eq(document.querySelectorAll('.ml-item').length, before, '列表不变');

    // 第一次「继续」、第二次「取消」→ 仍然不删
    window.__answers = ['继续', '取消'];
    $('#sClear').click();
    await wait(200);
    eq(JSON.parse(window.__STORE__).events.length, before, '第二次确认取消后数据不变');

    // 两次都确认 → 清空
    const saves = window.__SAVES__.length;
    window.__answers = ['继续', '确定清除'];
    $('#sClear').click();
    await wait(350);
    const after = JSON.parse(window.__STORE__);
    eq(after.events.length, 0, '数据已清空');
    eq(after.version, 1, '写入的是当前数据格式');
    ok(window.__SAVES__.length > saves, '立即触发了一次写入');
    eq(document.querySelectorAll('.ml-item').length, 0, '列表清空');
    eq($('#mlSetLayer').hidden, true, '清除后关闭设置面板');
    eq(window.localStorage.getItem('ml-task-map-v1'), null, '本机任务映射表已清');
    eq(window.localStorage.getItem('ml-remind-seen'), null, '本机已提示记录已清');
    eq(window.localStorage.getItem('ml-handled-v1'), null, '本机已处理记录已清');

    // 清空后还能继续用
    $('#mlAdd').click();
    await wait(150);
    $('#fTitle').value = '清空后新建';
    $('#fDate').value = '2027-07-07';
    $('#fDate').dispatchEvent(new window.Event('change'));
    await wait(40);
    $('#mlSave').click();
    await wait(450);
    eq(JSON.parse(window.__STORE__).events.length, 1, '清空后可以继续新建');
    eq(document.querySelectorAll('.ml-item').length, 1, '新条目正常显示');
  }

  console.log('[21] 跟随软件语言 / 手动切换');
  {
    // 宿主语言 = 英文，插件语言设为 auto → 界面应为英文
    const seed = {
      version: 1,
      settings: { lang: 'auto', taskTag: 'milestone', hero: true },
      events: [{ id: 'l1', title: 'Mom birthday', kind: 'birthday', calendar: 'solar',
        date: '1990-05-12', repeat: true, color: '#d6336c', note: '' }]
    };
    const hooks = {};
    const saves = [];
    const dom3 = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://localhost/',
      virtualConsole: vc,
      beforeParse(w3) {
        w3.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        w3.PluginAPI = {
          cfg: { lang: 'en' },
          Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged', LANGUAGE_CHANGE: 'languageChange' },
          onReady(fn) { setTimeout(fn, 0); },
          registerHook(k, fn) { hooks[k] = fn; },
          showIndexHtmlAsView() {}, showSnack() {},
          loadSyncedData() { return Promise.resolve(JSON.stringify(seed)); },
          persistDataSynced(s) { saves.push(s); return Promise.resolve(); },
          openDialog() { return Promise.resolve('Cancel'); }
        };
      }
    });
    const d3 = dom3.window.document;
    const $3 = (s) => d3.querySelector(s);
    await new Promise((r) => setTimeout(r, 300));

    eq($3('.ml-title').textContent, 'Milestone', '标题跟随软件语言（英文，品牌名单数）');
    eq($3('.ml-chip[data-f="all"]').textContent, 'All', '筛选条为英文');
    ok($3('.ml-sub').textContent.indexOf('1 entry') === 0, '副标题用英文单数：' + $3('.ml-sub').textContent);
    ok($3('.ml-hero-label').textContent.indexOf('in') !== -1, '置顶卡片文案为英文');
    ok($3('.ml-item-num i').textContent === 'days' || $3('.ml-item-num i').textContent === 'today',
      '天数单位英文化');
    eq($3('.ml-tag').textContent, 'Birthday', '类型标签英文化');

    // 在插件里手动选中文：界面切换 + 写入同步数据
    $3('#mlSettings').click();
    await new Promise((r) => setTimeout(r, 420));
    ok(!!$3('#sLang button[data-v="zh"]'), '语言列表按已注册语言包生成');
    $3('#sLang button[data-v="zh"]').click();
    await new Promise((r) => setTimeout(r, 240));
    eq($3('.ml-title').textContent, '里程碑', '手动选中文后界面切中文');
    eq($3('.ml-sub').textContent[0], '1', '副标题回到中文计数');
    ok(JSON.parse(saves[saves.length - 1]).settings.lang === 'zh', '语言偏好写入同步数据');

    // 软件里切成英文（languageChange）→ 偏好是 zh，不应被覆盖
    hooks.languageChange && hooks.languageChange({ newLanguage: 'en' });
    await new Promise((r) => setTimeout(r, 120));
    eq($3('.ml-title').textContent, '里程碑', '显式选定语言时不跟随软件语言');

    // 切回自动 → 立刻跟随软件语言（英文）
    $3('#sLang button[data-v="auto"]').click();
    await new Promise((r) => setTimeout(r, 240));
    eq($3('.ml-title').textContent, 'Milestone', '自动模式下跟随软件语言');
    eq(JSON.parse(saves[saves.length - 1]).settings.lang, 'auto', '自动模式写回 auto');
    dom3.window.close();
  }

  console.log('[22] 真实宿主形状：cfg 里没有 lang，只有 getCurrentLanguage() + 钩子载荷');
  {
    // Super Productivity 19.x 的 PluginAPI.cfg 是 { theme, appVersion, platform, isDev }，
    // 语言只能通过 getCurrentLanguage() 拿到；切语言靠 languageChange 载荷。之前只读 cfg.lang，
    // 结果「自动」永远跟着系统语言走 —— 这条用例守住那个回归。
    const seed = {
      version: 1,
      settings: { lang: 'auto', taskTag: 'milestone', hero: true },
      events: [{ id: 'g1', title: 'Mom birthday', kind: 'birthday', calendar: 'solar',
        date: '1990-05-12', repeat: true, color: '#d6336c', note: '' }]
    };
    const hooks = {};
    let hostLang = 'en';
    const dom4 = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://localhost/',
      virtualConsole: vc,
      beforeParse(w4) {
        w4.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        w4.PluginAPI = {
          cfg: { theme: 'light', appVersion: '19.3.1', platform: 'desktop', isDev: false },
          Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged', LANGUAGE_CHANGE: 'languageChange' },
          getCurrentLanguage() { return hostLang; },
          onReady(fn) { setTimeout(fn, 0); },
          registerHook(k, fn) { hooks[k] = fn; },
          showIndexHtmlAsView() {}, showSnack() {},
          loadSyncedData() { return Promise.resolve(JSON.stringify(seed)); },
          persistDataSynced() { return Promise.resolve(); },
          openDialog() { return Promise.resolve('Cancel'); }
        };
      }
    });
    const d4 = dom4.window.document;
    const $4 = (s) => d4.querySelector(s);
    await new Promise((r) => setTimeout(r, 300));

    eq($4('.ml-title').textContent, 'Milestone', '自动模式按 getCurrentLanguage() 取英文');

    // 软件里切成中文：载荷是 { code, newLanguage }，插件要立刻跟着变
    hostLang = 'zh';
    hooks.languageChange && hooks.languageChange({ code: 'zh', newLanguage: 'zh' });
    await new Promise((r) => setTimeout(r, 200));
    eq($4('.ml-title').textContent, '里程碑', '切语言后界面立刻跟随（不依赖 cfg.lang）');
    eq($4('.ml-chip[data-f="all"]').textContent, '全部', '筛选条跟着切中文');

    // 再切回英文
    hostLang = 'en';
    hooks.languageChange && hooks.languageChange({ newLanguage: 'en' });
    await new Promise((r) => setTimeout(r, 200));
    eq($4('.ml-title').textContent, 'Milestone', '再切回英文同样生效');
    dom4.window.close();
  }

  console.log('[22.1] 小月年份的除夕可正常编辑');
  {
    // 2026 年腊月只有 29 天：预设仍以「腊月三十」存，这里验证编辑时不把日控件置空、
    // 预览不误报「日期不存在」，保存后语义与日期都还对
    const seed = {
      version: 1, settings: { lang: 'zh' },
      events: [{
        id: 'cx', title: '除夕', kind: 'festival', calendar: 'lunar', date: '2027-02-05',
        lunar: { year: 2026, month: 12, day: 30, isLeap: false }, repeat: true,
        color: '#c92a2a', note: '', preset: 'chuxi'
      }]
    };
    const vc5 = new VirtualConsole();
    const errs5 = [];
    vc5.on('jsdomError', (e) => errs5.push(e.message));
    const dom5 = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://localhost/',
      virtualConsole: vc5,
      beforeParse(w5) {
        w5.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        w5.__STORE__ = JSON.stringify(seed);
        w5.PluginAPI = {
          Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged', LANGUAGE_CHANGE: 'languageChange' },
          onReady(fn) { setTimeout(fn, 0); },
          registerHook() {}, showIndexHtmlAsView() {}, showSnack() {},
          loadSyncedData() { return Promise.resolve(w5.__STORE__); },
          persistDataSynced(s) { w5.__STORE__ = s; return Promise.resolve(); },
          openDialog() { return Promise.resolve('取消'); }
        };
      }
    });
    const d5 = dom5.window.document;
    const $5 = (s) => d5.querySelector(s);
    await new Promise((r) => setTimeout(r, 300));

    $5('.ml-item[data-id="cx"]').click();
    await new Promise((r) => setTimeout(r, 200));
    eq($5('#mlLayer').hidden, true, '先停在详情，不直接进表单');
    $5('#mlDetailEdit').click();
    await new Promise((r) => setTimeout(r, 220));
    eq($5('#mlLayer').hidden, false, '弹层打开');
    eq($5('#fLD').value, '29', '农历日控件回填为该月最后一天，不留空值');
    ok(!$5('#fLunarPreview').className.includes('warn'), '预览不报「日期不存在」：' + $5('#fLunarPreview').textContent);
    ok($5('#fLunarPreview').textContent.includes('对应公历'), '预览给出对应公历日期');

    $5('#mlSave').click();
    await new Promise((r) => setTimeout(r, 400));
    const saved = JSON.parse(dom5.window.__STORE__).events.filter((e) => e.id === 'cx')[0];
    eq(saved.lunar.day, 30, '仍按腊月三十存储（小月由核心逻辑回落）');
    const occ = Core.resolveLunar(2026, 12, 30, false, 'regular');
    eq(Core.ymd(occ), saved.date, '保存的日期 = 当年实际除夕');
    eq(errs5.length, 0, '无运行时错误');
    dom5.window.close();
  }

  console.log('[22.2] 三天内改说「今天 / 明天 / 后天」');
  {
    const dayAt = (n) => Core.ymd(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + n));
    const mk = (id, n, kind) => ({
      id, title: id, kind: kind || 'countdown', calendar: 'solar', date: dayAt(n),
      repeat: false, color: '#1c7ed6', note: ''
    });
    const seed = {
      version: 1, settings: { lang: 'zh' },
      events: [mk('d0', 0), mk('d1', 1), mk('d2', 2), mk('d3', 3), mk('d5', 5), mk('bd1', 1, 'birthday')]
    };
    const dom6 = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://localhost/',
      virtualConsole: vc,
      beforeParse(w6) {
        w6.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        w6.__STORE__ = JSON.stringify(seed);
        w6.__SAVES__ = [];
        w6.PluginAPI = {
          Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged' },
          onReady(fn) { setTimeout(fn, 0); },
          registerHook() {}, showIndexHtmlAsView() {}, showSnack() {},
          loadSyncedData() { return Promise.resolve(w6.__STORE__); },
          persistDataSynced(s) { w6.__STORE__ = s; return Promise.resolve(); },
          openDialog() { return Promise.resolve('取消'); }
        };
      }
    });
    const d6 = dom6.window.document;
    await new Promise((r) => setTimeout(r, 300));

    const cell = (id) => {
      const box = d6.querySelector('.ml-item[data-id="' + id + '"] .ml-item-num');
      const b = box.querySelector('b');
      const i = box.querySelector('i');
      return { text: b.textContent, word: b.className.includes('is-word'), unit: i ? i.textContent : '' };
    };

    eq(cell('d0').text, '今天', '剩余 0 天 → 今天');
    eq(cell('d1').text, '明天', '剩余 1 天 → 明天');
    eq(cell('d2').text, '后天', '剩余 2 天 → 后天');
    ok(cell('d0').word && cell('d1').word && cell('d2').word, '三条都走文字样式');
    eq(cell('d0').unit + cell('d1').unit + cell('d2').unit, '', '文字状态不再显示单位行');
    eq(cell('d3').text, '3', '剩余 3 天仍显示数字');
    eq(cell('d3').unit, '天', '3 天以上单位说「天」');
    eq(cell('d5').text, '5', '更远的天数照旧');
    eq(cell('bd1').text, '明天', '生日同样适用（剩余语义一致）');

    // 置顶卡片：标签从「距离…还有」换成「…就是 / …就在」，大数字换成文字
    const hero = d6.querySelector('.ml-hero');
    ok(hero.querySelector('.ml-hero-label').textContent.includes('就是'), '今天：标签说「就是」');
    eq(hero.querySelector('.ml-hero-num').textContent, '今天', '今天：大数字位显示文字');
    ok(hero.querySelector('.ml-hero-num').className.includes('--word'), '文字状态带 --word 类，字号单独收过');
    eq(hero.querySelectorAll('.ml-hero-num span').length, 0, '文字状态不显示「剩余天数」副标签');
    dom6.window.close();

    // 英文包：同样的三天内也要说 Today / Tomorrow，不能回落成裸键名
    const seedEn = { version: 1, settings: { lang: 'en' }, events: [mk('e0', 0), mk('e1', 1)] };
    const dom7 = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://localhost/',
      virtualConsole: vc,
      beforeParse(w7) {
        w7.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        w7.__STORE__ = JSON.stringify(seedEn);
        w7.PluginAPI = {
          Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged' },
          onReady(fn) { setTimeout(fn, 0); },
          registerHook() {}, showIndexHtmlAsView() {}, showSnack() {},
          loadSyncedData() { return Promise.resolve(w7.__STORE__); },
          persistDataSynced(s) { w7.__STORE__ = s; return Promise.resolve(); },
          openDialog() { return Promise.resolve('Cancel'); }
        };
      }
    });
    const d7 = dom7.window.document;
    await new Promise((r) => setTimeout(r, 300));
    const enCell = (id) => d7.querySelector('.ml-item[data-id="' + id + '"] .ml-item-num b').textContent;
    eq(enCell('e0'), 'Today', '英文：Today');
    eq(enCell('e1'), 'Tomorrow', '英文：Tomorrow');
    ok(d7.querySelector('.ml-hero-label').textContent.includes('is'), '英文置顶卡片用「… is」句式');
    dom7.window.close();
  }

  console.log('[22.3] 软件语言设成「跟随系统」时不能落到英文');
  {
    // 宿主的坑：语言设成「跟随系统」时 globalConfig.localization.lng 为空，
    // PluginI18nService 的信号量停在默认值 en，getCurrentLanguage() 于是回报 'en'，
    // 而界面其实是跟随系统（中文）。实测症状：中文系统 + 中文软件 -> 插件英文。
    const seed = {
      version: 1,
      settings: { lang: 'auto', taskTag: 'milestone', hero: true },
      events: [{ id: 'sys1', title: '妈妈生日', kind: 'birthday', calendar: 'solar',
        date: '1990-05-12', repeat: true, color: '#d6336c', note: '' }]
    };
    const boot = (lngSetting, hostCur, navLang, lang) => {
      const dom8 = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://localhost/',
        virtualConsole: vc,
        beforeParse(w8) {
          w8.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
          Object.defineProperty(w8.navigator, 'language', { value: navLang, configurable: true });
          w8.PluginAPI = {
            cfg: { theme: 'light', appVersion: '19.3.1', platform: 'desktop', isDev: false },
            Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged', LANGUAGE_CHANGE: 'languageChange' },
            getCurrentLanguage() { return hostCur; },
            getAppState() {
              return Promise.resolve({ tasks: {}, tags: {}, projects: {},
                globalConfig: { localization: { lng: lngSetting } } });
            },
            onReady(fn) { setTimeout(fn, 0); },
            registerHook() {},
            showIndexHtmlAsView() {}, showSnack() {},
            loadSyncedData() { return Promise.resolve(JSON.stringify(seed)); },
            persistDataSynced() { return Promise.resolve(); },
            openDialog() { return Promise.resolve('Cancel'); }
          };
          if (lang) w8.__LANG__ = lang;
        }
      });
      return dom8;
    };

    // 跟随系统（lng 空）+ 中文系统 + 宿主回报 en -> 中文
    const follow = boot('', 'en', 'zh-CN');
    await new Promise((r) => setTimeout(r, 320));
    eq(follow.window.document.querySelector('.ml-title').textContent, '里程碑',
      '跟随系统 + 中文系统 -> 中文界面');
    follow.window.close();

    // 软件里显式选了中文（lng = zh），但 getCurrentLanguage() 还没同步过来（回报 en）+ 英文系统
    // -> 必须靠异步补读的设定值拿到中文，这是只有 getAppState() 能提供的信息
    const forcedZh = boot('zh', 'en', 'en-US');
    await new Promise((r) => setTimeout(r, 320));
    eq(forcedZh.window.document.querySelector('.ml-title').textContent, '里程碑',
      '软件设中文时补读设定值也切到中文');
    forcedZh.window.close();

    // 软件里显式选了英文（lng = en）+ 中文系统 -> 仍然是英文（不猜系统）
    const forcedEn = boot('en', 'en', 'zh-CN');
    await new Promise((r) => setTimeout(r, 320));
    eq(forcedEn.window.document.querySelector('.ml-title').textContent, 'Milestone',
      '软件显式设英文时保持英文');
    forcedEn.window.close();

    // 跟随系统 + 英文系统 -> 英文
    const enSys = boot('', 'en', 'en-US');
    await new Promise((r) => setTimeout(r, 320));
    eq(enSys.window.document.querySelector('.ml-title').textContent, 'Milestone',
      '跟随系统 + 英文系统 -> 英文界面');
    enSys.window.close();
  }

  console.log('[24] 农历开关：默认关闭时不出现任何农历元素');
  {
    // 一个不带 lunar 字段的库 = 新装用户：默认关，界面里连「农历」两个字都不该有
    const seed = {
      version: 1,
      settings: { lang: 'zh' },
      events: [
        { id: 's1', title: '甲生日', kind: 'birthday', calendar: 'solar', date: '1990-05-12',
          repeat: true, color: '#f59f00', note: '' },
        { id: 's2', title: '项目上线', kind: 'countdown', calendar: 'solar', date: '2027-01-01',
          repeat: false, color: '#1c7ed6', note: '' }
      ]
    };
    const dom9 = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://localhost/',
      virtualConsole: vc,
      beforeParse(w) {
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        w.__STORE__ = JSON.stringify(seed);
        w.__SAVES__ = [];
        w.PluginAPI = {
          Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged', LANGUAGE_CHANGE: 'languageChange' },
          onReady(fn) { setTimeout(fn, 0); },
          registerHook() {}, showIndexHtmlAsView() {}, showSnack() {},
          loadSyncedData() { return Promise.resolve(w.__STORE__); },
          persistDataSynced(s) { w.__STORE__ = s; w.__SAVES__.push(s); return Promise.resolve(); },
          openDialog() { return Promise.resolve('取消'); }
        };
      }
    });
    const d9 = dom9.window.document;
    const $9 = (s) => d9.querySelector(s);
    await new Promise((r) => setTimeout(r, 320));

    eq(d9.querySelector('.ml-list').textContent.indexOf('农历'), -1, '列表里没有农历');
    eq($9('.ml-hero-meta').textContent.indexOf('农历'), -1, '置顶卡片没有农历');
    ok(/^\d{4}-\d{2}-\d{2}$/.test($9('.ml-item-sub').textContent.split(' · ')[0]), '列表日期只剩公历：' + $9('.ml-item-sub').textContent);

    // 详情：日期行没有农历，也没有单独的「农历」行
    $9('.ml-item[data-id="s2"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const rows9 = () => Array.from(d9.querySelectorAll('#mlDetailBody .ml-detail-row'));
    const rowOf9 = (k) => {
      const hit = rows9().find((r) => r.querySelector('.ml-detail-k').textContent === k);
      return hit ? hit.querySelector('.ml-detail-v').textContent : null;
    };
    eq(rowOf9('农历'), null, '详情没有农历行');
    ok(rowOf9('目标日期').indexOf('农历') === -1, '详情日期行没有农历：' + rowOf9('目标日期'));
    ok(/2027-01-01/.test(rowOf9('目标日期')), '详情只给公历日期：' + rowOf9('目标日期'));
    $9('#mlDetailBack').click();
    await new Promise((r) => setTimeout(r, 380));

    // 表单：历法与农历控件整块不出现
    $9('#mlAdd').click();
    await new Promise((r) => setTimeout(r, 200));
    eq($9('#fCalendarWrap').hidden, true, '没有历法切换（只剩公历）');
    eq($9('#fSolarWrap').hidden, false, '公历日期照常可选');
    eq($9('#fLunarWrap').hidden, true, '没有农历日期控件');
    // 节日预设：只有公历分组 + 自定义，农历与节气不出现
    d9.querySelector('#fKind button[data-v="festival"]').click();
    await new Promise((r) => setTimeout(r, 60));
    eq(d9.querySelectorAll('#fPresets .ml-preset-group').length, 2, '预设只剩「公历」与「自定义」两组');
    eq(d9.querySelectorAll('#fPresets .ml-preset').length, 8, '预设 = 7 个公历节日 + 自定义');
    eq(d9.querySelector('#fPresets .ml-preset[data-k="chunjie"]'), null, '没有春节等农历预设');
    eq(d9.querySelector('#fPresets .ml-preset[data-k="qingming"]'), null, '没有节气预设');
    $9('#mlCancel').click();
    await new Promise((r) => setTimeout(r, 380));

    // 设置：开关默认关、可以点
    $9('#mlSettings').click();
    await new Promise((r) => setTimeout(r, 200));
    eq($9('#sLunar').checked, false, '设置里农历开关是关的');
    eq($9('#sLunar').disabled, false, '没有农历事项时可以自由切换');
    eq($9('#sLunar').closest('.ml-field').querySelector('.ml-switch-row span').textContent,
      '启用农历系统', '开关文案是「启用农历系统」');
    eq($9('#sLunarHint').hidden, true, '没锁住时不挂说明文字（不再讲日期格式）');

    // 打开 → 日期变成「公历（农历）」，农历预设回来，设置写入同步数据
    $9('#sLunar').click();
    await new Promise((r) => setTimeout(r, 400));
    eq(JSON.parse(dom9.window.__STORE__).settings.lunar, true, '打开状态写入同步数据');
    ok(d9.querySelector('.ml-list').textContent.indexOf('农历') !== -1, '打开后列表出现农历');
    ok($9('.ml-hero-meta').textContent.indexOf('（农历') !== -1, '打开后置顶卡片是「公历（农历）」：' + $9('.ml-hero-meta').textContent);
    ok(/^\d{4}-\d{2}-\d{2}（农历/.test($9('.ml-item-sub').textContent), '公历来源的记录写作「公历（农历）」：' + $9('.ml-item-sub').textContent);

    $9('#mlSetClose').click();
    await new Promise((r) => setTimeout(r, 420));
    $9('#mlAdd').click();
    await new Promise((r) => setTimeout(r, 200));
    eq($9('#fCalendarWrap').hidden, false, '打开后表单又有历法可选');
    d9.querySelector('#fKind button[data-v="festival"]').click();
    await new Promise((r) => setTimeout(r, 60));
    eq(d9.querySelectorAll('#fPresets .ml-preset-group').length, 4, '打开后预设恢复四组（公历/农历/节气/自定义）');
    ok(!!d9.querySelector('#fPresets .ml-preset[data-k="chunjie"]'), '打开后又有春节');
    $9('#mlCancel').click();
    await new Promise((r) => setTimeout(r, 380));
    dom9.window.close();
  }

  console.log('[25] 有农历事项时不允许关闭农历');
  {
    const seed = {
      version: 1,
      settings: { lang: 'zh', lunar: true },
      events: [
        { id: 'l1', title: '妈妈', kind: 'birthday', calendar: 'lunar', date: '1968-05-14',
          lunar: { year: 1968, month: 4, day: 18, isLeap: false }, repeat: true, color: '#d6336c', note: '' }
      ]
    };
    const domA = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://localhost/',
      virtualConsole: vc,
      beforeParse(w) {
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        w.__STORE__ = JSON.stringify(seed);
        w.__SAVES__ = [];
        w.PluginAPI = {
          Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged', LANGUAGE_CHANGE: 'languageChange' },
          onReady(fn) { setTimeout(fn, 0); },
          registerHook() {}, showIndexHtmlAsView() {}, showSnack() {},
          loadSyncedData() { return Promise.resolve(w.__STORE__); },
          persistDataSynced(s) { w.__STORE__ = s; w.__SAVES__.push(s); return Promise.resolve(); },
          openDialog() { return Promise.resolve('取消'); }
        };
      }
    });
    const dA = domA.window.document;
    const $A = (s) => dA.querySelector(s);
    await new Promise((r) => setTimeout(r, 320));

    // 农历来源：农历在前，公历在后
    ok(/^农历四月十八（\d{4}-\d{2}-\d{2}）$/.test($A('.ml-item-sub').textContent),
      '农历来源的记录写作「农历（公历）」：' + $A('.ml-item-sub').textContent);
    ok($A('.ml-hero-meta').textContent.indexOf('（') !== -1, '置顶卡片也是农历（公历）');

    // 数据层自愈：库里写着 lunar:false 但有农历事项 → 仍按显示农历跑
    const selfHeal = Core.normalize({ settings: { lunar: false }, events: seed.events });
    eq(selfHeal.settings.lunar, true, '有农历事项时数据层强制为开');

    $A('#mlSettings').click();
    await new Promise((r) => setTimeout(r, 200));
    eq($A('#sLunar').checked, true, '开关处于打开状态');
    eq($A('#sLunar').disabled, true, '有农历事项时开关被锁住');
    eq($A('#sLunarHint').hidden, false, '锁住时才显示说明');
    ok($A('#sLunarHint').className.indexOf('warn') !== -1, '锁住时给出醒目说明');
    ok($A('#sLunarHint').textContent.indexOf('1') !== -1, '说明里报出农历事项数量');

    // 就算绕过 disabled 改值也不会关掉
    const savesBefore = domA.window.__SAVES__.length;
    $A('#sLunar').checked = false;
    $A('#sLunar').dispatchEvent(new domA.window.Event('change'));
    await new Promise((r) => setTimeout(r, 200));
    eq($A('#sLunar').checked, true, '被改回打开');
    eq(JSON.parse(domA.window.__STORE__).settings.lunar, true, '同步数据仍是打开');
    eq(domA.window.__SAVES__.length, savesBefore, '没有产生写入');
    ok($A('#mlToast').textContent.indexOf('无法关闭') !== -1, '给出「无法关闭」提示：' + $A('#mlToast').textContent);
    domA.window.close();
  }

  console.log('[26] 详情内容没变就不重绘（保住滚动位置）');
  {
    const seed = {
      version: 1,
      settings: { lang: 'zh', lunar: true },
      events: [
        { id: 'd1', title: '妈妈', kind: 'birthday', calendar: 'solar', date: '1968-05-14',
          repeat: true, color: '#d6336c', note: '一段很长的备注\n第二行' },
        { id: 'd2', title: '项目上线', kind: 'countdown', calendar: 'solar', date: '2026-12-01',
          repeat: false, color: '#1c7ed6', note: '' }
      ]
    };
    const domD = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://localhost/',
      virtualConsole: vc,
      beforeParse(w) {
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        w.__STORE__ = JSON.stringify(seed);
        w.__SAVES__ = [];
        w.PluginAPI = {
          Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged' },
          onReady(fn) { setTimeout(fn, 0); },
          registerHook() {}, showIndexHtmlAsView() {}, showSnack() {},
          loadSyncedData() { return Promise.resolve(w.__STORE__); },
          persistDataSynced(s) { w.__STORE__ = s; w.__SAVES__.push(s); return Promise.resolve(); },
          openDialog() { return Promise.resolve('取消'); }
        };
      }
    });
    const dD = domD.window.document;
    const $D = (s) => dD.querySelector(s);
    await new Promise((r) => setTimeout(r, 320));

    $D('.ml-item[data-id="d1"]').click();
    await new Promise((r) => setTimeout(r, 180));
    const first = $D('#mlDetailBody').firstElementChild;
    ok(!!first, '详情已渲染');

    // 切筛选会走一次完整 renderAll，但详情的内容与语言都没变
    dD.querySelectorAll('.ml-chip')[0].click();
    await new Promise((r) => setTimeout(r, 80));
    eq($D('#mlDetailBody').firstElementChild, first, '内容没变就不重写 innerHTML（节点引用不变）');

    // 关闭再打开：内容相同也要重画一次，滚动位置回到顶部
    $D('#mlDetailBack').click();
    await new Promise((r) => setTimeout(r, 420));
    $D('.ml-item[data-id="d1"]').click();
    await new Promise((r) => setTimeout(r, 180));
    ok($D('#mlDetailBody').firstElementChild !== first, '重新打开时重画（滚动位置归零）');
    domD.window.close();
  }

  console.log('[27] 表单开着切语言：下拉跟着换；表单关着时不重建');
  {
    const seed = {
      version: 1,
      settings: { lang: 'auto', lunar: true },
      events: [
        { id: 'l1', title: '妈妈', kind: 'birthday', calendar: 'lunar', date: '1968-05-14',
          lunar: { year: 1968, month: 4, day: 18, isLeap: false }, repeat: true, color: '#d6336c', note: '' }
      ]
    };
    let curLang = 'zh';
    const domL = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://localhost/',
      virtualConsole: vc,
      beforeParse(w) {
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        w.__STORE__ = JSON.stringify(seed);
        w.__SAVES__ = [];
        w.__hooks = {};
        w.PluginAPI = {
          Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged', LANGUAGE_CHANGE: 'languageChange' },
          onReady(fn) { setTimeout(fn, 0); },
          registerHook(k, fn) { w.__hooks[k] = fn; },
          showIndexHtmlAsView() {}, showSnack() {},
          getCurrentLanguage() { return curLang; },
          getAppState() { return Promise.resolve({ globalConfig: { localization: { lng: '' } } }); },
          loadSyncedData() { return Promise.resolve(w.__STORE__); },
          persistDataSynced(s) { w.__STORE__ = s; w.__SAVES__.push(s); return Promise.resolve(); },
          openDialog() { return Promise.resolve('取消'); }
        };
      }
    });
    const dL = domL.window.document;
    const $L = (s) => dL.querySelector(s);
    await new Promise((r) => setTimeout(r, 320));

    ok($L('.ml-title').textContent.indexOf('里程碑') !== -1, '启动是中文：' + $L('.ml-title').textContent);

    $L('#mlAdd').click();
    await new Promise((r) => setTimeout(r, 200));
    eq($L('#fLY').options.length, 201, '年份下拉 1900-2100 共 201 项');
    eq($L('#fLY').firstElementChild.textContent, '1900 年', '年份文案是中文');
    const yearSel = $L('#fLY');
    const yearVal = yearSel.value;

    // 先手选一个非默认颜色：选中态只活在 DOM 上，重建下拉/按钮时不能把它清掉
    const colorBtns = dL.querySelectorAll('#fColors .ml-color');
    const pickIdx = colorBtns.length - 1;
    colorBtns[pickIdx].click();
    const pickedColor = colorBtns[pickIdx].dataset.c;

    // 宿主里切成英文：表单开着，下拉必须跟着换语言（option 文案按语言拼）
    curLang = 'en';
    domL.window.__hooks.languageChange({ code: 'en', newLanguage: 'en' });
    await new Promise((r) => setTimeout(r, 260));
    eq($L('#mlLayer').hidden, false, '表单仍开着');
    eq($L('#fLY'), yearSel, '下拉元素本身没被替换');
    eq($L('#fLY').options.length, 201, '仍然是 201 项');
    eq($L('#fLY').firstElementChild.textContent, '1900', '表单开着切语言：年份文案跟着变英文');
    eq($L('#fLY').value, yearVal, '当前选中的年份保留');
    eq($L('#fColors .ml-color[aria-pressed="true"]').dataset.c, pickedColor, '手选的颜色不被重建清掉');

    $L('#mlCancel').click();
    await new Promise((r) => setTimeout(r, 420));
    const optBefore = $L('#fLY').firstElementChild;

    // 表单关着切回中文：不再白造 201 个 option，等下次开表单时再按新语言建
    curLang = 'zh';
    domL.window.__hooks.languageChange({ code: 'zh', newLanguage: 'zh' });
    await new Promise((r) => setTimeout(r, 260));
    ok($L('.ml-title').textContent.indexOf('里程碑') !== -1, '界面回到中文');
    eq($L('#fLY').firstElementChild, optBefore, '表单关着时切语言不重建年份下拉');

    $L('#mlAdd').click();
    await new Promise((r) => setTimeout(r, 200));
    eq($L('#fLY').firstElementChild.textContent, '1900 年', '再次打开表单时按当前语言重建');
    domL.window.close();
  }

  console.log('[23] 无运行时错误');
  eq(errors.length, 0, '控制台无报错' + (errors.length ? '：\n     ' + errors.join('\n     ') : ''));

  console.log(fail === 0 ? '\n✅ 全部通过' : `\n❌ 失败 ${fail} 项`);
  dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
