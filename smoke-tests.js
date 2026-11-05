// Run: node smoke-tests.js. No npm packages required.
// These tests simulate Google services; they do not replace live deployment tests.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const crypto = require('crypto');
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
class Sheet {
  constructor(name, headers, id){this.name=name;this.data=[headers];this.id=id;}
  getName(){return this.name;}
  getSheetId(){return this.id;}
  getLastRow(){return this.data.length;}
  getMaxRows(){return 10000;}
  getRange(row,col,n=1,m=1){
    const self=this;
    return {
      getValues(){return Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>self.data[row-1+i]?.[col-1+j]??''));},
      createTextFinder(text){return {matchEntireCell(){return this;},findNext(){return self.data.slice(row-1,row-1+n).some(r=>String(r[col-1])===text)?{}:null;}};}
    };
  }
}
const inv=new Sheet('Inventory',['ID','Name','SKU','HomeQty','TruckQty','ReorderLevel','Notes','Active','CreatedAt','UpdatedAt'],1);
const tx=new Sheet('Transactions',['TransactionID','Timestamp','ProductID','ProductName','Action','Quantity','FromLocation','ToLocation','PreviousQty','NewQty','Notes'],2);
const book={getId:()=> 'private-spreadsheet-id',getSheetByName:name=>name==='Inventory'?inv:tx};
let locked=false,batches=0,failBatch=false;
const context={console,Date,JSON,Math,Number,String,Array,Object,Error,
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='SPREADSHEET_ID'?'private-spreadsheet-id':key==='ENABLE_PUBLIC_WRITES'?'true':key==='ALLOWED_ORIGINS'?'https://example.com':null})},
  SpreadsheetApp:{openById:()=>book},
  Utilities:{getUuid:()=>crypto.randomUUID()},
  LockService:{getScriptLock:()=>({tryLock(){assert.equal(locked,false);locked=true;return true;},releaseLock(){locked=false;}})},
  Sheets:{Spreadsheets:{batchUpdate(resource,id){
    assert.equal(locked,true);assert.equal(id,'private-spreadsheet-id');
    assert.equal(resource.requests.length,2);
    assert(resource.requests[0].updateCells);assert(resource.requests[1].appendCells);
    if(failBatch)throw Error('Simulated batch failure');
    function values(r){return r.values.map(c=>{const v=c.userEnteredValue;return v.numberValue??v.boolValue??v.stringValue;});}
    const update=resource.requests[0].updateCells;
    inv.data[update.range.startRowIndex]=values(update.rows[0]);
    tx.data.push(values(resource.requests[1].appendCells.rows[0]));batches++;
  }}}
};
vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/Code.gs','utf8'),context);
const mutate=p=>context.mutate_({requestId:crypto.randomUUID(),...p});
const fresh=id=>context.readInventory_().items.find(p=>p.ID===id);
let item,request;
test('Add product writes inventory and history atomically',()=>{
  item=mutate({action:'addItem',Name:'Cord',SKU:'CORD-1',HomeQty:15,TruckQty:4,ReorderLevel:2,Notes:'Outdoor, 25 ft'}).item;
  assert.equal(inv.data.length,2);assert.equal(tx.data.length,2);assert.equal(item.HomeQty+item.TruckQty,19);
});
test('Transfer changes both locations and preserves total',()=>{
  request={requestId:crypto.randomUUID(),action:'transfer',id:item.ID,expectedUpdatedAt:item.UpdatedAt,from:'Home',to:'Truck',quantity:6};
  item=context.mutate_(request).item;assert.equal(item.HomeQty,9);assert.equal(item.TruckQty,10);
  assert.equal(item.HomeQty+item.TruckQty,19);assert.equal(tx.data.at(-1)[4],'transfer');
});
test('Repeated request is idempotent even with stale revision',()=>{
  const count=batches;assert.equal(context.mutate_(request).duplicate,true);assert.equal(batches,count);assert.equal(fresh(item.ID).TruckQty,10);
});
test('Overselling is rejected without a partial write',()=>{
  const count=batches;assert.throws(()=>mutate({...request,requestId:crypto.randomUUID(),expectedUpdatedAt:item.UpdatedAt,quantity:999}),/Not enough/);assert.equal(batches,count);
});
test('Same-location transfer is rejected',()=>assert.throws(()=>mutate({...request,requestId:crypto.randomUUID(),expectedUpdatedAt:item.UpdatedAt,to:'Home'}),/must differ/));
test('Zero, negative and fractional transfer quantities are rejected',()=>{
  for(const quantity of [0,-1,1.5])assert.throws(()=>mutate({...request,requestId:crypto.randomUUID(),expectedUpdatedAt:item.UpdatedAt,quantity}));
});
test('Stale revisions are rejected',()=>assert.throws(()=>mutate({...request,requestId:crypto.randomUUID()}),/changed since/));
test('Adjust sets actual count and logs signed delta',()=>{
  item=mutate({action:'adjust',id:item.ID,expectedUpdatedAt:item.UpdatedAt,location:'Truck',quantity:6,note:'Used four'}).item;
  assert.equal(item.TruckQty,6);assert.equal(tx.data.at(-1)[5],-4);
  assert.equal(JSON.parse(tx.data.at(-1)[8]).Truck,10);assert.equal(JSON.parse(tx.data.at(-1)[9]).Truck,6);
});
test('Negative actual count is rejected',()=>assert.throws(()=>mutate({action:'adjust',id:item.ID,expectedUpdatedAt:item.UpdatedAt,location:'Truck',quantity:-2}),/whole number/));
test('Case-insensitive duplicate SKU is rejected',()=>assert.throws(()=>mutate({action:'addItem',Name:'Duplicate',SKU:'cord-1',HomeQty:0,TruckQty:0}),/SKU already exists/));
test('Missing product and unknown action are rejected',()=>{
  assert.throws(()=>mutate({action:'archiveItem',id:'missing'}),/does not exist/);
  assert.throws(()=>mutate({action:'deleteEverything'}),/Unknown/);
});
test('Edit preserves inventory and records detail snapshots',()=>{
  item=mutate({action:'editItem',id:item.ID,expectedUpdatedAt:item.UpdatedAt,Name:'=HYPERLINK("bad")',SKU:'CORD-1',Notes:'Renamed',ReorderLevel:20}).item;
  assert.equal(item.HomeQty,9);assert.equal(item.TruckQty,6);assert.equal(JSON.parse(tx.data.at(-1)[9]).ReorderLevel,20);
});
test('Text cells use literal strings, never formula values',()=>{
  const c=context.cells_(['=1+1']).values[0].userEnteredValue;assert.equal(c.stringValue,'=1+1');assert.equal(c.formulaValue,undefined);
});
test('Batch failure leaves stock and history unchanged and releases lock',()=>{
  const previous=JSON.stringify([inv.data,tx.data]);failBatch=true;
  assert.throws(()=>mutate({action:'adjust',id:item.ID,expectedUpdatedAt:item.UpdatedAt,location:'Home',quantity:1}),/Simulated/);
  failBatch=false;assert.equal(JSON.stringify([inv.data,tx.data]),previous);assert.equal(locked,false);
});
test('Archive hides item and preserves history and quantities',()=>{
  mutate({action:'archiveItem',id:item.ID,expectedUpdatedAt:item.UpdatedAt});assert.equal(context.readInventory_().items.length,0);
  assert.equal(inv.data[1][3],9);assert.equal(inv.data[1][4],6);assert.equal(tx.data.at(-1)[4],'archiveItem');
});
test('Archived SKUs remain reserved',()=>assert.throws(()=>mutate({action:'addItem',Name:'Duplicate',SKU:'CORD-1',HomeQty:0,TruckQty:0}),/SKU already exists/));
test('History is newest first, paginated and searchable by ID',()=>{
  const result=context.readTransactions_({offset:0,limit:2});assert.equal(result.transactions.length,2);assert.equal(result.transactions[0].Action,'archiveItem');assert.equal(result.hasMore,true);
  assert.equal(context.readTransactions_({productId:item.ID,limit:100}).transactions.length,tx.data.length-1);
});
test('Iframe response origins are exact and allowlisted',()=>{
  context.validateOrigin_('https://example.com');assert.throws(()=>context.validateOrigin_('https://attacker.example'));
  assert.throws(()=>context.validateOrigin_('https://example.com/path'));
});
test('JSON embedded in script cannot close its script tag',()=>assert(!context.safeJSON_({name:'</script><script>alert(1)</script>'}).includes('<')));
const frontend=fs.readFileSync(__dirname+'/script.js','utf8');
const csvContext={};vm.createContext(csvContext);
vm.runInContext('const number = value => Number(value || 0);\n'+frontend.slice(frontend.indexOf('function parseCSV('),frontend.indexOf('\nasync function load()')),csvContext);
test('Sample CSV handles commas and escaped quotes',()=>{
  const rows=csvContext.parseCSV(fs.readFileSync(__dirname+'/sample-inventory.csv','utf8'));
  assert.equal(rows.length,4);assert.equal(rows[0].Notes,'25 ft, outdoor rated');assert.equal(rows[2].Notes,'Clear tape, 2" wide');assert.equal(rows[0].HomeQty,8);assert.equal(rows[0].Active,true);
});
test('CSV supports BOM, multiline text and blank numeric cells',()=>{
  const header=inv.data[0].join(',');
  const rows=csvContext.parseCSV('\uFEFF'+header+'\r\nx,"Line\nTwo",,,2,0,"a,b",TRUE,,\r\n');
  assert.equal(rows[0].Name,'Line\nTwo');assert.equal(rows[0].HomeQty,0);assert.equal(rows[0].Notes,'a,b');
});
test('Malformed CSV and negative quantities are rejected',()=>{
  assert.throws(()=>csvContext.parseCSV('wrong,headers\n1,2'),/headers/);
  assert.throws(()=>csvContext.parseCSV(inv.data[0].join(',')+'\nx,Name,,-1,0,0,,TRUE,,'),/numeric/);
  assert.throws(()=>csvContext.parseCSV('"unclosed'),/unclosed/);
});
console.log(`\n${passed} tests passed. Live Google deployment still requires acceptance testing.`);
