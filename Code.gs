/** Stockline backend. Enable the advanced Google Sheets service before setup().
 * Script Properties: SPREADSHEET_ID, ENABLE_PUBLIC_WRITES, ALLOWED_ORIGINS.
 * Public deployment is NOT authentication; see README security section.
 */
const INV_HEADERS = ['ID','Name','SKU','HomeQty','TruckQty','ReorderLevel','Notes','Active','CreatedAt','UpdatedAt'];
const TX_HEADERS = ['TransactionID','Timestamp','ProductID','ProductName','Action','Quantity','FromLocation','ToLocation','PreviousQty','NewQty','Notes'];
const MAX_QTY = 1000000000;

function setup() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SPREADSHEET_ID');
  if (!id) {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (!active) throw new Error('Set the SPREADSHEET_ID Script Property first.');
    id = active.getId(); props.setProperty('SPREADSHEET_ID', id);
  }
  const book = SpreadsheetApp.openById(id);
  [['Inventory',INV_HEADERS],['Transactions',TX_HEADERS],['Settings',['Key','Value']]].forEach(function(pair) {
    const sheet = book.getSheetByName(pair[0]) || book.insertSheet(pair[0]);
    if (sheet.getLastRow() === 0) sheet.getRange(1,1,1,pair[1].length).setValues([pair[1]]);
    assertHeaders_(sheet, pair[1]); sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,pair[1].length).setFontWeight('bold').setBackground('#e9f0ff');
  });
  const settings = book.getSheetByName('Settings');
  if (settings.getLastRow() === 1) settings.getRange(2,1,3,2).setValues([
    ['ApplicationName','Stockline'],['DefaultReorderLevel',0],['SpreadsheetID',id]
  ]);
  if (!props.getProperty('ENABLE_PUBLIC_WRITES')) props.setProperty('ENABLE_PUBLIC_WRITES','false');
  SpreadsheetApp.flush();
  // Confirm Advanced Sheets service is enabled and authorized now, not on first save.
  Sheets.Spreadsheets.get(id, {fields:'spreadsheetId'});
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  let response;
  try {
    if (params.action === 'getInventory') response = {ok:true,data:readInventory_()};
    else if (params.action === 'getTransactions') response = {ok:true,data:readTransactions_(params)};
    else throw new Error('Unknown read action. Use getInventory or getTransactions.');
  } catch (err) {response = {ok:false,error:publicError_(err)};}
  if (params.callback) {
    if (!/^stockline_[a-f0-9]{32}$/.test(params.callback)) return json_({ok:false,error:'Invalid callback.'});
    return ContentService.createTextOutput(params.callback + '(' + safeJSON_(response) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(response);
}

function doPost(e) {
  let payload = {}, response;
  try {
    const raw = e && e.parameter && e.parameter.payload ? e.parameter.payload : e && e.postData && e.postData.contents;
    if (!raw || raw.length > 30000) throw new Error('Missing or oversized request body.');
    payload = JSON.parse(raw);
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error('Invalid request object.');
    if (payload.transport === 'iframe') validateOrigin_(payload.clientOrigin);
    if (PropertiesService.getScriptProperties().getProperty('ENABLE_PUBLIC_WRITES') !== 'true') throw new Error('Writing is disabled. Review README security guidance and enable writes in Script Properties.');
    response = {ok:true,data:mutate_(payload)};
  } catch (err) {response = {ok:false,error:publicError_(err)};}
  if (payload.transport === 'iframe') {
    // Invalid origins get no executable bridge response.
    try {validateOrigin_(payload.clientOrigin);} catch (err) {return json_({ok:false,error:'Origin not permitted.'});}
    const envelope = Object.assign({channel:'stockline',requestId:payload.requestId},response);
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
      'window.top.postMessage(' + safeJSON_(envelope) + ',' + safeJSON_(payload.clientOrigin) + ');' +
      '</script></body></html>';
    return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return json_(response);
}

function validateOrigin_(origin) {
  if (typeof origin !== 'string' || !/^https?:\/\/[^/]+$/.test(origin)) throw new Error('Invalid website origin.');
  const allowed = (PropertiesService.getScriptProperties().getProperty('ALLOWED_ORIGINS') || '').split(',').map(function(s){return s.trim();}).filter(String);
  if (allowed.indexOf(origin) === -1) throw new Error('Website origin is not listed in ALLOWED_ORIGINS.');
}
function json_(data) {return ContentService.createTextOutput(safeJSON_(data)).setMimeType(ContentService.MimeType.JSON);}
function safeJSON_(value) {return JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');}
function publicError_(err) {
  // Application validation errors are plain Error; Google service details stay in logs.
  console.error(err && err.stack ? err.stack : String(err));
  return err && err.name === 'Error' ? err.message : 'Spreadsheet service failed. Check setup, permissions, quotas, and Apps Script execution logs.';
}
function book_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Backend is not configured. Run setup first.');
  return SpreadsheetApp.openById(id);
}
function assertHeaders_(sheet, headers) {
  if (!sheet) throw new Error('Missing required sheet. Run setup.');
  const actual = sheet.getRange(1,1,1,headers.length).getValues()[0];
  if (headers.some(function(h,i){return actual[i] !== h;})) throw new Error('Incorrect column headers in ' + sheet.getName() + '. Restore the documented schema.');
}
function rows_(sheet, headers) {
  assertHeaders_(sheet,headers);
  if (sheet.getLastRow()<2) return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues().map(function(row,i){
    const obj = {_row:i+2};
    headers.forEach(function(key,j){obj[key] = row[j] instanceof Date ? row[j].toISOString() : row[j];}); return obj;
  }).filter(function(p){return !!p[headers[0]];});
}
function isActive_(value) {return value === true || String(value).toLowerCase() === 'true';}
function normalized_(p) {
  const out = {};
  INV_HEADERS.forEach(function(k){out[k]=p[k];});
  ['HomeQty','TruckQty','ReorderLevel'].forEach(function(k){out[k]=qty_(p[k] === '' ? 0 : p[k],k);});
  out.Active = isActive_(p.Active); return out;
}
function locked_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Inventory is busy. Wait a moment and refresh before retrying.');
  try {return fn();} finally {lock.releaseLock();}
}
function readInventory_() {
  return locked_(function(){
    const book=book_();
    return {items:rows_(book.getSheetByName('Inventory'),INV_HEADERS).map(normalized_).filter(function(p){return p.Active;}),serverTime:new Date().toISOString()};
  });
}
function readTransactions_(params) {
  return locked_(function(){
    const offset = qty_(params.offset || 0,'offset');
    const limit = Math.min(qty_(params.limit || 100,'limit'),200);
    if (limit<1) throw new Error('Limit must be positive.');
    const book=book_(), sheet=book.getSheetByName('Transactions'); assertHeaders_(sheet,TX_HEADERS);
    // With no product filter only the requested page is loaded from the spreadsheet.
    const count=Math.max(0,sheet.getLastRow()-1);
    if (params.productId || params.search) {
      const q=String(params.search || '').toLowerCase();
      const all=rows_(sheet,TX_HEADERS).reverse().filter(function(t){
        return (!params.productId || t.ProductID===params.productId) && (!q || (t.ProductName+' '+t.ProductID).toLowerCase().indexOf(q)!==-1);
      });
      return {transactions:all.slice(offset,offset+limit).map(cleanTx_),nextOffset:offset+Math.min(limit,Math.max(0,all.length-offset)),hasMore:offset+limit<all.length};
    }
    const remaining=Math.max(0,count-offset), take=Math.min(remaining,limit);
    const data=take ? sheet.getRange(count-offset-take+2,1,take,TX_HEADERS.length).getValues().reverse().map(function(row){
      const t={}; TX_HEADERS.forEach(function(k,i){t[k]=row[i] instanceof Date ? row[i].toISOString() : row[i];}); return t;
    }) : [];
    return {transactions:data,nextOffset:offset+take,hasMore:offset+take<count};
  });
}
function cleanTx_(t) {const out={}; TX_HEADERS.forEach(function(k){out[k]=t[k];});return out;}
function text_(value,label,max,required) {
  if (value === undefined || value === null) value='';
  if (typeof value !== 'string') throw new Error(label+' must be text.');
  value=value.trim();
  if (required && !value) throw new Error(label+' is required.');
  if (value.length>max) throw new Error(label+' is too long (maximum '+max+' characters).');
  return value;
}
function qty_(value,label) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) throw new Error(label+' must be a nonnegative whole number.');
  const n=Number(value);
  if (!Number.isSafeInteger(n) || n<0 || n>MAX_QTY) throw new Error(label+' must be a whole number from 0 to '+MAX_QTY+'.');
  return n;
}
function location_(value) {if (value!=='Home' && value!=='Truck') throw new Error('Choose Home or Truck.');return value==='Home'?'HomeQty':'TruckQty';}
function snapshot_(p) {return JSON.stringify({Home:p.HomeQty,Truck:p.TruckQty});}
function details_(p) {return JSON.stringify({Name:p.Name,SKU:p.SKU,Notes:p.Notes,ReorderLevel:p.ReorderLevel});}
function cells_(values) {
  // Explicit stringValue prevents formula injection from product names and notes.
  return {values:values.map(function(v){return {userEnteredValue:typeof v==='number'?{numberValue:v}:typeof v==='boolean'?{boolValue:v}:{stringValue:String(v == null ? '' : v)}};})};
}
function mutate_(data) {
  const actions=['addItem','editItem','transfer','adjust','archiveItem'];
  if (actions.indexOf(data.action)===-1) throw new Error('Unknown write action.');
  if (!/^[a-f0-9-]{36}$/i.test(data.requestId || '')) throw new Error('A UUID requestId is required.');
  return locked_(function(){
    const book=book_(), inv=book.getSheetByName('Inventory'), tx=book.getSheetByName('Transactions');
    assertHeaders_(inv,INV_HEADERS);assertHeaders_(tx,TX_HEADERS);
    // Request IDs are durable transaction IDs: retrying one request never applies it twice.
    if (tx.getLastRow()>1) {
      const duplicate=tx.getRange(2,1,tx.getLastRow()-1,1).createTextFinder(data.requestId).matchEntireCell(true).findNext();
      if (duplicate) return {duplicate:true,transactionId:data.requestId};
    }
    const products=rows_(inv,INV_HEADERS);
    let p, row, before='', after='', quantity=0, from='', to='', note='';
    if (data.action==='addItem') {
      const now=new Date().toISOString();
      p={ID:Utilities.getUuid(),Name:text_(data.Name,'Product name',160,true),SKU:text_(data.SKU,'SKU',80,false),
        HomeQty:qty_(data.HomeQty,'Home quantity'),TruckQty:qty_(data.TruckQty,'Truck quantity'),
        ReorderLevel:qty_(data.ReorderLevel === undefined ? 0 : data.ReorderLevel,'Reorder level'),Notes:text_(data.Notes,'Notes',2000,false),Active:true,CreatedAt:now,UpdatedAt:now};
      row=inv.getLastRow()+1;before=JSON.stringify({Home:0,Truck:0}); after=snapshot_(p);quantity=p.HomeQty+p.TruckQty;note=p.Notes;
    } else {
      const raw=products.find(function(item){return item.ID===data.id;});
      if (!raw) throw new Error('Product ID does not exist. Refresh inventory.');
      if (!isActive_(raw.Active)) throw new Error('This product has been archived. Refresh inventory.');
      p=normalized_(raw);row=raw._row;
      if (!data.expectedUpdatedAt || String(data.expectedUpdatedAt)!==String(p.UpdatedAt)) throw new Error('This item changed since you opened it. Close this dialog, refresh, and try again.');
      before=snapshot_(p);note=text_(data.note,'Note',2000,false);
      if (data.action==='transfer') {
        const source=location_(data.from),target=location_(data.to);
        if (source===target) throw new Error('Source and destination must differ.');
        quantity=qty_(data.quantity,'Transfer quantity');if(quantity<1)throw new Error('Transfer quantity must be positive.');
        if(quantity>p[source])throw new Error('Not enough units at the source location.');
        qty_(p[target]+quantity,'Destination quantity');
        p[source]-=quantity;p[target]+=quantity;from=data.from;to=data.to;
      } else if (data.action==='adjust') {
        const key=location_(data.location),actual=qty_(data.quantity,'Actual quantity');
        quantity=actual-p[key]; // signed delta, including zero for an unchanged count
        if(quantity<0)from=data.location;else to=data.location;
        p[key]=actual;
      } else if (data.action==='editItem') {
        before=details_(p);
        p.Name=text_(data.Name,'Product name',160,true);p.SKU=text_(data.SKU,'SKU',80,false);
        p.Notes=text_(data.Notes,'Notes',2000,false);p.ReorderLevel=qty_(data.ReorderLevel,'Reorder level');
        after=details_(p);note='Product details updated.';
      } else {p.Active=false;before=JSON.stringify({Home:p.HomeQty,Truck:p.TruckQty,Active:true});after=JSON.stringify({Home:p.HomeQty,Truck:p.TruckQty,Active:false});note='Archived; counts preserved but excluded from active inventory.';}
      p.UpdatedAt=new Date(Math.max(Date.now(),Date.parse(p.UpdatedAt)+1 || 0)).toISOString();
      if(!after)after=snapshot_(p);
    }
    // SKUs are case-insensitive and remain reserved for archived products as well.
    if (p.SKU && products.some(function(item){return item.ID!==p.ID && String(item.SKU).trim().toLowerCase()===p.SKU.toLowerCase();})) throw new Error('That SKU already exists (possibly on an archived product).');
    const transaction=[data.requestId,new Date().toISOString(),p.ID,p.Name,data.action,quantity,from,to,before,after,note];
    const requests=[];
    if(row>inv.getMaxRows())requests.push({appendDimension:{sheetId:inv.getSheetId(),dimension:'ROWS',length:row-inv.getMaxRows()}});
    requests.push({updateCells:{range:{sheetId:inv.getSheetId(),startRowIndex:row-1,endRowIndex:row,startColumnIndex:0,endColumnIndex:10},rows:[cells_(INV_HEADERS.map(function(k){return p[k];}))],fields:'userEnteredValue'}});
    requests.push({appendCells:{sheetId:tx.getSheetId(),rows:[cells_(transaction)],fields:'userEnteredValue'}});
    // One atomic Sheets API request commits BOTH stock columns AND transaction history.
    Sheets.Spreadsheets.batchUpdate({requests:requests},book.getId());
    return {item:p,transactionId:data.requestId};
  });
}
