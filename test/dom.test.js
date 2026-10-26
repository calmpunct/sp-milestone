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
const todayStr = Core.ymd(TODAY);

const SEED = {
  version: 1,
  events: [
    { id: 'b1', title: '妈妈生日', kind: 'birthday', calendar: 'lunar', date: '1968-05-14',
      lunar: { year: 1968, month: 4, day: 18, isLeap: false }, repeat: true, color: '#d6336c', note: '' },
    { id: 'b2', title: '小米生日', kind: 'birthday', calendar: 'solar', date: '2019-10-26',
      repeat: true, color: '#f59f00', note: '' },
    { id: 'b3', title: '结婚纪念日', kind: 'anniversary', calendar: 'solar', date: '2018-06-16',
      repeat: true, color: '#c92a2a', note: '' },
    { id: 'b4', title: '项目上线', kind: 'countdown', calendar: 'solar', date: '2026-12-01',
      repeat: false, color: '#1c7ed6', note: '' },
    { id: 'b5', title: '今天的事', kind: 'anniversary', calendar: 'solar', date: todayStr,
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
    window.PluginAPI = {
      Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged' },
      onReady(fn) { setTimeout(fn, 0); },
      registerHook(k, fn) { window.__hooks[k] = fn; },
      showIndexHtmlAsView() {},
      loadSyncedData() { return Promise.resolve(window.__STORE__); },
      persistDataSynced(s) { window.__STORE__ = s; window.__SAVES__.push(s); return Promise.resolve(); },
      showSnack() {},
      openDialog() { return Promise.resolve(window.__answer); }
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
    '6 个日子 · ' + (todayCount ? '今天 ' + todayCount + ' 个' : '最近 ' + nearest.r.days + ' 天'),
    '副标题统计');
  ok($('.cd-hero-label').textContent.includes(nearest.e.title), '最近的日子在卡片上');
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

  console.log('[8] 每个日子的提醒渠道');
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
  eq(document.querySelectorAll('.cd-item').length, 1, '归档视图只有归档的日子');
  ok(byId('b3'), '归档的日子在归档视图里');
  ok($('.cd-sub').textContent.includes('已归档'), '副标题说明已归档');
  ok($('#cdHero').innerHTML.includes('cd-hero--empty'), '归档视图用占位卡，不置顶任何日子');
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
      settings: { leapPolicy: 'regular', taskProject: '里程碑提醒', hero: true },
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

  console.log('[17] 无运行时错误');
  eq(errors.length, 0, '控制台无报错' + (errors.length ? '：\n     ' + errors.join('\n     ') : ''));

  console.log(fail === 0 ? '\n✅ 全部通过' : `\n❌ 失败 ${fail} 项`);
  dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
