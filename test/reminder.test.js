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
    version: 2,
    settings: Object.assign({ leapPolicy: 'regular', taskProject: '纪念日提醒' }, settings || {}),
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
  const regs = { sidePanel: 0, menu: 0 };
  const calls = [];

  if (opts.reuse) {
    Object.keys(opts.reuse).forEach((k) => w.localStorage.setItem(k, opts.reuse[k]));
  }

  // 任务表可以跨「重启」复用，模拟宿主持久化
  const host = opts.host || { tasks: {}, projects: {}, seq: 0 };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const api = {
    Hooks: { PERSISTED_DATA_CHANGED: 'persistedDataChanged', TASK_DELETE: 'taskDelete', TASK_COMPLETE: 'taskComplete' },
    hooks: {},
    onReady(fn) { fn(); },
    registerHook(name, fn) { api.hooks[name] = fn; },
    registerSidePanelButton() { regs.sidePanel++; },
    registerMenuEntry() { regs.menu++; },
    showIndexHtmlAsView() {},
    showSnack(cfg) { snacks.push(cfg.msg); },
    loadSyncedData() { return Promise.resolve(JSON.stringify(store)); },
    persistDataSynced() { return Promise.resolve(); },
    log: { warn() {}, info() {}, err() {}, error() {}, log() {} },
    getAppState() {
      return Promise.resolve({ tasks: clone(host.tasks), projects: clone(host.projects) });
    },
    getAllProjects() { return Promise.resolve(Object.keys(host.projects).map((k) => clone(host.projects[k]))); },
    getTasks() { return Promise.resolve(Object.keys(host.tasks).map((k) => clone(host.tasks[k]))); },
    addTask(d) {
      const id = 'task_' + (++host.seq);
      host.tasks[id] = {
        id: id, title: d.title, notes: d.notes || '', dueDay: d.dueDay || null,
        isDone: !!d.isDone, projectId: d.projectId || null, created: host.seq
      };
      calls.push({ op: 'add', id: id });
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
    addProject(d) {
      const id = 'proj_' + (++host.seq);
      host.projects[id] = { id: id, title: d.title, taskIds: [], backlogTaskIds: [] };
      calls.push({ op: 'addProject', id: id });
      return Promise.resolve(id);
    }
  };

  if (opts.noTaskApi) {
    delete api.getAppState;
    delete api.getTasks;
    delete api.addTask;
    delete api.updateTask;
    delete api.deleteTask;
  }

  w.PluginAPI = api;
  w.EventCore = Core;

  // 让启动延迟立刻生效，避免测试等 3.5 秒
  const realSetTimeout = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms) => realSetTimeout(fn, Math.min(ms || 0, 5));

  w.eval(pluginJs);

  return { w, api, host, snacks, regs, calls, dom };
}

const taskList = (host) => Object.keys(host.tasks).map((k) => host.tasks[k]);

