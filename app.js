/* StockWise v2.0 — browser-first stocktaking prototype.
   For production, move persistence and approvals to a server/database. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const state = {
  period: new Date().toISOString().slice(0,7),
  inventory: [], rows: [], validation: [], inventoryRows: [], countRows: [],
  inventoryHeaders: [], countHeaders: [], inventoryFileName: '', countFileName: '',
  history: [], categoryChart: null, inventoryWorkbook: null, countWorkbook: null,
  inventorySheetName: '', countSheetName: '', periodNotes: '',
  settings: null, sort: {key:'',dir:'asc'}, chartMetric: 'cost', trendChart: null,
  countBySku: new Map(), countLoaded: false, unmatched: [], invVal: [], cntVal: [],
  importStats: {blankInventory:0, blankCounts:0},
  mc: {sel:null, active:0, results:[]}, lastBy: '', alertFilter: null, viewRows: [], restored: false
};
const DEFAULT_SETTINGS = {company:'', preparedBy:'', reviewedBy:'', highValue:500, expiryDays:90, blankUncounted:false};
state.settings = {...DEFAULT_SETTINGS};
const currency = n => { const v = Number.isFinite(Number(n)) ? Number(n) : 0, neg = v < 0 && Math.abs(v) >= 0.005; return (neg ? '-' : '') + 'GH₵' + Math.abs(v).toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2}); };
const number = n => Number(n || 0).toLocaleString('en-GH',{maximumFractionDigits:4});
const clean = v => String(v ?? '').trim();
const norm = v => clean(v).toLowerCase().replace(/[\s_*.-]+/g,'').replace(/[^a-z0-9]/g,'');
const isBlank = v => v === null || v === undefined || clean(v) === '';
const numVal = v => { if (typeof v === 'number') return Number.isFinite(v) ? v : NaN; const s=clean(v).replace(/[,GH₵$£€\s]/g,''); if(!s) return NaN; const n=Number(s); return Number.isFinite(n)?n:NaN; };
const money = n => Math.round((Number(n)+Number.EPSILON)*100)/100;
const monthLabel = m => { if(!m) return 'No period selected'; const [y,mo]=m.split('-').map(Number); return new Date(y,mo-1,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'}); };
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message, error=false){const el=document.createElement('div');el.className='toast'+(error?' error':'');el.textContent=message;$('toastRegion').appendChild(el);setTimeout(()=>el.remove(),4200);}
function setPeriod(m){state.period=m||state.period;$('periodInput').value=state.period;renderAll();}
function readLocalHistory(){try{state.history=JSON.parse(localStorage.getItem('stockwise_history_v1')||'[]')}catch{state.history=[]}}
function saveLocalHistory(){if(DB.ok){DB.set('history',state.history).then(()=>{try{localStorage.removeItem('stockwise_history_v1')}catch{}}).catch(()=>lsHistory());return true}return lsHistory()}
function lsHistory(){try{localStorage.setItem('stockwise_history_v1',JSON.stringify(state.history));return true}catch(e){toast('Could not save history. Browser storage may be full; export history or use smaller files.',true);return false}}
function saveCurrentSnapshot(){
 if(!state.rows.length){toast('Import inventory and counts before saving a snapshot.',true);return}
 const snapshot={id:state.period,period:state.period,savedAt:new Date().toISOString(),notes:state.periodNotes||'',inventoryFile:state.inventoryFileName,countFile:state.countFileName,summary:summary(),rows:state.rows.map(r=>({...r})),validation:state.validation.map(v=>({...v}))};
 const idx=state.history.findIndex(h=>h.period===state.period);
 if(idx>=0){if(!confirm(`A snapshot for ${monthLabel(state.period)} already exists. Replace it with the current data?`))return;state.history[idx]=snapshot}else state.history.push(snapshot);
 state.history.sort((a,b)=>a.period.localeCompare(b.period));
 if(saveLocalHistory()){renderHistory();toast('Stocktake snapshot saved on this browser.')}
}
function detectField(headers, candidates){const map=new Map(headers.map(h=>[norm(h),h]));for(const c of candidates){if(map.has(norm(c)))return map.get(norm(c))}for(const h of headers){const nh=norm(h);if(candidates.some(c=>nh.includes(norm(c))&&norm(c).length>3))return h}return '';}
const inventoryFields=[
 ['sku','SKU / product code',['id**','id','sku','product code','item code','barcode','code']],
 ['name','Product name',['name*','name','product name','description','item description','product']],
 ['category','Category',['category','product category','group']],
 ['unit','Unit of measure',['sale_form','unit','uom','unit of measure','form']],
 ['systemQty','System quantity',['system qty','system quantity','qty','quantity','stock qty','on hand','book qty']],
 ['physicalQty','Physical quantity (count)',['physical qty','physical quantity','physical count','count','counted qty','counted','actual qty','actual','count qty','stock count']],
 ['cost','Unit cost',['rpack_cost','unit cost','cost price','cost','purchase price','pack cost']],
 ['price','Unit selling price',['sale_price','selling price','sale price','retail price','price']],
 ['expiry','Expiry date',['expiry','expiry date','expiration']],
 ['counter','Counted by',['counted_by','counted by','counter','staff']],
 ['notes','Notes',['notes','note','remarks','comment'] ]
];
function getMappingConfig(){return Object.fromEntries(inventoryFields.map(([key,label,candidates])=>[key,$(`inventoryMap_${key}`)?.value||detectField(state.inventoryHeaders,candidates)]))}
function buildMapping(){
 const headers=state.inventoryHeaders,target=$('inventoryMapping');target.innerHTML='';if(!headers.length)return;
 inventoryFields.forEach(([key,label,candidates])=>{
  const wrap=document.createElement('div');wrap.className='mapping-field';const lab=document.createElement('label');lab.htmlFor=`inventoryMap_${key}`;lab.textContent=label+(['sku','systemQty','cost'].includes(key)?' *':'');
  const sel=document.createElement('select');sel.id=`inventoryMap_${key}`;sel.innerHTML='<option value="">— Not mapped —</option>'+headers.map(h=>`<option value="${esc(h)}">${esc(h)}</option>`).join('');sel.value=detectField(headers,candidates)||'';
  sel.addEventListener('change',()=>{$('loadInventoryBtn').disabled=false});wrap.append(lab,sel);target.append(wrap)});
 const sq=$('inventoryMap_systemQty'),pq=$('inventoryMap_physicalQty');if(sq&&pq&&pq.value&&pq.value===sq.value){const alt=headers.find(h=>norm(h).includes('phys')||norm(h).includes('count'));pq.value=alt&&alt!==sq.value?alt:''}
}
async function parseFile(file){
 const ext=file.name.toLowerCase().split('.').pop();
 if(ext==='csv'){const text=await file.text();const wb=XLSX.read(text,{type:'string'});return {wb,headers:[],fileName:file.name}}
 if(!['xlsx','xls'].includes(ext))throw new Error('Please choose a .csv, .xlsx or .xls file.');
 const ab=await file.arrayBuffer();const wb=XLSX.read(ab,{type:'array',cellDates:true});return {wb,headers:[],fileName:file.name};
}
function workbookSheetNames(wb){return wb.SheetNames||[]}
function sheetToRows(wb,sheetName){const ws=wb.Sheets[sheetName];if(!ws)return {headers:[],rows:[]};const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:null,raw:true});let headerIndex=0;while(headerIndex<data.length&&data[headerIndex].every(v=>isBlank(v)))headerIndex++;if(headerIndex>=data.length)return {headers:[],rows:[]};
 const headers=data[headerIndex].map((h,i)=>isBlank(h)?`Column ${i+1}`:clean(h));const rows=[];
 for(let i=headerIndex+1;i<data.length;i++){const vals=data[i]||[];if(vals.every(v=>isBlank(v)))continue;const obj={};headers.forEach((h,j)=>obj[h]=vals[j]===undefined?null:vals[j]);obj.__sourceRow=i+1;rows.push(obj)}
 return {headers,rows,headerRow:headerIndex+1};
}
async function setupFile(type,file){
 if(!file)return;
 try{
  const parsed=await parseFile(file),wb=parsed.wb;
  state.inventoryWorkbook=wb;state.inventoryFileName=file.name;state.inventorySheetName=wb.SheetNames[0];
  const wrap=$('inventorySheetWrap'),sel=$('inventorySheet');
  if(wb.SheetNames.length>1){wrap.classList.remove('hidden');sel.innerHTML=wb.SheetNames.map(n=>`<option>${esc(n)}</option>`).join('');sel.value=state.inventorySheetName;sel.onchange=()=>{state.inventorySheetName=sel.value;loadSheetPreview()}}else wrap.classList.add('hidden');
  $('inventoryFileName').textContent=file.name;$('loadInventoryBtn').disabled=false;
  loadSheetPreview();updateFileButtons();toast('Stock file ready. Check the field mapping, then read the file.');
 }catch(e){toast(e.message||'Could not read file.',true)}
}
function loadSheetPreview(){
 const wb=state.inventoryWorkbook;if(!wb)return;const data=sheetToRows(wb,state.inventorySheetName);
 state.inventoryHeaders=data.headers;state.inventoryRows=data.rows;buildMapping();
 const st=$('inventoryImportStatus');st.className='import-status';st.textContent=`Preview: ${data.rows.length.toLocaleString()} non-empty data rows · ${data.headers.length} columns · worksheet “${state.inventorySheetName}”.`;
}
/* ---------- numeric & date helpers (blank cells are treated as zero) ---------- */
const n0=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const pad2=n=>String(n).padStart(2,'0');
const coerce=(v,allowNeg=false)=>{if(isBlank(v))return {value:0,blank:true,invalid:false};const n=numVal(v);return (!Number.isFinite(n)||(!allowNeg&&n<0))?{value:0,blank:false,invalid:true}:{value:n,blank:false,invalid:false}};
function isoDate(v){
 if(isBlank(v))return '';
 let d=null;
 if(v instanceof Date)d=new Date(Math.round(v.getTime()/864e5)*864e5);
 else if(typeof v==='number'&&v>20000&&v<80000)d=new Date(Math.round(v-25569)*864e5);
 else{const s=clean(v);let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);if(m){let y=+m[3];if(y<100)y+=2000;return `${y}-${pad2(m[2])}-${pad2(m[1])}`}
  const t=new Date(s+' 12:00');d=isNaN(t)?null:new Date(Date.UTC(t.getFullYear(),t.getMonth(),t.getDate()))}
 return d&&!isNaN(d)?d.toISOString().slice(0,10):'';
}
const showDate=iso=>iso?new Date(iso+'T12:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):'—';
const pl=(n,w,p)=>`${number(n)} ${n===1?w:(p||w+'s')}`;
const signed=n=>(n>0?'+':'')+number(n);
const pct=(n,d=1)=>n===null||n===undefined?'N/A':Number(n).toFixed(d)+'%';
function refreshValidation(){state.validation=[...state.invVal]}

/* ---------- settings ---------- */
function loadSettings(){try{state.settings={...DEFAULT_SETTINGS,...JSON.parse(localStorage.getItem('stockwise_settings_v1')||'{}')}}catch{state.settings={...DEFAULT_SETTINGS}}}
function saveSettings(){try{localStorage.setItem('stockwise_settings_v1',JSON.stringify(state.settings))}catch{}}
function openSettings(){const s=state.settings;$('setCompany').value=s.company;$('setPrepared').value=s.preparedBy;$('setReviewed').value=s.reviewedBy;$('setHighValue').value=s.highValue;$('setExpiry').value=s.expiryDays;$('settingsDialog').showModal()}
function applySettings(){const s=state.settings;s.company=clean($('setCompany').value);s.preparedBy=clean($('setPrepared').value);s.reviewedBy=clean($('setReviewed').value);s.highValue=Math.max(0,n0($('setHighValue').value));s.expiryDays=Math.max(1,Math.round(n0($('setExpiry').value))||90);saveSettings();$('settingsDialog').close();reconcile();renderAll();toast('Report settings saved.')}

/* ---------- import ---------- */
function importInventory(){
 if(!state.inventoryWorkbook)return toast('Choose your stock file first.',true);
 const map=getMappingConfig();if(!map.sku||!map.systemQty||!map.cost){toast('Map at least SKU, system quantity and unit cost.',true);return}
 const blankIsUncounted=$('blankPhysicalToggle').checked,rows=state.inventoryRows,val=[],seen=new Set(),out=[],blank={systemQty:0,cost:0,price:0};let blankPhys=0,blankUnc=0;
 rows.forEach((r,i)=>{
  const sku=clean(r[map.sku]);if(!sku){val.push({severity:'danger',type:'Missing SKU',message:`Row ${r.__sourceRow||i+2} has no product code.`});return}
  if(seen.has(sku)){val.push({severity:'danger',type:'Duplicate SKU',message:`SKU ${sku} appears more than once in the file; the first occurrence was used.`});return}seen.add(sku);
  const q=coerce(r[map.systemQty],true),c=coerce(r[map.cost]),p=map.price?coerce(r[map.price]):{value:0,blank:true,invalid:false},issues=[];
  if(q.blank)blank.systemQty++;if(c.blank)blank.cost++;if(map.price&&p.blank)blank.price++;
  if(q.invalid){issues.push('System quantity');val.push({severity:'warning',type:'Invalid system quantity',message:`${sku}: system quantity is not a number; it was set to 0.`})}
  if(c.invalid){issues.push('Unit cost');val.push({severity:'warning',type:'Invalid unit cost',message:`${sku}: unit cost is not a valid non-negative number; it was set to 0.`})}
  if(p.invalid){issues.push('Selling price');val.push({severity:'warning',type:'Invalid selling price',message:`${sku}: selling price is not a valid non-negative number; it was set to 0.`})}
  if(q.value<0)val.push({severity:'warning',type:'Negative system stock',message:`${sku}: system quantity is negative (${number(q.value)}). Check the posting history.`});
  let counted=false,phys=0;
  if(map.physicalQty){const ph=coerce(r[map.physicalQty]);
   if(ph.invalid){issues.push('Physical quantity');val.push({severity:'warning',type:'Invalid physical quantity',message:`${sku}: physical quantity is not a valid non-negative number and was ignored (item left as not counted).`})}
   else if(ph.blank){if(blankIsUncounted)blankUnc++;else{counted=true;blankPhys++}}
   else{counted=true;phys=ph.value}}
  out.push({sku,name:map.name?clean(r[map.name]):sku,category:(map.category&&clean(r[map.category]))||'Uncategorised',unit:map.unit?clean(r[map.unit]):'',systemQty:q.value,cost:c.value,price:p.value,expiry:map.expiry?isoDate(r[map.expiry]):'',issues,sourceRow:r.__sourceRow,
   physicalQty:counted?phys:null,counted,sheetQty:counted?phys:0,baseCounted:counted,countRows:counted?1:0,counter:map.counter?clean(r[map.counter]):'',countNotes:map.notes?clean(r[map.notes]):''});
 });
 const nm=new Map();out.forEach(r=>{const k=nameKey(r.name);if(!k||k===nameKey(r.sku))return;if(!nm.has(k))nm.set(k,[]);nm.get(k).push(r)});
 nm.forEach(rs=>{if(rs.length>1)val.push({severity:'warning',type:'Duplicate product name',message:`“${rs[0].name}” is used by ${rs.length} SKUs (${rs.slice(0,6).map(r=>r.sku).join(', ')}${rs.length>6?', …':''}). Check these are different products so stock is not counted twice.`})});
 [['systemQty','system quantities'],['cost','unit costs'],['price','selling prices']].forEach(([k,l])=>{if(blank[k])val.push({severity:'info',type:'Blank treated as zero',message:`${blank[k].toLocaleString()} blank ${l} were treated as 0.`})});
 if(!map.price)val.push({severity:'info',type:'Blank treated as zero',message:'No selling-price column was mapped; all selling prices are 0 and sales values will show GH₵0.00.'});
 if(!map.physicalQty)val.push({severity:'warning',type:'No physical quantity column',message:'No physical-quantity column was mapped, so every item is “Not counted”. Use Manual count entry to record counts, or map the column and read the file again.'});
 if(blankPhys)val.push({severity:'info',type:'Blank treated as zero',message:`${blankPhys.toLocaleString()} blank physical quantities were treated as a counted quantity of 0.`});
 if(blankUnc)val.push({severity:'info',type:'Left uncounted',message:`${blankUnc.toLocaleString()} blank physical quantities were left as not counted.`});
 state.importStats={blankInventory:blank.systemQty+blank.cost+blank.price,blankCounts:blankPhys};
 const prevM=new Map(state.inventory.filter(r=>(r.manual||[]).length).map(r=>[r.sku,r.manual])),draft=prevM.size?null:readManualDraft();let restored=0;
 out.forEach(r=>{const m=prevM.get(r.sku)||(draft&&draft[r.sku]);if(m&&m.length){r.manual=m.map(e=>({...e}));restored++}});
 Object.assign(state,{inventory:out,invVal:val,inventoryFileName:$('inventoryFileName').textContent,countBySku:new Map(),countLoaded:false,unmatched:[],cntVal:[],countFileName:''});
 applyCounts();reconcile();refreshValidation();
 const cnt=state.rows.filter(r=>r.physicalValid).length;
 $('inventoryImportStatus').className='import-status success';$('inventoryImportStatus').textContent=`Imported ${out.length.toLocaleString()} items (${cnt.toLocaleString()} counted). ${val.filter(v=>v.severity!=='info').length} warnings, ${state.importStats.blankInventory+blankPhys} blank values set to 0.`;
 setNotice(`<strong>Stock file loaded:</strong> ${out.length.toLocaleString()} items from ${esc(state.inventoryFileName)}; ${cnt.toLocaleString()} counted. Review the dashboard and exceptions.`);
 toast(`Stock file imported: ${out.length} items.${restored?` Restored manual entries for ${restored} items.`:''}`);renderAll();
}
function applyCounts(){
 /* physical = quantity in the stock file + manual entries; recounts (adjusted) override. */
 state.inventory=state.inventory.map(r=>{
  if(r.adjusted)return r;
  const man=r.manual||[];
  if(!man.length)return r.sheetQty===undefined?r:{...r,physicalQty:r.baseCounted?r.sheetQty:null,counted:!!r.baseCounted,assumedZero:false};
  const sq=n0(r.sheetQty);return {...r,sheetQty:sq,physicalQty:sq+man.reduce((t,e)=>t+e.qty,0),counted:true,assumedZero:false};
 });
}

/* ---------- reconciliation ---------- */
function reconcile(){
 const today=new Date().toISOString().slice(0,10),soon=new Date(Date.now()+state.settings.expiryDays*864e5).toISOString().slice(0,10);
 state.rows=state.inventory.map(r=>{
  const sys=n0(r.systemQty),cost=n0(r.cost),price=n0(r.price),counted=!!r.counted,phys=counted?n0(r.physicalQty):null;
  const variance=counted?sys-phys:null,costVariance=counted?money(variance*cost):null,salesVariance=counted?money(variance*price):null;
  const status=!counted?'uncounted':variance>0?'shortage':variance<0?'surplus':'match';
  const basis=Math.max(counted?phys:sys,0),base=r.expiryBase!==undefined?r.expiryBase:(r.expiry||''),man=r.manual||[],dated=man.filter(e=>e.expiry&&e.qty>0),datedQty=dated.reduce((t,e)=>t+e.qty,0);
  const groups=[...dated.map(e=>({q:e.qty,d:e.expiry})),{q:Math.max(basis-datedQty,0),d:base}].filter(g=>g.d),expQty=groups.filter(g=>g.d<today).reduce((t,g)=>t+g.q,0),soonQty=groups.filter(g=>g.d>=today&&g.d<=soon).reduce((t,g)=>t+g.q,0);
  const expiryShow=groups.map(g=>g.d).sort()[0]||base,expiryStatus=!expiryShow?'':groups.some(g=>g.d<today)?'expired':groups.some(g=>g.d<=soon)?'soon':'ok';
  return {...r,systemQty:sys,cost,price,physicalQty:phys,systemCost:money(sys*cost),systemSales:money(sys*price),
   physicalCost:counted?money(phys*cost):null,physicalSales:counted?money(phys*price):null,variance,costVariance,salesVariance,
   shortageCost:counted?money(Math.max(variance,0)*cost):null,surplusCost:counted?money(Math.max(-variance,0)*cost):null,
   shortageSales:counted?money(Math.max(variance,0)*price):null,surplusSales:counted?money(Math.max(-variance,0)*price):null,
   estimatedGrossProfit:counted?money(phys*(price-cost)):null,status,physicalValid:counted,systemValid:true,costValid:true,priceValid:true,
   hasIssue:(r.issues||[]).length>0,expGroups:groups,expiryBase:base,expiry:expiryShow,expiryStatus,expiredQty:expQty,soonQty,expiredCost:money(expQty*cost),soonCost:money(soonQty*cost),expiryCost:money((expQty+soonQty)*cost),manualQty:man.reduce((t,e)=>t+e.qty,0),manualCount:man.length};
 });
}
function summary(rows=state.rows){
 const sum=(a,k)=>money(a.reduce((t,r)=>t+(r[k]||0),0)),counted=rows.filter(r=>r.physicalValid),varRows=counted.filter(r=>r.variance!==0);
 const systemCost=sum(rows,'systemCost'),systemSales=sum(rows,'systemSales'),countedSystemCost=sum(counted,'systemCost'),physicalCost=sum(counted,'physicalCost'),salesValue=sum(counted,'physicalSales');
 const shortageCost=sum(counted,'shortageCost'),surplusCost=sum(counted,'surplusCost'),shortageSales=sum(counted,'shortageSales'),surplusSales=sum(counted,'surplusSales');
 const exp=rows.filter(r=>r.expiredQty>0),soon=rows.filter(r=>r.soonQty>0);
 return {items:rows.length,counted:counted.length,matched:counted.length,varianceLines:varRows.length,systemCost,systemSales,countedSystemCost,physicalCost,physicalSales:salesValue,salesValue,
  shortageCost,surplusCost,shortageSales,surplusSales,netCost:money(shortageCost-surplusCost),netSales:money(shortageSales-surplusSales),grossProfit:sum(counted,'estimatedGrossProfit'),
  netQty:counted.reduce((a,r)=>a+r.variance,0),grossQty:counted.reduce((a,r)=>a+Math.abs(r.variance),0),
  completion:rows.length?counted.length/rows.length*100:0,costWeightedAccuracy:countedSystemCost>0?Math.max(0,Math.min(100,(1-(shortageCost+surplusCost)/countedSystemCost)*100)):null,
  varianceRate:counted.length?varRows.length/counted.length*100:0,zeroVariance:counted.length-varRows.length,uncounted:rows.length-counted.length,exceptions:rows.filter(r=>r.hasIssue).length,
  expiredItems:exp.length,expiredCost:sum(exp,'expiredCost'),expiringItems:soon.length,expiringCost:sum(soon,'soonCost'),recounted:rows.filter(r=>r.adjusted).length,manualLines:rows.filter(r=>r.manualCount>0).length,assumedZero:rows.filter(r=>r.assumedZero).length};
}
function categoryStats(){
 const m=new Map();
 state.rows.forEach(r=>{const c=r.category||'Uncategorised';if(!m.has(c))m.set(c,[]);m.get(c).push(r)});
 return [...m.entries()].map(([category,rows])=>{const s=summary(rows);return {category,items:rows.length,counted:s.counted,systemCost:s.systemCost,systemSales:s.systemSales,physicalCost:s.physicalCost,physicalSales:s.physicalSales,shortageCost:s.shortageCost,surplusCost:s.surplusCost,shortageSales:s.shortageSales,surplusSales:s.surplusSales,netCost:s.netCost,netSales:s.netSales,varianceLines:s.varianceLines,accuracy:s.costWeightedAccuracy}}).sort((a,b)=>(b.shortageCost+b.surplusCost)-(a.shortageCost+a.surplusCost));
}
function makeAlerts(){
 const s=summary(),al=[],hv=state.settings.highValue;
 if(!state.rows.length)return al;
 if(s.uncounted)al.push({level:'warning',icon:'!',key:'uncounted',title:`${pl(s.uncounted,'item')} not counted`,detail:'Uncounted lines are excluded from physical and variance totals. Complete the count or formally waive these items.'});
 if(s.assumedZero)al.push({level:'warning',icon:'!',key:'assumed',title:`${pl(s.assumedZero,'missing item')} valued at zero`,detail:'Counted at 0 because they were absent from the count.'});
 if(s.exceptions)al.push({level:'danger',icon:'×',key:'exceptions',title:`${pl(s.exceptions,'data exception')}`,detail:'Some source values were not valid numbers and were set to 0. See Import & validation.'});
 if(s.shortageCost>0)al.push({level:'danger',icon:'↓',key:'shortage',title:`${currency(s.shortageCost)} gross shortage exposure`,detail:`Equivalent to ${currency(s.shortageSales)} of potential sales value. Review high-value lines, recount and document causes.`});
 if(s.surplusCost>0)al.push({level:'warning',icon:'↑',key:'surplus',title:`${currency(s.surplusCost)} gross surplus value`,detail:'Check receiving, returns, transfers, product-code errors and posting cut-off.'});
 const hi=state.rows.filter(r=>r.status==='shortage'&&r.costVariance>=hv&&hv>0).sort((a,b)=>b.costVariance-a.costVariance);
 if(hi.length)al.push({level:'danger',icon:'!',key:'highvalue',title:`${pl(hi.length,'high-value shortage line')}`,detail:`Largest: ${hi[0].name} (${currency(hi[0].costVariance)}). Threshold: ${currency(hv)} per line.`});
 if(s.expiredItems)al.push({level:'danger',icon:'⏱',key:'expired',title:`${pl(s.expiredItems,'expired item')} (${currency(s.expiredCost)} at cost)`,detail:'Quarantine and write off or return expired stock according to policy.'});
 if(s.expiringItems)al.push({level:'warning',icon:'⏱',key:'expiring',title:`${pl(s.expiringItems,'item')} ${s.expiringItems===1?'expires':'expire'} within ${state.settings.expiryDays} days (${currency(s.expiringCost)})`,detail:'Prioritise sale, transfer or supplier return before expiry.'});
 const neg=state.rows.filter(r=>r.systemQty<0).length;if(neg)al.push({level:'warning',icon:'!',key:'negative',title:`${pl(neg,'item')} with negative system stock`,detail:'Negative balances usually indicate unposted receipts or sales posted before receiving.'});
 if(s.recounted)al.push({level:'warning',icon:'✎',key:'recounted',title:`${pl(s.recounted,'line')} recounted manually`,detail:'Counts were edited in the reconciliation table. Keep the recount sheets as evidence.'});
 if(s.manualLines)al.push({level:'warning',icon:'✎',key:'manual',title:`${pl(s.manualLines,'line')} include manual entries`,detail:'Some counts were keyed in on the Manual count page. Keep the source count records as evidence.'});
 if(!s.uncounted&&!s.exceptions&&s.varianceLines===0)al.push({level:'good',icon:'✓',title:'All counted lines reconcile',detail:'No quantity differences detected in the counted inventory lines.'});
 return al;
}

/* ---------- rendering ---------- */
const sgn=(n,good='negative',bad='positive')=>n>0?bad:n<0?good:'';
/* ---------- animated dashboard ---------- */
const reduceMotion=()=>!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
const FMT={cur:v=>currency(v),curp:v=>(v>0?'+':'')+currency(v),int:v=>Math.round(v).toLocaleString('en-GH'),pct:v=>v.toFixed(1)+'%',pct0:v=>Math.round(v)+'%'};
const cnt=(v,f,extra='')=>`data-count="${Number.isFinite(+v)?+v:0}" data-fmt="${f}" ${extra}`;
const dashActive=()=>$('view-dashboard').classList.contains('active');
let tickerTimer=null;
function runCounters(root,animate){
 root.querySelectorAll('[data-count]').forEach((el,i)=>{
  const to=+el.dataset.count,f=FMT[el.dataset.fmt]||FMT.int;el.textContent=f(to);
  if(!animate||reduceMotion())return;
  const dur=1150+Math.min(i,10)*45,t0=performance.now()+(+el.dataset.delay||0)+(i%7)*45;el.textContent=f(0);
  const step=now=>{const t=Math.min(Math.max((now-t0)/dur,0),1),e=t>=1?1:1-Math.pow(2,-10*t);el.textContent=f(to*e);if(t<1)requestAnimationFrame(step)};requestAnimationFrame(step);
 });
}
function ringHtml(p,label,id,c1,c2,delay){
 const C=+(2*Math.PI*52).toFixed(2),na=p===null||p===undefined,v=na?0:Math.min(Math.max(+p,0),100),t=+(C*(1-v/100)).toFixed(2);
 return `<div class="ring" style="--delay:${delay}ms"><svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="rg${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><circle class="ring-bg" cx="60" cy="60" r="52"/><circle class="ring-fg" cx="60" cy="60" r="52" stroke="url(#rg${id})" style="--c:${C};--t:${t}"/></svg><div class="ring-val">${na?'<b>N/A</b>':`<b ${cnt(v,'pct0')}>${Math.round(v)}%</b>`}<small>${label}</small></div></div>`;
}
function startTicker(items){
 const ic=$('tkIc'),tx=$('tkTxt'),dots=$('tkDots');if(!ic||!items.length)return;let i=0;
 dots.innerHTML=items.map((_,k)=>`<i class="${k?'':'on'}"></i>`).join('');
 const show=k=>{const it=items[k];ic.textContent=it.icon;ic.className='tk-ic '+(it.level||'');tx.textContent=it.title;dots.querySelectorAll('i').forEach((d,j)=>d.classList.toggle('on',j===k))};
 show(0);if(items.length<2||reduceMotion())return;
 tickerTimer=setInterval(()=>{const t=$('ticker');if(!t||!dashActive())return;t.classList.add('out');setTimeout(()=>{i=(i+1)%items.length;show(i);t.classList.remove('out')},300)},4200);
}
function renderHero(s,has){
 const hero=$('hero');clearInterval(tickerTimer);
 if(!has){
  hero.className='hero hero-empty rise';
  hero.innerHTML=`<div class="hero-main"><span class="eyebrow-light">WELCOME TO STOCKWISE</span><h2 class="hero-title">Reconcile your stock in minutes</h2><p class="hero-sub">Upload <b>one stock file</b> with system and physical quantities. StockWise calculates variances, value at risk and expiry exposure, and builds management reports instantly.</p><div class="hero-actions"><button class="btn btn-glass primary" data-go="imports">↑ Import stock file</button><button class="btn btn-glass" data-demo>Explore with demo data</button></div></div>
  <svg class="hero-art" viewBox="0 0 320 230" aria-hidden="true"><g class="fl a"><rect x="24" y="52" width="150" height="104" rx="16" fill="rgba(255,255,255,.13)" stroke="rgba(255,255,255,.35)"/><rect x="44" y="116" width="16" height="24" rx="4" fill="#7dd3fc"/><rect x="70" y="98" width="16" height="42" rx="4" fill="#34d399"/><rect x="96" y="84" width="16" height="56" rx="4" fill="#fcd34d"/><rect x="122" y="106" width="16" height="34" rx="4" fill="#fb923c"/></g><g class="fl b"><rect x="168" y="96" width="124" height="96" rx="16" fill="rgba(255,255,255,.16)" stroke="rgba(255,255,255,.38)"/><circle cx="230" cy="144" r="26" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="10"/><circle cx="230" cy="144" r="26" fill="none" stroke="#34d399" stroke-width="10" stroke-dasharray="110 164" transform="rotate(-90 230 144)" stroke-linecap="round"/></g><g class="fl c"><rect x="196" y="22" width="96" height="34" rx="17" fill="#fff"/><circle cx="214" cy="39" r="7" fill="#16a37f"/><rect x="228" y="33" width="50" height="6" rx="3" fill="#cbd5e3"/><rect x="228" y="42" width="34" height="5" rx="2.5" fill="#e3e9f2"/></g></svg>`;
  return;
 }
 hero.className='hero rise';
 let head,sub;
 if(!s.counted){head='No items counted yet';sub=`${number(s.items)} items are loaded. Add physical quantities to the stock file, or record counts on the Manual count page.`}
 else if(s.netCost>0){head=`Net shortage of <em ${cnt(s.netCost,'cur')}>${currency(s.netCost)}</em> at cost`;sub=`${s.varianceLines===1?'1 counted line differs':number(s.varianceLines)+' counted lines differ'} from the system, worth ${currency(s.netSales)} at selling price.`}
 else if(s.netCost<0){head=`Net surplus of <em ${cnt(-s.netCost,'cur')}>${currency(-s.netCost)}</em> at cost`;sub=`${s.varianceLines===1?'1 counted line differs':number(s.varianceLines)+' counted lines differ'} from the system, worth ${currency(-s.netSales)} at selling price.`}
 else{head='Your counted stock reconciles';sub=s.varianceLines?`Shortages and surpluses across ${number(s.varianceLines)} lines cancel out at cost.`:`All ${number(s.counted)} counted lines match the system quantities.`}
 hero.innerHTML=`<div class="hero-main"><span class="eyebrow-light">STOCK HEALTH · ${esc(monthLabel(state.period)).toUpperCase()} <i class="live"></i> <span class="live-t">LIVE</span></span><h2 class="hero-title">${head}</h2><p class="hero-sub">${sub}</p>
  <div class="ticker" id="ticker" aria-live="polite"><span class="tk-ic" id="tkIc"></span><span class="tk-txt" id="tkTxt"></span><span class="tk-dots" id="tkDots"></span></div>
  <div class="hero-actions"><button class="btn btn-glass primary" data-go="variances">Variance report →</button><button class="btn btn-glass" data-go="reports">Export reports</button><button class="btn btn-glass" data-go="manual">Manual count</button></div></div>
  <div class="hero-rings">${ringHtml(s.costWeightedAccuracy,'Cost accuracy',1,'#7dd3fc','#34d399',0)}${ringHtml(s.completion,'Items counted',2,'#a5b4fc','#60a5fa',160)}${ringHtml(s.counted?s.zeroVariance/s.counted*100:null,'Lines matched',3,'#fde68a','#fb923c',320)}</div>`;
 const ins=makeAlerts();startTicker(ins.length?ins:[{icon:'✓',level:'good',title:'No alerts: everything looks healthy'}]);
}
const bar2=(a,b,la)=>`<div class="gbar"><i class="s1" style="--w:${a}%"></i><i class="s2" style="--w:${b}%"></i></div><div class="gbar-l">${la}</div>`;
function renderGroups(s){
 const cov=s.systemCost>0?s.countedSystemCost/s.systemCost*100:0,onh=s.countedSystemCost>0?s.physicalCost/s.countedSystemCost*100:0,gross=s.shortageCost+s.surplusCost,sh=gross>0?s.shortageCost/gross*100:0,su=gross>0?100-sh:0;
 const card=(i,cls,ic,ico,t,sub,ms,bar)=>`<article class="group-card spot rise ${cls}" style="--i:${i}"><header><div><h2>${t}</h2><p>${sub}</p></div><span class="kpi-icon ${ico}">${ic}</span></header>${ms.map(m=>`<div class="metric"><span>${m.l}</span><strong ${m.id?`id="${m.id}"`:''} class="big ${m.c||''}" ${cnt(m.v,'cur')}>${currency(m.v)}</strong><small>${m.s}</small></div>`).join('')}${bar}</article>`;
 $('groupGrid').innerHTML=
  card(1,'g-system','▤','blue','System stock',`Per stock file · ${number(s.items)} items`,[{l:'Stock cost',v:s.systemCost,id:'sysCost',s:'All items valued at unit cost'},{l:'Potential sales value',v:s.systemSales,id:'sysSales',s:'System qty × selling price'}],bar2(cov,0,`${cov.toFixed(0)}% of system value has been counted`))+
  card(2,'g-physical','▣','teal','Physical stock',`Per physical count · ${number(s.counted)} of ${number(s.items)} counted`,[{l:'Stock cost',v:s.physicalCost,id:'phyCost',s:`Counted items only · system value of the same items ${currency(s.countedSystemCost)}`},{l:'Potential sales value',v:s.physicalSales,id:'phySales',s:'Physical qty × selling price'}],bar2(Math.min(onh,100),0,`${onh.toFixed(0)}% of the counted system value is on hand`))+
  card(3,'g-variance','⇅','red','Variance','System − physical · positive = net shortage',[{l:'Net cost variance',v:s.netCost,id:'varCost',c:sgn(s.netCost),s:`Shortage ${currency(s.shortageCost)} · Surplus ${currency(s.surplusCost)}`},{l:'Net sales value variance',v:s.netSales,id:'varSales',c:sgn(s.netSales),s:`Shortage ${currency(s.shortageSales)} · Surplus ${currency(s.surplusSales)}`}],bar2(sh,su,gross>0?`Shortage ${sh.toFixed(0)}% · Surplus ${su.toFixed(0)}% of gross variance`:'No variance at cost'));
 const gp=s.physicalSales>0?s.grossProfit/s.physicalSales*100:null;
 const mini=(i,o)=>`<article class="mini-kpi spot rise ${o.go?'clickable':''}" ${o.go?`data-go="${o.go}" role="link" tabindex="0" aria-label="${o.aria}"`:''} ${o.id?`id="${o.id}"`:''} style="--i:${i}"><span>${o.l}${o.go?'<i class="tile-cta">View report →</i>':''}</span><strong ${o.sid?`id="${o.sid}"`:''} ${cnt(o.v,o.f)}></strong>${o.prog!==undefined?`<div class="progress"><i style="--w:${o.prog}%"></i></div>`:''}<small>${o.s}</small></article>`;
 $('miniGrid').innerHTML=
  mini(4,{l:'Count completion',v:s.completion,f:'pct',prog:s.completion,s:`${number(s.counted)} of ${number(s.items)} items counted`})+
  mini(5,{l:'Lines with variances',v:s.varianceLines,f:'int',go:'variances',id:'tileVariance',sid:'kpiVarianceLines',aria:'Open the lines with variances report',s:`of ${number(s.counted)} counted items · open full report`})+
  mini(6,{l:'Expired / expiring stock at cost',v:s.expiredCost+s.expiringCost,f:'cur',s:`${s.expiredItems} expired · ${s.expiringItems} expiring within ${state.settings.expiryDays} days`})+
  mini(7,{l:'Estimated gross profit (physical)',v:s.grossProfit,f:'cur',s:gp===null?'No selling prices yet':`${gp.toFixed(1)}% margin on counted stock`});
}
function bridgeHtml(s){
 const S=s.systemCost,U=Math.max(S-s.countedSystemCost,0),sh=s.shortageCost,su=s.surplusCost,P=s.physicalCost;
 if(S<=0&&P<=0)return '<div class="empty-state">No stock cost to chart yet.</div>';
 const lvl=[S,S-U,S-U-sh,S-U-sh+su],max=Math.max(...lvl,P,1)*1.06,W=760,H=268,padL=14,top=38,base=H-54,hh=base-top,y=v=>base-Math.max(v,0)/max*hh,n=5,cw=(W-2*padL)/n,bw=cw*.58;
 const bars=[{l:'System stock',s:`${number(s.items)} items`,lo:0,hi:S,v:S,c:'#2463eb',f:'cur'},{l:'Not counted',s:`${number(s.uncounted)} items`,lo:S-U,hi:S,v:-U,c:'#9aa8bd',f:'cur'},{l:'Shortage',s:`${pl(state.rows.filter(r=>r.variance>0).length,'line')}`,lo:S-U-sh,hi:S-U,v:-sh,c:'#d84a57',f:'cur'},{l:'Surplus',s:`${pl(state.rows.filter(r=>r.variance<0).length,'line')}`,lo:S-U-sh,hi:S-U-sh+su,v:su,c:'#16a37f',f:'curp'},{l:'Physical stock',s:`${number(s.counted)} counted`,lo:0,hi:P,v:P,c:'#0f8b7d',f:'cur'}];
 const ends=[S,S-U,S-U-sh,P];let g='',x0=i=>padL+i*cw+(cw-bw)/2;
 for(let k=0;k<=4;k++){const yy=base-hh*k/4;g+=`<line x1="${padL}" x2="${W-padL}" y1="${yy}" y2="${yy}" class="wf-grid"/>`}
 bars.forEach((b,i)=>{const x=x0(i),yt=y(b.hi),hgt=Math.max(y(b.lo)-yt,2.5),d=i*130;
  g+=`<g class="wf-bar" style="--d:${d}ms"><rect x="${x}" y="${yt}" width="${bw}" height="${hgt}" rx="7" fill="${b.c}"/><rect x="${x}" y="${yt}" width="${bw}" height="${Math.min(hgt,10)}" rx="7" fill="#fff" opacity=".16"/></g>`;
  g+=`<text class="wf-val" x="${x+bw/2}" y="${yt-9}" text-anchor="middle" style="--d:${d+500}ms" fill="${b.c==='#9aa8bd'?'#6b7a90':b.c}" ${cnt(b.v,b.f)}>${FMT[b.f](b.v)}</text><text class="wf-lab" x="${x+bw/2}" y="${base+19}" text-anchor="middle">${b.l}</text><text class="wf-sub" x="${x+bw/2}" y="${base+34}" text-anchor="middle">${b.s}</text>`;
  if(i<4){const yy=y(ends[i]);g+=`<line class="wf-conn" x1="${x+bw}" x2="${x0(i+1)}" y1="${yy}" y2="${yy}" style="--d:${d+300}ms"/>`}});
 return `<div class="bridge-wrap"><svg viewBox="0 0 ${W} ${H}" class="bridge" role="img" aria-label="Stock value bridge from system cost to physical cost">${g}</svg></div>`;
}
function mixHtml(s){
 const items=s.items;if(!items)return '<div class="empty-state">No items yet.</div>';
 const sh=state.rows.filter(r=>r.variance>0).length,su=state.rows.filter(r=>r.variance<0).length,segs=[{k:'zero',l:'Matched',n:s.zeroVariance,c:'#16a37f'},{k:'shortage',l:'Shortage',n:sh,c:'#d84a57'},{k:'surplus',l:'Surplus',n:su,c:'#2463eb'},{k:'uncounted',l:'Not counted',n:s.uncounted,c:'#c3cddd'}];
 const R=62,C=+(2*Math.PI*R).toFixed(2);let off=0,arcs='';const live=segs.filter(x=>x.n>0);
 segs.forEach((sg,i)=>{if(!sg.n)return;const len=sg.n/items*C,gap=live.length>1?Math.min(3,len*.3):0;arcs+=`<circle class="donut-seg" cx="80" cy="80" r="${R}" stroke="${sg.c}" style="--C:${C};stroke-dasharray:${Math.max(len-gap,.5).toFixed(2)} ${(C-Math.max(len-gap,.5)).toFixed(2)};stroke-dashoffset:${(-off).toFixed(2)};--d:${i*160}ms"/>`;off+=len});
 return `<div class="mix"><div class="donut"><svg viewBox="0 0 160 160" aria-hidden="true"><circle class="donut-bg" cx="80" cy="80" r="${R}"/>${arcs}</svg><div class="donut-c"><b ${cnt(items,'int')}>${number(items)}</b><small>items</small></div></div>
 <ul class="legend">${segs.map(sg=>`<li><button data-filter="${sg.k}" ${sg.n?'':'disabled'}><i style="background:${sg.c}"></i><span>${sg.l}</span><b ${cnt(sg.n,'int')}>${number(sg.n)}</b><em>${(sg.n/items*100).toFixed(0)}%</em></button></li>`).join('')}</ul></div>`;
}
function expiryHtml(){
 const today=new Date().toISOString().slice(0,10),B=[{l:'Expired',c:'#d84a57',v:0,s:new Set()},{l:'Next 30 days',c:'#f08a24',v:0,s:new Set()},{l:'31–90 days',c:'#e8b02f',v:0,s:new Set()},{l:'Later than 90 days',c:'#16a37f',v:0,s:new Set()}];let any=false;
 state.rows.forEach(r=>(r.expGroups||[]).forEach(g=>{if(!(g.q>0))return;any=true;const days=Math.round((new Date(g.d+'T12:00:00')-new Date(today+'T12:00:00'))/864e5),b=days<0?0:days<=30?1:days<=90?2:3;B[b].v+=g.q*r.cost;B[b].s.add(r.sku)}));
 if(!any)return '<div class="empty-state">No expiry dates in the stock file, or none with stock on hand.</div>';
 const max=Math.max(...B.map(b=>b.v),1);
 return B.map((b,i)=>`<div class="rad" style="--d:${i*120}ms"><div class="rad-h"><span><i style="background:${b.c}"></i>${b.l}</span><small>${pl(b.s.size,'item')}</small><b ${cnt(money(b.v),'cur')}>${currency(b.v)}</b></div><div class="rad-t"><i style="--w:${(b.v/max*100).toFixed(1)}%;background:${b.c}"></i></div></div>`).join('')+(B[0].s.size?`<button class="link-btn rad-link" data-alertfilter="expired">View expired items (${B[0].s.size}) →</button>`:'');
}
function leaderHtml(){
 const top=state.rows.filter(r=>r.variance>0&&r.costVariance>0).sort((a,b)=>b.costVariance-a.costVariance).slice(0,5);
 if(!top.length)return '<div class="empty-state">No shortage lines. Every counted item is at or above its system quantity.</div>';
 const max=top[0].costVariance;
 return top.map((r,i)=>`<div class="lead" style="--d:${i*110}ms"><span class="lead-n">${i+1}</span><div class="lead-b"><div class="lead-h"><strong>${esc(r.name)}</strong><b ${cnt(r.costVariance,'cur')}>${currency(r.costVariance)}</b></div><div class="lead-t"><i style="--w:${(r.costVariance/max*100).toFixed(1)}%"></i></div><small>${esc(r.sku)} · ${esc(r.category||'Uncategorised')} · short by ${number(r.variance)}</small></div></div>`).join('');
}
function renderDashboard(animate=false){
 const s=summary(),has=state.rows.length>0,d=$('dash');
 d.classList.toggle('no-data',!has);if(!d.classList.contains('play'))d.classList.add('play');
 $('dataNotice').classList.add('hidden');
 renderHero(s,has);
 if(has){
  renderGroups(s);$('bridge').innerHTML=bridgeHtml(s);$('mix').innerHTML=mixHtml(s);$('expiryRadar').innerHTML=expiryHtml();$('leaders').innerHTML=leaderHtml();
  const alerts=makeAlerts();$('alertCount').textContent=`${alerts.length} alert${alerts.length===1?'':'s'}`;
  $('alertsList').innerHTML=alerts.length?alerts.map((al,idx)=>{const k=al.key,n=k?alertCount(k):0,fm=[['csv','CSV'],['xlsx','Excel'],['pdf','PDF']];return `<div class="alert-item rise ${al.level}" style="--i:${idx+2}"><div class="alert-icon ${al.level==='danger'?'danger pulse':al.level==='good'?'good':''}">${al.icon}</div><div class="alert-body"><strong>${esc(al.title)}</strong><p>${esc(al.detail)}</p>${k?`<div class="alert-actions"><button class="link-btn" data-alert-view="${k}">View items (${n}) →</button><details class="menu"><summary class="link-btn">⤓ Export ▾</summary><div class="menu-pop">${fm.map(f=>`<button data-alert-export="${k}" data-fmt="${f[0]}">${f[1]}</button>`).join('')}</div></details></div>`:''}</div></div>`}).join(''):'<div class="empty-state">No alerts. Everything looks healthy.</div>';
  const top=state.rows.filter(r=>r.variance!==null&&r.variance!==0).sort((a,b)=>Math.abs(b.costVariance)-Math.abs(a.costVariance)).slice(0,8),mx=Math.max(...top.map(r=>Math.abs(r.costVariance)),1);
  $('topVarianceBody').innerHTML=top.length?top.map(r=>`<tr><td class="prod">${esc(r.name)}</td><td class="muted-cell">${esc(r.sku)}</td><td class="num">${number(r.systemQty)}</td><td class="num">${number(r.physicalQty)}</td><td class="num ${sgn(r.variance)}">${signed(r.variance)}</td><td class="num dbar-cell ${sgn(r.costVariance)}" style="--w:${(Math.abs(r.costVariance)/mx*100).toFixed(1)}"><span>${currency(r.costVariance)}</span></td><td class="num ${sgn(r.salesVariance)}">${currency(r.salesVariance)}</td><td>${statusPill(r.status)}</td></tr>`).join(''):'<tr><td colspan="8" class="empty-cell">No reconciled discrepancies to display.</td></tr>';
  renderChart();renderReportPreview();
 }
 runCounters(d,!!animate);
}
function playDashboard(){const d=$('dash');d.classList.remove('play');void d.offsetWidth;d.classList.add('play');renderDashboard(true)}
function bindDash(){
 const d=$('dash');
 d.addEventListener('click',e=>{
  const g=e.target.closest('[data-go]');if(g&&!e.target.closest('details')){go(g.dataset.go);return}
  if(e.target.closest('[data-demo]')){loadSample();return}
  const f=e.target.closest('[data-filter]');if(f&&!f.disabled){state.alertFilter=null;$('tableSearch').value='';$('categoryFilter').value='all';$('varianceFilter').value=f.dataset.filter;go('stocktake');renderTable();return}
  const a=e.target.closest('[data-alertfilter]');if(a)applyAlertFilter(a.dataset.alertfilter);
 });
 d.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[data-go][tabindex]')){e.preventDefault();go(e.target.dataset.go)}});
 d.addEventListener('mousemove',e=>{const c=e.target.closest('.spot');if(!c)return;const r=c.getBoundingClientRect();c.style.setProperty('--mx',(e.clientX-r.left)+'px');c.style.setProperty('--my',(e.clientY-r.top)+'px')});
}

function chartGrad(ctx,c1,c2){const a=ctx.chart.chartArea;if(!a)return c2;const g=ctx.chart.ctx.createLinearGradient(a.left,0,a.right,0);g.addColorStop(0,c1);g.addColorStop(1,c2);return g}
function renderChart(){
 const sales=state.chartMetric==='sales',cats=categoryStats().filter(c=>c.counted>0).slice(0,8),empty=!cats.length;
 document.querySelectorAll('[data-metric]').forEach(b=>b.classList.toggle('active',b.dataset.metric===state.chartMetric));
 $('chartEmpty').style.display=empty?'flex':'none';
 if(state.categoryChart){state.categoryChart.destroy();state.categoryChart=null}
 if(empty||!window.Chart)return;
 const sh=c=>money(sales?c.shortageSales:c.shortageCost),su=c=>money(sales?c.surplusSales:c.surplusCost);
 state.categoryChart=new Chart($('categoryChart'),{type:'bar',data:{labels:cats.map(c=>c.category),datasets:[{label:sales?'Shortage sales value':'Shortage cost',data:cats.map(sh),backgroundColor:ctx=>chartGrad(ctx,'#ef8b94','#c63845'),borderRadius:6},{label:sales?'Surplus sales value':'Surplus cost',data:cats.map(su),backgroundColor:ctx=>chartGrad(ctx,'#6fd1b0','#16805d'),borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',animation:{duration:1100,easing:'easeOutQuart',delay:c=>c.type==='data'?c.dataIndex*90+c.datasetIndex*60:0},plugins:{legend:{position:'bottom',labels:{boxWidth:9,usePointStyle:true,font:{size:10}}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${currency(c.raw)}`}}},scales:{x:{beginAtZero:true,grid:{color:'#eef1f5'},ticks:{font:{size:9},callback:v=>'GH₵'+Number(v).toLocaleString()}},y:{grid:{display:false},ticks:{font:{size:10}}}}}});
}
function statusPill(status){const map={shortage:['Shortage','status-shortage'],surplus:['Surplus','status-surplus'],match:['Matched','status-match'],uncounted:['Not counted','status-uncounted'],exception:['Exception','status-exception']};const v=map[status]||map.exception;return `<span class="status ${v[1]}">${v[0]}</span>`}
const expiryPill=r=>r.expiryStatus==='expired'?'<span class="status status-shortage">Expired</span>':r.expiryStatus==='soon'?'<span class="status status-uncounted">Expiring</span>':'';
function renderValidation(){
 const real=state.validation.filter(v=>v.severity!=='info'),info=state.validation.length-real.length;
 const unc=state.rows.filter(r=>!r.physicalValid).length,variance=state.rows.filter(r=>r.variance!==null&&r.variance!==0).length,exc=state.rows.filter(r=>r.hasIssue).length;
 const cards=[['Inventory items',state.inventory.length,'Rows in the stock file',''],['Counted items',state.rows.filter(r=>r.physicalValid).length,'With a physical quantity',''],['Not counted',unc,'No physical quantity yet',unc?'warning':''],['Data exceptions',exc,'Non-numeric values set to 0',exc?'danger':''],['Variance lines',variance,'Counted items with a quantity difference',variance?'warning':''],['Blank cells set to 0',state.importStats.blankInventory+state.importStats.blankCounts,'System qty, cost, price, physical qty',''],['Warnings',real.length,'Validation messages needing review',real.length?'warning':''],['Manual-entry lines',state.rows.filter(r=>r.manualCount>0).length,'Counts keyed in by hand','']];
 const order={danger:0,warning:1,info:2},list=[...state.validation].sort((a,b)=>order[a.severity]-order[b.severity]);
 $('validationSummary').innerHTML=cards.map(c=>`<div class="validation-card ${c[3]}"><strong>${number(c[1])}</strong><span>${esc(c[0])}<br>${esc(c[2])}</span></div>`).join('')+(list.length?`<div class="validation-detail"><strong>Validation messages</strong><ul>${list.slice(0,30).map(v=>`<li class="sev-${v.severity}"><b>${esc(v.type)}:</b> ${esc(v.message)}</li>`).join('')}</ul>${list.length>30?`<small>Showing 30 of ${list.length} messages (${info} informational). The full list is in the Excel workbook.</small>`:''}</div>`:'<div class="validation-detail success-text">No import warnings recorded.</div>');
}
function sortVal(r,k){const v=r[k];return typeof v==='string'?v.toLowerCase():v}
function renderTable(){
 const q=clean($('tableSearch').value).toLowerCase(),f=$('varianceFilter').value,cat=$('categoryFilter').value,so=state.sort;
 const af=state.alertFilter&&ALERTS[state.alertFilter]&&ALERTS[state.alertFilter].test?ALERTS[state.alertFilter]:null;
 let rows=state.rows.filter(r=>{
  const t=!q||r.sku.toLowerCase().includes(q)||r.name.toLowerCase().includes(q);
  const m=f==='all'||(f==='shortage'&&r.status==='shortage')||(f==='surplus'&&r.status==='surplus')||(f==='zero'&&r.status==='match')||(f==='uncounted'&&r.status==='uncounted')||(f==='exceptions'&&r.hasIssue)||(f==='expiry'&&(r.expiryStatus==='expired'||r.expiryStatus==='soon'))||(f==='adjusted'&&r.adjusted);
  return t&&m&&(cat==='all'||r.category===cat)&&(!af||af.test(r))});
 if(so.key)rows=[...rows].sort((a,b)=>{const x=sortVal(a,so.key),y=sortVal(b,so.key);if(x===null||x===undefined||x==='')return 1;if(y===null||y===undefined||y==='')return -1;return (x<y?-1:x>y?1:0)*(so.dir==='asc'?1:-1)});
 state.viewRows=rows;renderAlertBar();
 document.querySelectorAll('#reconciliationTable th[data-sort]').forEach(th=>th.dataset.dir=th.dataset.sort===so.key?so.dir:'');
 const tc=money(rows.reduce((a,r)=>a+(r.costVariance||0),0)),ts=money(rows.reduce((a,r)=>a+(r.salesVariance||0),0));
 $('tableCount').textContent=`${rows.length.toLocaleString()} items`;$('tableFooterText').textContent=`Showing ${rows.length.toLocaleString()} of ${state.rows.length.toLocaleString()} items · Cost variance ${currency(tc)} · Sales variance ${currency(ts)}`;
 const shown=rows.slice(0,1500);
 $('reconciliationBody').innerHTML=rows.length?shown.map(r=>`<tr><td class="sku-cell"><strong>${esc(r.name)}</strong><small>${esc(r.sku)}</small></td><td>${esc(r.category||'Uncategorised')}</td><td class="num">${number(r.systemQty)}</td><td class="num recount-cell"><input class="recount ${r.adjusted?'edited':''}" type="number" step="any" min="0" value="${r.physicalValid?r.physicalQty:''}" placeholder="—" data-recount="${esc(r.sku)}" title="${r.assumedZero?'Not on the count sheet; assumed 0. ':''}Type a new count and press Enter" aria-label="Physical quantity for ${esc(r.sku)}">${r.adjusted?`<button class="icon-mini" data-reset="${esc(r.sku)}" title="Restore imported count">↺</button>`:''}</td><td class="num ${sgn(r.variance||0)}">${r.variance===null?'—':signed(r.variance)}</td><td class="num">${currency(r.cost)}</td><td class="num">${currency(r.price)}</td><td class="num ${sgn(r.costVariance||0)}">${r.costVariance===null?'—':currency(r.costVariance)}</td><td class="num ${sgn(r.salesVariance||0)}">${r.salesVariance===null?'—':currency(r.salesVariance)}</td><td>${r.expiry?showDate(r.expiry):'—'} ${expiryPill(r)}</td><td>${statusPill(r.status)}${r.manualCount?` <span class="status status-match" title="${r.manualCount} manual entr${r.manualCount===1?'y':'ies'} (${number(r.manualQty)} units)">Manual</span>`:''}${r.hasIssue?` <span class="status status-exception" title="${esc(r.issues.join(', '))}: not a valid number (set to 0, or ignored for the physical count)">Data issue</span>`:''}</td></tr>`).join('')+(rows.length>shown.length?`<tr><td colspan="11" class="empty-cell">Showing the first ${shown.length.toLocaleString()} rows. Use search or filters to narrow down; exports contain every row.</td></tr>`:''):`<tr><td colspan="11" class="empty-cell">${state.rows.length?'No items match the selected filters.':'Import your stock file to begin.'}</td></tr>`;
 const cats=[...new Set(state.rows.map(r=>r.category||'Uncategorised'))].sort(),sel=$('categoryFilter'),cur=sel.value;sel.innerHTML='<option value="all">All categories</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');sel.value=cats.includes(cur)?cur:'all';
}
function recount(sku,val){
 const i=state.inventory.findIndex(r=>r.sku===sku);if(i<0)return;
 if(clean(val)===''){resetRecount(sku);return}
 const q=Number(val);if(!Number.isFinite(q)||q<0){toast('Enter a quantity of zero or more.',true);renderTable();return}
 const r={...state.inventory[i]};if(!r.adjusted)r.orig={physicalQty:r.physicalQty,counted:!!r.counted};
 Object.assign(r,{adjusted:true,physicalQty:q,counted:true,assumedZero:false});state.inventory[i]=r;reconcile();renderAll();toast(`Recount saved for ${sku}.`);
}
function resetRecount(sku){
 const i=state.inventory.findIndex(r=>r.sku===sku);if(i<0)return;const r={...state.inventory[i]};
 if(r.orig){r.physicalQty=r.orig.physicalQty;r.counted=r.orig.counted}
 delete r.adjusted;delete r.orig;state.inventory[i]=r;applyCounts();reconcile();renderAll();
}
function renderReportPreview(){
 const s=summary(),v=[['System stock cost',currency(s.systemCost)],['System potential sales value',currency(s.systemSales)],['Physical stock cost',currency(s.physicalCost)],['Physical potential sales value',currency(s.physicalSales)],['Net cost variance',currency(s.netCost)],['Net sales value variance',currency(s.netSales)],['Gross shortage exposure',currency(s.shortageCost)],['Gross surplus value',currency(s.surplusCost)],['Count completion',s.completion.toFixed(1)+'%'],['Cost-weighted accuracy',pct(s.costWeightedAccuracy)],['Items with variances',number(s.varianceLines)],['Expiry exposure at cost',currency(s.expiredCost+s.expiringCost)]];
 $('reportPreview').innerHTML=v.map(x=>`<div class="preview-stat"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong></div>`).join('');
}
function renderHistory(){
 const h=[...state.history].sort((a,b)=>b.period.localeCompare(a.period));$('historyCount').textContent=h.length;$('historyLatest').textContent=h.length?monthLabel(h[0].period):'—';$('historyShortage').textContent=h.length?currency(h[0].summary?.shortageCost||0):'—';
 $('historyBody').innerHTML=h.length?h.map(x=>`<tr><td><strong>${esc(monthLabel(x.period))}</strong></td><td>${esc(new Date(x.savedAt).toLocaleString())}</td><td class="num">${number(x.rows?.length||0)}</td><td class="num positive">${currency(x.summary?.shortageCost||0)}</td><td class="num negative">${currency(x.summary?.surplusCost||0)}</td><td class="num ${sgn(x.summary?.netCost||0)}">${currency(x.summary?.netCost||0)}</td><td><button class="btn btn-secondary" data-load-history="${esc(x.period)}">Load</button> <button class="btn btn-quiet" data-delete-history="${esc(x.period)}">Delete</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty-cell">No saved periods yet. Save a snapshot after importing and reviewing a stocktake.</td></tr>';
 renderCompare();renderTrend();
}
function renderCompare(){
 const el=$('historyCompare'),sorted=[...state.history].sort((a,b)=>a.period.localeCompare(b.period));
 const cur=state.rows.length?{period:state.period,summary:summary()}:sorted[sorted.length-1],prev=cur?[...sorted].reverse().find(x=>x.period<cur.period):null;
 if(!cur||!prev){el.innerHTML='<div class="empty-state">Save two or more periods to compare month-on-month movement.</div>';return}
 const a=cur.summary||{},b=prev.summary||{};
 const defs=[['System stock cost','systemCost','m'],['Physical stock cost','physicalCost','m'],['Net cost variance','netCost','m','lower'],['Gross shortage exposure','shortageCost','m','lower'],['Gross surplus value','surplusCost','m','lower'],['Count completion','completion','p','higher'],['Cost-weighted accuracy','costWeightedAccuracy','p','higher']];
 el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Metric</th><th>${esc(monthLabel(cur.period))}</th><th>${esc(monthLabel(prev.period))}</th><th>Change</th></tr></thead><tbody>${defs.map(([l,k,t,dir])=>{const x=n0(a[k]),y=n0(b[k]),d=x-y,f=v=>t==='m'?currency(v):v.toFixed(1)+'%',good=!dir||Math.abs(d)<0.005?'':(dir==='lower'?d<0:d>0)?'negative':'positive';return `<tr><td>${l}</td><td class="num">${f(x)}</td><td class="num">${f(y)}</td><td class="num ${good}">${d>0?'+':''}${t==='m'?currency(d):d.toFixed(1)+' pts'}</td></tr>`}).join('')}</tbody></table></div>`;
}
function renderTrend(){
 const h=[...state.history].sort((a,b)=>a.period.localeCompare(b.period)).slice(-12);
 if(state.trendChart){state.trendChart.destroy();state.trendChart=null}
 $('trendEmpty').style.display=h.length?'none':'flex';if(!h.length||!window.Chart)return;
 state.trendChart=new Chart($('historyChart'),{type:'bar',data:{labels:h.map(x=>monthLabel(x.period)),datasets:[{label:'Shortage cost',data:h.map(x=>n0(x.summary?.shortageCost)),backgroundColor:'#d84a57',borderRadius:4},{label:'Surplus cost',data:h.map(x=>n0(x.summary?.surplusCost)),backgroundColor:'#2e9b78',borderRadius:4},{type:'line',label:'Net cost variance',data:h.map(x=>n0(x.summary?.netCost)),borderColor:'#142c4e',backgroundColor:'#142c4e',tension:.25}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:9,usePointStyle:true,font:{size:10}}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${currency(c.raw)}`}}},scales:{y:{grid:{color:'#eef1f5'},ticks:{font:{size:9},callback:v=>'GH₵'+Number(v).toLocaleString()}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
}
function renderAll(){$('periodInput').value=state.period;$('blankPhysicalToggle').checked=!!state.settings.blankUncounted;renderDashboard(dashActive());renderTable();renderValidation();renderHistory();renderVariances();renderManual();renderAlertSelect();updateFileButtons();persist()}
function go(view){try{localStorage.setItem('stockwise_view',view)}catch{}document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));const titles={dashboard:['Management dashboard','Your monthly stock position, reconciled and ready for review.'],stocktake:['Stock reconciliation','Review system quantities, physical counts and variances. Counts can be edited in the table.'],imports:['Import & validation','Upload one stock file with system and physical quantities.'],reports:['Reports & exports','Generate consistent management reports from the current reconciliation.'],variances:['Lines with variances','Every counted line where system and physical quantities differ.'],manual:['Manual count entry','Search the system inventory and record counts and expiry dates by hand.'],history:['Monthly history','Save completed periods and compare stocktaking results over time.']};$('pageTitle').textContent=titles[view][0];$('pageSubtitle').textContent=titles[view][1];if(view==='history')renderHistory();if(view==='dashboard')playDashboard();if(view==='manual'&&state.inventory.length)setTimeout(()=>$('mcSearch').focus(),50)}

/* ---------- exports ---------- */
function reportRows(rows=state.rows){return rows.map(r=>({'SKU':r.sku,'Product':r.name,'Category':r.category,'Unit':r.unit,'System Quantity':r.systemQty,'Physical Quantity':r.physicalValid?r.physicalQty:null,'Variance Qty (System - Physical)':r.variance,'Unit Cost (GH₵)':r.cost,'Unit Selling Price (GH₵)':r.price,'System Cost Value (GH₵)':r.systemCost,'System Sales Value (GH₵)':r.systemSales,'Physical Cost Value (GH₵)':r.physicalCost,'Physical Sales Value (GH₵)':r.physicalSales,'Cost Variance (GH₵)':r.costVariance,'Sales Value Variance (GH₵)':r.salesVariance,'Shortage Cost (GH₵)':r.shortageCost,'Surplus Cost (GH₵)':r.surplusCost,'Status':r.status,'Expiry':r.expiry,'Expiry Status':r.expiryStatus,'Counted By':r.counter||'','Count Notes':r.countNotes||'','Manual Entry Qty':r.manualCount?r.manualQty:'','Recounted':r.adjusted?'Yes':''}))}
function exportCsv(ev,rowsIn,fname){if(!state.rows.length)return toast('No reconciliation data to export.',true);const rows=rowsIn||reportRows(),headers=Object.keys(rows[0]);const csv=[headers,...rows.map(r=>headers.map(h=>r[h]===null||r[h]===undefined?'':r[h]))].map(row=>row.map(v=>{const s=String(v??'');return /[,"\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join(',')).join('\r\n');downloadBlob('\ufeff'+csv,fname||`StockWise_Reconciliation_${state.period}.csv`,'text/csv;charset=utf-8;')}
function downloadBlob(content,name,type){const blob=content instanceof Blob?content:new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
const findings=()=>{const a=makeAlerts();return a.length?a:[{level:'good',title:'No findings',detail:'No alerts were generated for this stocktake.'}]};
function chartImage(cats){
 if(!window.Chart||!cats.length)return null;
 try{const c=document.createElement('canvas');c.width=1300;c.height=560;const ch=new Chart(c,{type:'bar',data:{labels:cats.map(x=>x.category),datasets:[{label:'Shortage cost',data:cats.map(x=>x.shortageCost),backgroundColor:'#c63845'},{label:'Surplus cost',data:cats.map(x=>x.surplusCost),backgroundColor:'#16805d'}]},options:{animation:false,responsive:false,devicePixelRatio:1,plugins:{legend:{position:'bottom',labels:{font:{size:18}}},title:{display:true,text:'Variance by category (cost)',font:{size:24}}},scales:{x:{ticks:{font:{size:16}}},y:{ticks:{font:{size:16},callback:v=>'GH₵'+Number(v).toLocaleString()}}}}});const url=c.toDataURL('image/png');ch.destroy();return url}catch(e){return null}
}

function xlKit(title){
 const s=summary(),st=state.settings,wb=new ExcelJS.Workbook(),ARGB=h=>'FF'+h,FILL=c=>({type:'pattern',pattern:'solid',fgColor:{argb:ARGB(c)}});
 wb.creator=st.preparedBy||'StockWise';wb.company=st.company||'';wb.created=new Date();wb.title=title;wb.calcProperties={fullCalcOnLoad:true};
 const CUR='"GH₵"#,##0.00;-"GH₵"#,##0.00',intQty=state.rows.every(r=>Number.isInteger(r.systemQty)&&(r.physicalQty===null||Number.isInteger(r.physicalQty))),QTY=intQty?'#,##0;-#,##0':'#,##0.00;-#,##0.00',PCT='0.0"%"';
 const NAVY='142C4E',NAVY2='24436A',MUTED='68778C',INK='1E2D41',BAND='F7F9FC',LINE='D5DEEA';
 const put=(ws,addr,v,o={})=>{const c=ws.getCell(addr);c.value=v;c.font={name:'Calibri',size:o.size||10,bold:!!o.bold,italic:!!o.italic,color:{argb:ARGB(o.color||INK)}};if(o.fill)c.fill=FILL(o.fill);c.alignment={vertical:'middle',horizontal:o.h||'left',wrapText:!!o.wrap,indent:o.indent||0};if(o.fmt)c.numFmt=o.fmt;if(o.border)c.border=o.border;return c};
 const page=(ws,ncols)=>{ws.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.4,right:.4,top:.6,bottom:.6,header:.3,footer:.3}};ws.headerFooter={oddFooter:`&L&8StockWise · ${monthLabel(state.period)}&R&8Page &P of &N`}};
 const band=(ws,last,title,sub)=>{ws.mergeCells(`A1:${last}1`);ws.mergeCells(`A2:${last}2`);put(ws,'A1',title,{size:18,bold:true,color:'FFFFFF',fill:NAVY,indent:1});put(ws,'A2',sub,{size:10,color:'C5D2E5',fill:NAVY2,indent:1});ws.getRow(1).height=34;ws.getRow(2).height=20;ws.getRow(3).height=8};
 const sub=`${st.company?st.company+'  ·  ':''}${monthLabel(state.period)}  ·  Generated ${new Date().toLocaleString('en-GB')}`;
 const colL=n=>{let r='';while(n>0){const m=(n-1)%26;r=String.fromCharCode(65+m)+r;n=Math.floor((n-1)/26)}return r};
 /* ---- generic table sheet ---- */
 const tableSheet=(name,title,subtitle,tab,cols,data,opt={})=>{
  const w=wb.addWorksheet(name,{views:[{showGridLines:false,state:'frozen',ySplit:4,xSplit:opt.freezeX||0}],properties:{tabColor:{argb:ARGB(tab)}}});page(w);const last=colL(cols.length);
  cols.forEach((c,i)=>w.getColumn(i+1).width=c.w);band(w,last,title,subtitle);
  cols.forEach((c,i)=>{put(w,`${colL(i+1)}4`,c.h,{bold:true,color:'FFFFFF',fill:NAVY,size:10,h:c.num?'right':'left',wrap:true,indent:1})});w.getRow(4).height=34;
  if(!data.length){w.mergeCells(`A5:${last}5`);put(w,'A5','No records in this category.',{italic:true,color:MUTED,indent:1});w.getRow(5).height=26;return w}
  data.forEach((d,i)=>{const rr=5+i,row=w.getRow(rr);row.height=18;cols.forEach((c,j)=>{const cell=row.getCell(j+1),val=c.v(d,i);cell.value=c.f?{formula:c.f(rr),result:val===null||val===undefined?'':val}:(val===undefined?null:val);cell.font={name:'Calibri',size:10,bold:!!c.bold,color:{argb:ARGB(c.muted?MUTED:(c.bold?NAVY:INK))}};cell.alignment={vertical:'middle',horizontal:c.num?'right':(c.center?'center':'left'),indent:c.num?0:1};if(c.fmt)cell.numFmt=c.fmt;if(i%2)cell.fill=FILL(BAND);cell.border={bottom:{style:'hair',color:{argb:ARGB(LINE)}}}})});
  const lastRow=4+data.length;
  cols.forEach((c,j)=>{const L=colL(j+1);if(c.cf==='var')w.addConditionalFormatting({ref:`${L}5:${L}${lastRow}`,rules:[{type:'cellIs',operator:'greaterThan',formulae:[0],style:{font:{bold:true,color:{argb:ARGB('C63845')}}}},{type:'cellIs',operator:'lessThan',formulae:[0],style:{font:{bold:true,color:{argb:ARGB('16805D')}}}}]});
   if(c.cf==='status')w.addConditionalFormatting({ref:`${L}5:${L}${lastRow}`,rules:[['Shortage','FFF0F1','C63845'],['Surplus','E9F8F1','16805D'],['Not counted','FFF5DC','9A6500'],['Expired','FFF0F1','C63845'],['Expiring','FFF5DC','9A6500']].map(([t,bg,fg])=>({type:'cellIs',operator:'equal',formulae:[`"${t}"`],style:{font:{bold:true,color:{argb:ARGB(fg)}},fill:{type:'pattern',pattern:'solid',bgColor:{argb:ARGB(bg)}}}}))})});
  if(cols.some(c=>c.sum)){const tr=lastRow+1;w.getRow(tr).height=22;cols.forEach((c,j)=>{const L=colL(j+1),cell=w.getCell(`${L}${tr}`);if(j===0)cell.value='Total (visible rows)';else if(c.sum){cell.value={formula:`SUBTOTAL(109,${L}5:${L}${lastRow})`,result:data.reduce((a,d,i)=>a+n0(c.v(d,i)),0)};cell.numFmt=c.fmt||'#,##0'}cell.font={name:'Calibri',size:10,bold:true,color:{argb:ARGB(NAVY)}};cell.fill=FILL('E3ECFA');cell.alignment={vertical:'middle',horizontal:c.num?'right':'left',indent:c.num?0:1};cell.border={top:{style:'medium',color:{argb:ARGB(NAVY)}}}})}
  w.autoFilter={from:{row:4,column:1},to:{row:lastRow,column:cols.length}};return w};
 const txt=(h,k,w,o={})=>({h,w,v:d=>d[k]??'',...o}),num=(h,k,w,fmt,o={})=>({h,w,fmt,num:true,v:d=>d[k]===undefined?null:d[k],...o});
 return {s,st,wb,ARGB,FILL,CUR,QTY,PCT,NAVY,NAVY2,MUTED,INK,BAND,LINE,put,page,band,sub,colL,tableSheet,txt,num};
}
async function exportExcel(){
 if(!state.rows.length)return toast('Import and reconcile data before exporting.',true);
 if(!window.ExcelJS)return toast('Excel export library could not load. Check your internet connection.',true);
 toast('Building Excel workbook…');
 const {s,st,wb,ARGB,FILL,CUR,QTY,PCT,NAVY,NAVY2,MUTED,INK,BAND,LINE,put,page,band,sub,colL,tableSheet,txt,num}=xlKit(`Stocktaking report ${monthLabel(state.period)}`);
 /* ---- Executive summary ---- */
 const ws=wb.addWorksheet('Executive Summary',{views:[{showGridLines:false}],properties:{tabColor:{argb:ARGB(NAVY)}}});page(ws);ws.pageSetup.fitToHeight=1;
 [2,32,24,3,32,24,3,32,24,2].forEach((w,i)=>ws.getColumn(i+1).width=w);band(ws,'J','StockWise  |  Stocktaking report',sub);
 [['B','C','Stock file',state.inventoryFileName||'Not recorded','H','Prepared by',st.preparedBy||'—'],['B','C','Physical counts',`${number(s.counted)} items${s.manualLines?` · ${s.manualLines} with manual entries`:''}`,'H','Reviewed by',st.reviewedBy||'—'],['B','C','Items counted',`${number(s.counted)} of ${number(s.items)} (${s.completion.toFixed(1)}%)`,'H','Period',monthLabel(state.period)]].forEach((m,i)=>{const r=4+i;put(ws,`B${r}`,m[2],{size:9,bold:true,color:MUTED});ws.mergeCells(`C${r}:E${r}`);put(ws,`C${r}`,m[3]);put(ws,`H${r}`,m[5],{size:9,bold:true,color:MUTED});put(ws,`I${r}`,m[6])});
 const block=(c1,c2,title,color,items)=>{ws.mergeCells(`${c1}8:${c2}8`);put(ws,`${c1}8`,title,{bold:true,color:'FFFFFF',fill:color,size:11,indent:1});ws.getRow(8).height=22;
  items.forEach((it,i)=>{const r=9+i*3;ws.mergeCells(`${c1}${r}:${c2}${r}`);put(ws,`${c1}${r}`,it.label,{size:9,bold:true,color:MUTED,fill:BAND,indent:1});ws.mergeCells(`${c1}${r+1}:${c2}${r+1}`);put(ws,`${c1}${r+1}`,it.value,{size:18,bold:true,color:it.color||NAVY,fill:BAND,fmt:CUR,indent:1});ws.getRow(r+1).height=30;ws.mergeCells(`${c1}${r+2}:${c2}${r+2}`);put(ws,`${c1}${r+2}`,it.sub,{size:8.5,italic:true,color:MUTED,fill:BAND,indent:1,wrap:true});ws.getRow(r+2).height=24})};
 const vc=n=>n>0?'C63845':n<0?'16805D':NAVY;
 block('B','C','1 · System stock','2463EB',[{label:'Stock cost',value:s.systemCost,sub:`All ${number(s.items)} items valued at unit cost`},{label:'Potential sales value',value:s.systemSales,sub:'System quantity × selling price'}]);
 block('E','F','2 · Physical stock','0F8B7D',[{label:'Stock cost',value:s.physicalCost,sub:`${number(s.counted)} of ${number(s.items)} items counted`},{label:'Potential sales value',value:s.physicalSales,sub:'Physical quantity × selling price'}]);
 block('H','I','3 · Variance (system − physical)','C63845',[{label:'Net cost variance',value:s.netCost,color:vc(s.netCost),sub:`Shortage ${currency(s.shortageCost)} · Surplus ${currency(s.surplusCost)}`},{label:'Net sales value variance',value:s.netSales,color:vc(s.netSales),sub:`Shortage ${currency(s.shortageSales)} · Surplus ${currency(s.surplusSales)}`}]);
 const mini=(c1,c2,r,l,v,f)=>{ws.mergeCells(`${c1}${r}:${c2}${r}`);put(ws,`${c1}${r}`,l,{size:9,bold:true,color:MUTED,fill:'EEF3FA',indent:1});ws.mergeCells(`${c1}${r+1}:${c2}${r+1}`);put(ws,`${c1}${r+1}`,v,{size:14,bold:true,fill:'EEF3FA',fmt:f,indent:1,h:'left',color:NAVY});ws.getRow(r+1).height=24};
 mini('B','C',16,'Count completion',s.completion,PCT);mini('E','F',16,'Cost-weighted accuracy',s.costWeightedAccuracy===null?'N/A':s.costWeightedAccuracy,PCT);mini('H','I',16,'Lines with variances',s.varianceLines,'#,##0');
 mini('B','C',19,'Estimated gross profit (physical)',s.grossProfit,CUR);mini('E','F',19,'Expired / expiring stock at cost',s.expiredCost+s.expiringCost,CUR);mini('H','I',19,'Items not counted',s.uncounted,'#,##0');
 ws.mergeCells('B22:I22');put(ws,'B22','Key findings',{size:12,bold:true,color:NAVY,border:{bottom:{style:'medium',color:{argb:ARGB('2463EB')}}}});ws.getRow(22).height=22;
 let r=23;findings().slice(0,7).forEach(f=>{ws.mergeCells(`B${r}:I${r}`);const col=f.level==='danger'?'C63845':f.level==='good'?'16805D':'9A6500';const c=ws.getCell(`B${r}`);c.value={richText:[{text:'●  ',font:{name:'Calibri',size:10,color:{argb:ARGB(col)}}},{text:f.title+'. ',font:{name:'Calibri',size:10,bold:true,color:{argb:ARGB(INK)}}},{text:f.detail,font:{name:'Calibri',size:10,color:{argb:ARGB(MUTED)}}}]};c.alignment={vertical:'middle',wrapText:true};ws.getRow(r).height=30;r++});
 r++;ws.mergeCells(`B${r}:I${r}`);put(ws,`B${r}`,'Method and limitations',{size:12,bold:true,color:NAVY,border:{bottom:{style:'medium',color:{argb:ARGB('2463EB')}}}});r++;
 ws.mergeCells(`B${r}:I${r}`);put(ws,`B${r}`,'Variance = system quantity − physical quantity; positive values are shortages and negative values are surpluses. Blank system quantities, costs and prices are treated as 0, and a blank physical quantity is a counted quantity of 0 unless the stock file was read with the “blank means not counted” option. Products absent from the count sheet remain “not counted” unless the assume-zero setting was enabled. Potential sales value uses imported selling prices and is an estimate, not realised revenue or a confirmed accounting loss.',{size:9,color:MUTED,wrap:true});ws.getRow(r).height=52;r+=2;
 [['B','C','Prepared by',st.preparedBy],['E','F','Reviewed by',st.reviewedBy],['H','I','Approved by','']].forEach(([a,b,l,n])=>{ws.mergeCells(`${a}${r}:${b}${r}`);put(ws,`${a}${r}`,n||' ',{size:11,border:{bottom:{style:'thin',color:{argb:ARGB(MUTED)}}}});ws.mergeCells(`${a}${r+1}:${b}${r+1}`);put(ws,`${a}${r+1}`,`${l} · signature and date`,{size:8.5,color:MUTED})});ws.getRow(r).height=34;
 /* ---- reconciliation (live formulas) ---- */
 const stl={shortage:'Shortage',surplus:'Surplus',match:'Matched',uncounted:'Not counted',exception:'Exception'};
 const hasP=d=>d.physicalValid;
 const rc=[txt('Product','name',34,{bold:true}),txt('SKU','sku',16,{muted:true}),txt('Category','category',18),txt('Unit','unit',10),num('System qty','systemQty',12,QTY,{sum:true}),{...num('Physical qty','physicalQty',12,QTY,{sum:true}),v:d=>hasP(d)?d.physicalQty:null},
  {...num('Variance qty (system − physical)','variance',16,QTY,{cf:'var',sum:true}),f:r=>`IF(F${r}="","",E${r}-F${r})`},num('Unit cost','cost',14,CUR),num('Unit price','price',14,CUR),
  {...num('System cost','systemCost',16,CUR,{sum:true}),f:r=>`E${r}*H${r}`},{...num('System sales value','systemSales',16,CUR,{sum:true}),f:r=>`E${r}*I${r}`},
  {...num('Physical cost','physicalCost',16,CUR,{sum:true}),f:r=>`IF(F${r}="","",F${r}*H${r})`},{...num('Physical sales value','physicalSales',16,CUR,{sum:true}),f:r=>`IF(F${r}="","",F${r}*I${r})`},
  {...num('Cost variance','costVariance',16,CUR,{cf:'var',sum:true}),f:r=>`IF(F${r}="","",G${r}*H${r})`},{...num('Sales value variance','salesVariance',16,CUR,{cf:'var',sum:true}),f:r=>`IF(F${r}="","",G${r}*I${r})`},
  {h:'Status',w:14,cf:'status',v:d=>stl[d.status]||d.status},{h:'Expiry',w:14,v:d=>d.expiry?showDate(d.expiry):''},{h:'Expiry status',w:13,cf:'status',v:d=>d.expiryStatus==='expired'?'Expired':d.expiryStatus==='soon'?'Expiring':''},{h:'Count notes',w:26,v:d=>d.countNotes||''}];
 tableSheet('Reconciliation','Stock reconciliation',`${sub}  ·  Edit “Physical qty” and the variance columns recalculate`,'2463EB',rc,state.rows,{freezeX:2});
 /* ---- ranked lists ---- */
 const rank=(rows,key)=>[...rows].sort((a,b)=>Math.abs(b[key])-Math.abs(a[key]));
 const vcols=[{h:'#',w:6,center:true,v:(d,i)=>i+1},txt('Product','name',34,{bold:true}),txt('SKU','sku',16,{muted:true}),txt('Category','category',18),num('System qty','systemQty',12,QTY),num('Physical qty','physicalQty',12,QTY),num('Variance qty','variance',13,QTY,{cf:'var',sum:true}),num('Unit cost','cost',14,CUR),num('Cost variance','costVariance',16,CUR,{cf:'var',sum:true}),num('Sales value variance','salesVariance',18,CUR,{cf:'var',sum:true})];
 tableSheet('Shortages','Shortages ranked by cost',sub,'C63845',vcols,rank(state.rows.filter(r=>r.status==='shortage'),'costVariance'));
 tableSheet('Surpluses','Surpluses ranked by cost',sub,'16805D',vcols,rank(state.rows.filter(r=>r.status==='surplus'),'costVariance'));
 tableSheet('Not Counted','Items not counted',sub,'9A6500',[txt('Product','name',36,{bold:true}),txt('SKU','sku',16,{muted:true}),txt('Category','category',20),num('System qty','systemQty',13,QTY,{sum:true}),num('Unit cost','cost',14,CUR),num('System cost','systemCost',16,CUR,{sum:true}),num('System sales value','systemSales',18,CUR,{sum:true})],state.rows.filter(r=>r.status==='uncounted'));
 tableSheet('Manual Entries','Manual count entries',sub,'2463EB',[{h:'Entered',w:18,v:e=>new Date(e.at).toLocaleString('en-GB')},txt('Product','name',36,{bold:true}),txt('SKU','sku',16,{muted:true}),num('Quantity','qty',12,QTY,{sum:true}),{h:'Expiry date',w:15,v:e=>e.expiry?showDate(e.expiry):''},txt('Counted by','by',18),txt('Notes','notes',36)],state.inventory.flatMap(r=>(r.manual||[]).map(e=>({...e,sku:r.sku,name:r.name}))).sort((x,y)=>y.at.localeCompare(x.at)));
 tableSheet('Expiry Risk','Expired and expiring stock',`${sub}  ·  Window: ${st.expiryDays} days`,'B45309',[txt('Product','name',36,{bold:true}),txt('SKU','sku',16,{muted:true}),txt('Category','category',20),{h:'Expiry date',w:15,v:d=>showDate(d.expiry)},{h:'Status',w:13,cf:'status',v:d=>d.expiryStatus==='expired'?'Expired':'Expiring'},num('Quantity at risk','expiredQty',16,QTY,{v:d=>d.expiredQty+d.soonQty}),num('Cost at risk','expiryCost',16,CUR,{sum:true})],state.rows.filter(r=>r.expiryStatus==='expired'||r.expiryStatus==='soon').sort((a,b)=>a.expiry.localeCompare(b.expiry)));
 tableSheet('Data Exceptions','Data exceptions',sub,'6A42A5',[txt('Product','name',36,{bold:true}),txt('SKU','sku',18,{muted:true}),{h:'Issue',w:46,v:d=>d.issue}],[...state.rows.filter(r=>r.hasIssue).map(r=>({sku:r.sku,name:r.name,issue:`${r.issues.join(', ')}: not a valid number (set to 0, or ignored for the physical count)`})),...state.unmatched.map(u=>({sku:u.sku,name:'(not in inventory)',issue:`On count sheet only, quantity ${number(u.qty)}`}))]);
 /* ---- category analysis + chart ---- */
 const cats=categoryStats(),cs=tableSheet('Category Analysis','Category analysis',sub,'0F8B7D',[txt('Category','category',24),num('Items','items',9,'#,##0',{sum:true}),num('System cost','systemCost',16,CUR,{sum:true}),num('System sales value','systemSales',18,CUR,{sum:true}),num('Physical cost','physicalCost',16,CUR,{sum:true}),num('Physical sales value','physicalSales',18,CUR,{sum:true}),num('Shortage cost','shortageCost',16,CUR,{sum:true}),num('Surplus cost','surplusCost',16,CUR,{sum:true}),num('Net cost variance','netCost',16,CUR,{cf:'var',sum:true}),num('Net sales variance','netSales',16,CUR,{cf:'var',sum:true}),num('Variance lines','varianceLines',12,'#,##0',{sum:true}),{h:'Accuracy',w:11,num:true,fmt:PCT,v:d=>d.accuracy===null?null:Math.round(d.accuracy*10)/10}],cats);
 const img=chartImage(cats.filter(c=>c.counted>0).slice(0,8));if(img){const id=wb.addImage({base64:img,extension:'png'});cs.addImage(id,{tl:{col:0,row:cats.length+7},ext:{width:780,height:336}})}
 /* ---- validation ---- */
 const vw=tableSheet('Validation','Validation messages',sub,'64748B',[{h:'Severity',w:12,v:d=>d.severity},txt('Type','type',30),txt('Message','message',110)],state.validation);
 vw.addConditionalFormatting({ref:`A5:A${4+state.validation.length}`,rules:[['danger','C63845'],['warning','9A6500'],['info','2463EB']].map(([t,fg])=>({type:'cellIs',operator:'equal',formulae:[`"${t}"`],style:{font:{bold:true,color:{argb:ARGB(fg)}}}}))});
 const buf=await wb.xlsx.writeBuffer();downloadBlob(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`StockWise_Stocktake_${state.period}.xlsx`);toast('Excel management workbook generated.');
}

const FONT_BASE='https://cdn.jsdelivr.net/npm/@expo-google-fonts/inter@0.4.2/';let pdfFonts=null;
const toB64=buf=>{let s='';const b=new Uint8Array(buf);for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(s)};
async function loadPdfFonts(doc){
 /* jsPDF's built-in Helvetica cannot draw the cedi sign (₵ becomes “µ”), so a Unicode TrueType font is embedded. */
 try{
  if(!pdfFonts){const get=async p=>{const r=await fetch(FONT_BASE+p);if(!r.ok)throw new Error('Font download failed: '+p);return toB64(await r.arrayBuffer())};pdfFonts={reg:await get('400Regular/Inter_400Regular.ttf'),bold:await get('700Bold/Inter_700Bold.ttf')}}
  doc.addFileToVFS('Inter-Regular.ttf',pdfFonts.reg);doc.addFont('Inter-Regular.ttf','Inter','normal');doc.addFileToVFS('Inter-Bold.ttf',pdfFonts.bold);doc.addFont('Inter-Bold.ttf','Inter','bold');return 'Inter';
 }catch(e){console.warn(e);toast('Could not load the report font (internet needed). Using a fallback; currency will read “GHS”.',true);return 'helvetica'}
}
async function exportPdf(){
 if(!state.rows.length)return toast('Import and reconcile data before exporting.',true);
 if(!window.jspdf?.jsPDF)return toast('PDF library could not load. Check your internet connection.',true);
 toast('Preparing PDF report…');
 const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true}),F=await loadPdfFonts(doc);
 const cur=n=>F==='Inter'?currency(n):currency(n).replace('GH₵','GHS '),s=summary(),st=state.settings,W=297,H=210,M=14;
 const C={navy:[20,44,78],blue:[36,99,235],teal:[15,139,125],red:[198,56,69],green:[22,128,93],amber:[154,101,0],ink:[30,45,65],muted:[104,119,140],line:[225,232,241],bg:[247,249,252],white:[255,255,255]};
 const tx=(w,size,color)=>{doc.setFont(F,w);doc.setFontSize(size);doc.setTextColor(...color)};
 const vcol=n=>n>0?C.red:n<0?C.green:C.navy,sc=t=>String(t).startsWith('-')?C.green:/[1-9]/.test(String(t))?C.red:C.ink;
 const title=(y,t,sub)=>{tx('bold',12,C.navy);doc.text(t,M,y);if(sub){tx('normal',8,C.muted);doc.text(sub,W-M,y,{align:'right'})}doc.setDrawColor(...C.blue);doc.setLineWidth(.5);doc.line(M,y+2.5,M+14,y+2.5);doc.setDrawColor(...C.line);doc.setLineWidth(.2);doc.line(M+14,y+2.5,W-M,y+2.5)};
 /* page 1 header */
 doc.setFillColor(...C.navy);doc.rect(0,0,W,36,'F');doc.setFillColor(...C.blue);doc.rect(0,36,W,1.2,'F');
 doc.setFillColor(...C.white);doc.roundedRect(M,9,17,17,3.5,3.5,'F');tx('bold',17,C.navy);doc.text('S',M+8.5,21,{align:'center'});
 tx('bold',21,C.white);doc.text('Stocktaking report',M+23,17.5);tx('normal',10,[190,205,228]);doc.text(`${st.company?st.company+'  ·  ':''}${monthLabel(state.period)}`,M+23,25);
 tx('normal',8,[190,205,228]);[`Prepared by: ${st.preparedBy||'—'}`,`Reviewed by: ${st.reviewedBy||'—'}`,`Generated: ${new Date().toLocaleString('en-GB')}`].forEach((t,i)=>doc.text(t,W-M,14+i*5,{align:'right'}));
 tx('normal',8,C.muted);doc.text(doc.splitTextToSize(`Stock file: ${state.inventoryFileName||'Not recorded'}     Items: ${number(s.items)}     Counted: ${number(s.counted)} (${s.completion.toFixed(1)}%)`,W-2*M),M,44);
 /* KPI groups */
 const cw=(W-2*M-12)/3,card=(i,color,t,sub,items)=>{const x=M+i*(cw+6),y=50,h=56;doc.setDrawColor(...C.line);doc.setFillColor(...C.white);doc.roundedRect(x,y,cw,h,2,2,'FD');doc.setFillColor(...color);doc.rect(x,y,1.8,h,'F');
  tx('bold',10.5,color);doc.text(t,x+7,y+8);tx('normal',7.5,C.muted);doc.text(sub,x+7,y+13);
  items.forEach((it,k)=>{const yy=y+22+k*17;tx('bold',7,C.muted);doc.text(it.label.toUpperCase(),x+7,yy);tx('bold',15,it.color||C.navy);doc.text(cur(it.value),x+7,yy+7);tx('normal',6.8,C.muted);doc.text(doc.splitTextToSize(it.sub,cw-12)[0],x+7,yy+11.2)})};
 card(0,C.blue,'1 · System stock','Per inventory file',[{label:'Stock cost',value:s.systemCost,sub:`All ${number(s.items)} items at unit cost`},{label:'Potential sales value',value:s.systemSales,sub:'System qty × selling price'}]);
 card(1,C.teal,'2 · Physical stock','Per physical count',[{label:'Stock cost',value:s.physicalCost,sub:`${number(s.counted)} of ${number(s.items)} items counted`},{label:'Potential sales value',value:s.physicalSales,sub:'Physical qty × selling price'}]);
 card(2,C.red,'3 · Variance','System minus physical · positive = shortage',[{label:'Net cost variance',value:s.netCost,color:vcol(s.netCost),sub:`Shortage ${cur(s.shortageCost)} · Surplus ${cur(s.surplusCost)}`},{label:'Net sales value variance',value:s.netSales,color:vcol(s.netSales),sub:`Shortage ${cur(s.shortageSales)} · Surplus ${cur(s.surplusSales)}`}]);
 /* mini KPIs */
 const mw=(W-2*M-15)/4;[['Count completion',s.completion.toFixed(1)+'%',C.navy],['Cost-weighted accuracy',pct(s.costWeightedAccuracy),C.navy],['Lines with variances',`${number(s.varianceLines)} of ${number(s.counted)}`,C.navy],['Expired / expiring at cost',cur(s.expiredCost+s.expiringCost),s.expiredCost+s.expiringCost>0?C.amber:C.navy]].forEach((m,i)=>{const x=M+i*(mw+5);doc.setFillColor(...C.bg);doc.setDrawColor(...C.line);doc.roundedRect(x,112,mw,16,2,2,'FD');tx('normal',7,C.muted);doc.text(m[0],x+4,117.5);tx('bold',11.5,m[2]);doc.text(m[1],x+4,124.5)});
 /* findings */
 title(137,'Key findings');let y=146;const fw=150;
 for(const f of findings().slice(0,6)){const col=f.level==='danger'?C.red:f.level==='good'?C.green:C.amber,t=doc.splitTextToSize(f.title,fw-6),d=doc.splitTextToSize(f.detail,fw-6),hh=t.length*4+d.length*3.4+2.5;if(y+hh>196)break;
  doc.setFillColor(...col);doc.circle(M+1.5,y-1,1.1,'F');tx('bold',8.5,C.ink);doc.text(t,M+6,y);tx('normal',7.5,C.muted);doc.text(d,M+6,y+t.length*4);y+=hh+1.5}
 /* category chart (vector) */
 const cx=M+fw+12,cwid=W-M-cx,cats=categoryStats().filter(c=>c.counted>0).slice(0,6);tx('bold',9,C.navy);doc.text('Variance by category (cost)',cx,146);doc.setFillColor(...C.red);doc.rect(cx,148.6,2.6,2.6,'F');tx('normal',6.8,C.muted);doc.text('Shortage',cx+4,150.7);doc.setFillColor(...C.green);doc.rect(cx+20,148.6,2.6,2.6,'F');doc.text('Surplus',cx+24,150.7);
 if(cats.length){const max=Math.max(...cats.map(c=>Math.max(c.shortageCost,c.surplusCost)),1),bx=cx+34,bw=cwid-34-22;cats.forEach((c,i)=>{const yy=155+i*7.2;tx('normal',7.2,C.ink);doc.text(doc.splitTextToSize(c.category,32)[0],cx,yy+3.2);doc.setFillColor(...C.red);doc.rect(bx,yy,Math.max(c.shortageCost/max*bw,.3),2.8,'F');doc.setFillColor(...C.green);doc.rect(bx,yy+3.2,Math.max(c.surplusCost/max*bw,.3),2.8,'F');tx('normal',6.3,C.muted);doc.text(cur(c.shortageCost),bx+Math.max(c.shortageCost/max*bw,.3)+1.2,yy+2.4);doc.text(cur(c.surplusCost),bx+Math.max(c.surplusCost/max*bw,.3)+1.2,yy+5.6)});
  }else{tx('normal',8,C.muted);doc.text('No counted categories yet.',cx,156)}
 /* page 2: discrepancies + categories */
 const tbl=(startY,head,body,cw,numCols,opt={})=>doc.autoTable({startY,head:[head],body,theme:'plain',margin:{left:M,right:M,top:20,bottom:16},styles:{font:F,fontSize:7.6,cellPadding:{top:2.3,bottom:2.3,left:2.4,right:2.4},textColor:C.ink,lineColor:C.line,lineWidth:{bottom:.15},overflow:'linebreak',valign:'middle'},headStyles:{fillColor:C.navy,textColor:C.white,fontStyle:'bold',fontSize:7.2,lineWidth:0},alternateRowStyles:{fillColor:C.bg},columnStyles:Object.fromEntries(cw.map((w,i)=>[i,{cellWidth:w,halign:numCols.includes(i)?'right':'left'}])),foot:opt.foot?[opt.foot]:undefined,footStyles:{fillColor:[227,236,250],textColor:C.navy,fontStyle:'bold',halign:'right'},didParseCell:h=>{if(h.section==='body'&&opt.bold&&opt.bold.includes(h.column.index)){h.cell.styles.fontStyle='bold';h.cell.styles.textColor=C.navy}if(h.section==='body'&&opt.muted&&opt.muted.includes(h.column.index))h.cell.styles.textColor=C.muted;if(h.section==='head'&&numCols.includes(h.column.index))h.cell.styles.halign='right';if(h.section==='foot'&&h.column.index===0)h.cell.styles.halign='left';if(h.section==='body'&&opt.colour&&opt.colour[h.column.index]){const raw=opt.colour[h.column.index](h.row.raw);if(raw)h.cell.styles.textColor=raw,h.cell.styles.fontStyle='bold'}}});
 doc.addPage();title(24,'Largest discrepancies','Ranked by absolute cost variance · positive = shortage');
 const top=state.rows.filter(r=>r.variance!==null&&r.variance!==0).sort((a,b)=>Math.abs(b.costVariance)-Math.abs(a.costVariance)).slice(0,15);
 tbl(29,['#','Product','SKU','Category','System qty','Physical qty','Variance','Unit cost','Cost variance','Sales value variance','Status'],top.map((r,i)=>[i+1,r.name,r.sku,r.category,number(r.systemQty),number(r.physicalQty),signed(r.variance),cur(r.cost),cur(r.costVariance),cur(r.salesVariance),r.status==='shortage'?'Shortage':'Surplus']),[8,60,24,28,18,18,16,22,26,28,21],[4,5,6,7,8,9],{bold:[1],muted:[2],colour:{6:r=>vcol(parseFloat(String(r[6]).replace(/[^0-9.-]/g,''))),8:r=>sc(r[8]),9:r=>sc(r[9]),10:r=>r[10]==='Shortage'?C.red:C.green}});
 if(!top.length){tx('normal',9,C.muted);doc.text('No quantity variances were found in the counted items.',M,40)}
 let y2=(doc.lastAutoTable?.finalY||40)+12;if(y2>150){doc.addPage();y2=24}
 const allCats=categoryStats();title(y2,'Category analysis','Cost and sales value by product category');
 tbl(y2+5,['Category','Items','System cost','Physical cost','Shortage','Surplus','Net cost variance','Net sales variance','Accuracy'],allCats.slice(0,14).map(c=>[c.category,number(c.items),cur(c.systemCost),cur(c.physicalCost),cur(c.shortageCost),cur(c.surplusCost),cur(c.netCost),cur(c.netSales),pct(c.accuracy)]),[44,15,32,32,30,30,32,32,22],[1,2,3,4,5,6,7,8],{colour:{6:r=>sc(r[6]),7:r=>sc(r[7])}});
 /* data quality + expiry */
 let y3=doc.lastAutoTable.finalY+12;if(y3>140){doc.addPage();y3=24}
 title(y3,'Data quality and expiry risk');y3+=8;
 const tiles=[['Not counted',s.uncounted],['Data exceptions',s.exceptions],['Blank cells set to 0',state.importStats.blankInventory+state.importStats.blankCounts],['Manual-entry lines',s.manualLines],['Lines recounted',s.recounted],['Expired items',s.expiredItems]],tw=(W-2*M-5*4)/6;
 tiles.forEach((t,i)=>{const x=M+i*(tw+4);doc.setFillColor(...C.bg);doc.setDrawColor(...C.line);doc.roundedRect(x,y3,tw,15,2,2,'FD');tx('bold',13,t[1]>0&&i!==2&&i!==4?C.amber:C.navy);doc.text(number(t[1]),x+4,y3+8);tx('normal',6.8,C.muted);doc.text(doc.splitTextToSize(t[0],tw-6)[0],x+4,y3+12.5)});
 const exp=state.rows.filter(r=>r.expiryStatus==='expired'||r.expiryStatus==='soon').sort((a,b)=>a.expiry.localeCompare(b.expiry)).slice(0,10);
 if(exp.length)tbl(y3+21,['Product','SKU','Category','Expiry date','Status','Qty at risk','Cost at risk'],exp.map(r=>[r.name,r.sku,r.category,showDate(r.expiry),r.expiryStatus==='expired'?'Expired':'Expiring',number(r.expiredQty+r.soonQty),cur(r.expiryCost)]),[80,28,40,30,26,26,39],[5,6],{bold:[0],muted:[1],colour:{4:r=>r[4]==='Expired'?C.red:C.amber}});
 else{tx('normal',8.5,C.muted);doc.text(`No expired items or items expiring within ${st.expiryDays} days were found.`,M,y3+25)}
 /* method + sign off */
 let y4=(exp.length?doc.lastAutoTable.finalY:y3+30)+12;if(y4>150){doc.addPage();y4=24}
 title(y4,'Method and approval');tx('normal',7.8,C.muted);
 doc.text(doc.splitTextToSize('Variance = system quantity − physical quantity; positive values are shortages and negative values are surpluses. Shortage and surplus are valued at imported unit cost. Blank system quantities, costs and selling prices are treated as 0, and a blank physical quantity is a counted quantity of 0 unless the stock file was read with the “blank means not counted” option. Potential sales value uses imported selling prices and is an estimate, not realised revenue or a confirmed accounting loss.',W-2*M),M,y4+9);
 const sy=Math.max(y4+30,0),sw=(W-2*M-16)/3;if(sy>186){doc.addPage()}const yy=sy>186?40:sy;
 [['Prepared by',st.preparedBy],['Reviewed by',st.reviewedBy],['Approved by','']].forEach((p,i)=>{const x=M+i*(sw+8);doc.setDrawColor(...C.muted);doc.setLineWidth(.3);doc.line(x,yy+10,x+sw,yy+10);tx('bold',8.5,C.ink);if(p[1])doc.text(p[1],x,yy+8);tx('normal',7,C.muted);doc.text(`${p[0]} · signature and date`,x,yy+14.5)});
 /* running header + footer on every page */
 const n=doc.getNumberOfPages();for(let i=1;i<=n;i++){doc.setPage(i);
  if(i>1){doc.setFillColor(...C.navy);doc.rect(0,0,W,11,'F');doc.setFillColor(...C.blue);doc.rect(0,11,W,.8,'F');tx('bold',8.5,C.white);doc.text('StockWise  |  Stocktaking report',M,7.2);tx('normal',8,[190,205,228]);doc.text(`${st.company?st.company+'  ·  ':''}${monthLabel(state.period)}`,W-M,7.2,{align:'right'})}
  doc.setDrawColor(...C.line);doc.setLineWidth(.2);doc.line(M,H-10,W-M,H-10);tx('normal',7.2,C.muted);doc.text(`StockWise  ·  ${monthLabel(state.period)}  ·  Confidential management report`,M,H-5.5);doc.text(`Page ${i} of ${n}`,W-M,H-5.5,{align:'right'})}
 doc.save(`StockWise_Executive_Report_${state.period}.pdf`);toast('Executive PDF report generated.');
}

/* ---------- templates, history, periods ---------- */
function downloadCountTemplate(){
 const data=[['id**','name*','category','unit','qty','count','rpack_cost','sale_price','expiry','counted_by','notes'],['SKU-001','Example product','Category A','Pack',120,118,2.5,4,'2027-05-01','Ama','System qty is "qty"; physical qty is "count"'],['SKU-002','Another example','Category B','Bottle',40,null,8,12,null,'','A blank count is read as 0 (or "not counted" if you choose that option)']];
 const ws=XLSX.utils.aoa_to_sheet(data);ws['!cols']=[{wch:14},{wch:26},{wch:16},{wch:10},{wch:10},{wch:10},{wch:12},{wch:12},{wch:13},{wch:14},{wch:60}];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Stock');XLSX.writeFile(wb,'StockWise_Stock_File_Template.xlsx');toast('Stock-file template downloaded.');
}
function resetCountState(){state.countBySku=new Map();state.countLoaded=false;state.unmatched=[];state.invVal=[];state.cntVal=[];state.importStats={blankInventory:0,blankCounts:0}}
function loadHistory(period){const h=state.history.find(x=>x.period===period);if(!h)return;resetCountState();state.period=h.period;state.inventory=(h.rows||[]).map(r=>({...r}));state.validation=(h.validation||[]).map(v=>({...v}));state.inventoryFileName=h.inventoryFile||'Historical snapshot';state.countFileName='';state.periodNotes=h.notes||'';$('inventoryFileName').textContent=state.inventoryFileName;reconcile();setPeriod(h.period);go('dashboard');toast(`Loaded saved snapshot for ${monthLabel(period)}.`)}
function exportHistory(){downloadBlob(JSON.stringify(state.history,null,2),`StockWise_History_${new Date().toISOString().slice(0,10)}.json`,'application/json');toast('History backup exported.')}
async function importHistory(file){
 if(!file)return;
 try{const data=JSON.parse(await file.text());if(!Array.isArray(data)||data.some(h=>!h||!h.period||!Array.isArray(h.rows)))throw new Error('This is not a StockWise history file.');
  let added=0,replaced=0;for(const h of data){const i=state.history.findIndex(x=>x.period===h.period);if(i>=0){state.history[i]=h;replaced++}else{state.history.push(h);added++}}
  state.history.sort((a,b)=>a.period.localeCompare(b.period));if(saveLocalHistory()){renderHistory();toast(`History imported: ${added} added, ${replaced} replaced.`)}
 }catch(e){toast(e.message||'Could not read the history file.',true)}
 $('historyImportFile').value='';
}
function newPeriod(){$('newPeriodInput').value=state.period;$('periodNotes').value='';$('periodDialog').showModal()}
function createPeriod(){const m=$('newPeriodInput').value;if(!m)return;resetCountState();state.period=m;state.periodNotes=$('periodNotes').value;state.inventory=[];state.rows=[];state.validation=[];state.inventoryFileName='';state.countFileName='';state.inventoryWorkbook=null;state.inventoryRows=[];$('inventoryFileName').textContent='Choose stock file';$('inventoryMapping').innerHTML='';$('inventoryImportStatus').textContent='';$('loadInventoryBtn').disabled=true;$('dataNotice').classList.remove('hidden');setNotice('<strong>New stocktake:</strong> import the stock file (system and physical quantities).');$('periodDialog').close();setPeriod(m);go('imports');toast(`New stocktake period created: ${monthLabel(m)}.`)}
function loadSample(){
 /* Demonstration dataset; never presented as actual business data. */
 const d=o=>new Date(Date.now()+o*864e5).toISOString().slice(0,10);
 const rows=[['SKU-1001','Cooking Oil 1L','Groceries',120,112,18.5,24,'Bottle',d(210)],['SKU-1002','Rice 5kg','Groceries',80,84,65,78,'Bag',d(400)],['SKU-1003','Laundry Detergent','Household',45,40,32,42,'Pack',''],['SKU-1004','Bottled Water 500ml','Beverages',300,300,1.2,2,'Bottle',d(120)],['SKU-1005','Milk Powder 400g','Dairy',32,27,28,36,'Tin',d(45)],['SKU-1006','Tomato Paste','Groceries',75,72,6.5,9,'Can',d(-12)],['SKU-1007','Shampoo 250ml','Personal Care',25,29,19,27,'Bottle',d(300)],['SKU-1008','Biscuits Multipack','Snacks',90,null,7.5,11,'Pack',d(150)],['SKU-1009','Hand Sanitiser 100ml','Personal Care',60,0,9,15,'Bottle',d(500)]];
 resetCountState();state.inventory=rows.map(([sku,name,category,systemQty,p,cost,price,unit,expiry])=>({sku,name,category,systemQty,physicalQty:p,counted:p!==null,cost,price,unit,expiry,issues:[]}));
 state.inventoryFileName='Illustrative sample data';state.countFileName='';state.validation=[{severity:'warning',type:'Demonstration',message:'Illustrative sample data only. Import your actual stock file to replace it.'}];reconcile();renderAll();$('dataNotice').classList.remove('hidden');$('dataNotice').innerHTML='<strong>Demonstration data:</strong> figures are illustrative only. Import your actual stock file to replace this sample.';toast('Illustrative sample data loaded.');
}
/* ---------- manual count entry (batches with quantity + expiry) ---------- */
const manualKey=()=>`stockwise_manual_${state.period}`;
function saveManualDraft(){try{const d={};state.inventory.forEach(r=>{if(r.manual&&r.manual.length)d[r.sku]=r.manual});if(Object.keys(d).length)localStorage.setItem(manualKey(),JSON.stringify(d));else localStorage.removeItem(manualKey())}catch{}}
function readManualDraft(){try{return JSON.parse(localStorage.getItem(manualKey())||'null')}catch{return null}}
function deleteManual(sku,id){
 const i=state.inventory.findIndex(r=>r.sku===sku);if(i<0)return;const r={...state.inventory[i]},e=(r.manual||[]).find(x=>x.id===id);if(!e)return;
 r.manual=r.manual.filter(x=>x.id!==id);if(r.adjusted)r.physicalQty=Math.max(0,n0(r.physicalQty)-e.qty);
 state.inventory[i]=r;applyCounts();saveManualDraft();reconcile();renderAll();toast('Manual entry removed.');
}
function clearManual(){
 if(!state.inventory.some(r=>(r.manual||[]).length))return toast('There are no manual entries to clear.',true);
 if(!confirm('Remove ALL manual count entries for this stocktake? This cannot be undone.'))return;
 state.inventory=state.inventory.map(r=>{if(!(r.manual||[]).length)return r;const q=r.manual.reduce((a,e)=>a+e.qty,0),x={...r,manual:[]};if(x.adjusted)x.physicalQty=Math.max(0,n0(x.physicalQty)-q);return x});
 applyCounts();saveManualDraft();reconcile();renderAll();toast('All manual entries cleared.');
}
function searchItems(q){
 const t=clean(q).toLowerCase().split(/\s+/).filter(Boolean);if(!t.length)return [];const full=t.join(' '),out=[];
 for(const r of state.inventory){const s=r.sku.toLowerCase(),n=r.name.toLowerCase();if(!t.every(x=>(s+' '+n+' '+(r.category||'').toLowerCase()).includes(x)))continue;out.push([s===full?0:s.startsWith(t[0])?1:n.startsWith(t[0])?2:3,r]);if(out.length>500)break}
 return out.sort((a,b)=>a[0]-b[0]||a[1].name.localeCompare(b[1].name)).slice(0,10).map(x=>x[1]);
}
function mcMove(d){const n=state.mc.results.length;if(!n)return;state.mc.active=(state.mc.active+d+n)%n;document.querySelectorAll('#mcList li[data-i]').forEach((li,i)=>{li.classList.toggle('active',i===state.mc.active);li.setAttribute('aria-selected',i===state.mc.active);if(i===state.mc.active)li.scrollIntoView?.({block:'nearest'})})}
function mcSelect(sku){
 const x=state.rows.find(r=>r.sku===sku);if(!x)return;state.mc.sel=sku;$('mcList').classList.add('hidden');$('mcSearch').value=`${x.name} — ${x.sku}`;
 $('mcForm').classList.remove('hidden');$('mcHint').classList.add('hidden');mcProduct();$('mcQty').value='';$('mcExpiry').value='';$('mcBy').value=state.lastBy||'';$('mcNotes').value='';$('mcQty').focus();
}
function mcReset(){$('mcDupe').classList.add('hidden');state.mc.sel=null;$('mcForm').classList.add('hidden');$('mcSearch').value='';$('mcList').classList.add('hidden');$('mcHint').classList.remove('hidden')}
function renderManual(){
 const n=state.inventory.length,counted=state.rows.filter(r=>r.physicalValid).length;
 $('mcProgress').textContent=`${number(counted)} of ${number(n)} items counted`;$('mcSearch').disabled=!n;
 $('mcHint').textContent=n?'Start typing a SKU or product name above, then choose a product to record its count.':'Import the stock file first. Its products become the searchable list here.';
 const entries=[];state.inventory.forEach(r=>(r.manual||[]).forEach(e=>entries.push({...e,sku:r.sku,name:r.name})));entries.sort((a,b)=>b.at.localeCompare(a.at));
 $('mcLogBody').innerHTML=entries.length?entries.slice(0,200).map(e=>`<tr><td>${new Date(e.at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td class="sku-cell"><strong>${esc(e.name)}</strong><small>${esc(e.sku)}</small></td><td class="num">${number(e.qty)}</td><td>${e.expiry?showDate(e.expiry):'—'}</td><td>${esc(e.by||'—')}</td><td>${esc(e.notes||'')}</td><td><button class="icon-mini" data-mc-sku="${esc(e.sku)}" data-mc-id="${esc(e.id)}" title="Remove this entry" aria-label="Remove entry for ${esc(e.sku)}">✕</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty-cell">No manual entries yet.</td></tr>';
 $('mcLogFooter').textContent=`${entries.length} entr${entries.length===1?'y':'ies'} · total quantity ${number(entries.reduce((a,e)=>a+e.qty,0))}${entries.length>200?' · showing the latest 200':''}`;
 if(state.mc.sel)mcProduct();
}

/* ---------- drag and drop uploads ---------- */
function bindDropZones(){
 const hasFiles=e=>e.dataTransfer&&[...(e.dataTransfer.types||[])].includes('Files');
 ['inventory'].forEach(type=>{
  const input=$(`${type}File`),card=input.closest('.upload-card'),over=e=>{if(!hasFiles(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';card.classList.add('dragover')};
  card.addEventListener('dragenter',over);card.addEventListener('dragover',over);
  card.addEventListener('dragleave',e=>{if(!card.contains(e.relatedTarget))card.classList.remove('dragover')});
  card.addEventListener('drop',e=>{
   e.preventDefault();card.classList.remove('dragover');const fs=[...(e.dataTransfer?.files||[])];if(!fs.length)return;
   if(fs.length>1)toast(`Only one file can be used here. Using “${fs[0].name}”.`,true);
   if(!/\.(csv|xlsx|xls)$/i.test(fs[0].name))return toast('Unsupported file type. Drop a CSV, XLSX or XLS file.',true);
   try{const dt=new DataTransfer();dt.items.add(fs[0]);input.files=dt.files}catch{}
   setupFile(type,fs[0]);
  });
 });
 ['dragover','drop'].forEach(ev=>window.addEventListener(ev,e=>{if(hasFiles(e))e.preventDefault()}));
}

/* ---------- lines-with-variances report ---------- */
const varianceRows=()=>state.rows.filter(r=>r.variance!==null&&r.variance!==0).sort((a,b)=>Math.abs(b.costVariance)-Math.abs(a.costVariance)||Math.abs(b.variance)-Math.abs(a.variance));
const flagsOf=r=>[r.adjusted?'Recounted':'',r.manualCount?'Manual entry':'',r.expiryStatus==='expired'?'Expired':'',r.hasIssue?'Data issue':''].filter(Boolean).join(', ');
function varStats(){
 const rows=varianceRows(),s=summary(),gross=rows.reduce((a,r)=>a+Math.abs(r.costVariance),0),m=new Map();
 rows.forEach((r,i)=>{r.rank=i+1;r.share=gross>0?Math.abs(r.costVariance)/gross:0;const c=r.category||'Uncategorised';if(!m.has(c))m.set(c,[]);m.get(c).push(r)});
 const cats=[...m.entries()].map(([category,rs])=>{const sh=rs.filter(r=>r.variance>0),su=rs.filter(r=>r.variance<0),f=(a,k)=>money(a.reduce((t,r)=>t+r[k],0));return {category,lines:rs.length,shortLines:sh.length,surLines:su.length,shortageCost:f(sh,'costVariance'),surplusCost:-f(su,'costVariance'),netCost:f(rs,'costVariance'),netSales:f(rs,'salesVariance'),share:gross>0?(f(sh,'costVariance')-f(su,'costVariance'))/gross:0}}).sort((a,b)=>(b.shortageCost+b.surplusCost)-(a.shortageCost+a.surplusCost));
 return {rows,s,gross,cats,shortLines:rows.filter(r=>r.variance>0).length,surLines:rows.filter(r=>r.variance<0).length};
}
function renderVariances(){
 const V=varStats(),s=V.s,q=clean($('varSearch').value).toLowerCase(),t=$('varType').value,cat=$('varCategory').value;
 const tiles=[['Lines with variances',`${number(V.rows.length)} of ${number(s.counted)} counted`],['Shortage lines',number(V.shortLines)],['Surplus lines',number(V.surLines)],['Gross shortage (cost)',currency(s.shortageCost)],['Gross surplus (cost)',currency(s.surplusCost)],['Net cost variance',currency(s.netCost)],['Shortage (sales value)',currency(s.shortageSales)],['Surplus (sales value)',currency(s.surplusSales)],['Net sales value variance',currency(s.netSales)]];
 $('varSummary').innerHTML=tiles.map(x=>`<div class="preview-stat"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong></div>`).join('');
 const sel=$('varCategory'),cur=sel.value;sel.innerHTML='<option value="all">All categories</option>'+V.cats.map(c=>`<option value="${esc(c.category)}">${esc(c.category)}</option>`).join('');sel.value=V.cats.some(c=>c.category===cur)?cur:'all';
 const rows=V.rows.filter(r=>(!q||r.sku.toLowerCase().includes(q)||r.name.toLowerCase().includes(q))&&(t==='all'||(t==='shortage'&&r.variance>0)||(t==='surplus'&&r.variance<0))&&(sel.value==='all'||(r.category||'Uncategorised')===sel.value));
 const tc=money(rows.reduce((a,r)=>a+r.costVariance,0)),ts=money(rows.reduce((a,r)=>a+r.salesVariance,0)),shown=rows.slice(0,1500);
 $('varCount').textContent=`${rows.length.toLocaleString()} lines`;$('varFooter').textContent=`Showing ${rows.length.toLocaleString()} of ${V.rows.length.toLocaleString()} lines · Cost variance ${currency(tc)} · Sales variance ${currency(ts)}`;
 $('varBody').innerHTML=rows.length?shown.map(r=>`<tr><td class="num">${r.rank}</td><td class="sku-cell"><strong>${esc(r.name)}</strong><small>${esc(r.sku)}</small></td><td>${esc(r.category||'Uncategorised')}</td><td class="num">${number(r.systemQty)}</td><td class="num">${number(r.physicalQty)}</td><td class="num ${sgn(r.variance)}">${signed(r.variance)}</td><td class="num">${currency(r.cost)}</td><td class="num ${sgn(r.costVariance)}">${currency(r.costVariance)}</td><td class="num ${sgn(r.salesVariance)}">${currency(r.salesVariance)}</td><td class="num">${pct(r.share*100)}</td><td>${statusPill(r.status)}</td><td>${esc(flagsOf(r))||'—'}</td></tr>`).join('')+(rows.length>shown.length?`<tr><td colspan="12" class="empty-cell">Showing the first ${shown.length.toLocaleString()} lines. Use filters to narrow down; exports contain every line.</td></tr>`:''):`<tr><td colspan="12" class="empty-cell">${state.rows.length?(V.rows.length?'No lines match the selected filters.':'No lines with variances. Every counted item reconciles.'):'Import your stock file to begin.'}</td></tr>`;
}
const varLine=r=>({rank:r.rank,sku:r.sku,name:r.name,category:r.category||'Uncategorised',unit:r.unit||'',sys:r.systemQty,phys:r.physicalQty,variance:r.variance,cost:r.cost,price:r.price,cv:r.costVariance,sv:r.salesVariance,share:r.share,type:r.variance>0?'Shortage':'Surplus',expiry:r.expiry?showDate(r.expiry):'',flags:flagsOf(r),by:r.counter||(r.manual||[]).map(e=>e.by).filter(Boolean)[0]||'',notes:[r.countNotes,...(r.manual||[]).map(e=>e.notes)].filter(Boolean).join('; ')});
function exportVarianceCsv(){const V=varStats();if(!V.rows.length)return toast('There are no lines with variances to export.',true);exportCsv(null,reportRows(V.rows),`StockWise_Variance_Lines_${state.period}.csv`)}

async function exportVariancePdf(){
 const V=varStats();if(!state.rows.length)return toast('Import and reconcile data before exporting.',true);if(!V.rows.length)return toast('There are no lines with variances to report.',true);
 if(!window.jspdf?.jsPDF)return toast('PDF library could not load. Check your internet connection.',true);
 toast('Preparing variance report…');
 const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true}),F=await loadPdfFonts(doc);
 const cur=n=>F==='Inter'?currency(n):currency(n).replace('GH₵','GHS '),s=V.s,st=state.settings,W=297,H=210,M=14;
 const C={navy:[20,44,78],blue:[36,99,235],teal:[15,139,125],red:[198,56,69],green:[22,128,93],amber:[154,101,0],ink:[30,45,65],muted:[104,119,140],line:[225,232,241],bg:[247,249,252],white:[255,255,255]};
 const tx=(w,size,color)=>{doc.setFont(F,w);doc.setFontSize(size);doc.setTextColor(...color)},sc=t=>String(t).startsWith('-')?C.green:/[1-9]/.test(String(t))?C.red:C.ink;
 const title=(y,t,sub)=>{tx('bold',12,C.navy);doc.text(t,M,y);if(sub){tx('normal',8,C.muted);doc.text(sub,W-M,y,{align:'right'})}doc.setDrawColor(...C.blue);doc.setLineWidth(.5);doc.line(M,y+2.5,M+14,y+2.5);doc.setDrawColor(...C.line);doc.setLineWidth(.2);doc.line(M+14,y+2.5,W-M,y+2.5)};
 const tbl=(startY,head,body,cw,numCols,opt={})=>doc.autoTable({startY,head:[head],body,foot:opt.foot?[opt.foot]:undefined,theme:'plain',margin:{left:M,right:M,top:20,bottom:16},styles:{font:F,fontSize:7.4,cellPadding:{top:2.1,bottom:2.1,left:2.2,right:2.2},textColor:C.ink,lineColor:C.line,lineWidth:{bottom:.15},overflow:'linebreak',valign:'middle'},headStyles:{fillColor:C.navy,textColor:C.white,fontStyle:'bold',fontSize:7,lineWidth:0},alternateRowStyles:{fillColor:C.bg},footStyles:{fillColor:[227,236,250],textColor:C.navy,fontStyle:'bold',halign:'right'},columnStyles:Object.fromEntries(cw.map((w,i)=>[i,{cellWidth:w,halign:numCols.includes(i)?'right':'left'}])),didParseCell:h=>{if(h.section==='body'&&opt.bold&&opt.bold.includes(h.column.index)){h.cell.styles.fontStyle='bold';h.cell.styles.textColor=C.navy}if(h.section==='body'&&opt.muted&&opt.muted.includes(h.column.index))h.cell.styles.textColor=C.muted;if(h.section==='head'&&numCols.includes(h.column.index))h.cell.styles.halign='right';if(h.section==='foot'&&h.column.index<=3)h.cell.styles.halign='left';if(h.section==='body'&&opt.colour&&opt.colour[h.column.index]){const c=opt.colour[h.column.index](h.row.raw);if(c){h.cell.styles.textColor=c;h.cell.styles.fontStyle='bold'}}}});
 doc.setFillColor(...C.navy);doc.rect(0,0,W,32,'F');doc.setFillColor(...C.red);doc.rect(0,32,W,1.2,'F');
 doc.setFillColor(...C.white);doc.roundedRect(M,7,16,16,3.5,3.5,'F');tx('bold',16,C.navy);doc.text('S',M+8,18.5,{align:'center'});
 tx('bold',20,C.white);doc.text('Lines with variances report',M+22,15);tx('normal',10,[190,205,228]);doc.text(`${st.company?st.company+'  ·  ':''}${monthLabel(state.period)}`,M+22,22.5);
 tx('normal',8,[190,205,228]);[`Prepared by: ${st.preparedBy||'—'}`,`Reviewed by: ${st.reviewedBy||'—'}`,`Generated: ${new Date().toLocaleString('en-GB')}`].forEach((t,i)=>doc.text(t,W-M,12+i*5,{align:'right'}));
 tx('normal',8,C.muted);doc.text(doc.splitTextToSize(`Stock file: ${state.inventoryFileName||'Not recorded'}     Counted items: ${number(s.counted)} of ${number(s.items)}     Variance = system − physical (positive = shortage)`,W-2*M),M,40);
 const tw=(W-2*M-15)/4,tiles=[['Lines with variances',`${number(V.rows.length)} of ${number(s.counted)}`,C.navy],['Shortage / surplus lines',`${number(V.shortLines)} / ${number(V.surLines)}`,C.navy],['Gross shortage (cost)',cur(s.shortageCost),C.red],['Gross surplus (cost)',cur(s.surplusCost),C.green],['Net cost variance',cur(s.netCost),s.netCost>0?C.red:s.netCost<0?C.green:C.navy],['Shortage (sales value)',cur(s.shortageSales),C.red],['Surplus (sales value)',cur(s.surplusSales),C.green],['Net sales value variance',cur(s.netSales),s.netSales>0?C.red:s.netSales<0?C.green:C.navy]];
 tiles.forEach((t,i)=>{const x=M+(i%4)*(tw+5),y=46+Math.floor(i/4)*21;doc.setFillColor(...C.bg);doc.setDrawColor(...C.line);doc.roundedRect(x,y,tw,17,2,2,'FD');tx('normal',7,C.muted);doc.text(t[0],x+4,y+6);tx('bold',12.5,t[2]);doc.text(t[1],x+4,y+13.5)});
 title(94,'Variance by category','Lines with a variance grouped by product category');
 tbl(99,['Category','Lines','Shortage lines','Surplus lines','Shortage (cost)','Surplus (cost)','Net cost variance','Net sales variance','Share of gross'],V.cats.slice(0,10).map(c=>[c.category,number(c.lines),number(c.shortLines),number(c.surLines),cur(c.shortageCost),cur(c.surplusCost),cur(c.netCost),cur(c.netSales),pct(c.share*100)]),[50,16,26,26,32,32,32,32,23],[1,2,3,4,5,6,7,8],{colour:{6:r=>sc(r[6]),7:r=>sc(r[7])}});
 let ty=doc.lastAutoTable.finalY+12;if(ty>150){doc.addPage();ty=24}
 title(ty,'All lines with variances',`${number(V.rows.length)} lines · ranked by absolute cost variance`);
 const sumQ=k=>V.rows.reduce((a,r)=>a+r[k],0);
 tbl(ty+5,['#','Product','SKU','Category','System qty','Physical qty','Variance','Unit cost','Cost variance','Sales value variance','% of gross','Type','Flags'],V.rows.map(r=>[r.rank,r.name,r.sku,r.category||'Uncategorised',number(r.systemQty),number(r.physicalQty),signed(r.variance),cur(r.cost),cur(r.costVariance),cur(r.salesVariance),pct(r.share*100),r.variance>0?'Shortage':'Surplus',flagsOf(r)]),[7,40,21,22,16,18,17,19,24,25,14,19,27],[4,5,6,7,8,9,10],{bold:[1],muted:[2],foot:['','Total','','',number(sumQ('systemQty')),number(sumQ('physicalQty')),signed(sumQ('variance')),'',cur(s.netCost),cur(s.netSales),'100%','',''],colour:{6:r=>sc(r[6]),8:r=>sc(r[8]),9:r=>sc(r[9]),11:r=>r[11]==='Shortage'?C.red:C.green}});
 let y=doc.lastAutoTable.finalY+12;if(y>150){doc.addPage();y=24}
 title(y,'Method and review');tx('normal',7.8,C.muted);doc.text(doc.splitTextToSize('A line is listed when the counted physical quantity differs from the system quantity. Cost variance = quantity variance × unit cost; sales value variance = quantity variance × selling price. Positive values are shortages and negative values are surpluses. Sales value is an estimate, not realised revenue or a confirmed accounting loss. Lines flagged Recounted or Manual entry include counts keyed in after the stock file was prepared and should be supported by count evidence.',W-2*M),M,y+9);
 const sy=y+30,sw=(W-2*M-16)/3;let yy=sy;if(sy>186){doc.addPage();yy=40}
 [['Prepared by',st.preparedBy],['Reviewed by',st.reviewedBy],['Approved by','']].forEach((p,i)=>{const x=M+i*(sw+8);doc.setDrawColor(...C.muted);doc.setLineWidth(.3);doc.line(x,yy+10,x+sw,yy+10);tx('bold',8.5,C.ink);if(p[1])doc.text(p[1],x,yy+8);tx('normal',7,C.muted);doc.text(`${p[0]} · signature and date`,x,yy+14.5)});
 const n=doc.getNumberOfPages();for(let i=1;i<=n;i++){doc.setPage(i);
  if(i>1){doc.setFillColor(...C.navy);doc.rect(0,0,W,11,'F');doc.setFillColor(...C.red);doc.rect(0,11,W,.8,'F');tx('bold',8.5,C.white);doc.text('StockWise  |  Lines with variances report',M,7.2);tx('normal',8,[190,205,228]);doc.text(`${st.company?st.company+'  ·  ':''}${monthLabel(state.period)}`,W-M,7.2,{align:'right'})}
  doc.setDrawColor(...C.line);doc.setLineWidth(.2);doc.line(M,H-10,W-M,H-10);tx('normal',7.2,C.muted);doc.text(`StockWise  ·  ${monthLabel(state.period)}  ·  Confidential management report`,M,H-5.5);doc.text(`Page ${i} of ${n}`,W-M,H-5.5,{align:'right'})}
 doc.save(`StockWise_Variance_Report_${state.period}.pdf`);toast('Variance report PDF generated.');
}

async function exportVarianceExcel(){
 const V=varStats();if(!state.rows.length)return toast('Import and reconcile data before exporting.',true);if(!V.rows.length)return toast('There are no lines with variances to report.',true);
 if(!window.ExcelJS)return toast('Excel export library could not load. Check your internet connection.',true);
 toast('Building variance workbook…');
 const {s,st,wb,ARGB,CUR,QTY,NAVY,MUTED,BAND,put,page,band,sub,tableSheet,txt,num}=xlKit(`Lines with variances ${monthLabel(state.period)}`),lines=V.rows.map(varLine);
 const ws=wb.addWorksheet('Summary',{views:[{showGridLines:false}],properties:{tabColor:{argb:ARGB('C63845')}}});page(ws);ws.pageSetup.fitToHeight=1;
 [2,32,24,3,32,24,3,32,24,2].forEach((w,i)=>ws.getColumn(i+1).width=w);band(ws,'J','StockWise  |  Lines with variances report',sub);
 [['Stock file',state.inventoryFileName||'Not recorded','Prepared by',st.preparedBy||'—'],['Physical counts',`${number(s.counted)} items counted${s.manualLines?` · ${s.manualLines} with manual entries`:''}`,'Reviewed by',st.reviewedBy||'—'],['Counted items',`${number(s.counted)} of ${number(s.items)}`,'Period',monthLabel(state.period)]].forEach((m,i)=>{const r=4+i;put(ws,`B${r}`,m[0],{size:9,bold:true,color:MUTED});ws.mergeCells(`C${r}:E${r}`);put(ws,`C${r}`,m[1]);put(ws,`H${r}`,m[2],{size:9,bold:true,color:MUTED});put(ws,`I${r}`,m[3])});
 const blk=(c1,c2,t,color,items)=>{ws.mergeCells(`${c1}8:${c2}8`);put(ws,`${c1}8`,t,{bold:true,color:'FFFFFF',fill:color,size:11,indent:1});ws.getRow(8).height=22;items.forEach((it,i)=>{const r=9+i*3;ws.mergeCells(`${c1}${r}:${c2}${r}`);put(ws,`${c1}${r}`,it.l,{size:9,bold:true,color:MUTED,fill:BAND,indent:1});ws.mergeCells(`${c1}${r+1}:${c2}${r+1}`);put(ws,`${c1}${r+1}`,it.v,{size:18,bold:true,color:it.c||NAVY,fill:BAND,fmt:it.f||CUR,indent:1});ws.getRow(r+1).height=30;ws.mergeCells(`${c1}${r+2}:${c2}${r+2}`);put(ws,`${c1}${r+2}`,it.s,{size:8.5,italic:true,color:MUTED,fill:BAND,indent:1,wrap:true});ws.getRow(r+2).height=24})};
 const vc=n=>n>0?'C63845':n<0?'16805D':NAVY;
 blk('B','C','1 · Lines with variances','2463EB',[{l:'Lines with a variance',v:V.rows.length,f:'#,##0',s:`${pct(s.varianceRate)} of ${number(s.counted)} counted items`},{l:'Shortage lines / surplus lines',v:`${number(V.shortLines)} / ${number(V.surLines)}`,f:'@',s:'Shortage: system quantity above physical'}]);
 blk('E','F','2 · Cost variance','C63845',[{l:'Gross shortage (cost)',v:s.shortageCost,c:'C63845',s:'Shortage quantity × unit cost'},{l:'Gross surplus (cost)',v:s.surplusCost,c:'16805D',s:'Surplus quantity × unit cost'}]);
 blk('H','I','3 · Net position','0F8B7D',[{l:'Net cost variance',v:s.netCost,c:vc(s.netCost),s:'Shortage minus surplus, at cost'},{l:'Net sales value variance',v:s.netSales,c:vc(s.netSales),s:`Shortage ${currency(s.shortageSales)} · Surplus ${currency(s.surplusSales)}`}]);
 ws.mergeCells('B16:I16');put(ws,'B16','Key observations',{size:12,bold:true,color:NAVY,border:{bottom:{style:'medium',color:{argb:ARGB('2463EB')}}}});ws.getRow(16).height=22;
 const sh=V.rows.filter(r=>r.variance>0)[0],su=[...V.rows].filter(r=>r.variance<0).sort((a,b)=>a.costVariance-b.costVariance)[0],top10=V.gross>0?V.rows.slice(0,10).reduce((a,r)=>a+Math.abs(r.costVariance),0)/V.gross*100:0;
 const obs=[sh&&`Largest shortage: ${sh.name} (${sh.sku}), ${signed(sh.variance)} units, ${currency(sh.costVariance)} at cost.`,su&&`Largest surplus: ${su.name} (${su.sku}), ${signed(su.variance)} units, ${currency(su.costVariance)} at cost.`,V.cats[0]&&`Category with the most exposure: ${V.cats[0].category} (${V.cats[0].lines} lines, ${pct(V.cats[0].share*100)} of gross cost variance).`,`The ten largest lines make up ${pct(top10)} of gross cost variance.`,V.rows.some(r=>r.adjusted||r.manualCount)&&`${V.rows.filter(r=>r.adjusted||r.manualCount).length} variance lines include recounts or manual entries; keep the supporting count evidence.`].filter(Boolean);
 let r=17;obs.forEach(t=>{ws.mergeCells(`B${r}:I${r}`);put(ws,`B${r}`,'●  '+t,{wrap:true});ws.getRow(r).height=22;r++});
 r++;ws.mergeCells(`B${r}:I${r}`);put(ws,`B${r}`,'Variance = system quantity − physical quantity; positive values are shortages and negative values are surpluses. Sales value is an estimate, not realised revenue or a confirmed accounting loss.',{size:9,color:MUTED,wrap:true});ws.getRow(r).height=32;r+=2;
 [['B','C','Prepared by',st.preparedBy],['E','F','Reviewed by',st.reviewedBy],['H','I','Approved by','']].forEach(([a,b,l,nm])=>{ws.mergeCells(`${a}${r}:${b}${r}`);put(ws,`${a}${r}`,nm||' ',{size:11,border:{bottom:{style:'thin',color:{argb:ARGB(MUTED)}}}});ws.mergeCells(`${a}${r+1}:${b}${r+1}`);put(ws,`${a}${r+1}`,`${l} · signature and date`,{size:8.5,color:MUTED})});ws.getRow(r).height=34;
 const cols=[{h:'#',w:6,center:true,v:d=>d.rank},txt('Product','name',34,{bold:true}),txt('SKU','sku',16,{muted:true}),txt('Category','category',18),txt('Unit','unit',9),num('System qty','sys',12,QTY,{sum:true}),num('Physical qty','phys',12,QTY,{sum:true}),
  {...num('Variance qty (system − physical)','variance',16,QTY,{cf:'var',sum:true}),f:r=>`F${r}-G${r}`},num('Unit cost','cost',14,CUR),num('Unit price','price',14,CUR),{...num('Cost variance','cv',16,CUR,{cf:'var',sum:true}),f:r=>`H${r}*I${r}`},{...num('Sales value variance','sv',17,CUR,{cf:'var',sum:true}),f:r=>`H${r}*J${r}`},
  num('% of gross cost variance','share',14,'0.0%'),{h:'Type',w:12,cf:'status',v:d=>d.type},txt('Expiry','expiry',13),txt('Flags','flags',24),txt('Counted by','by',16),txt('Notes','notes',30)];
 tableSheet('Variance Lines','All lines with variances',`${sub}  ·  Ranked by absolute cost variance`,'C63845',cols,lines,{freezeX:3});
 const vcols=[{h:'#',w:6,center:true,v:(d,i)=>i+1},txt('Product','name',34,{bold:true}),txt('SKU','sku',16,{muted:true}),txt('Category','category',18),num('System qty','sys',12,QTY),num('Physical qty','phys',12,QTY),num('Variance qty','variance',13,QTY,{cf:'var',sum:true}),num('Unit cost','cost',14,CUR),num('Cost variance','cv',16,CUR,{cf:'var',sum:true}),num('Sales value variance','sv',18,CUR,{cf:'var',sum:true}),txt('Flags','flags',24)];
 tableSheet('Shortages','Shortage lines',sub,'C63845',vcols,lines.filter(d=>d.variance>0));
 tableSheet('Surpluses','Surplus lines',sub,'16805D',vcols,[...lines.filter(d=>d.variance<0)]);
 tableSheet('By Category','Variance by category',sub,'0F8B7D',[txt('Category','category',26),num('Lines','lines',9,'#,##0',{sum:true}),num('Shortage lines','shortLines',14,'#,##0',{sum:true}),num('Surplus lines','surLines',14,'#,##0',{sum:true}),num('Shortage (cost)','shortageCost',17,CUR,{sum:true}),num('Surplus (cost)','surplusCost',17,CUR,{sum:true}),num('Net cost variance','netCost',17,CUR,{cf:'var',sum:true}),num('Net sales variance','netSales',17,CUR,{cf:'var',sum:true}),num('Share of gross','share',13,'0.0%')],V.cats);
 const buf=await wb.xlsx.writeBuffer();downloadBlob(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`StockWise_Variance_Report_${state.period}.xlsx`);toast('Variance workbook generated.');
}

function bindNew(){
 bindDropZones();$('removeInventoryBtn').addEventListener('click',()=>removeFile());
 $('mcDupe').addEventListener('click',e=>{const b=e.target.closest('[data-ask]');if(!b)return;const k=b.dataset.ask,acts=state.mc.ask||[];$('mcDupe').classList.add('hidden');if(k!=='x'&&acts[+k])acts[+k].run()});$('mcForm').addEventListener('input',()=>$('mcDupe').classList.add('hidden'));bindNumberGuards();bindAlerts();
 /* variance report */
 bindDash();
 ['varSearch','varType','varCategory'].forEach(id=>$(id).addEventListener(id==='varSearch'?'input':'change',renderVariances));
 ['varPdfBtn','repVarPdf'].forEach(id=>$(id).addEventListener('click',exportVariancePdf));['varXlsxBtn','repVarXlsx'].forEach(id=>$(id).addEventListener('click',exportVarianceExcel));['varCsvBtn','repVarCsv'].forEach(id=>$(id).addEventListener('click',exportVarianceCsv));$('repVarOpen').addEventListener('click',()=>go('variances'));
 /* manual entry */
 const se=$('mcSearch');se.addEventListener('input',()=>{if(state.mc.sel){state.mc.sel=null;$('mcForm').classList.add('hidden');$('mcHint').classList.remove('hidden')}mcOpenList()});se.addEventListener('focus',mcOpenList);
 se.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();if($('mcList').classList.contains('hidden'))mcOpenList();else mcMove(1)}else if(e.key==='ArrowUp'){e.preventDefault();mcMove(-1)}else if(e.key==='Enter'){e.preventDefault();const r=state.mc.results[state.mc.active];if(!$('mcList').classList.contains('hidden')&&r)mcSelect(r.sku)}else if(e.key==='Escape'){$('mcList').classList.add('hidden');se.setAttribute('aria-expanded','false')}});
 $('mcList').addEventListener('mousedown',e=>e.preventDefault());$('mcList').addEventListener('click',e=>{const li=e.target.closest('li[data-i]');if(li)mcSelect(state.mc.results[+li.dataset.i].sku)});
 document.addEventListener('click',e=>{if(!e.target.closest('.mc-search'))$('mcList').classList.add('hidden')});
 $('mcForm').addEventListener('submit',mcSubmit);$('mcCancel').addEventListener('click',()=>{mcReset();$('mcSearch').focus()});$('mcBlind').addEventListener('change',mcProduct);
 $('mcLogBody').addEventListener('click',e=>{const b=e.target.closest('[data-mc-id]');if(b)deleteManual(b.dataset.mcSku,b.dataset.mcId)});$('mcClear').addEventListener('click',clearManual);
}

/* ---------- persistence (IndexedDB: survives refresh and browser restarts) ---------- */
const DB={h:null,ok:typeof indexedDB!=='undefined',
 open(){if(!this.h)this.h=new Promise((res,rej)=>{const q=indexedDB.open('stockwise',1);q.onupgradeneeded=()=>q.result.createObjectStore('kv');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);q.onblocked=()=>rej(new Error('blocked'))});return this.h},
 async tx(mode,fn){const db=await this.open();return new Promise((res,rej)=>{const t=db.transaction('kv',mode),r=fn(t.objectStore('kv'));t.oncomplete=()=>res(r&&r.result);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)})},
 get(k){return this.tx('readonly',s=>s.get(k))},set(k,v){return this.tx('readwrite',s=>s.put(v,k))},del(k){return this.tx('readwrite',s=>s.delete(k))}};
let persistTimer=null;
const isDemo=()=>state.inventoryFileName==='Illustrative sample data';
const snapshotSession=()=>({v:1,savedAt:new Date().toISOString(),period:state.period,periodNotes:state.periodNotes,inventory:state.inventory,countBySku:[...state.countBySku],countLoaded:state.countLoaded,unmatched:state.unmatched,invVal:state.invVal,cntVal:state.cntVal,validation:state.validation,importStats:state.importStats,inventoryFileName:state.inventoryFileName,countFileName:state.countFileName});
function setSaveStatus(ok){const el=$('saveStatus');if(el)el.textContent=ok?`Auto-saved ${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`:'Auto-save unavailable in this browser'}
function persist(){if(!state.restored)return;clearTimeout(persistTimer);persistTimer=setTimeout(doPersist,300)}
async function doPersist(){
 if(!state.restored||isDemo())return;
 if(!DB.ok){setSaveStatus(false);return}
 try{await DB.set('session',snapshotSession());setSaveStatus(true)}catch(e){console.warn(e);setSaveStatus(false)}
}
async function restoreSession(){
 let info=null;
 if(DB.ok){
  try{
   const h=await DB.get('history');if(Array.isArray(h)){const m=new Map(state.history.map(x=>[x.period,x]));h.forEach(x=>m.set(x.period,x));state.history=[...m.values()].sort((a,b)=>a.period.localeCompare(b.period))}
   const s=await DB.get('session');
   if(s&&s.v===1&&Array.isArray(s.inventory)&&s.inventory.length&&!state.inventory.length){
    Object.assign(state,{period:s.period||state.period,periodNotes:s.periodNotes||'',inventory:s.inventory,countBySku:new Map(),countLoaded:false,unmatched:[],invVal:s.invVal||[],cntVal:[],validation:s.validation||[],importStats:s.importStats||{blankInventory:0,blankCounts:0},inventoryFileName:s.inventoryFileName||'',countFileName:s.countFileName||''});
    if(state.inventoryFileName){$('inventoryFileName').textContent=state.inventoryFileName;$('inventoryImportStatus').className='import-status success';$('inventoryImportStatus').textContent=`Restored ${state.inventory.length.toLocaleString()} items from your saved session.`}
    if(s.countLoaded){const m=new Map(s.countBySku||[]);state.inventory.forEach(r=>{if(r.baseCounted===undefined&&!r.adjusted)r.baseCounted=m.has(r.sku)||!!r.assumedZero})}
    reconcile();info=s;
   }
  }catch(e){console.warn('Restore failed',e)}
 }
 state.restored=true;setSaveStatus(DB.ok);renderAll();
 try{const v=localStorage.getItem('stockwise_view');if(v&&$(`view-${v}`))go(v)}catch{}
 if(info)toast(`Restored your saved stocktake: ${info.inventory.length.toLocaleString()} items (saved ${new Date(info.savedAt).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'})}).`);
}
async function clearSaved(all){
 if(!confirm(all?'Delete ALL saved data on this device: current session, monthly history, settings and manual drafts? This cannot be undone.':'Clear the saved working session (inventory, counts and manual entries)? Your monthly history is kept.'))return;
 state.restored=false;clearTimeout(persistTimer);
 try{await DB.del('session');if(all)await DB.del('history');Object.keys(localStorage).filter(k=>k.startsWith('stockwise_')&&(all||k.startsWith('stockwise_manual_')||k==='stockwise_view')).forEach(k=>localStorage.removeItem(k))}catch(e){console.warn(e)}
 location.reload();
}

/* ---------- numeric inputs: no spinners, no arrow-key or wheel changes ---------- */
function bindNumberGuards(){
 const isNum=t=>t&&t.matches&&t.matches('input[type=number]');
 document.addEventListener('keydown',e=>{if((e.key==='ArrowUp'||e.key==='ArrowDown')&&isNum(e.target))e.preventDefault()},true);
 document.addEventListener('wheel',e=>{
  if(!isNum(e.target)||document.activeElement!==e.target)return;
  e.preventDefault();let n=e.target.parentElement;
  while(n&&n!==document.body){const o=getComputedStyle(n).overflowY;if(/(auto|scroll)/.test(o)&&n.scrollHeight>n.clientHeight)break;n=n.parentElement}
  (n&&n!==document.body?n:window).scrollBy({top:e.deltaY,left:0});
 },{passive:false,capture:true});
}

/* ---------- priority alerts as exportable filters ---------- */
const ALERTS={
 uncounted:{label:'Items not counted',test:r=>r.status==='uncounted'},
 assumed:{label:'Missing items valued at zero',test:r=>!!r.assumedZero},
 exceptions:{label:'Data exceptions',test:r=>r.hasIssue},
 shortage:{label:'Shortage lines',test:r=>r.status==='shortage'},
 surplus:{label:'Surplus lines',test:r=>r.status==='surplus'},
 highvalue:{label:'High-value shortage lines',test:r=>r.status==='shortage'&&state.settings.highValue>0&&r.costVariance>=state.settings.highValue},
 expired:{label:'Expired stock',test:r=>r.expiredQty>0},
 expiring:{label:'Stock expiring soon',test:r=>r.soonQty>0},
 negative:{label:'Negative system stock',test:r=>r.systemQty<0},
 recounted:{label:'Recounted lines',test:r=>!!r.adjusted},
 manual:{label:'Lines with manual entries',test:r=>r.manualCount>0}
};
const alertCount=k=>state.rows.filter(ALERTS[k].test).length;
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function applyAlertFilter(key){state.alertFilter=key;$('varianceFilter').value='all';$('categoryFilter').value='all';$('tableSearch').value='';go('stocktake');renderTable()}
function renderAlertSelect(){
 const sel=$('alertFilter'),keys=makeAlerts().filter(a=>a.key&&ALERTS[a.key]&&ALERTS[a.key].test).map(a=>a.key);
 if(state.alertFilter&&ALERTS[state.alertFilter]&&!keys.includes(state.alertFilter))keys.push(state.alertFilter);
 sel.innerHTML='<option value="">Priority alert: none</option>'+keys.map(k=>`<option value="${k}">${esc(ALERTS[k].label)} (${alertCount(k)})</option>`).join('');sel.value=state.alertFilter||'';
}
function currentViewMeta(){
 if(state.alertFilter&&ALERTS[state.alertFilter]){const a=makeAlerts().find(x=>x.key===state.alertFilter);return {label:ALERTS[state.alertFilter].label,detail:a?a.detail:''}}
 const f=$('varianceFilter').value!=='all'||$('categoryFilter').value!=='all'||clean($('tableSearch').value);
 return {label:f?'Filtered items':'All items',detail:f?'Items matching the filters applied on the Current stocktake page.':'Every item in the current reconciliation.'};
}
function exportRows(fmt,rows,meta){
 if(!rows.length)return toast('There are no items in this filter to export.',true);
 const f=`StockWise_${slug(meta.label)}_${state.period}`;
 if(fmt==='csv')return exportCsv(null,reportRows(rows),f+'.csv');
 return fmt==='xlsx'?exportRowsExcel(rows,meta,f+'.xlsx'):exportRowsPdf(rows,meta,f+'.pdf');
}
function exportAlert(key,fmt){
 const a=makeAlerts().find(x=>x.key===key);exportRows(fmt,state.rows.filter(ALERTS[key].test),{label:ALERTS[key].label,detail:a?a.detail:''});
}
const exportView=fmt=>exportRows(fmt,state.viewRows||[],currentViewMeta());
async function exportRowsExcel(rows,meta,file){
 if(!window.ExcelJS)return toast('Excel export library could not load. Check your internet connection.',true);
 toast('Building Excel workbook…');
 const {st,wb,ARGB,CUR,QTY,NAVY,MUTED,BAND,put,page,band,sub,tableSheet,txt,num}=xlKit(`${meta.label} ${monthLabel(state.period)}`),s=summary(rows);
 const ws=wb.addWorksheet('Summary',{views:[{showGridLines:false}],properties:{tabColor:{argb:ARGB('2463EB')}}});page(ws);ws.pageSetup.fitToHeight=1;
 [2,34,30,3,30,2].forEach((w,i)=>ws.getColumn(i+1).width=w);band(ws,'F',`StockWise  |  ${meta.label}`,sub);
 ws.mergeCells('B4:E4');put(ws,'B4',meta.detail||'',{wrap:true,color:MUTED,size:10});ws.getRow(4).height=34;
 const lines=[['Items in this list',rows.length,'#,##0'],['Counted items',s.counted,'#,##0'],['Items not counted',s.uncounted,'#,##0'],['System stock cost',s.systemCost,CUR],['System potential sales value',s.systemSales,CUR],['Physical stock cost',s.physicalCost,CUR],['Physical potential sales value',s.physicalSales,CUR],['Net cost variance (system − physical)',s.netCost,CUR],['Net sales value variance',s.netSales,CUR],['Prepared by',st.preparedBy||'—','@'],['Period',monthLabel(state.period),'@']];
 lines.forEach((l,i)=>{const r=6+i;put(ws,`B${r}`,l[0],{bold:true,color:MUTED,fill:i%2?'FFFFFF':BAND,indent:1});put(ws,`C${r}`,l[1],{fmt:l[2],h:'right',bold:true,color:NAVY,fill:i%2?'FFFFFF':BAND,indent:1});ws.getRow(r).height=22});
 const flag=r=>flagsOf(r),stl={shortage:'Shortage',surplus:'Surplus',match:'Matched',uncounted:'Not counted'};
 const cols=[txt('Product','name',36,{bold:true}),txt('SKU','sku',16,{muted:true}),txt('Category','category',18),txt('Unit','unit',9),num('System qty','systemQty',12,QTY,{sum:true}),{...num('Physical qty','physicalQty',12,QTY,{sum:true}),v:d=>d.physicalValid?d.physicalQty:null},{...num('Variance qty','variance',13,QTY,{cf:'var',sum:true})},num('Unit cost','cost',14,CUR),num('Unit price','price',14,CUR),num('System cost','systemCost',16,CUR,{sum:true}),num('System sales value','systemSales',17,CUR,{sum:true}),num('Physical cost','physicalCost',16,CUR,{sum:true}),num('Physical sales value','physicalSales',17,CUR,{sum:true}),num('Cost variance','costVariance',16,CUR,{cf:'var',sum:true}),num('Sales value variance','salesVariance',17,CUR,{cf:'var',sum:true}),{h:'Status',w:13,cf:'status',v:d=>stl[d.status]||d.status},{h:'Expiry',w:13,v:d=>d.expiry?showDate(d.expiry):''},{h:'Flags',w:24,v:flag}];
 tableSheet('Items',meta.label,sub,'2463EB',cols,rows,{freezeX:2});
 const buf=await wb.xlsx.writeBuffer();downloadBlob(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),file);toast(`Excel export ready: ${meta.label}.`);
}
async function exportRowsPdf(rows,meta,file){
 if(!window.jspdf?.jsPDF)return toast('PDF library could not load. Check your internet connection.',true);
 toast('Preparing PDF…');
 const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true}),F=await loadPdfFonts(doc);
 const cur=n=>F==='Inter'?currency(n):currency(n).replace('GH₵','GHS '),s=summary(rows),st=state.settings,W=297,H=210,M=14;
 const C={navy:[20,44,78],blue:[36,99,235],red:[198,56,69],green:[22,128,93],amber:[154,101,0],ink:[30,45,65],muted:[104,119,140],line:[225,232,241],bg:[247,249,252],white:[255,255,255]};
 const tx=(w,size,color)=>{doc.setFont(F,w);doc.setFontSize(size);doc.setTextColor(...color)},sc=t=>String(t).startsWith('-')?C.green:/[1-9]/.test(String(t))?C.red:C.ink;
 doc.setFillColor(...C.navy);doc.rect(0,0,W,32,'F');doc.setFillColor(...C.amber);doc.rect(0,32,W,1.2,'F');
 doc.setFillColor(...C.white);doc.roundedRect(M,7,16,16,3.5,3.5,'F');tx('bold',16,C.navy);doc.text('S',M+8,18.5,{align:'center'});
 tx('bold',19,C.white);doc.text(meta.label,M+22,15);tx('normal',10,[190,205,228]);doc.text(`${st.company?st.company+'  ·  ':''}${monthLabel(state.period)}  ·  ${number(rows.length)} item${rows.length===1?'':'s'}`,M+22,22.5);
 tx('normal',8,[190,205,228]);[`Prepared by: ${st.preparedBy||'—'}`,`Reviewed by: ${st.reviewedBy||'—'}`,`Generated: ${new Date().toLocaleString('en-GB')}`].forEach((t,i)=>doc.text(t,W-M,12+i*5,{align:'right'}));
 tx('normal',8.5,C.muted);doc.text(doc.splitTextToSize(meta.detail||'',W-2*M),M,40);
 const tw=(W-2*M-15)/4,vc=n=>n>0?C.red:n<0?C.green:C.navy,tiles=[['Items in this list',number(rows.length),C.navy],['System stock cost',cur(s.systemCost),C.navy],['Physical stock cost',cur(s.physicalCost),C.navy],['Net cost variance',cur(s.netCost),vc(s.netCost)],['Not counted',number(s.uncounted),C.navy],['System sales value',cur(s.systemSales),C.navy],['Physical sales value',cur(s.physicalSales),C.navy],['Net sales value variance',cur(s.netSales),vc(s.netSales)]];
 tiles.forEach((t,i)=>{const x=M+(i%4)*(tw+5),y=46+Math.floor(i/4)*21;doc.setFillColor(...C.bg);doc.setDrawColor(...C.line);doc.roundedRect(x,y,tw,17,2,2,'FD');tx('normal',7,C.muted);doc.text(t[0],x+4,y+6);tx('bold',12.5,t[2]);doc.text(t[1],x+4,y+13.5)});
 const sum=k=>rows.reduce((a,r)=>a+(r[k]||0),0),stl={shortage:'Shortage',surplus:'Surplus',match:'Matched',uncounted:'Not counted'},cw=[56,22,26,17,18,16,20,24,24,24,22],num0=[3,4,5,6,7,8,9];
 doc.autoTable({startY:92,head:[['Product','SKU','Category','System qty','Physical qty','Variance','Unit cost','System cost','Physical cost','Cost variance','Status']],body:rows.map(r=>[r.name,r.sku,r.category||'Uncategorised',number(r.systemQty),r.physicalValid?number(r.physicalQty):'—',r.variance===null?'—':signed(r.variance),cur(r.cost),cur(r.systemCost),r.physicalValid?cur(r.physicalCost):'—',r.costVariance===null?'—':cur(r.costVariance),stl[r.status]||r.status]),
  foot:[['Total','','',number(sum('systemQty')),number(rows.reduce((a,r)=>a+(r.physicalValid?r.physicalQty:0),0)),signed(rows.reduce((a,r)=>a+(r.variance||0),0)),'',cur(s.systemCost),cur(s.physicalCost),cur(s.netCost),'']],
  theme:'plain',margin:{left:M,right:M,top:20,bottom:16},styles:{font:F,fontSize:7.4,cellPadding:{top:2.1,bottom:2.1,left:2.2,right:2.2},textColor:C.ink,lineColor:C.line,lineWidth:{bottom:.15},overflow:'linebreak',valign:'middle'},headStyles:{fillColor:C.navy,textColor:C.white,fontStyle:'bold',fontSize:7,lineWidth:0},alternateRowStyles:{fillColor:C.bg},footStyles:{fillColor:[227,236,250],textColor:C.navy,fontStyle:'bold',halign:'right'},
  columnStyles:Object.fromEntries(cw.map((w,i)=>[i,{cellWidth:w,halign:num0.includes(i)?'right':'left'}])),
  didParseCell:h=>{const i=h.column.index;if(h.section==='head'&&num0.includes(i))h.cell.styles.halign='right';if(h.section==='foot'&&i<=2)h.cell.styles.halign='left';
   if(h.section==='body'){if(i===0){h.cell.styles.fontStyle='bold';h.cell.styles.textColor=C.navy}if(i===1)h.cell.styles.textColor=C.muted;if(i===5||i===9){h.cell.styles.textColor=sc(h.cell.raw);h.cell.styles.fontStyle='bold'}if(i===10){const t=h.cell.raw;h.cell.styles.textColor=t==='Shortage'?C.red:t==='Surplus'?C.green:t==='Not counted'?C.amber:C.muted;h.cell.styles.fontStyle='bold'}}}});
 const n=doc.getNumberOfPages();for(let i=1;i<=n;i++){doc.setPage(i);
  if(i>1){doc.setFillColor(...C.navy);doc.rect(0,0,W,11,'F');doc.setFillColor(...C.amber);doc.rect(0,11,W,.8,'F');tx('bold',8.5,C.white);doc.text(`StockWise  |  ${meta.label}`,M,7.2);tx('normal',8,[190,205,228]);doc.text(`${st.company?st.company+'  ·  ':''}${monthLabel(state.period)}`,W-M,7.2,{align:'right'})}
  doc.setDrawColor(...C.line);doc.setLineWidth(.2);doc.line(M,H-10,W-M,H-10);tx('normal',7.2,C.muted);doc.text(`StockWise  ·  ${monthLabel(state.period)}  ·  Confidential management report`,M,H-5.5);doc.text(`Page ${i} of ${n}`,W-M,H-5.5,{align:'right'})}
 doc.save(file);toast(`PDF ready: ${meta.label}.`);
}
function renderAlertBar(){
 const on=!!(state.alertFilter&&ALERTS[state.alertFilter]);$('alertChip').classList.toggle('hidden',!on);$('alertFilter').value=on?state.alertFilter:'';
 if(on)$('alertChipText').innerHTML=`Priority alert filter: <b>${esc(ALERTS[state.alertFilter].label)}</b> · ${(state.viewRows||[]).length.toLocaleString()} item${(state.viewRows||[]).length===1?'':'s'} shown`;
}
function bindAlerts(){
 $('alertsList').addEventListener('click',e=>{
  const v=e.target.closest('[data-alert-view]');if(v){const k=v.dataset.alertView;applyAlertFilter(k);return}
  const x=e.target.closest('[data-alert-export]');if(x){x.closest('details').open=false;exportAlert(x.dataset.alertExport,x.dataset.fmt)}
 });
 $('alertFilter').addEventListener('change',e=>{state.alertFilter=e.target.value||null;renderTable()});
 $('alertChipClear').addEventListener('click',()=>{state.alertFilter=null;$('alertFilter').value='';renderTable()});
 document.querySelectorAll('[data-view-export]').forEach(b=>b.addEventListener('click',()=>{b.closest('details').open=false;exportView(b.dataset.viewExport)}));
 document.addEventListener('click',e=>document.querySelectorAll('details.menu[open]').forEach(d=>{if(!d.contains(e.target))d.open=false}));
 document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('details.menu[open]').forEach(d=>d.open=false)});
 $('clearSessionBtn').addEventListener('click',e=>{e.preventDefault();clearSaved(false)});$('wipeAllBtn').addEventListener('click',e=>{e.preventDefault();clearSaved(true)});
 window.addEventListener('pagehide',()=>{clearTimeout(persistTimer);doPersist()});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){clearTimeout(persistTimer);doPersist()}});
}

