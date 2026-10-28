# Milestones

**English** · [中文](#里程碑)

A Super Productivity plugin for countdowns, anniversaries, birthdays and festivals — with lunar-calendar conversion, festival presets, bilingual UI (English / 简体中文) and cross-device sync.

## Features

| Capability | Description |
| --- | --- |
| Four types | Birthday, anniversary, countdown and festival, each with its own time semantics |
| Preset festivals | 18 common festivals grouped by Gregorian / lunar / solar term, **multi-select to add in one go**; custom festivals supported |
| Two time metrics | Countdowns and birthdays show **days left** (amber), anniversaries show **days passed** (teal) |
| Sorting | Sooner countdowns on top, older anniversaries on top; the featured card takes the first entry of the current category |
| Featured card | Can be switched off in settings so the list starts at the very top |
| Age in the name | Birthdays get the age appended **at render time**, e.g. "Mom's birthday (55)"; only the plain name is stored |
| Lunar support | Lunar birthdays / anniversaries are converted automatically, so every launch shows this year's Gregorian date |
| Leap months | People born in a leap month are celebrated on the same month/day in years without one |
| Reminders as tasks | Every entry can decide on its own whether to create a task; on = inserted, off = deleted |
| Snackbar (optional) | A second, independent channel: each entry can also ask for a snackbar when the app opens |
| Archive | Archived entries hide from "All" and stop reminding; the "Archive" chip at the right end is the entry point |
| Anniversary years | Anniversaries show "7 years", correct across year boundaries |
| Dark mode | Follows the app theme automatically |
| Bilingual | English and Simplified Chinese; follows the app language, switchable in settings |
| Cross-device sync | Uses the app's own sync channel, so desktop / mobile / web stay consistent |

## Installation

**Option 1: manual install (recommended, works everywhere)**

1. Open Super Productivity → `Settings` → `Plugins`
2. Click `Choose Plugin File`
3. Select `releases/sp-milestone-v1.0.0.zip`
4. After installing, a "Milestones" entry appears in the left navigation

> No need to unzip. The web version cannot download automatically because of browser CORS rules — download the ZIP manually and install it the same way.

**Option 2: from source**

Zip the four files in `dist/` and install that ZIP; `node build.js` generates them.

## Usage

- Tap **Add** in the top-right corner, choose type, calendar and date; the gear next to it opens settings
- **Adding from a category pre-selects that type**: create inside "Anniversaries" and the type is already anniversary; inside "All" the default is birthday. The type can always be changed and the form title follows
- After choosing **Lunar**, pick year / month / day from the three selects; the matching Gregorian date, sexagenary cycle and zodiac are shown below in real time
- Tap any card to edit or delete it
- The filter bar on top filters by type; **"Archive" is a separate view**

**About festivals**: with type = Festival, the form shows a "Preset festivals" block in three groups:

| Group | Festivals | Date source |
| --- | --- | --- |
| Gregorian | New Year's Day, Valentine's Day, Women's Day, Labour Day, Children's Day, National Day, Christmas | Fixed month/day |
| Lunar | Lunar New Year's Eve, Spring Festival, Lantern Festival, Longtaitou, Dragon Boat, Qixi, Ghost Festival, Mid-Autumn, Double Ninth, Laba | Lunar month/day, so the Gregorian date moves every year |
| Solar term | Qingming | Computed from the solar-term formula, landing on April 4-5 |

- Selecting one preset fills name, calendar, date and colour at once — all still editable afterwards
- **Presets can be multi-selected**: tick a few and the save button becomes "Add 3", creating them in one tap
- "Custom festival" skips presets: enter your own name and date, still counted down every year
- Festivals behave like countdowns: **days left**, rolling to the same date next year once passed
- Lunar festivals follow the lunar calendar: this year's Mid-Autumn is lunar 8/15, next year it maps to a different Gregorian date
- **Lunar New Year's Eve is the last day of the 12th lunar month**, falling back to day 29 in short years
- Qingming stores the solar term rather than a hard-coded date, so it is always right

**Why calendar and date disappear when a preset is picked**: the preset already knows how the date is computed, so extra selects would only create ambiguity. With a single selection the name stays editable; **with a multi-selection name and colour are hidden too**, because each festival uses its own name and colour. To edit a date by hand, pick "Custom festival" and the calendar and date controls reappear.

**About archiving**: while editing any entry you will see an "Archive" switch (**festivals do not have it** — they come back every year, so archiving makes no sense). When on, the entry:

- no longer appears in "All" or any category, only in the "Archive" view
- **stops reminding** (its task is deleted and no snackbar appears)
- keeps its reminder configuration, restored when you unarchive

The archive view lives behind the "Archive" chip at the right end of the filter bar, with a count (e.g. "Archive 3"). Creating an entry inside the archive view defaults to archived — that entry point is meant for "minor dates I just want to note down".

**How to read the list**:

- The big number and unit on the right are the metric: **days left** (amber) counts down to the date; **days passed** (teal) counts up from it
- Sorting: countdowns first with the nearest on top; elapsed entries afterwards with the oldest on top. Something happening today shows 0 days left and ranks first
- The large card on top is "the first entry of the current section": inside Birthdays it is the next birthday, inside Anniversaries the oldest one
- An empty section keeps a dashed placeholder card, so switching categories never collapses the layout
- The featured card can be disabled in settings; the list then starts at the top

**About expired countdowns**: while editing a countdown there is a "**Restart after the date passes**" switch:

| Switch | After the date |
| --- | --- |
| On (default) | Rolls over to the same day next year and keeps counting — it never expires |
| Off | Stops in place and switches to "days passed", growing every day |

**Strike-through once expired**: a countdown with the switch off that has passed gets its name struck through (the line extends slightly beyond the text) and its type tag replaced by a grey "**Expired countdown**". To drop the line, turn off "Strike through expired countdowns" in settings — the tag still marks it. Birthdays, anniversaries and festivals are unaffected.

**About the age**: the age is never written into the name, only appended while rendering. The input therefore always holds the plain name, and searching / exporting / sorting is not disturbed by it. Even if you type "（55）" by hand it is stripped on save, so you never get double brackets.

**Lunar details**: the 12th lunar month sometimes has 29 days instead of 30, and people born in a leap month are handled by the regular month in years without one — both cases fall back automatically, so "no birthday this year" cannot happen.

### Reminders: two channels, chosen per entry

Reminders are **not** a global switch. Every entry has two independent switches on its edit page:

| Switch | When on | When off |
| --- | --- | --- |
| Add to task list | A task is inserted into the "Milestones" project | The task is deleted immediately |
| Snackbar on app open | A snackbar appears when the app starts or the day rolls over | Nothing appears |

Both can be on, only one, or neither. When both are off the form says "This entry will not remind you" instead of failing silently.

**Lead days** (same day / 1 / 3 / 7 / 30, multi-select) are shared by both channels: the task list uses the nearest slot, the snackbar fires on each matching day.

A task's **due date is the day you want to be reminded**. With "3 days before" the task is due 3 days early. One entry owns one task, no per-slot duplicates; when a slot passes the task moves to the next nearest one.

A task looks like this (the type is marked with an icon):

```
🎂 Mom's birthday (59)
Birthday · Lunar month 4, day 18 · yearly
Reminder 3 days before · due 2027-05-11
cd:ev=e1;cy=2027-05-14
```

The last line is a marker the plugin uses — please do not delete it, cross-device recognition depends on it. If it is gone, the local map table can still recover it.

**Edits and deletions leave no leftovers.** The plugin treats tasks as a projection of the data and reconciles on every change (after saving, on start, every 10 minutes), comparing expected with actual:

| What you do in the plugin | What the task list does |
| --- | --- |
| Rename / change date / change lead days | The same task is updated in place, no duplicates |
| Turn off "Add to task list" for one entry | Its task is deleted, others are untouched |
| Archive the entry | Its task is deleted |
| Delete the entry | Its task is deleted |
| Tick the task as done | It does not come back until the next yearly cycle |
| Delete the task manually | It is recreated automatically |

⚠️ The last row is a deliberate trade-off: if deleting the task meant cancelling the reminder, one mis-tap would silence it forever. To really cancel, turn off "Add to task list" in that entry.

### Snackbar

The snackbar is decided **per entry**, not globally. With "Snackbar on app open" enabled:

- Several due entries merge into one message, e.g. "today · Mom's birthday (59) | tomorrow · Project launch"
- The same slot on the same day only fires once, app restarts do not repeat it
- It only appears while the app is open or being opened — plugins have no system-level push, nothing is delivered when the app is closed

**Why the task-list channel helps**: task due dates travel with the app data, so whenever you open the app you see due and overdue tasks, instead of "that moment passed while the app was closed".

## Data and sync

- Data is written through the plugin sync API and follows the sync method you configured in the app (SuperSync / Dropbox / WebDAV…), no extra login
- Remote changes refresh the UI automatically with a notice
- Everything is plain JSON and can be exported with the app's "Export data"

Structure:

```json
{
  "version": 6,
  "settings": {
    "taskProject": "Milestones",
    "hero": true,
    "strikeExpired": true,
    "lang": "auto"
  },
  "events": [
    {
      "id": "e1",
      "title": "Mom's birthday",
      "kind": "birthday",
      "calendar": "lunar",
      "date": "1968-05-14",
      "lunar": { "year": 1968, "month": 4, "day": 18, "isLeap": false },
      "term": null,
      "preset": null,
      "repeat": true,
      "color": "#d6336c",
      "note": "",
      "remind": { "task": true, "snack": false, "offsets": [0, 1, 3] },
      "archived": false
    }
  ]
}
```

`kind` is one of `birthday` / `anniversary` / `countdown` / `festival`.

`preset` holds the preset festival key (e.g. `zhongqiu`), `null` for custom festivals; `term` holds a solar-term key (only `qingming` for now) — when set, the date is computed instead of read from `date`. Both are merely **provenance**; deleting them does not break rendering.

`remind` is **per entry**: `remind.task` (default `true`), `remind.snack` (default `false`), `remind.offsets` (only `0 / 1 / 3 / 7 / 30`, default `[0, 1]`).

`archived: true` means the entry only shows in the archive view and produces neither tasks nor snackbars.

`settings` holds four keys: `taskProject` (project name, defaults to "Milestones"/"里程碑提醒" depending on language), `hero` (featured card, default `true`), `strikeExpired` (strike-through, default `true`), and `lang` (`auto` / `zh` / `en`…, default `auto`).

> **The data format is not backwards compatible**: the plugin has not been released publicly and only guarantees the current format (`version: 6`). Old fields (`settings.taskSync` / `settings.snackOnOpen` / `settings.leapPolicy`, `remind.on`, event `pinned`, `repeat: "yearly"`) are ignored, not migrated. If you need to restore a very old backup, use "Clear Milestones data cache" in settings and re-enter the data.

`title` stores the plain name — ages and anniversary years are computed and appended at render time, so "55" never gets frozen into the data.

### Clearing data

"Clear Milestones data cache" at the bottom of the settings panel exists for troubleshooting after an upgrade (garbled data, duplicated tasks, wrong dates):

1. Tap → the first dialog explains the impact: all entries and settings are cleared and the tasks this plugin created are removed
2. Tap "Clear" → the action really happens. Cancelling at any step changes nothing

Three things happen: the synced data is reset, the local task map / seen records / handled records are wiped, and the write happens **immediately** (not through the 200 ms debounce, so a stale value cannot pull it back). The next reconciliation removes every task the plugin created — other tasks and projects are untouched.

You can keep creating entries right away; no reinstall needed.

## Internationalization

- **The plugin follows the language you set in Super Productivity.** Resolution order: the language chosen inside the plugin → the app language (`PluginAPI.getCurrentLanguage()`, falling back to `cfg.lang` and the `languageChange` payload) → the system language → English as a last resort
- In **Settings → Language** you can keep "Auto" (follow the app) or pin a specific language. The choice is stored in the synced data, so it travels with your devices
- When you switch the app language, the plugin UI re-renders immediately (the `languageChange` hook) and the reminder tasks are regenerated in the new language on the next reconciliation
- **One exception: the left-navigation entry.** Its label is a string handed to the host at registration time and Super Productivity exposes no API to rename a registered entry (re-registering would simply add a second entry). The label is therefore taken in the language active when the plugin loads; switching the app language at runtime shows a one-tap **Restart** prompt, and after a restart the label matches again
- Task titles and notes are generated in the active language, including lunar dates, festival names, weekdays, the sexagenary cycle and zodiac
- Adding a language never touches the UI code — see below

### Contributing a translation

```
src/locales/
├── zh.js   # base language: every key is defined here first
└── en.js   # English
```

1. Copy `src/locales/zh.js` to `src/locales/<code>.js` (e.g. `fr.js`, `ja.js`)
2. Translate the **values only** — leave the keys alone — and set `__name` to the language's own name (e.g. `'Français'`)
3. Run `npm run build`

That's it: the build picks up every file in `src/locales/` automatically, the language shows up in the settings list without any code change, and `npm run test:i18n` checks that keys and `{placeholders}` match the base language.

Notes for translators:

- Missing keys fall back to Chinese at runtime, so a partial translation already works — but `zh` and `en` are required to be complete by CI
- Keep `{name}`, `{n}`, `{date}`-style placeholders intact and do not add or drop any
- `set.heroHint`, `set.strikeHint`, `set.clearHint`, `set.legendHint` and the two hero labels may contain `<b>` markup — and **only** `<b>`: every other tag or attribute is stripped at render time, so a language pack can never inject markup or scripts
- Plural forms live in `plural.*`; `kindl.*` are the lower-case forms used inside sentences, `kind.*` the capitalised labels

## Platform support

| Platform | Status | Notes |
| --- | --- | --- |
| Windows / macOS / Linux | ✅ | Full functionality |
| Android | ✅ | iframe full-page view, safe-area aware |
| iOS | ✅ | Same as above |
| Web | ✅ | Manual ZIP install |

Platform differences are deliberately avoided: the UI is an iframe full-page view (one render path everywhere), no Node APIs, no CDN resources, no optional chaining, no `crypto.randomUUID`.

## Known limits

- Lunar data covers **1900–2100**. Dates outside the range show "Out of range" instead of crashing
- The lunar conversion uses a cumulative-day table based on 1900-01-31; it is verified with 73,384 round-trip days and 201 lunar-year lengths
- **Reminders do not push by themselves**: tasks appear on time, but "notify me at that moment" still requires the app to be running — plugins have no system-level background push (host design)
- **Uninstalling does not clean up generated tasks**: they stay in the reminder project. Either turn off "Add to task list" for each entry before uninstalling, or delete the project afterwards
- The `cd:ev=…` marker in task notes is the recognition key; if the notes are wiped during a cross-device sync, a duplicate task may appear temporarily (the next reconciliation removes it)
- Task sync requires the host task API (`getAppState` / `addTask` / `updateTask` / `deleteTask`). Older versions degrade to "snackbar only" without errors

## Development

```bash
npm install        # jsdom is only needed for tests
npm run build      # writes dist/ and releases/*.zip, refreshes preview/demo.html
npm test           # lunar + core + i18n + DOM + task projection + host scheduling + static checks
npm run test:i18n  # locale completeness / placeholder / priority checks
npm run demo       # open the preview page in a browser
```

**About size**: `index.html` must be self-contained (styles and scripts inlined — iframe plugins are served through `srcdoc`, and arbitrary extra files from the ZIP are not served to the iframe), so the build concatenates the sources into one page. Nothing is minified: each section keeps its comments and indentation behind a `/* ===== src/<file> ===== */` banner, so you can open `dist/index.html` and read it like the source. The only hard limit is 1024 KB (the build fails beyond that, and warns from 768 KB).

Language packs stay one file per language in `src/locales/`, but the build merges them into a single "key → per-language values" payload so a key name is stored once. Current build: `index.html` 140.7 KB, `plugin.js` 87.7 KB, ZIP 70.5 KB.

Source layout:

```
src/
├── locales/        语言包 zh.js / en.js（加语言只加文件）
├── i18n.js         language registry, t(), static-text applier
├── lunar.js        lunar conversion (1900-2100, leap months)
├── event-core.js   data model, next-occurrence math, localized labels
├── reminder-tasks.js  reminder → task projection and reconciliation (pure functions)
├── app.js          UI logic inside the iframe
├── styles.css      styles (follows host theme variables)
├── index.tpl.html  HTML template
├── plugin-main.js  host side: entries, task reconciliation, optional snackbar
├── manifest.json   plugin manifest
└── icon.svg        icon
build.js            zero-dependency bundler (with a minimal ZIP writer)
test/               seven test suites
```

### Naming conventions

One project, one machine identifier; every other name derives from it:

| Purpose | Value | Source |
| --- | --- | --- |
| Machine id (`manifest.id`) | `milestone` | single source of truth |
| Project name (`package.json` name) | `sp-milestone` | `sp-` + `manifest.id` |
| Package file name | `sp-milestone-v<version>.zip` | project name + `manifest.version` |
| Display name (nav, title) | 里程碑 / Milestones | language pack `appName` |
| Default reminder project | 里程碑提醒 / Milestones | language pack `projectDefault` |

`npm run build` validates that `package.json` name equals `sp-<manifest.id>` and that both versions match; anything else fails the build.

> There is also an internal `cd-` prefix (CSS classes, CSS variables, `localStorage` keys, `data-cd-theme`). It stands for **c**ount**d**own and is only a UI namespace, unrelated to the plugin identity. Renaming it would touch 700+ places with no functional gain, so it stays.

Always run `npm test` after changes — the DOM suite performs real form interactions and sync writes.

The repo ships a VSCode setup (`.vscode/`): press F5 in any test file to build and debug it, or pick "run all tests" / "build plugin package" from the debug panel. `dist/` and `preview/` are generated and marked read-only; edit files under `src/`.

## Getting listed in the community plugin list

Open a PR against the upstream `src/assets/community-plugins.json` adding:

```json
{
  "name": "里程碑 / Milestones",
  "shortDescription": "Countdowns, anniversaries, birthdays and festivals with lunar presets and cross-device sync. / 倒数日、纪念日、生日与节日管理，内置农历节日预设，支持跨设备同步与中英双语。",
  "url": "https://github.com/<you>/sp-milestone",
  "author": "<you>",
  "id": "milestone",
  "release": {
    "version": "1.0.0",
    "downloadUrl": "https://github.com/<you>/sp-milestone/releases/download/v1.0.0/sp-milestone-v1.0.0.zip",
    "sha256": "<从 node build.js 输出复制>"
  }
}
```

`id` must equal `manifest.json`'s `id`, `version` must equal the manifest version. The `sha256` is determined by the source: the build uses fixed ZIP timestamps, so rebuilding the same source yields the same hash (reproducible builds). `node build.js` prints the current value.

---

# 里程碑

**中文** · [English](#milestones)

Super Productivity 插件。管理倒数日、纪念日、生日和节日，**支持农历换算与预设节日**，数据随应用同步在设备间流转；界面中英双语，**默认跟随软件的语言设置**。

## 功能

| 能力 | 说明 |
| --- | --- |
| 四种类型 | 生日、纪念日、倒数日、节日，各自有独立的计时语义 |
| 预设节日 | 18 个常用节日按公历 / 农历 / 节气分组，**可多选一次批量添加**；也可自定义节日 |
| 两种时间口径 | 倒数与生日显示**剩余天数**（橙黄），纪念日显示**已过天数**（蓝绿） |
| 时间排序 | 倒数越近越靠上，已过的越久越靠上；顶栏下的置顶卡片取当前分区的第一条 |
| 置顶卡片 | 可在设置里关掉，关掉后列表直接贴顶，一屏多看几条 |
| 年龄入名 | 生日在**显示时**于名称后加年龄，如「我妈生日（55岁）」；数据里只存纯名称 |
| 农历支持 | 农历生日/纪念日自动换算，每次打开都是当年对应的公历日期 |
| 闰月处理 | 闰月出生的人，在无闰月的年份自动按同月同日过 |
| 提醒进任务列表 | 每个事项可以单独选择是否生成任务；开着就插入，关掉就删除 |
| 提示条（可选） | 另一个独立渠道：每个事项可以单独选择「打开应用时弹一下」，与任务列表互不影响 |
| 归档 | 每个事项可归档：不在「全部」里显示，也不再提醒；筛选条最右边的「归档」就是归档视图的入口 |
| 周年显示 | 纪念日显示「7 周年」，跨年准确 |
| 深色模式 | 跟随应用主题，自动切换配色 |
| 双语界面 | 中文 / English，跟随软件语言，也可在设置里单独指定 |
| 跨设备同步 | 依赖应用自身的同步通道，桌面 / 移动端 / 网页数据一致 |

## 安装

**方式一：手动安装（推荐，各平台通用）**

1. 打开 Super Productivity → `设置` → `插件`
2. 点击 `Choose Plugin File`（选择插件文件）
3. 选中 `releases/sp-milestone-v1.0.0.zip`
4. 安装后，左侧导航出现「里程碑」入口

> 不需要解压 ZIP。网页版因浏览器跨域限制无法自动下载，请手动下载 ZIP 后用同样方式安装。

**方式二：源码调试**

把 `dist/` 目录下的四个文件打包成 ZIP 再安装即可，`node build.js` 会自动生成。

## 使用

- 点击右上角「添加」，选择类型、历法、日期；右边的齿轮是设置
- **在某个分类下点添加，类型会自动选中该分类**：在「纪念日」里新建，类型默认就是纪念日；在「生日」里新建就是生日；「全部」视图下默认生日。类型仍可随时手动改，表单标题会跟着变
- 选择「农历」后，用年 / 月 / 日三个下拉框指定农历日期，下方会实时显示对应公历、干支与生肖
- 点击任意卡片可编辑或删除
- 顶部筛选条可按类型过滤；**「归档」是单独一个视图**

**关于节日**：类型选「节日」后，表单会多出一块「预设节日」选择区，分三组：

| 分组 | 节日 | 日期来源 |
| --- | --- | --- |
| 公历 | 元旦、情人节、妇女节、劳动节、儿童节、国庆节、圣诞节 | 固定月日 |
| 农历 | 除夕、春节、元宵节、龙抬头、端午节、七夕、中元节、中秋节、重阳节、腊八节 | 农历月日，每年公历日期不同 |
| 节气 | 清明 | 按节气公式推算，每年落在 4 月 4-5 日 |

- 选中一个预设，名称、历法、日期、颜色一次性填好，之后仍可改名称或换颜色
- **预设可以多选**：一次勾选几个节日，保存按钮会变成「添加 3 个」，点一下就按各自预设批量建好
- 选「自定义节日」则不套预设：自己填名称和日期，一样每年倒数
- 节日与倒数日口径相同：显示**剩余天数**，过完自动滚到下一年的同一天
- 农历节日按农历算：今年中秋是八月十五，明年就自动变成另一个公历日
- **除夕按腊月最后一天计算**，腊月只有廿九天的年份自动按廿九，不会算错一天
- 清明的公历日期每年会漂移，保存的是「节气」而不是死日期，因此永远准

**为什么选中预设后历法、日期就不见了**：预设已经知道日期该怎么算，再摆一排下拉框只会有歧义。单选时名称仍可改；**多选时名称和颜色也收起**——一次加多个，每个节日用自己的名字和配色才是合理的。任何一步想手工改日期，点「自定义节日」即可。

**关于归档**：编辑任意事项时会看到「归档」开关（**节日没有这个开关**——节日每年都会再来）。打开后该事项：

- 不再出现在「全部」以及各个分类里，只出现在「归档」视图
- **不会再提醒**（任务列表里对应的任务会被删除，提示条也不会弹）
- 提醒配置本身会保留，取消归档后按原设置恢复

归档视图的入口是筛选条最右边的「归档」，后面会跟着数量（如「归档 3」）。在归档视图里点「添加」，新建的事项默认就是归档状态。

**列表怎么读**：

- 右侧大数字 + 单位是该条目的时间口径。**剩余天数**（橙黄）表示还有多少天到期；**已过天数**（蓝绿）表示从那天起已经走了多久
- 排序：倒数类在上，剩余天数越少越靠上；已过类在下，已过天数越多越靠上
- 顶部的大卡片是「当前分区最靠前的那一条」：在「生日」里就是最近的生日，在「纪念日」里就是最久的那个纪念日
- 某个分区还没有记录时，卡片位置会保留一张虚线占位卡，切换分类不会出现页面塌陷
- 设置里可以关掉这张置顶卡片

**关于倒数日过期**：编辑倒数日时有一个「**过期后重新开始倒数**」开关：

| 开关 | 过了那天之后 |
| --- | --- |
| 打开（默认） | 自动滚到明年的同一天，继续倒数，永远不会「过期」 |
| 关掉 | 停在原地，改显示「已过天数」，数字一天天变大 |

**过期后名称加删除线**：关掉上面那个开关的倒数日一旦过期，名称会划一条线，类型标签也从「倒数日」换成灰底的「**过期的倒数日**」。可在设置里关掉「倒数日过期后名称加删除线」——标签仍会标明过期。生日、纪念日、节日不受影响。

**关于年龄**：年龄不写进名称字段，只在渲染时拼接。编辑时输入框里始终是纯名称，搜索、导出、排序都不会被年龄干扰；即使手动输入了「（55岁）」，保存时也会自动去掉。

### 提醒：两个渠道，每个事项单独选

提醒**不是**一个全局总开关。每个事项的编辑页里有两个独立开关：

| 开关 | 打开后的效果 | 关掉后的效果 |
| --- | --- | --- |
| 加入任务列表 | 在项目「里程碑提醒」里插入一条任务 | 对应任务立即被删除 |
| 打开应用时弹提示条 | 应用启动或跨天检查时若到点，弹一条 snack | 不弹 |

两个可以都开、只开一个、或者都关。都关时表单会明确写「该事项不会提醒你」，不做静默失效。

**提前天数**（当天 / 1 / 3 / 7 / 30 天，可多选）对两个渠道共用：任务列表按最近的一档决定到期日，提示条在命中的那几天各弹一次。

任务的**到期日 = 该提醒你的那一天**。同一件事只占一条任务，不会每个档位各生成一条；某个档位过了，任务自动推进到下一个更近的档位。

任务长这样（类型用图标区分）：

```
🎂 妈妈生日（59岁）
生日 · 农历四月十八 · 每年
提前 3 天提醒 · 应处理日 2027-05-11
cd:ev=e1;cy=2027-05-14
```

最后一行是插件用的标记，别删它——跨设备靠它认出「这条任务是谁生成的」。删了也能在本机靠映射表补回。

**改、删都不留残骸。** 插件把任务当成数据的投影，数据一变就重新对账（保存后、启动时、每 10 分钟）：

| 你在插件里的操作 | 任务列表的反应 |
| --- | --- |
| 改名字 / 改日期 / 改提醒档位 | 同一条任务被就地更新，不会多出一条 |
| 关掉**该事项**的「加入任务列表」 | 对应任务被删除，其他事项不受影响 |
| 把该事项**归档** | 对应任务被删除 |
| 删除该事项 | 对应任务被删除 |
| 在任务列表里勾选完成 | 本轮不再出现，直到下一年度周期 |
| 在任务列表里手动删掉任务 | 会被自动重建 |

⚠️ 最后一条是刻意的取舍：如果删任务就等于取消提醒，误删一次就再也收不到。要真正取消，请回到该事项的编辑页关掉「加入任务列表」。

### 提示条

提示条是**每个事项各自决定**的。打开某个事项的「打开应用时弹提示条」后：

- 多条同时到点合并成一条，例如「今天 · 我妈生日（59岁）｜明天 · 项目上线」
- 同一天同一档位只提醒一次，重启应用不重复
- 只在应用被打开或正在运行时出现——插件没有系统级推送权限

## 数据与同步

- 数据通过插件同步存储 API 写入，跟随应用配置的同步方式（SuperSync / Dropbox / WebDAV 等），不需要单独登录
- 远程数据变更时会自动刷新界面并提示
- 所有数据为纯 JSON，可随应用「导出数据」一起备份

数据结构：

```json
{
  "version": 6,
  "settings": {
    "taskProject": "里程碑提醒",
    "hero": true,
    "strikeExpired": true,
    "lang": "auto"
  },
  "events": [
    {
      "id": "e1",
      "title": "妈妈生日",
      "kind": "birthday",
      "calendar": "lunar",
      "date": "1968-05-14",
      "lunar": { "year": 1968, "month": 4, "day": 18, "isLeap": false },
      "term": null,
      "preset": null,
      "repeat": true,
      "color": "#d6336c",
      "note": "",
      "remind": { "task": true, "snack": false, "offsets": [0, 1, 3] },
      "archived": false
    }
  ]
}
```

`kind` 取 `birthday` / `anniversary` / `countdown` / `festival`（节日）。

`preset` 是预设节日标识（如 `zhongqiu`），自定义节日为 `null`；`term` 是节气标识（目前只有 `qingming`），有值时日期由公式推算而不是读 `date`。两个字段都只是**记录来源**，删掉也不影响显示。

`remind` 是**每个事项自己的**提醒配置：`remind.task`（默认 `true`）、`remind.snack`（默认 `false`）、`remind.offsets`（取值限定 `0 / 1 / 3 / 7 / 30`，默认 `[0, 1]`）。

`archived` 为 `true` 时该事项只出现在归档视图，且不产生任务、不弹提示条。

`settings` 是四项：

- `taskProject`：任务归属的项目名，默认随语言（中文「里程碑提醒」/ 英文「Milestones」）
- `hero`：顶栏下方是否放大显示当前分区的第一条，默认 `true`
- `strikeExpired`：倒数日过期后名称是否加删除线，默认 `true`
- `lang`：语言偏好，`auto`（跟随软件语言）/ `zh` / `en`…，默认 `auto`

> **数据格式不向后兼容**：只保证当前格式（`version: 6`）可读。旧字段（`settings.taskSync` / `settings.snackOnOpen` / `settings.leapPolicy`、`remind.on`、事件的 `pinned`、`repeat: "yearly"`）会被直接忽略，不做折算迁移。真需要从很旧的备份恢复，可在设置里「清除里程碑数据缓存」后重新录入。

`title` 存的是纯名称，不含年龄、周年等展示信息——这些都在渲染时按当前日期计算并拼接。

### 清除数据

设置面板最下方的「清除里程碑数据缓存」是给升级后排查问题用的：

1. 点按钮 → 第一段确认说明影响面
2. 再点「确定清除」→ 才真正执行。中途任何一步点「取消」都不会改动任何数据

执行时会做三件事：把同步数据重置为 `{ version: 6, events: [] }`、清掉本机的任务映射表 / 已提示记录 / 已处理记录、**立刻写盘**（不等 200ms 防抖）。之后的下一次对账会把插件生成的任务全部移除——应用里的其他任务与项目不受影响。

## 国际化

- **默认跟随 Super Productivity 里设定的语言**。优先级：插件内选择的语言 → 软件语言（`PluginAPI.getCurrentLanguage()`，拿不到再看 `cfg.lang` 与 `languageChange` 载荷）→ 系统语言 → 英文兜底
- 设置面板的「语言」里可以保持「自动」（跟随软件），也可以固定成某个语言。选择存在同步数据里，跟着账号走到其它设备
- 在软件里切换语言时，插件界面会立刻重排（`languageChange` 钩子），提醒任务在下一次对账时用新语言重新生成
- **唯一的例外是左侧导航入口名称**：它是注册时交给宿主的一个字符串，而宿主没有「改已注册入口名称」的接口（重复注册只会多出一条入口）。所以名称取的是插件加载时生效的语言；运行时切语言会弹一次「重启」提示，重启后名称即跟上
- 任务标题与备注都用当前语言生成，包括农历日期、节日名、星期、干支与生肖

### 贡献翻译

```
src/locales/
├── zh.js   # 基准语言：所有键先在这里定义
└── en.js   # 英文
```

1. 复制 `src/locales/zh.js` 为 `src/locales/<语言代码>.js`（如 `fr.js`、`ja.js`）
2. **只改值、不动键名**，把 `__name` 改成该语言的自称（如 `'Français'`）
3. 执行 `npm run build`

就这样：构建会自动收录 `src/locales/` 下的所有文件，设置里的语言列表会自动多出一项，不需要改任何代码；`npm run test:i18n` 会校验键与 `{占位符}` 是否和基准语言一致。

给译者的几点：

- 缺键时会回落到中文，所以半成品也能用；但 `zh` 与 `en` 由 CI 要求 100% 完整
- `{name}`、`{n}`、`{date}` 这类占位符要原样保留，不能增删
- `set.heroHint`、`set.strikeHint`、`set.clearHint`、`set.legendHint` 与置顶卡片的两条文案里可能含 `<b>` 标签，且**只支持** `<b>`：其余标签与属性在渲染时会被剔除，语言包无法注入脚本
- 复数在 `plural.*`；`kindl.*` 是句子里的全小写形式，`kind.*` 是标签用的首字母大写形式
- 每多一种语言，`index.html` 约增加 9KB；768KB 起构建会警告，1024KB 直接失败

## 平台支持

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| Windows / macOS / Linux | ✅ | 桌面端完整功能 |
| Android | ✅ | iframe 全页视图，适配安全区 |
| iOS | ✅ | 同上 |
| 网页版 | ✅ | 手动安装 ZIP |

实现上刻意规避了平台差异：UI 走 iframe 全页视图，不依赖 Node API、不引用任何 CDN 资源、不使用可选链等较新语法，也不调用 `crypto.randomUUID`。

## 已知边界

- 农历数据覆盖 **1900–2100** 年。超出范围的日期显示「超出可算年限」，不会崩溃
- 农历换算采用 1900-01-31 为基准的累积天数查表算法，已用 73,384 天逐日往返校验、201 个农历年天数校验
- **提醒不会主动推送**：任务列表方式下任务会按时出现在列表里，但「到点弹通知」仍需应用在运行；插件没有系统级后台推送与常驻能力（宿主设计限制）
- **卸载插件不会清理已生成的任务**：卸载/禁用后任务会留在提醒项目里。卸载前把各个事项的「加入任务列表」关掉，或卸载后直接删除该项目
- 任务备注里的 `cd:ev=…` 标记是识别依据；跨设备时如果备注被清空，可能会多出一条重复任务（下次对账会删掉多余的那条）
- 任务同步需要宿主提供任务 API（`getAppState` / `addTask` / `updateTask` / `deleteTask`）。过旧的版本会自动降级为「只有提示条」，不会报错
- 语言列表来自已注册的语言包；宿主切到某语言而插件没有对应语言包时，按英文显示

## 开发

```bash
npm install        # 只有测试需要 jsdom
npm run build      # 生成 dist/ 与 releases/*.zip，并更新 preview/demo.html
npm test           # 农历 + 业务逻辑 + 国际化 + DOM 交互 + 任务投影 + 宿主调度 + 静态检查
npm run test:i18n  # 语言包完整性 / 占位符 / 语言优先级
npm run demo       # 在浏览器中打开预览页
```

**关于体积**：`index.html` 必须是自包含文档（iframe 插件走 `srcdoc` 加载，ZIP 里的其它文件不会被 serve 给 iframe），所以构建把源码原样拼成单页：**不做任何压缩**，每段前面带 `/* ===== src/<file> ===== */` 来源横幅，注释与缩进全部保留 —— 出问题直接打开 `dist/index.html` 当源码读。硬上限 1024KB（超过直接构建失败），768KB 开始警告。

语言包仍然一种语言一个文件（`src/locales/`），但构建时会被合成「键 → 各语言值」的列式结构，键名只存一份。当前产物：`index.html` 140.7 KB、`plugin.js` 87.7 KB、安装包 70.5 KB。

源码结构：

```
src/
├── locales/        语言包 zh.js / en.js（加语言只加文件）
├── i18n.js         语言注册表、t()、静态文案套用
├── lunar.js        农历换算（1900-2100，含闰月）
├── event-core.js   数据模型、下一次发生时间推算、随语言变化的标签
├── reminder-tasks.js  提醒→任务的投影与对账（纯函数）
├── app.js          iframe 内的界面逻辑
├── styles.css      样式（跟随宿主主题变量）
├── index.tpl.html  HTML 模板
├── plugin-main.js  宿主侧：入口注册、任务对账、可选提示条
├── manifest.json   插件清单
└── icon.svg        图标
build.js            打包脚本（零依赖，内含 ZIP 写入器）
test/               八组测试
```

### 命名约定

一个项目只允许**一个机器标识**，其余名字都从它派生：

| 用途 | 值 | 来源 |
| --- | --- | --- |
| 机器标识（`manifest.id`） | `milestone` | 唯一真源 |
| 项目名（`package.json` 的 `name`） | `sp-milestone` | `sp-` + `manifest.id` |
| 安装包文件名 | `sp-milestone-v<版本>.zip` | 项目名 + `manifest.version` |
| 显示名（左侧导航、标题） | 里程碑 / Milestones | 语言包 `appName` |
| 提醒任务默认项目名 | 里程碑提醒 / Milestones | 语言包 `projectDefault` |

`npm run build` 会先校验 `package.json` 的 `name` 等于 `sp-<manifest.id>`、且版本与 `manifest.json` 相同，不一致直接失败。

> 内部还有一层 `cd-` 前缀（CSS 类名、CSS 变量、`localStorage` 键、`data-cd-theme`）。它是 **c**ount**d**own 的缩写，属于界面命名空间，与上面的身份无关。

改动后务必跑 `npm test`——DOM 用例会真的执行表单交互和同步写入。

## 上架社区插件列表

向上游仓库的 `src/assets/community-plugins.json` 提交 PR，加入：

```json
{
  "name": "里程碑 / Milestones",
  "shortDescription": "Countdowns, anniversaries, birthdays and festivals with lunar presets and cross-device sync. / 倒数日、纪念日、生日与节日管理，内置农历节日预设，支持跨设备同步与中英双语。",
  "url": "https://github.com/<you>/sp-milestone",
  "author": "<you>",
  "id": "milestone",
  "release": {
    "version": "1.0.0",
    "downloadUrl": "https://github.com/<you>/sp-milestone/releases/download/v1.0.0/sp-milestone-v1.0.0.zip",
    "sha256": "<从 node build.js 输出复制>"
  }
}
```

`id` 必须与 `manifest.json` 的 `id` 一致，`version` 必须与清单版本一致。`sha256` 由源码决定：构建时使用固定的 ZIP 时间戳，因此同样的源码重复构建得到同样的哈希（可重现构建）。`node build.js` 会在终端打印当前值。
