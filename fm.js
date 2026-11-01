/* 防火管理月報：僅本機記憶體處理，不使用正式 API。 */
(function(root){
'use strict';
const units=['大安中隊','信義中隊','南港中隊'];
const cols='B C D E F G H I J K L M N O P Q R S T U V W X Y Z AA AB AC AD'.split(' ');
function number(v){if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/,/g,''));return Number.isFinite(n)?n:null;}
function ratio(a,b){return a===null||b===null||!b?null:a/b;}
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RNS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TNS='urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const els=(d,n)=>Array.from(d.getElementsByTagNameNS('*',n));
function xml(s){const d=new root.DOMParser().parseFromString(s,'application/xml');if(els(d,'parsererror').length)throw Error('XML 格式錯誤');return d;}
const serial=d=>new root.XMLSerializer().serializeToString(d);
const clean=s=>String(s||'').replace(/\s/g,'');
const colName=n=>n<26?String.fromCharCode(65+n):'A'+String.fromCharCode(65+n-26);
const colIndex=s=>Array.from(s).reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
function rates(v){for(const [out,a,b] of [['D','C','B'],['H','G','F'],['L','K','J'],['P','O','N'],['Y','X','V']])v[out]=ratio(v[a],v[b]);return v;}
async function zipLoad(bytes){if(!root.JSZip){if(typeof loadJSZip==='function')await loadJSZip();else throw Error('離線 JSZip 未載入');}return root.JSZip.loadAsync(bytes);}
async function matrix(zip,path,ods=false){
 const d=xml(await zip.file(path).async('string'));const rows=[];
 if(ods){
  const table=els(d,'table')[0];if(!table)throw Error('找不到工作表');
  for(const row of els(table,'table-row').slice(0,250)){
   const values=[];for(const c of Array.from(row.childNodes).filter(x=>x.localName==='table-cell'||x.localName==='covered-table-cell')){
    const repeat=Math.min(31,Number(c.getAttributeNS(TNS,'number-columns-repeated')||1));
    const ps=els(c,'p');const text=ps.map(p=>p.textContent).join('\n');
    for(let i=0;i<repeat&&values.length<31;i++)values.push(text);
   }rows.push(values);
  }
 }else{
  const ss=zip.file('xl/sharedStrings.xml')?els(xml(await zip.file('xl/sharedStrings.xml').async('string')),'si').map(x=>els(x,'t').map(t=>t.textContent).join('')):[];
  for(const r of els(d,'row')){const values=[];for(const c of els(r,'c')){const idx=colIndex(c.getAttribute('r').replace(/\d/g,''));if(idx>30)continue;const type=c.getAttribute('t');const v=els(c,'v')[0];values[idx]=type==='s'?ss[Number(v?.textContent)]:type==='inlineStr'?els(c,'t').map(t=>t.textContent).join(''):(v?.textContent??'');}rows[Number(r.getAttribute('r'))-1]=values;}
 }return rows;
}
async function workbook(zip){const doc=xml(await zip.file('xl/workbook.xml').async('string'));const rel=xml(await zip.file('xl/_rels/workbook.xml.rels').async('string'));return {doc,rel,sheets:els(doc,'sheet').map(s=>{const id=s.getAttributeNS(RNS,'id');const target=els(rel,'Relationship').find(r=>r.getAttribute('Id')===id)?.getAttribute('Target');return {name:s.getAttribute('name'),path:target?.startsWith('/')?target.slice(1):'xl/'+target,node:s};})};}
function parseRows(rows){
 const hi=rows.findIndex(r=>r&&r.some(c=>clean(c)==='遴用防火管理人'));
 if(hi<0||!rows[hi].some(c=>clean(c).includes('製定共同消防防護計畫')))throw Error('找不到防火管理月報表頭');
 const total=rows.findIndex((r,i)=>i>hi&&r&&clean(r[0])==='總計');if(total<0)throw Error('找不到總計列');
 const txt=rows.slice(0,hi).flat().join(' ');const match=txt.match(/(?:中華民國\s*)?(\d{2,3})\s*年\s*(\d{1,2})\s*月/);
 const values={};for(const c of cols)values[c]=number(rows[total][colIndex(c)]);
 return {values:rates(values),sourcePeriod:match?match[1]+match[2].padStart(2,'0'):null,totalRow:total+1,rows,headerRow:hi+1};
}
async function readReport(bytes,kind='xlsx',sheetName){const zip=await zipLoad(bytes);let path='content.xml';if(kind!=='ods'){const wb=await workbook(zip);const sheet=sheetName?wb.sheets.find(s=>s.name===sheetName):wb.sheets[0];if(!sheet)throw Error('找不到指定月份工作表');path=sheet.path;}return parseRows(await matrix(zip,path,kind==='ods'));}
function csvRows(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=c;}if(quoted)throw Error('CSV 引號未閉合');if(cell||row.length){row.push(cell);rows.push(row);}return rows;}
function parseCSV(bytes,period){
 let text,encoding='UTF-8';try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(e){text=new TextDecoder('big5',{fatal:true}).decode(bytes);encoding='CP950 / Big5';}
 const rows=csvRows(text.replace(/^\uFEFF/,''));const h=rows.shift()?.map(clean)||[];const needed=['分隊名稱','檢查日期','安檢項目','檢查結果'];if(needed.some(k=>!h.includes(k)))throw Error('CSV 缺少必要表頭');
 const counts=Object.fromEntries(units.map(u=>[u,0]));const out={counts,encoding,tailRows:0,otherMonths:0,unknownUnits:0,missingUnits:0,invalidDates:0,matched:0,blocked:false};
 const team={'安和分隊':units[0],'金華分隊':units[0],'信義分隊':units[1],'莊敬分隊':units[1],'南港分隊':units[2],'舊莊分隊':units[2],'成德分隊':units[2]};
 for(const r of rows){if(r.every(c=>!clean(c)))continue;if(/^\d+筆$/.test(clean(r[0]))&&r.slice(1).every(c=>!clean(c))){out.tailRows++;continue;}
  const get=k=>clean(r[h.indexOf(k)]);const items=String(r[h.indexOf('安檢項目')]||'').trim().split(/\r?\n/).map(clean);const results=String(r[h.indexOf('檢查結果')]||'').trim().split(/\r?\n/).map(clean);
  if(!items.some((x,i)=>x==='防火管理'&&/^(限改|限期改善)$/.test(results[i]||'')))continue;
  const m=get('檢查日期').match(/^(\d{2,4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);if(!m||Number(m[2])<1||Number(m[2])>12||Number(m[3])<1||Number(m[3])>31){out.invalidDates++;continue;}
  const y=Number(m[1])>1911?Number(m[1])-1911:Number(m[1]);if(String(y)+m[2].padStart(2,'0')!==period){out.otherMonths++;continue;}
  const u=get('分隊名稱');if(!u){out.missingUnits++;continue;}if(!team[u]){out.unknownUnits++;continue;}counts[team[u]]++;out.matched++;
 }out.blocked=!!(out.unknownUnits||out.missingUnits||out.invalidDates);return out;
}
function create(period='11510'){if(!/^\d{3}(0[1-9]|1[0-2])$/.test(period))throw Error('請選擇有效民國年月');return {period,previous:null,template:null,reports:{},csv:null,choices:{}};}
function prevPeriod(p){let y=Number(p.slice(0,3)),m=Number(p.slice(3))-1;if(!m){y--;m=12;}return String(y)+String(m).padStart(2,'0');}
async function importPrevious(s,bytes){const p=prevPeriod(s.period);const report=await readReport(bytes,'xlsx',String(Number(p.slice(3))));if(report.sourcePeriod!==p)throw Error('上月原檔月份不符');const previous={};for(const u of units){const row=report.rows.find(r=>r&&clean(r[0])===u);if(!row)throw Error('上月缺少單位：'+u);previous[u]={};for(const c of cols)previous[u][c]=number(row[colIndex(c)]);}s.previous=previous;s.template=new Uint8Array(bytes);s.choices={};return review(s);}
async function importUnit(s,unit,bytes,kind='xlsx'){if(!units.includes(unit))throw Error('請明確選擇中隊單位');const r=await readReport(bytes,kind);if(r.sourcePeriod&&r.sourcePeriod!==s.period)throw Error('來源月份與所選月份不符');const named=r.rows.map(x=>x?.[0]).filter(x=>units.includes(clean(x))).map(clean);if(named.length&&(!named.includes(unit)||named.length>1))throw Error('來源單位不符或含多個中隊，請提供單一中隊報表');s.reports[unit]={values:r.values,sourcePeriod:r.sourcePeriod,confirmedPeriod:null,totalRow:r.totalRow};delete s.choices[unit];delete s.choices[unit+':T'];return review(s);}
function confirmPeriod(s,u,p){if(p!==s.period||!s.reports[u])throw Error('確認期間不符');s.reports[u].confirmedPeriod=p;return review(s);}
function importCSV(s,bytes){if(!bytes)throw Error('請提供本月不合格 CSV');s.csv=parseCSV(bytes,s.period);s.choices={};return review(s);}
function choose(s,u,choice,field='AA'){if(!s.reports[u]||!['computed','reported'].includes(choice)||!['AA','T'].includes(field))throw Error('請選擇採推算或採填報');s.choices[field==='AA'?u:u+':T']=choice;return review(s);}
function review(s){
 const out={blockers:[],missing:units.filter(u=>!s.reports[u]),computed:{},differences:[],acDifferences:[],units:{},total:{},formal:false,draft:false};
 if(!s.template||!s.previous)out.blockers.push('缺少上月原始 XLSX');if(!s.csv)out.blockers.push('缺少本月不合格 CSV');else if(s.csv.blocked)out.blockers.push('CSV 有漏單位、未知分隊或無效日期，請修正來源');
 for(const u of units){const old=s.previous?.[u]?.AA;out.computed[u]=old===null||old===undefined||!s.csv?null:old+s.csv.counts[u];const r=s.reports[u];if(!r)continue;
  if(!r.sourcePeriod&&r.confirmedPeriod!==s.period)out.blockers.push(u+'：來源年月空白，請確認期間');
  if(out.computed[u]===null)out.blockers.push(u+'：上月 AA 或 CSV 缺來源');
  const v={...r.values};
  for(const field of ['AA','T']){const computed=field==='AA'?out.computed[u]:(s.csv?.counts[u]??null),key=field==='AA'?u:u+':T';if(v[field]!==computed){out.differences.push({unit:u,field,reported:v[field],computed,choice:s.choices[key]||null});if(!s.choices[key])out.blockers.push(u+'：'+(field==='T'?'本期限改':'累計限改')+'差異尚未選擇');}if(s.choices[key]==='computed')v[field]=computed;}
  out.acDifferences.push({unit:u,previous:s.previous?.[u]?.AC??null,reported:v.AC,note:'AC 沿用中隊填報，未提供累計裁罰明細，不推算缺值'});
  for(const c of ['E','I','M','Q','AB','AD'])v[c]=null;out.units[u]=rates(v);
 }
 for(const c of cols){const values=units.map(u=>out.units[u]?.[c]??null);out.total[c]=values.some(v=>v===null)?null:values.reduce((a,b)=>a+b,0);}rates(out.total);
 out.draft=out.blockers.length===0;out.formal=out.draft&&!out.missing.length;return out;
}
const escapeXML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function setCell(source,ref,value){const rx=new RegExp('<c\\b(?=[^>]*\\br="'+ref+'")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)');return source.replace(rx,old=>{const attrs=old.match(/^<c\b([^>]*?)(?:\/?>)/)[1].replace(/\s+t="[^"]*"/g,'').replace(/\/$/,'');return '<c'+attrs+(value===null?'/>' : typeof value==='number'?'><v>'+value+'</v></c>':' t="inlineStr"><is><t>'+escapeXML(value)+'</t></is></c>');});}
async function exportXLSX(s,{draft=false,date}={}){
 const r=review(s);if(r.blockers.length)throw Error(r.blockers.join('；'));if(!draft&&!r.formal)throw Error('三中隊未齊，禁止完整正式匯出');if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw Error('請確認編製日期');
 const zip=await zipLoad(s.template),wb=await workbook(zip);const previous=String(Number(prevPeriod(s.period).slice(3)));const src=wb.sheets.find(x=>x.name===previous);if(!src)throw Error('找不到上月工作表');
 const name=String(Number(s.period.slice(3)))+(draft?'-未齊草稿':'');if(wb.sheets.some(x=>x.name===name))throw Error('原檔已有本月工作表，請使用上月原檔');
 let page=await zip.file(src.path).async('string');const parsed=parseRows(await matrix(zip,src.path));
 const ti=parsed.totalRow,unitRows={};for(const u of units){const idx=parsed.rows.findIndex(row=>row&&clean(row[0])===u);if(idx<0)throw Error('原檔缺中隊列');unitRows[u]=idx+1;}
 // 僅新頁複製原列印範圍 A1:AE17；原頁及其印表外九月案件完全不動。
 page=page.replace(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g,(row,n)=>Number(n)>17?'':row.replace(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g,(cell,c)=>colIndex(c)>30?'':cell));
 page=page.replace(/(<dimension\b[^>]*\bref=")[^"]+"/,'$1A1:AE17"').replace(/ tabSelected="1"/g,'');
 for(const [u,row] of Object.entries(unitRows)){for(const c of cols)page=setCell(page,c+row,r.units[u]?.[c]??null);if(!r.units[u])page=setCell(page,'A'+row,u+'（待補）');}
 for(const c of cols)page=setCell(page,c+ti,r.total[c]);
 const suffix=draft?'【未齊草稿；待補：'+(r.missing.join('、')||'無')+'】':'';
 page=setCell(page,'A4','中華民國'+Number(s.period.slice(0,3))+'年'+Number(s.period.slice(3))+'月 '+suffix);
 const [yy,mm,dd]=date.split('-').map(Number);page=setCell(page,'AB12','中華民國'+(yy-1911)+'年'+mm+'月'+dd+'日編製');
 if(draft)page=setCell(page,'A16','未齊草稿／非完整正式報表。待補：'+(r.missing.join('、')||'無')+'。僅複製上月列印範圍，印表外案件未帶入本月。');
 const n=Math.max(...Object.keys(zip.files).map(p=>Number(p.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)?.[1]||0)))+1;const path='xl/worksheets/sheet'+n+'.xml';const rid='rIdFM'+n;const id=Math.max(...wb.sheets.map(x=>Number(x.node.getAttribute('sheetId'))))+1;
 zip.file(path,page);const relPath=src.path.replace('worksheets/','worksheets/_rels/')+'.rels';if(zip.file(relPath))zip.file(path.replace('worksheets/','worksheets/_rels/')+'.rels',await zip.file(relPath).async('uint8array'));
 let w=await zip.file('xl/workbook.xml').async('string');w=w.replace('</sheets>','<sheet name="'+name+'" sheetId="'+id+'" r:id="'+rid+'"/></sheets>');
 const definitions='<definedName name="_xlnm.Print_Area" localSheetId="'+wb.sheets.length+'">\''+name+'\'!$A$1:$AE$17</definedName>';
 w=w.includes('</definedNames>')?w.replace('</definedNames>',definitions+'</definedNames>'):w.replace('</sheets>','</sheets><definedNames>'+definitions+'</definedNames>');
 w=w.replace(/<calcPr\b([^>]*?)\/>/,(_,a)=>'<calcPr'+a.replace(/\s+(fullCalcOnLoad|forceFullCalc)="[^"]*"/g,'')+' fullCalcOnLoad="1" forceFullCalc="1"/>');zip.file('xl/workbook.xml',w);
 let rel=await zip.file('xl/_rels/workbook.xml.rels').async('string');rel=rel.replace('</Relationships>','<Relationship Id="'+rid+'" Type="'+RNS+'/worksheet" Target="worksheets/sheet'+n+'.xml"/></Relationships>');zip.file('xl/_rels/workbook.xml.rels',rel);
 let ct=await zip.file('[Content_Types].xml').async('string');ct=ct.replace('</Types>','<Override PartName="/'+path+'" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');zip.file('[Content_Types].xml',ct);
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
function mount(container){
 let s=create(),busy=false,collapsedSources=false;const e=escapeXML;
 const local=new Date();const date=[local.getFullYear(),String(local.getMonth()+1).padStart(2,'0'),String(local.getDate()).padStart(2,'0')].join('-');
 container.innerHTML=`<div class="fm"><div class="fm-heading"><div><p class="fm-eyebrow">第二大隊 · 業務月報</p><h2>防火管理月報</h2></div><details class="fm-period"><summary><span id="fmPeriodLabel"></span><span class="fm-edit">變更</span></summary><div class="fm-period-body"><div class="fm-inputs"><label>民國年<input id="fmYear" type="number" min="100" max="999" value="115"></label><label>月份<select id="fmMonth">${Array.from({length:12},(_,i)=>`<option value="${String(i+1).padStart(2,'0')}" ${i===9?'selected':''}>${i+1}月</option>`).join('')}</select></label><label>編製日期<input id="fmDate" type="date" value="${date}"></label></div><button id="fmPeriod" class="ghost">套用期間並清空資料</button></div></details></div><div id="fmStatus"></div><details id="fmUploads" class="fm-uploads" open><summary><span>匯入來源檔案</span><small id="fmImportCount">選擇檔案</small></summary><div class="fm-upload-body"><div class="fm-inputs"><label>上月大隊月報 <small>保留原 Excel 格式</small><input id="fmPrevious" type="file" accept=".xlsx"></label><label>本月不合格明細 <small>CSV 檔案</small><input id="fmCSV" type="file" accept=".csv"></label><div><label>中隊月報<select id="fmUnit"><option value="">選擇中隊</option>${units.map(u=>`<option>${u}</option>`).join('')}</select></label><input aria-label="中隊報表檔案" id="fmUnitFile" type="file" accept=".ods,.xlsx"></div></div><p class="fm-hint">檔案在本機處理，不上傳。</p></div></details><p id="fmMessage" role="status" aria-live="polite"></p><div id="fmResults" aria-live="polite"></div><details class="fm-help"><summary>資料處理與保管方式</summary><p>只暫存在本頁，切換工具或重新整理後請重新匯入。下載檔保留整本歷史資料，請勿公開分享。缺值留空，不當成零；比例依分子分母重算。新頁沿用原列印範圍，不帶入上月印表外案件。裁罰累計沿中隊填報，本版不另套清冊扣除規則。</p></details><button id="fmClear" class="fm-clear ghost">清除這次匯入</button></div>`;
 const q=id=>container.querySelector(id);const show=v=>v===null||v===undefined?'—':String(v);
 const labels={B:'應遴用',C:'已遴用',D:'遴用比例',E:'上年比較',F:'應訂消防計畫',G:'已訂消防計畫',H:'消防計畫比例',I:'上年比較',J:'應訂共同計畫',K:'已訂共同計畫',L:'共同比例',M:'上年比較',N:'應訂施工計畫',O:'已訂施工計畫',P:'施工比例',Q:'上年比較',R:'訓練件數累計',S:'訓練人數累計',T:'本期限改',U:'本期裁罰件數',V:'裁罰金額',W:'收繳件次',X:'收繳金額',Y:'收繳率',Z:'強制執行',AA:'累計限改',AB:'上年比較',AC:'累計裁罰',AD:'上年比較'};
 function draw(){const r=review(s);q('#fmPeriodLabel').textContent=s.period.slice(0,3)+' 年 '+Number(s.period.slice(3))+' 月';
  const count=units.filter(u=>s.reports[u]).length,unresolved=r.differences.filter(d=>!d.choice).length;
  q('#fmStatus').innerHTML=`<div class="fm-receipt"><div class="fm-sectionline"><span>中隊報表</span><span>${count} / 3 已收到</span></div><div class="fm-unit-status">${units.map(u=>`<div class="${s.reports[u]?'is-received':'is-missing'}"><i aria-hidden="true"></i><strong>${e(u.replace('中隊',''))}</strong><span>${s.reports[u]?'已收到':'待補'}</span></div>`).join('')}</div></div>`;
  q('#fmImportCount').textContent=(s.previous?'上月原檔已收':'上月原檔待補')+' · '+(s.csv?'明細已收':'明細待補');
  if(s.previous&&s.csv&&count>=2&&!collapsedSources){q('#fmUploads').open=false;collapsedSources=true;}
  q('#fmResults').innerHTML=`<div class="fm-review-heading"><h3>核對報表</h3><span>${unresolved?unresolved+' 項差異待確認':r.differences.length?'差異已確認':'匯入後自動比對'}</span></div>${units.map(u=>{const x=s.reports[u];if(!x)return '';const ds=r.differences.filter(d=>d.unit===u);return `<section class="fm-source"><div class="fm-source-heading"><h3>${e(u)} <span>已匯入</span></h3><span class="fm-review-tag ${ds.some(d=>!d.choice)?'pending':''}">${ds.some(d=>!d.choice)||(!x.sourcePeriod&&x.confirmedPeriod!==s.period)?'待確認':s.csv&&s.previous?'已確認':'待核對'}</span></div>${!x.sourcePeriod?`<label class="fm-confirm"><input type="checkbox" data-confirm="${e(u)}" ${x.confirmedPeriod===s.period?'checked':''}><span>確認這份是 ${s.period.slice(0,3)} 年 ${Number(s.period.slice(3))} 月報表<small>來源未填年月，請人工確認</small></span></label>`:''}${ds.map(d=>`<div class="fm-difference"><label>${d.field==='T'?'本期限改':'累計限改'}</label><div class="fm-compare"><div><span>中隊填報</span><strong>${show(d.reported)}<small>件</small></strong></div><div><span>${d.field==='T'?'本月明細':'上月累計＋本月明細'}</span><strong>${show(d.computed)}<small>件</small></strong></div></div><select aria-label="${e(u)}${d.field==='T'?'本期限改':'累計限改'}採用數字" data-choice="${e(u)}" data-field="${d.field}"><option value="">選擇要採用的數字</option><option value="computed" ${d.choice==='computed'?'selected':''}>採${d.field==='T'?'明細':'推算'} ${show(d.computed)} 件</option><option value="reported" ${d.choice==='reported'?'selected':''}>採中隊填報 ${show(d.reported)} 件</option></select></div>`).join('')}${!ds.length?'<p class="fm-hint">'+(s.csv&&s.previous?'限改件數與明細相符。':'等待上月原檔與本月明細以核對。')+'</p>':''}<details class="fm-source-detail"><summary>查看來源與計算依據</summary><p>總計取來源第 ${x.totalRow} 列；年月：${x.sourcePeriod?e(x.sourcePeriod):'未填，須人工確認'}。</p><p>累計限改：上月 ${show(s.previous?.[u]?.AA)} ＋ 本月明細 ${show(s.csv?.counts[u])} ＝ ${show(r.computed[u])}；中隊填報 ${show(x.values.AA)}。</p><p>累計裁罰：上月 ${show(s.previous?.[u]?.AC)}；本月填報 ${show(x.values.AC)}。缺值留空。</p></details></section>`;}).join('')}${!count?'<div class="fm-empty"><strong>先匯入中隊報表</strong><p>收到的報表會在這裡核對。還沒收到的中隊先留待補，不必重填。</p></div>':''}<details class="fm-preview"><summary>查看本月月報數據 <span>${r.missing.length?'尚缺 '+r.missing.map(e).join('、'):'三中隊已齊'}</span></summary><div class="tablewrap"><table><thead><tr><th>單位</th>${cols.map(c=>`<th>${labels[c]}</th>`).join('')}</tr></thead><tbody>${[...units,'合計'].map(u=>{const v=u==='合計'?r.total:r.units[u];return `<tr><th>${e(u)}${!v?'（待補）':''}</th>${cols.map(c=>`<td>${v?.[c]===null||v?.[c]===undefined?'—':['D','H','L','P','Y'].includes(c)?(v[c]*100).toFixed(2)+'%':e(v[c])}</td>`).join('')}</tr>`;}).join('')}</tbody></table></div><p class="fm-hint">— 為未知或零分母；缺值不當成零。</p>${s.csv?`<p class="fm-hint">明細共 ${s.csv.matched} 筆限改；排除尾列 ${s.csv.tailRows}、其他月份 ${s.csv.otherMonths}。未知分隊 ${s.csv.unknownUnits}、漏單位 ${s.csv.missingUnits}、無效日期 ${s.csv.invalidDates}。</p>`:''}<p class="fm-error">${r.blockers.map(e).join('；')}</p></details><section class="fm-export"><div><h3>${r.formal?'可以匯出月報':r.missing.length?'報表未齊，也能先存草稿':'完成確認後即可匯出'}</h3><p>${r.missing.length?'待補 '+r.missing.map(e).join('、')+'，正式月報暫不開放下載。':r.formal?'沿用上月原始 Excel 格式與歷史分頁。':'請完成上方期間與差異確認。'}</p></div><div class="fm-actions"><button id="fmDraft" class="ghost" ${!r.draft||busy?'disabled':''}>下載未齊草稿</button><button id="fmFormal" ${!r.formal||busy?'disabled':''}>匯出正式月報</button></div></section>`;
 }
 async function run(task){busy=true;for(const el of container.querySelectorAll('input,select,button'))el.disabled=true;q('#fmMessage').textContent='本機處理中…';try{await task();q('#fmMessage').textContent='本機處理完成，請核對下方結果。';q('#fmMessage').className='';}catch(err){q('#fmMessage').textContent=err.message;q('#fmMessage').className='fm-error';}finally{busy=false;for(const el of container.querySelectorAll('input,select,button'))el.disabled=false;draw();}}
 q('#fmPrevious').onchange=()=>{const file=q('#fmPrevious').files[0];if(!file)return;run(async()=>{s.previous=null;s.template=null;s.choices={};await importPrevious(s,new Uint8Array(await file.arrayBuffer()));});};
 q('#fmCSV').onchange=()=>{const file=q('#fmCSV').files[0];if(!file)return;run(async()=>{s.csv=null;s.choices={};importCSV(s,new Uint8Array(await file.arrayBuffer()));});};
 q('#fmUnitFile').onchange=()=>{const file=q('#fmUnitFile').files[0],u=q('#fmUnit').value;if(!file)return;run(async()=>{if(!u)throw Error('請先明確選擇中隊單位，再選擇檔案');delete s.reports[u];delete s.choices[u];delete s.choices[u+':T'];await importUnit(s,u,new Uint8Array(await file.arrayBuffer()),file.name.toLowerCase().endsWith('.ods')?'ods':'xlsx');});};
 q('#fmResults').onchange=event=>{const el=event.target;if(el.dataset.confirm){if(el.checked)confirmPeriod(s,el.dataset.confirm,s.period);else s.reports[el.dataset.confirm].confirmedPeriod=null;}if(el.dataset.choice){const field=el.dataset.field||'AA',key=field==='AA'?el.dataset.choice:el.dataset.choice+':T';if(el.value)choose(s,el.dataset.choice,el.value,field);else delete s.choices[key];}draw();};
 q('#fmResults').onclick=event=>{const id=event.target.id;if(id!=='fmDraft'&&id!=='fmFormal')return;const draft=id==='fmDraft';run(async()=>{const bytes=await exportXLSX(s,{draft,date:q('#fmDate').value});const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download='縣市防火管理執行情形-'+s.period+(draft?'-未齊草稿':'-完整正式')+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});};
 function clear(period){s=create(period);collapsedSources=false;q('#fmUploads').open=true;for(const el of container.querySelectorAll('input[type=file]'))el.value='';q('#fmMessage').textContent='已清除本頁記憶體資料。';draw();}
 q('#fmPeriod').onclick=()=>{try{const p=String(q('#fmYear').value)+q('#fmMonth').value;create(p);clear(p);}catch(err){q('#fmMessage').textContent=err.message;}};q('#fmClear').onclick=()=>clear(s.period);
 F.controller={getState:()=>({period:s.period,previous:s.previous?structuredClone(s.previous):null,reports:structuredClone(s.reports),csv:s.csv?structuredClone(s.csv):null,choices:{...s.choices}}),getReview:()=>structuredClone(review(s))};draw();return F.controller;
}
const F={units,cols,number,ratio,readReport,parseCSV,create,importPrevious,importUnit,confirmPeriod,importCSV,choose,review,exportXLSX,mount};
root.FireManagement=F;if(typeof module!=='undefined')module.exports=F;
})(typeof window!=='undefined'?window:globalThis);
