'use strict';

const state={
  data:{bankCompany:[],bankStatement:[],partyOurs:[],partyTheirs:[],budget:[],actual:[]},
  pending:null,
  latest:{type:'',title:'',headers:[],rows:[],summary:[],html:''},
  bankResult:null,partyResult:null,budgetResult:null,budgetChart:null,
  deferredPrompt:null
};
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const num=v=>{if(typeof v==='number')return Number.isFinite(v)?v:0;let s=String(v??'').trim().replace(/[,$€£¥%\s]/g,'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));if(/^\(.*\)$/.test(s))s='-'+s.slice(1,-1);if(s.includes(',')&&!s.includes('.'))s=s.replace(',','.');else s=s.replace(/,/g,'');const n=Number(s);return Number.isFinite(n)?n:0};
const fmt=v=>Number(v||0).toLocaleString('en-US',{maximumFractionDigits:2});
const pct=v=>`${Number(v||0).toFixed(2)}%`;
const clean=s=>String(s??'').trim().toLowerCase().replace(/[ـ_\-]+/g,' ').replace(/\s+/g,' ');
const dayMs=86400000;

function toast(msg){const t=$('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.add('hidden'),2600)}
function setStatus(id,msg,type=''){const e=$(id);e.textContent=msg;e.className=`status ${type}`.trim()}
function goPage(page){document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===page));document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===page));$('sidebar').classList.remove('open');window.scrollTo({top:0,behavior:'smooth'})}
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>goPage(b.dataset.page)));
$('menuBtn').addEventListener('click',()=>$('sidebar').classList.toggle('open'));

function parseCsv(text){
  const rows=[];let row=[],cell='',q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],n=text[i+1];
    if(c==='"'&&q&&n==='"'){cell+='"';i++;continue}
    if(c==='"'){q=!q;continue}
    if((c===','||c===';'||c==='\t')&&!q){row.push(cell.trim());cell='';continue}
    if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&n==='\n')i++;row.push(cell.trim());cell='';if(row.some(v=>v!==''))rows.push(row);row=[];continue}
    cell+=c;
  }
  row.push(cell.trim());if(row.some(v=>v!==''))rows.push(row);
  if(!rows.length)return[];
  const headers=rows.shift().map((h,i)=>h||`عمود ${i+1}`);
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}

function textLinesToRows(text){
  const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const arrays=lines.map(line=>line.split(/\t|\s{2,}|\s*\|\s*/).map(x=>x.trim()).filter(Boolean));
  const max=Math.max(1,...arrays.map(r=>r.length));
  const headers=Array.from({length:max},(_,i)=>`عمود ${i+1}`);
  return arrays.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}

async function readPdf(file){
  const pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const buffer=await file.arrayBuffer();
  const pdf=await pdfjs.getDocument({data:buffer}).promise;
  const all=[];
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p),content=await page.getTextContent();
    const groups=new Map();
    content.items.forEach(it=>{const y=Math.round(it.transform[5]);if(!groups.has(y))groups.set(y,[]);groups.get(y).push({x:it.transform[4],s:it.str})});
    [...groups.entries()].sort((a,b)=>b[0]-a[0]).forEach(([,items])=>{const arr=items.sort((a,b)=>a.x-b.x).map(x=>x.s.trim()).filter(Boolean);if(arr.length)all.push(arr)});
  }
  const max=Math.max(1,...all.map(r=>r.length)),headers=Array.from({length:max},(_,i)=>`عمود ${i+1}`);
  return {rows:all.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??'']))),pdf,buffer};
}

