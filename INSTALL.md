# Stockline: separate Part Number from barcode SKU

Prepared for the scripts supplied in this conversation. This is a PATCH package, not a replacement app. Keep all working files and apply each change once. PartNumber is optional text, maximum 80 characters, with no uniqueness requirement. Existing values start blank; no automatic copying of SKU.

## 0. Back up and prepare

Back up the spreadsheet and current source/deployment. Drain pending queues on all devices; stop all users from saving during migration/deployment. Check Inventory column N: it must be unused or already correctly named PartNumber. Do not insert/reorder columns A:M. Do not run setup(). Keep your existing money_ helper wherever it is currently defined: it is referenced but was not included in the supplied Code.gs. This patch does not redefine or replace it.

## 1. Backend: five edits in existing Code.gs

### A. Replace the INV_HEADERS declaration with:

```js
const INV_HEADERS = [
  'ID', 'Name', 'SKU', 'HomeQty', 'TruckQty',
  'ReorderLevel', 'Notes', 'Active', 'CreatedAt', 'UpdatedAt',
  'Category', 'CostPrice', 'RetailPrice', 'PartNumber'
];
```

### B. In normalized_(p), immediately before return out; add:

```js
out.PartNumber = partNumber_(p.PartNumber);
```

### C. In details_(p), after SKU: p.SKU, add:

```js
PartNumber: p.PartNumber,
```

Keep the comma after this new property. This records part-number changes in detail-edit history. Transaction headers and stock snapshot format do not change.

### D. In mutate_(data)'s addItem branch, immediately after:

```js
p.RetailPrice = money_(data.RetailPrice, 'Retail price');
```

add:

```js
p.PartNumber = partNumber_(data.PartNumber);
```

### E. In mutate_(data)'s editItem branch, before after=details_(p); add:

```js
// Preserve Part Number when an older client omits the field.
if (data.PartNumber !== undefined) {
  p.PartNumber = partNumber_(data.PartNumber);
}
```

Keep all revision, locking, SKU uniqueness, price, origin and deduplication logic unchanged.

## 2. Add PartNumbers.gs, migrate, then redeploy

Add the included PartNumbers.gs as a NEW file in the same Apps Script project. Save all edits. Run migratePartNumbers() from the editor once, after backup and while writes are paused. Approve authorization if requested. Successful result: {ok:true, column:'N', field:'PartNumber'}.

Migration validates A:M before changes, checks N for collisions/formulas, adds only N's header and text formatting, and does not rewrite existing product data, timestamps or transactions. It refuses numeric pre-existing PartNumber cells rather than guessing lost leading zeros. Re-running is allowed for a correctly migrated sheet. If it fails, stop; inspect the error instead of deleting/moving data at random.

Then use Deploy -> Manage deployments -> edit your existing web-app deployment -> New version -> Deploy. Keep the same /exec URL. Do not run setup(), migratePrices(), or create a new deployment URL for this change.

StockDelta.gs needs NO edits: the supplied version reads INV_HEADERS, calls normalized_(), and writes INV_HEADERS.map(...), so it carries PartNumber through stock changes. The same header-driven paths in Code.gs preserve it during moves, adjustments and archive.

## 3. categories.js: update active search and card display

Your categories add-on replaces render(), so editing only script.js is insufficient.

### A. Find:

```js
.filter(p=>[p.Name,p.SKU,p.Notes,categoryOf(p)].join(' ').toLowerCase().includes(q))
```

Replace with:

```js
.filter(p=>[p.Name,p.PartNumber,p.SKU,p.Notes,categoryOf(p)].join(' ').toLowerCase().includes(q))
```

### B. Inside the product-card template, find:

```js
<h3>${esc(p.Name)}</h3><p class="muted">${esc(p.SKU||'No SKU')}</p>
```

Replace ONLY that part with:

```js
<h3><button type="button" class="item-stock-button" data-stock-id="${esc(p.ID)}" aria-label="Add or remove inventory for ${esc(p.Name)}">${esc(p.Name)}</button></h3><p class="muted">${esc(p.PartNumber||'No part number')}</p>
```

This restores the explicit clickable name in the renderer that actually produces the cards. Keep the previous name-button observer/click handler and its CSS; the observer skips buttons already upgraded. Preserve the remainder of the category/price layout.

