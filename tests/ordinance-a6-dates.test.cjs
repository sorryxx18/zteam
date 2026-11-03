const test=require('node:test'),assert=require('node:assert/strict');const M=require('../ordinance-core.js');
test('a6 dates count only target YTD, ancient Excel dates require explicit ROC choice, notes never count',()=>{
 const a6={places:[['a','2026-03-15'],['b','0115-09-03'],['c','面積小於300'],['d','2026-11-20'],['e','2025-10-01']].map(([name,date],i)=>({id:String(i),name,date,unit:'D',source:{row:i+2}})),confirmations:{}};
 let x=M.build({ym:'11510',a6});assert.equal(x.summary.a6.D.knownDone,1);assert.equal(x.summary.a6.D.rocDone,2);assert.equal(x.summary.a6.D.ancient.length,1);assert.equal(x.summary.a6.D.notes.length,1);assert.equal(x.cells.D11,null);
 a6.confirmations.D={ym:'11510',need:5,done:2,source:'fixture核定',datePolicy:'roc',confirmed:true};x=M.build({ym:'11510',a6});assert.equal(x.cells.D10,5);assert.equal(x.cells.D11,2);assert.equal(x.cells.E10,null);assert.equal(x.formal,false);
 a6.confirmations.D.ym='11509';assert.equal(M.build({ym:'11510',a6}).cells.D10,null);
});
