const test=require('node:test'),assert=require('node:assert/strict');const M=require('../ordinance-core.js');
test('a6 counts unique source places and retains duplicate conflicting date evidence',()=>{
 const r=[['序號','場所編號','場所名稱','場所地址','中隊','用途','第6條'],[1,'x','虛構甲','','信義','','2026-01-01'],[2,'x','虛構甲','','信義','','2026-02-01'],[3,'','虛構乙','','信義','','2026-03-01'],[4,'','虛構乙','','信義','','2026-03-01']];
 const a6=M.parseA6Rows(r,{file:'fixture.xlsx',sheet:'信義'}),s=M.build({ym:'11510',a6}).summary.a6.E;
 assert.equal(s.need,2);assert.equal(s.conflicts.length,1);assert.equal(s.places[0].evidence.length,2);assert.equal(s.knownDone,1);
});
test('a6 unknown unit rows are retained as unresolved evidence, never assigned by sheet name',()=>{
 const a6=M.parseA6Rows([['序號','','場所名稱','','中隊','','第6條'],[1,'','虛構','','未知','','2026-01-01']],{sheet:'大安'}),x=M.build({ym:'11510',a6});
 assert.equal(a6.places.length,1);assert.equal(x.summary.a6.D.need,0);assert.ok(x.warnings.some(w=>w.includes('第6條')&&w.includes('未知單位')));
});
