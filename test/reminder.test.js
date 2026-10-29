/**
 * 宿主侧测试：任务列表投影 + 可选提示条
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
    note: '', pinned: false, remind: { task: true, snack: false, offsets: [0] }
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
  const snacks = [];
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
    showSnack(cfg) { snacks.push(cfg.msg); },
    loadSyncedData() { return Promise.resolve(JSON.stringify(store)); },
    persistDataSynced() { return Promise.resolve(); },
    log: { warn() {}, info() {}, err() {}, error() {}, log() {} },
    getAppState() {
      return Promise.resolve({ tasks: clone(host.tasks), tags: clone(host.tags) });
    },
    getAllTags() { return Promise.resolve(Object.keys(host.tags).map((k) => clone(host.tags[k]))); },
    getTasks() { return Promise.resolve(Object.keys(host.tasks).map((k) => clone(host.tasks[k]))); },
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

  return { w, api, host, snacks, regs, calls, dom };
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
    ok(!!api.hooks.languageChange, '注册语言钩子');
  }

  console.log('[1.1] 切语言不影响入口');
  {
    // 入口名写死，宿主语言是中文还是英文都一样
    const en = boot(data([], { lang: 'auto' }), { lang: 'en' });
    eq(en.regs.menuLabel, 'Milestone', '英文宿主入口名同样是 Milestone');

    // 运行时切语言：宿主没有改名接口，也不该为改名再注册一次或弹提示
    const run = boot(data([], { lang: 'auto' }), { lang: 'zh' });
    await wait(60);
    eq(run.regs.menu, 1, '只注册过一次');
    run.api.getCurrentLanguage = () => 'en';
    run.api.hooks.languageChange({ code: 'en', newLanguage: 'en' });
    await wait(60);
    eq(run.regs.menu, 1, '切语言不重复注册（否则导航会多一个入口）');
    eq(run.regs.menuLabel, 'Milestone', '切语言后入口名照旧');
    eq(run.snacks.length, 0, '不弹「重启改入口名」的提示条：' + JSON.stringify(run.snacks));
  }

  console.log('[2] 首次同步写入任务');
  {
    const e = ev({ id: 'b1', title: '妈妈生日', kind: 'birthday', date: '1971-05-14', repeat: true,
      remind: { task: true, snack: false, offsets: [0, 3] } });
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
      remind: { task: true, snack: false, offsets: [0] } });
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

  console.log('[3.2] 老任务（在旧项目里、没标签）只补标签，不搬项目');
  {
    // 早期版本把任务建在「里程碑提醒」项目里；宿主改 projectId 不会同步项目侧
    // 的 taskIds，所以这里只补标签、projectId 原样保留
    const e = ev({ id: 'p3', title: '老李生日', kind: 'birthday', date: '2020-05-05', repeat: true });
    const norm = Core.normalize({ events: [e] }).events[0];
    const d = RT.desiredTask(norm, new Date());
    const { host, calls } = boot(data([e]), {
      host: {
        tasks: {
          old_1: { id: 'old_1', title: d.title, notes: d.notes, dueDay: d.dueDay,
            isDone: false, projectId: 'legacy_proj', tagIds: [], created: 1 }
        },
        tags: {},
        seq: 5
      }
    });
    await wait(150);
    eq(taskList(host).length, 1, '老任务被认领，不重复创建');
    const t = host.tasks.old_1;
    eq(t.projectId, 'legacy_proj', 'projectId 不动，避免项目侧 taskIds 对不上');
    eq(t.tagIds.length, 1, '补上 milestone 标签');
    ok(calls.some((c) => c.op === 'update' && c.patch && c.patch.tagIds), '通过 updateTask 只写 tagIds');
    ok(!calls.some((c) => c.op === 'update' && 'projectId' in (c.patch || {})), '补丁里没有 projectId');
  }

  console.log('[4] 删除事项 → 任务消失');
  {
    const e = ev({ id: 'c1', title: '项目上线', date: inDays(20), remind: { task: true, snack: false, offsets: [3] } });
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
    const on = ev({ id: 'd1', title: '入职纪念', date: inDays(30), remind: { task: true, snack: false, offsets: [3] } });
    const first = boot(data([on]));
    await wait(150);
    eq(taskList(first.host).length, 1, '先有 1 条');

    const off = Object.assign({}, on, { remind: { task: false, snack: false, offsets: [3] } });
    const second = boot(data([off]), {
      host: first.host,
      reuse: { 'ml-task-map-v1': first.w.localStorage.getItem('ml-task-map-v1') || '{}' }
    });
    await wait(150);
    eq(taskList(second.host).length, 0, '关闭提醒后任务被删除');
  }

  console.log('[6] 归档 / 只开提示条 → 任务消失');
  {
    const e = ev({ id: 'e1', title: '结婚纪念日', kind: 'anniversary', date: '2018-06-16', repeat: true,
      remind: { task: true, snack: false, offsets: [7] } });
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

    // 只留提示条渠道：同样不建任务
    const third = boot(data([Object.assign({}, e, { remind: { task: false, snack: true, offsets: [7] } })]), {
      host: first.host, reuse: { 'ml-task-map-v1': map }
    });
    await wait(150);
    eq(taskList(third.host).length, 0, '关掉任务列表后任务被删除');
  }

  console.log('[7] 任务被外部删除 → 自动重建');
  {
    const e = ev({ id: 'f1', title: '考试', date: inDays(15), remind: { task: true, snack: false, offsets: [3] } });
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
    const e = ev({ id: 'g1', title: '体检', date: inDays(5), remind: { task: true, snack: false, offsets: [0, 1] } });
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
      remind: { task: true, snack: false, offsets: [1] } });
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

  console.log('[10] 提示条按每个事项的开关');
  {
    const mk = (remind, archived) => {
      const e = ev({ id: 'i1', title: '甲', date: inDays(0), remind: remind });
      if (archived) e.archived = true;
      return e;
    };

    const taskOnly = boot(data([mk({ task: true, snack: false, offsets: [0] })]));
    await wait(150);
    eq(taskOnly.snacks.length, 0, '只开任务列表不弹提示条');

    const both = boot(data([mk({ task: true, snack: true, offsets: [0] })]));
    await wait(150);
    eq(both.snacks.length, 1, '两个都开时弹提示条');
    ok(/今天/.test(both.snacks[0] || ''), '文案含「今天」');
    ok(/甲/.test(both.snacks[0] || ''), '文案含名称');

    const snackOnly = boot(data([mk({ task: false, snack: true, offsets: [0] })]));
    await wait(150);
    eq(snackOnly.snacks.length, 1, '只开提示条也能弹');
    eq(taskList(snackOnly.host).length, 0, '只开提示条不建任务');

    const none = boot(data([mk({ task: false, snack: false, offsets: [0] })]));
    await wait(150);
    eq(none.snacks.length, 0, '两个都关不弹');
    eq(taskList(none.host).length, 0, '两个都关不建任务');

    const arch = boot(data([mk({ task: true, snack: true, offsets: [0] }, true)]));
    await wait(150);
    eq(arch.snacks.length, 0, '归档的日子不弹提示条');
    eq(taskList(arch.host).length, 0, '归档的日子不建任务');
  }

  console.log('[11] 宿主未提供任务 API 也不崩溃');
  {
    const e = ev({ id: 'j1', title: '旧版本', date: inDays(0), remind: { task: true, snack: true, offsets: [0] } });
    const { snacks } = boot(data([e]), { noTaskApi: true });
    await wait(150);
    eq(snacks.length, 1, '降级为提示条仍可用');
  }

  console.log('[12] 完成并归档后不重建');
  {
    const e = ev({ id: 'k1', title: '年检', date: inDays(5), remind: { task: true, snack: false, offsets: [0] } });
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

  console.log('[13] 坏数据不崩溃');
  {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'https://localhost/' });
    const w = dom.window;
    const api = {
      Hooks: { PERSISTED_DATA_CHANGED: 'p', TASK_DELETE: 'd' },
      onReady(fn) { fn(); }, onUnload() {}, registerHook() {}, registerSidePanelButton() {}, registerMenuEntry() {},
      showIndexHtmlAsView() {}, showSnack() {},
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
