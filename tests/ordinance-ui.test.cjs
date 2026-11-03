const test=require('node:test');const assert=require('node:assert/strict');
let UI;try{UI=require('../ordinance-ui.js')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
test('綜合月報公安介接僅呼叫既有唯讀API並拒絕部分中隊當全大隊',async()=>{
 assert.equal(typeof UI?.loadDrill,'function');
 const seen=[];const rows=[{unit:'大安中隊',list:'first_large',status:'尚未辦理'}];
 assert.deepEqual(await UI.loadDrill(async body=>{seen.push(body);return {rows,unit:null}}),rows);
 assert.deepEqual(seen,[{action:'drill_data'}]);
 await assert.rejects(()=>UI.loadDrill(async()=>({unit:'信義中隊',rows})),/全大隊|管理者/);
});
test('綜合月報提供可掛載表單與嚴格UTF8或Big5解碼',()=>{
 assert.equal(typeof UI?.mount,'function');assert.equal(typeof UI?.decodeCSV,'function');
 assert.equal(UI.decodeCSV(new TextEncoder().encode('場所編號,場所名稱\n1,測試')),'場所編號,場所名稱\n1,測試');
 assert.throws(()=>UI.decodeCSV(new Uint8Array([164])),/編碼|decode|encoded/i);
});

test('清冊與檢查紀錄放錯欄位會拒絕，不會默默算成完整來源',()=>{
 assert.equal(typeof UI.validateRows,'function');
 const common={'場所編號':'1','場所名稱':'測試','分隊名稱':'信義分隊','管理項目':'自治條例'};
 assert.throws(()=>UI.validateRows([{...common,'檢查日期':'115/10/1','安檢項目':'自治條例'}],'register'),/清冊/);
 assert.throws(()=>UI.validateRows([{...common,'列管狀況':'列管'}],'inspections'),/檢查/);
 assert.doesNotThrow(()=>UI.validateRows([{...common,'列管狀況':'列管'}],'register'));
 assert.doesNotThrow(()=>UI.validateRows([{...common,'檢查日期':'115/10/1','安檢項目':'自治條例'}],'inspections'));
});
