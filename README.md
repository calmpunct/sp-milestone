# 里程碑

**中文** · [English](#milestones)

Super Productivity 插件。管理倒数日、纪念日、生日和节日，数据随应用同步在设备间流转；界面支持中文、英语。历法默认公历，可以开启农历支持。

## 功能

| 能力        | 说明                                                                        |
| --------- | ------------------------------------------------------------------------- |
| 四种类型      | 生日、纪念日、倒数日、节日，各自有独立的计时语义                                                  |
| 预设节日      | 常用节日按公历 / 农历 / 节气分组，**可多选一次批量添加**；也可自定义节日（农历与节气分组随农历开关出现）                 |
| 两种时间口径    | 倒数与生日显示**剩余天数**（橙黄），纪念日显示**已过天数**（蓝绿）                                     |
| 排序规则      | 倒数越近越靠上，已过的越久越靠上；顶栏下的置顶卡片取当前分区的第一条                                        |
| 置顶卡片      | 可在设置里关掉，关掉后列表直接贴顶，一屏多看几条                                                  |
| 秒级计时      | 设置里「秒级计时 → 大卡片显示时分秒」，**默认关闭**。打开后大卡片在天数下面补一行小一号的「04 时 20 分 15 秒」，每秒走一格；   |
| 农历开关      | 设置里「历法 → 启用农历系统」，**默认关闭**。关闭时界面、表单、节日预设里都没有农历；打开后日期按来源写作「公历（农历）」或「农历（公历）」 |
| 到期提醒进任务列表 | 每个事项可以单独选择是否生成任务；打开就插入相关任务，关闭就删除相关任务                                      |
| 归档        | 每个事项可归档：不在「全部」里显示，也不再提醒；筛选条最右边的「归档」就是归档视图的入口                              |
| 备注        | 每个事项可写 200 字备注；详情页下方单独成块显示，手动换行原样保留                                       |
| 跨设备同步     | 依赖应用自身的同步通道，桌面 / 移动端 / 网页数据一致                                             |

## 安装

**要求**：Super Productivity **19.3.1** 更高版本（用到该版本才有的插件 API：`getCurrentLanguage` / `onReady` / `onUnload`）。低版本会在安装时被拒绝（报index.html大于100kb）。

**方式一：手动安装（推荐，各平台通用）**

1. 打开 Super Productivity → `设置` → `插件`
2. 点击 `Choose Plugin File`（选择插件文件）
3. 选中 `releases/sp-milestone-v1.3.0.zip`
4. 安装后，需要**开启插件**，左侧导航出现 `Milestone` 入口

> 不需要解压 ZIP。网页版因浏览器跨域限制无法自动下载，请手动下载 ZIP 后用同样方式安装。

## 使用

- 点击右上角「添加」，选择类型、历法、日期；右边的齿轮是设置
- **农历是设置里的一项开关，默认关闭**：关闭时界面里不出现任何农历（只有公历日期，表单里没有「历法」，节日预设只剩公历分组）；
- **已经有农历事项时不能关闭农历开关**：关掉会让这些记录只剩公历、也改不了历法，所以设置里会锁住开关并说明原因；删掉这些事项后即可关闭
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

**关于归档**：编辑任意事项时会看到「归档」开关，打开后该事项：
- 不再出现在「全部」以及各个分类里，只出现在「归档」视图
- **不会再提醒**（任务列表里对应的任务会被删除）
- 提醒配置本身会保留，取消归档后按原设置恢复
- 在归档视图里点「添加」，新建的事项默认就是归档状态。

## 提醒功能

提醒**不是**一个全局总开关，而是每个事项各自选择是否提醒：打开「在任务列表提醒我」后，到期会在**收件箱**插入一条任务，并打上 `milestone` 标签；关掉则对应任务立即被删除。

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
- **提醒不会主动推送**：任务会按时出现在任务列表里，但宿主没有系统级后台推送与常驻能力，也不会弹通知 —— 插件侧唯一能做的就是「把任务放进列表」，所以请靠任务列表看提醒（宿主设计限制）
- 农历数据覆盖 **1900–2100** 年。超出范围时不会崩溃：日期只显示公历（列表里的天数位置仍会标「超出可算年限」）
- **农历开关与数据联动**：只要库里还有农历事项，开关就锁在「开」且不可关闭（数据层也会把设置自愈为开），避免出现「有农历数据但界面上看不见、也改不了」的状态；删掉这些事项后即可自由关闭
- 农历换算采用 1900-01-31 为基准的累积天数查表算法，已用 73,384 天逐日往返校验、201 个农历年天数校验
- 任务备注里的 `ml:ev=…` 标记是识别依据；跨设备时如果备注被清空，可能会多出一条重复任务（下次对账会删掉多余的那条）
- 任务同步需要宿主提供任务 API（`getAppState` / `addTask` / `updateTask` / `deleteTask`）。

# Milestone

[中文](#里程碑) · **English**

A Super Productivity plugin. Manages countdowns, anniversaries, birthdays and festivals, with data flowing between devices through the app's own sync. The UI supports Chinese and English. The calendar is Gregorian by default, and lunar support can be turned on.

## Features

| Capability | Description |
| --- | --- |
| Four types | Birthday, anniversary, countdown and festival, each with its own time semantics |
| Preset festivals | Common festivals grouped by Gregorian / lunar / solar term, **multi-select to add in one go**; custom festivals also supported (the lunar and solar-term groups appear with the lunar switch) |
| Two time metrics | Countdowns and birthdays show **days left** (amber), anniversaries show **days passed** (teal) |
| Sorting | Sooner countdowns on top, older anniversaries on top; the pinned card under the top bar takes the first entry of the current section |
| Pinned card | Can be turned off in settings; the list then starts right at the top, fitting a few more entries per screen |
| Seconds timer | Settings → "Seconds timer → Show hh:mm:ss on the big card", **off by default**. When on, the big card adds a slightly smaller "04h 20m 15s" line under the day number, ticking once a second; |
| Lunar switch | Settings → "Calendar → Enable lunar system", **off by default**. While off there is no lunar anywhere in the UI, the form or the festival presets; while on, dates read "Gregorian (lunar)" or "lunar (Gregorian)" depending on how they were entered |
| Due reminders as tasks | Every entry can decide on its own whether to create a task; on inserts the task, off deletes it |
| Archive | Every entry can be archived: hidden from "All" and no longer reminded; "Archive" at the right end of the filter bar is the entry point to the archive view |
| Notes | Every entry can carry a 200-character note; shown as its own block at the bottom of the detail page, manual line breaks preserved |
| Cross-device sync | Relies on the app's own sync channel, so desktop / mobile / web stay consistent |

## Installation

**Requires**: Super Productivity **19.3.1** or newer (the plugin uses APIs that only exist from that release: `getCurrentLanguage` / `onReady` / `onUnload`). Older versions reject the install (reporting index.html larger than 100kb).

**Option 1: manual install (recommended, works everywhere)**

1. Open Super Productivity → `Settings` → `Plugins`
2. Click `Choose Plugin File`
3. Select `releases/sp-milestone-v1.3.0.zip`
4. After installing, **enable the plugin** — a "Milestone" entry appears in the left navigation

> No need to unzip. The web version cannot download automatically because of browser CORS rules — download the ZIP manually and install it the same way.

## Usage

- Tap **Add** in the top-right corner, choose type, calendar and date; the gear next to it opens settings
- **The lunar calendar is a switch in settings and is off by default**: while off there is no lunar element in the UI (Gregorian dates only, no "Calendar" row in the form, only the Gregorian group in the festival presets);
- **The lunar switch cannot be turned off while lunar entries exist**: turning it off would leave those records with the Gregorian date only and no way to change their calendar, so settings locks the switch and explains why; delete those entries to turn it off
- **Tap the big card in the detail page to cycle the reading**: days → y / mo / d → w / d → h / m / s (the last one requires the seconds timer in settings). Switching is not remembered — reopening starts from days
- **Progress bars are only for birthdays and anniversaries**: both cycle once a year, so "this cycle passed / left" can be drawn; festivals and countdowns only mean "N days to go" and get no bar
- You can delete from the detail page ("Delete this entry" at the bottom of the edit form)
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

**About archiving**: editing any entry shows an "Archive" switch. When on, the entry:

- no longer appears in "All" or any category, only in the "Archive" view
- **stops reminding** (its task in the task list is deleted)
- keeps its reminder configuration, restored when you unarchive
- creating an entry inside the archive view defaults to archived

## Reminders

Reminders are **not** a global switch — every entry decides for itself: turn on "Remind me in the task list" and a task is inserted into the **Inbox** when due, tagged `milestone`; turn it off and the task is deleted immediately.

Tasks **land in the Inbox**, not in a project: the plugin makes sure a `milestone` tag exists and puts it on every reminder task, so one tag click filters them all.

**Lead days** (same day / 1 / 3 / 7 / 30, multi-select) decide which day the task turns into a to-do: the nearest slot becomes the due date, and once a slot passes the task moves on to the next nearest one, so a missed one still shows in the list (overdue).

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

- **Uninstalling does not clean up generated tasks**: after uninstalling / disabling they stay in the Inbox (tagged `milestone`). Turn off "Add to task list" for every entry before uninstalling, or clean them up in one go by the `milestone` tag afterwards
- **Reminders do not push by themselves**: tasks appear in the task list on time, but the host has no system-level background push or persistence and shows no notifications — the only thing the plugin can do is put the task in the list, so read reminders from there (host design)
- Lunar data covers **1900–2100**. Dates outside the range do not crash: they show the Gregorian date only (the day-count slot in the list still says "out of supported years")
- **The lunar switch and the data are linked**: as long as lunar entries remain in the store the switch stays locked on and cannot be turned off (the data layer also self-heals the setting back to on), so lunar data can never end up invisible and uneditable; delete those entries to turn it off freely
- The lunar conversion uses a cumulative-day table based on 1900-01-31; it is verified with 73,384 round-trip days and 201 lunar-year lengths
- The `ml:ev=…` marker in task notes is the recognition key; if the notes are wiped during a cross-device sync, a duplicate task may appear temporarily (the next reconciliation removes it)
- Task sync requires the host task API (`getAppState` / `addTask` / `updateTask` / `deleteTask`).
