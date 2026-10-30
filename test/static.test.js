/**
 * 静态一致性检查：CSS 语法、类名交叉引用、清单完整性。
 *   node test/static.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// 体积常量与自包含检查只有 build.js 一份，这里引用它，避免两处规则各写一遍又慢慢漂移
const { SIZE_WARN, SIZE_MAX, externalRefIssues } = require('../build.js');

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

const jsOnly = [...used].filter((c) => c.startsWith('ml-')).length;
console.log(`     定义 ${defined.size} 个类，引用 ${used.size} 个，缺失 ${missing.length} 个`);

console.log('[3] 静态资源自包含');
ok(!/<script\s+src=/i.test(dist), 'index.html 无外部脚本');
// 自包含 = 运行时不加载任何外部资源。<a href> 只是跳转，不算资源，规则见 build.js 的 externalRefIssues()
const extIssues = externalRefIssues(dist);
ok(extIssues.length === 0, 'index.html 不加载外部资源（跳转链接除外）', extIssues.join('；'));
// 关于里的作者与反馈地址：改模板时别把这两条信息弄丢（作者名单独成元素，不能只靠 URL 里出现）
ok(/class="ml-about-v">calmpunct</.test(dist), '关于里显示了插件作者 calmpunct');
ok(/<a\b[^>]*href="https:\/\/github\.com\/calmpunct\/sp-milestone\/issues"/i.test(dist),
  '关于里有反馈地址链接 github.com/calmpunct/sp-milestone/issues');
ok(!/@import/i.test(dist), 'index.html 无 @import');
ok(!/\bfetch\(|XMLHttpRequest/.test(app), 'app.js 无网络请求');
ok(!/require\(|process\.|__dirname/.test(app), 'app.js 无 Node API 依赖');
ok(!/crypto\.randomUUID/.test(app), '未使用 crypto.randomUUID（兼容旧 WebView）');
ok(!/\?\.|\?\?/.test(app), '未使用可选链/空值合并（兼容旧 WebView）');

console.log('[3.1] 拼 HTML 时文案一律转义');
// 语言包是第三方可贡献内容（见 src/i18n.js 的说明），不能当成可信 HTML 塞进 innerHTML。
// 这里做粗粒度静态约束：拼标签的行里，t('...') 必须包在 esc(...) / I.html(...) 里
const unsafeT = [];
app.split('\n').forEach((line, i) => {
  if (!/'</.test(line)) return;
  const re = /\bt\(\s*'/g;
  let m;
  while ((m = re.exec(line))) {
    const pre = line.slice(Math.max(0, m.index - 10), m.index);
    if (/esc\(\s*$/.test(pre) || /I\.html\(\s*$/.test(pre) || /\.html\(\s*$/.test(pre)) continue;
    unsafeT.push((i + 1) + ': ' + line.trim());
  }
});
ok(unsafeT.length === 0, '拼 HTML 的文案都经过 esc()/I.html()', unsafeT.join(' | '));
ok(!/FESTIVAL_GROUPS\[g\]\s*\+/.test(app), '节日分组标题也走 esc()');

console.log('[4] 清单完整性');['id', 'name', 'version', 'manifestVersion', 'minSupVersion', 'iFrame', 'permissions', 'hooks']
  .forEach((k) => ok(manifest[k] !== undefined, '字段 ' + k));
ok(manifest.iFrame === true, 'iFrame 为 true');
ok(Array.isArray(manifest.permissions), 'permissions 是数组');
ok(Array.isArray(manifest.hooks), 'hooks 是数组');
ok(manifest.icon && fs.existsSync(path.join(ROOT, 'src', manifest.icon)), '图标文件存在');
ok(/^\d+\.\d+\.\d+$/.test(manifest.version), '版本号为数字格式');

// 命名唯一真源：项目名 = sp-<manifest.id>，安装包名 = 项目名 + 版本，README 里写的必须与构建派生的一致，
// 任何一处手写都会漂移（历史问题：id 叫 countdown-days、项目名让 package.json 停在 2.3.0、README 写死旧包名）
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const readme = read('README.md');
const zipName = pkg.name + '-v' + manifest.version + '.zip';
ok(/^[a-z0-9-]+$/.test(manifest.id), 'manifest.id 为 kebab-case', manifest.id);
ok(pkg.name === 'sp-' + manifest.id, 'package.json name = sp-<manifest.id>', pkg.name + ' vs sp-' + manifest.id);
ok(pkg.version === manifest.version, 'package.json 版本与清单一致', pkg.version + ' vs ' + manifest.version);
ok(readme.includes(zipName), 'README 提到的安装包名与构建派生一致', zipName);
// 最低宿主版本：代码只按 19 的插件 API 写（getCurrentLanguage / onReady / onUnload），
// 宿主会拿它做硬校验，低于此版本直接拒绝安装，所以 README 里的要求必须与清单同值。
// 19.3.1 是本插件实测能用的下限：更低版本的宿主管线仍卡 index.html 的 100KB 上限，
// 装到一半报「index.html 大于 100kb」，报错与版本无关、极易被当成包损坏。
ok(manifest.minSupVersion === '19.3.1', '最低宿主版本 19.3.1', manifest.minSupVersion);
ok(readme.includes(manifest.minSupVersion), 'README 写明的最低宿主版本与清单一致', manifest.minSupVersion);
ok(!/countdown-days/.test(readme), 'README 里不再残留旧标识 countdown-days');
ok(!/plugin-milestone/.test(readme), 'README 里不再残留旧标识 plugin-milestone');
ok(!/super-productivity-milestone/.test(readme), 'README 里不再残留旧仓库名');
ok(manifest.isSkipMenuEntry === true, '清单关掉了宿主的自动菜单入口（避免与插件自注册的重复）');
ok(new RegExp('<title[^>]*>' + manifest.name + '</title>').test(dist), '页面标题与清单显示名一致', manifest.name);

// 显示名约定（README「命名约定」一份规则，这里四行断言钉住，避免以后又冒出 Milestones 变体）：
//   品牌位 = 单数 Milestone（清单 / 左侧入口 / 英文界面名）；中文界面称「里程碑」；
//   任务项目名是容器，英文用复数 Milestones —— 它已写进老用户数据，改默认值会多出一个项目。
const Core = require('../src/event-core.js');
const enDict = require('../src/locales/en.js');
const zhDict = require('../src/locales/zh.js');
const mainSrc = read('src/plugin-main.js');
const entryLabel = (/var ENTRY_LABEL = '([^']+)'/.exec(mainSrc) || [])[1];
ok(manifest.name === 'Milestone', '清单显示名固定为 Milestone（单数，不翻译）', manifest.name);
ok(entryLabel === manifest.name, '左侧导航入口名与清单显示名一致', entryLabel);
ok(enDict.appName === 'Milestone', '英文界面名与清单一致（单数，不带 s）', enDict.appName);
ok(zhDict.appName === '里程碑', '中文界面名用「里程碑」', zhDict.appName);
ok(!('projectDefault' in enDict) && !('projectDefault' in zhDict), '旧的任务项目名文案已移除（任务改落收件箱）');
ok(Core.TAG_DEFAULT === 'milestone', '提醒任务统一打 milestone 标签', Core.TAG_DEFAULT);
ok(!('tagDefault' in enDict) && !('tagDefault' in zhDict), '标签名不进语言包（跟着语言变会多出一个标签）');

// 代码里注册的钩子必须在清单中声明，否则宿主不会投递（曾漏掉 taskComplete/taskDelete）
// 宿主脚本与 iframe 界面都会注册钩子，两边都要扫
const mainJs = read('src/plugin-main.js');
const appHooks = read('src/app.js');
const codes = new Set();
const codeHooks = [
  ['persistedDataChanged', 'PERSISTED_DATA_CHANGED'],
  ['taskDelete', 'TASK_DELETE'],
  ['taskComplete', 'TASK_COMPLETE'],
  ['taskCreated', 'TASK_CREATED'],
  ['taskUpdate', 'TASK_UPDATE'],
  ['languageChange', 'LANGUAGE_CHANGE']
];
codeHooks.forEach(([value, key]) => {
  if (mainJs.includes('Hooks.' + key) || appHooks.includes('Hooks.' + key)) codes.add(value);
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

// 前缀统一 ml-：CSS 类与变量、DOM id、localStorage 键、任务备注标记都是同一套命名空间。
// 出现 cd- / cd:ev 说明又从前身（countdown-days）抄了东西进来。
const prefixSources = css + tpl + app + mainJs + read('src/reminder-tasks.js') + pj;
ok(!/cd-[a-z]|cd:ev/.test(prefixSources), '代码前缀统一 ml-，不残留 cd-');

// 体积
const sizes = {};
['manifest.json', 'plugin.js', 'index.html', 'icon.svg'].forEach((f) => {
  sizes[f] = fs.statSync(path.join(ROOT, 'dist', f)).size;
});
const total = Object.keys(sizes).reduce((s, f) => s + sizes[f], 0);
ok(total < 1024 * 1024, '产物体积 < 1MB', (total / 1024).toFixed(0) + ' KB');
ok(sizes['index.html'] <= SIZE_MAX, 'index.html 不超过上限 ' + SIZE_MAX / 1024 + 'KB',
  (sizes['index.html'] / 1024).toFixed(1) + ' KB');
ok(sizes['plugin.js'] <= SIZE_MAX, 'plugin.js 不超过上限 ' + SIZE_MAX / 1024 + 'KB',
  (sizes['plugin.js'] / 1024).toFixed(1) + ' KB');
if (sizes['index.html'] > SIZE_WARN) {
  console.log(`     提示：index.html ${(sizes['index.html'] / 1024).toFixed(1)} KB 超过 ${SIZE_WARN / 1024}KB 警示线`);
}
// 产物形态：可读优先 —— 内联的样式与脚本保留源码原样（注释、缩进），每段带来源横幅
const inlineJs = dist.match(/<script>([\s\S]*)<\/script>/)[1];
ok(inlineJs.includes('/* ===== src/event-core.js ===== */'), '内联脚本带来源横幅');
ok(/\n {2,}\S/.test(inlineJs), '内联脚本保留源码缩进');
ok(dist.includes('/* ===== src/styles.css ===== */'), '内联样式带来源横幅');
ok(inlineJs.includes('语言存在同步数据里'), '内联脚本保留源码注释');

