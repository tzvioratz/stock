/** Add to the EXISTING project. Keep Code.gs, StockDelta.gs and price helpers. */
function partNumber_(value) {
  return text_(value, 'Part number', 80, false);
}
function migratePartNumbers() {
  return locked_(function () {
    if (INV_HEADERS.length !== 14 || INV_HEADERS[13] !== 'PartNumber') {
      throw Error('Apply the documented INV_HEADERS edit before running migration.');
    }
    const inv = book_().getSheetByName('Inventory');
    assertHeaders_(inv, INV_HEADERS.slice(0, 13));
    const lastRow = Math.max(1, inv.getLastRow());
    let header = '';
    if (inv.getMaxColumns() >= 14) {
      const range = inv.getRange(1, 14, lastRow, 1);
      const values = range.getValues();
      const formulas = range.getFormulas();
      header = values[0][0];
      if (header !== '' && header !== 'PartNumber') {
        throw Error('Column N is already used. Stop and inspect it; no data has been changed.');
      }
      if (formulas.some(function (r) { return r[0] !== ''; })) {
        throw Error('Column N contains formulas. Stop and inspect it; no data has been changed.');
      }
      if (header === '' && values.slice(1).some(function (r) { return r[0] !== ''; })) {
        throw Error('Column N has data without a PartNumber header. Stop and inspect it.');
      }
      if (header === 'PartNumber') {
        values.slice(1).forEach(function (r) { partNumber_(r[0]); });
      }
    }
    if (inv.getMaxColumns() < 14) {
      inv.insertColumnsAfter(inv.getMaxColumns(), 14 - inv.getMaxColumns());
    }
    // No product rows, revisions, quantities, prices or transaction rows are rewritten.
    if (inv.getMaxRows() > 1) {
      inv.getRange(2, 14, inv.getMaxRows() - 1, 1).setNumberFormat('@');
    }
    if (header === '') {
      inv.getRange(1, 14).setValue('PartNumber');
    }
    inv.getRange(1, 14).setFontWeight('bold').setBackground('#e9f0ff');
    SpreadsheetApp.flush();
    assertHeaders_(inv, INV_HEADERS);
    return {ok: true, column: 'N', field: 'PartNumber'};
  });
}
