const test = require('node:test');
const assert = require('node:assert/strict');
const Ops = require('../ops-core.js');
test('監視器全範圍去重',()=>{
 const cams=Array.from({length:15},(_,i)=>({id:String(i),name:'路口'+i,lat:25.035,lng:121.565}));
 assert.equal(Ops.cameras([...cams,cams[0],{id:'out',lat:24,lng:121.56}],[[25.028,121.555],[25.046,121.576]]).length,15);
});
test('人工勤務預設待命，與定位分離',()=>{
 assert.deepEqual(Ops.statusFor([],'信義91'),{status:'待命',updated_at:'',isDefault:true});
 assert.equal(Ops.statusFor([{device:'信義91',status:'出勤'}],'信義91').status,'出勤');
});
test('無時區舊資料明確依臺北時間解析，UTC裝置亦相同',()=>{
 const {execFileSync}=require('node:child_process');
 const p=require.resolve('../ops-core.js');
 const v=execFileSync(process.execPath,['-e',`console.log(require(${JSON.stringify(p)}).formatTime('2026-10-17 12:00'))`],{env:{...process.env,TZ:'UTC'},encoding:'utf8'});
 assert.ok(v.includes('12:00:00'),v);
 assert.ok(Ops.formatTime('2026-10-17T04:00:00Z').includes('12:00:00'));
 assert.equal(Ops.formatTime('bad'),'未提供');
});
test('正式活動看板不新增跨年測試入口',()=>{
 const fs=require('node:fs'),path=require('node:path');
 for(const n of ['activity.js','activity-data.js','index.html'])assert.ok(!fs.readFileSync(path.resolve(__dirname,'../..',n),'utf8').includes('newyear/'));
});
