/**
 * Sales Export Cleanup for Google Sheets.
 *
 * Adds a "Sales Cleanup" menu. One click takes the messy export on the
 * "Raw Export" tab and builds three tabs:
 *   Clean Data   - fixed dates, numbers and names, blanks and duplicates removed
 *   Summary      - totals, revenue by month / sales rep / region, and a chart
 *   Cleanup Log  - what was changed and which rows were skipped, and why
 * The original "Raw Export" tab is never modified.
 */

var RAW_SHEET = 'Raw Export';
var CLEAN_SHEET = 'Clean Data';
var SUMMARY_SHEET = 'Summary';
var LOG_SHEET = 'Cleanup Log';

// Accepted spellings for each column in the export (compared after normalizeHeader).
var COLUMN_ALIASES = {
  date: ['order date', 'date', 'orderdate', 'sale date'],
  customer: ['customer', 'customer name', 'client'],
  rep: ['sales rep', 'rep', 'salesperson', 'sales person'],
  region: ['region', 'territory'],
  product: ['product', 'item', 'product name'],
  qty: ['qty', 'quantity', 'units'],
  amount: ['amount', 'total', 'revenue', 'sale amount', 'order total']
};
var CLEAN_HEADERS = ['Order Date', 'Customer', 'Sales Rep', 'Region', 'Product', 'Qty', 'Amount'];
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------- Menu ---------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Sales Cleanup')
    .addItem('Clean & summarize', 'runCleanup')
    .addToUi();
}

function runCleanup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName(RAW_SHEET);
  if (!raw) {
    SpreadsheetApp.getUi().alert('Put the export on a tab named "' + RAW_SHEET + '" and try again.');
    return;
  }
  var result = cleanRows(raw.getDataRange().getValues());
  if (result.error) {
    SpreadsheetApp.getUi().alert(result.error);
    return;
  }
  var summary = summarize(result.rows);

  writeCleanSheet(ss, result.rows);
  writeSummarySheet(ss, summary);
  writeLogSheet(ss, result.log);
  ss.setActiveSheet(ss.getSheetByName(SUMMARY_SHEET));
  ss.toast(result.rows.length + ' clean rows, ' + result.log.length + ' notes in the Cleanup Log.', 'Done', 8);
}

/* ---------- Cleaning (pure functions, no Sheets calls) ---------- */

function normalizeHeader(h) {
  return String(h).toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Map each field (date, rep, ...) to its column index, or report missing ones. */
function mapColumns(headerRow) {
  var headers = headerRow.map(normalizeHeader);
  var map = {}, missing = [];
  Object.keys(COLUMN_ALIASES).forEach(function (field) {
    var idx = -1;
    COLUMN_ALIASES[field].forEach(function (alias) {
      if (idx === -1) idx = headers.indexOf(alias);
    });
    if (idx === -1) missing.push(field); else map[field] = idx;
  });
  return { map: map, missing: missing };
}

/** Accepts real dates, 2026-01-31, 1/31/2026 (US order), 31-Jan-2026, Jan 31 2026, January 31, 2026. */
function parseDate(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = String(v).trim();
  if (!s) return null;
  var m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return makeDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
    var y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return makeDate(y, +m[1], +m[2]);
  }
  if ((m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3,})[\s\-,]+(\d{4})$/))) return makeDate(+m[3], monthIndex(m[2]) + 1, +m[1]);
  if ((m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/))) return makeDate(+m[3], monthIndex(m[1]) + 1, +m[2]);
  return null;
}

function monthIndex(name) {
  return MONTHS.indexOf(name.slice(0, 1).toUpperCase() + name.slice(1, 3).toLowerCase());
}

function makeDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  var date = new Date(y, mo - 1, d);
  return date.getMonth() === mo - 1 ? date : null; // rejects 31 Feb and the like
}

/** "$1,200.50", "1200.5", " 350 ", "(75.00)" -> number, or null if it isn't one. */
function parseAmount(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v).trim();
  if (!s) return null;
  var negative = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/^-|^\(|\)$/g, '').replace(/[$£€,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  var n = parseFloat(s);
  return negative ? -n : n;
}

/** "  jANE   doe " -> "Jane Doe" */
function tidyName(v) {
  return String(v).trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s\-'])([a-z])/g, function (_, sep, c) {
    return sep + c.toUpperCase();
  });
}

/**
 * Turn the raw export (2D array, header row first) into clean rows plus a log.
 * Returns { rows: [[date, customer, rep, region, product, qty, amount]], log: [[row, note]] }
 * or { error: '...' } when required columns are missing.
 */
function cleanRows(values) {
  var headerAt = -1;
  for (var i = 0; i < values.length && headerAt === -1; i++) {
    if (values[i].some(function (c) { return String(c).trim() !== ''; })) headerAt = i;
  }
  if (headerAt === -1) return { error: 'The "' + RAW_SHEET + '" tab is empty.' };

  var cols = mapColumns(values[headerAt]);
  if (cols.missing.length) {
    return { error: 'Could not find these columns: ' + cols.missing.join(', ') + '. Check the header row.' };
  }
  var c = cols.map, rows = [], log = [], seen = {}, blanks = 0;

  for (var r = headerAt + 1; r < values.length; r++) {
    var line = values[r], sheetRow = r + 1;
    if (line.every(function (cell) { return String(cell).trim() === ''; })) { blanks++; continue; }

    var date = parseDate(line[c.date]);
    var amount = parseAmount(line[c.amount]);
    var qtyRaw = String(line[c.qty]).trim();
    var qty = qtyRaw === '' ? 1 : parseAmount(qtyRaw);

    if (!date) { log.push([sheetRow, 'Skipped: unreadable date "' + line[c.date] + '"']); continue; }
    if (amount === null) { log.push([sheetRow, 'Skipped: unreadable amount "' + line[c.amount] + '"']); continue; }
    if (qty === null) { log.push([sheetRow, 'Skipped: unreadable quantity "' + line[c.qty] + '"']); continue; }
    if (qtyRaw === '') log.push([sheetRow, 'Quantity was blank, set to 1']);

    var clean = [
      date,
      tidyName(line[c.customer]),
      tidyName(line[c.rep]) || 'Unassigned',
      tidyName(line[c.region]) || 'Unknown',
      String(line[c.product]).trim().replace(/\s+/g, ' '),
      qty,
      Math.round(amount * 100) / 100
    ];
    var key = [toIsoDate(date)].concat(clean.slice(1)).join('|').toLowerCase();
    if (seen[key]) { log.push([sheetRow, 'Removed: duplicate of row ' + seen[key]]); continue; }
    seen[key] = sheetRow;
    rows.push(clean);
  }
  if (blanks) log.push(['-', blanks + ' blank row(s) removed']);
  rows.sort(function (a, b) { return a[0] - b[0]; });
  return { rows: rows, log: log };
}

