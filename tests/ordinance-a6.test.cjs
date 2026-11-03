const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../ordinance-core.js');
const rows=[['序號','場所編號','場所名稱','場所地址','中隊','用途','應變能力驗證(第6條)-日期'],[1,'','虛構甲','','大安中隊','','2026-10-01'],[2,'','虛構乙','','大安中隊','','面積小於300'],['合計','','尾列']];
test('a6 accepts sequence plus name even without place ID; keeps notes and provenance',()=>{
 const x=M.parseA6Rows(rows,{file:'fixture.xlsx',sheet:'大安'});
 assert.equal(x.places.length,2);assert.equal(x.places[0].source.row,2);assert.equal(x.places[1].date,'面積小於300');assert.equal(x.places[0].unit,'D');
});
