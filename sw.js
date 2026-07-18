const CACHE='financial-control-v1.1.0';
const ASSETS=['./','index.html','manifest.webmanifest','assets/css/app.css','assets/js/app.js','assets/js/reconciliation-upgrade.js','assets/icons/icon.svg',
'./templates/bank_company_template.csv','./templates/bank_statement_template.csv','./templates/prior_reconciliation_template.csv','./templates/party_statement_template.csv','./templates/budget_actual_template.csv',
'./samples/company_books.csv','./samples/bank_statement.csv','./samples/prior_reconciliation.csv','./samples/party_ours.csv','./samples/party_theirs.csv','./samples/budget.csv','./samples/actual.csv'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(cache=>cache.put(e.request,copy));return r}).catch(()=>caches.match('./index.html'))))});
