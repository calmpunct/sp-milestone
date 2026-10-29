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
    appName: "Milestone",
    about: "{name} v{ver}",
    'about.author': "Author",
    'about.feedback': "Feedback",

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
    // Gregorian and lunar folded into one phrase: {a} leads (the calendar it was entered with), {b} follows
    'date.pair': "{a} ({b})",
    // age in the suffix = how old the person turns on the upcoming birthday, not today's age
    'age.suffix': " (turning {n})",
    // the word "birthday" is appended by the UI; user titles ending with it are stripped
    'name.birthday': "{name}'s birthday{age}",
    'years.n': "{n} years",
    'years.nDays': "{n} years {d} days",
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
    back: "Back",
    edit: "Edit",
    add: "Add",
    addAria: "Add an entry",
    filterAria: "Filter",
    lang: "Language",
    'lang.auto': "Auto",

    /* ---------------- filter chips ---------------- */
    'chip.all': "All",
    'chip.birthday': "Birthdays",
    'chip.anniversary': "Anniversaries",
    'chip.countdown': "Countdowns",
    'chip.festival': "Festivals",
    'chip.archive': "Archive",

    /* ---------------- relative days (no numbers within 3 days) ---------------- */
    'when.0': "Today",
    'when.1': "Tomorrow",
    'when.2': "In 2 days",

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
    // within 0/1/2 days the big number becomes "Today / Tomorrow / In 2 days"
    'hero.todayLabel': "<b>{name}</b> is",
    'hero.soonLabel': "<b>{name}</b> is",
    'hero.elapsedLabel': "<b>{name}</b> since",
    // the label sentence above already says left/passed, so the unit is just "days"
    'hero.unitRemain': "days",
    'hero.unitElapsed': "days",
    // birthdays are drawn the other way round: what is left, shrinking as the day nears; {n} is today's age
    'hero.barLeft': "{p}% to go",
    'hero.barLeftAge': "{n} years old, {p}% to go",
    // anniversaries count one round from the previous one to the next, i.e. a year
    'hero.barCycle': "{p}% of the year passed",
    // {n} is the real length of that round (lunar years and leap years differ from 365)
    'hero.barTotal': "{n} days in total",
    'hero.emptyHint': "Tap \"Add\" to record your first date",
    'hero.emptyArchiveHint': "Archived entries are not featured",

    /* ---------------- list rows ---------------- */
    'unit.overflow': "Out of range",
    'unit.todayRemain': "today",
    'unit.todayElapsed': "today",
    'unit.remain': "days",
    'unit.elapsed': "days",
    'tag.archived': "Archived · {k}",
    'tag.expired': "Expired countdown",

    /* ---------------- details ---------------- */
    'detail.title': "Details",
    // first info row: the same "date" means something else per kind
    'detail.dateOf.birthday': "Born",
    'detail.dateOf.anniversary': "The day",
    'detail.dateOf.countdown': "Target date",
    'detail.dateOf.festival': "Festival date",
    // the upcoming occurrence + how many days left
    'detail.bdayAge': "Turning {n}",
    'detail.bdayNext': "Next birthday",
    'detail.annAge': "Year {n}",
    'detail.annNext': "Next anniversary",
    'detail.span': "Elapsed",
    'detail.remind': "Reminders",
    'detail.status': "Status",
    'detail.repeat': "Repeat",
    'detail.note': "Note",
    'detail.statusArchived': "Archived",
    'detail.statusExpired': "Expired",
    'detail.daysLeft': "{n} days left",
    'detail.daysPast': "{n} days passed",
    'detail.todayLeft': "Today",
    'detail.todayPast': "Today",
    'detail.remindOff': "No reminders",
    'detail.remindArchived': "Archived — muted",
    'detail.remindLine': "{days} · {ch}",
    'detail.remindTask': "Task list",
    'detail.remindSnack': "Snackbar on open",
    'repeat.on': "Repeats yearly",
    'repeat.off': "No repeat",

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
    'form.namePh': "e.g. Mom",
    'form.nameRequired': "Please enter a name",
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
    'remind.hintBoth': "Creates an Inbox task tagged \"{t}\" and shows a snackbar when the app opens.",
    'remind.hintTask': "Creates an Inbox task tagged \"{t}\", synced with the app; switching off deletes it.",
    'remind.hintSnack': "Snackbar only when the app opens — the plugin has no background push.",
    'remind.hintNone': "This entry will not remind you (both channels are off).",

    /* ---------------- settings ---------------- */
    'set.hero': "Featured card",
    'set.heroToggle': "Enlarge the first entry",
    'set.heroHint': "Enlarges the first entry of <b>the current category</b>; when off the list starts at the top.",
    // group title says "Calendar"; the switch itself says "Enable the lunar calendar"
    'set.lunar': "Calendar",
    'set.lunarToggle': "Enable the lunar calendar",
    'set.lunarLocked': "{n} lunar entries exist, so this cannot be turned off — they would only show the Gregorian date and their calendar could no longer be edited. Delete them first.",
    'set.data': "Data",
    'set.clear': "Clear Milestone data cache",
    'set.clearHint': "For wrong data, duplicate tasks or bad dates. Clears every entry and setting and removes this plugin's tasks — <b>other tasks stay</b>.",
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
    'toast.lunarLocked': "Lunar entries exist — cannot turn it off",
    saveN: "Add {n}",
  };
});
