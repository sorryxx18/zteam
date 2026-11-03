/* 自治條例綜合月報：來源在瀏覽器處理，公安資料沿既有權限唯讀取得。 */
(function(root){
 'use strict';
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const articles={a8:'第8條｜歌舞廳燈光音響',a12:'第12條｜身障機構閃滅音響',a15:'第15條｜定期維護保養'};
 const labels={2:'第一階段｜應執行',3:'第一階段｜已執行',4:'第一階段｜辦理中',5:'第一階段｜尚未辦理',6:'第二階段｜應執行',7:'第二階段｜已執行',8:'第二階段｜辦理中',9:'第二階段｜尚未辦理',10:'第6條｜應辦理家數',11:'第6條｜已辦理家數',12:'第8條｜應查核家數',13:'第8條｜已查核家數',14:'第12條｜應查核家數',15:'第12條｜已查核家數',16:'第15條｜應查核家數',17:'第15條｜已查核家數',18:'第15條備註｜甲類',19:'第15條備註｜甲類以外'};
 function decodeCSV(bytes){
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'')}
  catch(e){try{return new TextDecoder('big5',{fatal:true}).decode(bytes)}catch(err){throw Error('CSV編碼無法辨識，請使用UTF-8或Big5原始匯出檔。')}}
 }
 function validateRows(rows,kind){
  if(!rows.length)throw Error('沒有可辨識的場所資料，請確認檔案與編碼。');
  const required=kind==='register'?['列管狀況','管理項目']:['檢查日期','安檢項目'];
  if(required.some(key=>!Object.prototype.hasOwnProperty.call(rows[0],key)))throw Error(kind==='register'?'這不是場所清冊，請選擇清冊檔。':'這不是檢查紀錄，請選擇檢查明細檔。');
 }
 async function loadDrill(api){
  if(typeof api!=='function')throw Error('請從原系統登入後讀取公安演練資料。');
  const res=await api({action:'drill_data'});
  if(res.unit)throw Error('此帳號僅可讀取自己的中隊；請用管理者帳號讀取全大隊，避免漏計。');
  if(!Array.isArray(res.rows))throw Error('公安資料格式不正確，沒有代填零。');
  return res.rows;
 }
 async function readA6Workbook(bytes,file){
  let Zip=root.JSZip;if(!Zip&&root.loadJSZip){const loaded=await root.loadJSZip();Zip=root.JSZip||loaded;}if(!Zip)throw Error('JSZip尚未載入');
  const zip=await Zip.loadAsync(bytes),xml=async path=>{const entry=zip.file(path);if(!entry)throw Error('XLSX缺少必要內容');const d=new DOMParser().parseFromString(await entry.async('string'),'application/xml');if(d.querySelector('parsererror'))throw Error('XLSX內容無法辨識');return d;};
  const workbook=await xml('xl/workbook.xml'),rels=await xml('xl/_rels/workbook.xml.rels');
  const texts=node=>Array.from(node.getElementsByTagName('t')).map(t=>t.textContent).join('');
  const strings=zip.file('xl/sharedStrings.xml')?Array.from((await xml('xl/sharedStrings.xml')).getElementsByTagName('si')).map(texts):[];
  const epoch=workbook.getElementsByTagName('workbookPr')[0]?.getAttribute('date1904');
  const sheets=[];
  for(const sheet of workbook.getElementsByTagName('sheet')){
   const rid=sheet.getAttribute('r:id'),rel=Array.from(rels.getElementsByTagName('Relationship')).find(r=>r.getAttribute('Id')===rid);
   if(!rel||rel.getAttribute('TargetMode')==='External')throw Error('不支援外部工作表');
   const target=rel.getAttribute('Target'),path=target.startsWith('/')?target.slice(1):'xl/'+target;
   if(path.includes('..'))throw Error('不支援的工作表路徑');
   const doc=await xml(path),rows=[];
   for(const row of doc.getElementsByTagName('row')){const cells=[];
    for(const cell of row.getElementsByTagName('c')){const ref=cell.getAttribute('r')||'',column=ref.replace(/\d/g,''),index=Array.from(column).reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
     if(index<0||index>8)continue;const value=cell.getElementsByTagName('v')[0]?.textContent??'',type=cell.getAttribute('t');
     let v=type==='s'?(strings[+value]??''):type==='inlineStr'?texts(cell):value;
     if(column==='G'&&value!==''&&(!type||type==='n')&&Number.isFinite(Number(value))){const serial=Number(value),d=new Date(Date.UTC(epoch==='1'||epoch==='true'?1904:1899,epoch==='1'||epoch==='true'?0:11,epoch==='1'||epoch==='true'?1:30)+serial*86400000);v=String(d.getUTCFullYear()).padStart(4,'0')+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');}
     cells[index]=v;
    }
    const n=Number(row.getAttribute('r'));if(n>0&&n<100000)rows[n-1]=cells;
   }
   const dense=Array.from({length:rows.length},(_,i)=>rows[i]||[]);
   sheets.push({name:sheet.getAttribute('name'),rows:dense,eligible:dense.some(r=>r[0]==='序號'&&r[2]==='場所名稱'&&String(r[6]).includes('第6條'))});
  }
  return {file,sheets};
 }
 function lastMonth(){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);return String(d.getFullYear()-1911)+String(d.getMonth()+1).padStart(2,'0')}
 // 11/3 使用者定：大安分母用明細家數、0115 當民國 115；信義 115年10月已定案 24／10
 const A6_FIXED={'11510':{E:{need:24,done:10,source:'使用者核定：威秀A16/A17分開認列、秀泰計入、誠品松菸11/20未到不計',auto:true},D:{need:18,done:7,datePolicy:'roc',source:'第6條明細18家、0115按民國115算7家（待與大安確認）'}}};
 // 11/3 使用者說「能帶入的全部帶入」：115年10月第8/12/15條用先前6份安管CSV算好的數字（免列管排除）；匯入新CSV就改用新檔重算
 const ARTICLE_FIXED={'11510':{a8:{need:{D:0,E:4,F:0},done:{D:0,E:4,F:0}},a12:{need:{D:17,E:27,F:9},done:{D:11,E:13,F:4}},a15:{need:{D:26,E:47,F:13},done:{D:26,E:47,F:13}}}};
 const withFixed=st=>{const out={};for(const k of ['a8','a12','a15']){const a=st.articles[k],f=ARTICLE_FIXED[st.ym]?.[k];out[k]=f&&!(a?.register&&a?.inspections)?{...a,fixed:{...f,source:'先前安管CSV算好的數字'}}:a;}return {...st,articles:out,a6:withA6(st)};};
 const withA6=st=>{const auto=Object.entries(A6_FIXED[st.ym]||{}).filter(([,f])=>f.auto);if(!auto.length)return st.a6;const a6={places:[],...st.a6,confirmations:{...(st.a6?.confirmations||{})}};for(const [c,f] of auto)if(!a6.confirmations[c]&&!a6.drafts?.[c])a6.confirmations[c]={need:f.need,done:f.done,source:f.source,datePolicy:'',ym:st.ym,confirmed:true};return a6;};
 let A6_YM='';
 function suggestA6(c,s){const f=A6_FIXED[A6_YM]?.[c];if(f)return {datePolicy:'',...f};if(!s.places.length)return {};return {need:s.need,done:s.ancient.length?s.rocDone:s.knownDone,datePolicy:s.ancient.length?'roc':'',source:'依匯入明細'+(s.places[0]?.source?.sheet?'（'+s.places[0].source.sheet+'）':'')};}
 const STORE='zteam-ordinance:';
 const saveLocal=(ym,data)=>{try{localStorage.setItem(STORE+ym,JSON.stringify(data));return true}catch(e){return false}};
 const loadLocal=ym=>{try{return JSON.parse(localStorage.getItem(STORE+ym)||'null')}catch(e){return null}};
 function mount(container,options={}){
  const C=root.OrdinanceMonthly;
  if(!C)throw Error('綜合月報元件未載入');
  const state={ym:lastMonth(),articles:{},drillRows:null,a6:null,class15:null};
  const files={};let template=null,busy=false,review=null,a6Workbook=null;
  const ym=state.ym;const iso=(Number(ym.slice(0,3))+1911)+'-'+ym.slice(3);
  container.innerHTML=`<section class="om">
   <div class="card vsec omhead"><h2>📋 自治條例綜合月報<span class="note">臺北市火災預防自治條例執行情形</span></h2>
    <div class="ombar"><label>報表月份<input id="omMonth" type="month" value="${iso}"></label><span class="note">依選定月底核算，不直接使用今天的進度</span></div>
   </div>
   <div id="omStatus" class="omstatus"></div>
   <p id="omMessage" role="status" aria-live="polite"></p>
   <details class="card vsec omsources" open><summary><h2>⬆️ 匯入來源<span class="note">保留原檔，分項匯入</span></h2></summary>
    <label class="omtemplate"><b>綜合月報原Excel</b><span class="note">已內建正式範本，通常不用上傳；格式改版時再上傳新檔</span><input id="omTemplate" type="file" accept=".xlsx"><span id="omTemplateName" class="note"></span></label>
    <div class="omimports">${Object.entries(articles).map(([key,label])=>`<div class="omsource"><h3>${label}</h3><label>場所清冊<input type="file" accept=".csv" data-article="${key}" data-kind="register"><span id="om-${key}-register" class="note"></span></label><label>檢查紀錄<input type="file" accept=".csv" data-article="${key}" data-kind="inspections"><span id="om-${key}-inspections" class="note"></span></label><label class="ompolicy" id="om-${key}-policybox" hidden>清冊內免列管場所<select data-policy="${key}"><option value="exclude">本報表不計入（預設，同防管月報原則）</option><option value="include">本報表仍計入</option></select></label></div>`).join('')}</div>
   </details>
   <div class="card vsec"><h2>🚒 第5條｜公安動態演練</h2><p class="note">從原系統讀取，不修改演練名單或進度。歷史狀態無法回溯的部分會另外提示。</p><button id="omDrill" class="ghost">讀取系統公安演練資料</button><span id="omDrillState" class="note"> 尚未讀取</span></div>
   <div class="card vsec" id="omA6"><h2>第6條｜自衛消防編組應變能力驗證</h2><p class="note">分中隊收件與確認；只讀第6條日期，不使用一般安檢日期或舊彙總替其他中隊代填。尚缺單位不填0，仍可下載未齊草稿。</p><label>第6條明細Excel<input id="omA6File" type="file" accept=".xlsx"></label><div class="ombar"><label>明細分頁<select id="omA6Sheet"><option value="">先選擇Excel</option></select></label><button id="omA6Import" class="ghost" disabled>匯入所選明細</button><button id="omA6Clear" class="ghost">清除第6條來源與確認</button></div><p id="omA6Source" class="note"></p><p class="note">分母與成果可依核定來源逐單位填報，需註明來源／差異理由並明確確認。來源明細家數不等於已核定分母；非日期註記不列成果，也不自行從分母扣除。西元0115原值不改，可選按民國115解讀候選。換檔、匯入分頁或換月後須重新確認。</p><div id="omA6Units" class="omimports"></div></div>
   <details class="card vsec ompreview"><summary><h2>📊 月報預覽<span class="note">— 代表待補或口徑未確認</span></h2></summary><div class="tablewrap" id="omTable"></div></details>
   <details class="card vsec omchecks"><summary><h2>核對事項<span id="omCheckCount" class="note"></span></h2></summary><div id="omChecks"></div></details>
   <div class="card vsec omexport"><h2>📥 下載月報</h2><p id="omExportHint" class="note"></p><div class="omactions"><button id="omDraft" class="ghost" disabled>下載未齊草稿</button><button id="omFormal" disabled>匯出完整正式月報</button></div><p class="note">原Excel版面、表名、文字、公式、合併及列印設定維持不變。待補只標在網頁與檔名。</p></div>
   <p class="note omprivacy">匯入的來源與確認會自動存在這台電腦的瀏覽器（依月份），重整或明天再開都還在；換電腦要重新匯入。來源含內部資料，請勿公開。</p>
  </section>`;
  const q=s=>container.querySelector(s);
  const message=(text,error=false)=>{q('#omMessage').textContent=text;q('#omMessage').className=error?'err':''};
  const articleReady=k=>!!state.articles[k]?.register&&!!state.articles[k]?.inspections;
  const articleFixed=k=>!articleReady(k)&&!!ARTICLE_FIXED[state.ym]?.[k];
  function restore(ym){const d=loadLocal(ym);state.articles=d?.articles||{};state.a6=d?.a6||null;state.drillRows=d?.drillRows||null;for(const k of Object.keys(files))delete files[k];Object.assign(files,d?.files||{});
   for(const key of Object.keys(articles))for(const kind of ['register','inspections'])q('#om-'+key+'-'+kind).textContent=state.articles[key]?.[kind]?'已存：'+(files[key+kind]||'')+'（'+state.articles[key][kind].length+'筆）':ARTICLE_FIXED[ym]?.[key]?'未匯入；已先帶入算好的數字，匯入新檔會重算':'';
   for(const el of container.querySelectorAll('[data-policy]'))el.value=state.articles[el.dataset.policy]?.excludeExempt===false?'include':'exclude';
   q('#omDrillState').textContent=state.drillRows?' 已存 '+state.drillRows.length+'筆（可再讀一次更新）':' 尚未讀取';
   q('#omA6Source').textContent=state.a6?.places?.length?'已存：第6條明細 '+state.a6.places.length+'筆':'';}
  function persist(){if(!Object.keys(state.articles).length&&!state.a6&&!state.drillRows){try{localStorage.removeItem(STORE+state.ym)}catch(e){}return;}if(!saveLocal(state.ym,{articles:state.articles,a6:state.a6,drillRows:state.drillRows,files,at:Date.now()}))message('這台電腦的瀏覽器存不下（空間不足或無痕模式），重整後要重新匯入。',true);}
  function draw(a6Fields=true){
   A6_YM=state.ym;review=C.build(withFixed(state));
   if(a6Fields){
    q('#omA6Units').innerHTML=Object.entries({D:'大安',E:'信義',F:'南港'}).map(([c,label])=>{
     const s=review.summary.a6[c],v=state.a6?.drafts?.[c]||state.a6?.confirmations?.[c]||suggestA6(c,s);
     const details=s.places.map(p=>'<li>'+escape(p.name)+'｜'+escape(p.date||'無第6條日期')+'｜'+p.evidence.map(e=>escape(e.source?.file||'')+'／'+escape(e.source?.sheet||'')+' 第'+escape(e.source?.row||'?')+'列').join('、')+'</li>').join('');
     return `<section class="omsource" data-a6="${c}"><h3>${label}中隊 <span class="tag">${review.cells[c+'10']===null?'待確認':'已確認'}</span></h3><p class="note oma6stats">${s.places.length?'來源'+s.need+'家｜月底前'+s.knownDone+'家｜民國解讀候選'+s.rocDone+'家':'尚無本單位明細，可依核定來源填報'}</p>${s.notes.length?'<p class="note">非日期註記'+s.notes.length+'筆：不算完成、不自扣分母。</p>':''}${s.conflicts.length?'<p class="err">同場所衝突'+s.conflicts.length+'組，未算入候選成果，請核對證據。</p>':''}<label>確認應辦理家數<input data-field="need" type="number" min="0" step="1" value="${escape(v.need??'')}" placeholder="${s.need||'核定分母'}"></label><label>確認截至月底已辦理家數<input data-field="done" type="number" min="0" step="1" value="${escape(v.done??'')}" placeholder="核定成果"></label><label>西元0115日期解讀<select data-field="datePolicy"><option value="">待確認／無此類日期</option><option value="roc" ${v.datePolicy==='roc'||(!v.datePolicy&&s.ancient.length)?'selected':''}>明確按民國115解讀候選</option><option value="exclude" ${v.datePolicy==='exclude'?'selected':''}>不採用這些日期為成果</option></select></label><label>核定來源／差異理由<input data-field="source" type="text" value="${escape(v.source||'')}" placeholder="來源版本與分母、成果差異的選擇"></label><button class="ghost" data-confirm>確認本中隊數值與來源</button><details><summary>逐場所來源與日期（${s.need}家）</summary><ul>${details||'<li>本單位明細待補；如採核定自報請註明來源。</li>'}</ul></details></section>`;
    }).join('');
    for(const el of q('#omA6Units').querySelectorAll('[data-field]'))el.oninput=()=>{const c=el.closest('[data-a6]').dataset.a6;state.a6??={places:[],confirmations:{},drafts:{}};state.a6.drafts??={};state.a6.drafts[c]??={...state.a6.confirmations[c]};state.a6.drafts[c][el.dataset.field]=el.value;delete state.a6.confirmations[c];draw(false)};
    for(const el of q('#omA6Units').querySelectorAll('[data-confirm]'))el.onclick=()=>{const unit=el.closest('[data-a6]'),c=unit.dataset.a6,v=Object.fromEntries([...unit.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value]));
     if(v.need===''||v.done===''||!/^\d+$/.test(v.need)||!/^\d+$/.test(v.done)||+v.done>+v.need||!v.source.trim()||(review.summary.a6[c].ancient.length&&!v.datePolicy)){message('請確認非負整數、成果不大於分母、來源／差異理由，以及0115日期解讀。',true);return;}
     state.a6??={places:[],confirmations:{}};state.a6.confirmations[c]={...v,need:+v.need,done:+v.done,ym:state.ym,confirmed:true,attachments:review.summary.a6[c].places.map(p=>p.source)};message('本中隊已確認；其他未收到單位仍待補。');draw();
    };
   }
   for(const unit of q('#omA6Units').querySelectorAll('[data-a6]'))unit.querySelector('h3 .tag').textContent=review.cells[unit.dataset.a6+'10']===null?'待確認':'已確認';
   q('#omA6Import').disabled=busy||!a6Workbook||!a6Workbook.sheets[+q('#omA6Sheet').value]?.eligible;
   const a6Confirmed=Object.values(review.summary.a6).filter((s,i)=>review.cells['DEF'[i]+'10']!==null).length;
   const status=[['公安演練',!!state.drillRows],['編組驗證 '+a6Confirmed+'/3中隊確認',a6Confirmed===3],['燈光音響',articleReady('a8'),articleFixed('a8')],['閃滅音響',articleReady('a12'),articleFixed('a12')],['維護保養',articleReady('a15'),articleFixed('a15')]];
   q('#omStatus').innerHTML=status.map(([name,ok,fixed])=>`<div class="card vunit ${ok||fixed?'ok':'omwait'}"><div class="vname">${name}<span class="tag ${ok||fixed?'ok':''}">${ok?'來源已收到':fixed?'已帶入算好的數字':'待補'}</span></div></div>`).join('');
   for(const key of Object.keys(articles)){
    const hasExempt=(state.articles[key]?.register||[]).some(r=>String(r['列管狀況']||'').includes('免列管'));
    q('#om-'+key+'-policybox').hidden=!hasExempt;
   }
   const rows=Object.entries(labels).map(([r,label])=>{
    const nums=['D','E','F'].map(c=>review.cells[c+r]);
    const sum=nums.every(v=>typeof v==='number')?nums.reduce((a,b)=>a+b,0):null;
    return `<tr><th>${label}</th>${[...nums,sum].map(v=>`<td>${v===null||v===undefined?'—':escape(v)}</td>`).join('')}</tr>`;
   });
   q('#omTable').innerHTML='<table><thead><tr><th>項目</th><th>大安</th><th>信義</th><th>南港</th><th>合計</th></tr></thead><tbody>'+rows.join('')+'</tbody></table>';
   const issues=[...review.blockers,...review.warnings];
   q('#omCheckCount').textContent=issues.length?' '+issues.length+'項':'';
   q('#omChecks').innerHTML=issues.length?'<ul>'+issues.map(s=>'<li>'+escape(s)+'</li>').join('')+'</ul>':'<p class="note">目前沒有額外核對事項。</p>';
   q('#omDraft').disabled=!template||busy;
   q('#omFormal').disabled=!template||!review.formal||busy;
   q('#omExportHint').textContent=!template?'先匯入原Excel。來源不齊也可下載明確標示的草稿，未知數據留空。':review.formal?'資料完整，可以匯出正式月報。':'第6條等項目尚待補齊或核對，目前僅可下載未齊草稿。';
   for(const el of container.querySelectorAll('input,select,#omDrill'))el.disabled=busy;
   persist();
  }
  async function run(task,text){busy=true;message('處理中…');draw();try{await task();message(text)}catch(err){message(err.message,true)}finally{busy=false;draw()}}
  q('#omA6File').onchange=event=>{const file=event.target.files[0];if(!file)return;run(async()=>{const wb=await readA6Workbook(new Uint8Array(await file.arrayBuffer()),file.name);if(!wb.sheets.some(s=>s.eligible))throw Error('沒有第6條明細分頁；不使用舊彙總代填');a6Workbook=wb;if(state.a6){state.a6.confirmations={};state.a6.drafts={};}q('#omA6Sheet').innerHTML=wb.sheets.map((s,i)=>`<option value="${i}" ${s.eligible?'':'disabled'}>${escape(s.name)}${s.eligible?'':'（彙總／非第6條明細，不匯入）'}</option>`).join('');q('#omA6Sheet').value=String(wb.sheets.findIndex(s=>s.eligible));q('#omA6Source').textContent='已讀取：'+file.name+'；請確認分頁後匯入。';},'已讀取Excel分頁，尚未採用舊彙總。')};
  q('#omA6Sheet').onchange=()=>draw();
  q('#omA6Import').onclick=()=>{try{const sheet=a6Workbook?.sheets[+q('#omA6Sheet').value];if(!sheet?.eligible)throw Error('請選擇第6條明細分頁');const parsed=C.parseA6Rows(sheet.rows,{file:a6Workbook.file,sheet:sheet.name});const units=new Set(parsed.places.map(p=>p.unit));state.a6={places:[...(state.a6?.places||[]).filter(p=>!units.has(p.unit)),...parsed.places],confirmations:{},drafts:{}};q('#omA6Source').textContent='已匯入：'+a6Workbook.file+'／'+sheet.name+'，'+parsed.places.length+'筆；其他單位未代填。';message('第6條明細已匯入，請逐中隊確認分母與成果。');draw();}catch(e){message(e.message,true)}};
  q('#omA6Clear').onclick=()=>{state.a6=null;a6Workbook=null;q('#omA6File').value='';q('#omA6Sheet').innerHTML='<option value="">先選擇Excel</option>';q('#omA6Source').textContent='';draw();message('第6條來源與確認已清除。')};
  // 11/3 預設帶入 templates/ordinance-template.xlsx（使用者原檔清掉數值與建立者姓名）；要換再自己上傳
  fetch('templates/ordinance-template.xlsx?v=20261103a').then(r=>{if(!r.ok)throw Error(r.status);return r.arrayBuffer()}).then(b=>{if(!template){template=new Uint8Array(b);q('#omTemplateName').textContent='已帶入系統範本（要換再上傳）';draw();}}).catch(()=>{});
  q('#omTemplate').onchange=event=>{const file=event.target.files[0];if(!file)return;run(async()=>{const bytes=new Uint8Array(await file.arrayBuffer());await C.exportXLSX(bytes,review.cells,{draft:true,formal:false});template=bytes;q('#omTemplateName').textContent='已讀取：'+file.name},'原Excel已讀取。')};
  for(const el of container.querySelectorAll('[data-article]'))el.onchange=event=>{
   const input=event.target,file=input.files[0];if(!file)return;
   const key=input.dataset.article,kind=input.dataset.kind;
   run(async()=>{
    const rows=C.parseCSV(decodeCSV(new Uint8Array(await file.arrayBuffer())));
    const source=rows.filter(r=>String(r['場所編號']||'').trim()&&String(r['場所名稱']||'').trim());
    validateRows(source,kind);
    state.articles[key]??={excludeExempt:true};state.articles[key][kind]=source;
    if(kind==='register'){state.articles[key].excludeExempt=true;q('[data-policy="'+key+'"]').value='exclude';}
    files[key+kind]=file.name;q('#om-'+key+'-'+kind).textContent='已讀取：'+source.length+'筆明細';
   },articles[key]+'來源匯入完成。');
  };
  for(const el of container.querySelectorAll('[data-policy]'))el.onchange=()=>{state.articles[el.dataset.policy].excludeExempt=el.value===''?null:el.value==='exclude';draw()};
  q('#omMonth').onchange=()=>{const value=q('#omMonth').value;if(!/^\d{4}-\d{2}$/.test(value))return;state.ym=String(Number(value.slice(0,4))-1911)+value.slice(5);restore(state.ym);draw()};
  q('#omDrill').onclick=()=>run(async()=>{state.drillRows=await loadDrill(options.api);q('#omDrillState').textContent=' 已唯讀載入 '+state.drillRows.length+'筆'},'公安資料讀取完成，未修改原系統。');
  async function download(draft){
   await run(async()=>{
    if(!draft&&!review.formal)throw Error('資料未完整，不可匯出正式月報。');
    const bytes=await C.exportXLSX(template,review.cells,{draft,formal:review.formal});
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const a=document.createElement('a');a.href=url;a.download='臺北市火災預防自治條例執行情形-'+state.ym+(draft?'-未齊草稿':'-正式')+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   },draft?'未齊草稿已下載；空白項目尚未完成。':'正式月報已下載。');
  }
  q('#omDraft').onclick=()=>download(true);q('#omFormal').onclick=()=>download(false);
  restore(state.ym);draw();
  // 11/3 第5條一打開就自動唯讀抓一次公安演練；失敗（中隊帳號等）就保留原狀，可再按按鈕
  if(typeof options.api==='function')loadDrill(options.api).then(rows=>{if(busy)return;state.drillRows=rows;q('#omDrillState').textContent=' 已自動讀取 '+rows.length+'筆';draw()}).catch(()=>{});
  return {getReview:()=>structuredClone(review),getState:()=>structuredClone(state)};
 }
 root.OrdinanceUI={loadDrill,decodeCSV,validateRows,readA6Workbook,mount};
 if(typeof module!=='undefined')module.exports=root.OrdinanceUI;
})(typeof window!=='undefined'?window:globalThis);
