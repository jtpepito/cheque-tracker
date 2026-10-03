// Cheque tracker sync. Paste this into the sheet (Extensions > Apps Script), then set
// APP_URL and SYNC_KEY under Project Settings > Script Properties.
// It reads the Check Issuances tab, fills the "Tracker ID" column and sends the rows to the
// tracker. Every rule about what a row means lives in the tracker, not here.
// The only cells this script ever writes are in the "Tracker ID" column.

const TAB = "Check Issuances";
const SI_TABS = { wwj: ["WWJ SI"], wythlae: ["Wythlae SI"], wwjcorp: ["WWJ Corp SI"] };
const HEADERS = {
  date: "Date",
  supplier: "Name of Supplier",
  chequeNo: "Check Number",
  amount: "Amount",
  chequeDate: "Cheque Date",
  status: "Check Status",
  reference: "CR No./ SI No.",
};
const ID_HEADER = "Tracker ID";
const PAYMENT_HEADER = "Payment Details";
const MENU = "Cheque tracker";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(MENU)
    .addItem("Check against the tracker (no changes)", "menuCheck")
    .addItem("Sync now", "menuSync")
    .addItem("Sync now, allowing removals", "menuSyncAllowingRemovals")
    .addSeparator()
    .addItem("Give existing rows their IDs (one time)", "menuGiveExistingIds")
    .addItem("Turn automatic sync on", "menuAutoOn")
    .addItem("Turn automatic sync off", "menuAutoOff")
    .addToUi();
}

function props_() {
  return PropertiesService.getScriptProperties();
}

function norm_(value) {
  return String(value).trim().toLowerCase();
}

function headerRow_(sheet) {
  return sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0].map(norm_);
}

/** Column index (0-based) of each named header in row 1. Throws, naming any that is missing. */
function findColumns_(sheet, wanted) {
  const header = headerRow_(sheet);
  const found = {};
  Object.keys(wanted).forEach(function (key) {
    const index = header.indexOf(norm_(wanted[key]));
    if (index < 0) throw new Error('The "' + sheet.getName() + '" tab has no "' + wanted[key] + '" column.');
    found[key] = index;
  });
  return found;
}

function tab_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('This spreadsheet has no "' + name + '" tab.');
  return sheet;
}

/** 0-based index of the Tracker ID column, or -1 when it does not exist. */
function idColumn_(sheet) {
  return headerRow_(sheet).indexOf(norm_(ID_HEADER));
}

function newId_() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "sh-";
  for (let i = 0; i < 10; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  return id;
}

/**
 * Reads the cheque rows. When assignIds is true, a row with no Tracker ID gets one, and a row
 * that repeats an ID found higher up (a copied row) gets a new one. Only those cells are
 * written, each after checking that the row has not moved since it was read.
 */
