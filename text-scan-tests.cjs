// Only syntax and pure normalization tests; no camera, image or OCR-model execution.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(__dirname+'/text-scan.js','utf8');
const start=source.indexOf('function stocklineOCRText('),end=source.indexOf('\n(() =>');
const c={};vm.createContext(c);vm.runInContext(source.slice(start,end),c);
const cases=[
 ['  0012345\n','0012345'],['WP-W10212345','WP-W10212345'],
 ['O0I1B8','O0I1B8'],['ABC/123.4_A','ABC/123.4_A'],
 ['  A  B\r\nC  ','A B C'],['',''],[null,''],['x'.repeat(81),'x'.repeat(81)]
];
for(const [input,expected] of cases)assert.equal(c.stocklineOCRText(input),expected);
console.log(`${cases.length} text-normalization cases passed. Image/OCR accuracy and UI integration are NOT tested.`);
