(function(root){
'use strict';
const api={};
api.parseCSV=function(text){
 const rows=[];let row=[],field='',quoted=false; text=String(text).replace(/^\uFEFF/,'');
 for(let i=0;i<=text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n'||c===undefined)){row.push(field);field='';if(c!==','){rows.push(row);row=[];}}else if(c!=='\r'||quoted)field+=c;}
 const headers=rows.shift()||[];return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||'']))).filter(r=>r['場所編號']?.trim()&&r['場所名稱']?.trim());
};
api.parseA6Rows=function(rows,source={}){
 const h=rows.findIndex(r=>String(r[0]).trim()==='序號'&&String(r[2]).trim()==='場所名稱'&&String(r[6]).includes('第6條'));
 if(h<0)throw Error('不是第6條明細，請選擇含序號、場所名稱及第6條日期的分頁');
 const places=[];
 for(let i=h+1;i<rows.length;i++){const r=rows[i];if(!/^\d+$/.test(String(r[0]??'').trim())||!String(r[2]??'').trim())continue;
  places.push({sequence:String(r[0]),id:String(r[1]??'').trim(),name:String(r[2]).trim(),unit:unitColumn(r[4]),date:r[6]??'',source:{...source,row:i+1}});
 }
 if(!places.length)throw Error('第6條沒有有效場所列');
 return {places,source,confirmations:{}};
};
const unitColumn=u=>{u=String(u||'').replace(/分隊|中隊/g,'').trim();return ({安和:'D',金華:'D',大安:'D',信義:'E',莊敬:'E',南港:'F',舊莊:'F',成德:'F'})[u];};
function dateValue(s,reportYear){
 const text=String(s||'').trim();let m=text.match(/(?:^|[^\d])(\d{3,4})[./年-](\d{1,2})[./月-](\d{1,2})(?!\d)/),y,month,day;
 if(m){y=+m[1];if(y<1911)y+=1911;month=+m[2];day=+m[3];}
 else {m=text.match(/(?:^|[^\d])(\d{1,2})\/(\d{1,2})(?!\d)/);if(!m||!reportYear)return null;y=reportYear;month=+m[1];day=+m[2];}
 const d=new Date(Date.UTC(y,month-1,day));return d.getUTCFullYear()===y&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?d.getTime():null;
}
api.build=function({ym,articles={},drillRows=null,a6=null}){
 if(!/^\d{5}$/.test(ym)||+ym.slice(3)<1||+ym.slice(3)>12)throw new Error('年月格式錯誤');
 const y=+ym.slice(0,3)+1911, month=+ym.slice(3),end=Date.UTC(y,month,0),start=Date.UTC(y,0,1);
 const cells={},blockers=[],warnings=[],summary={};for(let r=2;r<=19;r++)for(const c of 'DEF')cells[c+r]=null;
 summary.a6={};
 if((a6?.places||[]).some(p=>!['D','E','F'].includes(p.unit)))warnings.push('第6條有未知單位，保留來源待確認，不分派至其他中隊');
 for(const c of 'DEF'){
  const groups=new Map();
  for(const p of (a6?.places||[]).filter(p=>p.unit===c)){const key=p.id?'id:'+p.id:'name:'+p.name.normalize('NFKC').replace(/\s/g,'');
   if(!groups.has(key))groups.set(key,{...p,evidence:[]});groups.get(key).evidence.push(p);
  }
  const places=[...groups.values()],s={need:places.length,knownDone:0,rocDone:0,ancient:[],notes:[],conflicts:[],places};summary.a6[c]=s;
  for(const p of places){if(new Set(p.evidence.map(e=>String(e.date))).size>1||new Set(p.evidence.map(e=>e.name)).size>1){s.conflicts.push(p);continue;}const text=String(p.date??'').trim();if(!text)continue;
   const ancient=/^0\d{3}[-/.]/.test(text),d=dateValue(text,y);
   if(ancient){s.ancient.push(p);if(d!==null&&d>=start&&d<=end)s.rocDone++;}
   else if(d===null)s.notes.push(p);
   else if(d>=start&&d<=end){s.knownDone++;s.rocDone++;}
  }
  const choice=a6?.confirmations?.[c];
  if(choice?.confirmed&&choice.ym===ym&&String(choice.source||'').trim()&&Number.isInteger(choice.need)&&Number.isInteger(choice.done)&&choice.need>=0&&choice.done>=0&&choice.done<=choice.need&&(!s.ancient.length||['roc','exclude'].includes(choice.datePolicy))){cells[c+'10']=choice.need;cells[c+'11']=choice.done;}
  else blockers.push('第6條'+({D:'大安',E:'信義',F:'南港'})[c]+'來源／分母與成果待確認');
  if(s.notes.length)warnings.push('第6條有非日期註記，不算成果、不自行排除分母');
  if(s.ancient.length)warnings.push('第6條有西元0115日期：可按民國115解讀候選，需明確確認');
 }

 for(const [key,row] of [['a8',12],['a12',14],['a15',16]]){
  const a=articles[key];summary[key]={};
  // 11/3 使用者說「能帶入的全部帶入」：沒匯入CSV時用該月已算好的數字（fixed），匯入完整清冊＋檢查紀錄後就改用CSV重算
  if((!a||!Array.isArray(a.register)||!Array.isArray(a.inspections))&&a?.fixed){for(const c of 'DEF'){cells[c+row]=a.fixed.need[c];cells[c+(row+1)]=a.fixed.done[c];}summary[key]={need:a.fixed.need,done:a.fixed.done,fixed:a.fixed.source};if(key==='a15')blockers.push('第15條甲類／甲類以外要匯入有「場所用途」欄的清冊才能分');continue;}
  if(!a||!Array.isArray(a.register)||!Array.isArray(a.inspections)){blockers.push(key+'清冊或查核來源未齊');continue;}
  const registered=new Map(a.register.filter(r=>r['場所編號']&&r['場所名稱']).map(r=>[String(r['場所編號']).trim(),r]));
  const all=new Map(registered);
  if([...registered.values()].some(r=>String(r['列管狀況']).includes('免列管'))&&a.excludeExempt!==true&&a.excludeExempt!==false){blockers.push(key+'免列管是否排除待確認');continue;}
  if(a.excludeExempt===true)for(const [id,r] of registered)if(String(r['列管狀況']).includes('免列管'))registered.delete(id);
  const need={D:0,E:0,F:0},done={D:new Set(),E:new Set(),F:new Set()};
  let unknown=false;
  for(const [id,r] of registered){const c=unitColumn(r['分隊名稱']||r['列管單位']);if(c)need[c]++;else {warnings.push(key+'清冊有未知單位');unknown=true;}if(/停業|歇業/.test(r['列管狀況']||''))warnings.push(key+'停業／歇業計算規則未確認，目前納入清冊');}
  for(const r of a.inspections){if(!String(r['安檢項目']||'').includes('自治條例'))continue;const id=String(r['場所編號']||'').trim(),reg=registered.get(id),d=dateValue(r['檢查日期']);if(!all.has(id))warnings.push(key+'有清冊外查核紀錄，未納入');if(d===null)warnings.push(key+'查核日期無效，未納入');if(!unitColumn(r['分隊名稱']||r['列管單位']))warnings.push(key+'查核紀錄有未知單位');if(reg&&d!==null&&d>=start&&d<=end){const c=unitColumn(reg['分隊名稱']||reg['列管單位']);if(c)done[c].add(id);}}
  if(unknown){blockers.push(key+'未知單位無法分配中隊');continue;}
  for(const c of 'DEF'){cells[c+row]=need[c];cells[c+(row+1)]=done[c].size;}
  // 11/3 使用者定：第15條備註甲類／甲類以外＝應查核場所按清冊「場所用途」代碼分，A 開頭（例 A1A 視聽歌唱、A1D 酒店）算甲類
  if(key==='a15'){const cls={D:[0,0],E:[0,0],F:[0,0]};let miss=0;for(const r of registered.values()){const c=unitColumn(r['分隊名稱']||r['列管單位']),code=String(r['場所用途']||r['署用途']||'').trim().toUpperCase();if(!c)continue;if(!/^[A-Z]/.test(code)){miss++;continue;}cls[c][code[0]==='A'?0:1]++;}
   if(miss)blockers.push('第15條有'+miss+'家清冊沒有場所用途代碼，無法分甲類');else for(const c of 'DEF'){cells[c+'18']=cls[c][0];cells[c+'19']=cls[c][1];}summary.a15.cls=cls;}
  summary[key]={...summary[key],need,done:Object.fromEntries('DEF'.split('').map(c=>[c,done[c].size]))};
 }
 if(drillRows===null)blockers.push('第5條待介接');
 else {
  const unknownScopes=new Set();
  for(let r=2;r<=9;r++)for(const c of 'DEF')cells[c+r]=0;
  for(const r of drillRows){const base=r.list==='first_large'?2:['second_weak','second_large'].includes(r.list)?6:null,c=unitColumn(r.unit);if(base===null||!c){warnings.push('第5條有未知階段或未知單位');continue;}if(/停業|歇業/.test(r.status||''))continue;cells[c+base]++;
   let offset=3;
   if(r.status==='已執行'){const d=dateValue(r.actual||r.planned,y);if(d===null){unknownScopes.add(c+base);warnings.push('第5條缺有效日期，無法追溯');}else if(d<=end)offset=1;else warnings.push('第5條執行日期晚於目標月底，列尚未辦理');}
   else if(String(r.status).includes('辦理中')){unknownScopes.add(c+base);warnings.push('第5條辦理中缺歷史發函日期，無法回溯，相關階段中隊先留空');}
   else if(r.status==='尚未辦理'){const d=dateValue(r.planned,y);if(d===null){unknownScopes.add(c+base);warnings.push('第5條缺有效預定日期，無法追溯');}else if(d<=end)offset=1;}
   cells[c+(base+offset)]++;
  }
  for(const scope of unknownScopes){const c=scope[0],base=+scope.slice(1);for(let i=0;i<4;i++)cells[c+(base+i)]=null;blockers.push('第5條部分範圍日期無法追溯');}
 }
 return {ym,cells,blockers,warnings:[...new Set(warnings)],formal:blockers.length===0&&Object.values(cells).every(v=>typeof v==='number'),summary};
};
root.OrdinanceMonthly=api;if(typeof module==='object')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