async function ocrPending(){
  if(!state.pending?.file)return;
  try{
    $('runOcr').disabled=true;$('ocrStatus').textContent='جاري قراءة صفحات PDF...';
    const pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
    const pdf=await pdfjs.getDocument({data:await state.pending.file.arrayBuffer()}).promise;
    const texts=[],limit=Math.min(pdf.numPages,12);
    for(let p=1;p<=limit;p++){
      $('ocrStatus').textContent=`OCR للصفحة ${p} من ${limit}`;
      const page=await pdf.getPage(p),viewport=page.getViewport({scale:1.7});
      const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      const result=await Tesseract.recognize(canvas,'ara+eng',{logger:m=>{if(m.status==='recognizing text')$('ocrStatus').textContent=`الصفحة ${p}: ${Math.round((m.progress||0)*100)}%`}});
      texts.push(result.data.text);
    }
    const rows=textLinesToRows(texts.join('\n'));
    if(!rows.length)throw new Error('لم يتم استخراج نص');
    state.pending.rawRows=rows;state.pending.headers=Object.keys(rows[0]);state.pending.mapping=autoMapping(state.pending.slot,state.pending.headers);
    renderMapping();$('ocrStatus').textContent=`تم استخراج ${rows.length} سطرًا. راجع التعيين.`;
  }catch(e){$('ocrStatus').textContent=`تعذر OCR: ${e.message}`}
  finally{$('runOcr').disabled=false}
}
$('runOcr').addEventListener('click',ocrPending);

async function readFile(file){
  const ext=file.name.split('.').pop().toLowerCase();
  if(ext==='csv'||ext==='txt')return {rows:parseCsv(await file.text()),isPdf:false};
  if(ext==='xlsx'||ext==='xls'){
    if(typeof XLSX==='undefined')throw new Error('مكتبة Excel لم تُحمّل. اتصل بالإنترنت مرة واحدة.');
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});
    const rows=[];wb.SheetNames.forEach(name=>rows.push(...XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:'',raw:false})));
    return {rows,isPdf:false};
  }
  if(ext==='pdf'){const r=await readPdf(file);return {rows:r.rows,isPdf:true,pdf:r.pdf}}
  throw new Error('صيغة غير مدعومة');
}

const aliases={
  date:['التاريخ','تاريخ','date','transaction date','posting date'],doc:['رقم المستند','رقم المرجع','مرجع','document','reference','ref','voucher','رقم الشيك'],desc:['البيان','الوصف','description','details','narration','memo'],debit:['مدين','debit','withdrawal','سحب'],credit:['دائن','credit','deposit','إيداع','ايداع'],amount:['المبلغ','القيمة','amount','value','net amount'],balance:['الرصيد','balance'],period:['الفترة','الشهر','السنة','period','month','year'],account:['الحساب','اسم الحساب','البند','account','item'],department:['القسم','department','section'],costCenter:['مركز التكلفة','cost center','costcenter']
};
function fieldForHeader(h){const x=clean(h);for(const [f,arr] of Object.entries(aliases))if(arr.some(a=>x===clean(a)||x.includes(clean(a))))return f;return''}
function fieldsForSlot(slot){return slot==='budget'||slot==='actual'?[['','تجاهل'],['period','الفترة'],['account','الحساب'],['department','القسم'],['costCenter','مركز التكلفة'],['amount','المبلغ']]:[['','تجاهل'],['date','التاريخ'],['doc','رقم المستند/المرجع'],['desc','البيان'],['debit','مدين'],['credit','دائن'],['amount','المبلغ المباشر'],['balance','الرصيد']]}
function autoMapping(slot,headers){const allowed=new Set(fieldsForSlot(slot).map(x=>x[0]));const used=new Set();const map={};headers.forEach(h=>{let f=fieldForHeader(h);if(!allowed.has(f)||used.has(f))f='';map[h]=f;if(f)used.add(f)});return map}

async function selectFile(slot,file,statusId){
  if(!file)return;
  setStatus(statusId,`جاري قراءة ${file.name}...`);
  try{
    const parsed=await readFile(file);if(!parsed.rows.length)throw new Error('لا توجد صفوف قابلة للقراءة');
    const headers=[...new Set(parsed.rows.flatMap(r=>Object.keys(r)))];
    state.pending={slot,file,statusId,rawRows:parsed.rows,headers,mapping:autoMapping(slot,headers),isPdf:parsed.isPdf};
    renderMapping();$('mappingModal').classList.remove('hidden');document.body.style.overflow='hidden';
  }catch(e){setStatus(statusId,`تعذر قراءة الملف: ${e.message}`,'bad')}
}