function readRows_(assignIds) {
  const sheet = tab_(TAB);
  const cols = findColumns_(sheet, HEADERS);
  const idCol = idColumn_(sheet);
  if (idCol < 0) {
    throw new Error(
      props_().getProperty("IDS_GIVEN")
        ? 'The "' + ID_HEADER + '" column heading is missing. Put the heading back above the IDs. Do not run the one-time step again.'
        : 'Run "Give existing rows their IDs (one time)" from the ' + MENU + " menu first.",
    );
  }

  const range = sheet.getDataRange();
  const values = range.getValues();
  const shown = range.getDisplayValues();
  const zone = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const dateOf = function (r, c) {
    const v = values[r][c];
    return v instanceof Date ? Utilities.formatDate(v, zone, "yyyy-MM-dd") : shown[r][c].trim();
  };

  const seen = {};
  const toWrite = [];
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const isCheque = shown[r][cols.supplier].trim() || shown[r][cols.chequeNo].trim() || shown[r][cols.amount].trim();
    if (!isCheque) continue;
    const had = shown[r][idCol] ? shown[r][idCol].trim() : "";
    let id = had;
    if (assignIds && (!id || seen[id])) {
      id = newId_();
      toWrite.push({ r: r, had: had, id: id });
    }
    if (id) seen[id] = true;
    const amount = values[r][cols.amount];
    rows.push({
      id: id,
      row: r + 1,
      date: dateOf(r, cols.date),
      supplier: shown[r][cols.supplier],
      chequeNo: shown[r][cols.chequeNo],
      amount: typeof amount === "number" ? amount : shown[r][cols.amount],
      chequeDate: dateOf(r, cols.chequeDate),
      status: shown[r][cols.status],
      reference: shown[r][cols.reference],
    });
  }

  toWrite.forEach(function (w) {
    // Someone may have inserted, deleted or sorted rows since the read. Write only if this row
    // still shows the same supplier, cheque number and ID; otherwise stop and try again later.
    const now = sheet.getRange(w.r + 1, 1, 1, values[w.r].length).getDisplayValues()[0];
    const same =
      now[cols.supplier] === shown[w.r][cols.supplier] &&
      now[cols.chequeNo] === shown[w.r][cols.chequeNo] &&
      (now[idCol] ? now[idCol].trim() : "") === w.had;
    if (!same) throw new Error("The sheet was being edited while it was read. Nothing was sent; it will be tried again.");
    sheet.getRange(w.r + 1, idCol + 1).setValue(w.id);
  });
  return rows;
}

/** The Payment Details text of each company's SI tab(s). */
function readSiRefs_() {
  const refs = {};
  Object.keys(SI_TABS).forEach(function (company) {
    refs[company] = SI_TABS[company]
      .map(function (name) {
        const sheet = tab_(name);
        const col = findColumns_(sheet, { payment: PAYMENT_HEADER }).payment;
        const last = sheet.getLastRow();
        if (last < 2) return "";
        return sheet
          .getRange(2, col + 1, last - 1, 1)
          .getDisplayValues()
          .map(function (row) {
            return row[0];
          })
          .join("\n");
      })
      .join("\n");
  });
  return refs;
}

/**
 * Sends the tab to the tracker. Returns { ok, code, report | error }.
 * A check (dryRun) changes nothing anywhere: no IDs are written and the tracker rolls back.
 * A real sync is only sent from the one spreadsheet the tracker follows (BOUND_ID).
 */
function send_(options) {
  const props = props_();
  const url = (props.getProperty("APP_URL") || "").replace(/\/+$/, "");
  const key = props.getProperty("SYNC_KEY") || "";
  if (!url || !key) throw new Error("Set APP_URL and SYNC_KEY in Project Settings > Script Properties.");
  if (url.indexOf("https://") !== 0) throw new Error("APP_URL must start with https://");
  if (!options.dryRun && props.getProperty("BOUND_ID") !== SpreadsheetApp.getActive().getId()) {
    throw new Error(
      "The tracker follows a different spreadsheet, so this one can only be checked, not synced. " +
        "(If this is a copy, that is expected.)",
    );
  }

  const body = {
    dryRun: !!options.dryRun,
    allowRemovals: !!options.allowRemovals,
    rows: readRows_(!options.dryRun),
    siRefs: readSiRefs_(),
  };
  const response = UrlFetchApp.fetch(url + "/api/sync", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  let data = null;
  try {
    data = JSON.parse(response.getContentText());
  } catch (e) {
    data = null;
  }
  if (code === 200 && data && Array.isArray(data.problems)) return { ok: true, code: code, report: data };
  return { ok: false, code: code, error: (data && data.error) || "The tracker did not answer properly (HTTP " + code + ")." };
}

function describe_(result) {
  if (!result.ok) return "The tracker refused this:\n\n" + result.error;
  const r = result.report;
  const lines = [
    r.dryRun ? "Check only. Nothing was changed, here or in the tracker." : "Synced.",
    "",
    "Rows read: " + r.rows,
    "Added: " + r.added,
    "Changed: " + r.changed,
    "Removed: " + r.removed,
    "Unchanged: " + r.unchanged,
    "Rows to fix: " + r.problems.length,
  ];
  r.problems.slice(0, 15).forEach(function (p) {
    lines.push("  Row " + p.row + ": " + p.reason);
  });
  if (r.problems.length > 15) lines.push("  ...and " + (r.problems.length - 15) + " more (see the tracker).");
  return lines.join("\n");
}

function alert_(message) {
  const ui = SpreadsheetApp.getUi();
  ui.alert(MENU, message, ui.ButtonSet.OK);
}

/** Menu runs take the same lock as the timers, so two runs never hand out IDs at once. */
function runFromMenu_(options) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    alert_("A sync is running right now. Try again in a minute.");
    return;
  }
  try {
    alert_(describe_(send_(options)));
  } catch (e) {
    alert_(String(e.message || e));
  } finally {
    lock.releaseLock();
  }
}

