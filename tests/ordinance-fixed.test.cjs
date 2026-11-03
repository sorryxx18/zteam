const test=require('node:test'),assert=require('node:assert');
const C=require('../ordinance-core.js');
test('沒匯入CSV時用帶入數字，第15條甲類仍待補',()=>{
 const fixed={need:{D:1,E:2,F:3},done:{D:1,E:1,F:0}};
 const r=C.build({ym:'11510',articles:{a8:{fixed},a12:{fixed},a15:{fixed}},drillRows:[]});
 assert.equal(r.cells.E12,2);assert.equal(r.cells.F15,0);assert.equal(r.cells.D16,1);
 assert.equal(r.cells.D18,null);assert.ok(r.blockers.some(b=>b.includes('場所用途')));assert.equal(r.formal,false);
});
test('匯入完整CSV後不用帶入數字',()=>{
 const reg=[{'場所編號':'1','場所名稱':'甲','分隊名稱':'信義','列管狀況':'列管'}],ins=[{'場所編號':'1','場所名稱':'甲','安檢項目':'自治條例','檢查日期':'115/10/02','分隊名稱':'信義'}];
 const r=C.build({ym:'11510',articles:{a8:{register:reg,inspections:ins,fixed:{need:{D:9,E:9,F:9},done:{D:9,E:9,F:9}}}}});
 assert.equal(r.cells.E12,1);assert.equal(r.cells.D12,0);
});
