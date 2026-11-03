const test=require('node:test'); const assert=require('node:assert/strict');
const M=require('../ordinance-core.js');
// 11/3：第15條備註甲類／甲類以外照清冊場所用途代碼（A 開頭＝甲類）；正式匯出＝沒有待補項目且每格都有數字
const reg=(id,unit,use,status='列管')=>({'場所編號':id,'場所名稱':'測試'+id,'分隊名稱':unit,'列管狀況':status,'場所用途':use});
const chk=(id,date)=>({'場所編號':id,'場所名稱':'測試'+id,'分隊名稱':'信義','檢查日期':date,'安檢項目':'自治條例'});
test('第15條甲類按用途代碼分，免列管排除後才分',()=>{
 const a15={register:[reg('1','安和','A1A'),reg('2','安和','C2'),reg('3','莊敬','a1d'),reg('4','舊莊','D3'),reg('5','舊莊','A2','免列管')],inspections:[chk('1','115/10/01')],excludeExempt:true};
 const x=M.build({ym:'11510',articles:{a15:a15}});
 assert.deepEqual(['D','E','F'].map(c=>x.cells[c+'18']),[1,1,0]);
 assert.deepEqual(['D','E','F'].map(c=>x.cells[c+'19']),[1,0,1]);
 assert.deepEqual(['D','E','F'].map(c=>x.cells[c+'16']),[2,1,1]);
 assert.ok(!x.blockers.some(s=>s.includes('甲類')));
});
test('第15條清冊缺用途代碼就擋正式匯出、備註格留空',()=>{
 const x=M.build({ym:'11510',articles:{a15:{register:[reg('1','安和','')],inspections:[],excludeExempt:true}}});
 assert.equal(x.cells.D18,null);assert.ok(x.blockers.some(s=>s.includes('用途代碼')));assert.equal(x.formal,false);
});
test('全部來源齊且確認後才可正式匯出',()=>{
 const art={register:[reg('1','安和','A1A'),reg('2','莊敬','B1'),reg('3','舊莊','A3')],inspections:[chk('1','115/10/01')],excludeExempt:true};
 const conf=(need,done)=>({confirmed:true,ym:'11510',source:'測試',need,done,datePolicy:''});
 const drillRows=[{list:'first_large',unit:'安和',status:'已執行',actual:'2026-05-01'},{list:'first_large',unit:'莊敬',status:'已執行',actual:'2026-05-01'},{list:'first_large',unit:'舊莊',status:'已執行',actual:'2026-05-01'}];
 const x=M.build({ym:'11510',articles:{a8:art,a12:art,a15:art},drillRows,a6:{places:[],confirmations:{D:conf(18,7),E:conf(24,10),F:conf(1,1)}}});
 assert.deepEqual(x.blockers,[]);assert.equal(x.formal,true);assert.equal(x.cells.E10,24);assert.equal(x.cells.E11,10);
});
