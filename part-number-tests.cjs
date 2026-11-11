'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(__dirname+'/PartNumbers.gs','utf8');
const headers=['ID','Name','SKU','HomeQty','TruckQty','ReorderLevel','Notes','Active','CreatedAt','UpdatedAt','Category','CostPrice','RetailPrice','PartNumber'];
let tests=0;
function environment({cols=13,header='',value='',formula='',badBase=false}={}){
  const grid=[headers.slice(0,13),['id','Name','SKU',3,4,0,'',true,'created','updated','General',1.5,2.5]];
  if(badBase)grid[0][0]='Wrong';
  if(cols>=14){grid[0][13]=header;grid[1][13]=value;}
  const writes=[];
  const sheet={getMaxColumns:()=>cols,getLastRow:()=>2,getMaxRows:()=>20,
    insertColumnsAfter:(start,count)=>{writes.push('insert');cols+=count;},
    getRange:(r,c,n=1,m=1)=>({
      getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>grid[r-1+i]?.[c-1+j]??'')),
      getFormulas:()=>Array.from({length:n},(_,i)=>Array.from({length:m},()=>r+i===2&&c===14?formula:'')),
      setValue(v){writes.push('header');grid[r-1][c-1]=v;return this;},
      setNumberFormat(v){writes.push('format');return this;},
      setFontWeight(){return this;},setBackground(){return this;}
    })
  };
  const ctx={INV_HEADERS:headers,locked_:fn=>fn(),book_:()=>({getSheetByName:()=>sheet}),SpreadsheetApp:{flush(){}},
    text_:(v,label,max)=>{if(v==null)v='';if(typeof v!=='string')throw Error(label+' must be text.');v=v.trim();if(v.length>max)throw Error('too long');return v;},
    assertHeaders_:(s,h)=>{const a=s.getRange(1,1,1,h.length).getValues()[0];if(h.some((v,i)=>v!==a[i]))throw Error('headers');}
  };
  vm.createContext(ctx);vm.runInContext(source,ctx);return {ctx,grid,writes};
}
const e=environment();
for(const [v,expected] of [[' 00123-A ','00123-A'],['WP6-3037050','WP6-3037050'],['=NOT_A_FORMULA','=NOT_A_FORMULA'],[undefined,''],['','']]){
  assert.equal(e.ctx.partNumber_(v),expected);tests++;
}
for(const v of [123,'x'.repeat(81)]){assert.throws(()=>e.ctx.partNumber_(v));tests++;}
const before=JSON.stringify(e.grid[1]);e.ctx.migratePartNumbers();assert.equal(e.grid[0][13],'PartNumber');assert.equal(JSON.stringify(e.grid[1]),before);tests++;
for(const opts of [{cols:14,header:'Used'},{cols:14,value:'existing'},{cols:14,header:'PartNumber',formula:'=A1'},{cols:14,header:'PartNumber',value:123},{badBase:true}]){
  const t=environment(opts),b=JSON.stringify(t.grid);assert.throws(()=>t.ctx.migratePartNumbers());assert.equal(JSON.stringify(t.grid),b);assert.equal(t.writes.length,0);tests++;
}
const t=environment({cols:14,header:'PartNumber',value:'00123-A'});t.ctx.migratePartNumbers();t.ctx.migratePartNumbers();assert.equal(t.grid[1][13],'00123-A');assert(!t.writes.includes('header'));tests++;
console.log(`${tests} helper/migration mock cases passed. No real Google Sheets or browser integration tested.`);
