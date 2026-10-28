/*!
 * 简体中文语言包（基准语言）
 *
 * 贡献翻译：复制本文件为 <语言代码>.js（如 fr.js、ja.js），把右侧的值换成目标语言，
 * 把 __name 改成该语言的自称（如 "Français"），然后执行 npm run build —— 构建会自动
 * 收录 src/locales/ 下的所有文件，设置页的语言列表随之多一项，不需要改任何代码。
 * 键名不要动；缺的键运行时会回落到中文。
 */
(function (global, factory) {
  var dict = factory();
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = dict;
  } else {
    (global.I18N_LOCALES = global.I18N_LOCALES || {})['zh'] = dict;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return {

    __name: "简体中文",

    /* ---------------- 身份 ---------------- */
    appName: "里程碑",
    projectDefault: "里程碑提醒",
    about: "{name} v{ver}",

    /* ---------------- 类型 ---------------- */
    'kind.birthday': "生日",
    'kind.anniversary': "纪念日",
    'kind.countdown': "倒数日",
    'kind.festival': "节日",
    'kind.generic': "事项",
    'kindl.birthday': "生日",
    'kindl.anniversary': "纪念日",
    'kindl.countdown': "倒数日",
    'kindl.festival': "节日",
    'kindl.generic': "事项",
    'plural.birthday': "生日",
    'plural.anniversary': "纪念日",
    'plural.countdown': "倒数日",
    'plural.festival': "节日",
    'plural.generic': "事项",

    /* ---------------- 历法 / 周 / 节日分组 ---------------- */
    'week.0': "周日",
    'week.1': "周一",
    'week.2': "周二",
    'week.3': "周三",
    'week.4': "周四",
    'week.5': "周五",
    'week.6': "周六",
    'group.solar': "公历",
    'group.lunar': "农历",
    'group.term': "节气",
    'group.custom': "自定义",
    'term.qingming': "清明",
    'date.notSet': "日期未设置",
    // 生日括号里的年龄 = 这次生日（下次发生那天）多少岁，不是今天多大
    'age.suffix': "（{n}岁）",
    'years.n': "{n} 周年",
    'years.nDays': "{n} 周年 {d} 天",
    'zodiac.label': "{gz}年 · 属{z}",

    /* ---------------- 预设节日 ---------------- */
    'fest.yuandan': "元旦",
    'fest.qingren': "情人节",
    'fest.funi': "妇女节",
    'fest.laodong': "劳动节",
    'fest.ertong': "儿童节",
    'fest.guoqing': "国庆节",
    'fest.shengdan': "圣诞节",
    'fest.chuxi': "除夕",
    'fest.chunjie': "春节",
    'fest.yuanxiao': "元宵节",
    'fest.longtai': "龙抬头",
    'fest.duanwu': "端午节",
    'fest.qixi': "七夕",
    'fest.zhongyuan': "中元节",
    'fest.zhongqiu': "中秋节",
    'fest.chongyang': "重阳节",
    'fest.laba': "腊八节",
    'fest.qingming': "清明",

    /* ---------------- 提醒 ---------------- */
    'offset.0': "当天",
    'offset.1': "提前 1 天",
    'offset.3': "提前 3 天",
    'offset.7': "提前 7 天",
    'offset.30': "提前 30 天",
    'remind.line': "{off}提醒 · 应处理日 {date}",
    'remind.yearly': "每年",
    'snack.today': "今天",
    'snack.tomorrow': "明天",
    'snack.inDays': "{n} 天后",
    'snack.more': "等 {n} 个事项",
    'snack.sep': "｜",

    /* ---------------- 界面骨架 ---------------- */
    loading: "正在加载…",
    settings: "设置",
    close: "关闭",
    cancel: "取消",
    save: "保存",
    add: "添加",
    addAria: "添加事项",
    filterAria: "筛选",
    lang: "语言",
    'lang.auto': "自动",
    'nav.reloadHint': "左侧菜单名称要重启后才会变成「{name}」",
    'nav.reload': "重启",

    /* ---------------- 筛选条 ---------------- */
    'chip.all': "全部",
    'chip.birthday': "生日",
    'chip.anniversary': "纪念日",
    'chip.countdown': "倒数日",
    'chip.festival': "节日",
    'chip.archive': "归档",
    'chip.archiveN': "归档 {n}",

    /* ---------------- 相对日期（三天内不用数字） ---------------- */
    'when.0': "今天",
    'when.1': "明天",
    'when.2': "后天",

    /* ---------------- 副标题 ---------------- */
    'sub.archived': "{n} 个已归档 · 不参与提醒",
    'sub.archivedEmpty': "归档里还没有事项",
    'sub.emptyAll': "还没有记录，先添加一个重要日期吧",
    'sub.emptyFilter': "这个分类还没有记录",
    'sub.count': "{n} 个{k}",
    'sub.today': " · 今天 {n} 个",
    'sub.near': " · 最近 {n} 天",
    'sub.archivedN': " · 归档 {n} 个",

    /* ---------------- 置顶卡片 ---------------- */
    'hero.remainLabel': "距离 <b>{name}</b> 还有",
    // 剩余 0/1/2 天：卡片上的大数字换成「今天 / 明天 / 后天」，句子也跟着改
    'hero.todayLabel': "<b>{name}</b> 就是",
    'hero.soonLabel': "<b>{name}</b> 就在",
    'hero.elapsedLabel': "<b>{name}</b> 已经走过",
    'hero.unitRemain': "剩余天数",
    'hero.unitElapsed': "已过天数",
    'hero.barDone': "本年度已过 {p}%",
    'hero.barTotal': "共 365 天",
    'hero.emptyHint': "点右上角「添加」记下第一个重要日期",
    'hero.emptyArchiveHint': "归档中的事项不参与置顶",

    /* ---------------- 列表条目 ---------------- */
    'unit.overflow': "超出可算年限",
    'unit.todayRemain': "就是今天",
    'unit.todayElapsed': "就在今天",
    'unit.remain': "剩余天数",
    'unit.elapsed': "已过天数",
    'tag.archived': "已归档 · {k}",
    'tag.expired': "过期的倒数日",

    /* ---------------- 空态 ---------------- */
    'empty.archiveHint': "归档后不在「全部」里显示，也不再提醒，可随时取消归档。",
    'empty.archiveBtn': "添加一个归档事项",
    'empty.filterTitle': "这个分类还是空的",
    'empty.filterDesc': "点下面的按钮，会自动按「{k}」新建；也可以换一个筛选看看。",
    'empty.allTitle': "记下第一个重要日期",
    'empty.allDesc': "生日、纪念日、考试倒数，都能自动帮你算好还有多久。",
    'empty.btn': "添加一个{k}",

    /* ---------------- 表单 ---------------- */
    'sheet.new': "新建{k}",
    'sheet.newDefault': "新建事项",
    'sheet.edit': "编辑事项",
    'form.name': "名称",
    'form.namePh': "例如：妈妈生日",
    'form.kind': "类型",
    'form.preset': "预设节日",
    'form.presetHint': "选一个节日会自动填好日期和颜色；选「自定义」自己填。",
    'form.customFestival': "自定义节日",
    'form.calendar': "历法",
    'form.solar': "公历",
    'form.lunar': "农历",
    'form.date': "日期",
    'form.lunarDate': "农历日期",
    'form.lunarYear': "农历年",
    'form.lunarMonth': "农历月",
    'form.lunarDay': "农历日",
    'form.leap': "闰月",
    'form.countdown': "倒数设置",
    'form.repeat': "过期后重新开始倒数",
    'form.repeatHint': "打开：到期后滚到明年的同一天继续倒数。关掉：停在「已过天数」。",
    'form.remind': "提醒",
    'form.remindTask': "加入任务列表",
    'form.remindSnack': "打开应用时弹提示条",
    'form.archive': "归档",
    'form.archiveMove': "移到归档分组",
    'form.color': "颜色",
    'form.colorAria': "颜色 {c}",
    'form.note': "备注",
    'form.notePh': "可选，随手记一点",
    'form.delete': "删除该事项",

    /* ---------------- 农历预览 ---------------- */
    'lunar.invalid': "这个农历日期不存在，请调整年份或月份",
    'lunar.preview': "{lunar}，对应公历 {date} {week} · {gz}年 · 属{z}",
    'lunar.dimSuffix': "（该月仅 {n} 天，按{d}计）",
    'lunar.yearOpt': "{y} 年",

    /* ---------------- 预设提示 ---------------- */
    'preset.none': "选一个自动填好日期；可多选一次加入，或选「自定义」自己填。",
    'preset.multi': "已选 {n} 个：{names}，保存后一次加入。",
    'preset.custom': "自定义节日：自己填名称和日期，每年自动倒数。",
    'preset.term': "{name}按节气推算，每年落在 4 月 4-5 日。",
    'preset.chuxi': "除夕按腊月最后一天算，腊月只有廿九天的年份自动按廿九。",
    'preset.lunar': "{name}按农历计算，每年公历日期不同。",
    'preset.solar': "{name}每年 {m} 月 {d} 日。",
    'preset.next': "下一次 {date}。",

    /* ---------------- 提醒说明 ---------------- */
    'remind.hintArchived': "已归档：不在「全部」里显示，也不会提醒，任务列表里的对应任务会被删除。",
    'remind.hintBoth': "到期在「{p}」生成任务，并在打开应用时弹提示条。",
    'remind.hintTask': "到期在「{p}」生成一条任务，随应用同步；关掉即删除。",
    'remind.hintSnack': "只在打开应用时弹提示条；插件没有后台推送，应用没开就不提示。",
    'remind.hintNone': "该事项不会提醒你（两个渠道都关着）。",

    /* ---------------- 设置面板 ---------------- */
    'set.hero': "置顶卡片",
    'set.heroToggle': "扩大显示第一条",
    'set.heroHint': "顶部放大显示<b>当前分区</b>排在最前的那条；关掉则列表贴顶。",
    'set.data': "数据",
    'set.clear': "清除里程碑数据缓存",
    'set.clearHint': "数据错乱、任务重复或日期算错时可用。会清空全部事项与设置，并移除本插件生成的任务；<b>其他任务与项目不受影响</b>。",
    'set.about': "关于",
    'data.count': "当前共 {n} 个事项",
    'data.archivedN': "（其中 {n} 个已归档）",
    'data.empty': "当前还没有记录",

    /* ---------------- 确认框 / 提示 ---------------- */
    'dialog.deleteTitle': "删除确认",
    'dialog.delete': "删除",
    'dialog.deleteOne': "确定删除「{name}」吗？",
    'dialog.continue': "继续",
    'dialog.clearTitle1': "清除数据",
    'dialog.clearHeadN': "将清除全部 {n} 个事项与设置，并移除本插件生成的提醒任务。",
    'dialog.clearHeadEmpty': "将清除当前设置与本机提醒缓存，并移除本插件生成的提醒任务。",
    'dialog.clearTail': "此操作不可撤销。",
    'dialog.clearOk': "确定清除",
    'dialog.clearTitle2': "再次确认",
    'dialog.clearConfirm': "最后确认：清除后无法恢复，所有事项都会消失。确定要清空吗？",
    'toast.saved': "已保存",
    'toast.added': "已添加",
    'toast.updated': "已更新",
    'toast.deleted': "已删除",
    'toast.cleared': "已清除所有数据",
    'toast.saveFail': "保存失败，请稍后重试",
    'toast.synced': "已同步到最新数据",
    'toast.pickDate': "请选择日期",
    'toast.pickFestival': "请选择节日",
    'toast.batch': "已添加 {n} 个节日",
    saveN: "添加 {n} 个",
  };
});
