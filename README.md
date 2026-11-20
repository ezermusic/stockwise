# StockWise v2.0 — Monthly Stocktaking & Management Reporting

A browser-first web application prototype built with separate HTML, CSS and JavaScript files. It is designed around the uploaded stock count workbook format and supports CSV, XLSX and XLS imports.

## Files
- `index.html` — application layout and CDN library references
- `styles.css` — responsive user interface
- `app.js` — import, mapping, reconciliation, validation, KPIs, exports and browser history

## Run
1. Extract the ZIP file and open `index.html` in a current version of Chrome or Edge.
2. An internet connection is required for the CDN-hosted SheetJS, ExcelJS, Chart.js, jsPDF and font assets.
3. Open **Import stock file**, drop in (or browse for) **one file** that contains both the system quantity and the physical quantity.
4. Confirm the field mapping, then click **Read stock file**.
5. Review the animated dashboard, validation messages and reconciliation.
6. Optionally add counts by hand on **Manual count**, generate PDF/Excel reports, and save the snapshot under **Monthly history**.

## The stock file (single upload)
One row per product. Column names are detected automatically and can be re-mapped before reading.

| Field | Typical header | Required |
|---|---|---|
| SKU / product code | `id**` | yes |
| Product name | `name*` | recommended |
| System quantity | `qty` | yes |
| Physical quantity | `count` | recommended (or count by hand) |
| Unit cost | `rpack_cost` | yes |
| Selling price | `sale_price` | recommended |
| Category, unit, expiry, counted by, notes | `category`, `unit`, `expiry`, `counted_by`, `notes` | optional |

A template can be downloaded from the app. Variance = system quantity − physical quantity.

## Blank cells
- Blank system quantity, unit cost and selling price are read as **0** (reported in the validation summary).
- A blank **physical quantity** is read as a counted quantity of **0** by default. Turn on *Treat a blank physical quantity as “not counted”* on the import page if blank means “not counted yet”; those items can then be counted on the Manual count page.
- If no physical-quantity column is mapped, every item is “Not counted” until counted manually.
- Non-numeric text (for example `n/a`) is flagged: system quantity, cost and price are set to 0 and the row is marked “Data issue”; an invalid physical quantity is ignored (item left uncounted).

## New in v2.0
- **One file instead of two.** The stock file carries both system and physical quantities; the separate count-sheet upload, matching step and “missing from count sheet” logic were removed. Manual count entries are added on top of the physical quantity in the file. Sessions saved by earlier versions are migrated automatically.
- **Redesigned, animated dashboard.** A live stock-health hero (headline figure, three animated progress rings, rotating insight ticker), count-up numbers, a stock-value bridge (system → not counted → shortage → surplus → physical), a clickable line-status donut, expiry radar, top-shortage leaderboard, category chart and data-bar discrepancy table, all with staggered entrance motion. Animations respect the system “reduce motion” setting.

## Dashboard
Metrics are grouped as **1) System** (stock cost + potential sales value), **2) Physical** (stock cost + potential sales value) and **3) Variance** (net cost variance + net sales value variance, with shortage and surplus shown beneath).

## New in v1.4
- **Remove the imported file.** The import card has a *Remove* button once a file is selected or imported. Removing the stock file clears the reconciliation (and its manual entries and recounts) after a confirmation, and the removal is saved so it survives a refresh. Saved monthly history is never touched.
- **No duplicate manual entries.** One entry per product per expiry date: re-entering the same product and expiry offers *Add to it*, *Replace* or *Cancel* instead of counting the stock twice. You are also warned when the product already has a physical quantity in the stock file (your entry would be added to it) or when another SKU with the same product name already has manual entries. Search results flag same-name products, the selected product shows its existing entries, and the inventory import warns about product names shared by several SKUs.

