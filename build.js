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

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const REL = path.join(ROOT, 'releases');

// 固定 ZIP 内时间戳，保证同样的源码构建出同样的 sha256（可重现构建）
// 需要覆盖时设置环境变量 BUILD_EPOCH（毫秒）
const STAMP = process.env.BUILD_EPOCH
  ? new Date(+process.env.BUILD_EPOCH)
  : new Date(Date.UTC(2026, 9, 26, 4, 0, 0));

const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

// 预览页示例数据
const DEMO_DATA = {
  version: 3,
  settings: { leapPolicy: 'regular', taskProject: '里程碑提醒', hero: true },
  events: [
    { id: 'd1', title: '妈妈生日', kind: 'birthday', calendar: 'lunar', date: '1968-05-14',
      lunar: { year: 1968, month: 4, day: 18, isLeap: false }, repeat: true,
      color: '#d6336c', note: '', pinned: false, createdAt: 1,
      remind: { task: true, snack: true, offsets: [0, 1, 3] } },
    { id: 'd2', title: '小米生日', kind: 'birthday', calendar: 'solar', date: '2019-11-08',
      lunar: null, repeat: true, color: '#f59f00', note: '', pinned: false, createdAt: 2,
      remind: { task: true, snack: false, offsets: [0, 1] } },
    { id: 'd3', title: '结婚纪念日', kind: 'anniversary', calendar: 'solar', date: '2018-06-16',
      lunar: null, repeat: true, color: '#c92a2a', note: '', pinned: false, createdAt: 3,
      remind: { task: true, snack: true, offsets: [0, 7, 30] } },
    { id: 'd4', title: '项目上线', kind: 'countdown', calendar: 'solar', date: '2026-12-01',
      lunar: null, repeat: false, color: '#1c7ed6', note: '', pinned: false, createdAt: 4,
      remind: { task: true, snack: true, offsets: [0, 1, 3, 7] } },
    { id: 'd5', title: '入职纪念', kind: 'anniversary', calendar: 'solar', date: '2021-03-01',
      lunar: null, repeat: true, color: '#0ca678', note: '', pinned: false, createdAt: 5,
      remind: { task: false, snack: false, offsets: [0, 1] } },
    { id: 'd6', title: '大学室友生日', kind: 'birthday', calendar: 'solar', date: '1994-03-12',
      lunar: null, repeat: true, color: '#7048e8', note: '', pinned: false, createdAt: 6,
      remind: { task: false, snack: false, offsets: [0] }, archived: true }
  ]
};

/* ---------------- 组装 ---------------- */

function buildIndexHtml() {
  const ver = JSON.parse(read('manifest.json')).version;
  const tpl = read('index.tpl.html');
  const css = read('styles.css');
  const js = [read('lunar.js'), read('event-core.js'), read('app.js')].join('\n\n');

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
  return html;
}

function buildPluginJs() {
  const head =
    '/* 里程碑 — 插件宿主脚本（由 build.js 自动生成，勿直接编辑） */\n';
  return head + [read('lunar.js'), read('event-core.js'), read('reminder-tasks.js'), read('plugin-main.js')].join('\n\n');
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
  fs.writeFileSync(path.join(REL, zipName), zipBuf);

  const sha = crypto.createHash('sha256').update(zipBuf).digest('hex');
  const kb = (zipBuf.length / 1024).toFixed(1);

  if (zipBuf.length > 10 * 1024 * 1024) throw new Error('ZIP 超过 10MB 上限');

  console.log('构建完成');
  console.log('  目录   : dist/');
  outFiles.forEach((f) => console.log(`    - ${f.name}  ${(f.data.length / 1024).toFixed(1)} KB`));
  console.log(`  安装包 : releases/${zipName}  (${kb} KB)`);
  console.log(`  sha256 : ${sha}`);
  console.log(`  预览   : dist/index.html`);
}

main();