const fileBindings=[['bankCompanyFile','bankCompany','bankCompanyStatus'],['bankStatementFile','bankStatement','bankStatementStatus'],['partyOursFile','partyOurs','partyOursStatus'],['partyTheirsFile','partyTheirs','partyTheirsStatus'],['budgetFile','budget','budgetStatus'],['actualFile','actual','actualStatus']];
fileBindings.forEach(([id,slot,status])=>$(id).addEventListener('change',e=>{selectFile(slot,e.target.files[0],status);e.target.value=''}));

function renderMapping(){
  const p=state.pending;if(!p)return;
  $('mappingInfo').textContent=`${p.file.name} — ${p.rawRows.length} صف — ${p.headers.length} عمود`;
  $('pdfOptions').classList.toggle('hidden',!p.isPdf);
  const opts=fieldsForSlot(p.slot);
  $('mappingGrid').innerHTML=p.headers.map(h=>{const samples=p.rawRows.slice(0,3).map(r=>r[h]).filter(v=>v!==''&&v!=null).join(' • ');return `<div class="map-row"><div><b title="${esc(h)}">${esc(h)}</b><small title="${esc(samples)}">${esc(samples||'لا توجد عينة')}</small></div><select data-header="${esc(h)}">${opts.map(([v,l])=>`<option value="${v}" ${p.mapping[h]===v?'selected':''}>${l}</option>`).join('')}</select></div>`}).join('');
  document.querySelectorAll('#mappingGrid select').forEach(s=>s.addEventListener('change',()=>{const f=s.value;if(f)document.querySelectorAll('#mappingGrid select').forEach(o=>{if(o!==s&&o.value===f){o.value='';p.mapping[o.dataset.header]=''}});p.mapping[s.dataset.header]=f;validateMapping()}));
  $('mapHead').innerHTML=`<tr>${p.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr>`;
  $('mapBody').innerHTML=p.rawRows.slice(0,8).map(r=>`<tr>${p.headers.map(h=>`<td>${esc(r[h])}</td>`).join('')}</tr>`).join('');validateMapping();
}
function validateMapping(){const p=state.pending;if(!p)return false;const vals=Object.values(p.mapping);let ok,msg;if(p.slot==='budget'||p.slot==='actual'){ok=vals.includes('period')&&vals.includes('account')&&vals.includes('amount');msg=ok?'التعيين مكتمل.':'يجب تحديد الفترة والحساب والمبلغ.'}else{ok=vals.includes('date')&&(vals.includes('amount')||(vals.includes('debit')||vals.includes('credit')));msg=ok?'التعيين مكتمل.':'يجب تحديد التاريخ والمبلغ، أو المدين/الدائن.'}$('mapValidation').textContent=msg;$('mapValidation').className=`status ${ok?'good':'bad'}`;$('confirmMapping').disabled=!ok;return ok}
$('closeMapping').addEventListener('click',closeMapping);function closeMapping(){$('mappingModal').classList.add('hidden');document.body.style.overflow='';state.pending=null}