/* ---------- remove uploaded / imported files ---------- */
const nameKey=s=>clean(s).toLowerCase().replace(/\s+/g,' ');
function setNotice(html){const n=$('dataNotice');n.innerHTML=html;const b=document.createElement('button');b.className='btn btn-secondary';b.textContent='Load demo data';b.style.marginLeft='8px';b.addEventListener('click',loadSample);n.appendChild(b)}
function resetFileUi(){
 $('inventoryFileName').textContent='Choose stock file';$('inventoryMapping').innerHTML='';$('inventorySheetWrap').classList.add('hidden');$('inventoryFile').value='';
 $('loadInventoryBtn').disabled=true;$('inventoryImportStatus').textContent='';$('inventoryImportStatus').className='import-status';
 state.inventoryWorkbook=null;state.inventoryRows=[];state.inventorySheetName='';
}
function updateFileButtons(){
 const bi=$('removeInventoryBtn');bi.classList.toggle('hidden',!(state.inventoryWorkbook||state.inventory.length));
 bi.textContent=state.inventory.length?'✕ Remove imported stock file':'✕ Clear selected file';
}
function removeFile(){
 if(!state.inventory.length){resetFileUi();state.inventoryFileName='';renderAll();return toast('Selected file cleared.')}
 const man=state.inventory.reduce((a,r)=>a+(r.manual||[]).length,0),adj=state.inventory.filter(r=>r.adjusted).length;
 if(!confirm(`Remove the imported stock file${state.inventoryFileName?` (${state.inventoryFileName})`:''}, ${state.inventory.length.toLocaleString()} items?\n\nThe reconciliation is cleared${man?`, along with ${man} manual ${man===1?'entry':'entries'}`:''}${adj?`${man?' and':', along with'} ${adj} ${adj===1?'recount':'recounts'}`:''}. Saved monthly history is not affected.`))return;
 state.inventory=[];state.rows=[];state.invVal=[];state.cntVal=[];state.unmatched=[];state.importStats={blankInventory:0,blankCounts:0};state.inventoryFileName='';state.alertFilter=null;resetFileUi();saveManualDraft();mcReset();
 reconcile();refreshValidation();setNotice('<strong>Stock file removed:</strong> import a stock file to continue.');renderAll();toast('Stock file removed.');
}

