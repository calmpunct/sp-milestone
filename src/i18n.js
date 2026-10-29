/*!
 * 国际化核心：语言注册表 + 取词 + 静态文案套用
 *
 * 语言包放在 src/locales/<code>.js，每个文件自带 __name（语言自称）。
 * 构建时 build.js 会把该目录下所有 .js 收进来（并把重复的键名合成一份），
 * 设置页的语言列表也随之自动生成 —— 新增一种语言只需要加一个文件。
 *
 * 语言优先级：
 *   1. settings.lang（用户在插件里明确选的语言）
 *   2. 宿主应用的语言（PluginAPI.getCurrentLanguage()，取不到时用 languageChange 载荷里的语言码）
 *   3. 系统语言（navigator.language）
 *   4. 英文（FALLBACK），再不行回落到基准语言
 */
(function (global, factory) {
  /* node-only:start （仅供 test/*.js require，构建时会整段剥离，勿在浏览器代码里引用）*/
  if (typeof module === 'object' && typeof module.exports === 'object') {
    // Node：把 locales 目录里所有语言包都读进来（新增语言文件无需改这里）
    var fs = require('fs');
    var path = require('path');
    var dir = path.join(__dirname, 'locales');
    var seed = {};
    fs.readdirSync(dir).forEach(function (f) {
      if (/\.js$/.test(f)) seed[f.replace(/\.js$/, '')] = require('./locales/' + f);
    });
    module.exports = factory(null, seed);
    return;
  }
  /* node-only:end */
  global.I18N = factory(global, null);
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (global, seed) {
  'use strict';

  var BASE = 'zh';        // 基准语言：所有键先在 zh.js 里定义
  var FALLBACK = 'en';    // 遇到完全不认识的语言时用它

  var REG = seed || null; // 语言代码 -> 字典
  var lang = BASE;

  /**
   * 懒绑定浏览器侧的语言包：脚本顺序不影响结果。
   * 构建产物是列式结构 I18N_DATA = { c: [语言代码], d: { 键: [各语言值] } }，
   * 源码/测试直接用整份字典 I18N_LOCALES，两种形态都认。
   */
  function reg() {
    if (REG) return REG;
    var g = global || {};
    if (g.I18N_LOCALES) {
      REG = g.I18N_LOCALES;
      return REG;
    }
    var data = g.I18N_DATA;
    if (!data || !data.c || !data.d) {
      REG = {};
      return REG;
    }
    var out = {};
    var codes = data.c;
    var cols = data.d;
    var i;
    for (i = 0; i < codes.length; i++) out[codes[i]] = {};
    for (var k in cols) {
      var col = cols[k];
      for (i = 0; i < codes.length; i++) {
        if (col[i] != null) out[codes[i]][k] = col[i];
      }
    }
    REG = out;
    return REG;
  }

  /**
   * 语言代码归一：zh-CN / zh_TW -> zh。
   */
  function normCode(code) {
    return String(code || '').toLowerCase().split(/[-_]/)[0];
  }

  // 宿主的默认语言（Super Productivity 的 DEFAULT_LANGUAGE）
  var HOST_DEFAULT = 'en';

  /**
   * 决定「宿主当前的语言」，宿主那两个来源各有各的坑，必须合起来看：
   *
   *   · getCurrentLanguage()：底层是 PluginI18nService 的信号量，初值 DEFAULT_LANGUAGE（en），
   *     只有当 globalConfig.localization.lng **有值**时才会被同步。所以用户在软件里把语言设成
   *     「跟随系统」时 lng 是空的，信号量永远停在 en —— 中文界面也会回报 'en'。
   *   · getAppState().globalConfig.localization.lng：真实设定值。空 = 跟随系统。
   *
   * 于是：设定值优先（哪怕它真是 en，那就是用户选的英文）；
   * 设定值为空才落到系统语言 —— 此时宿主界面本身就跟随系统，与之一致。
   * @param {{setting?:string, cur?:string, switched?:string, nav?:string}} src
   *        setting 软件里设定的语言 / cur getCurrentLanguage() /
   *        switched languageChange 载荷里的语言码 / nav 系统语言
   */
  function pickHostLang(src) {
    src = src || {};
    var setting = normCode(src.setting);
    if (setting) return setting;
    var cur = normCode(src.cur);
    if (cur && cur !== HOST_DEFAULT) return cur;
    var sw = normCode(src.switched);
    if (sw && sw !== HOST_DEFAULT) return sw;
    return normCode(src.nav) || HOST_DEFAULT;
  }

  function dictOf(code) {
    return reg()[code] || null;
  }

  /** 已注册的语言代码，基准语言排在最前，其余按字母序 */
  function codes() {
    var list = Object.keys(reg());
    list.sort(function (a, b) {
      if (a === BASE) return -1;
      if (b === BASE) return 1;
      return a < b ? -1 : 1;
    });
    return list;
  }

  /** 语言在界面上的显示名（语言包里的 __name，缺省用代码） */
  function nameOf(code) {
    var d = dictOf(code);
    return (d && d.__name) || code;
  }

  /**
   * 语言偏好 -> 实际可用语言
   * @param {string} pref auto / 具体语言代码（也容忍 zh-CN 这种带地区码的写法）
   * @param {string|{code:string}} hostLang 宿主应用语言（getCurrentLanguage() / cfg.lang）
   */
  function resolve(pref, hostLang) {
    var R = reg();
    var p = normCode(pref);
    if (p && p !== 'auto' && R[p]) return p;

    var host = normCode(hostLang);
    if (host && R[host]) return host;

    if (R[FALLBACK]) return FALLBACK;
    return BASE;
  }

  function setLang(l) {
    lang = reg()[l] ? l : resolve(l, '');
  }

  function getLang() {
    return lang;
  }

  /** 取文案；vars 里的值替换 {xxx}，缺占位符时原样保留便于发现漏传 */
  function t(key, vars) {
    var R = reg();
    var d = R[lang] || R[BASE] || {};
    var s = d[key];
    if (s == null) s = (R[BASE] || {})[key];
    if (s == null) return String(key);
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return vars[k] == null ? m : String(vars[k]);
      });
    }
    return s;
  }

  /**
   * 文案里只允许 <b> 这一种标签（加粗提示用），其余标签与属性一律剔除 ——
   * 语言包是第三方可贡献的内容，不能当成可信 HTML 塞进 innerHTML，
   * 否则一条 <img onerror> 就能在插件里执行脚本。
   */
  function safeHtml(s) {
    var keep = [];
    var out = String(s)
      .replace(/<b\b[^>]*>/gi, '<b>')
      .replace(/<\/b\s*>/gi, '</b>')
      .replace(/<\/?b>/g, function (m) {
        keep.push(m);
        return '\u0001' + (keep.length - 1) + '\u0001';
      })
      .replace(/<[^>]*>/g, '');
    return out.replace(/\u0001(\d+)\u0001/g, function (m, i) {
      return keep[+i] == null ? '' : keep[+i];
    });
  }

  /** 取一段可安全插入 innerHTML 的文案（占位符同 t） */
  function html(key, vars) {
    return safeHtml(t(key, vars));
  }

  function each(list, fn) {
    for (var i = 0; i < list.length; i++) fn(list[i]);
  }

  /**
   * 把静态 HTML 里的 data-i18n* 标记替换成当前语言
   *   data-i18n        -> textContent
   *   data-i18n-html   -> innerHTML（只保留 <b>，见 safeHtml）
   *   data-i18n-ph     -> placeholder
   *   data-i18n-aria   -> aria-label
   *   data-i18n-title  -> title
   */
  function apply(root) {
    var doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.querySelectorAll) return;
    each(doc.querySelectorAll('[data-i18n]'), function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    each(doc.querySelectorAll('[data-i18n-html]'), function (el) {
      el.innerHTML = html(el.getAttribute('data-i18n-html'));
    });
    each(doc.querySelectorAll('[data-i18n-ph]'), function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    each(doc.querySelectorAll('[data-i18n-aria]'), function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    });
    each(doc.querySelectorAll('[data-i18n-title]'), function (el) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
  }

  return {
    BASE: BASE,
    t: t,
    html: html,
    safeHtml: safeHtml,
    apply: apply,
    resolve: resolve,
    pickHostLang: pickHostLang,
    normCode: normCode,
    setLang: setLang,
    getLang: getLang,
    codes: codes,
    nameOf: nameOf,
    dictOf: dictOf
  };
});
