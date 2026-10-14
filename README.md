# Sales Export Cleanup (Google Sheets + Apps Script)

Turns a messy sales export into a clean table and a one-page summary with a chart, from a menu button inside Google Sheets. No add-ons and no outside services; the script lives in the spreadsheet itself.

## The problem

Exports from CRMs, shops and accounting tools are rarely ready to use. Dates come in three formats, money has dollar signs and commas, names are typed in different cases, and there are blank lines and duplicate orders. Cleaning that by hand every week is slow and easy to get wrong.

## What it does

Paste the export into a tab called **Raw Export**, then click **Sales Cleanup → Clean & summarize**. The script builds three tabs and leaves the original untouched:

- **Clean Data**: real dates, real numbers, tidy names ("MARK LEE" and "mark   lee" both become "Mark Lee"), regions made consistent, blank rows and exact duplicates removed, sorted by date, with filters on.
- **Summary**: order count, total revenue and average order, plus revenue by month, by sales rep and by region, and a column chart of revenue by month.
- **Cleanup Log**: every change and every skipped row, with the row number and the reason, so nothing disappears silently.

It understands:

| Messy input | Becomes |
| --- | --- |
| `2026-01-05`, `1/7/2026`, `1/15/26`, `Jan 9 2026`, `02-Feb-2026`, `February 10 2026` | a real date |
| `$1,200.00`, `"1,400"`, ` 350 `, `($400.00)` | 1200, 1400, 350, -400 |
| `  Bright Ideas LLC `, `MARK LEE`, `north ` | Bright Ideas LLC, Mark Lee, North |
| Header spelled ` Order_Date `, `Order Total`, `REGION` | matched to the right column |
| Blank quantity | 1 (noted in the log) |
| Blank sales rep | Unassigned |
| `pending` as a date, `TBD` as an amount | skipped and listed in the log |

Slash dates are read US style (month/day/year).

## Example

[`sample-data/messy-sales-export.csv`](sample-data/messy-sales-export.csv) is a made-up export with every problem above: 20 rows including 2 blank lines, 2 duplicate orders and 2 rows that can't be read.

After cleanup:

- [`sample-data/clean-data.csv`](sample-data/clean-data.csv): the 14 good orders
- [`sample-data/cleanup-log.csv`](sample-data/cleanup-log.csv): what was fixed or skipped
- Summary: 14 orders, $20,650 revenue, $1,475 average order

| Month | Revenue |
| --- | --- |
| Jan 2026 | $6,150 |
| Feb 2026 | $5,400 |
| Mar 2026 | $9,100 |

## How to install it

1. Open a Google Sheet and rename the first tab to **Raw Export**.
2. Import the export into it (File → Import → Upload, then "Replace current sheet"). The sample CSV works for a test.
3. Go to **Extensions → Apps Script**, delete what's there, paste in the contents of [`Code.gs`](Code.gs) and save.
4. Reload the spreadsheet. A **Sales Cleanup** menu appears next to Help.
5. Click **Sales Cleanup → Clean & summarize**. The first time, Google asks you to authorize the script for this spreadsheet.

Run it again whenever a new export is pasted in; the three tabs are rebuilt each time.

## Adapting it to another export

Column names are matched from a short list at the top of `Code.gs` (`COLUMN_ALIASES`). If a client's export calls the amount column "Net Sales", add that name to the list. If a required column is missing, the script says which one instead of guessing.

## How it was tested

The cleaning and summary logic is separate from the Sheets calls, so it can be tested on any computer with Node.js:

```bash
node --test tests/cleanup.test.js
```

The tests run the sample export through the script and check the row count, every log note, the date and money parsing, the name tidying and the revenue totals (which were also checked by hand).

## How I build these

I'm an automation specialist. I use no-code tools (Zapier, Make, n8n) when they fit, and AI coding tools (Claude Code) when a job needs custom code like this. I then test the result myself against real data before delivering it.