// 宿主的安全检查（src/app/plugins/plugin-security.ts）只有一条正则：
//   /require\s*\(\s*['"`](fs|child_process)/  →  'Attempts to use Node.js APIs without permission - will fail'
// 源码里给单测用的 UMD Node 分支带 require('fs')，构建时必须剥离；
// 这里把整类 Node API 一起钉死，避免以后再加模块时又把 Node 带进产物。
const nodeApis = [
  [/\brequire\s*\(/, 'require()'],
  [/\bmodule\s*\.\s*exports\b/, 'module.exports'],
  [/\b__dirname\b/, '__dirname'],
  [/\b__filename\b/, '__filename'],
  [/\bprocess\s*\.\s*[A-Za-z_$]/, 'process.xxx']
];
nodeApis.forEach(([re, name]) => {
  ok(!re.test(pj), 'plugin.js 不含 Node API：' + name);
  ok(!re.test(inlineJs), 'index.html 不含 Node API：' + name);
});
console.log(`     产物合计 ${(total / 1024).toFixed(1)} KB（index ${(sizes['index.html'] / 1024).toFixed(1)} KB / plugin ${(sizes['plugin.js'] / 1024).toFixed(1)} KB）`);

console.log('[6] 不生成预览目录');
// preview/demo.html 已废弃：本地看效果直接开 dist/index.html。
// 这里钉死三条，防止构建脚本或 npm scripts 里又被加回来。
ok(!fs.existsSync(path.join(ROOT, 'preview')), '仓库里没有 preview 目录');
ok(!/['"]demo\.html['"]/.test(read('build.js')), 'build.js 不再写 demo.html');
ok(!(pkg.scripts && pkg.scripts.demo), 'package.json 没有 demo 脚本');

console.log(fail === 0 ? '\n✅ 全部通过' : `\n❌ 失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
