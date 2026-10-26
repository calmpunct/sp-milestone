#!/usr/bin/env node
/**
 * 构建脚本：把 src 下的模块打包成可安装的插件目录与 ZIP。
 * 纯 Node 实现，无第三方依赖。
 *   node build.js
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

// 宿主对单个插件文件有 100KB 上限，index.html 又是自包含的（样式与脚本都内联），
// 所以构建时统一去掉注释与多余空白。设 BUILD_MINIFY=0 可产出未压缩版本用于排查。
const MINIFY = process.env.BUILD_MINIFY !== '0';

// 固定 ZIP 内时间戳，保证同样的源码构建出同样的 sha256（可重现构建）
// 需要覆盖时设置环境变量 BUILD_EPOCH（毫秒）
const STAMP = process.env.BUILD_EPOCH
  ? new Date(+process.env.BUILD_EPOCH)
  : new Date(Date.UTC(2026, 9, 26, 4, 0, 0));

const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

/* ---------------- 压缩（零依赖） ----------------
 * 只做「删注释 + 压空白」，不重命名、不合并行，因此不会踩 ASI 之类的坑。
 * 两处细节：
 *   1. 字符串、模板串、正则字面量原样保留（否则 `'http://x'`、`/a\/b/` 会被当注释吃掉）；
 *   2. JS 输出后用 vm.Script 校验语法，压缩出问题直接构建失败，不产出坏包。
 */

const isWordChar = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
  (c >= '0' && c <= '9') || c === '_' || c === '$';

const REGEX_ALLOWED_AFTER_WORD = /^(?:return|typeof|case|in|of|new|delete|void|do|else|instanceof|yield|await)$/;

function minifyJs(src) {
  const s = src.replace(/\r\n/g, '\n');
  const n = s.length;
  let i = 0;
  let out = '';
  let prev = '';       // 上一个有效字符（用于判断 / 是除号还是正则起点）
  let prevWord = '';   // 上一个标识符
  let last = '';       // 已输出的最后一个字符

  const push = (ch) => { out += ch; last = ch; };

  while (i < n) {
    const c = s[i];
    const c2 = s[i + 1];

    // 注释
    if (c === '/' && c2 === '/') {
      while (i < n && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      // 两侧都是标识符字符时必须留一个空格，否则 a/*x*/b 会被粘成 ab
      if (isWordChar(last) && i < n && isWordChar(s[i])) push(' ');
      continue;
    }

    // 字符串 / 模板串：原样输出
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      push(c);
      i++;
      while (i < n) {
        const ch = s[i];
        if (ch === '\\') { push(ch); push(s[i + 1] || ''); i += 2; continue; }
        push(ch);
        i++;
        if (ch === q) break;
      }
      prev = q;
      prevWord = '';
      continue;
    }

    // 正则字面量：/ 前面已经是「值」时才是除号
    if (c === '/') {
      const valueBefore = prev !== '' && (isWordChar(prev) || prev === ')' || prev === ']' ||
        REGEX_ALLOWED_AFTER_WORD.test(prevWord));
      if (!valueBefore) {
        push(c);
        i++;
        let inClass = false;
        while (i < n) {
          const ch = s[i];
          if (ch === '\\') { push(ch); push(s[i + 1] || ''); i += 2; continue; }
          push(ch);
          i++;
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) break;
        }
        while (i < n && isWordChar(s[i])) { push(s[i]); i++; }   // 修饰符 i / g / m
        prev = '/';
        prevWord = '';
        continue;
      }
    }

    // 换行：保留（分号省略靠它兜底），去掉行首缩进与行尾空格
    if (c === '\n') {
      while (last === ' ') { out = out.slice(0, -1); last = out[out.length - 1] || ''; }
      push('\n');
      i++;
      while (i < n && (s[i] === ' ' || s[i] === '\t')) i++;
      prev = '';
      prevWord = '';
      continue;
    }

    // 行内空白压成一个
    if (c === ' ' || c === '\t') {
      while (i < n && (s[i] === ' ' || s[i] === '\t')) i++;
      if (last !== ' ' && last !== '\n' && last !== '') push(' ');
      continue;
    }

    // 标识符整体输出，便于记录 prevWord
    if (isWordChar(c)) {
      let w = c;
      i++;
      while (i < n && isWordChar(s[i])) { w += s[i]; i++; }
      out += w;
      last = w[w.length - 1];
      prev = last;
      prevWord = w;
      continue;
    }

    push(c);
    prev = c;
    prevWord = '';
    i++;
  }

  return out.split('\n').map((line) => line.replace(/\s+$/, '')).filter(Boolean).join('\n');
}

function minifyCss(src) {
  // 先切成「代码段 / 字符串段」，只对代码段做压缩，避免动到 content: '…' 里的内容
  const parts = [];
  let buf = '';
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      buf += ' ';
      continue;
    }
    if (c === '"' || c === "'") {
      if (buf) { parts.push({ code: true, text: buf }); buf = ''; }
      let str = c;
      i++;
      while (i < n) {
        const ch = src[i];
        str += ch;
        i++;
        if (ch === '\\') { str += src[i] || ''; i++; continue; }
        if (ch === c) break;
      }
      parts.push({ code: false, text: str });
      continue;
    }
    buf += c;
    i++;
  }
  if (buf) parts.push({ code: true, text: buf });

  let out = '';
  for (const p of parts) {
    if (!p.code) { out += p.text; continue; }
    let t = p.text.replace(/[\s]+/g, ' ');
    t = t.replace(/ ?([{};:>]) ?/g, '$1');
    t = t.replace(/,\s*/g, ',');
    t = t.replace(/;\}/g, '}');
    out += t;
  }
  return out.replace(/ ?\n ?/g, '\n').trim();
}

