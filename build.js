#!/usr/bin/env node
/**
 * 构建脚本：把 src 下的模块打包成可安装的插件目录与 ZIP。
 * 纯 Node 实现，无第三方依赖。
 *   node build.js
 *
 * 产物是可读的：样式与脚本原样内联（保留注释与缩进），每段前面有来源横幅，
 * 出问题时可以直接打开 dist/index.html 定位到具体模块。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const vm = require('vm');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const REL = path.join(ROOT, 'releases');

// index.html 必须自包含（样式与脚本内联：iframe 走 srcdoc 加载，ZIP 里的其它文件不会被 serve），
// 所以产物是多个源文件拼起来的单页。体积按 1024KB 卡上限，够用且不必牺牲可读性。
const SIZE_WARN = 768 * 1024;   // 警示线：接近上限时先提个醒
const SIZE_MAX = 1024 * 1024;   // 硬上限：超过直接构建失败

// 固定 ZIP 内时间戳，保证同样的源码构建出同样的 sha256（可重现构建）
// 需要覆盖时设置环境变量 BUILD_EPOCH（毫秒）
const STAMP = process.env.BUILD_EPOCH
  ? new Date(+process.env.BUILD_EPOCH)
  : new Date(Date.UTC(2026, 9, 26, 4, 0, 0));

const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

// 清单里的显示名会写进 <title>，转义一遍免得名字里带 & 或 < 时把 HTML 撑坏
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

/* ---------------- 语言包 ----------------
 * src/locales/*.js 全量内联。加一种语言 = 丢一个文件进这个目录，不用改代码。
 * 基准语言（zh）排最前，其余按字母序，与设置页里的语言列表顺序一致。
 */
const LOCALES = path.join(SRC, 'locales');
const BASE_LOCALE = 'zh.js';
function localeFiles() {
  const files = fs.readdirSync(LOCALES).filter((f) => /\.js$/.test(f));
  files.sort((a, b) => {
    if (a === BASE_LOCALE) return -1;
    if (b === BASE_LOCALE) return 1;
    return a < b ? -1 : 1;
  });
  return files.map((f) => 'locales/' + f);
}

/**
 * 把各语言包合成「键 -> 各语言值」的列式结构：
 *   { c: ['zh', 'en'], d: { appName: ['里程碑', 'Milestones'], ... } }
 * 源码里一种语言一个文件（好翻译、diff 干净），打包后键名只出现一次 ——
 * 直接内联多个完整字典会白白多花 5KB 以上，而 index.html 有体积预算。
 */
function localePayload() {
  const files = localeFiles();
  const codes = files.map((f) => path.basename(f, '.js'));
  const dicts = files.map((f) => require(path.join(SRC, f)));
  const d = {};
  dicts.forEach((dict, i) => {
    Object.keys(dict).forEach((k) => {
      if (!d[k]) d[k] = new Array(codes.length).fill(null);
      d[k][i] = dict[k];
    });
  });
  return { c: codes, d };
}

/** 产物自检：内联脚本交给 V8 解析一遍，语法有问题立刻失败，不产出坏包 */
function assertParses(code, label) {
  try {
    new vm.Script(code, { filename: label });
  } catch (e) {
    throw new Error(label + ' 语法错误：' + e.message);
  }
}

/** 内联段之间的来源横幅：产物里一眼看出这段来自哪个源文件，排查时不用回头翻构建脚本 */
const banner = (file) => '/* ===== ' + file + ' ===== */\n';

/**
 * 语言包内联：合成「键 → 各语言值」的行列结构后格式化输出，
 * 直接在产物里就能查文案，不用为了看一眼中文去翻 src/locales。
 */
const localeScript = () => banner('src/locales/*.js（构建时合成）') +
  'self.I18N_DATA = ' + JSON.stringify(localePayload(), null, 2) + ';\n';

const jsBundle = (files) => files
  .map((f) => banner('src/' + f) + read(f))
  .join('\n\n');

const cssBundle = (file) => banner('src/' + file) + read(file);