function parseDate(v){
  if(v instanceof Date&&!isNaN(v))return v;
  if(typeof v==='number'&&v>20000){const d=new Date((v-25569)*dayMs);return isNaN(d)?null:d}
  const s=String(v??'').trim();if(!s)return null;
  const m=s.match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})/);if(m){let a=+m[1],b=+m[2],c=+m[3],y,mo,d;if(a>1900){y=a;mo=b;d=c}else if(c>1900){y=c;mo=b;d=a}else{y=2000+c;mo=b;d=a}const out=new Date(y,mo-1,d);return isNaN(out)?null:out}
  const out=new Date(s);return isNaN(out)?null:out;
}
function isoDate(v){const d=parseDate(v);return d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`:''}
function normalizeMapped(p){
  const rows=p.rawRows.map((r,i)=>{const o={_row:i+1};for(const [h,f] of Object.entries(p.mapping))if(f)o[f]=r[h];return o});
  if(p.slot==='budget'||p.slot==='actual')return rows.map(r=>({period:String(r.period??'').trim(),account:String(r.account??'').trim(),department:String(r.department??'').trim(),costCenter:String(r.costCenter??'').trim(),amount:num(r.amount),row:r._row})).filter(r=>r.period&&r.account&&Number.isFinite(r.amount));
  return rows.map(r=>{const debit=Math.abs(num(r.debit)),credit=Math.abs(num(r.credit));let amount;if(r.amount!==undefined&&String(r.amount).trim()!=='')amount=num(r.amount);else amount=debit-credit;return {date:isoDate(r.date),dateObj:parseDate(r.date),doc:String(r.doc??'').trim(),desc:String(r.desc??'').trim(),debit,credit,amount,balance:num(r.balance),row:r._row}}).filter(r=>r.dateObj&&Number.isFinite(r.amount));
}
$('confirmMapping').addEventListener('click',()=>{if(!validateMapping())return;const p=state.pending,rows=normalizeMapped(p);state.data[p.slot]=rows;setStatus(p.statusId,`تم اعتماد ${rows.length} صف من ${p.file.name}`,'good');saveState();closeMapping();toast('تم اعتماد البيانات')});

function daysBetween(a,b){return Math.abs(a-b)/dayMs}
function matchTransactions(left,right,{days=3,tolerance=0,opposite=false,bankRight=false}={}){
  const used=new Set(),matched=[];
  left.forEach((l,li)=>{
    let best=null;
    right.forEach((r,ri)=>{if(used.has(ri))return;let ra=r.amount;if(bankRight&&!(r.debit===0&&r.credit===0))ra=r.credit-r.debit;const diff=opposite?Math.abs(l.amount+ra):Math.abs(l.amount-ra);const dd=daysBetween(l.dateObj,r.dateObj);if(diff<=tolerance+1e-9&&dd<=days){let score=diff*1000+dd;if(l.doc&&r.doc&&clean(l.doc)===clean(r.doc))score-=10;if(!best||score<best.score)best={ri,r,ra,diff,dd,score}}});
    if(best){used.add(best.ri);matched.push({left:l,right:best.r,leftIndex:li,rightIndex:best.ri,diff:best.diff,days:best.dd})}
  });
  return {matched,leftUnmatched:left.filter((_,i)=>!matched.some(m=>m.leftIndex===i)),rightUnmatched:right.filter((_,i)=>!used.has(i))};
}

function summaryCards(id,items){$(id).innerHTML=items.map(x=>`<div><span>${esc(x[0])}</span><b>${esc(x[1])}</b></div>`).join('')}
function table(idHead,idBody,headers,rows){$(idHead).innerHTML=`<tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr>`;$(idBody).innerHTML=rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${typeof c==='object'?`<span class="tag ${c.cls||''}">${esc(c.value)}</span>`:esc(c)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">لا توجد بيانات.</td></tr>`}
function transRow(r){return [r.date,r.doc,r.desc,fmt(r.debit),fmt(r.credit),fmt(r.amount)]}

