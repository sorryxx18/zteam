(function(root){
'use strict';
const api=typeof module==='object'?require('./ordinance-core.js'):root.OrdinanceMonthly;
function zipRecords(input){
 const bytes=new Uint8Array(input),view=new DataView(bytes.buffer),bad=()=>{throw new Error('Excel ZIP結構不完整或不支援ZIP64');};
 let end=bytes.length-22;
 for(;end>=Math.max(0,bytes.length-65557);end--)if(view.getUint32(end,true)===0x06054b50&&end+22+view.getUint16(end+20,true)===bytes.length)break;
 if(end<0||end<bytes.length-65557)bad();
 const count=view.getUint16(end+10,true),central=view.getUint32(end+16,true);if(count===65535||central===4294967295)bad();
 const entries=[];let cursor=central;
 for(let i=0;i<count;i++){
  if(cursor+46>end||view.getUint32(cursor,true)!==0x02014b50)bad();
  const nameLength=view.getUint16(cursor+28,true),size=46+nameLength+view.getUint16(cursor+30,true)+view.getUint16(cursor+32,true),offset=view.getUint32(cursor+42,true);
  if(cursor+size>end||offset>=central||view.getUint32(offset,true)!==0x04034b50)bad();
  entries.push({name:new TextDecoder().decode(bytes.subarray(cursor+46,cursor+46+nameLength)),offset,header:bytes.slice(cursor,cursor+size)});cursor+=size;
 }
 const ordered=[...entries].sort((a,b)=>a.offset-b.offset);
 for(let i=0;i<ordered.length;i++)ordered[i].local=bytes.slice(ordered[i].offset,i+1<ordered.length?ordered[i+1].offset:central);
 return {bytes,entries,end,ordered};
}
function preserveOtherRecords(original,generated,target){
 const old=zipRecords(original),fresh=zipRecords(generated),replacement=fresh.entries.find(e=>e.name===target);
 if(!replacement||old.entries.length!==fresh.entries.length)throw new Error('Excel ZIP成員與原範本不符');
 const pieces=[old.bytes.slice(0,old.ordered[0].offset)],offsets=new Map();let length=pieces[0].length;
 for(const entry of old.ordered){const piece=entry.name===target?replacement.local:entry.local;offsets.set(entry.name,length);pieces.push(piece);length+=piece.length;}
 const centralOffset=length;
 for(const entry of old.entries){const header=(entry.name===target?replacement.header:entry.header).slice();new DataView(header.buffer).setUint32(42,offsets.get(entry.name),true);pieces.push(header);length+=header.length;}
 const end=old.bytes.slice(old.end),v=new DataView(end.buffer);v.setUint32(12,length-centralOffset,true);v.setUint32(16,centralOffset,true);pieces.push(end);length+=end.length;
 const result=new Uint8Array(length);let offset=0;for(const piece of pieces){result.set(piece,offset);offset+=piece.length;}return result;
}
api.exportXLSX=async function(templateBytes,cells,options={}){
 let Zip=root.JSZip;if(!Zip&&root.loadJSZip){const loaded=await root.loadJSZip();Zip=root.JSZip||loaded;}if(!Zip)throw new Error('JSZip尚未載入');
 const zip=await Zip.loadAsync(templateBytes),path='xl/worksheets/sheet1.xml';
 const fail=()=>{throw new Error('範本格式不符');};
 if(!zip.file(path)||!zip.file('xl/sharedStrings.xml'))fail();
 const workbook=await zip.file('xl/workbook.xml').async('string');if((workbook.match(/<sheet\b/g)||[]).length!==1)fail();
 let xml=await zip.file(path).async('string');if(!/<dimension ref="A1:G19"\s*\/>/.test(xml))fail();
 const strings=[...(await zip.file('xl/sharedStrings.xml').async('string')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m=>[...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join(''));
 for(const [col,title] of [['D','大安中隊'],['E','信義中隊'],['F','南港中隊']]){const m=xml.match(new RegExp('<c\\b[^>]*r="'+col+'1"[^>]*>[\\s\\S]*?<v>(\\d+)</v>'));if(!m||strings[+m[1]]!==title)fail();}
 for(let r=2;r<=19;r++)for(const c of 'DEFG'){
  const m=xml.match(new RegExp('<c\\b[^>]*\\br="'+c+r+'"[^>]*>([\\s\\S]*?)</c>'));if(!m)fail();if(c==='G'&&!/<f\b[^>]*(?:\/>|>[\s\S]*?<\/f>)/.test(m[1]))fail();
 }
 for(let r=2;r<=19;r++)for(const c of 'DEFG'){
  const re=new RegExp('(<c\\b[^>]*\\br="'+c+r+'"[^>]*>)([\\s\\S]*?)(</c>)');
  xml=xml.replace(re,(full,open,body,close)=>{if(c==='G'){const values=[cells['D'+r],cells['E'+r],cells['F'+r]],value=values.every(v=>typeof v==='number')?values.reduce((a,b)=>a+b,0):'';return open+body.replace(/<v>[^<]*<\/v>/,'<v>'+value+'</v>')+close;}return open+(cells[c+r]===null?'':'<v>'+cells[c+r]+'</v>')+close;});
 }
 zip.file(path,xml,{createFolders:false});const generated=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});return preserveOtherRecords(templateBytes,generated,path);
};
if(typeof module==='object')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
