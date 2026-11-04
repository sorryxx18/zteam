const test=require('node:test'),assert=require('node:assert/strict');const M=require('../ordinance-core.js');
const drill=(planned,status='尚未辦理',actual='')=>({list:'second_weak',unit:'信義中隊',status,planned,actual});
test('公安依既有系統實際接受的民國點號、中文及月日寫法，按報表年月底判斷',()=>{
 for(const date of ['115.10.31 09：30','115年10月31日 09:30','10/31 0900','開業前115.10.31']){
  const result=M.build({ym:'11510',drillRows:[drill(date)]});
  assert.equal(result.cells.E7,1,date);assert.equal(result.cells.E9,0,date);
 }
});
test('公安日期不能把月底以後或無效日期當已執行',()=>{
 const future=M.build({ym:'11510',drillRows:[drill('11/01 0900')]});assert.equal(future.cells.E7,0);assert.equal(future.cells.E9,1);
 const bad=M.build({ym:'11502',drillRows:[drill('115.02.30')]});assert.equal(bad.cells.E7,0);assert.equal(bad.cells.E9,1);
});
test('辦理中照公安演練現況算辦理中，不留空',()=>{
 const result=M.build({ym:'11510',drillRows:[drill('','辦理中(已函文建管)')]});
 assert.equal(result.cells.E8,1);assert.equal(result.cells.E6,1);assert.ok(!result.blockers.some(x=>x.includes('第5條')));
});
