const test=require('node:test');const assert=require('node:assert/strict');
const F=require('../fm.js');
test('本期限改也需和CSV比對，不只核對累計',()=>{
 const s=F.create('11510');s.template=new Uint8Array([1]);s.previous={'大安中隊':{AA:33},'信義中隊':{AA:31},'南港中隊':{AA:3}};
 s.csv={counts:{'大安中隊':2,'信義中隊':5,'南港中隊':1},blocked:false};
 s.reports['南港中隊']={values:{T:0,AA:3},sourcePeriod:'11510'};
 const r=F.review(s);
 assert.ok(r.differences.some(x=>x.unit==='南港中隊'&&x.field==='T'&&x.reported===0&&x.computed===1),'南港當期0與明細1不可以靜默略過');
});