## New in v1.3
- **Priority alerts are filters.** Click *View items* on any dashboard alert to open Current stocktake filtered to exactly the lines behind it (or pick it from the new *Priority alert* dropdown). Each alert also has an *Export* menu (CSV, Excel, PDF), and the toolbar's *Export view* exports whatever filters are currently applied.
- **Numeric inputs**: spinner arrows removed everywhere; Up/Down arrow keys and the mouse wheel no longer change number values.
- **Product names lead** on screen, in sorting, and in the Excel and PDF reports; SKUs are shown as the secondary, muted detail.
- **Data persists across refreshes and browser restarts.** The working stocktake (inventory, counts, manual entries, recounts, validation), the page you were on, monthly history and report settings are saved automatically in this browser (IndexedDB). Existing history in localStorage is migrated automatically. Demo data is never saved. *Report settings → Saved data on this device* can clear the session or delete everything.

## New in v1.2
- **Drag and drop** uploads: drop a CSV, XLSX or XLS file anywhere on the System inventory or Physical count card (click-to-browse still works).
- **Lines with variances report**: the dashboard tile opens a full on-screen report (search, shortage/surplus and category filters). Export it as PDF, Excel or CSV from that page or from Reports & exports. The PDF has summary tiles, category analysis, every variance line with totals and a sign-off block; the Excel workbook has Summary, Variance Lines (live formulas), Shortages, Surpluses and By Category sheets.
- **Manual count entry** (sidebar: Manual count): a live search over the products in the stock file (SKU, barcode or name; arrow keys + Enter). Pick a product, enter quantity, optional expiry date, counted-by and notes. Entries are added to the physical quantity in the stock file. Add one entry per batch to give each batch its own expiry date; expiry-risk values are calculated per batch. A blind-count switch hides system quantities while counting. Entries are autosaved as a draft in this browser, can be removed individually, and appear in the Excel workbook (Manual Entries sheet) and CSV. Re-reading the stock file keeps them.

## New in v1.1
- Excel report built with ExcelJS: styled summary sheet, live formulas on the Reconciliation sheet, ranked shortages/surpluses, expiry risk, exceptions, category analysis with chart, validation log, print setup.
- PDF report with embedded Unicode font (`GH₵`), KPI groups, findings, category chart, ranked tables, data-quality tiles, expiry table and sign-off block.
- Editable physical counts (recounts) in the reconciliation table, with restore.
- Sortable columns, expiry/recount filters, filtered totals.
- Expiry tracking (expired / expiring within N days).
- Report settings: company name, prepared/reviewed by, high-value threshold, expiry window.
- History: trend chart, month-on-month comparison, JSON import.

## Count precedence
Physical quantity = quantity in the stock file + manual entries. A recount typed into the reconciliation table overrides that total for the line.

## Calculation conventions
- Quantity variance = system quantity − physical quantity.
- Positive variance = shortage; negative variance = surplus.
- Shortage exposure = positive quantity variance × unit cost.
- Surplus value = absolute negative quantity variance × unit cost.
- Potential sales value (system) = system quantity × unit selling price; (physical) = physical quantity × unit selling price.
- Sales value variance = quantity variance × unit selling price.
- Estimated gross profit = physical quantity × (selling price − unit cost).

Selling value and estimated gross profit are estimates, not realized revenue or confirmed losses. Uncounted records are excluded from physical and variance totals.

## Exports
- PDF executive stocktaking report
- Excel workbook (.xlsx; opens in all current versions of Excel) with executive summary, reconciliation, shortages, surpluses, not-counted items, expiry risk, data exceptions, category analysis and validation messages
- CSV reconciliation export
- Stock-file template
- JSON backup of browser-stored monthly history

## Important v1.0 limitations
- All saved data (session and history) lives in this browser (IndexedDB) on this device. It is not a shared database and is lost if site data is cleared or you use a private window; export JSON backups of history regularly.
- This is not a multi-user production system. It does not provide authentication, approval permissions or a server-side audit log.
- CDN libraries need internet access.
- The PDF/Excel export layouts are practical starter templates and should be tested with the business's actual file sizes and report branding.
- Before operational approval, validate calculations with a known test set and review the import validation exceptions.
- For production use, add a backend (e.g. Node.js/Express) and database (e.g. PostgreSQL), user authentication, access controls, immutable snapshots, audit logging, server-side validation and backups.

## Privacy
Files are parsed locally in the browser by this prototype. The application does not upload your stock files to a custom server. Third-party JavaScript libraries are loaded from CDNs, so use a trusted network and consider self-hosting dependencies for a production deployment.