function runBank(){
  let company=state.data.bankCompany,bank=state.data.bankStatement;if(!company.length||!bank.length){toast('ارفع ملفي الشركة والبنك أولًا');return}
  company=company.map(x=>({...x,amount:(x.debit||x.credit)?x.debit-x.credit:x.amount}));
  const result=matchTransactions(company,bank,{days:num($('bankDays').value),tolerance:num($('bankTolerance').value),bankRight:true});state.bankResult=result;
  const companySum=result.leftUnmatched.reduce((s,x)=>s+x.amount,0),bankSum=result.rightUnmatched.reduce((s,x)=>s+((x.debit||x.credit)?x.credit-x.debit:x.amount),0);
  const companyClosing=num($('companyClosing').value),bankClosing=num($('bankClosing').value),prior=num($('priorRecon').value);
  const adjustedCompany=companyClosing+bankSum,adjustedBank=bankClosing+companySum+prior,difference=adjustedCompany-adjustedBank;
  result.memo={companyClosing,bankClosing,prior,companySum,bankSum,adjustedCompany,adjustedBank,difference};
  summaryCards('bankSummary',[['العمليات المطابقة',result.matched.length],['غير مطابق بالشركة',result.leftUnmatched.length],['غير مطابق بالبنك',result.rightUnmatched.length],['فرق التسوية',fmt(difference)]]);
  renderBankView('matched');setActiveTab('bankTabs','matched');
  state.latest={type:'bank',title:'تقرير التسوية البنكية',headers:['تاريخ الشركة','مستند الشركة','تاريخ البنك','مرجع البنك','المبلغ'],rows:result.matched.map(m=>[m.left.date,m.left.doc,m.right.date,m.right.doc,fmt(m.left.amount)]),summary:[['المطابق',result.matched.length],['فرق التسوية',fmt(difference)]]};updateReport();toast('اكتملت التسوية البنكية')
}
$('runBank').addEventListener('click',runBank);
function renderBankView(view){const r=state.bankResult;if(!r){table('bankHead','bankBody',['الحالة'],[]);return}if(view==='matched')table('bankHead','bankBody',['تاريخ الشركة','مستند الشركة','البيان','تاريخ البنك','مرجع البنك','المبلغ','فرق الأيام'],r.matched.map(m=>[m.left.date,m.left.doc,m.left.desc,m.right.date,m.right.doc,fmt(m.left.amount),m.days]));else if(view==='company')table('bankHead','bankBody',['التاريخ','المستند','البيان','مدين','دائن','المبلغ'],r.leftUnmatched.map(transRow));else if(view==='bank')table('bankHead','bankBody',['التاريخ','المرجع','البيان','مدين','دائن','المبلغ'],r.rightUnmatched.map(transRow));else{const m=r.memo;table('bankHead','bankBody',['البند','القيمة'],[['رصيد دفاتر الشركة',fmt(m.companyClosing)],['عمليات البنك غير المسجلة بالدفاتر',fmt(m.bankSum)],['الرصيد المعدل للدفاتر',fmt(m.adjustedCompany)],['رصيد كشف البنك',fmt(m.bankClosing)],['عمليات الشركة غير الظاهرة بالبنك',fmt(m.companySum)],['تسوية الشهر السابق',fmt(m.prior)],['الرصيد المعدل للبنك',fmt(m.adjustedBank)],['الفرق النهائي',{value:fmt(m.difference),cls:Math.abs(m.difference)<.01?'good':'bad'}]])}}
function setActiveTab(id,v){document.querySelectorAll(`#${id} button`).forEach(b=>b.classList.toggle('active',b.dataset.view===v))}
$('bankTabs').addEventListener('click',e=>{if(e.target.dataset.view){setActiveTab('bankTabs',e.target.dataset.view);renderBankView(e.target.dataset.view)}});

