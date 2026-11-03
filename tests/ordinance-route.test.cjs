const {test}=require('node:test');const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function tabs(role){const source=app.match(/function tabsFor\(role\) \{[\s\S]*?\n\}/)[0];const ctx={project:'biz',isOpen:()=>false};vm.createContext(ctx);return vm.runInContext(source+';tabsFor('+JSON.stringify(role)+')',ctx).map(x=>x[0]);}
test('綜合月報沿既有登入權限與分頁、不替換其他月報',()=>{
 for(const role of ['admin','squadron']){assert.ok(tabs(role).includes('ordinance'));assert.ok(tabs(role).includes('fm'));assert.ok(tabs(role).includes('occ'));}
 for(const role of ['team','guest'])assert.ok(!tabs(role).includes('ordinance'));
 const open=app.match(/const OPEN = \{[^\n]+/)[0];assert.doesNotMatch(open,/ordinance/);
 assert.match(app,/h === "ordinance".*wantTab = "ordinance"/);
 assert.match(app,/else if \(tab === "ordinance"\).*renderOrdinance/);
 assert.match(html,/<script src="ordinance-core\.js/);assert.match(html,/<script src="ordinance-export\.js/);assert.match(html,/<script src="ordinance-ui\.js/);
 assert.ok(html.indexOf('src="ordinance-ui.js')<html.indexOf('src="app.js'));
});
