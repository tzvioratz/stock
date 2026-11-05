// Run with node category-tests.cjs. Mocked Google/DOM tests, not live deployment tests.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto');
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name);}
const oldHeaders=['ID','Name','SKU','HomeQty','TruckQty','ReorderLevel','Notes','Active','CreatedAt','UpdatedAt'];
const txHeaders=['TransactionID','Timestamp','ProductID','ProductName','Action','Quantity','FromLocation','ToLocation','PreviousQty','NewQty','Notes'];
class Sheet{
 constructor(name,data,id){this.name=name;this.data=data;this.id=id;this.cols=26;}
 getName(){return this.name;} getLastRow(){return this.data.length;} getSheetId(){return this.id;}getMaxRows(){return 1000;}getMaxColumns(){return this.cols;}
 insertColumnsAfter(start,n){this.cols+=n;}setFrozenRows(){}
 getRange(row,col,n=1,m=1){const self=this;return {
  getValues(){return Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>self.data[row-1+i]?.[col-1+j]??''));},
  setValues(values){values.forEach((r,i)=>r.forEach((v,j)=>{self.data[row-1+i]??=[];self.data[row-1+i][col-1+j]=v;}));return this;},
  setValue(value){return this.setValues([[value]]);},setFontWeight(){return this;},setBackground(){return this;},
  createTextFinder(text){return {matchEntireCell(){return this;},findNext(){return self.data.slice(row-1,row-1+n).some(r=>String(r[col-1])===text)?{}:null;}};}
 };}
}
const initial=['product-1','Gloves','G-1',15,4,2,'Old notes',true,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'];
const inv=new Sheet('Inventory',[[...oldHeaders],[...initial]],1);
const tx=new Sheet('Transactions',[[...txHeaders],['existing-tx','2026-01-01','product-1','Gloves','addItem',19,'','','{}','{}','existing history']],2);
const settings=new Sheet('Settings',[['Key','Value'],['ApplicationName','Stockline']],3);
const sheets={Inventory:inv,Transactions:tx,Settings:settings};
const props={SPREADSHEET_ID:'private-id',ENABLE_PUBLIC_WRITES:'true',ALLOWED_ORIGINS:'https://example.com'};
const book={getId:()=>props.SPREADSHEET_ID,getSheetByName:n=>sheets[n],insertSheet:n=>sheets[n]=new Sheet(n,[],4)};
let lockHeld=false,failBatch=false;
const c={console:{log(){},error(){}},Date,JSON,Math,Number,String,Object,Array,Error,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],setProperty:(k,v)=>props[k]=v})},
 SpreadsheetApp:{openById:()=>book,flush(){}},Utilities:{getUuid:()=>crypto.randomUUID()},
 LockService:{getScriptLock:()=>({tryLock(){assert.equal(lockHeld,false);lockHeld=true;return true;},releaseLock(){lockHeld=false;}})},
 Sheets:{Spreadsheets:{get:()=>({spreadsheetId:'private-id'}),batchUpdate(batch){
  assert(lockHeld);if(failBatch)throw Error('batch failed');
  function values(row){return row.values.map(cell=>{const v=cell.userEnteredValue;return v.stringValue??v.numberValue??v.boolValue;});}
  const update=batch.requests.find(r=>r.updateCells).updateCells;
  assert.equal(update.range.endColumnIndex,11);assert.equal(update.rows[0].values.length,11);
  inv.data[update.range.startRowIndex]=values(update.rows[0]);
  tx.data.push(values(batch.requests.find(r=>r.appendCells).appendCells.rows[0]));
 }}}
};
vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/Code.gs','utf8'),c);
const mutate=p=>c.mutate_({requestId:crypto.randomUUID(),...p});
let item;
test('Migration appends Category and preserves original inventory fields/history',()=>{
 const history=JSON.stringify(tx.data);c.setup();assert.equal(inv.data[0][10],'Category');assert.equal(inv.data[1][10],'General');
 assert.deepEqual(inv.data[1].slice(0,10),initial);assert.equal(JSON.stringify(tx.data),history);assert.equal(props.ENABLE_PUBLIC_WRITES,'true');
});
test('Repeated setup preserves custom category and all revisions',()=>{
 inv.data[1][10]='Washing Machine';const previous=JSON.stringify(inv.data);c.setup();assert.equal(JSON.stringify(inv.data),previous);
});
test('Migration refuses occupied column K without modifying data',()=>{
 inv.data[0][10]='PrivateData';const previous=JSON.stringify(inv.data);assert.throws(()=>c.setup(),/already used/);assert.equal(JSON.stringify(inv.data),previous);inv.data[0][10]='Category';
});
test('Migration refuses unlabelled column K data',()=>{
 inv.data[0][10]='';assert.throws(()=>c.setup(),/data without/);inv.data[0][10]='Category';
});
test('Live inventory includes category',()=>assert.equal(c.readInventory_().items[0].Category,'Washing Machine'));
test('New products canonicalize built-in categories',()=>{
 item=mutate({action:'addItem',Name:'Wire',SKU:'WIRE',HomeQty:4,TruckQty:1,ReorderLevel:1,Category:' dryer '}).item;assert.equal(item.Category,'Dryer');
 assert.equal(JSON.parse(tx.data.at(-1)[9]).Category,'Dryer');
});
test('Missing category defaults to General',()=>{
 const p=mutate({action:'addItem',Name:'Tape',HomeQty:0,TruckQty:0}).item;assert.equal(p.Category,'General');
});
test('Edit category logs old and new category snapshots',()=>{
 item=mutate({action:'editItem',id:item.ID,expectedUpdatedAt:item.UpdatedAt,Name:item.Name,SKU:item.SKU,Notes:'Changed',ReorderLevel:1,Category:'Dishwasher'}).item;
 assert.equal(item.Category,'Dishwasher');assert.equal(JSON.parse(tx.data.at(-1)[8]).Category,'Dryer');assert.equal(JSON.parse(tx.data.at(-1)[9]).Category,'Dishwasher');
});
test('Transfer preserves category and total, using 11-column atomic row write',()=>{
 item=mutate({action:'transfer',id:item.ID,expectedUpdatedAt:item.UpdatedAt,from:'Home',to:'Truck',quantity:2}).item;
 assert.equal(item.Category,'Dishwasher');assert.equal(item.HomeQty,2);assert.equal(item.TruckQty,3);
});
test('Adjustment preserves category',()=>{
 item=mutate({action:'adjust',id:item.ID,expectedUpdatedAt:item.UpdatedAt,location:'Truck',quantity:2}).item;assert.equal(item.Category,'Dishwasher');
});
test('Older clients editing without Category preserve the current category',()=>{
 item=mutate({action:'editItem',id:item.ID,expectedUpdatedAt:item.UpdatedAt,Name:item.Name,SKU:item.SKU,Notes:'',ReorderLevel:1}).item;assert.equal(item.Category,'Dishwasher');
});
test('Custom categories are allowed and matched case-insensitively',()=>{
 const first=mutate({action:'addItem',Name:'Custom One',HomeQty:0,TruckQty:0,Category:'Water Heater'}).item;
 const second=mutate({action:'addItem',Name:'Custom Two',HomeQty:0,TruckQty:0,Category:'water heater'}).item;
 assert.equal(first.Category,'Water Heater');assert.equal(second.Category,'Water Heater');
});
test('Category length and type are validated',()=>{
 assert.throws(()=>mutate({action:'addItem',Name:'Bad',HomeQty:0,TruckQty:0,Category:'x'.repeat(81)}),/too long/);
 assert.throws(()=>mutate({action:'addItem',Name:'Bad',HomeQty:0,TruckQty:0,Category:123}),/must be text/);
});
test('Duplicate SKU, overselling and stale revisions still reject',()=>{
 assert.throws(()=>mutate({action:'addItem',Name:'Bad',HomeQty:0,TruckQty:0,SKU:'wire'}),/SKU already/);
 assert.throws(()=>mutate({action:'transfer',id:item.ID,expectedUpdatedAt:item.UpdatedAt,from:'Home',to:'Truck',quantity:99}),/Not enough/);
 assert.throws(()=>mutate({action:'archiveItem',id:item.ID,expectedUpdatedAt:'stale'}),/changed since/);
});
test('Same request ID is not applied twice',()=>{
 const p={requestId:crypto.randomUUID(),action:'adjust',id:item.ID,expectedUpdatedAt:item.UpdatedAt,location:'Home',quantity:3};
 item=c.mutate_(p).item;const count=tx.data.length;assert.equal(c.mutate_(p).duplicate,true);assert.equal(tx.data.length,count);
});
test('Batch failure leaves both tables unchanged',()=>{
 const previous=JSON.stringify([inv.data,tx.data]);failBatch=true;
 assert.throws(()=>mutate({action:'adjust',id:item.ID,expectedUpdatedAt:item.UpdatedAt,location:'Home',quantity:0}),/batch failed/);
 failBatch=false;assert.equal(JSON.stringify([inv.data,tx.data]),previous);assert.equal(lockHeld,false);
});
test('Category strings are literal cells and script JSON is safe',()=>{
 assert.equal(c.cells_(['=1+1']).values[0].userEnteredValue.stringValue,'=1+1');
 const encoded=c.safeJSON_({Category:'</script>'});assert(!encoded.includes('<'));assert.equal(JSON.parse(encoded).Category,'</script>');
});
// Execute actual frontend renderer against a minimal DOM double.
const nodes=new Map();function el(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',open:false,parentElement:{},querySelector:()=>({parentElement:{}}),insertBefore(){},append(){},onchange:null,oninput:null});return nodes.get(id);}
el('filter').value='all';el('inventorySort').value='nameAsc';
const sample=[
 {ID:'1',Name:'Z Wire',SKU:'Z',Notes:'',HomeQty:5,TruckQty:0,ReorderLevel:1,Category:'Dryer'},
 {ID:'2',Name:'B Hose',SKU:'B',Notes:'',HomeQty:0,TruckQty:0,ReorderLevel:1,Category:'Washing Machine'},
 {ID:'3',Name:'A Belt',SKU:'A',Notes:'',HomeQty:1,TruckQty:0,ReorderLevel:2,Category:'Dryer'},
 {ID:'4',Name:'C Tape',SKU:'C',Notes:'',HomeQty:2,TruckQty:0,ReorderLevel:0,Category:'General'}
];
const f={console,$:el,state:{items:sample,live:true,busy:false},fmt:n=>String(n),esc:v=>String(v??'').replace(/[<>&"]/g,'_'),
 status:p=>p.HomeQty+p.TruckQty===0?['out','Out of stock']:p.HomeQty+p.TruckQty<=p.ReorderLevel?['low','Low stock']:['good','In stock'],render(){},
 openEditor(action){el('editor').open=true;},
 document:{createElement:()=>({innerHTML:'',querySelector:()=>({addEventListener(){}})})}
};
el('inventoryView').querySelector=()=>({insertBefore(){},append(){}});
vm.createContext(f);vm.runInContext(fs.readFileSync(__dirname+'/categories.js','utf8'),f);
const names=()=>[...el('products').innerHTML.matchAll(/<h3>(.*?)<\/h3>/g)].map(m=>m[1]);
test('Name sorts A–Z and Z–A',()=>{
 assert.deepEqual(names(),['A Belt','B Hose','C Tape','Z Wire']);el('inventorySort').value='nameDesc';f.render();assert.deepEqual(names(),['Z Wire','C Tape','B Hose','A Belt']);
});
test('Stock sorts out-low-in and reverse with name tie-breaks',()=>{
 el('inventorySort').value='stockUrgent';f.render();assert.deepEqual(names(),['B Hose','A Belt','C Tape','Z Wire']);
 el('inventorySort').value='stockHealthy';f.render();assert.deepEqual(names(),['C Tape','Z Wire','A Belt','B Hose']);
});
test('Category sort groups products and sorts names within group',()=>{
 el('inventorySort').value='category';f.render();assert.deepEqual(names(),['A Belt','Z Wire','C Tape','B Hose']);
});
test('Category, search and stock filters combine while totals remain global',()=>{
 el('categoryFilter').value='Dryer';el('filter').value='low';el('search').value='belt';f.render();assert.deepEqual(names(),['A Belt']);
 assert.equal(el('total').textContent,'8');assert.equal(el('count').textContent,'(1)');
});
test('Search also matches category text',()=>{
 el('categoryFilter').value='';el('filter').value='all';el('search').value='washing';f.render();assert.deepEqual(names(),['B Hose']);
});
test('Editor adds a named Category field and suggestions',()=>{
 let inserted;el('fields').insertBefore=label=>inserted=label;
 f.openEditor('editItem','1');assert(inserted.innerHTML.includes('name="Category"'));assert(inserted.innerHTML.includes('value="Dryer"'));assert(inserted.innerHTML.includes('Washing Machine'));
});
console.log(`\n${passed} category/migration/regression tests passed. Live deployment still requires testing.`);
