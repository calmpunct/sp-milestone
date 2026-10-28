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
  // 固定中文：jsdom 的 navigator.language 是 en-US，不写这一项界面会是英文
  settings: { lang: 'zh' },
  events: [
    { id: 'b1', title: '妈妈生日', kind: 'birthday', calendar: 'lunar', date: '1968-05-14',
      lunar: { year: 1968, month: 4, day: 18, isLeap: false }, repeat: true, color: '#d6336c', note: '' },
    // 出生年取闰年 2000，这样 2 月 29 日运行时这个日期也成立
    { id: 'b2', title: '小米生日', kind: 'birthday', calendar: 'solar', date: '2000-' + TODAY_MD,
      repeat: true, color: '#f59f00', note: '' },
    { id: 'b3', title: '结婚纪念日', kind: 'anniversary', calendar: 'solar', date: '2018-06-16',
      repeat: true, color: '#c92a2a', note: '' },
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
const byId = (id) => document.querySelector('.cd-item[data-id="' + id + '"]');

(async function run() {
  await new Promise((r) => {
    if (document.readyState === 'complete') r();
    else window.addEventListener('load', r);
  });
  await wait(200);

  console.log('[1] 初始渲染');
  eq(document.querySelectorAll('.cd-item').length, 6, '渲染 6 条记录');
  ok($('.cd-hero'), '主视觉卡片存在');
  eq($('.cd-sub').textContent,
    '6 个事项 · ' + (todayCount ? '今天 ' + todayCount + ' 个' : '最近 ' + nearest.r.days + ' 天'),
    '副标题统计');
  ok($('.cd-hero-label').textContent.includes(nearest.e.title), '最近的事项在卡片上');
  eq(document.querySelectorAll('.cd-item.is-today').length, todayCount, '今天条目高亮数量');

  const subs = Array.from(document.querySelectorAll('.cd-item-sub')).map((n) => n.textContent);
  const titles = Array.from(document.querySelectorAll('.cd-item-title em')).map((n) => n.textContent);
  ok(subs.some((t) => t.includes('农历四月十八')), '农历条目显示农历日期');
  ok(titles.some((t) => /（\d+岁）$/.test(t)), '生日名称带年龄（如「小米生日（7岁）」）');
  ok(!subs.some((t) => t.includes('岁')), '年龄不再重复出现在副标题');
  ok(subs.some((t) => t.includes('周年')), '纪念日显示周年');
  eq(document.querySelectorAll('.cd-bell').length, 6, '开启提醒的条目显示铃铛');

  console.log('[1.1] 时间语义与排序');
  const nums = Array.from(document.querySelectorAll('.cd-item')).map((el) => {
    const box = el.querySelector('.cd-item-num');
    return {
      id: el.dataset.id,
      mode: box.className.includes('--remain') ? 'remain' : (box.className.includes('--elapsed') ? 'elapsed' : 'none'),
      days: parseInt(box.querySelector('b').textContent, 10),
      unit: box.querySelector('i').textContent
    };
  });
  const firstElapsed = nums.findIndex((n) => n.mode === 'elapsed');
  ok(firstElapsed > 0, '倒数组排在前面，已过组在后面');
  ok(nums.slice(0, firstElapsed).every((n) => n.mode === 'remain'), '前半段全部是剩余天数');
  ok(nums.slice(firstElapsed).every((n) => n.mode === 'elapsed'), '后半段全部是已过天数');
  ok(nums.slice(0, firstElapsed).every((n, i, a) => i === 0 || a[i - 1].days <= n.days), '剩余天数升序（越近越前）');
  ok(nums.slice(firstElapsed).every((n, i, a) => i === 0 || a[i - 1].days >= n.days), '已过天数降序（越久越前）');
  ok(nums.filter((n) => n.mode === 'remain').every((n) => n.unit === '剩余天数' || n.unit === '就是今天'), '倒数类单位是剩余天数');
  ok(nums.filter((n) => n.mode === 'elapsed').every((n) => n.unit === '已过天数' || n.unit === '就在今天'), '纪念类单位是已过天数');
  eq(nums.find((n) => n.id === 'b3').unit, '已过天数', '纪念日显示已过天数');
  eq(nums.find((n) => n.id === 'b3').mode, 'elapsed', '纪念日归入已过组');
  // 纪念日的已过天数 = 从最初日期到今天
  eq(nums.find((n) => n.id === 'b3').days, Core.diffDays(Core.parseYMD('2018-06-16'), TODAY), '已过天数按原始日期计算');
  eq(nums.find((n) => n.id === 'b2').days, 0, '今天生日剩余 0 天');
  eq(nums.find((n) => n.id === 'b2').unit, '就是今天', '今天用「就是今天」说明');

  console.log('[2] XSS 防护');
  ok(!document.querySelector('.cd-item img'), '注入的 img 未被解析执行');
  ok(document.querySelector('.cd-list').textContent.includes('<img src=x'), '恶意标题作为纯文本渲染');

  console.log('[3] 筛选切换');
  const chips = document.querySelectorAll('.cd-chip');
  chips[1].click();
  await wait(40);
  eq(document.querySelectorAll('.cd-item').length, 2, '生日筛选 2 条');
  eq(chips[1].getAttribute('aria-pressed'), 'true', '筛选按钮激活');
  chips[0].click();
  await wait(40);
  eq(document.querySelectorAll('.cd-item').length, 6, '回到全部');

  console.log('[4] 打开农历条目');
  byId('b1').click();
  await wait(150);
  eq($('#cdLayer').hidden, false, '弹层打开');
  eq($('#fTitle').value, '妈妈生日', '标题已填充');
  eq($('#cdDelete').hidden, false, '编辑态显示删除');
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
  document.querySelectorAll('#fColors .cd-color')[3].click();
  const before = window.__SAVES__.length;
  $('#cdSave').click();
  await wait(450);
  eq(window.__SAVES__.length, before + 1, '触发一次同步写入');
  eq(document.querySelectorAll('.cd-item').length, 6, '条目数不变');
  const saved = JSON.parse(window.__STORE__);
  const mom = saved.events.filter((e) => e.id === 'b1')[0];
  eq(mom.title, '妈妈生日（改正）', '标题已写入');
  eq(mom.calendar, 'lunar', '历法已写入');
  eq(mom.color, Core.COLORS[3], '颜色已写入');
  eq(mom.lunar.month, 5, '农历月份已写入');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(mom.date), '公历日期已同步计算');

  console.log('[8] 每个事项的提醒渠道');
  byId('b4').click();
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
  $('#cdSave').click();
  await wait(450);

  const withRemind = JSON.parse(window.__STORE__).events.filter((e) => e.id === 'b4')[0];
  eq(withRemind.remind.task, false, '任务列表关闭已写入');
  eq(withRemind.remind.snack, true, '提示条开启已写入');
  eq(withRemind.remind.offsets.join(','), '7', '提醒天数已写入');
  eq(withRemind.archived, false, '未归档已写入');
  eq(document.querySelectorAll('.cd-bell').length, 6, '还有一个渠道开着 → 铃铛仍在');

  console.log('[9] 新增记录');
  $('#cdAdd').click();
  await wait(150);
  eq($('#cdLayer').hidden, false, '新增弹层打开');
  eq($('#fTitle').value, '', '新表单标题为空');
  eq($('#cdDelete').hidden, true, '新建态隐藏删除');
  $('#cdSave').click();
  await wait(450);
  eq(document.querySelectorAll('.cd-item').length, 7, '新增成功');
  const saved2 = JSON.parse(window.__STORE__);
  eq(saved2.events[saved2.events.length - 1].title, '生日', '空标题回落为类型名');

  console.log('[10] 删除（用户取消）');
  byId('b4').click();
  await wait(150);
  $('#cdDelete').click();
  await wait(300);
  eq(document.querySelectorAll('.cd-item').length, 7, '取消后不删除');

  console.log('[11] 删除（用户确认）');
  window.__answer = '删除';
  byId('b4').click();
  await wait(150);
  $('#cdDelete').click();
  await wait(400);
  eq(document.querySelectorAll('.cd-item').length, 6, '确认后删除成功');

  console.log('[12] 远程同步');
  const remote = JSON.parse(JSON.stringify(JSON.parse(window.__STORE__)));
  remote.events.push({ id: 'z9', title: '远程新增', kind: 'countdown', calendar: 'solar',
    date: '2027-01-01', repeat: false, color: '#7048e8', note: '' });
  window.__STORE__ = JSON.stringify(remote);
  ok(typeof window.__hooks.persistedDataChanged === 'function', '已注册同步钩子');
  window.__hooks.persistedDataChanged();
  await wait(350);
  ok($('.cd-list').textContent.includes('远程新增'), '远程数据已合并到界面');

  console.log('[13] 分类内新建默认类型');
  const kindOf = () => document.querySelector('#fKind button[aria-pressed="true"]').dataset.v;

  // 在「纪念日」分类点添加，类型默认就是纪念日
  document.querySelector('.cd-chip[data-f="anniversary"]').click();
  await wait(60);
  $('#cdAdd').click();
  await wait(150);
  eq(kindOf(), 'anniversary', '纪念日分类下新建默认选中纪念日');
  eq($('#cdSheetTitle').textContent, '新建纪念日', '标题显示新建纪念日');

  // 仍可手动改成别的类型，标题跟着变
  document.querySelector('#fKind button[data-v="countdown"]').click();
  await wait(60);
  eq(kindOf(), 'countdown', '可手动切换为倒数日');
  eq($('#cdSheetTitle').textContent, '新建倒数日', '标题跟随切换');
  document.querySelector('#fKind button[data-v="anniversary"]').click();
  await wait(60);

  // 保存后落到当前分类，且名称按纯文本存储
  $('#fTitle').value = '相识纪念日';
  $('#cdSave').click();
  await wait(450);
  const created = JSON.parse(window.__STORE__).events.filter((e) => e.title === '相识纪念日')[0];
  ok(!!created, '已保存');
  eq(created.kind, 'anniversary', '保存类型为纪念日');
  eq(created.title, '相识纪念日', '名称不含年龄等展示信息');
  ok($('.cd-list').textContent.includes('相识纪念日'), '新条目出现在当前分类列表');

  // 回到「全部」，新建默认仍是生日
  document.querySelector('.cd-chip[data-f="all"]').click();
  await wait(60);
  $('#cdAdd').click();
  await wait(150);
  eq(kindOf(), 'birthday', '全部视图下新建默认生日');
  eq($('#cdSheetTitle').textContent, '新建生日', '标题显示新建生日');

  // 名称里手输年龄会被清掉，避免渲染时叠加
  $('#fTitle').value = '测试生日（30岁）';
  $('#cdSave').click();
  await wait(450);
  const cleaned = JSON.parse(window.__STORE__).events.filter((e) => /测试生日/.test(e.title))[0];
  eq(cleaned.title, '测试生日', '输入的年龄后缀不写入名称');
  ok($('.cd-list').textContent.includes('测试生日（'), '列表仍显示年龄');

  console.log('[14] 归档');
  ok(!!$('#cdSettings'), '顶栏有设置入口');
  eq(!!$('#cdArchive'), false, '归档不再占用顶栏按钮');
  document.querySelector('.cd-chip[data-f="all"]').click();
  await wait(60);
  const total = document.querySelectorAll('.cd-item').length;
  eq(document.querySelector('.cd-chip[data-f="archive"]').textContent, '归档', '没有归档项时胶囊只显示「归档」');

  // 归档「结婚纪念日」
  byId('b3').click();
  await wait(150);
  eq($('#fArchived').checked, false, '默认未归档');
  $('#fArchived').click();
  await wait(60);
  ok($('#fRemindHint').textContent.includes('已归档'), '归档时说明变为不再提醒');
  $('#cdSave').click();
  await wait(450);

  eq(document.querySelectorAll('.cd-item').length, total - 1, '归档后不在「全部」里显示');
  ok(!byId('b3'), '归档的条目移出当前列表');
  eq(document.querySelector('.cd-chip[data-f="archive"]').textContent, '归档 1', '筛选条显示归档数量');

  // 通过筛选胶囊进入归档视图
  document.querySelector('.cd-chip[data-f="archive"]').click();
  await wait(60);
  eq(document.querySelector('.cd-chip[data-f="archive"]').getAttribute('aria-pressed'), 'true', '归档胶囊进入按下态');
  eq(document.querySelectorAll('.cd-item').length, 1, '归档视图只有归档的事项');
  ok(byId('b3'), '归档的事项在归档视图里');
  ok($('.cd-sub').textContent.includes('已归档'), '副标题说明已归档');
  ok($('#cdHero').innerHTML.includes('cd-hero--empty'), '归档视图用占位卡，不置顶任何事项');
  ok(document.querySelector('.cd-list').textContent.includes('已归档 · 纪念日'), '条目带已归档标签');

  // 归档视图里新建：默认就是归档状态
  $('#cdAdd').click();
  await wait(150);
  eq($('#fArchived').checked, true, '归档视图里新建默认归档');
  $('#cdCancel').click();
  await wait(380);

  // 取消归档 → 回到「全部」
  byId('b3').click();
  await wait(150);
  $('#fArchived').click();
  await wait(40);
  $('#cdSave').click();
  await wait(450);
  eq(document.querySelector('.cd-chip[data-f="archive"]').textContent, '归档', '没有归档项后计数消失');
  eq(document.querySelectorAll('.cd-item').length, 0, '取消归档后归档视图为空');
  document.querySelector('.cd-chip[data-f="all"]').click();
  await wait(60);
  eq(document.querySelectorAll('.cd-item').length, total, '回到全部，条目恢复');

  console.log('[15] 设置与置顶卡片');
  document.querySelector('.cd-chip[data-f="all"]').click();
  await wait(60);
  $('#cdSettings').click();
  await wait(150);
  eq($('#cdSetLayer').hidden, false, '设置面板打开');
  eq($('#sHero').checked, true, '默认开启置顶卡片');
  ok($('#sAbout').textContent.includes('里程碑'), '关于信息显示插件名');
  ok(/v\d+\.\d+\.\d+/.test($('#sAbout').textContent), '关于信息显示版本号');
  $('#cdSetClose').click();
  await wait(420);
  eq($('#cdSetLayer').hidden, true, '设置面板关闭');

  // 置顶卡片跟随当前分区，而不是固定取「全部」的第一条
  ok(!!$('.cd-hero'), '全部视图有置顶卡片');
  const heroId = () => { const h = document.querySelector('.cd-hero'); return h ? h.dataset.id : null; };
  const firstId = () => { const it = document.querySelector('.cd-item'); return it ? it.dataset.id : null; };
  eq(heroId(), firstId(), '全部视图：置顶 = 全部的第一条');

  document.querySelector('.cd-chip[data-f="anniversary"]').click();
  await wait(60);
  ok($('.cd-hero-label').textContent.includes('已经走过'), '纪念日分区：置顶是已过语义');
  eq(heroId(), firstId(), '纪念日分区：置顶 = 该分区第一条');

  document.querySelector('.cd-chip[data-f="birthday"]').click();
  await wait(60);
  ok($('.cd-hero-label').textContent.includes('还有'), '生日分区：置顶是剩余语义');
  eq(heroId(), firstId(), '生日分区：置顶 = 该分区第一条');

  // 关掉开关：卡片消失、列表贴顶，设置写入同步数据
  $('#cdSettings').click();
  await wait(150);
  $('#sHero').click();
  await wait(400);
  eq($('#cdHero').innerHTML, '', '关掉后不渲染置顶卡片');
  eq(JSON.parse(window.__STORE__).settings.hero, false, '开关写入同步数据');

  $('#sHero').click();
  await wait(400);
  ok(!!$('.cd-hero'), '重新打开后卡片回来');
  eq(JSON.parse(window.__STORE__).settings.hero, true, '开关值可恢复');
  $('#cdSetClose').click();
  await wait(420);

  console.log('[16] 空分区占位');
  {
    const seed = {
      version: 4,
      settings: { lang: 'zh', taskProject: '里程碑提醒', hero: true },
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
    d2.querySelector('.cd-chip[data-f="anniversary"]').click();
    await new Promise((r) => setTimeout(r, 120));
    ok(!!d2.querySelector('.cd-hero--empty'), '空分区仍然渲染等高占位卡');
    ok(d2.querySelector('.cd-hero-label').textContent.includes('纪念日'), '占位卡标明当前分区');
    eq(d2.querySelector('.cd-hero-num').textContent.trim(), '—', '占位卡不显示天数');
    ok(d2.querySelector('.cd-hero-meta').textContent.includes('还没有记录'), '占位卡给出提示');
    eq(d2.querySelectorAll('.cd-item').length, 0, '空分区没有条目');
    ok(d2.querySelector('.cd-sub').textContent.includes('这个分类还没有记录'), '副标题说明分类为空');
    ok(d2.querySelector('.cd-list').textContent.includes('添加一个纪念日'), '空态按钮按纪念日新建');
    dom2.window.close();
  }

  console.log('[17] 节日类型：预设与自定义');
  document.querySelector('.cd-chip[data-f="all"]').click();
  await wait(60);
  const beforeFest = document.querySelectorAll('.cd-item').length;

  $('#cdAdd').click();
  await wait(150);
  document.querySelector('#fKind button[data-v="festival"]').click();
  await wait(60);
  eq($('#cdSheetTitle').textContent, '新建节日', '标题切到新建节日');
  eq($('#fPresetWrap').hidden, false, '节日类型显示预设列表');
  eq($('#fArchiveWrap').hidden, true, '节日不显示归档开关（节日每年都会再来）');
  eq($('#fRepeatWrap').hidden, true, '节日不显示「每年重复」开关（强制每年）');
  eq(document.querySelectorAll('#fPresets .cd-preset').length, Core.FESTIVALS.length + 1, '预设按钮 = 全部预设 + 自定义');
  eq(document.querySelector('#fPresets .cd-preset[data-k="zhongqiu"]').getAttribute('aria-pressed'), 'false', '初始未选中任何预设');
  eq(document.querySelector('#fPresets .cd-preset[data-k=""]').getAttribute('aria-pressed'), 'true', '未选预设时「自定义」为按下态');

  // 选中秋：名称、历法、日期、颜色一次填好
  document.querySelector('#fPresets .cd-preset[data-k="zhongqiu"]').click();
  await wait(80);
  eq($('#fTitle').value, '中秋节', '名称自动填入');
  eq(document.querySelector('#fKind button[aria-pressed="true"]').dataset.v, 'festival', '类型仍是节日');
  eq(document.querySelector('#fCalendar button[aria-pressed="true"]').dataset.v, 'lunar', '中秋按农历');
  eq($('#fLM').value, '8', '农历月份 8');
  eq($('#fLD').value, '15', '农历十五');
  eq($('#fDate').value, Core.festivalFields('zhongqiu', new Date()).date, '公历日期按下一次出现算出');
  ok($('#fPresetHint').textContent.includes('农历'), '提示说明按农历计算');
  eq(document.querySelector('#fPresets .cd-preset[data-k="zhongqiu"]').getAttribute('aria-pressed'), 'true', '中秋预设高亮');
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
  eq(document.querySelector('#fPresets .cd-preset[data-k="zhongqiu"]').getAttribute('aria-pressed'), 'true', '切回后仍记住中秋');

  $('#cdSave').click();
  await wait(450);
  eq(document.querySelectorAll('.cd-item').length, beforeFest + 1, '节日已添加');
  const festSaved = JSON.parse(window.__STORE__).events.filter((e) => e.title === '中秋节')[0];
  ok(!!festSaved, '节日已写入数据');
  eq(festSaved.kind, 'festival', '类型为节日');
  eq(festSaved.preset, 'zhongqiu', '预设标识写入');
  eq(festSaved.calendar, 'lunar', '历法写入');
  eq(festSaved.lunar.month + '/' + festSaved.lunar.day, '8/15', '农历八月十五写入');
  eq(festSaved.repeat, true, '节日每年重复');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(festSaved.date), '公历日期已同步算出');

  // 节日筛选 + 展示语义
  document.querySelector('.cd-chip[data-f="festival"]').click();
  await wait(60);
  eq(document.querySelectorAll('.cd-item').length, 1, '节日筛选只有 1 条');
  ok($('.cd-list').textContent.includes('中秋节'), '节日在列表中');
  eq(document.querySelector('.cd-item .cd-tag').textContent, '节日', '条目标签显示节日');
  ok($('.cd-hero-label').textContent.includes('还有'), '节日按剩余天数倒数');
  eq(document.querySelector('.cd-item-num i').textContent === '剩余天数' ||
    document.querySelector('.cd-item-num i').textContent === '就是今天', true, '单位是剩余天数');
  ok($('.cd-sub').textContent.includes('节日'), '副标题按「节日」计数');

  // 自定义节日
  $('#cdAdd').click();
  await wait(150);
  eq(document.querySelector('#fKind button[aria-pressed="true"]').dataset.v, 'festival', '节日分区下新建默认节日');
  eq(document.querySelector('#fPresets .cd-preset[data-k=""]').getAttribute('aria-pressed'), 'true', '新记录默认是自定义');
  eq($('#fCalendarWrap').hidden, false, '自定义时显示历法');
  eq($('#fSolarWrap').hidden, false, '自定义时显示日期');
  $('#fTitle').value = '公司年会';
  $('#fDate').value = '2027-01-20';
  $('#fDate').dispatchEvent(new window.Event('change'));
  await wait(40);
  $('#cdSave').click();
  await wait(450);
  const customFest = JSON.parse(window.__STORE__).events.filter((e) => e.title === '公司年会')[0];
  ok(!!customFest, '自定义节日已保存');
  eq(customFest.kind, 'festival', '自定义节日类型');
  eq(customFest.preset, null, '自定义节日没有预设标识');
  eq(customFest.date, '2027-01-20', '自定义日期保留');
  eq(document.querySelectorAll('.cd-item').length, 2, '节日分区两条');
  document.querySelector('.cd-chip[data-f="all"]').click();
  await wait(60);

  console.log('[18] 预设节日批量添加（多选）');
  const beforeBatch = document.querySelectorAll('.cd-item').length;
  $('#cdAdd').click();
  await wait(150);
  document.querySelector('#fKind button[data-v="festival"]').click();
  await wait(60);

  // 一次勾三个
  document.querySelector('#fPresets .cd-preset[data-k="chunjie"]').click();
  await wait(60);
  document.querySelector('#fPresets .cd-preset[data-k="yuanxiao"]').click();
  await wait(60);
  document.querySelector('#fPresets .cd-preset[data-k="qingming"]').click();
  await wait(60);
  eq(document.querySelectorAll('#fPresets .cd-preset[aria-pressed="true"]').length, 3, '三个预设同时选中');
  eq(document.querySelector('#fPresets .cd-preset[data-k=""]').getAttribute('aria-pressed'), 'false', '多选时「自定义」不再是按下态');
  eq($('#cdSave').textContent, '添加 3 个', '保存按钮显示数量');
  eq($('#fTitleWrap').hidden, true, '多选时隐藏名称（每个节日用自己的名字）');
  eq($('#fColorWrap').hidden, true, '多选时隐藏颜色（各用预设配色）');
  eq($('#fCalendarWrap').hidden, true, '多选时隐藏历法');
  ok($('#fPresetHint').textContent.includes('春节') && $('#fPresetHint').textContent.includes('3 个'), '提示列出已选节日');

  // 再点一次取消选中
  document.querySelector('#fPresets .cd-preset[data-k="yuanxiao"]').click();
  await wait(60);
  eq($('#cdSave').textContent, '添加 2 个', '取消一个后数量跟着变');
  document.querySelector('#fPresets .cd-preset[data-k="yuanxiao"]').click();
  await wait(60);
  eq($('#cdSave').textContent, '添加 3 个', '重新选中恢复');

  $('#cdSave').click();
  await wait(500);
  eq(document.querySelectorAll('.cd-item').length, beforeBatch + 3, '一次加入 3 个节日');

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

  console.log('[19] 倒数日过期删除线');
  eq($('#fRepeatWrap').hidden, true, '节日不显示倒数设置');
  eq($('#fArchiveWrap').hidden, true, '节日不显示归档开关');
  $('#cdAdd').click();
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
  $('#cdSave').click();
  await wait(450);

  const expired = JSON.parse(window.__STORE__).events.filter((e) => e.title === '去年年会')[0];
  ok(!!expired, '过期倒数日已保存');
  eq(expired.repeat, false, '关掉了重新开始倒数');
  eq(byId(expired.id).querySelector('.cd-item-title em').textContent, '去年年会', '名称文字完整');
  ok(!!byId(expired.id).querySelector('.cd-item-name--done span'), '过期倒数日名称加删除线（画在内层 span 上）');
  eq(byId(expired.id).querySelector('.cd-tag').textContent, '过期的倒数日', '过期后标签改为「过期的倒数日」');
  eq(byId(expired.id).querySelector('.cd-item-num i').textContent, '已过天数', '过期后显示已过天数');

  // 设置里关掉删除线
  $('#cdSettings').click();
  await wait(150);
  eq($('#sStrike').checked, true, '删除线开关默认打开');
  $('#sStrike').click();
  await wait(400);
  eq(JSON.parse(window.__STORE__).settings.strikeExpired, false, '开关写入同步数据');
  ok(!byId(expired.id).querySelector('.cd-item-name--done'), '关掉后名称不再划掉');
  eq(byId(expired.id).querySelector('.cd-tag').textContent, '过期的倒数日', '标签仍标明过期（标签不受删除线开关影响）');
  ok(!!byId(expired.id), '条目本身还在');

  $('#sStrike').click();
  await wait(400);
  ok(!!byId(expired.id).querySelector('.cd-item-name--done span'), '重新打开后恢复删除线');
  eq(JSON.parse(window.__STORE__).settings.strikeExpired, true, '开关值可恢复');
  // 生日/纪念日/节日不受影响
  ok(!document.querySelector('.cd-item[data-id="b2"] .cd-item-name--done'), '生日不加删除线');
  eq(document.querySelector('.cd-item[data-id="b2"] .cd-tag').textContent, '生日', '生日的标签不变');
  $('#cdSetClose').click();
  await wait(420);

  console.log('[20] 清除数据缓存（二次确认）');
  {
    const before = JSON.parse(window.__STORE__).events.length;
    ok(before > 0, '清除前有 ' + before + ' 条');
    window.localStorage.setItem('cd-task-map-v1', '{"task_1":"b1"}');
    window.localStorage.setItem('cd-remind-seen', '{"k":1}');
    window.localStorage.setItem('cd-handled-v1', '{"k":1}');

    $('#cdSettings').click();
    await wait(150);
    eq($('#sClear').textContent.trim(), '清除里程碑数据缓存', '设置里有清除按钮');
    ok(/当前共 \d+ 个事项/.test($('#sDataInfo').textContent), '数据概况显示条数：' + $('#sDataInfo').textContent);

    // 第一次确认点「取消」→ 什么都不该发生
    window.__answers = ['取消'];
    $('#sClear').click();
    await wait(200);
    eq(JSON.parse(window.__STORE__).events.length, before, '第一次确认取消后数据不变');
    eq(document.querySelectorAll('.cd-item').length, before, '列表不变');

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
    eq(after.version, 6, '写入的是当前数据格式');
    ok(window.__SAVES__.length > saves, '立即触发了一次写入');
    eq(document.querySelectorAll('.cd-item').length, 0, '列表清空');
    eq($('#cdSetLayer').hidden, true, '清除后关闭设置面板');
    eq(window.localStorage.getItem('cd-task-map-v1'), null, '本机任务映射表已清');
    eq(window.localStorage.getItem('cd-remind-seen'), null, '本机已提示记录已清');
    eq(window.localStorage.getItem('cd-handled-v1'), null, '本机已处理记录已清');

    // 清空后还能继续用
    $('#cdAdd').click();
    await wait(150);
    $('#fTitle').value = '清空后新建';
    $('#fDate').value = '2027-07-07';
    $('#fDate').dispatchEvent(new window.Event('change'));
    await wait(40);
    $('#cdSave').click();
    await wait(450);
    eq(JSON.parse(window.__STORE__).events.length, 1, '清空后可以继续新建');
    eq(document.querySelectorAll('.cd-item').length, 1, '新条目正常显示');
  }

  console.log('[21] 跟随软件语言 / 手动切换');
  {
    // 宿主语言 = 英文，插件语言设为 auto → 界面应为英文
    const seed = {
      version: 6,
      settings: { lang: 'auto', taskProject: 'Milestones', hero: true },
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

    eq($3('.cd-title').textContent, 'Milestones', '标题跟随软件语言（英文）');
    eq($3('.cd-chip[data-f="all"]').textContent, 'All', '筛选条为英文');
    ok($3('.cd-sub').textContent.indexOf('1 entry') === 0, '副标题用英文单数：' + $3('.cd-sub').textContent);
    ok($3('.cd-hero-label').textContent.indexOf('in') !== -1, '置顶卡片文案为英文');
    ok($3('.cd-item-num i').textContent === 'days left' || $3('.cd-item-num i').textContent === 'today',
      '天数单位英文化');
    eq($3('.cd-tag').textContent, 'Birthday', '类型标签英文化');

    // 在插件里手动选中文：界面切换 + 写入同步数据
    $3('#cdSettings').click();
    await new Promise((r) => setTimeout(r, 420));
    ok(!!$3('#sLang button[data-v="zh"]'), '语言列表按已注册语言包生成');
    $3('#sLang button[data-v="zh"]').click();
    await new Promise((r) => setTimeout(r, 240));
    eq($3('.cd-title').textContent, '里程碑', '手动选中文后界面切中文');
    eq($3('.cd-sub').textContent[0], '1', '副标题回到中文计数');
    ok(JSON.parse(saves[saves.length - 1]).settings.lang === 'zh', '语言偏好写入同步数据');

    // 软件里切成英文（languageChange）→ 偏好是 zh，不应被覆盖
    hooks.languageChange && hooks.languageChange({ newLanguage: 'en' });
    await new Promise((r) => setTimeout(r, 120));
    eq($3('.cd-title').textContent, '里程碑', '显式选定语言时不跟随软件语言');

    // 切回自动 → 立刻跟随软件语言（英文）
    $3('#sLang button[data-v="auto"]').click();
    await new Promise((r) => setTimeout(r, 240));
    eq($3('.cd-title').textContent, 'Milestones', '自动模式下跟随软件语言');
    eq(JSON.parse(saves[saves.length - 1]).settings.lang, 'auto', '自动模式写回 auto');
    dom3.window.close();
  }

  console.log('[22] 真实宿主形状：cfg 里没有 lang，只有 getCurrentLanguage() + 钩子载荷');
  {
    // Super Productivity 19.x 的 PluginAPI.cfg 是 { theme, appVersion, platform, isDev }，
    // 语言只能通过 getCurrentLanguage() 拿到；切语言靠 languageChange 载荷。之前只读 cfg.lang，
    // 结果「自动」永远跟着系统语言走 —— 这条用例守住那个回归。
    const seed = {
      version: 6,
      settings: { lang: 'auto', taskProject: 'Milestones', hero: true },
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

    eq($4('.cd-title').textContent, 'Milestones', '自动模式按 getCurrentLanguage() 取英文');

    // 软件里切成中文：载荷是 { code, newLanguage }，插件要立刻跟着变
    hostLang = 'zh';
    hooks.languageChange && hooks.languageChange({ code: 'zh', newLanguage: 'zh' });
    await new Promise((r) => setTimeout(r, 200));
    eq($4('.cd-title').textContent, '里程碑', '切语言后界面立刻跟随（不依赖 cfg.lang）');
    eq($4('.cd-chip[data-f="all"]').textContent, '全部', '筛选条跟着切中文');

    // 再切回英文
    hostLang = 'en';
    hooks.languageChange && hooks.languageChange({ newLanguage: 'en' });
    await new Promise((r) => setTimeout(r, 200));
    eq($4('.cd-title').textContent, 'Milestones', '再切回英文同样生效');
    dom4.window.close();
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
