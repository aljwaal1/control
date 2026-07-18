'use strict';

(function upgradeBankReconciliation(){
  state.data.bankPrior=state.data.bankPrior||[];
  aliases.side=['الجهة','المصدر','طرف التسوية','side','source'];
  aliases.classification=['التصنيف','نوع الفرق','الحالة','classification','category'];

  const originalFieldsForSlot=fieldsForSlot;
  fieldsForSlot=function(slot){
    if(slot!=='bankPrior')return originalFieldsForSlot(slot);
    return [['','تجاهل'],['date','التاريخ'],['doc','رقم المستند/المرجع'],['desc','البيان'],['debit','مدين'],['credit','دائن'],['amount','المبلغ المباشر'],['balance','الرصيد'],['side','الجهة: دفاتر الشركة/كشف البنك'],['classification','التصنيف']];
  };

  function normalizeSide(v){const x=clean(v);if(/بنك|bank|statement|كشف/.test(x))return'bank';if(/شركة|دفاتر|company|book/.test(x))return'company';return'company'}
  const originalNormalizeMapped=normalizeMapped;
  normalizeMapped=function(p){
    if(p.slot!=='bankPrior')return originalNormalizeMapped(p);
    const rows=p.rawRows.map((r,i)=>{const o={_row:i+1};for(const [h,f] of Object.entries(p.mapping))if(f)o[f]=r[h];return o});
    return rows.map(r=>{const debit=Math.abs(num(r.debit)),credit=Math.abs(num(r.credit));let amount;if(r.amount!==undefined&&String(r.amount).trim()!=='')amount=num(r.amount);else amount=debit-credit;return {date:isoDate(r.date),dateObj:parseDate(r.date),doc:String(r.doc??'').trim(),desc:String(r.desc??'').trim(),debit,credit,amount,balance:num(r.balance),side:normalizeSide(r.side),classification:String(r.classification??'').trim(),row:r._row}}).filter(r=>r.dateObj&&Number.isFinite(r.amount));
  };

  state.data.bankPrior=(state.data.bankPrior||[]).map(r=>({...r,dateObj:parseDate(r.date||r.dateObj),side:normalizeSide(r.side)})).filter(r=>r.dateObj);

  if(!$('bankPriorFile')){
    const bank=$('bank'),grid=bank.querySelector('.grid2');
    if(grid){grid.classList.remove('grid2');grid.classList.add('grid3');grid.insertAdjacentHTML('beforeend','<div class="panel"><h3>تسوية الشهر السابق</h3><label class="upload"><input id="bankPriorFile" type="file" accept=".xlsx,.xls,.csv,.pdf"><b>رفع العمليات المرحلة</b><small>شيكات معلقة، إيداعات بالطريق، رسوم وغيرها</small></label><div id="bankPriorStatus" class="status">اختياري — لم يتم تحميل ملف.</div></div>')}
  }
  if($('bankPriorFile'))$('bankPriorFile').addEventListener('change',e=>{selectFile('bankPrior',e.target.files[0],'bankPriorStatus');e.target.value=''});
  const priorLabel=$('priorRecon')?.closest('.field')?.querySelector('label');if(priorLabel)priorLabel.textContent='فرق افتتاحي يدوي اختياري';
  if($('bankTabs')&&!$('bankTabs').querySelector('[data-view="prior"]'))$('bankTabs').querySelector('[data-view="memo"]')?.insertAdjacentHTML('beforebegin','<button data-view="prior">عمليات الشهر السابق</button>');

  function signedAmount(r,bankStyle=false){if(bankStyle&&(r.debit||r.credit))return r.credit-r.debit;if(!bankStyle&&(r.debit||r.credit))return r.debit-r.credit;return num(r.amount)}
  function matchAdvanced(left,right,{days=3,tolerance=0,opposite=false,bankRight=false}={}){const used=new Set(),matched=[];left.forEach((l,li)=>{let best=null;right.forEach((r,ri)=>{if(used.has(ri))return;const ra=signedAmount(r,bankRight),diff=opposite?Math.abs(l.amount+ra):Math.abs(l.amount-ra),dd=daysBetween(l.dateObj,r.dateObj);if(diff<=tolerance+1e-9&&dd<=days){let score=diff*1000+dd;if(l.doc&&r.doc&&clean(l.doc)===clean(r.doc))score-=10;if(!best||score<best.score)best={ri,r,diff,dd,score}}});if(best){used.add(best.ri);matched.push({left:l,right:best.r,leftIndex:li,rightIndex:best.ri,diff:best.diff,days:best.dd})}});return {matched,leftUnmatched:left.filter((_,i)=>!matched.some(m=>m.leftIndex===i)),rightUnmatched:right.filter((_,i)=>!used.has(i))}}
  function findReason(row,side,otherRows,days,tolerance){const amount=signedAmount(row,side==='bank'),doc=clean(row.doc),candidates=otherRows.map(r=>({r,amount:signedAmount(r,side!=='bank'),dd:daysBetween(row.dateObj,r.dateObj)}));if(doc){const sameDoc=candidates.find(x=>clean(x.r.doc)===doc);if(sameDoc&&Math.abs(amount-sameDoc.amount)>tolerance)return'رقم المستند موجود لكن المبلغ مختلف';if(sameDoc&&sameDoc.dd>days)return'رقم المستند موجود لكن التاريخ خارج المدة'}const sameAmount=candidates.filter(x=>Math.abs(amount-x.amount)<=tolerance);if(sameAmount.some(x=>x.dd>days))return'المبلغ موجود لكن التاريخ خارج المدة';if(sameAmount.some(x=>x.dd<=days))return'يوجد مقابل محتمل لكنه استُخدم في مطابقة أخرى';if(candidates.some(x=>x.dd<=days))return'التاريخ قريب لكن المبلغ مختلف';return'لا يوجد مبلغ مقابل'}
  function classifyDifference(row,side,fromPrior=false){if(fromPrior)return row.classification||'عملية مرحلة من تسوية سابقة';const t=clean(`${row.desc} ${row.doc}`);if(side==='company'){if(/شيك|check|cheque/.test(t))return'شيك معلق';if(/ايداع|إيداع|deposit/.test(t))return'إيداع بالطريق';return'عملية بدفاتر الشركة غير ظاهرة بالبنك'}if(/عمول|رسوم|commission|fee|charge/.test(t))return'عمولة أو رسوم بنكية';if(/فائد|interest/.test(t))return'فوائد بنكية';if(/تحويل|transfer/.test(t))return'تحويل بنكي يحتاج مراجعة';return'عملية بنكية تحتاج قيدًا أو مراجعة'}
  function enrich(rows,side,others,days,tolerance,fromPrior=false){return rows.map(r=>({...r,sourceSide:side,classification:classifyDifference(r,side,fromPrior),reason:fromPrior?'لم تُسوَّ العملية المرحلة في كشوف الشهر الحالي':findReason(r,side,others,days,tolerance),fromPrior}))}
  function analysisRow(r){return [r.date,r.doc,r.desc,fmt(r.debit),fmt(r.credit),fmt(r.amount),{value:r.classification||'',cls:r.fromPrior?'warn':''},r.reason||'']}

  function runBankAdvanced(){
    const company=state.data.bankCompany.map(x=>({...x,amount:signedAmount(x,false)}));
    const bank=state.data.bankStatement.map(x=>({...x,amount:signedAmount(x,true)}));
    const prior=state.data.bankPrior.map(x=>({...x,amount:signedAmount(x,x.side==='bank')}));
    if(!company.length||!bank.length){toast('ارفع ملفي الشركة والبنك أولًا');return}
    const days=num($('bankDays').value),tolerance=num($('bankTolerance').value),priorDays=Math.max(45,days);
    const priorCompany=prior.filter(x=>x.side!=='bank'),priorBank=prior.filter(x=>x.side==='bank');
    const priorCompanyMatch=matchAdvanced(priorCompany,bank,{days:priorDays,tolerance,bankRight:true});
    const usedBank=new Set(priorCompanyMatch.matched.map(m=>m.rightIndex)),bankAfterPrior=bank.filter((_,i)=>!usedBank.has(i));
    const priorBankMatch=matchAdvanced(company,priorBank,{days:priorDays,tolerance,bankRight:true});
    const usedCompany=new Set(priorBankMatch.matched.map(m=>m.leftIndex)),companyAfterPrior=company.filter((_,i)=>!usedCompany.has(i));
    const current=matchAdvanced(companyAfterPrior,bankAfterPrior,{days,tolerance,bankRight:true});
    const currentCompany=enrich(current.leftUnmatched,'company',bankAfterPrior,days,tolerance),currentBank=enrich(current.rightUnmatched,'bank',companyAfterPrior,days,tolerance);
    const priorCompanyOpen=enrich(priorCompanyMatch.leftUnmatched,'company',bank,days,tolerance,true),priorBankOpen=enrich(priorBankMatch.rightUnmatched,'bank',company,days,tolerance,true);
    const priorCleared=[...priorCompanyMatch.matched.map(m=>({...m,priorSide:'company'})),...priorBankMatch.matched.map(m=>({left:m.right,right:m.left,diff:m.diff,days:m.days,priorSide:'bank'}))];
    const leftUnmatched=[...currentCompany,...priorCompanyOpen],rightUnmatched=[...currentBank,...priorBankOpen];
    const companySum=currentCompany.reduce((s,x)=>s+x.amount,0),bankSum=currentBank.reduce((s,x)=>s+x.amount,0),priorCompanySum=priorCompanyOpen.reduce((s,x)=>s+x.amount,0),priorBankSum=priorBankOpen.reduce((s,x)=>s+x.amount,0);
    const companyClosing=num($('companyClosing').value),bankClosing=num($('bankClosing').value),manualPrior=num($('priorRecon').value),adjustedCompany=companyClosing+bankSum+priorBankSum,adjustedBank=bankClosing+companySum+priorCompanySum+manualPrior,difference=adjustedCompany-adjustedBank;
    state.bankResult={matched:current.matched,leftUnmatched,rightUnmatched,priorCleared,priorUnresolved:[...priorCompanyOpen,...priorBankOpen],memo:{companyClosing,bankClosing,manualPrior,companySum,bankSum,priorCompanySum,priorBankSum,adjustedCompany,adjustedBank,difference}};
    summaryCards('bankSummary',[['مطابق هذا الشهر',current.matched.length],['مسوّى من السابق',priorCleared.length],['فروقات حالية',currentCompany.length+currentBank.length],['مرحّل غير مسوّى',priorCompanyOpen.length+priorBankOpen.length],['فرق التسوية',fmt(difference)]]);
    renderBankAdvanced('matched');setActiveTab('bankTabs','matched');
    state.latest={type:'bank',title:'تقرير التسوية البنكية',headers:['التاريخ','المستند','البيان','المبلغ','التصنيف','سبب الحالة'],rows:[...current.matched.map(m=>[m.left.date,m.left.doc,m.left.desc,fmt(m.left.amount),'مطابق',`فرق أيام: ${m.days}`]),...leftUnmatched.map(r=>[r.date,r.doc,r.desc,fmt(r.amount),r.classification,r.reason]),...rightUnmatched.map(r=>[r.date,r.doc,r.desc,fmt(r.amount),r.classification,r.reason])],summary:[['مطابق هذا الشهر',current.matched.length],['مسوّى من السابق',priorCleared.length],['مرحّل غير مسوّى',priorCompanyOpen.length+priorBankOpen.length],['فرق التسوية',fmt(difference)]]};updateReport();toast('اكتملت التسوية البنكية المتقدمة')
  }

  function renderBankAdvanced(view){const r=state.bankResult;if(!r){table('bankHead','bankBody',['الحالة'],[]);return}if(view==='matched')table('bankHead','bankBody',['تاريخ الشركة','مستند الشركة','البيان','تاريخ البنك','مرجع البنك','المبلغ','فرق الأيام'],r.matched.map(m=>[m.left.date,m.left.doc,m.left.desc,m.right.date,m.right.doc,fmt(m.left.amount),m.days]));else if(view==='company')table('bankHead','bankBody',['التاريخ','المستند','البيان','مدين','دائن','المبلغ','التصنيف','سبب عدم المطابقة'],r.leftUnmatched.map(analysisRow));else if(view==='bank')table('bankHead','bankBody',['التاريخ','المرجع','البيان','مدين','دائن','المبلغ','التصنيف','سبب عدم المطابقة'],r.rightUnmatched.map(analysisRow));else if(view==='prior')table('bankHead','bankBody',['الحالة','الجهة','التاريخ','المستند','البيان','المبلغ','التصنيف/السبب'],[...r.priorCleared.map(m=>['تمت التسوية',m.priorSide==='bank'?'كشف البنك':'دفاتر الشركة',m.left.date,m.left.doc,m.left.desc,fmt(m.left.amount),`ظهر في الشهر الحالي بعد ${m.days} يوم`]),...r.priorUnresolved.map(x=>['ما زالت معلقة',x.sourceSide==='bank'?'كشف البنك':'دفاتر الشركة',x.date,x.doc,x.desc,fmt(x.amount),`${x.classification} — ${x.reason}`])]);else{const m=r.memo;table('bankHead','bankBody',['البند','القيمة'],[['رصيد دفاتر الشركة',fmt(m.companyClosing)],['فروقات كشف البنك الحالية غير المسجلة بالدفاتر',fmt(m.bankSum)],['فروقات كشف البنك المرحلة غير المسجلة',fmt(m.priorBankSum)],['الرصيد المعدل للدفاتر',fmt(m.adjustedCompany)],['رصيد كشف البنك',fmt(m.bankClosing)],['عمليات الشركة الحالية غير الظاهرة بالبنك',fmt(m.companySum)],['عمليات الشركة المرحلة غير الظاهرة بالبنك',fmt(m.priorCompanySum)],['فرق افتتاحي يدوي اختياري',fmt(m.manualPrior)],['الرصيد المعدل للبنك',fmt(m.adjustedBank)],['الفرق النهائي',{value:fmt(m.difference),cls:Math.abs(m.difference)<.01?'good':'bad'}]])}}

  const runOld=$('runBank'),runNew=runOld.cloneNode(true);runOld.replaceWith(runNew);runNew.addEventListener('click',runBankAdvanced);
  const tabsOld=$('bankTabs'),tabsNew=tabsOld.cloneNode(true);tabsOld.replaceWith(tabsNew);tabsNew.addEventListener('click',e=>{if(e.target.dataset.view){setActiveTab('bankTabs',e.target.dataset.view);renderBankAdvanced(e.target.dataset.view)}});
  const sampleOld=$('bankSample'),sampleNew=sampleOld.cloneNode(true);sampleOld.replaceWith(sampleNew);sampleNew.addEventListener('click',async()=>{await Promise.all([setSample('bankCompany','samples/company_books.csv','bankCompanyStatus'),setSample('bankStatement','samples/bank_statement.csv','bankStatementStatus'),setSample('bankPrior','samples/prior_reconciliation.csv','bankPriorStatus')]);$('companyClosing').value=10465;$('bankClosing').value=9780;$('priorRecon').value=0;saveState();runBankAdvanced()});
})();