/** The first real sync makes this spreadsheet the one the tracker follows, after asking. */
function bindIfNeeded_() {
  const props = props_();
  const id = SpreadsheetApp.getActive().getId();
  const bound = props.getProperty("BOUND_ID");
  if (bound === id) return true;
  const ui = SpreadsheetApp.getUi();
  if (bound) {
    alert_("The tracker follows a different spreadsheet, so this one can only be checked, not synced. (If this is a copy, that is expected.)");
    return false;
  }
  const answer = ui.alert(
    MENU,
    'Make "' + SpreadsheetApp.getActive().getName() + '" the spreadsheet the tracker follows? ' +
      "Choose Cancel if this is a test copy.",
    ui.ButtonSet.OK_CANCEL,
  );
  if (answer !== ui.Button.OK) return false;
  props.setProperty("BOUND_ID", id);
  return true;
}

function menuCheck() {
  runFromMenu_({ dryRun: true });
}

function menuSync() {
  if (bindIfNeeded_()) runFromMenu_({});
}

function menuSyncAllowingRemovals() {
  if (!bindIfNeeded_()) return;
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert(
    MENU,
    "Cheques that are no longer in this tab will be removed from the tracker, however many there are. Continue?",
    ui.ButtonSet.OK_CANCEL,
  );
  if (answer === ui.Button.OK) runFromMenu_({ allowRemovals: true });
}

/**
 * One time: adds the Tracker ID column and gives every existing cheque row "imp-<row number>",
 * the IDs the tracker already holds from the original import. It refuses to run a second time,
 * because row numbers change once rows are sorted, inserted or deleted.
 */
function menuGiveExistingIds() {
  const props = props_();
  try {
    if (props.getProperty("IDS_GIVEN")) {
      throw new Error("This step has already been done for this spreadsheet and must not be repeated.");
    }
    const sheet = tab_(TAB);
    const cols = findColumns_(sheet, HEADERS);
    let idCol = idColumn_(sheet);
    const last = sheet.getLastRow();
    if (last < 2) throw new Error("There are no cheque rows yet.");
    if (idCol >= 0) {
      const existing = sheet.getRange(2, idCol + 1, last - 1, 1).getDisplayValues();
      const used = existing.some(function (row) {
        return row[0].trim() !== "";
      });
      if (used) throw new Error("The Tracker ID column already has IDs. This step is only for the first time.");
    } else {
      idCol = sheet.getLastColumn();
      if (sheet.getMaxColumns() < idCol + 1) sheet.insertColumnAfter(sheet.getMaxColumns());
      sheet.getRange(1, idCol + 1).setValue(ID_HEADER);
    }
    const shown = sheet.getRange(2, 1, last - 1, idCol).getDisplayValues();
    let count = 0;
    const ids = shown.map(function (row, i) {
      const isCheque = row[cols.supplier].trim() || row[cols.chequeNo].trim() || row[cols.amount].trim();
      if (!isCheque) return [""];
      count++;
      return ["imp-" + (i + 2)];
    });
    sheet.getRange(2, idCol + 1, ids.length, 1).setValues(ids);
    props.setProperty("IDS_GIVEN", "1");
    // A warning (not a block) when someone edits the IDs by hand.
    sheet
      .getRange(1, idCol + 1, sheet.getMaxRows(), 1)
      .protect()
      .setDescription("Tracker IDs: filled in automatically. Please do not edit.")
      .setWarningOnly(true);
    alert_(count + " rows were given their IDs. Next: Check against the tracker (no changes).");
  } catch (e) {
    alert_(String(e.message || e));
  }
}

