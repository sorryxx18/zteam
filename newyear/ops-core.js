(function(root){
 'use strict';
 function cameras(list,bounds){
  const seen=new Set();
  return list.filter(c=>{
   if(seen.has(c.id)||!Number.isFinite(c.lat)||!Number.isFinite(c.lng)||c.lat<bounds[0][0]||c.lat>bounds[1][0]||c.lng<bounds[0][1]||c.lng>bounds[1][1])return false;
   seen.add(c.id);return true;
  }).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));
 }
 function statusFor(rows,device){
  const r=rows.find(x=>x.device===device&&['待命','出勤','返隊'].includes(x.status));
  return r?{status:r.status,updated_at:r.updated_at||'',isDefault:false}:{status:'待命',updated_at:'',isDefault:true};
 }
 function formatTime(t){
  if(!t)return '未提供';
  const value=typeof t==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(t)?t.replace(' ','T')+'+08:00':t;
  const d=new Date(value);
  return Number.isFinite(d.getTime())?d.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'未提供';
 }
 const api={cameras,statusFor,formatTime};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.Ops=api;
})(typeof globalThis!=='undefined'?globalThis:this);
