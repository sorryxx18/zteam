const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../duty-core.js');
test('管制範圍依多邊形判斷而不是外框，支援孔洞',()=>{
 const geometry={type:'Polygon',coordinates:[[[121,25],[122,25],[122,26],[121,26],[121,25]],[[121.4,25.4],[121.6,25.4],[121.6,25.6],[121.4,25.6],[121.4,25.4]]]};
 assert.equal(Core.insideArea(25.2,121.2,geometry),true);
 assert.equal(Core.insideArea(25.5,121.5,geometry),false);
 assert.equal(Core.insideArea(24,121.2,geometry),false);
});
test('關聯鏡頭按距離排列，保留可查全部鏡頭的原清單',()=>{
 const cameras=[{id:'far',lat:25.1,lng:121.56},{id:'near',lat:25.035,lng:121.565}];
 const before=JSON.stringify(cameras);
 assert.equal(Core.nearby(cameras,25.035,121.565,1)[0].id,'near');
 assert.equal(JSON.stringify(cameras),before);
});
test('正式編組只依明確車號欄，不依位置或車號字首推論',()=>{
 assert.deepEqual(Core.assignedDevices({vehicles:'信義91、信義92'}),['信義91','信義92']);
 assert.deepEqual(Core.assignedDevices({}),[]);
});
