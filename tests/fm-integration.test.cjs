const {test}=require('node:test');const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
test('月報掛載守住原身分：admin/squadron可用，未登入及其他角色不可用',()=>{
 const src=app.match(/function renderFireManagement\(\) \{[\s\S]*?\n\}/)[0];
 const view={innerHTML:''};let mounted=0;const ctx=vm.createContext({me:null,$:()=>view,FireManagement:{mount:v=>{assert.equal(v,view);mounted++;}}});vm.runInContext(src,ctx);
 for(const role of [null,'guest','team','member']){ctx.me=role?{role}:null;ctx.renderFireManagement();assert.equal(mounted,0);}
 for(const role of ['admin','squadron']){ctx.me={role};ctx.renderFireManagement();}assert.equal(mounted,2);
});