// 预览页示例数据
const DEMO_DATA = {
  version: 6,
  settings: { taskProject: '里程碑提醒', hero: true },
  events: [
    { id: 'd1', title: '妈妈生日', kind: 'birthday', calendar: 'lunar', date: '1968-05-14',
      lunar: { year: 1968, month: 4, day: 18, isLeap: false }, repeat: true,
      color: '#d6336c', note: '', createdAt: 1,
      remind: { task: true, snack: true, offsets: [0, 1, 3] } },
    { id: 'd2', title: '小米生日', kind: 'birthday', calendar: 'solar', date: '2019-11-08',
      lunar: null, repeat: true, color: '#f59f00', note: '', createdAt: 2,
      remind: { task: true, snack: false, offsets: [0, 1] } },
    { id: 'd3', title: '结婚纪念日', kind: 'anniversary', calendar: 'solar', date: '2018-06-16',
      lunar: null, repeat: true, color: '#c92a2a', note: '', createdAt: 3,
      remind: { task: true, snack: true, offsets: [0, 7, 30] } },
    { id: 'd4', title: '项目上线', kind: 'countdown', calendar: 'solar', date: '2026-12-01',
      lunar: null, repeat: false, color: '#1c7ed6', note: '', createdAt: 4,
      remind: { task: true, snack: true, offsets: [0, 1, 3, 7] } },
    { id: 'd5', title: '中秋节', kind: 'festival', calendar: 'lunar', date: '2026-09-25',
      lunar: { year: 2026, month: 8, day: 15, isLeap: false }, term: null, preset: 'zhongqiu',
      repeat: true, color: '#7048e8', note: '', createdAt: 5,
      remind: { task: true, snack: true, offsets: [0, 1, 7] } },
    { id: 'd6', title: '国庆节', kind: 'festival', calendar: 'solar', date: '2026-10-01',
      lunar: null, term: null, preset: 'guoqing', repeat: true, color: '#c92a2a',
      note: '', createdAt: 6,
      remind: { task: true, snack: false, offsets: [0, 1, 3] } },
    { id: 'd7', title: '入职纪念', kind: 'anniversary', calendar: 'solar', date: '2021-03-01',
      lunar: null, repeat: true, color: '#0ca678', note: '', createdAt: 7,
      remind: { task: false, snack: false, offsets: [0, 1] } },
    { id: 'd8', title: '去年年会', kind: 'countdown', calendar: 'solar', date: '2025-01-18',
      lunar: null, repeat: false, color: '#5c7cfa', note: '', createdAt: 8,
      remind: { task: false, snack: false, offsets: [0] } },
    { id: 'd9', title: '大学室友生日', kind: 'birthday', calendar: 'solar', date: '1994-03-12',
      lunar: null, repeat: true, color: '#d6336c', note: '', createdAt: 9,
      remind: { task: false, snack: false, offsets: [0] }, archived: true }
  ]
};

/* ---------------- 组装 ---------------- */

