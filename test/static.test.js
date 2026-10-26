/**
 * 静态一致性检查：CSS 语法、类名交叉引用、清单完整性。
 *   node test/static.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let fail = 0;
function ok(c, label, detail) {
  if (!c) { fail++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
}

const css = read('src/styles.css');
const app = read('src/app.js');
const tpl = read('src/index.tpl.html');
const dist = read('dist/index.html');
const manifest = JSON.parse(read('src/manifest.json'));

console.log('[1] CSS 语法');
// 括号 / 注释 / 引号配平
let depth = 0, inComment = false, inStr = null, bad = 0;
for (let i = 0; i < css.length; i++) {
  const c = css[i], n = css[i + 1];
  if (inComment) { if (c === '*' && n === '/') { inComment = false; i++; } continue; }
  if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
  if (c === '/' && n === '*') { inComment = true; i++; continue; }
  if (c === '"' || c === "'") { inStr = c; continue; }
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth < 0) bad++; }
}
ok(depth === 0, '花括号配平', 'depth=' + depth);
ok(bad === 0, '无多余的 }');
ok(!inComment, '注释闭合');
ok(!inStr, '字符串闭合');

// 声明必须以分号结尾（粗检：块内最后一条声明）
const ruleBodies = css.match(/\{[^{}]*\}/g) || [];
let noSemi = 0;
for (const b of ruleBodies) {
  const inner = b.slice(1, -1).trim();
  if (!inner) continue;
  if (!/;\s*$/.test(inner) && !/^@/.test(inner)) noSemi++;
}
ok(noSemi === 0, '声明均以分号结束', noSemi + ' 处缺失');

console.log('[2] 类名交叉引用');
const defined = new Set();
(css.match(/\.[a-zA-Z][\w-]*/g) || []).forEach((m) => defined.add(m.slice(1)));

const used = new Set();
// app.js 里 class="..." / class=\'...\' 形式的类名
const classAttr = /class=(?:"|\\?')([^"'\\]+)/g;
let m;
while ((m = classAttr.exec(app))) {
  m[1].split(/\s+/).filter(Boolean).forEach((c) => {
    // 跳过动态拼接产生的前缀碎片
    if (/^[a-zA-Z][\w-]*$/.test(c)) used.add(c);
  });
}
// querySelector / closest 里的类选择器
const selRe = /(?:querySelector|closest|querySelectorAll)\(\s*'([^']+)'/g;
while ((m = selRe.exec(app))) {
  (m[1].match(/\.[a-zA-Z][\w-]*/g) || []).forEach((s) => used.add(s.slice(1)));
}
// 模板中的静态类名
const tplRe = /class="([^"]+)"/g;
while ((m = tplRe.exec(tpl))) {
  m[1].split(/\s+/).filter(Boolean).forEach((c) => used.add(c));
}

const missing = [...used].filter((c) => !defined.has(c));
ok(missing.length === 0, '所有使用的类名都有样式', missing.join(', '));

const jsOnly = [...used].filter((c) => c.startsWith('cd-')).length;
console.log(`     定义 ${defined.size} 个类，引用 ${used.size} 个，缺失 ${missing.length} 个`);

console.log('[3] 静态资源自包含');
ok(!/<script\s+src=/i.test(dist), 'index.html 无外部脚本');
ok(!/\b(?:src|href)\s*=\s*["']https?:\/\//i.test(dist), 'index.html 无外链资源');
ok(!/@import/i.test(dist), 'index.html 无 @import');
ok(!/\bfetch\(|XMLHttpRequest/.test(app), 'app.js 无网络请求');
ok(!/require\(|process\.|__dirname/.test(app), 'app.js 无 Node API 依赖');
ok(!/crypto\.randomUUID/.test(app), '未使用 crypto.randomUUID（兼容旧 WebView）');
ok(!/\?\.|\?\?/.test(app), '未使用可选链/空值合并（兼容旧 WebView）');

console.log('[4] 清单完整性');
['id', 'name', 'version', 'manifestVersion', 'minSupVersion', 'iFrame', 'permissions', 'hooks']
  .forEach((k) => ok(manifest[k] !== undefined, '字段 ' + k));
ok(manifest.iFrame === true, 'iFrame 为 true');
ok(Array.isArray(manifest.permissions), 'permissions 是数组');
ok(Array.isArray(manifest.hooks), 'hooks 是数组');
ok(manifest.icon && fs.existsSync(path.join(ROOT, 'src', manifest.icon)), '图标文件存在');
ok(/^\d+\.\d+\.\d+$/.test(manifest.version), '版本号为数字格式');

// 代码里注册的钩子必须在清单中声明，否则宿主不会投递（曾漏掉 taskComplete/taskDelete）
const mainJs = read('src/plugin-main.js');
const codes = new Set();
const codeHooks = [
  ['persistedDataChanged', 'PERSISTED_DATA_CHANGED'],
  ['taskDelete', 'TASK_DELETE'],
  ['taskComplete', 'TASK_COMPLETE'],
  ['taskCreated', 'TASK_CREATED'],
  ['taskUpdate', 'TASK_UPDATE']
];
codeHooks.forEach(([value, key]) => {
  if (mainJs.includes('Hooks.' + key)) codes.add(value);
});
const declared = new Set(manifest.hooks);
const missingHooks = [...codes].filter((h) => !declared.has(h));
ok(missingHooks.length === 0, '清单声明了代码用到的全部钩子', '缺少 ' + missingHooks.join(', '));
const unusedHooks = manifest.hooks.filter((h) => !codes.has(h));
ok(unusedHooks.length === 0, '清单没有多余钩子', '多余 ' + unusedHooks.join(', '));

console.log('[5] 构建产物');
const pj = read('dist/plugin.js');
ok(pj.includes('registerSidePanelButton'), 'plugin.js 注册入口按钮');
ok(pj.includes('showIndexHtmlAsView'), 'plugin.js 可打开全页视图');
ok(pj.includes('loadSyncedData'), 'plugin.js 读取同步数据');
ok(dist.includes('persistDataSynced'), 'index.html 具备写入能力');
ok(dist.includes('registerHook'), 'index.html 订阅同步钩子');
ok(/<meta charset="utf-8">/i.test(dist), '声明 UTF-8');
ok(/viewport/.test(dist), '移动端 viewport');
ok(!/\t/.test(css), 'CSS 未混用制表符');

// 体积
const total = ['manifest.json', 'plugin.js', 'index.html', 'icon.svg']
  .reduce((s, f) => s + fs.statSync(path.join(ROOT, 'dist', f)).size, 0);
ok(total < 1024 * 1024, '产物体积 < 1MB', (total / 1024).toFixed(0) + ' KB');
console.log(`     产物合计 ${(total / 1024).toFixed(1)} KB`);

console.log(fail === 0 ? '\n✅ 全部通过' : `\n❌ 失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