// ---- Automatic sync ----

function watched_() {
  let names = [TAB];
  Object.keys(SI_TABS).forEach(function (company) {
    names = names.concat(SI_TABS[company]);
  });
  return names;
}

/** Installable on-edit trigger: notes that something changed. The minute timer does the sending. */
function markChanged(e) {
  if (!e || !e.range) return;
  if (watched_().indexOf(e.range.getSheet().getName()) >= 0) props_().setProperty("CHANGED", "1");
}

/** Installable on-change trigger: deleting, inserting or sorting rows does not count as an edit. */
function markStructureChanged(e) {
  if (e && e.changeType && e.changeType !== "EDIT" && e.changeType !== "FORMAT") props_().setProperty("CHANGED", "1");
}

/** Every minute: sends if something changed. */
function syncIfChanged() {
  if (props_().getProperty("CHANGED") === "1") autoSync_();
}

/** Every hour: sends regardless. */
function syncHourly() {
  autoSync_();
}

function autoSync_() {
  const props = props_();
  // Only the spreadsheet the tracker follows syncs by itself; a copy does nothing.
  if (props.getProperty("BOUND_ID") !== SpreadsheetApp.getActive().getId()) {
    props.deleteProperty("CHANGED");
    return;
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    // Cleared before sending, so an edit made while sending is not lost.
    props.deleteProperty("CHANGED");
    const result = send_({});
    if (result.ok) return;
    console.error("Cheque tracker sync refused (" + result.code + "): " + result.error);
    // A refusal (4xx) will not fix itself, so it waits for the next edit or the hourly run,
    // and the tracker's page shows the reason. Anything else is retried next minute.
    if (result.code < 400 || result.code >= 500) props.setProperty("CHANGED", "1");
  } catch (e) {
    props.setProperty("CHANGED", "1");
    console.error("Cheque tracker sync failed: " + (e.message || e));
  } finally {
    lock.releaseLock();
  }
}

function removeTriggers_() {
  const mine = ["markChanged", "markStructureChanged", "syncIfChanged", "syncHourly"];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (mine.indexOf(trigger.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(trigger);
  });
}

// Triggers belong to the Google account that created them, so only that account can remove them.
function menuAutoOn() {
  const props = props_();
  const me = Session.getEffectiveUser().getEmail();
  const by = props.getProperty("AUTO_BY");
  if (by && by !== me) {
    alert_("Automatic sync is already on, set up by " + by + ". Ask them to turn it off first.");
    return;
  }
  if (props.getProperty("BOUND_ID") !== SpreadsheetApp.getActive().getId()) {
    alert_('Run "Sync now" once first, so the tracker follows this spreadsheet.');
    return;
  }
  removeTriggers_();
  const ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger("markChanged").forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger("markStructureChanged").forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger("syncIfChanged").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("syncHourly").timeBased().everyHours(1).create();
  props.setProperty("AUTO_BY", me);
  props.setProperty("CHANGED", "1");
  alert_("Automatic sync is on, running as " + me + ". Edits reach the tracker within about a minute.");
}

function menuAutoOff() {
  const props = props_();
  const me = Session.getEffectiveUser().getEmail();
  const by = props.getProperty("AUTO_BY");
  if (by && by !== me) {
    alert_("Automatic sync was turned on by " + by + ". Only that account can turn it off.");
    return;
  }
  removeTriggers_();
  props.deleteProperty("AUTO_BY");
  alert_("Automatic sync is off.");
}
