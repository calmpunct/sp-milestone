/**
 * 宿主侧测试：任务列表投影
 * 直接加载 dist/plugin.js，用内存任务表模拟宿主 API。
 *   node test/reminder.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const Core = require('../src/event-core.js');
const RT = require('../src/reminder-tasks.js');
const pluginJs = fs.readFileSync(path.join(ROOT, 'dist', 'plugin.js'), 'utf8');

let fail = 0;
function eq(a, b, label) {
  if (a !== b) { fail++; console.log(`  ✗ ${label}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
}
function ok(c, label) { if (!c) { fail++; console.log('  ✗ ' + label); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TODAY = new Date();
const inDays = (n) => Core.ymd(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + n));

function ev(o) {
  return Object.assign({
    id: 'x' + Math.random().toString(36).slice(2, 7),
    title: 'T', kind: 'countdown', calendar: 'solar',
    date: inDays(10), lunar: null, repeat: false, color: '#e8590c',
    note: '', pinned: false, remind: { task: true, offsets: [0] }
  }, o);
}

function data(events, settings) {
  return {
    version: 1,
    // 固定中文文案（jsdom 的 navigator.language 是 en-US）
    settings: Object.assign({ lang: 'zh', taskTag: 'milestone' }, settings || {}),
    events: events
  };
}

/**
 * 起一个假宿主
 * @param {object} store 插件同步数据
 * @param {object} opts  { host, reuse, noTaskApi }
 */
function boot(store, opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://localhost/'
  });
  const w = dom.window;
  const regs = { sidePanel: 0, menu: 0, sideLabel: '', menuLabel: '' };
  const calls = [];

  if (opts.reuse) {
    Object.keys(opts.reuse).forEach((k) => w.localStorage.setItem(k, opts.reuse[k]));
  }

  // 任务表可以跨「重启」复用，模拟宿主持久化
  const host = opts.host || { tasks: {}, tags: {}, seq: 0 };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const api = {
    Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged', TASK_DELETE: 'taskDelete', TASK_COMPLETE: 'taskComplete', LANGUAGE_CHANGE: 'languageChange' },
    hooks: {},
    onReady(fn) { fn(); }, onUnload() {},
    registerHook(name, fn) { api.hooks[name] = fn; },
    registerSidePanelButton(cfg) { regs.sidePanel++; regs.sideLabel = cfg && cfg.label; },
    registerMenuEntry(cfg) { regs.menu++; regs.menuLabel = cfg && cfg.label; },
    showIndexHtmlAsView() {},
    loadSyncedData() { return Promise.resolve(JSON.stringify(store)); },
    persistDataSynced() { return Promise.resolve(); },
    log: { warn() {}, info() {}, err() {}, error() {}, log() {} },
    getAppState() {
      return Promise.resolve({ tasks: clone(host.tasks), tags: clone(host.tags) });
    },
    getAllTags() { return Promise.resolve(Object.keys(host.tags).map((k) => clone(host.tags[k]))); },
    getTasks() { return Promise.resolve(Object.keys(host.tasks).map((k) => clone(host.tasks[k]))); },
    // 归档任务：跨设备判断「这一轮已经做完了」要用（见 plugin-main 的 4.0）
    getArchivedTasks() {
      return Promise.resolve(Object.keys(host.archived || {}).map((k) => clone(host.archived[k])));
    },
    addTask(d) {
      const id = 'task_' + (++host.seq);
      host.tasks[id] = {
        id: id, title: d.title, notes: d.notes || '', dueDay: d.dueDay || null,
        isDone: !!d.isDone, projectId: d.projectId || null,
        tagIds: Array.isArray(d.tagIds) ? d.tagIds.slice() : [], created: host.seq
      };
      calls.push({ op: 'add', id: id, tagIds: host.tasks[id].tagIds });
      return Promise.resolve(id);
    },
    updateTask(id, patch) {
      if (!host.tasks[id]) return Promise.reject(new Error('no task'));
      Object.assign(host.tasks[id], patch);
      calls.push({ op: 'update', id: id, patch: patch });
      return Promise.resolve();
    },
    deleteTask(id) {
      delete host.tasks[id];
      calls.push({ op: 'delete', id: id });
      return Promise.resolve();
    },
    addTag(d) {
      const id = 'tag_' + (++host.seq);
      host.tags[id] = { id: id, title: d.title, taskIds: [] };
      calls.push({ op: 'addTag', id: id, title: d.title });
      return Promise.resolve(id);
    }
  };

  if (opts.lang) api.getCurrentLanguage = () => opts.lang;

  if (opts.noTaskApi) {
    delete api.getAppState;
    delete api.getTasks;
    delete api.addTask;
    delete api.updateTask;
    delete api.deleteTask;
  }

  w.EventCore = Core;

  // 让启动延迟立刻生效，避免测试等 3.5 秒
  const realSetTimeout = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms) => realSetTimeout(fn, Math.min(ms || 0, 5));

  runPlugin(w, api, pluginJs);

  return { w, api, host, regs, calls, dom };
}