function buildIndexHtml() {
  const manifest = JSON.parse(read('manifest.json'));
  const ver = manifest.version;
  const tpl = read('index.tpl.html');
  const css = cssBundle('styles.css');
  const js = localeScript() + jsBundle(['i18n.js', 'lunar.js', 'event-core.js', 'app.js']);
  assertParses(js, 'index.html 内联脚本');

  const html = tpl
    .replace('/*INJECT_STYLES*/', () => css.trim())
    .replace('/*INJECT_SCRIPTS*/', () => js.trim())
    .replace(/__CD_VERSION__/g, ver)
    // 初始 <title> 用清单显示名：脚本跑起来后会按语言重设，这里只保证首帧不是占位符
    .replace(/__CD_NAME__/g, () => escapeHtml(manifest.name));

  if (!html.includes('window.Lunar') && !html.includes('global.Lunar')) {
    throw new Error('index.html 未包含农历模块');
  }
  if (/<script\s+src=/i.test(html)) throw new Error('index.html 不得引用外部脚本');
  if (/\b(?:src|href)\s*=\s*["']https?:\/\//i.test(html)) throw new Error('index.html 不得引用外链资源');
  if (/@import\s+url/i.test(html)) throw new Error('index.html 不得 @import 外部样式');
  // 内联脚本 / 样式里出现 </script>、</style> 或 <!-- 会把 HTML 提前截断，写盘前先拦住
  if (/<\/script|<!--/.test(js)) throw new Error('内联脚本含 </script> 或 <!--，会截断 HTML');
  if (/<\/style/i.test(css)) throw new Error('内联样式含 </style，会截断 HTML');
  // 体积预算：宿主对 index.html 没有硬限制，1024KB 是本项目自定的上限。
  // 靠近上限时先警告（多半是文案或语言包膨胀），超过则直接失败，避免打出装不动的包。
  const idxBytes = Buffer.byteLength(html, 'utf8');
  if (idxBytes > SIZE_WARN) {
    console.warn('  ⚠️ index.html ' + (idxBytes / 1024).toFixed(1) + ' KB，已超过 ' +
      (SIZE_WARN / 1024) + 'KB 警示线（上限 ' + (SIZE_MAX / 1024) + 'KB；每多一种语言约 +20KB）');
  }
  if (idxBytes > SIZE_MAX) {
    throw new Error('index.html 超过 ' + (SIZE_MAX / 1024) + 'KB（' +
      (idxBytes / 1024).toFixed(1) + ' KB），请精简文案或语言包');
  }
  return html;
}

function buildPluginJs() {
  const head =
    '/* 里程碑 — 插件宿主脚本（由 build.js 自动生成，勿直接编辑） */\n';
  const code = localeScript() + jsBundle(
    ['i18n.js', 'lunar.js', 'event-core.js', 'reminder-tasks.js', 'plugin-main.js']);
  assertParses(code, 'plugin.js');
  const out = head + code;
  const bytes = Buffer.byteLength(out, 'utf8');
  if (bytes > SIZE_WARN) {
    console.warn('  ⚠️ plugin.js ' + (bytes / 1024).toFixed(1) + ' KB，已超过 ' +
      (SIZE_WARN / 1024) + 'KB 警示线（上限 ' + (SIZE_MAX / 1024) + 'KB）');
  }
  if (bytes > SIZE_MAX) {
    throw new Error('plugin.js 超过 ' + (SIZE_MAX / 1024) + 'KB，请检查是否误打包了无关内容');
  }
  return out;
}

/* ---------------- 最小 ZIP 写入器 ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function dosStamp(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

function makeZip(files, when) {
  const { time, date } = dosStamp(when);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const raw = f.data;
    const crc = crc32(raw);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);

    locals.push(lh, nameBuf, body);
    centrals.push(cd, nameBuf);
    offset += lh.length + nameBuf.length + body.length;
  }

  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, cdBuf, eocd]);
}

/* ---------------- 主流程 ---------------- */

/**
 * 命名一致性闸门：项目名、插件 id、安装包名三者是派生关系，只允许一个真源。
 *   项目名（package.json.name / 安装包前缀）= sp-<manifest.id>
 *   插件 id（manifest.id / 社区插件 id / 同步数据归属）= 不带前缀的短名
 * 任何一处写错都会让安装包与身份对不上（历史问题：id 曾叫 countdown-days、
 * 项目名曾叫 super-productivity-milestone、package.json 还长期停在 2.3.0）。
 */
function assertNaming(manifest) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  } catch (e) {
    throw new Error('package.json 读取失败: ' + e.message);
  }
  const want = 'sp-' + manifest.id;
  if (pkg.name !== want) {
    throw new Error(
      '命名不一致：package.json name="' + pkg.name + '" 应为 "' + want +
      '"（项目名固定为 sp-<manifest.id>）'
    );
  }
  if (pkg.version !== manifest.version) {
    throw new Error(
      '版本不一致：package.json ' + pkg.version + ' ≠ manifest.json ' + manifest.version +
      '，改版本时两处都要改'
    );
  }
  if (!String(manifest.name || '').trim()) throw new Error('manifest.name（显示名）不能为空');
  return pkg;
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  fs.mkdirSync(REL, { recursive: true });

  const manifestRaw = read('manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (e) {
    throw new Error('manifest.json 不是合法 JSON: ' + e.message);
  }
  ['id', 'name', 'version', 'manifestVersion', 'minSupVersion'].forEach((k) => {
    if (manifest[k] === undefined) throw new Error('manifest.json 缺少必需字段: ' + k);
  });
  if (!Array.isArray(manifest.permissions)) throw new Error('manifest.permissions 必须是数组');
  if (!Array.isArray(manifest.hooks)) throw new Error('manifest.hooks 必须是数组');
  if (manifest.iFrame !== true) throw new Error('iFrame 必须为 true');
  if (!/^[a-z0-9-]+$/.test(manifest.id)) throw new Error('manifest.id 必须是 kebab-case');
  // 宿主会给每个 iFrame 插件自动补一条菜单入口（用 manifest.name，注册时写死，语言变了也不会变）。
  // 本插件的入口由 plugin.js 自己注册，才能用插件自己的语言包取词，所以这里要求关掉自动注册，
  // 否则英文环境下导航里会同时出现「Milestone」（我们的）和「Milestone」（宿主的）两条。
  if (manifest.isSkipMenuEntry !== true) {
    throw new Error('manifest.isSkipMenuEntry 必须为 true（菜单入口由 plugin.js 注册，避免重复）');
  }
  const pkg = assertNaming(manifest);

  const indexHtml = buildIndexHtml();
  const pluginJs = buildPluginJs();

  const outFiles = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8') },
    { name: 'plugin.js', data: Buffer.from(pluginJs, 'utf8') },
    { name: 'index.html', data: Buffer.from(indexHtml, 'utf8') },
    { name: 'icon.svg', data: Buffer.from(read('icon.svg'), 'utf8') },
  ];

  for (const f of outFiles) fs.writeFileSync(path.join(DIST, f.name), f.data);

  // 浏览器预览页（不属于插件包，仅用于本地查看效果）
  const PREVIEW = path.join(ROOT, 'preview');
  fs.mkdirSync(PREVIEW, { recursive: true });
  const demoMock =
    '<script>window.__DEMO__=' + JSON.stringify(DEMO_DATA) + ';' +
    'window.PluginAPI={' +
    "Hooks:{PERSISTED_DATA_CHANGED:'persistedDataChanged'}," +
    'onReady:function(f){setTimeout(f,0)},' +
    'registerHook:function(){},' +
    'showIndexHtmlAsView:function(){},' +
    'showSnack:function(c){console.log("[demo snack]",c&&c.msg)},' +
    // 宿主 19.x 就是这样暴露语言的：cfg 里没有 lang，只有 getCurrentLanguage()
    "getCurrentLanguage:function(){return 'zh'}," +
    'loadSyncedData:function(){return Promise.resolve(JSON.stringify(window.__DEMO__))},' +
    'persistDataSynced:function(s){window.__DEMO__=JSON.parse(s);return Promise.resolve()},' +
    'openDialog:function(c){var b=c&&c.buttons||[];return Promise.resolve(b.length?b[b.length-1].label:"确定")}' +
    '};</script>';
  const demo = indexHtml.replace('</body>', demoMock + '\n</body>');
  fs.writeFileSync(path.join(PREVIEW, 'demo.html'), demo, 'utf8');

  // 安装包名用项目名（sp-milestone），不用插件 id（milestone）：
  // 社区仓库 / 下载页统一以项目名对外，id 只在宿主内部做身份标识。
  const zipName = `${pkg.name}-v${manifest.version}.zip`;
  const zipBuf = makeZip(outFiles, STAMP);
  if (zipBuf.length > 10 * 1024 * 1024) throw new Error('ZIP 超过 10MB 上限');

  // 安装包常常正被压缩软件 / 资源管理器占着，Windows 下会直接 EBUSY。
  // 这种情况不该让整个构建失败，换个名字落盘并提示即可。
  let writtenName = zipName;
  try {
    fs.writeFileSync(path.join(REL, zipName), zipBuf);
  } catch (e) {
    if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e;
    writtenName = zipName.replace(/\.zip$/, '') + '-' + Date.now().toString(36) + '.zip';
    fs.writeFileSync(path.join(REL, writtenName), zipBuf);
    console.warn('  ⚠️ ' + zipName + ' 被其它程序占用，已另存为 ' + writtenName);
  }

  const sha = crypto.createHash('sha256').update(zipBuf).digest('hex');
  const kb = (zipBuf.length / 1024).toFixed(1);

  console.log('构建完成');
  console.log('  目录   : dist/');
  outFiles.forEach((f) => console.log(`    - ${f.name}  ${(f.data.length / 1024).toFixed(1)} KB`));
  const idxKb = (Buffer.byteLength(indexHtml, 'utf8') / 1024).toFixed(1);
  console.log(`  index  : ${idxKb} KB（上限 ${SIZE_MAX / 1024} KB）`);
  console.log(`  安装包 : releases/${writtenName}  (${kb} KB)`);
  console.log(`  sha256 : ${sha}`);
  console.log(`  预览   : dist/index.html`);
}

// 直接执行时构建；被测试 require 时只导出构建函数与常量
if (require.main === module) {
  main();
}

module.exports = {
  buildIndexHtml, buildPluginJs, assertNaming, read,
  // 体积常量与构建模式导出给测试用，避免测试里再写一份同样的数字
  SIZE_WARN, SIZE_MAX
};
