/** Add as a NEW Apps Script file named StockDelta.gs.
 * Uses helpers from the category-aware Code.gs. Wire doPost as in INSTALL.md.
 * No schema changes. Do not replace the existing Code.gs with this file.
 */
function signedStockDelta_(value,label){
  if(typeof value!=='number'&&!(typeof value==='string'&&/^[+-]?\d+$/.test(value.trim())))throw Error(label+' must be a whole number. Use a minus sign to remove stock.');
  const n=Number(value);
  if(!Number.isSafeInteger(n)||Math.abs(n)>MAX_QTY)throw Error(label+' must be a whole number between -'+MAX_QTY+' and '+MAX_QTY+'.');
  return n;
}
function mutateStockDelta_(data){
  if(data.action!=='adjustBy')throw Error('Unknown stock-change action.');
  if(!/^[a-f0-9-]{36}$/i.test(data.requestId||''))throw Error('A UUID requestId is required.');
  const home=signedStockDelta_(data.HomeDelta,'Home change');
  const truck=signedStockDelta_(data.TruckDelta,'Truck change');
  if(home===0&&truck===0)throw Error('Enter a change for at least one location.');
  const note=text_(data.note,'Note',2000,false);
  return locked_(function(){
    const book=book_(),inv=book.getSheetByName('Inventory'),tx=book.getSheetByName('Transactions');
    assertHeaders_(inv,INV_HEADERS);assertHeaders_(tx,TX_HEADERS);
    if(tx.getLastRow()>1&&tx.getRange(2,1,tx.getLastRow()-1,1).createTextFinder(data.requestId).matchEntireCell(true).findNext())return {duplicate:true,transactionId:data.requestId};
    const raw=rows_(inv,INV_HEADERS).find(function(p){return p.ID===data.id;});
    if(!raw)throw Error('Product ID does not exist. Refresh inventory.');
    if(!isActive_(raw.Active))throw Error('This product is archived. It cannot receive stock changes.');
    const p=normalized_(raw);
    if(!data.expectedUpdatedAt||String(data.expectedUpdatedAt)!==String(p.UpdatedAt))throw Error('This item changed since you opened it. Refresh and re-enter the stock changes.');
    const previous=snapshot_(p);
    const newHome=p.HomeQty+home,newTruck=p.TruckQty+truck;
    if(newHome<0)throw Error('Cannot remove '+Math.abs(home)+' from Home: only '+p.HomeQty+' available.');
    if(newTruck<0)throw Error('Cannot remove '+Math.abs(truck)+' from Truck: only '+p.TruckQty+' available.');
    p.HomeQty=qty_(newHome,'Resulting Home quantity');p.TruckQty=qty_(newTruck,'Resulting Truck quantity');
    p.UpdatedAt=new Date(Math.max(Date.now(),Date.parse(p.UpdatedAt)+1||0)).toISOString();
    const from=[],to=[];
    if(home<0)from.push('Home');else if(home>0)to.push('Home');
    if(truck<0)from.push('Truck');else if(truck>0)to.push('Truck');
    const sign=function(n){return n>0?'+'+n:String(n);};
    const summary='Stock change — Home '+sign(home)+', Truck '+sign(truck)+'.';
    const transaction=[data.requestId,new Date().toISOString(),p.ID,p.Name,'adjustBy',home+truck,from.join(', '),to.join(', '),previous,snapshot_(p),summary+(note?' '+note:'')];
    // Both counts and their single audit record commit in the SAME atomic batch.
    Sheets.Spreadsheets.batchUpdate({requests:[
      {updateCells:{range:{sheetId:inv.getSheetId(),startRowIndex:raw._row-1,endRowIndex:raw._row,startColumnIndex:0,endColumnIndex:INV_HEADERS.length},rows:[cells_(INV_HEADERS.map(function(k){return p[k];}))],fields:'userEnteredValue'}},
      {appendCells:{sheetId:tx.getSheetId(),rows:[cells_(transaction)],fields:'userEnteredValue'}}
    ]},book.getId());
    return {item:p,transactionId:data.requestId};
  });
}