function toIsoDate(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

/** Totals plus revenue grouped by month, rep and region (each sorted). */
function summarize(rows) {
  var total = 0, byMonth = {}, byRep = {}, byRegion = {};
  rows.forEach(function (r) {
    var amt = r[6];
    total += amt;
    var month = r[0].getFullYear() + '-' + ('0' + (r[0].getMonth() + 1)).slice(-2);
    byMonth[month] = (byMonth[month] || 0) + amt;
    byRep[r[2]] = (byRep[r[2]] || 0) + amt;
    byRegion[r[3]] = (byRegion[r[3]] || 0) + amt;
  });
  function toTable(obj, sortByKey) {
    var t = Object.keys(obj).map(function (k) { return [k, Math.round(obj[k] * 100) / 100]; });
    return t.sort(sortByKey ? function (a, b) { return a[0] < b[0] ? -1 : 1; } : function (a, b) { return b[1] - a[1]; });
  }
  return {
    orders: rows.length,
    revenue: Math.round(total * 100) / 100,
    average: rows.length ? Math.round((total / rows.length) * 100) / 100 : 0,
    byMonth: toTable(byMonth, true).map(function (r) {
      var parts = r[0].split('-');
      return [MONTHS[+parts[1] - 1] + ' ' + parts[0], r[1]];
    }),
    byRep: toTable(byRep, false),
    byRegion: toTable(byRegion, false)
  };
}

/* ---------- Writing the tabs ---------- */

function freshSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (sheet) {
    sheet.clear();
    sheet.getCharts().forEach(function (ch) { sheet.removeChart(ch); });
  } else {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function styleHeader(range) {
  range.setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
}

function writeCleanSheet(ss, rows) {
  var sheet = freshSheet(ss, CLEAN_SHEET);
  sheet.getRange(1, 1, 1, CLEAN_HEADERS.length).setValues([CLEAN_HEADERS]);
  styleHeader(sheet.getRange(1, 1, 1, CLEAN_HEADERS.length));
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, CLEAN_HEADERS.length).setValues(rows);
    sheet.getRange(2, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(2, 7, rows.length, 1).setNumberFormat('$#,##0.00');
    sheet.getRange(1, 1, rows.length + 1, CLEAN_HEADERS.length).createFilter();
  }
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, CLEAN_HEADERS.length);
}

function writeSummarySheet(ss, s) {
  var sheet = freshSheet(ss, SUMMARY_SHEET);
  var money = '$#,##0.00';

  sheet.getRange('A1').setValue('Sales Summary').setFontSize(16).setFontWeight('bold');
  sheet.getRange('A3:B5').setValues([['Orders', s.orders], ['Total revenue', s.revenue], ['Average order', s.average]]);
  sheet.getRange('A3:A5').setFontWeight('bold');
  sheet.getRange('B4:B5').setNumberFormat(money);

  var tables = [
    { col: 1, title: 'Month', data: s.byMonth },
    { col: 4, title: 'Sales Rep', data: s.byRep },
    { col: 7, title: 'Region', data: s.byRegion }
  ];
  tables.forEach(function (t) {
    sheet.getRange(7, t.col, 1, 2).setValues([[t.title, 'Revenue']]);
    styleHeader(sheet.getRange(7, t.col, 1, 2));
    if (t.data.length) {
      sheet.getRange(8, t.col, t.data.length, 2).setValues(t.data);
      sheet.getRange(8, t.col + 1, t.data.length, 1).setNumberFormat(money);
    }
  });

  if (s.byMonth.length) {
    var chart = sheet.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(sheet.getRange(7, 1, s.byMonth.length + 1, 2))
      .setNumHeaders(1)
      .setPosition(7, 10, 0, 0)
      .setOption('title', 'Revenue by month')
      .setOption('legend', { position: 'none' })
      .build();
    sheet.insertChart(chart);
  }
  sheet.autoResizeColumns(1, 8);
}

function writeLogSheet(ss, log) {
  var sheet = freshSheet(ss, LOG_SHEET);
  var rows = log.length ? log : [['-', 'Nothing needed fixing']];
  sheet.getRange(1, 1, 1, 2).setValues([['Raw row', 'What happened']]);
  styleHeader(sheet.getRange(1, 1, 1, 2));
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 2);
}

// Lets the offline tests load this file in Node. Apps Script ignores it.
if (typeof module !== 'undefined') {
  module.exports = { normalizeHeader: normalizeHeader, mapColumns: mapColumns, parseDate: parseDate,
    parseAmount: parseAmount, tidyName: tidyName, cleanRows: cleanRows, summarize: summarize };
}
