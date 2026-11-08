/** Add as a NEW Apps Script file. Follow Code.gs edits in INSTALL.md first. */
function money_(value,label){
  if(value===undefined||value===null||value==='')return 0;
  if(typeof value!=='number'&&typeof value!=='string')throw Error(label+' must be a price.');
  const raw=String(value).trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw))throw Error(label+' must be nonnegative with at most two decimal places (for example 12.50).');
  const n=Number(raw);
  if(!Number.isFinite(n)||n<0||n>1000000000)throw Error(label+' must be between 0 and 1,000,000,000.');
  return Math.round(n*100)/100;
}
function migratePrices(){return locked_(function(){
  const book=book_(),sheet=book.getSheetByName('Inventory');
  const baseHeaders=['ID','Name','SKU','HomeQty','TruckQty','ReorderLevel','Notes','Active','CreatedAt','UpdatedAt','Category'];
  assertHeaders_(sheet,baseHeaders);
  const count=sheet.getLastRow(),columns=sheet.getMaxColumns();
  // Inspect both columns before writing. Never overwrite unrelated data.
  [12,13].forEach(function(column,index){
    if(columns<column)return;
    const rows=sheet.getRange(1,column,count,1).getValues();
    const expected=index===0?'CostPrice':'RetailPrice';
    if(rows[0][0]!==''&&rows[0][0]!==expected)throw Error('Column '+column+' is already used. Back up and inspect it before migration.');
    if(rows[0][0]===''&&rows.slice(1).some(function(row){return row[0]!=='';}))throw Error('Column '+column+' contains unlabelled data. Inspect it before migration.');
    if(rows[0][0]===expected)rows.slice(1).forEach(function(row){if(row[0]!=='')money_(row[0],expected);});
  });
  const requests=[];
  if(columns<13)requests.push({appendDimension:{sheetId:sheet.getSheetId(),dimension:'COLUMNS',length:13-columns}});
  requests.push({updateCells:{range:{sheetId:sheet.getSheetId(),startRowIndex:0,endRowIndex:1,startColumnIndex:11,endColumnIndex:13},rows:[cells_(['CostPrice','RetailPrice'])],fields:'userEnteredValue'}});
  [12,13].forEach(function(column){
    const existing=columns>=column&&count>1?sheet.getRange(2,column,count-1,1).getValues():Array.from({length:Math.max(0,count-1)},function(){return [''];});
    existing.forEach(function(row,i){if(row[0]==='')requests.push({updateCells:{range:{sheetId:sheet.getSheetId(),startRowIndex:i+1,endRowIndex:i+2,startColumnIndex:column-1,endColumnIndex:column},rows:[cells_([0])],fields:'userEnteredValue'}});});
  });
  if(count>1)requests.push({repeatCell:{range:{sheetId:sheet.getSheetId(),startRowIndex:1,endRowIndex:count,startColumnIndex:11,endColumnIndex:13},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0.00'}}},fields:'userEnteredFormat.numberFormat'}});
  Sheets.Spreadsheets.batchUpdate({requests:requests},book.getId());
  console.log('Price migration complete. Existing inventory, categories, revisions and history preserved.');
});}