function runParties(){const ours=state.data.partyOurs.map(x=>({...x,amount:(x.debit||x.credit)?x.debit-x.credit:x.amount})),theirs=state.data.partyTheirs.map(x=>({...x,amount:(x.debit||x.credit)?x.debit-x.credit:x.amount}));if(!ours.length||!theirs.length){toast('ارفع الكشفين أولًا');return}const r=matchTransactions(ours,theirs,{days:num($('partyDays').value),tolerance:num($('partyTolerance').value),opposite:true});state.partyResult=r;const oursAmt=r.leftUnmatched.reduce((s,x)=>s+x.amount,0),theirsAmt=r.rightUnmatched.reduce((s,x)=>s+x.amount,0);summaryCards('partySummary',[['المطابق',r.matched.length],['غير مطابق لدينا',r.leftUnmatched.length],['غير مطابق لديهم',r.rightUnmatched.length],['صافي الفرق',fmt(oursAmt+theirsAmt)]]);renderPartyView('matched');setActiveTab('partyTabs','matched');state.latest={type:'parties',title:`تقرير مطابقة ${$('partyType').value==='customer'?'عميل':'مورد'}`,headers:['تاريخنا','مستندنا','تاريخ الطرف الآخر','مستنده','المبلغ'],rows:r.matched.map(m=>[m.left.date,m.left.doc,m.right.date,m.right.doc,fmt(Math.abs(m.left.amount))]),summary:[['المطابق',r.matched.length],['غير مطابق لدينا',r.leftUnmatched.length],['غير مطابق لديهم',r.rightUnmatched.length]]};updateReport();toast('اكتملت مطابقة الحساب')}
$('runParties').addEventListener('click',runParties);
function renderPartyView(v){const r=state.partyResult;if(!r){table('partyHead','partyBody',['الحالة'],[]);return}if(v==='matched')table('partyHead','partyBody',['تاريخنا','مستندنا','البيان','تاريخ الطرف الآخر','مستنده','المبلغ','فرق الأيام'],r.matched.map(m=>[m.left.date,m.left.doc,m.left.desc,m.right.date,m.right.doc,fmt(Math.abs(m.left.amount)),m.days]));else if(v==='ours')table('partyHead','partyBody',['التاريخ','المستند','البيان','مدين','دائن','المبلغ'],r.leftUnmatched.map(transRow));else table('partyHead','partyBody',['التاريخ','المستند','البيان','مدين','دائن','المبلغ'],r.rightUnmatched.map(transRow))}
$('partyTabs').addEventListener('click',e=>{if(e.target.dataset.view){setActiveTab('partyTabs',e.target.dataset.view);renderPartyView(e.target.dataset.view)}});

function runBudget(){const budget=state.data.budget,actual=state.data.actual;if(!budget.length||!actual.length){toast('ارفع الموازنة والفعلي أولًا');return}const key=$('budgetGroup').value,label={account:'الحساب',period:'الفترة',department:'القسم',costCenter:'مركز التكلفة'}[key];const b=new Map(),a=new Map();budget.forEach(r=>b.set(r[key]||'غير محدد',(b.get(r[key]||'غير محدد')||0)+r.amount));actual.forEach(r=>a.set(r[key]||'غير محدد',(a.get(r[key]||'غير محدد')||0)+r.amount));const keys=[...new Set([...b.keys(),...a.keys()])];const rows=keys.map(k=>{const bv=b.get(k)||0,av=a.get(k)||0,v=av-bv,p=bv?v/Math.abs(bv)*100:0;return {key:k,budget:bv,actual:av,variance:v,percent:p}}).sort((x,y)=>Math.abs(y.variance)-Math.abs(x.variance));state.budgetResult=rows;const tb=rows.reduce((s,x)=>s+x.budget,0),ta=rows.reduce((s,x)=>s+x.actual,0),tv=ta-tb;summaryCards('budgetSummary',[['إجمالي الموازنة',fmt(tb)],['إجمالي الفعلي',fmt(ta)],['الانحراف',fmt(tv)],['نسبة الانحراف',pct(tb?tv/Math.abs(tb)*100:0)]]);table('budgetHead','budgetBody',[label,'الموازنة','الفعلي','الانحراف','نسبة الانحراف','الحالة'],rows.map(x=>[x.key,fmt(x.budget),fmt(x.actual),fmt(x.variance),pct(x.percent),{value:x.variance<=0?'ضمن الموازنة':'تجاوز',cls:x.variance<=0?'good':'bad'}]));renderBudgetChart(rows,label);$('budgetInsights').innerHTML=rows.slice(0,5).map(x=>`<p><b>${esc(x.key)}</b>: انحراف ${fmt(x.variance)} (${pct(x.percent)})</p>`).join('')||'<p>لا توجد بيانات.</p>';state.latest={type:'budget',title:'تقرير الموازنة مقابل الفعلي',headers:[label,'الموازنة','الفعلي','الانحراف','النسبة'],rows:rows.map(x=>[x.key,fmt(x.budget),fmt(x.actual),fmt(x.variance),pct(x.percent)]),summary:[['إجمالي الموازنة',fmt(tb)],['إجمالي الفعلي',fmt(ta)],['الانحراف',fmt(tv)]]};updateReport();toast('اكتمل تحليل الموازنة')}
$('runBudget').addEventListener('click',runBudget);
function renderBudgetChart(rows,label){if(state.budgetChart)state.budgetChart.destroy();if(typeof Chart==='undefined')return;state.budgetChart=new Chart($('budgetChart'),{type:'bar',data:{labels:rows.slice(0,12).map(x=>x.key),datasets:[{label:'الموازنة',data:rows.slice(0,12).map(x=>x.budget)},{label:'الفعلي',data:rows.slice(0,12).map(x=>x.actual)}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true}},indexAxis:rows.length>6?'y':'x'}})}