(async function run() {
  console.log('[1] 入口注册');
  {
    const { regs } = boot(data([]));
    eq(regs.sidePanel, 1, '注册侧栏按钮');
    eq(regs.menu, 1, '注册菜单项');
  }

  console.log('[2] 首次同步写入任务');
  {
    const e = ev({ id: 'b1', title: '妈妈生日', kind: 'birthday', date: '1971-05-14', repeat: true,
      remind: { task: true, snack: false, offsets: [0, 3] } });
    const { host, calls } = boot(data([e]));
    await wait(150);
    const rows = taskList(host);
    eq(rows.length, 1, '生成 1 条任务');
    eq(rows[0].title, '🎂 妈妈生日（55岁）', '标题带图标与年龄');
    ok(!!rows[0].projectId, '归入项目');
    eq(Object.keys(host.projects).length, 1, '只建 1 个项目');
    eq(Object.keys(host.projects).map((k) => host.projects[k].title)[0], '纪念日提醒', '项目名');
    const d = RT.desiredTask(Core.normalize({ events: [e] }).events[0], new Date());
    eq(rows[0].dueDay, d.dueDay, '到期日 = 该提醒你的那天');
    ok(calls.some((c) => c.op === 'addProject'), '首次创建了项目');
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
      reuse: { 'cd-task-map-v1': first.w.localStorage.getItem('cd-task-map-v1') || '{}' }
    });
    await wait(150);
    eq(taskList(second.host).length, 1, '仍然只有 1 条，没有重复');
    ok(taskList(second.host)[0].title.includes('小米生日（小朋友）'), '标题已更新');
    ok(!second.calls.some((c) => c.op === 'add'), '没有新建');
  }

  console.log('[4] 删除日子 → 任务消失');
  {
    const e = ev({ id: 'c1', title: '项目上线', date: inDays(20), remind: { task: true, snack: false, offsets: [3] } });
    const first = boot(data([e]));
    await wait(150);
    eq(taskList(first.host).length, 1, '先有 1 条');

    const second = boot(data([]), {
      host: first.host,
      reuse: { 'cd-task-map-v1': first.w.localStorage.getItem('cd-task-map-v1') || '{}' }
    });
    await wait(150);
    eq(taskList(second.host).length, 0, '删掉日子后任务被删除');
    ok(second.calls.some((c) => c.op === 'delete'), '确实调用了 deleteTask');
  }

  console.log('[5] 关闭该日子的提醒 → 任务消失');
  {
    const on = ev({ id: 'd1', title: '入职纪念', date: inDays(30), remind: { task: true, snack: false, offsets: [3] } });
    const first = boot(data([on]));
    await wait(150);
    eq(taskList(first.host).length, 1, '先有 1 条');

    const off = Object.assign({}, on, { remind: { task: false, snack: false, offsets: [3] } });
    const second = boot(data([off]), {
      host: first.host,
      reuse: { 'cd-task-map-v1': first.w.localStorage.getItem('cd-task-map-v1') || '{}' }
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
    const map = first.w.localStorage.getItem('cd-task-map-v1') || '{}';

    // 把日子归档：任务应该被删除
    const second = boot(data([Object.assign({}, e, { archived: true })]), {
      host: first.host, reuse: { 'cd-task-map-v1': map }
    });
    await wait(150);
    eq(taskList(second.host).length, 0, '归档后任务被删除');

    // 只留提示条渠道：同样不建任务
    const third = boot(data([Object.assign({}, e, { remind: { task: false, snack: true, offsets: [7] } })]), {
      host: first.host, reuse: { 'cd-task-map-v1': map }
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
          remote_1: { id: 'remote_1', title: d.title, notes: d.notes, dueDay: d.dueDay, isDone: false, projectId: 'p', created: 1 }
        },
        projects: { p: { id: 'p', title: '纪念日提醒', taskIds: [], backlogTaskIds: [] } },
        seq: 5
      }
    });
    await wait(150);
    eq(taskList(host).length, 1, '认领同步来的任务，不重复创建');
    ok(!calls.some((c) => c.op === 'add'), '没有新建');
  }

  console.log('[10] 提示条按每个日子的开关');
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

  console.log('[11] 旧宿主没有任务 API 也不崩溃');
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
    w.PluginAPI = {
      Hooks: { PERSISTED_DATA_CHANGED: 'p', TASK_DELETE: 'd' },
      onReady(fn) { fn(); }, registerHook() {}, registerSidePanelButton() {}, registerMenuEntry() {},
      showIndexHtmlAsView() {}, showSnack() {},
      loadSyncedData() { return Promise.resolve('{broken json'); },
      log: { warn() {}, info() {}, err() {}, error() {}, log() {} }
    };
    w.EventCore = Core;
    const st = w.setTimeout.bind(w);
    w.setTimeout = (fn, ms) => st(fn, Math.min(ms || 0, 5));
    w.eval(pluginJs);
    await wait(150);
    ok(true, '损坏数据静默跳过');
  }

  console.log(fail === 0 ? '\n✅ 全部通过' : `\n❌ 失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
