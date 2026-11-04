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
test('第15條帶入數字含甲類分法時不擋（11/4 使用者：15條不變，沿用9月）',()=>{
 const fixed={need:{D:26,E:47,F:13},done:{D:26,E:47,F:13},cls:{D:[4,22],E:[15,32],F:[5,8]}};
 const r=C.build({ym:'11510',articles:{a15:{fixed}},drillRows:[]});
 assert.equal(r.cells.D18,4);assert.equal(r.cells.E19,32);assert.equal(r.cells.F18,5);
 assert.ok(!r.blockers.some(b=>b.includes('場所用途')));
});
