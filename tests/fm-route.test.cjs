const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function tabs(role){const source=app.match(/function tabsFor\(role\) \{[\s\S]*?\n\}/)[0];const ctx={project:'biz',isOpen:()=>false};vm.createContext(ctx);return vm.runInContext(source+';tabsFor('+JSON.stringify(role)+')',ctx).map(x=>x[0]);}
test('月報分頁限原admin/squadron，guest/team不得出現',()=>{
 for(const r of ['admin','squadron'])assert.ok(tabs(r).includes('fm'),r);
 for(const r of ['guest','team'])assert.ok(!tabs(r).includes('fm'),r);
});
test('fm深連結映射biz，沿原登入閘門且不擴張OPEN',()=>{
 assert.match(app,/h === "fm".*wantTab = "fm"/);
 assert.match(app,/else if \(tab === "fm"\).*renderFireManagement/);
 const open=app.match(/const OPEN = \{[^\n]+/)[0];assert.doesNotMatch(open,/\bfm:/);
 assert.match(html,/<script src="fm\.js/);assert.match(html,/href="fm\.css/);
});