async function loadCsv(path){return parseCsv(await (await fetch(path)).text())}
async function setSample(slot,path,status){const raw=await loadCsv(path),headers=Object.keys(raw[0]||{}),p={slot,file:{name:path.split('/').pop()},statusId:status,rawRows:raw,headers,mapping:autoMapping(slot,headers),isPdf:false};state.data[slot]=normalizeMapped(p);setStatus(status,`تم تحميل ${state.data[slot].length} صف تجريبي.`,'good')}
$('bankSample').addEventListener('click',async()=>{await Promise.all([setSample('bankCompany','samples/company_books.csv','bankCompanyStatus'),setSample('bankStatement','samples/bank_statement.csv','bankStatementStatus')]);$('companyClosing').value=10450;$('bankClosing').value=10025;runBank()});
$('partySample').addEventListener('click',async()=>{await Promise.all([setSample('partyOurs','samples/party_ours.csv','partyOursStatus'),setSample('partyTheirs','samples/party_theirs.csv','partyTheirsStatus')]);runParties()});
$('budgetSample').addEventListener('click',async()=>{await Promise.all([setSample('budget','samples/budget.csv','budgetStatus'),setSample('actual','samples/actual.csv','actualStatus')]);runBudget()});

function updateReport(){const l=state.latest;if(!l.title)return;$('reportContent').innerHTML=`<h2>${esc(l.title)}</h2><p>تاريخ التقرير: ${new Date().toLocaleDateString('ar-JO')}</p><div class="summary-box">${l.summary.map(x=>`<div><span>${esc(x[0])}</span><b>${esc(x[1])}</b></div>`).join('')}</div><h3>التفاصيل</h3><div class="table-wrap"><table><thead><tr>${l.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${l.rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}
function download(name,content,type='text/csv;charset=utf-8'){const b=new Blob([content],{type}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
$('exportCsv').addEventListener('click',()=>{const l=state.latest;if(!l.rows.length){toast('لا توجد نتائج للتصدير');return}const csv='\ufeff'+[l.headers,...l.rows].map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');download(`${l.type||'results'}.csv`,csv)});
$('exportXlsx').addEventListener('click',()=>{const l=state.latest;if(!l.rows.length){toast('لا توجد نتائج للتصدير');return}if(typeof XLSX==='undefined'){toast('مكتبة Excel غير متاحة');return}const ws=XLSX.utils.aoa_to_sheet([l.headers,...l.rows]),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'النتائج');XLSX.writeFile(wb,`${l.type||'results'}.xlsx`)});
$('printReport').addEventListener('click',()=>{if(!state.latest.rows.length){toast('لا يوجد تقرير بعد');return}goPage('reports');setTimeout(()=>window.print(),250)});

function saveState(){try{localStorage.setItem('financialControlData',JSON.stringify(state.data))}catch{}}
function restoreState(){try{const d=JSON.parse(localStorage.getItem('financialControlData')||'null');if(d)Object.assign(state.data,d)}catch{}}
restoreState();

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.deferredPrompt=e;$('installBtn').classList.remove('hidden')});
$('installBtn').addEventListener('click',async()=>{if(!state.deferredPrompt)return;state.deferredPrompt.prompt();await state.deferredPrompt.userChoice;state.deferredPrompt=null;$('installBtn').classList.add('hidden')});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

table('bankHead','bankBody',['الحالة'],[]);table('partyHead','partyBody',['الحالة'],[]);table('budgetHead','budgetBody',['الحالة'],[]);
