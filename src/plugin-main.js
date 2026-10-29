/* ============================================================
 * 里程碑 — 宿主侧逻辑
 *
 * 两条提醒通道，都是「每个事项各自选择」的：
 *   1. 任务列表投影：该事项开着「加入任务列表」时，把下一次提醒写成一条任务
 *   2. 提示条：该事项开着「打开应用时弹提示条」时，应用启动/跨天检查时弹 snack
 *
 * 一致性策略：插件数据是唯一真相，任务只是投影。每次对账做全量 diff
 * （新增 / 更新 / 删除），因此删事件、改日期、关掉某天的任务提醒、归档，
 * 都会自动收敛，不需要在删除路径上手写「记得把任务也删掉」。
 * ============================================================ */
(function () {
  'use strict';

  var I = window.I18N;

  var SEEN_KEY = 'ml-remind-seen';
  var MAP_KEY = 'ml-task-map-v1';
  var DONE_KEY = 'ml-handled-v1';
  var CHECK_EVERY = 10 * 60 * 1000; // 10 分钟复查一次，覆盖跨午夜场景
  var KEEP_DAYS = 120;
  var DONE_KEEP_DAYS = 800;         // 已处理记录保留到下一个年度周期，防止归档后被重建
  var REBUILD_DELAY = 1500;         // 任务被外部删除后延迟重建，合并连续删除
  var MAX_TASKS = 200;              // 安全阀：避免异常数据一次灌爆任务列表

  /* ---------------- 语言 ---------------- */

  var hostLangCode = '';
  // 软件里设定的语言（globalConfig.localization.lng）；空串 = 设成「跟随系统」
  var hostLangSetting = '';

  function navLang() {
    try {
      return (window.navigator && window.navigator.language) || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 宿主应用的语言，也就是「软件里设定的语言」。
   * 不能只信 getCurrentLanguage()：语言设成「跟随系统」时宿主配置里 lng 为空，
   * 插件 i18n 的信号量停在默认值 en，中文界面也会回报 'en'。
   * 因此设定值（异步补读）优先，取不到才用钩子载荷 / getCurrentLanguage / 系统语言。
   */
  function hostLang() {
    var api = P();
    var cur = '';
    try {
      if (api && typeof api.getCurrentLanguage === 'function') cur = api.getCurrentLanguage() || '';
    } catch (e) { /* 语言未就绪时继续用兜底值 */ }
    return I.pickHostLang({
      setting: hostLangSetting,
      cur: cur,
      switched: hostLangCode,
      nav: navLang()
    });
  }

  /**
   * 补读「软件里设定的语言」，只更新缓存，不自己切语言
   * （调用方拿到 true 之后再用已知的 settings 调一次 applyLang，避免与数据读取抢顺序）。
   * @returns {Promise<boolean>} 设定值是否发生变化
   */
  function primeHostLang() {
    var api = P();
    if (!api || typeof api.getAppState !== 'function') return Promise.resolve(false);
    return Promise.resolve(api.getAppState()).then(function (st) {
      var cfg = st && st.globalConfig;
      var loc = cfg && cfg.localization;
      var lng = loc && typeof loc.lng === 'string' ? loc.lng : '';
      if (lng === hostLangSetting) return false;
      hostLangSetting = lng;
      return true;
    }, function () { return false; });
  }

  /**
   * languageChange 的载荷：{ code, newLanguage }。
   * 两个字段都取 —— 实测切回同一批语言时宿主只带 newLanguage，只认 code 会一直用上一次的值。
   */
  function payloadLang(payload) {
    if (!payload) return '';
    return payload.code || payload.newLanguage || '';
  }

  /** 语言偏好存在同步数据里；宿主侧与界面共用同一套解析规则 */
  function applyLang(settings) {
    var l = I.resolve(settings && settings.lang, hostLang());
    I.setLang(l);
    EventCore.setLang(l);
    // 农历显示开关也跟数据走：任务备注里的日期文案必须与界面里看到的一致
    EventCore.setLunar(!!(settings && settings.lunar));
  }

  // 入口名称在注册时就要定，此时同步数据还没读回来，先按宿主语言给一个
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

    // 宿主里切了语言：任务标题/备注要跟着换语言，数据没变也要重算一遍。
    // 载荷里带着新的语言码，先落到本地再对账 —— 不依赖 cfg 里有没有 lang。
    var langKey = api.Hooks.LANGUAGE_CHANGE;
    if (langKey) {
      try {
        api.registerHook(langKey, function (payload) {
          var code = payloadLang(payload);
          if (code) hostLangCode = code;
          // 设定值可能刚写进 globalConfig：补读后再按新语言对账
          primeHostLang().then(function () {
            applyLang(dataCache && dataCache.settings);
            reconcile('language-change');
          });
        });
      } catch (e) { /* ignore */ }    }
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

        var patched = Object.create(null);
        plan.update.forEach(function (u) {
          patched[u.task.id] = true;
          seq = run(seq, function () {
            return Promise.resolve(api.updateTask(u.task.id, withTag(u.patch, u.task.tagIds)))
              .then(null, function () {});
          });
        });

        // 4.2 老数据迁移：早先建在「里程碑提醒」项目里的任务没法安全搬项目
        //     （宿主改 projectId 不会同步项目侧的 taskIds，任务会两头对不上），
        //     这里只补标签，让它能按标签统一筛出来；任务原地不动。
        managed.forEach(function (t) {
          if (patched[t.id] || removeSeen[t.id]) return;
          seq = run(seq, function () {
            if (!tagId) return Promise.resolve();
            var cur = Array.isArray(t.tagIds) ? t.tagIds : [];
            if (cur.indexOf(tagId) !== -1) return Promise.resolve();
            return Promise.resolve(api.updateTask(t.id, { tagIds: cur.concat(tagId) }))
              .then(null, function () {});
          });
        });

        plan.add.forEach(function (a) {
          seq = run(seq, function () {
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
    if (offset === 0) return I.t('snack.today');
    if (offset === 1) return I.t('snack.tomorrow');
    return I.t('snack.inDays', { n: offset });
  }

  function runSnack(data) {
    if (stopped || !data) return;
    if (!data.events || !data.events.length) return;

    var today = new Date();
    var now = today.getTime();
    // dueReminders 内部只挑「开了提示条且未归档」的事项，渠道判断不在这里
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
    var msg = parts.join(I.t('snack.sep'));
    if (fresh.length > 3) msg += I.t('snack.sep') + I.t('snack.more', { n: fresh.length });

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
    tagIdCache = null;
    selfDeleted = Object.create(null);
  }

  /* ---------------- 启动 ---------------- */

  registerEntry();
  watchData();

  // 启动时先读一次数据：拿到 settings.lang 后文案才定下来，boot 里的提示条也能直接用缓存。
  // 提醒 / 任务投影仍然等 boot 的 3.5 秒后再动，避免和宿主启动提示抢镜。
  // 语言设定值（globalConfig.localization.lng）也在这时补读：跟随系统时宿主只会回报默认值 en，
  // 不补读的话任务标题会一直是英文。
  Promise.all([loadData(), primeHostLang()]).then(function (r) {
    dataCache = r[0];
    // 语言设定值晚到：按它重算一次（此时才有 settings 可用，不会覆盖用户的语言偏好）
    if (r[1]) applyLang(dataCache.settings);
  }, function () { /* 读不到就继续用宿主语言，等 boot 再来 */ });

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

  // 宿主在脚本执行完后回调 onReady（此时 IPC 桥已就绪），onUnload 用来清定时器；
  // 两者都是 API 的标配，直接注册即可。
  P().onReady(boot);
  P().onUnload(stopAll);
})();
