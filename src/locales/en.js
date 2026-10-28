/*!
 * English language pack
 *
 * To contribute a translation: copy this file to <code>.js (e.g. fr.js), translate the
 * values (keep the keys untouched), set __name to the language's own name, and run
 * `npm run build` — the build picks up every file in src/locales/ automatically, so the
 * language shows up in settings without touching any code. Missing keys fall back to
 * Simplified Chinese (the base language).
 */
(function (global, factory) {
  var dict = factory();
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = dict;
  } else {
    (global.I18N_LOCALES = global.I18N_LOCALES || {})['en'] = dict;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return {

    __name: "English",

    /* ---------------- identity ---------------- */
    appName: "Milestones",
    projectDefault: "Milestones",
    about: "{name} v{ver} · reminders go to \"{p}\" · synced",

    /* ---------------- kinds ---------------- */
    'kind.birthday': "Birthday",
    'kind.anniversary': "Anniversary",
    'kind.countdown': "Countdown",
    'kind.festival': "Festival",
    'kind.generic': "Entry",
    'kindl.birthday': "birthday",
    'kindl.anniversary': "anniversary",
    'kindl.countdown': "countdown",
    'kindl.festival': "festival",
    'kindl.generic': "entry",
    'plural.birthday': "birthdays",
    'plural.anniversary': "anniversaries",
    'plural.countdown': "countdowns",
    'plural.festival': "festivals",
    'plural.generic': "entries",

    /* ---------------- calendars / week / groups ---------------- */
    'week.0': "Sun",
    'week.1': "Mon",
    'week.2': "Tue",
    'week.3': "Wed",
    'week.4': "Thu",
    'week.5': "Fri",
    'week.6': "Sat",
    'group.solar': "Gregorian",
    'group.lunar': "Lunar",
    'group.term': "Solar term",
    'group.custom': "Custom",
    'term.qingming': "Qingming",
    'date.notSet': "Date not set",
    // age in the suffix = how old the person turns on the upcoming birthday, not today's age
    'age.suffix': " (turning {n})",
    'years.n': "{n} years",
    'zodiac.label': "{gz} year · {z}",

    /* ---------------- preset festivals ---------------- */
    'fest.yuandan': "New Year's Day",
    'fest.qingren': "Valentine's Day",
    'fest.funi': "Women's Day",
    'fest.laodong': "Labour Day",
    'fest.ertong': "Children's Day",
    'fest.guoqing': "National Day",
    'fest.shengdan': "Christmas",
    'fest.chuxi': "Lunar New Year's Eve",
    'fest.chunjie': "Spring Festival",
    'fest.yuanxiao': "Lantern Festival",
    'fest.longtai': "Longtaitou",
    'fest.duanwu': "Dragon Boat Festival",
    'fest.qixi': "Qixi Festival",
    'fest.zhongyuan': "Ghost Festival",
    'fest.zhongqiu': "Mid-Autumn Festival",
    'fest.chongyang': "Double Ninth Festival",
    'fest.laba': "Laba Festival",
    'fest.qingming': "Qingming",

    /* ---------------- reminders ---------------- */
    'offset.0': "on the day",
    'offset.1': "1 day before",
    'offset.3': "3 days before",
    'offset.7': "7 days before",
    'offset.30': "30 days before",
    'remind.line': "Reminder {off} · due {date}",
    'remind.yearly': "yearly",
    'snack.today': "today",
    'snack.tomorrow': "tomorrow",
    'snack.inDays': "in {n} days",
    'snack.more': "{n} more entries",
    'snack.sep': " | ",

    /* ---------------- shell ---------------- */
    loading: "Loading…",
    settings: "Settings",
    close: "Close",
    cancel: "Cancel",
    save: "Save",
    add: "Add",
    addAria: "Add an entry",
    filterAria: "Filter",
    lang: "Language",
    'lang.auto': "Auto",
    'lang.hint': "\"Auto\" follows the app language; you can also pin one here. The choice syncs with your data and reminder tasks use it too.",
    'nav.reloadHint': "The sidebar entry becomes \"{name}\" after a restart",
    'nav.reload': "Restart",

    /* ---------------- filter chips ---------------- */
    'chip.all': "All",
    'chip.birthday': "Birthdays",
    'chip.anniversary': "Anniversaries",
    'chip.countdown': "Countdowns",
    'chip.festival': "Festivals",
    'chip.archive': "Archive",
    'chip.archiveN': "Archive {n}",

    /* ---------------- subtitle ---------------- */
    'sub.archived': "{n} archived · not reminded",
    'sub.archivedEmpty': "Nothing archived yet",
    'sub.emptyAll': "No entries yet — add an important date",
    'sub.emptyFilter': "No entries in this category yet",
    'sub.count': "{n} {k}",
    'sub.today': " · {n} today",
    'sub.near': " · nearest in {n} days",
    'sub.archivedN': " · {n} archived",

    /* ---------------- featured card ---------------- */
    'hero.remainLabel': "<b>{name}</b> in",
    'hero.elapsedLabel': "<b>{name}</b> since",
    'hero.unitRemain': "days left",
    'hero.unitElapsed': "days passed",
    'hero.barDone': "{p}% of the cycle",
    'hero.barTotal': "365 days total",
    'hero.emptyHint': "Tap \"Add\" to record your first date",
    'hero.emptyArchiveHint': "Archived entries are not featured",

    /* ---------------- list rows ---------------- */
    'unit.overflow': "Out of range",
    'unit.todayRemain': "today",
    'unit.todayElapsed': "today",
    'unit.remain': "days left",
    'unit.elapsed': "days passed",
    'tag.archived': "Archived · {k}",
    'tag.expired': "Expired countdown",

    /* ---------------- empty states ---------------- */
    'empty.archiveHint': "Hidden from \"All\" and never reminded; unarchive any time.",
    'empty.archiveBtn': "Add an archived entry",
    'empty.filterTitle': "This category is empty",
    'empty.filterDesc': "The button below starts a new \"{k}\" entry; you can also switch filters.",
    'empty.allTitle': "Record your first important date",
    'empty.allDesc': "Birthdays, anniversaries and countdowns — all with the days calculated for you.",
    'empty.btn': "Add {k}",

    /* ---------------- form ---------------- */
    'sheet.new': "New {k}",
    'sheet.newDefault': "New entry",
    'sheet.edit': "Edit entry",
    'form.name': "Name",
    'form.namePh': "e.g. Mom's birthday",
    'form.kind': "Type",
    'form.preset': "Preset festivals",
    'form.presetHint': "Pick a festival to fill in the date and colour, or choose Custom and enter your own.",
    'form.customFestival': "Custom festival",
    'form.calendar': "Calendar",
    'form.solar': "Gregorian",
    'form.lunar': "Lunar",
    'form.date': "Date",
    'form.lunarDate': "Lunar date",
    'form.lunarYear': "lunar year",
    'form.lunarMonth': "lunar month",
    'form.lunarDay': "lunar day",
    'form.leap': "Leap month",
    'form.countdown': "Countdown",
    'form.repeat': "Restart after the date passes",
    'form.repeatHint': "On: rolls to the same day next year. Off: stops at \"days passed\".",
    'form.remind': "Reminders",
    'form.remindTask': "Add to task list",
    'form.remindSnack': "Snackbar when the app opens",
    'form.archive': "Archive",
    'form.archiveMove': "Move to archive",
    'form.color': "Colour",
    'form.colorAria': "Colour {c}",
    'form.note': "Note",
    'form.notePh': "Optional memo",
    'form.delete': "Delete this entry",

    /* ---------------- lunar preview ---------------- */
    'lunar.invalid': "This lunar date does not exist — adjust the year or month",
    'lunar.preview': "{lunar} on the Gregorian calendar: {date} {week} · {gz} year · {z}",
    'lunar.dimSuffix': " (that month has {n} days, using {d})",
    'lunar.yearOpt': "{y}",

    /* ---------------- preset hints ---------------- */
    'preset.none': "Pick one to fill the date, several to add at once, or Custom.",
    'preset.multi': "Selected {n}: {names} — all added on save.",
    'preset.custom': "Custom festival: enter a name and a date, counted down every year.",
    'preset.term': "{name} follows the solar term, landing on April 4-5.",
    'preset.chuxi': "Uses the last day of lunar month 12; short years fall back to day 29.",
    'preset.lunar': "{name} follows the lunar calendar, so its Gregorian date changes yearly.",
    'preset.solar': "{name} falls on {m}/{d} every year.",
    'preset.next': " Next: {date}.",

    /* ---------------- reminder hints ---------------- */
    'remind.hintArchived': "Archived: hidden from \"All\", never reminded, and its task is deleted.",
    'remind.hintBoth': "Creates a task in \"{p}\" and shows a snackbar when the app opens.",
    'remind.hintTask': "Creates a task in \"{p}\" synced with the app; switching off deletes it.",
    'remind.hintSnack': "Snackbar only when the app opens — the plugin has no background push.",
    'remind.hintNone': "This entry will not remind you (both channels are off).",

    /* ---------------- settings ---------------- */
    'set.hero': "Featured card",
    'set.heroToggle': "Enlarge the first entry",
    'set.heroHint': "Enlarges the first entry of <b>the current category</b>; when off the list starts at the top.",
    'set.display': "Display",
    'set.strike': "Strike through expired countdowns",
    'set.strikeHint': "Only <b>expired countdowns that do not restart</b> get the line through their name. Other types are unaffected.",
    'set.data': "Data",
    'set.clear': "Clear Milestones data cache",
    'set.clearHint': "For wrong data, duplicate tasks or bad dates. Clears every entry and setting and removes this plugin's tasks — <b>other tasks stay</b>.",
    'set.legend': "Legend",
    'set.legendHint': "Countdowns and birthdays show <b>days left</b>, anniversaries <b>days passed</b>. Sooner first, older first.",
    'set.about': "About",
    'data.count': "{n} entries in total",
    'data.archivedN': " ({n} archived)",
    'data.empty': "No entries yet",

    /* ---------------- dialogs / toasts ---------------- */
    'dialog.deleteTitle': "Confirm deletion",
    'dialog.delete': "Delete",
    'dialog.deleteOne': "Delete \"{name}\"?",
    'dialog.continue': "Continue",
    'dialog.clearTitle1': "Clear data",
    'dialog.clearHeadN': "This clears all {n} entries and settings, and removes this plugin's reminder tasks.",
    'dialog.clearHeadEmpty': "This clears the settings and local reminder cache, and removes this plugin's tasks.",
    'dialog.clearTail': "This cannot be undone.",
    'dialog.clearOk': "Clear",
    'dialog.clearTitle2': "Confirm again",
    'dialog.clearConfirm': "Last check: this cannot be undone and every entry will be gone. Clear anyway?",
    'toast.saved': "Saved",
    'toast.added': "Added",
    'toast.updated': "Updated",
    'toast.deleted': "Deleted",
    'toast.cleared': "All data cleared",
    'toast.saveFail': "Save failed — please retry",
    'toast.synced': "Synced to the latest data",
    'toast.pickDate': "Please pick a date",
    'toast.pickFestival': "Please pick a festival",
    'toast.batch': "Added {n} festivals",
    saveN: "Add {n}",
  };
});
