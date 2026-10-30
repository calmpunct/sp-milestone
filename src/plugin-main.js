/* ============================================================
 * 里程碑 — 宿主侧逻辑
 *
 * 一条提醒通道，每个事项各自选择是否开启：
 *   任务列表投影：该事项开着「任务提醒」时，把下一次提醒写成一条任务
 * （宿主没有系统级推送，弹一下就消失的提示条没意义，已整体移除）
 *
 * 一致性策略：插件数据是唯一真相，任务只是投影。每次对账做全量 diff
 * （新增 / 更新 / 删除），因此删事件、改日期、关掉某天的任务提醒、归档，
 * 都会自动收敛，不需要在删除路径上手写「记得把任务也删掉」。
 * ============================================================ */
(function () {
  'use strict';

  var I = window.I18N;

  var MAP_KEY = 'ml-task-map-v1';
  var DONE_KEY = 'ml-handled-v1';
  var CHECK_EVERY = 10 * 60 * 1000; // 10 分钟复查一次，覆盖跨午夜场景
  var DONE_KEEP_DAYS = 800;         // 已处理记录保留到下一个年度周期，防止归档后被重建
  var REBUILD_DELAY = 1500;         // 任务被外部删除后延迟重建，合并连续删除
  var MAX_TASKS = 200;              // 安全阀：避免异常数据一次灌爆任务列表

  /* ---------------- 语言 ----------------
   * 语言存在同步数据里：首次打开插件时选一次就固定，之后不再变。
   * 这里不做任何「跟随系统 / 跟随宿主界面」的判断 —— 那会让两台设备各按各自的
   * 系统语言渲染任务文案，同步起来就是你改我、我改你。锁定之后，两端算出的
   * 标题与备注必然相同，对账时直接比文本就够了。
   *
   * settings.lang 为空只有两种可能：全新安装，或刚清空过数据 —— 都是「还没选」，
   * 先用基准语言起一个，用户选完写进同步数据即以它为准。
   */

  function applyLang(settings) {
    var l = I.dictOf(settings && settings.lang) ? settings.lang : (I.BASE || 'zh');
    I.setLang(l);
    EventCore.setLang(l);
    // 农历显示开关也跟数据走：任务备注里的日期文案必须与界面里看到的一致
    EventCore.setLunar(!!(settings && settings.lunar));
  }

  // 入口名称在注册时就要定，此时同步数据还没读回来，先按基准语言给一个
  applyLang(null);

  var dataCache = null;
  var timer = null;
  var rebuildTimer = null;
  var stopped = false;
  var reconciling = false;
  var pendingReason = null;
  var tagIdCache = null;

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

  /**
   * 宿主注入的 API。
   * 宿主执行 plugin.js 是 new Function('plugin', 'PluginAPI', code)：API 是**函数参数**，
   * 不在 window 上（window.PluginAPI 只在 iframe 里由宿主注入，见 app.js）。
   */
  function P() {
    return typeof PluginAPI !== 'undefined' ? PluginAPI : null;
  }

  /* ---------------- 入口（左侧导航） ----------------
   * 只注册一条菜单项 —— 这就是左侧导航里的那个入口。
   * 不要再调 registerSidePanelButton：它注册的是**顶栏**按钮（添加任务 / 开始专注 /
   * 同步 那一排），和左侧入口重复，用户会看到两个入口。
   *
   * 名称固定 "Milestone"：宿主不提供「改已注册入口名称」的接口，注册时写死就没法再变，
   * 跟随语言只会在切换后长期停在旧语言上；而 Milestone 中英文用户都认得出
   * （反过来英文用户读不懂「里程碑」）。
   */
  var ENTRY_LABEL = 'Milestone';

  function registerEntry() {
    var api = P();
    if (!api || typeof api.registerMenuEntry !== 'function') return;
    try {
      api.registerMenuEntry({ label: ENTRY_LABEL, icon: 'event', onClick: openView });
    } catch (e) { /* 注册失败只是没入口，不影响数据与提醒 */ }
  }

  function openView() {
    try {
      var api = P();
      if (api && typeof api.showIndexHtmlAsView === 'function') api.showIndexHtmlAsView();
    } catch (e) { /* 宿主拒绝打开时静默跳过 */ }
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
      if (key && rawValue && rawKey === key) {
        // 语言可能被宿主切换过：即使数据没变也要按当前语言重算一次
        applyLang(rawValue.settings);
        return rawValue;
      }

      var data;
      if (!raw) {
        data = EventCore.normalize(null);
      } else if (!isStr) {
        data = EventCore.normalize(raw);
      } else {
        var parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          parsed = null;
        }
        data = EventCore.normalize(parsed);
      }
      // 归一化之后再应用设置：normalize 会把「数据里还有农历事项」的库强制标成
      // 显示农历，用原始 settings 会让任务备注里少掉农历日期，与界面对不上
      applyLang(data.settings);
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
      } catch (e) { /* 单个钩子注册失败不影响其它钩子 */ }
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

    // 不监听 languageChange：语言锁定在同步数据里，宿主切语言与任务文案无关。
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
        var tags = [];
        var k;
        if (st && st.tasks) for (k in st.tasks) if (Object.prototype.hasOwnProperty.call(st.tasks, k)) tasks.push(st.tasks[k]);
        if (st && st.tags) for (k in st.tags) if (Object.prototype.hasOwnProperty.call(st.tags, k)) tags.push(st.tags[k]);
        return { tasks: tasks, tags: tags };
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
    var tags = typeof api.getAllTags === 'function'
      ? Promise.resolve(api.getAllTags()).then(function (v) { return v || []; }, function () { return []; })
      : Promise.resolve([]);
    return Promise.all([tasks, tags]).then(function (r) {
      return { tasks: r[0], tags: r[1] };
    });
  }

  /** 按名字找标签：先精确匹配，再忽略大小写（用户手动打过 Milestone 也认） */
  function findTag(tags, title) {
    var want = String(title || '').toLowerCase();
    if (!want) return null;
    var loose = null;
    for (var i = 0; i < tags.length; i++) {
      var g = tags[i];
      if (!g || !g.id || typeof g.title !== 'string') continue;
      if (g.title === title) return g.id;
      if (!loose && g.title.toLowerCase() === want) loose = g.id;
    }
    return loose;
  }

  /**
   * 拿到标签 id，没有就（可选地）建一个。
   * 任务本身不传 projectId，宿主会落到收件箱 —— 不再创建「里程碑提醒」项目。
   * @param {boolean} create 只查不建时传 false（没有任务要加时不要留个空标签）
   */
  function ensureTag(tags, title, create) {
    var api = P();
    var name = title || EventCore.TAG_DEFAULT;
    var hit = findTag(tags, name);
    if (hit) { tagIdCache = hit; return Promise.resolve(hit); }

    // 标签名被改过时沿用上次建的那个，避免每轮都新建
    if (tagIdCache) {
      for (var i = 0; i < tags.length; i++) {
        if (tags[i] && tags[i].id === tagIdCache) return Promise.resolve(tagIdCache);
      }
    }
    if (!create || typeof api.addTag !== 'function') return Promise.resolve(null);
    return Promise.resolve(api.addTag({ title: name })).then(function (id) {
      tagIdCache = id || null;
      return tagIdCache;
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
   * 只存在本机，所以单靠它挡不住「另一台设备勾完」的情况 —— 那一路由对账时
   * 查归档兜底（见 reconcile 的 4.0），命中的会补记到这里，省掉下一轮的归档查询。 */
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

        // 3. 对账：期望集合之外的一律删除，所以「关掉某个事项的任务提醒」
        //    和「把它归档」都会让对应任务消失，不需要额外的清理代码
        var plan = ReminderTasks.plan({ desired: sources, existing: managed, today: today });

        // 本轮已经处理过（完成并被归档）的，不再重新生成
        var done = pruneDone(readDone(), Date.now());
        if (plan.add.length) {
          plan.add = plan.add.filter(function (a) {
            return !done[a.eventId + '@' + a.cycle];
          });
        }

        // 4. 执行：先定标签、再补备注、再删、再改、最后加，避免标题重复和引用悬空
        var seq = Promise.resolve();

        // 4.0 跨设备已完成：本机没记过「已处理」，但另一台已经勾完并归档了。
        //     宿主只为本机操作触发 taskComplete，同步来的完成动作不会触发，
        //     所以 ml-handled-v1 里没有记录；而归档任务不在 getAppState() 里，
        //     不判一下就当成「任务丢了」，把已经完成的提醒重新建出来。
        //     归档是同步的，读一次就能判出来；只在真要新增时才读（归档可能积累几年）。
        if (plan.add.length && typeof api.getArchivedTasks === 'function') {
          seq = seq.then(function () {
            var arch;
            try {
              arch = api.getArchivedTasks();
            } catch (e) {
              return;
            }
            return Promise.resolve(arch).then(function (list) {
              var handled = ReminderTasks.handledFromArchived(list);
              var now = Date.now();
              var hit = 0;
              plan.add = plan.add.filter(function (a) {
                var k = a.eventId + '@' + a.cycle;
                if (!handled[k]) return true;
                // 记进本机已处理表：否则每轮对账都要再翻一次归档
                if (!done[k]) { done[k] = now; hit++; }
                return false;
              });
              if (hit) writeDone(done);
            }, function () { /* 拿不到归档就按原样新增，不影响主流程 */ });
          });
        }

        // 4.1 标签：任务不传 projectId（宿主落收件箱），靠标签归类。
        //     只在确实有任务要留在列表里时才创建，免得用户删光事项后留下一个空标签。
        var tagId = null;
        seq = seq.then(function () {
          // 标签只在「真有任务要留在列表里」时创建：事项全删光后不该留一个空标签
          var keep = 0;
          for (var n = 0; n < managed.length; n++) if (!removeSeen[managed[n].id]) keep++;
          return ensureTag(host.tags, settings.taskTag, plan.add.length > 0 || keep > 0).then(function (id) {
            tagId = id;
          }, function () { tagId = null; });
        });

        /** 给 update 补丁补上标签；已有该标签时原样返回，不做无谓写入 */
        function withTag(patch, currentTags) {
          if (!tagId) return patch;
          var cur = Array.isArray(currentTags) ? currentTags.slice() : [];
          if (cur.indexOf(tagId) !== -1) return patch;
          cur.push(tagId);
          var out = {};
          for (var key in patch) if (Object.prototype.hasOwnProperty.call(patch, key)) out[key] = patch[key];
          out.tagIds = cur;
          return out;
        }

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

        // 4.2 更新：只改有差异的字段，标签缺了就顺手补上。
        //     不去「巡视全场补标签」—— 用户自己摘掉标签是用户的选择，不跟他抢
        plan.update.forEach(function (u) {
          seq = run(seq, function () {
            return Promise.resolve(api.updateTask(u.task.id, withTag(u.patch, u.task.tagIds)))
              .then(null, function () {});
          });
        });

        // 新增放在最后一个执行步里、**执行时**再读 plan.add：
        // 4.0 会异步过滤掉「另一端已经做完」的条目，提前 forEach 会把它漏判。
        seq = seq.then(function () {
          var chain = Promise.resolve();
          plan.add.forEach(function (a) {
            chain = run(chain, function () {
              var payload = {
                title: a.title,
                notes: a.notes,
                dueDay: a.dueDay
              };
              // 只给标签、不给 projectId：任务落到收件箱
              if (tagId) payload.tagIds = [tagId];
              return Promise.resolve(api.addTask(payload)).then(function (id) {
                if (id) { map[id] = a.eventId; mapDirty = true; }
              }, function () { /* 单条失败不影响其它 */ });
            });
          });
          return chain;
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

  function tick() {
    if (stopped) return;
    reconcile('timer');
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
    tagIdCache = null;
    selfDeleted = Object.create(null);
  }

  /* ---------------- 启动 ---------------- */

  registerEntry();
  watchData();

  // 启动时先读一次数据：拿到 settings.lang 后文案才定下来，boot 对账时标题/备注才是对的。
  // 任务投影等 boot 的 3.5 秒后再动，避免和宿主启动流程抢资源。
  loadData().then(function (data) {
    dataCache = data;
  }, function () { /* 读不到就继续用基准语言，等 boot 再来 */ });

  function boot() {
    // 稍等一下，避免和宿主启动提示抢镜
    setTimeout(function () {
      if (stopped) return;
      reconcile('boot');
      startTimer();
    }, 3500);
  }

  // 宿主在脚本执行完后回调 onReady（此时 IPC 桥已就绪），onUnload 用来清定时器；
  // 两者都是 API 的标配，直接注册即可。
  P().onReady(boot);
  P().onUnload(stopAll);
})();
