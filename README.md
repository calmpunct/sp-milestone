# 里程碑

**中文** · [English](#milestones)

Super Productivity 插件。管理倒数日、纪念日、生日和节日，数据随应用同步在设备间流转；界面中英双语，**默认跟随软件的语言设置**。农历换算做成了**可关的开关（默认关）**，不用农历的人在界面上看不到任何农历元素。

## 功能

| 能力 | 说明 |
| --- | --- |
| 四种类型 | 生日、纪念日、倒数日、节日，各自有独立的计时语义 |
| 预设节日 | 常用节日按公历 / 农历 / 节气分组，**可多选一次批量添加**；也可自定义节日（农历与节气分组随农历开关出现） |
| 两种时间口径 | 倒数与生日显示**剩余天数**（橙黄），纪念日显示**已过天数**（蓝绿） |
| 时间排序 | 倒数越近越靠上，已过的越久越靠上；顶栏下的置顶卡片取当前分区的第一条 |
| 置顶卡片 | 可在设置里关掉，关掉后列表直接贴顶，一屏多看几条 |
| 秒级计时 | 设置里「秒级计时 → 大卡片显示时分秒」，**默认关闭**。打开后大卡片在天数下面补一行小一号的「04 时 20 分 15 秒」，每秒走一格；「今天」不显示（已经到点）、「后天」自动多算一整天。切到后台、卡片被详情盖住时自动停算 |
| 农历开关 | 设置里「历法 → 启用农历系统」，**默认关闭**。关闭时界面、表单、节日预设里都没有农历；打开后日期按来源写作「公历（农历）」或「农历（公历）」 |
| 农历支持 | 打开后，农历生日 / 纪念日自动换算，每次打开都是当年对应的公历日期 |
| 到期提醒进任务列表 | 每个事项可以单独选择是否生成任务；打开就插入相关任务，关闭就删除相关任务 |
| 到期弹窗提醒 | 每个事项可以单独选择：到期弹窗提醒。与任务列表互不影响 |
| 归档 | 每个事项可归档：不在「全部」里显示，也不再提醒；筛选条最右边的「归档」就是归档视图的入口 |
| 详情页 | 点条目先看详情（天数、那个日子、下一次什么时候、提醒、备注一屏看全），右上角「编辑」才进表单 |
| 备注 | 每个事项可写 200 字备注；详情页下方单独成块显示，手动换行原样保留 |
| 跨设备同步 | 依赖应用自身的同步通道，桌面 / 移动端 / 网页数据一致 |

## 安装

**要求**：Super Productivity **19.0.0** 或更高版本（用到该版本才有的插件 API：`getCurrentLanguage` / `onReady` / `onUnload`）。低版本会在安装时被拒绝。

**方式一：手动安装（推荐，各平台通用）**

1. 打开 Super Productivity → `设置` → `插件`
2. 点击 `Choose Plugin File`（选择插件文件）
3. 选中 `releases/sp-milestone-v1.3.0.zip`
4. 安装后，需要**开启插件**，左侧导航出现 `Milestone` 入口（入口名固定不翻译，见文末「命名约定」）

> 不需要解压 ZIP。网页版因浏览器跨域限制无法自动下载，请手动下载 ZIP 后用同样方式安装。

## 使用

- 点击右上角「添加」，选择类型、历法、日期（**名称必填**，空名称不会保存）；右边的齿轮是设置
- **农历是设置里的一项开关，默认关闭**：关闭时界面里不出现任何农历（只有公历日期，表单里没有「历法」，节日预设只剩公历分组）；打开后，选择「农历」用年 / 月 / 日三个下拉框指定农历日期，下方会实时显示对应公历、干支与生肖
- 打开农历后，日期按**录入时的历法**决定顺序：公历录入的写「2026-05-12（农历四月初五）」，农历录入的写「农历四月初五（2026-05-12）」
- **已经有农历事项时不能关闭农历开关**：关掉会让这些记录只剩公历、也改不了历法，所以设置里会锁住开关并说明原因；删掉这些事项后即可关闭
- **点任意条目先进入详情页**（只读）：顶部是与列表置顶卡**同一套大卡片**（「距离…还有 / 已经走过」+ 天数 + 周期进度条），下面的信息行按类型说人话 —— 日期那一行的叫法随类型走（生日「出生日期」、纪念日「那一天」、倒数日「目标日期」、节日「节日日期」），生日下面再给一行「N岁生日」、纪念日再给一行「N 周年」并附「已过 / 已满」；归档的事项末尾多一行「状态：已归档」。类型不再单列 —— 它在卡片标签上。要点右上角「编辑」才会打开表单，改完保存仍停在详情，点左上角「返回」回列表
- **在详情页点一下大卡片，读数会换档**：天 → 年 / 月 / 天 → 周 / 天 → 时 / 分 / 秒（最后这档要先打开设置里的「秒级计时」）。只切换不记忆，关掉重开回到「天」
- **进度条只给生日和纪念日**：两者都是一年一轮，可以画「本周年已过 / 还剩」；节日与倒数日只有「还有 N 天」一个语义，不画进度条
- 在详情页里可以删除（编辑表单底部的「删除该事项」）
- 顶部筛选条可按类型过滤；**「归档」是单独一个视图**

**关于节日**：类型选「节日」后，表单会多出一块「预设节日」选择区，分三组（**农历与节气两组只在打开农历开关后出现**）：

| 分组 | 节日 | 日期来源 |
| --- | --- | --- |
| 公历 | 元旦、情人节、妇女节、劳动节、儿童节、国庆节、圣诞节 | 固定月日 |
| 农历 | 除夕、春节、元宵节、龙抬头、端午节、七夕、中元节、中秋节、重阳节、腊八节 | 农历月日，每年公历日期不同 |
| 节气 | 清明 | 按节气公式推算，每年落在 4 月 4-5 日 |

- 选中一个预设，名称、历法、日期、颜色一次性填好，之后仍可改名称或换颜色
- **预设可以多选**：一次勾选几个节日，保存按钮会变成「添加 3 个」，点一下就按各自预设批量建好
- 选「自定义节日」则不套预设：自己填名称和日期，一样每年倒数
- 农历节日按农历算：今年中秋是八月十五，明年就自动变成另一个公历日
- **除夕按腊月最后一天计算**，腊月只有廿九天的年份自动按廿九，不会算错一天
- 清明的公历日期每年会漂移，保存的是「节气」而不是死日期，因此永远准

**关于归档**：编辑任意事项时会看到「归档」开关（**节日没有这个开关**——节日每年都会再来）打开后该事项：

- 不再出现在「全部」以及各个分类里，只出现在「归档」视图
- **不会再提醒**（任务列表里对应的任务会被删除）
- 提醒配置本身会保留，取消归档后按原设置恢复
- 在归档视图里点「添加」，新建的事项默认就是归档状态。

## 提醒功能

提醒**不是**一个全局总开关，而是每个事项各自选择是否提醒：打开「在任务列表提醒我」后，到期会在**收件箱**插入一条任务，并打上 `milestone` 标签；关掉则对应任务立即被删除。

**只有任务列表这一条通道**：宿主没有系统级推送，弹一下就消失的提示条没意义，已整体移除（早先的「打开应用时弹提示条」开关与相关逻辑一并删掉，数据里也不会再写这个字段）。

任务**落在收件箱**、不建项目：插件会在应用里准备好 `milestone` 标签，所有提醒任务都带上它，点标签就能一次筛出全部提醒。

**提前天数**（当天 / 1 / 3 / 7 / 30 天，可多选）决定这条任务哪天变成待办：取最近的一档作为到期日，档位过了自动推进到更近的一档，所以漏了也还能在列表里看到（逾期）。

任务的**到期日 = 该提醒你的那一天**。同一件事只占一条任务，不会每个档位各生成一条；某个档位过了，任务自动推进到下一个更近的档位。

任务长这样（类型用图标区分）：

```
🎂 妈妈生日（59岁）
生日 · 农历四月十八 · 每年
提前 3 天提醒 · 应处理日 2027-05-11
ml:ev=e1;cy=2027-05-14
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

## 平台支持

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| Windows / macOS / Linux | ✅ | 桌面端完整功能 |
| Android | ✅ | iframe 全页视图，适配安全区 |
| iOS | ✅ | 同上 |
| 网页版 | ✅ | 手动安装 ZIP |

实现上刻意规避了平台差异：UI 走 iframe 全页视图，不依赖 Node API、不引用任何 CDN 资源、不使用可选链等较新语法，也不调用 `crypto.randomUUID`。

## 已知边界

- **卸载插件不会清理已生成的任务**：卸载/禁用后任务会留在收件箱里（带 `milestone` 标签）。卸载前把各个事项的「加入任务列表」关掉，或卸载后按标签 `milestone` 一次性清理
- **老任务留在旧项目里**：1.0.1 及更早版本把任务建在「里程碑提醒」项目里。宿主没有安全的「把任务搬到另一个项目」接口（直接改 `projectId` 会与项目侧的 `taskIds` 对不上），所以升级后**只给老任务补上 `milestone` 标签、不搬项目**；想让它们全部落到收件箱，删掉那个旧项目即可，插件会在下一轮对账时按收件箱 + 标签重建
- **提醒不会主动推送**：任务会按时出现在任务列表里，但宿主没有系统级后台推送与常驻能力，也不会弹通知 —— 插件侧唯一能做的就是「把任务放进列表」，所以请靠任务列表看提醒（宿主设计限制）
- 农历数据覆盖 **1900–2100** 年。超出范围时不会崩溃：日期只显示公历（列表里的天数位置仍会标「超出可算年限」）
- **农历开关与数据联动**：只要库里还有农历事项，开关就锁在「开」且不可关闭（数据层也会把设置自愈为开），避免出现「有农历数据但界面上看不见、也改不了」的状态；删掉这些事项后即可自由关闭
- 农历换算采用 1900-01-31 为基准的累积天数查表算法，已用 73,384 天逐日往返校验、201 个农历年天数校验
- 任务备注里的 `ml:ev=…` 标记是识别依据；跨设备时如果备注被清空，可能会多出一条重复任务（下次对账会删掉多余的那条）
- 任务同步需要宿主提供任务 API（`getAppState` / `addTask` / `updateTask` / `deleteTask`）。
- 语言列表来自已注册的语言包；宿主切到某语言而插件没有对应语言包时，按英文显示
- **软件语言设成「跟随系统」时，插件按系统语言显示**：宿主在这种情况下会把 `getCurrentLanguage()` 一直回报成默认值 `en`（它的语言信号量只在配置里有 `lng` 时才同步），所以插件改读 `globalConfig.localization.lng`——有值就用它（哪怕真是 `en`），为空才落到系统语言



# Milestone

[中文](#里程碑) · **English**

A Super Productivity plugin for countdowns, anniversaries, birthdays and festivals. Data syncs across devices through the app's own channel; the UI is bilingual (Chinese / English) and **follows the app language by default**. Lunar-calendar support is a **switch that is off by default**, so anyone who does not use it sees no lunar element at all.

## Features

| Capability | Description |
| --- | --- |
| Four types | Birthday, anniversary, countdown and festival, each with its own time semantics |
| Preset festivals | Common festivals grouped by Gregorian / lunar / solar term, **multi-select to add in one go**; custom festivals supported (the lunar and solar-term groups appear once the lunar switch is on) |
| Two time metrics | Countdowns and birthdays show **days left** (amber), anniversaries show **days passed** (teal) |
| Sorting | Sooner countdowns on top, older anniversaries on top; the featured card takes the first entry of the current category |
| Featured card | Can be switched off in settings, then the list starts at the very top |
| Seconds timer | Settings → "Seconds → Show hh:mm:ss on the big card", **off by default**. When on, the card adds a slightly smaller "04h 20m 15s" line under the day number that ticks once a second (hidden for "today", plus a full day for "the day after tomorrow"); it stops while the page is hidden or the card is covered |
| Tap the detail card | Cycles the reading in the detail page: days → y / mo / d → w / d → h / m / s (the last one requires the seconds timer). Not remembered — reopening starts from days |
| Lunar switch | **Off by default.** Off: no lunar anywhere (list, details, form, presets). On: dates read "Gregorian (lunar)" or "lunar (Gregorian)" depending on how the entry was entered |
| Lunar support | With the switch on, lunar birthdays / anniversaries are converted automatically, so every launch shows this year's Gregorian date |
| Reminders as tasks | Every entry decides on its own whether to create a task; on = inserted, off = deleted (the only reminder channel) |
| Archive | Entries can be archived: hidden from "All" and no longer reminded; the "Archive" chip at the right end of the filter bar is the entry point |
| Cross-device sync | Uses the app's own sync channel, so desktop / mobile / web stay consistent |

## Installation

**Requires**: Super Productivity **19.0.0** or newer (the plugin uses `getCurrentLanguage` / `onReady` / `onUnload`, which exist from that release). Older versions reject the install.

**Option 1: manual install (recommended, works everywhere)**

1. Open Super Productivity → `Settings` → `Plugins`
2. Click `Choose Plugin File`
3. Select `releases/sp-milestone-v1.3.0.zip`
4. After installing, **enable the plugin** — a "Milestone" entry appears in the left navigation

> No need to unzip. The web version cannot download automatically because of browser CORS rules — download the ZIP manually and install it the same way.

## Usage

- Tap **Add** in the top-right corner, choose type, calendar and date (**name is required** — an empty name is not saved); the gear next to it opens settings
- **The lunar calendar is a switch in settings and is off by default**: while off there is no lunar element at all (Gregorian dates only, no "Calendar" row in the form, only the Gregorian preset group). While on, choosing **Lunar** lets you pick year / month / day from three selects and shows the matching Gregorian date, sexagenary cycle and zodiac below
- With the lunar switch on, dates follow **the calendar they were entered with**: a Gregorian entry reads "2026-05-12 (lunar month 4, day 5)", a lunar entry reads "lunar month 4, day 5 (2026-05-12)"
- **The switch cannot be turned off while lunar entries exist** — they would only show the Gregorian date and their calendar could no longer be edited, so settings locks the switch and says why; delete those entries to turn it off
- Tap any card to edit or delete it
- The filter bar on top filters by type; **"Archive" is a separate view**

**About festivals**: with type = Festival, the form shows a "Preset festivals" block in three groups (**the lunar and solar-term groups only appear with the lunar switch on**):

| Group | Festivals | Date source |
| --- | --- | --- |
| Gregorian | New Year's Day, Valentine's Day, Women's Day, Labour Day, Children's Day, National Day, Christmas | Fixed month/day |
| Lunar | Lunar New Year's Eve, Spring Festival, Lantern Festival, Longtaitou, Dragon Boat, Qixi, Ghost Festival, Mid-Autumn, Double Ninth, Laba | Lunar month/day, so the Gregorian date moves every year |
| Solar term | Qingming | Computed from the solar-term formula, landing on April 4-5 |

- Selecting one preset fills name, calendar, date and colour at once — name and colour stay editable afterwards
- **Presets can be multi-selected**: tick a few and the save button becomes "Add 3", creating them all in one tap
- "Custom festival" skips presets: enter your own name and date, still counted down every year
- Lunar festivals follow the lunar calendar: this year's Mid-Autumn is lunar 8/15, next year it maps to a different Gregorian date
- **Lunar New Year's Eve is the last day of the 12th lunar month**, falling back to day 29 in years where that month is short
- Qingming drifts on the Gregorian calendar, so the solar term is stored instead of a fixed date — it is always right

**About archiving**: while editing any entry you will see an "Archive" switch (**festivals do not have it** — they come back every year). When on, the entry:

- no longer appears in "All" or any category, only in the "Archive" view
- **stops reminding** (its task is deleted)
- keeps its reminder configuration, restored when you unarchive
- creating an entry inside the archive view defaults to archived

## Reminders

Reminders are **not** a global switch — every entry decides on its own. Turn on "Remind me in the task list" and a task is inserted into the **Inbox** and tagged `milestone` when due; turn it off and the task is deleted immediately.

**This is the only reminder channel**: the host has no system-level push, and a snackbar that vanishes after a few seconds is pointless, so it has been removed entirely (the old "Snackbar when the app opens" switch and all its logic are gone, and the field is no longer written to your data).

Tasks **land in the Inbox**, not in a project: the plugin makes sure a `milestone` tag exists and puts it on every reminder task, so one tag click filters them all.

**Lead days** (same day / 1 / 3 / 7 / 30, multi-select) decide when the task becomes actionable: the nearest slot is used as the due date, and once a slot passes the task moves on to the next nearest one — so a missed reminder is still visible in the list (overdue).

A task's **due date is the day you want to be reminded**. One entry owns one task, no per-slot duplicates; when a slot passes the task moves on to the next nearest one.

A task looks like this (the type is marked with an icon):

```
🎂 Mom's birthday (59)
Birthday · Lunar month 4, day 18 · yearly
Reminder 3 days before · due 2027-05-11
ml:ev=e1;cy=2027-05-14
```

The last line is a marker the plugin uses — please do not delete it, cross-device recognition depends on it. If it is gone, the local map table can still recover it.

**Edits and deletions leave no leftovers.** The plugin treats tasks as a projection of the data and reconciles on every change (after saving, on start, every 10 minutes):

| What you do in the plugin | What the task list does |
| --- | --- |
| Rename / change date / change lead days | The same task is updated in place, no duplicates |
| Turn off "Add to task list" for one entry | Its task is deleted, others are untouched |
| Archive the entry | Its task is deleted |
| Delete the entry | Its task is deleted |
| Tick the task as done | It does not come back until the next yearly cycle |
| Delete the task manually | It is recreated automatically |

⚠️ The last row is a deliberate trade-off: if deleting the task meant cancelling the reminder, one mis-tap would silence it forever. To really cancel, turn off "Add to task list" in that entry.

## Platform support

| Platform | Status | Notes |
| --- | --- | --- |
| Windows / macOS / Linux | ✅ | Full functionality |
| Android | ✅ | iframe full-page view, safe-area aware |
| iOS | ✅ | Same as above |
| Web | ✅ | Manual ZIP install |

Platform differences are deliberately avoided: the UI is an iframe full-page view, no Node APIs, no CDN resources, no optional chaining, no `crypto.randomUUID`.

## Known limits

- **Uninstalling does not clean up generated tasks**: they stay in the reminder project. Either turn off "Add to task list" for each entry before uninstalling, or delete the project afterwards
- **Reminders do not push by themselves**: tasks show up in the list on time, but the host has no system-level background push and no persistent notifications — the plugin can only put a task in your list, so read reminders from there (host design)
- Lunar data covers **1900–2100**. Dates outside the range show "Out of range" instead of crashing
- The lunar conversion uses a cumulative-day table based on 1900-01-31; it is verified with 73,384 round-trip days and 201 lunar-year lengths
- The `ml:ev=…` marker in task notes is the recognition key; if the notes are wiped during a cross-device sync, a duplicate task may appear temporarily (the next reconciliation removes it)
- Task sync requires the host task API (`getAppState` / `addTask` / `updateTask` / `deleteTask`).
- The language list comes from registered language packs; if the host switches to a language the plugin has no pack for, English is shown
- **When the app language is "system default", the plugin follows the system language**: in that case the host keeps reporting the default `en` from `getCurrentLanguage()` (its language signal is only synced when `globalConfig.localization.lng` has a value), so the plugin reads `globalConfig.localization.lng` instead — any value wins (even a real `en`), and only an empty value falls back to the system language
