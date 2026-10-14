// Offline tests for the cleaning logic in Code.gs. Run with:  node --test tests/cleanup.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../Code.gs');

// Minimal CSV reader (handles quoted fields with commas) so the sample file can be used as-is.
function readCsv(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map(line => {
    const cells = []; let cur = '', quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}

const sample = readCsv(path.join(__dirname, '..', 'sample-data', 'messy-sales-export.csv'));

test('reads many date formats', () => {
  const same = s => { const d = lib.parseDate(s); return d && [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-'); };
  assert.strictEqual(same('2026-01-05'), '2026-1-5');
  assert.strictEqual(same('1/7/2026'), '2026-1-7');
  assert.strictEqual(same('1/15/26'), '2026-1-15');
  assert.strictEqual(same('Jan 9 2026'), '2026-1-9');
  assert.strictEqual(same('02-Feb-2026'), '2026-2-2');
  assert.strictEqual(same('February 10 2026'), '2026-2-10');
  assert.strictEqual(same('January 31, 2026'), '2026-1-31');
  assert.strictEqual(lib.parseDate('pending'), null);
  assert.strictEqual(lib.parseDate('2/31/2026'), null);
  assert.strictEqual(lib.parseDate(''), null);
});

test('reads money and numbers', () => {
  assert.strictEqual(lib.parseAmount('$1,200.00'), 1200);
  assert.strictEqual(lib.parseAmount(' 350 '), 350);
  assert.strictEqual(lib.parseAmount('($400.00)'), -400);
  assert.strictEqual(lib.parseAmount('-25.5'), -25.5);
  assert.strictEqual(lib.parseAmount(99.9), 99.9);
  assert.strictEqual(lib.parseAmount('TBD'), null);
  assert.strictEqual(lib.parseAmount('12-5'), null);
});

test('tidies names', () => {
  assert.strictEqual(lib.tidyName('  mark   lee'), 'Mark Lee');
  assert.strictEqual(lib.tidyName('MARK LEE'), 'Mark Lee');
  assert.strictEqual(lib.tidyName("o'brien-smith"), "O'Brien-Smith");
});

test('cleans the sample export', () => {
  const { rows, log, error } = lib.cleanRows(sample);
  assert.strictEqual(error, undefined);
  // 20 data lines: 2 blank, 2 unreadable (date "pending", amount "TBD"), 2 duplicates -> 14 rows
  assert.strictEqual(rows.length, 14);
  const notes = log.map(l => l[1]).join('\n');
  assert.match(notes, /unreadable date "pending"/);
  assert.match(notes, /unreadable amount "TBD"/);
  assert.match(notes, /duplicate of row 3/);
  assert.match(notes, /duplicate of row 19/);
  assert.match(notes, /2 blank row\(s\) removed/);
  assert.match(notes, /Quantity was blank, set to 1/);
  // sorted by date, names and regions tidied
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1][0] <= rows[i][0]);
  assert.deepStrictEqual([...new Set(rows.map(r => r[3]))].sort(), ['East', 'North', 'South', 'West']);
  assert.ok(rows.some(r => r[2] === 'Unassigned'));
});

test('summarizes revenue', () => {
  const s = lib.summarize(lib.cleanRows(sample).rows);
  assert.strictEqual(s.orders, 14);
  assert.strictEqual(s.revenue, 20650);
  assert.deepStrictEqual(s.byMonth, [['Jan 2026', 6150], ['Feb 2026', 5400], ['Mar 2026', 9100]]);
  assert.deepStrictEqual(s.byRep, [['Priya Shah', 7300], ['Mark Lee', 7150], ['Jane Doe', 5500], ['Unassigned', 700]]);
});

test('explains missing columns', () => {
  const r = lib.cleanRows([['Date', 'Customer', 'Amount'], ['1/1/2026', 'X', '5']]);
  assert.match(r.error, /rep, region, product, qty/);
});