/* ---------- manual entry: duplicate protection ---------- */
let _nm=null;
function twinsOf(r){
 if(!_nm||_nm.src!==state.inventory){const m=new Map();state.inventory.forEach(x=>{const k=nameKey(x.name);if(!k)return;if(!m.has(k))m.set(k,[]);m.get(k).push(x)});_nm={src:state.inventory,m}}
 return (_nm.m.get(nameKey(r.name))||[]).filter(x=>x.sku!==r.sku);
}
function addManual(sku,{qty,expiry,by,notes},mode='add'){
 const i=state.inventory.findIndex(r=>r.sku===sku);if(i<0)return {merged:false,total:qty};const r={...state.inventory[i]};
 if(r.sheetQty===undefined){r.baseCounted=!!r.counted;r.sheetQty=r.counted?n0(r.physicalQty):0}
 const list=[...(r.manual||[])],k=list.findIndex(e=>(e.expiry||'')===(expiry||'')),now=new Date().toISOString();let delta=qty,total=qty,merged=false;
 if(k>=0){const o=list[k];total=mode==='replace'?qty:o.qty+qty;delta=total-o.qty;merged=true;list[k]={...o,qty:total,by:by||o.by,notes:notes||o.notes,at:now}}
 else list.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),qty,expiry:expiry||'',by:by||'',notes:notes||'',at:now});
 r.manual=list;if(r.adjusted){r.physicalQty=Math.max(0,n0(r.physicalQty)+delta);r.counted=true}
 state.inventory[i]=r;applyCounts();saveManualDraft();reconcile();renderAll();return {merged,total};
}
function mcOpenList(){
 const q=$('mcSearch').value,ul=$('mcList');if(!state.inventory.length||!clean(q)){ul.classList.add('hidden');$('mcSearch').setAttribute('aria-expanded','false');return}
 const res=searchItems(q),by=new Map(state.rows.map(r=>[r.sku,r]));state.mc.results=res;state.mc.active=0;
 ul.innerHTML=res.length?res.map((r,i)=>{const x=by.get(r.sku),tw=twinsOf(r);return `<li role="option" id="mcOpt${i}" data-i="${i}" class="${i?'':'active'}" aria-selected="${!i}"><span class="mc-name">${esc(r.name)}</span><span class="mc-sku">${esc(r.sku)}</span><span class="mc-meta">${esc(r.category||'')} · ${x&&x.physicalValid?'counted '+number(x.physicalQty):'not counted'}${x&&x.manualCount?` · ${x.manualCount} manual entr${x.manualCount===1?'y':'ies'}`:''}${tw.length?` <b class="mc-flag">Same name as ${esc(tw.slice(0,2).map(t=>t.sku).join(', '))}</b>`:''}</span></li>`}).join(''):'<li class="mc-none">No matching product in the system inventory.</li>';
 ul.classList.remove('hidden');$('mcSearch').setAttribute('aria-expanded','true');
}
function mcProduct(){
 const x=state.rows.find(r=>r.sku===state.mc.sel);if(!x)return;const blind=$('mcBlind').checked,inv=state.inventory.find(r=>r.sku===x.sku)||{},man=inv.manual||[],tw=twinsOf(x);
 $('mcProduct').innerHTML=`<strong>${esc(x.name)}</strong><span>${esc(x.sku)} · ${esc(x.category||'Uncategorised')}${x.unit?' · '+esc(x.unit):''}</span><div class="mc-facts"><div><small>Counted so far</small><b>${x.physicalValid?number(x.physicalQty):'Not counted'}</b></div><div><small>Manual entries</small><b>${x.manualCount?`${x.manualCount} (${number(x.manualQty)})`:'None'}</b></div><div><small>Expiry on file</small><b>${x.expiry?showDate(x.expiry):'—'}</b></div>${blind?'':`<div><small>System qty</small><b>${number(x.systemQty)}</b></div>`}</div>`
  +(man.length?`<div class="mc-existing"><small>Already entered</small>${man.map(e=>`<span class="mc-chip">${number(e.qty)} · ${e.expiry?'exp '+showDate(e.expiry):'no expiry'}${e.by?' · '+esc(e.by):''}</span>`).join('')}</div>`:'')
  +(x.sheetQty>0?`<p class="mc-warn">Physical quantity in the stock file: <b>${number(x.sheetQty)}</b>. Entries here are added to that count.</p>`:'')
  +(tw.length?`<p class="mc-warn">Same name as ${tw.slice(0,3).map(t=>`${esc(t.sku)} (${(state.rows.find(z=>z.sku===t.sku)||{}).physicalValid?'counted':'not counted'})`).join(', ')}. Make sure this is the right SKU.</p>`:'');
}
function mcAsk(msg,actions){
 const el=$('mcDupe');el.innerHTML=`<p>${msg}</p><div class="mc-dupe-actions">${actions.map((a,i)=>`<button type="button" class="btn ${i?'btn-secondary':'btn-primary'}" data-ask="${i}">${esc(a.label)}</button>`).join('')}<button type="button" class="btn btn-quiet" data-ask="x">Cancel</button></div>`;
 el.classList.remove('hidden');state.mc.ask=actions;
}
function mcSubmit(e){
 e.preventDefault();const sku=state.mc.sel;if(!sku)return;const raw=$('mcQty').value;
 if(clean(raw)===''){toast('Enter the counted quantity (use 0 if nothing is on the shelf).',true);$('mcQty').focus();return}
 const qty=Number(raw);if(!Number.isFinite(qty)||qty<0){toast('Quantity must be zero or more.',true);$('mcQty').focus();return}
 const entry={qty,expiry:$('mcExpiry').value,by:clean($('mcBy').value),notes:clean($('mcNotes').value)};state.lastBy=entry.by;
 const r=state.inventory.find(x=>x.sku===sku),x=state.rows.find(z=>z.sku===sku),exp=entry.expiry||'';
 const same=(r.manual||[]).find(m=>(m.expiry||'')===exp),twins=twinsOf(r).filter(t=>(t.manual||[]).length),onSheet=x&&x.sheetQty>0&&!(r.manual||[]).length;
 const commit=mode=>{const res=addManual(sku,entry,mode);toast(`${res.merged?'Updated':'Added'} ${number(qty)} × ${x.name}${exp?' (expires '+showDate(exp)+')':''}${res.merged?` · entry total ${number(res.total)}`:''}.`);mcReset();$('mcSearch').focus()};
 if(same)return mcAsk(`<b>Duplicate entry.</b> ${esc(x.name)} (${esc(sku)}) already has an entry with ${exp?'expiry '+showDate(exp):'no expiry date'}: <b>${number(same.qty)}</b> units. Adding it again would count the same stock twice.`,[{label:`Add to it (total ${number(same.qty+qty)})`,run:()=>commit('add')},{label:`Replace with ${number(qty)}`,run:()=>commit('replace')}]);
 const n=[];if(onSheet)n.push(`its stock file already records a physical quantity of <b>${number(x.sheetQty)}</b> units (your entry is added to that, giving ${number(x.sheetQty+qty)})`);if(twins.length)n.push(`another SKU with the same name (${twins.map(t=>esc(t.sku)).join(', ')}) already has manual entries`);
 if(n.length)return mcAsk(`<b>Check before adding.</b> ${esc(x.name)}: ${n.join('; and ')}.`,[{label:'Add anyway',run:()=>commit('add')}]);
 commit('add');
}