## 4. script.js: update fallback search/display too

In core render(), find:

```js
[p.Name,p.SKU,p.Notes].join(' ')
```

Replace with:

```js
[p.Name,p.PartNumber,p.SKU,p.Notes].join(' ')
```

In the core product-card template, find:

```js
${esc(p.SKU || 'No SKU')}
```

Replace with:

```js
${esc(p.PartNumber || 'No part number')}
```

Keep the clickable name markup already installed. Do not rename SKU variables globally or replace the SKU input/duplicate checks: barcode matching still uses SKU.

## 5. Stock-delta frontend: show Part Number instead of SKU

In your current stock-delta frontend file (keep whatever filename index.html already loads), in selectProduct(), replace:

```js
'<br>SKU: '+esc(product.SKU)+
```

with:

```js
'<br>Part number: '+esc(product.PartNumber || 'Not set')+
```

If your formatting has spaces around +, replace the equivalent expression rather than the whole function. Leave stocklineUseExistingScannedSKU, typed-SKU matching, item-name clicks, observer, IDs and signed-delta submission unchanged.

## 6. Add the frontend field add-on

Upload part-numbers.js and part-numbers.css alongside the existing frontend files.

In index.html, after the other stylesheet links:

```html
<link rel="stylesheet" href="part-numbers.css">
```

After ALL current app/add-on scripts:

```html
<script src="part-numbers.js" defer></script>
```

Use classic deferred scripts, not async or type="module". Do not duplicate any existing script tags. Preserve your exact current filenames, including price.js versus prices.js and script-delta.js versus stock-delta.js. The new script must be last so it wraps the current Add/Edit editor after prices/barcode/OCR.

The add-on inserts Part Number after Product name. The existing FormData submission includes the named PartNumber field without changing the queue. On Add Item, it hides only the SKU text input and relabels the section Barcode (optional); existing Scan/Text buttons still work and feed the same SKU input. SKU is visible and editable on Edit Product. If the barcode add-on is not installed, there will be no Scan button; enter the optional SKU later in Edit.

SKU remains stored and searchable; it is not a secret. Hiding its UI does not remove it from public inventory API/CSV. Both PartNumber and SKU remain publicly readable under your current deployment. New Part Number data may not appear in the CSV if the published range excludes N; expand that range if needed. Live API reads include the new field after deployment.

Typing a Part Number does NOT automatically open the existing-SKU dialog; SKU and Part Number are separate identifiers. Name clicks still open exact item IDs. Search finds Part Number or SKU; barcode scans still match SKU. Multiple items may share a Part Number. A blank Part Number displays No part number; it does not fall back to displaying SKU.

## 7. Publish and test before resuming normal saves

Deploy backend first, publish all frontend changes together, and hard-refresh each device before resuming saves. Do not merely hide a field and assume it saved. Verify:

1. Add item with Part Number 00123-A. Save and refresh: leading zeros/dash remain.
2. Edit: Part Number and SKU are separate fields; changing Part Number does not change SKU.
3. Search exact/partial Part Number; existing name/SKU/notes/category searches still work.
4. Cards show Part Number, not SKU. Click name: stock dialog shows the same Part Number.
5. Add/remove stock, transfer, actual-count adjustment, price/category edits and refresh all preserve Part Number.
6. Add a blank Part Number: allowed; card shows No part number.
7. Existing-SKU barcode flow remains working. On Add, SKU value is hidden but Scan/Text controls are available. On Edit, SKU is visible.
8. Try a part number beginning with = and confirm it is stored as literal text through the backend's stringValue path, not a formula.
9. Check Inventory N header is PartNumber and the live getInventory response includes it.

At packaging, syntax checks and helper/migration mock tests were run. These do NOT establish that your complete UI, real Apps Script deployment, Google authorization, queue integration or real spreadsheet migration has been browser/integration-tested. Backups and real-device verification remain required.

## Rollback

Before any new saves, restore backed-up code/frontends as needed. Older header-driven code uses A:M and normally ignores N, but removing the new field from a client hides it rather than deleting its values. Do not delete N if it contains entered part numbers. Keep a backup. A full spreadsheet restore also restores counts/history to the backup time, so never restore it blindly after new stock transactions.
