/* ============================================================
 * 里程碑 — 宿主侧逻辑
 *
 * 两条提醒通道，都是「每个日子各自选择」的：
 *   1. 任务列表投影：该日子开着「加入任务列表」时，把下一次提醒写成一条任务
 *   2. 提示条：该日子开着「打开应用时弹提示条」时，应用启动/跨天检查时弹 snack
 *
 * 一致性策略：插件数据是唯一真相，任务只是投影。每次对账做全量 diff
 * （新增 / 更新 / 删除），因此删事件、改日期、关掉某天的任务提醒、归档，
 * 都会自动收敛，不需要在删除路径上手写「记得把任务也删掉」。
 * ============================================================ */
(function () {
  'use strict';

  var SEEN_KEY = 'cd-remind-seen';
  var MAP_KEY = 'cd-task-map-v1';
  var DONE_KEY = 'cd-handled-v1';
  var CHECK_EVERY = 10 * 60 * 1000; // 10 分钟复查一次，覆盖跨午夜场景
  var KEEP_DAYS = 120;
  var DONE_KEEP_DAYS = 800;         // 已处理记录保留到下一个年度周期，防止归档后被重建
  var REBUILD_DELAY = 1500;         // 任务被外部删除后延迟重建，合并连续删除
  var MAX_TASKS = 200;              // 安全阀：避免异常数据一次灌爆任务列表

  var dataCache = null;
  var timer = null;
  var rebuildTimer = null;
  var stopped = false;
  var reconciling = false;
  var pendingReason = null;
  var projectIdCache = null;

  // 上一次解析过的原始数据：内容没变就不重复 JSON.parse + normalize
  var rawKey = '';
  var rawValue = null;

  // 对账过程中自己删掉的任务：宿主随后投递的 TASK_DELETE 不应该再触发一轮重建
  var selfDeleted = Object.create(null);
  var SELF_DELETE_TTL = 8000;

  function markSelfDelete(id) {
    if (!id) return;
    var now = Date.now();
    selfDeleted[id] = now;
    var keys = Object.keys(selfDeleted);
    if (keys.length > 64) {
      for (var i = 0; i < keys.length; i++) {
        if (now - selfDeleted[keys[i]] > SELF_DELETE_TTL) delete selfDeleted[keys[i]];
      }
    }
  }

  function unmarkSelfDelete(id) {
    if (id) delete selfDeleted[id];
  }

  function isSelfDelete(id) {
    var ts = selfDeleted[id];
    if (!ts) return false;
    if (Date.now() - ts > SELF_DELETE_TTL) { delete selfDeleted[id]; return false; }
    return true;
  }

  function P() {
    return window.PluginAPI || null;
  }

  function openView() {
    try {
      var api = P();
      if (api && typeof api.showIndexHtmlAsView === 'function') api.showIndexHtmlAsView();
    } catch (e) { /* 旧版本宿主不支持全页视图 */ }
  }

  function registerEntries() {
    var api = P();
    if (!api) return;

    try {
      if (typeof api.registerSidePanelButton === 'function') {
        api.registerSidePanelButton({ label: '里程碑', icon: 'event', onClick: openView });
      }
    } catch (e) { /* ignore */ }

    try {
      if (typeof api.registerMenuEntry === 'function') {
        api.registerMenuEntry({ label: '里程碑', icon: 'event', onClick: openView });
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 数据 ---------------- */

  function loadData() {
    var api = P();
    if (!api || typeof api.loadSyncedData !== 'function') {
      return Promise.reject(new Error('API 不可用'));
    }
    return Promise.resolve(api.loadSyncedData()).then(function (raw) {
      var isStr = typeof raw === 'string';
      var key = isStr ? raw : '';
      // 同步数据没变化时直接复用上次的规范化结果（10 分钟一轮的定时对账常走这条）
      if (key && rawValue && rawKey === key) return rawValue;

      var data;
      if (!raw) {
        data = EventCore.normalize(null);
      } else if (!isStr) {
        data = EventCore.normalize(raw);
      } else {
        try {
          data = EventCore.normalize(JSON.parse(raw));
        } catch (e) {
          data = EventCore.normalize(null);
        }
      }
      rawKey = key;
      rawValue = data;
      return data;
    }, function () { return EventCore.normalize(null); });
  }

  function watchData() {
    var api = P();
    if (!api || typeof api.registerHook !== 'function' || !api.Hooks) return;

    var key = api.Hooks.PERSISTED_DATA_CHANGED;
    if (key) {
      try {
        api.registerHook(key, function () {
          dataCache = null;
          reconcile('data-changed');
        });
      } catch (e) { /* 旧版本宿主无此钩子 */ }
    }

    // 任务在列表里被删掉时，提醒不该跟着消失 → 稍后重建
    var delKey = api.Hooks.TASK_DELETE;
    if (delKey) {
      try {
        api.registerHook(delKey, function (payload) {
          var id = payload && payload.taskId;
          // 对账自己删的（重复任务、已归档、关掉提醒）：不需要再排一轮重建
          if (id && isSelfDelete(id)) return;
          scheduleRebuild(id);
        });
      } catch (e) { /* ignore */ }
    }

    // 完成即视为「这一轮已处理」：任务被归档后不再重建
    var doneKey = api.Hooks.TASK_COMPLETE;
    if (doneKey) {
      try {
        api.registerHook(doneKey, function (payload) {
          var task = payload && payload.task;
          var mk = task ? ReminderTasks.parseMark(task.notes) : null;
          if (!mk) return;
          var done = pruneDone(readDone(), Date.now());
          done[mk.eventId + '@' + mk.cycle] = Date.now();
          writeDone(done);
        });
      } catch (e) { /* ignore */ }
    }
  }

  function scheduleRebuild(taskId) {
    if (stopped) return;
    // 只关心本插件生成的任务；映射表没记录时也放行，交给对账兜底
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(function () {
      rebuildTimer = null;
      reconcile('task-deleted:' + (taskId || ''));
    }, REBUILD_DELAY);
  }

  /* ---------------- 任务投影 ---------------- */

  function hasTaskApi() {
    var api = P();
    return !!(api &&
      typeof api.addTask === 'function' &&
      typeof api.updateTask === 'function' &&
      typeof api.deleteTask === 'function' &&
      (typeof api.getAppState === 'function' || typeof api.getTasks === 'function'));
  }

  function readHost() {
    var api = P();
    if (typeof api.getAppState === 'function') {
      var pending;
      try {
        pending = api.getAppState();
      } catch (e) {
        return readHostFallback();
      }
      return Promise.resolve(pending).then(function (st) {
        var tasks = [];
        var projects = [];
        var k;
        if (st && st.tasks) for (k in st.tasks) if (Object.prototype.hasOwnProperty.call(st.tasks, k)) tasks.push(st.tasks[k]);
        if (st && st.projects) for (k in st.projects) if (Object.prototype.hasOwnProperty.call(st.projects, k)) projects.push(st.projects[k]);
        return { tasks: tasks, projects: projects };
      }, function () {
        return readHostFallback();
      });
    }
    return readHostFallback();
  }

  function readHostFallback() {
    var api = P();
    var tasks = typeof api.getTasks === 'function'
      ? Promise.resolve(api.getTasks()).then(function (v) { return v || []; }, function () { return []; })
      : Promise.resolve([]);
    var projects = typeof api.getAllProjects === 'function'
      ? Promise.resolve(api.getAllProjects()).then(function (v) { return v || []; }, function () { return []; })
      : Promise.resolve([]);
    return Promise.all([tasks, projects]).then(function (r) {
      return { tasks: r[0], projects: r[1] };
    });
  }

  function findProject(projects, title) {
    for (var i = 0; i < projects.length; i++) {
      var p = projects[i];
      if (p && p.title === title && p.id) return p.id;
    }
    return null;
  }

  function ensureProject(projects, title) {
    var api = P();
    var hit = findProject(projects, title);
    if (hit) { projectIdCache = hit.id; return Promise.resolve(hit.id); }

    // 数据里配置的项目名被改过时，沿用上次创建的项目，避免重复建
    if (projectIdCache) {
      for (var i = 0; i < projects.length; i++) {
        if (projects[i] && projects[i].id === projectIdCache) return Promise.resolve(projectIdCache);
      }
    }

    if (typeof api.addProject !== 'function') return Promise.resolve(null);
    return Promise.resolve(api.addProject({ title: title })).then(function (id) {
      projectIdCache = id || null;
      return projectIdCache;
    }, function () { return null; });
  }

  function readMap() {
    try {
      var raw = window.localStorage.getItem(MAP_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) { return {}; }
  }

  function writeMap(map) {
    try {
      window.localStorage.setItem(MAP_KEY, JSON.stringify(map));
    } catch (e) { /* 存储不可用：靠备注标记自愈 */ }
  }

  /* 已处理记录：eventId@周期 → 时间戳
   * 作用：任务完成后被归档/删除时，不要重新生成一条「已完成过」的提醒。
   * 只存在本机，丢了最多多提醒一次，不会丢提醒。 */
  function readDone() {
    try {
      var raw = window.localStorage.getItem(DONE_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) { return {}; }
  }

  function writeDone(obj) {
    try {
      window.localStorage.setItem(DONE_KEY, JSON.stringify(obj));
    } catch (e) { /* ignore */ }
  }

  function pruneDone(done, now) {
    var cutoff = now - DONE_KEEP_DAYS * 86400000;
    Object.keys(done).forEach(function (k) {
      if (!done[k] || done[k] < cutoff) delete done[k];
    });
    return done;
  }

  function findEvent(events, id) {
    for (var i = 0; i < events.length; i++) {
      if (events[i].id === id) return events[i];
    }
    return null;
  }

  function run(seq, fn) {
    return seq.then(fn, fn);
  }

  /**
   * 全量对账
   * @param {string} reason 仅用于日志
   */
  function reconcile(reason) {
    if (stopped) return Promise.resolve();
    if (reconciling) { pendingReason = reason || 'queued'; return Promise.resolve(); }
    if (!hasTaskApi()) return Promise.resolve();

    var api = P();
    reconciling = true;

    return loadData().then(function (data) {
      dataCache = data;
      var settings = data.settings || EventCore.emptySettings();
      var events = data.events || [];
      var today = new Date();

      return readHost().then(function (host) {
        var map = readMap();
        var managed = [];
        var repairs = [];
        var stale = [];
        var removeIds = [];
        var removeSeen = Object.create(null);
        var mapDirty = false;

        // 0. 清理映射表里「宿主已经没有」的任务 id。
        //    用户直接在任务列表里删任务时宿主不会再通知我们，这些条目否则会永久堆积。
        var alive = Object.create(null);
        for (var a = 0; a < host.tasks.length; a++) {
          var at = host.tasks[a];
          if (at && at.id) alive[at.id] = true;
        }
        Object.keys(map).forEach(function (id) {
          if (!alive[id]) { delete map[id]; mapDirty = true; }
        });

        // 1. 认领已有任务：
        //    · 备注里有标记 → 本插件管理
        //    · 映射表认识但备注被改/清空 → 用期望备注补回，纳入管理
        //    · 映射表有但事件已删除/归档/关掉任务提醒 → 直接删除
        host.tasks.forEach(function (t) {
          if (!t || !t.id) return;
          if (ReminderTasks.parseMark(t.notes)) { managed.push(t); return; }

          var evId = map[t.id];
          if (!evId) return;

          var ev = findEvent(events, evId);
          var desired = ev ? ReminderTasks.desiredTask(ev, today) : null;
          if (!desired) { stale.push(t); return; }

          t.notes = desired.notes;
          managed.push(t);
          repairs.push({ id: t.id, notes: desired.notes });
        });

        // 2. 计算期望集合：每条事件只推导一次，plan 直接复用（原来 plan 内部又算了一遍）
        var desiredAll = [];
        for (var i = 0; i < events.length; i++) {
          var want = ReminderTasks.desiredTask(events[i], today);
          if (want) desiredAll.push(want);
        }
        var sources = desiredAll;
        if (desiredAll.length > MAX_TASKS) {
          sources = desiredAll.slice(0, MAX_TASKS);
          try { api.log && api.log.warn('[里程碑] 提醒任务超过上限，仅同步前 ' + MAX_TASKS + ' 个'); } catch (e) { /* ignore */ }
        }

        // 3. 对账：期望集合之外的一律删除，所以「关掉某个日子的任务提醒」
        //    和「把它归档」都会让对应任务消失，不需要额外的清理代码
        var plan = ReminderTasks.plan({ desired: sources, existing: managed, today: today });

        // 本轮已经处理过（完成并被归档）的，不再重新生成
        var done = pruneDone(readDone(), Date.now());
        if (plan.add.length) {
          plan.add = plan.add.filter(function (a) {
            return !done[a.eventId + '@' + a.cycle];
          });
        }

        // 4. 执行：先补备注、再删、再改、最后加，避免标题重复和引用悬空
        var seq = Promise.resolve();

        function queueRemove(id) {
          if (!id || removeSeen[id]) return;
          removeSeen[id] = true;
          removeIds.push(id);
        }

        repairs.forEach(function (r) {
          seq = run(seq, function () {
            return Promise.resolve(api.updateTask(r.id, { notes: r.notes })).then(null, function () {});
          });
        });

        stale.forEach(function (t) {
          queueRemove(t.id);
        });

        plan.remove.forEach(function (r) {
          queueRemove(r.task.id);
        });

        removeIds.forEach(function (id) {
          seq = run(seq, function () {
            markSelfDelete(id);
            var clear = function () { delete map[id]; mapDirty = true; };
            return Promise.resolve(api.deleteTask(id)).then(clear, function () {
              clear();
              unmarkSelfDelete(id);
            });
          });
        });

        plan.update.forEach(function (u) {
          seq = run(seq, function () {
            return Promise.resolve(api.updateTask(u.task.id, u.patch)).then(null, function () {});
          });
        });

        var projectId = null;
        if (plan.add.length) {
          seq = seq.then(function () {
            return ensureProject(host.projects, settings.taskProject).then(function (id) {
              projectId = id;
            }, function () { projectId = null; });
          });
        }

        plan.add.forEach(function (a) {
          seq = run(seq, function () {
            return Promise.resolve(api.addTask({
              title: a.title,
              notes: a.notes,
              dueDay: a.dueDay,
              projectId: projectId
            })).then(function (id) {
              if (id) { map[id] = a.eventId; mapDirty = true; }
            }, function () { /* 单条失败不影响其它 */ });
          });
        });

        return seq.then(function () {
          if (mapDirty) writeMap(map);
          return { added: plan.add.length, updated: plan.update.length, removed: removeIds.length };
        });
      });
    }).then(function (result) {
      reconciling = false;
      if (pendingReason) {
        var next = pendingReason;
        pendingReason = null;
        return reconcile(next);
      }
      return result;
    }, function (err) {
      reconciling = false;
      pendingReason = null;
      try { P().log && P().log.warn('[里程碑] 任务同步失败：' + (err && err.message)); } catch (e) { /* ignore */ }
    });
  }

  /* ---------------- 提示条（可选） ---------------- */

  function readSeen() {
    try {
      var raw = window.localStorage.getItem(SEEN_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) { return {}; }
  }

  function writeSeen(obj) {
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(obj));
    } catch (e) { /* 存储不可用时退化为每次启动都提示 */ }
  }

  function pruneSeen(seen, now) {
    var cutoff = now - KEEP_DAYS * 86400000;
    Object.keys(seen).forEach(function (k) {
      if (!seen[k] || seen[k] < cutoff) delete seen[k];
    });
    return seen;
  }

  function whenText(offset) {
    if (offset === 0) return '今天';
    if (offset === 1) return '明天';
    return offset + ' 天后';
  }

  function runSnack(data) {
    if (stopped || !data) return;
    if (!data.events || !data.events.length) return;

    var today = new Date();
    var now = today.getTime();
    // dueReminders 内部只挑「开了提示条且未归档」的日子，渠道判断不在这里
    var due = EventCore.dueReminders(data.events, today);
    if (!due.length) return;

    var seen = pruneSeen(readSeen(), now);
    var fresh = due.filter(function (item) {
      var key = item.ev.id + '@' + EventCore.ymd(item.occ.date) + '#' + item.offset;
      item._key = key;
      return !seen[key];
    });
    if (!fresh.length) return;

    // 先记账再提示，避免重复弹窗
    fresh.forEach(function (item) { seen[item._key] = now; });
    writeSeen(seen);

    var parts = fresh.slice(0, 3).map(function (item) {
      return whenText(item.offset) + ' · ' + item.title;
    });
    var msg = parts.join('｜');
    if (fresh.length > 3) msg += '｜等 ' + fresh.length + ' 个日子';

    try {
      P().showSnack({ msg: msg, type: 'INFO', ico: 'event_available' });
    } catch (e) { /* ignore */ }
  }

  function tick() {
    if (stopped) return;
    reconcile('timer');
    if (dataCache) {
      runSnack(dataCache);
      return;
    }
    loadData().then(function (data) {
      dataCache = data;
      runSnack(data);
    }, function () { /* 数据未就绪，等下一轮 */ });
  }

  function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, CHECK_EVERY);
  }

  function stopAll() {
    stopped = true;
    if (timer) { clearInterval(timer); timer = null; }
    if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; }
    // 卸载时把缓存也放掉，插件重新加载不会留着上一份数据
    dataCache = null;
    rawKey = '';
    rawValue = null;
    projectIdCache = null;
    selfDeleted = Object.create(null);
  }

  /* ---------------- 启动 ---------------- */

  registerEntries();
  watchData();

  function boot() {
    // 稍等一下，避免和宿主启动提示抢镜
    setTimeout(function () {
      if (stopped) return;
      reconcile('boot');
      if (dataCache) runSnack(dataCache);
      else loadData().then(function (d) { dataCache = d; runSnack(d); }, function () {});
      startTimer();
    }, 3500);
  }

  try {
    if (P() && typeof P().onReady === 'function') {
      P().onReady(boot);
    } else {
      setTimeout(boot, 3500);
    }
  } catch (e) {
    setTimeout(boot, 3500);
  }

  try {
    if (typeof plugin !== 'undefined' && plugin && typeof plugin.onUnload === 'function') {
      plugin.onUnload(stopAll);
    }
  } catch (e) { /* ignore */ }
})();