function bindEvents(){
 document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));
 document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.goto)));
 document.querySelectorAll('[data-metric]').forEach(b=>b.addEventListener('click',()=>{state.chartMetric=b.dataset.metric;renderChart()}));
 $('periodInput').addEventListener('change',e=>{const m=e.target.value;if(!m)return;const found=state.history.find(h=>h.period===m);if(found){loadHistory(m)}else if(m!==state.period){if(state.rows.length&&!confirm('Changing the period will clear the unsaved current data. Continue?')){$('periodInput').value=state.period;return}resetCountState();state.period=m;state.inventory=[];state.rows=[];state.validation=[];renderAll()}});
 $('newPeriodBtn').addEventListener('click',newPeriod);$('createPeriodConfirm').addEventListener('click',e=>{e.preventDefault();createPeriod()});
 $('settingsBtn').addEventListener('click',openSettings);$('saveSettingsBtn').addEventListener('click',e=>{e.preventDefault();applySettings()});
 $('blankPhysicalToggle').addEventListener('change',e=>{state.settings.blankUncounted=e.target.checked;saveSettings();toast(e.target.checked?'Blank physical quantities will be left as not counted the next time a file is read.':'Blank physical quantities will be read as 0 the next time a file is read.')});
 $('inventoryFile').addEventListener('change',e=>setupFile('inventory',e.target.files[0]));
 $('loadInventoryBtn').addEventListener('click',importInventory);
 $('tableSearch').addEventListener('input',renderTable);$('varianceFilter').addEventListener('change',renderTable);$('categoryFilter').addEventListener('change',renderTable);
 document.querySelector('#reconciliationTable thead').addEventListener('click',e=>{const th=e.target.closest('th[data-sort]');if(!th)return;const k=th.dataset.sort,so=state.sort;if(so.key!==k){so.key=k;so.dir='asc'}else if(so.dir==='asc')so.dir='desc';else{so.key='';so.dir='asc'}renderTable()});
 $('reconciliationBody').addEventListener('change',e=>{const i=e.target.closest('[data-recount]');if(i)recount(i.dataset.recount,i.value)});
 $('reconciliationBody').addEventListener('click',e=>{const b=e.target.closest('[data-reset]');if(b)resetRecount(b.dataset.reset)});
 $('exportPdfBtn').addEventListener('click',exportPdf);$('exportExcelBtn').addEventListener('click',exportExcel);$('exportCsvBtn').addEventListener('click',exportCsv);$('downloadTemplateBtn').addEventListener('click',downloadCountTemplate);
 $('savePeriodBtn').addEventListener('click',saveCurrentSnapshot);$('exportHistoryBtn').addEventListener('click',exportHistory);$('historyImportFile').addEventListener('change',e=>importHistory(e.target.files[0]));
 $('historyBody').addEventListener('click',e=>{const load=e.target.closest('[data-load-history]');const del=e.target.closest('[data-delete-history]');if(load)loadHistory(load.dataset.loadHistory);if(del){const p=del.dataset.deleteHistory;if(confirm(`Delete saved snapshot for ${monthLabel(p)} from this browser?`)){state.history=state.history.filter(h=>h.period!==p);saveLocalHistory();renderHistory();toast('Saved snapshot deleted.')}}});
}
function init(){
 readLocalHistory();loadSettings();$('periodInput').value=state.period;$('newPeriodInput').value=state.period;bindEvents();bindNew();renderAll();
 const btn=document.createElement('button');btn.className='btn btn-secondary';btn.textContent='Load demo data';btn.style.marginLeft='8px';btn.addEventListener('click',loadSample);$('dataNotice').appendChild(btn);
 restoreSession();
}
document.addEventListener('DOMContentLoaded',init);
})();