/** 压缩后用 V8 重新解析一遍，语法有问题立刻失败 */
function assertParses(code, label) {
  try {
    new vm.Script(code, { filename: label });
  } catch (e) {
    throw new Error(label + ' 压缩后语法错误：' + e.message);
  }
}

const jsBundle = (files) => {
  const src = files.map(read).join('\n\n');
  return MINIFY ? minifyJs(src) : src;
};

const cssBundle = (file) => (MINIFY ? minifyCss(read(file)) : read(file));

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
  const ver = JSON.parse(read('manifest.json')).version;
  const tpl = read('index.tpl.html');
  const css = cssBundle('styles.css');
  const js = jsBundle(['lunar.js', 'event-core.js', 'app.js']);
  assertParses(js, 'index.html 内联脚本');

  const html = tpl
    .replace('/*INJECT_STYLES*/', () => css.trim())
    .replace('/*INJECT_SCRIPTS*/', () => js.trim())
    .replace(/__CD_VERSION__/g, ver);

  if (!html.includes('window.Lunar') && !html.includes('global.Lunar')) {
    throw new Error('index.html 未包含农历模块');
  }
  if (/<script\s+src=/i.test(html)) throw new Error('index.html 不得引用外部脚本');
  if (/\b(?:src|href)\s*=\s*["']https?:\/\//i.test(html)) throw new Error('index.html 不得引用外链资源');
  if (/@import\s+url/i.test(html)) throw new Error('index.html 不得 @import 外部样式');
  // 内联脚本里出现 </script> 或 <!-- 会把 HTML 提前截断，写盘前先拦住
  if (/<\/script|<!--/.test(js)) throw new Error('内联脚本含 </script> 或 <!--，会截断 HTML');
  // 宿主对单文件有 100KB 上限：超了装不上，所以由构建兜底。
  // 未压缩构建（BUILD_MINIFY=0）仅用于排查，超限时只提示不拦截。
  const idxBytes = Buffer.byteLength(html, 'utf8');
  if (idxBytes > 100 * 1024) {
    if (MINIFY) {
      throw new Error('index.html 超过 100KB（' + (idxBytes / 1024).toFixed(1) + ' KB），宿主无法加载');
    }
    console.warn('  ⚠️ 未压缩构建 ' + (idxBytes / 1024).toFixed(1) + ' KB，超过宿主 100KB 上限，仅用于排查');
  }
  return html;
}

function buildPluginJs() {
  const head =
    '/* 里程碑 — 插件宿主脚本（由 build.js 自动生成，勿直接编辑） */\n';
  const code = jsBundle(['lunar.js', 'event-core.js', 'reminder-tasks.js', 'plugin-main.js']);
  assertParses(code, 'plugin.js');
  const out = head + code;
  if (Buffer.byteLength(out, 'utf8') > 100 * 1024) {
    throw new Error('plugin.js 超过 100KB，宿主无法加载');
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
 * 命名一致性闸门：一个项目只允许一个机器标识。
 * zip 名、社区插件 id、package.json 名都从 manifest.id 派生，任何一处写错都会让
 * 安装包名与身份对不上（历史问题：package.json 曾长期停在 2.3.0，manifest 已到 2.5.2）。
 */
function assertNaming(manifest) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  } catch (e) {
    throw new Error('package.json 读取失败: ' + e.message);
  }
  if (pkg.name !== manifest.id) {
    throw new Error(
      '命名不一致：package.json name="' + pkg.name + '" 与 manifest.id="' + manifest.id + '" 不同，' +
      '两者必须一致（zip 名由 manifest.id 决定）'
    );
  }
  if (pkg.version !== manifest.version) {
    throw new Error(
      '版本不一致：package.json ' + pkg.version + ' ≠ manifest.json ' + manifest.version +
      '，改版本时两处都要改'
    );
  }
  if (!String(manifest.name || '').trim()) throw new Error('manifest.name（显示名）不能为空');
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
  assertNaming(manifest);

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
    'loadSyncedData:function(){return Promise.resolve(JSON.stringify(window.__DEMO__))},' +
    'persistDataSynced:function(s){window.__DEMO__=JSON.parse(s);return Promise.resolve()},' +
    'openDialog:function(c){var b=c&&c.buttons||[];return Promise.resolve(b.length?b[b.length-1].label:"确定")}' +
    '};</script>';
  const demo = indexHtml.replace('</body>', demoMock + '\n</body>');
  fs.writeFileSync(path.join(PREVIEW, 'demo.html'), demo, 'utf8');

  const zipName = `${manifest.id}-v${manifest.version}.zip`;
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
  console.log(`  index  : ${idxKb} KB / 100 KB 上限`);
  console.log(`  安装包 : releases/${writtenName}  (${kb} KB)`);
  console.log(`  sha256 : ${sha}`);
  console.log(`  预览   : dist/index.html`);
}

// 直接执行时构建；被测试 require 时只导出压缩器等工具函数
if (require.main === module) {
  main();
}

module.exports = { minifyJs, minifyCss, buildIndexHtml, buildPluginJs, assertNaming, read };