/**
 * 按真实宿主的方式执行 plugin.js。
 * 宿主是 new Function('plugin', 'PluginAPI', code)：API 是**函数参数**，
 * 不是 window 上的属性。以前测试直接挂 window.PluginAPI，掩盖了
 * 「只认 window → 入口/钩子全部注册不上」这个 bug，所以这里必须照抄宿主写法。
 */
function runPlugin(w, api, code) {
  const fn = new w.Function('plugin', 'PluginAPI', code);
  fn(api, api);
}

const taskList = (host) => Object.keys(host.tasks).map((k) => host.tasks[k]);

(async function run() {
  console.log('[1] 入口注册');
  {
    const { regs, api } = boot(data([]), { lang: 'zh' });
    eq(regs.menu, 1, '注册左侧导航菜单项');
    eq(regs.menuLabel, 'Milestone', '入口名固定为 Milestone（不随语言变）');
    // 顶栏那排（添加任务 / 开始专注 / 同步）不需要重复的插件按钮
    eq(regs.sidePanel, 0, '不注册顶栏侧栏按钮');
    // 钩子同样走 P()：API 拿不到时连钩子都挂不上，提醒功能会整条静默失效
    ok(!!api.hooks.persistedDataChanged, '注册同步钩子');
    // 语言锁定后宿主切语言与任务文案无关，这个钩子不再需要注册
    ok(!api.hooks.languageChange, '不注册语言钩子');
  }

  console.log('[1.1] 语言只看同步数据，不看宿主');
  {
    // 数据里写中文，宿主是英文：任务标题仍然是中文（否则每台设备各按自己系统语言写）
    const zhData = boot(data([], { lang: 'zh' }), { lang: 'en' });
    eq(zhData.regs.menuLabel, 'Milestone', '入口名固定为 Milestone');

    const e = ev({ id: 'q1', title: '体检', kind: 'birthday', date: '1990-05-12', repeat: true,
      remind: { task: true, offsets: [0] } });
    const zh = boot(data([e], { lang: 'zh' }), { lang: 'en' });
    await wait(200);
    ok(taskList(zh.host)[0].title.indexOf('生日') !== -1, '数据 lang=zh → 中文标题：' + taskList(zh.host)[0].title);

    const en = boot(data([e], { lang: 'en' }), { lang: 'zh' });
    await wait(200);
    ok(/birthday/.test(taskList(en.host)[0].title), '数据 lang=en → 英文标题：' + taskList(en.host)[0].title);
  }

  console.log('[2] 首次同步写入任务');
  {
    const e = ev({ id: 'b1', title: '妈妈生日', kind: 'birthday', date: '1971-05-14', repeat: true,
      remind: { task: true, offsets: [0, 3] } });
    const { host, calls } = boot(data([e]));
    await wait(150);
    const rows = taskList(host);
    eq(rows.length, 1, '生成 1 条任务');
    eq(rows[0].title, '🎂 妈妈生日（56岁）', '标题带图标与年龄');
    // 不再建项目：不给 projectId，宿主落收件箱
    eq(rows[0].projectId, null, '任务落收件箱（没有 projectId）');
    eq(rows[0].tagIds.length, 1, '带 1 个标签');
    eq(Object.keys(host.tags).length, 1, '只建 1 个标签');
    eq(host.tags[rows[0].tagIds[0]].title, 'milestone', '标签名 milestone');
    eq(rows[0].tagIds[0], Object.keys(host.tags)[0], 'tagIds 指向新建的标签');
    const d = RT.desiredTask(Core.normalize({ events: [e] }).events[0], new Date());
    eq(rows[0].dueDay, d.dueDay, '到期日 = 该提醒你的那天');
    ok(calls.some((c) => c.op === 'addTag'), '首次创建了标签');
    ok(!calls.some((c) => c.op === 'add' && c.tagIds.length !== 1), '新任务一律带标签');
  }

  console.log('[3] 改名只更新不新增');
  {
    const e1 = ev({ id: 'b2', title: '小米生日', kind: 'birthday', date: '2019-11-08', repeat: true,
      remind: { task: true, offsets: [0] } });
    const first = boot(data([e1]));
    await wait(150);
    eq(taskList(first.host).length, 1, '先有 1 条');

    const e2 = Object.assign({}, e1, { title: '小米生日（小朋友）' });
    const second = boot(data([e2]), {
      host: first.host,
      reuse: { 'ml-task-map-v1': first.w.localStorage.getItem('ml-task-map-v1') || '{}' }
    });
    await wait(150);
    eq(taskList(second.host).length, 1, '仍然只有 1 条，没有重复');
    ok(taskList(second.host)[0].title.includes('小米生日（小朋友）'), '标题已更新');
    ok(!second.calls.some((c) => c.op === 'add'), '没有新建');
  }

  console.log('[3.1] 标签已存在时复用，不重复创建');
  {
    // 标签已存在（首次运行之后都是如此）时必须命中已有标签 id，
    // 否则每轮对账都会新建一个同名标签，标签列表里很快就堆满 milestone
    const e1 = ev({ id: 'p1', title: '小林生日', kind: 'birthday', date: '2020-03-03', repeat: true });
    const first = boot(data([e1]));
    await wait(150);
    const tagId = Object.keys(first.host.tags)[0];
    ok(!!tagId, '首次运行建了标签');

    const e2 = ev({ id: 'p2', title: '老张生日', kind: 'birthday', date: '2020-04-04', repeat: true });
    const second = boot(data([e1, e2]), {
      host: first.host,
      reuse: { 'ml-task-map-v1': first.w.localStorage.getItem('ml-task-map-v1') || '{}' }
    });
    await wait(200);
    const added = taskList(second.host).filter((t) => t.title.indexOf('老张') !== -1);
    eq(added.length, 1, '标签已存在时新增 1 条任务');
    eq(added[0] && added[0].tagIds[0], tagId, '新任务指向已有标签');
    eq(Object.keys(second.host.tags).length, 1, '不会重复建标签');
    ok(!second.calls.some((c) => c.op === 'addTag'), '没有再调 addTag');
  }

  console.log('[3.2] 用户摘掉标签就尊重它，不巡视全场补回来');
  {
    // 任务本身（标题/备注/到期日）都还对得上，只是标签被用户清掉了。
    // 不做「每轮扫一遍补标签」—— 那是跟用户抢设置，而且会制造无意义的写入。
    const e = ev({ id: 'p3', title: '老李生日', kind: 'birthday', date: '2020-05-05', repeat: true });
    const norm = Core.normalize({ events: [e] }).events[0];
    const d = RT.desiredTask(norm, new Date());
    const { host, calls } = boot(data([e]), {
      host: {
        tasks: {
          old_1: { id: 'old_1', title: d.title, notes: d.notes, dueDay: d.dueDay,
            isDone: false, projectId: null, tagIds: [], created: 1 }
        },
        tags: {},
        seq: 5
      }
    });
    await wait(150);
    eq(taskList(host).length, 1, '任务被认领，不重复创建');
    eq(host.tasks.old_1.tagIds.length, 0, '标签被用户摘掉后不强行补回');
    ok(!calls.some((c) => c.op === 'update'), '没有产生任何写入');
  }

  console.log('[4] 删除事项 → 任务消失');
  {
    const e = ev({ id: 'c1', title: '项目上线', date: inDays(20), remind: { task: true, offsets: [3] } });
    const first = boot(data([e]));
    await wait(150);
    eq(taskList(first.host).length, 1, '先有 1 条');

    const second = boot(data([]), {
      host: first.host,
      reuse: { 'ml-task-map-v1': first.w.localStorage.getItem('ml-task-map-v1') || '{}' }
    });
    await wait(150);
    eq(taskList(second.host).length, 0, '删掉日子后任务被删除');
    ok(second.calls.some((c) => c.op === 'delete'), '确实调用了 deleteTask');
  }

  console.log('[5] 关闭该事项的提醒 → 任务消失');
  {
    const on = ev({ id: 'd1', title: '入职纪念', date: inDays(30), remind: { task: true, offsets: [3] } });
    const first = boot(data([on]));
    await wait(150);
    eq(taskList(first.host).length, 1, '先有 1 条');

    const off = Object.assign({}, on, { remind: { task: false, offsets: [3] } });
    const second = boot(data([off]), {
      host: first.host,
      reuse: { 'ml-task-map-v1': first.w.localStorage.getItem('ml-task-map-v1') || '{}' }
    });
    await wait(150);
    eq(taskList(second.host).length, 0, '关闭提醒后任务被删除');
  }

  console.log('[6] 归档 / 关掉提醒 → 任务消失');
  {
    const e = ev({ id: 'e1', title: '结婚纪念日', kind: 'anniversary', date: '2018-06-16', repeat: true,
      remind: { task: true, offsets: [7] } });
    const first = boot(data([e]));
    await wait(150);
    eq(taskList(first.host).length, 1, '先有 1 条');
    const map = first.w.localStorage.getItem('ml-task-map-v1') || '{}';

    // 把日子归档：任务应该被删除
    const second = boot(data([Object.assign({}, e, { archived: true })]), {
      host: first.host, reuse: { 'ml-task-map-v1': map }
    });
    await wait(150);
    eq(taskList(second.host).length, 0, '归档后任务被删除');

    // 关掉提醒开关：同样不建任务
    const third = boot(data([Object.assign({}, e, { remind: { task: false, offsets: [7] } })]), {
      host: first.host, reuse: { 'ml-task-map-v1': map }
    });
    await wait(150);
    eq(taskList(third.host).length, 0, '关掉提醒后任务被删除');
  }

  console.log('[7] 任务被外部删除 → 自动重建');
  {
    const e = ev({ id: 'f1', title: '考试', date: inDays(15), remind: { task: true, offsets: [3] } });
    const first = boot(data([e]));
    await wait(150);
    eq(taskList(first.host).length, 1, '先有 1 条');

    // 模拟用户手动删掉任务
    taskList(first.host).forEach((t) => delete first.host.tasks[t.id]);
    // 再触发一次对账（相当于下一次启动 / 定时检查）
    if (first.api.hooks.persistedDataChanged) first.api.hooks.persistedDataChanged({});
    await wait(250);
    eq(taskList(first.host).length, 1, '被删的任务自动重建，提醒不丢');
  }

  console.log('[8] 本轮已完成 → 不复活');
  {
    const e = ev({ id: 'g1', title: '体检', date: inDays(5), remind: { task: true, offsets: [0, 1] } });
    const first = boot(data([e]));
    await wait(150);
    eq(taskList(first.host).length, 1, '先有 1 条');

    taskList(first.host).forEach((t) => { t.isDone = true; });
    if (first.api.hooks.persistedDataChanged) first.api.hooks.persistedDataChanged({});
    await wait(250);
    eq(taskList(first.host).length, 1, '仍然只有 1 条');
    eq(taskList(first.host)[0].isDone, true, '保持完成态，不会突然变回未完成');
    const want = RT.desiredTask(Core.normalize({ events: [e] }).events[0], new Date());
    eq(taskList(first.host)[0].dueDay, want.dueDay, '到期日未被改动');
  }

  console.log('[9] 另一台设备同步来的任务不重复创建');
  {
    const e = ev({ id: 'h1', title: '生日会', kind: 'birthday', date: '2000-03-08', repeat: true,
      remind: { task: true, offsets: [1] } });
    const norm = Core.normalize({ events: [e] }).events[0];
    const d = RT.desiredTask(norm, new Date());
    const { host, calls } = boot(data([e]), {
      host: {
        tasks: {
          remote_1: { id: 'remote_1', title: d.title, notes: d.notes, dueDay: d.dueDay, isDone: false, projectId: null, tagIds: [], created: 1 }
        },
        tags: {},
        seq: 5
      }
    });
    await wait(150);
    eq(taskList(host).length, 1, '认领同步来的任务，不重复创建');
    ok(!calls.some((c) => c.op === 'add'), '没有新建');
  }

  console.log('[10] 宿主未提供任务 API 也不崩溃');
  {
    const e = ev({ id: 'j1', title: '旧版本', date: inDays(0), remind: { task: true, offsets: [0] } });
    boot(data([e]), { noTaskApi: true });
    await wait(150);
    ok(true, '没有任务 API 时静默跳过，不抛异常');
  }

  console.log('[11] 完成并归档后不重建');
  {
    const e = ev({ id: 'k1', title: '年检', date: inDays(5), remind: { task: true, offsets: [0] } });
    const first = boot(data([e]));
    await wait(150);
    const t = taskList(first.host)[0];
    ok(!!t, '先生成任务');

    // 模拟宿主里「勾选完成」→ 触发 TASK_COMPLETE
    if (first.api.hooks.taskComplete) first.api.hooks.taskComplete({ taskId: t.id, task: t });
    // 用户随后归档，任务从列表消失
    delete first.host.tasks[t.id];
    if (first.api.hooks.persistedDataChanged) first.api.hooks.persistedDataChanged({});
    await wait(250);
    eq(taskList(first.host).length, 0, '已完成过的这一轮不再重新生成');
  }

  console.log('[12] 另一台设备勾完并归档 → 本机不再重建');
  {
    // 本机是新设备：localStorage 空，没有 ml-handled-v1；
    // 任务已被另一端完成并归档，所以 getAppState() 里看不到它。
    // 只靠本机 handled 记录时这里会重新建出一条（PR 审阅指出的跨设备复活）。
    const e = ev({ id: 'z1', title: '还款', date: inDays(3), remind: { task: true, offsets: [0] } });
    const norm = Core.normalize({ events: [e] }).events[0];
    const d = RT.desiredTask(norm, new Date());
    const archived = {
      old_1: { id: 'old_1', title: d.title, notes: d.notes, dueDay: d.dueDay, isDone: true, created: 1 }
    };
    const { host, calls, w } = boot(data([e]), { host: { tasks: {}, tags: {}, seq: 5, archived } });
    await wait(200);
    eq(taskList(host).length, 0, '本轮已完成 → 不再生成提醒');
    ok(!calls.some((c) => c.op === 'add'), '没有新建任务');
    // 命中后记进本机已处理表，下一轮不必再翻归档
    ok(!!w.localStorage.getItem('ml-handled-v1'), '补记本机已处理（下轮不再查归档）');
  }

  console.log('[13] 归档的是上一个周期 → 该提醒还是要提醒');
  {
    const e = ev({ id: 'z2', title: '年检', date: inDays(4), remind: { task: true, offsets: [0] } });
    const archived = {
      old_2: {
        id: 'old_2', title: '⏳ 年检', isDone: true, created: 1,
        notes: '倒数日\n提前 0 天提醒\n' + RT.markLine('z2', '2020-01-01', 'zzz')
      }
    };
    const { host, calls } = boot(data([e]), { host: { tasks: {}, tags: {}, seq: 5, archived } });
    await wait(200);
    eq(taskList(host).length, 1, '旧周期的归档不挡新周期');
    ok(calls.some((c) => c.op === 'add'), '正常新增');
  }

  console.log('[14] 两台设备（宿主语言不同）不再互相改写文案');
  {
    // 语言锁在同步数据里（zh），另一台设备的宿主界面是英文 —— 它不该把文案改成英文。
    // 这是当初「标题备注互相覆盖」的根因，现在由「语言只有一个来源」直接消除。
    const e = ev({ id: 'y1', title: '签证到期', date: inDays(12), remind: { task: true, offsets: [3] } });
    const first = boot(data([e], { lang: 'zh' }), { lang: 'zh' });
    await wait(200);
    const id = taskList(first.host)[0] && taskList(first.host)[0].id;
    ok(!!id, '中文设备先生成任务');
    const before = first.host.tasks[id].title;
    const notesBefore = first.host.tasks[id].notes;

    const second = boot(data([e], { lang: 'zh' }), {
      host: first.host,
      lang: 'en',
      reuse: { 'ml-task-map-v1': first.w.localStorage.getItem('ml-task-map-v1') || '{}' }
    });
    await wait(300);
    eq(first.host.tasks[id].title, before, '英文宿主的设备不改写标题');
    eq(first.host.tasks[id].notes, notesBefore, '也不改写备注');
    ok(!second.calls.some((c) => c.op === 'update' && c.patch && ('title' in c.patch || 'notes' in c.patch)),
      '没有任何文案写入');

    // 文案被外部改坏（比如旧版本写过英文）：下一轮直接按数据里的语言修回来，
    // 标题与备注必须一起修好 —— 不能出现「标题换了、备注还是旧的」。
    Core.setLang('en');
    const en = RT.desiredTask(Core.normalize({ events: [e] }).events[0], new Date());
    Core.setLang('zh');
    ok(en.title !== before || en.notes !== notesBefore, '英文文案与中文不同（前提成立）');
    first.host.tasks[id].title = en.title;
    first.host.tasks[id].notes = en.notes;

    first.api.hooks.persistedDataChanged({});
    await wait(300);
    eq(first.host.tasks[id].title, before, '标题修回中文');
    eq(first.host.tasks[id].notes, notesBefore, '备注同时修回中文（不是只改标题）');
  }

  console.log('[15] 坏数据不崩溃');
  {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'https://localhost/' });
    const w = dom.window;
    const api = {
      Hooks: { PERSISTED_DATA_CHANGED: 'p', TASK_DELETE: 'd' },
      onReady(fn) { fn(); }, onUnload() {}, registerHook() {}, registerSidePanelButton() {}, registerMenuEntry() {},
      showIndexHtmlAsView() {},
      loadSyncedData() { return Promise.resolve('{broken json'); },
      log: { warn() {}, info() {}, err() {}, error() {}, log() {} }
    };
    w.EventCore = Core;
    const st = w.setTimeout.bind(w);
    w.setTimeout = (fn, ms) => st(fn, Math.min(ms || 0, 5));
    runPlugin(w, api, pluginJs);
    await wait(150);
    ok(true, '损坏数据静默跳过');
  }

  console.log(fail === 0 ? '\n✅ 全部通过' : `\n❌ 失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
