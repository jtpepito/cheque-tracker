// Cheque tracker sync. Paste this into the sheet (Extensions > Apps Script), then set
// APP_URL and SYNC_KEY under Project Settings > Script Properties.
// It reads the Check Issuances tab, fills the "Tracker ID" column and sends the rows to the
// tracker. Every rule about what a row means lives in the tracker, not here.

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

function norm_(value) {
  return String(value).trim().toLowerCase();
}

/** Column index (0-based) of each named header in row 1. Throws, naming any that is missing. */
function findColumns_(sheet, wanted) {
  const header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0].map(norm_);
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

/** 0-based index of the Tracker ID column, or -1 when it does not exist yet. */
function idColumn_(sheet) {
  const header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0].map(norm_);
  return header.indexOf(norm_(ID_HEADER));
}

function newId_() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "sh-";
  for (let i = 0; i < 10; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  return id;
}

/**
 * Reads the cheque rows. Fills a blank Tracker ID, and replaces one that repeats an ID
 * higher up (a copied row), then writes the ID column back once.
 */
function readRows_() {
  const sheet = tab_(TAB);
  const cols = findColumns_(sheet, HEADERS);
  const idCol = idColumn_(sheet);
  if (idCol < 0) throw new Error('Run "Give existing rows their IDs (one time)" from the ' + MENU + " menu first.");

  const range = sheet.getDataRange();
  const values = range.getValues();
  const shown = range.getDisplayValues();
  const zone = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const dateOf = function (r, c) {
    const v = values[r][c];
    return v instanceof Date ? Utilities.formatDate(v, zone, "yyyy-MM-dd") : shown[r][c].trim();
  };

  const seen = {};
  const ids = [];
  let idsChanged = false;
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    let id = shown[r][idCol] ? shown[r][idCol].trim() : "";
    const isCheque = shown[r][cols.supplier].trim() || shown[r][cols.chequeNo].trim() || shown[r][cols.amount].trim();
    if (!isCheque) {
      ids.push([id]);
      continue;
    }
    if (!id || seen[id]) {
      id = newId_();
      idsChanged = true;
    }
    seen[id] = true;
    ids.push([id]);
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
  if (idsChanged && ids.length) sheet.getRange(2, idCol + 1, ids.length, 1).setValues(ids);
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

/** Sends the tab to the tracker. Returns { ok, code, report | error }. */
function send_(options) {
  const props = PropertiesService.getScriptProperties();
  const url = (props.getProperty("APP_URL") || "").replace(/\/+$/, "");
  const key = props.getProperty("SYNC_KEY") || "";
  if (!url || !key) throw new Error("Set APP_URL and SYNC_KEY in Project Settings > Script Properties.");

  const body = {
    dryRun: !!options.dryRun,
    allowRemovals: !!options.allowRemovals,
    rows: readRows_(),
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
  let data = {};
  try {
    data = JSON.parse(response.getContentText());
  } catch (e) {
    data = { error: "The tracker did not answer properly (HTTP " + code + ")." };
  }
  return code === 200 ? { ok: true, code: code, report: data } : { ok: false, code: code, error: data.error || "HTTP " + code };
}

function describe_(result) {
  if (!result.ok) return "The tracker refused this:\n\n" + result.error;
  const r = result.report;
  const lines = [
    r.dryRun ? "Check only. Nothing was changed." : "Synced.",
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
  if (r.problems.length > 15) lines.push("  …and " + (r.problems.length - 15) + " more (see the tracker).");
  return lines.join("\n");
}

function runFromMenu_(options) {
  const ui = SpreadsheetApp.getUi();
  try {
    ui.alert(MENU, describe_(send_(options)), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert(MENU, String(e.message || e), ui.ButtonSet.OK);
  }
}

function menuCheck() {
  runFromMenu_({ dryRun: true });
}
function menuSync() {
  runFromMenu_({});
}
function menuSyncAllowingRemovals() {
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
 * the IDs the tracker already holds from the original import. Refuses if any ID exists.
 */
function menuGiveExistingIds() {
  const ui = SpreadsheetApp.getUi();
  try {
    const sheet = tab_(TAB);
    const cols = findColumns_(sheet, HEADERS);
    let idCol = idColumn_(sheet);
    const last = sheet.getLastRow();
    if (idCol >= 0 && last >= 2) {
      const existing = sheet.getRange(2, idCol + 1, last - 1, 1).getDisplayValues();
      const used = existing.some(function (row) {
        return row[0].trim() !== "";
      });
      if (used) throw new Error("The Tracker ID column already has IDs. This step is only for the first time.");
    }
    if (idCol < 0) {
      idCol = sheet.getLastColumn();
      sheet.getRange(1, idCol + 1).setValue(ID_HEADER);
    }
    if (last < 2) throw new Error("There are no cheque rows yet.");
    const shown = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getDisplayValues();
    let count = 0;
    const ids = shown.map(function (row, i) {
      const isCheque = row[cols.supplier].trim() || row[cols.chequeNo].trim() || row[cols.amount].trim();
      if (!isCheque) return [""];
      count++;
      return ["imp-" + (i + 2)];
    });
    sheet.getRange(2, idCol + 1, ids.length, 1).setValues(ids);
    ui.alert(MENU, count + " rows were given their IDs. Next: Check against the tracker (no changes).", ui.ButtonSet.OK);
  } catch (e) {
    ui.alert(MENU, String(e.message || e), ui.ButtonSet.OK);
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
  if (watched_().indexOf(e.range.getSheet().getName()) >= 0) {
    PropertiesService.getScriptProperties().setProperty("CHANGED", "1");
  }
}

/** Every minute: sends if something changed. On failure the flag is put back so the next minute retries. */
function syncIfChanged() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("CHANGED") !== "1") return;
  autoSync_();
}

/** Every hour: sends regardless. */
function syncHourly() {
  autoSync_();
}

function autoSync_() {
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    // Cleared before sending, so an edit made while sending is not lost.
    props.deleteProperty("CHANGED");
    const result = send_({});
    if (!result.ok) {
      props.setProperty("CHANGED", "1");
      console.error("Cheque tracker sync refused: " + result.error);
    }
  } catch (e) {
    props.setProperty("CHANGED", "1");
    console.error("Cheque tracker sync failed: " + (e.message || e));
  } finally {
    lock.releaseLock();
  }
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    const fn = trigger.getHandlerFunction();
    if (fn === "markChanged" || fn === "syncIfChanged" || fn === "syncHourly") ScriptApp.deleteTrigger(trigger);
  });
}

function menuAutoOn() {
  removeTriggers_();
  const ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger("markChanged").forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger("syncIfChanged").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("syncHourly").timeBased().everyHours(1).create();
  PropertiesService.getScriptProperties().setProperty("CHANGED", "1");
  SpreadsheetApp.getUi().alert(MENU, "Automatic sync is on. Edits reach the tracker within about a minute.", SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuAutoOff() {
  removeTriggers_();
  SpreadsheetApp.getUi().alert(MENU, "Automatic sync is off.", SpreadsheetApp.getUi().ButtonSet.OK);
}
