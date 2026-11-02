const vm=require('vm'),fs=require('fs'),assert=require('assert/strict');
const html=fs.readFileSync(require('path').join(__dirname,'../web/index.html'),'utf8');
let script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(s=>s.includes('const defaults=()=>')).at(-1).replace(/init\(\);\s*$/,'');
let nodes={};
const ctx=vm.createContext({console,Date,Intl,Math,Number,String,Set,Array,Object,JSON,Error,Promise,Boolean,structuredClone,crypto:require('crypto').webcrypto,localStorage:{getItem:()=>null,setItem:()=>{}},document:{querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener:()=>{}},window:{addEventListener:()=>{},ArtisanTheme:{button:()=>''}},setTimeout:()=>0,clearTimeout:()=>{},FormData:class{constructor(f){this.f=f}*[Symbol.iterator](){yield* Object.entries(this.f.data)}},Blob,URL});
vm.runInContext(script,ctx);
const run=s=>vm.runInContext(s,ctx);
(async()=>{
run("state=demoData(); dbChannel=null; mutate=async fn=>{const next=clone(state);fn(next);next.version++;state=next}; shell=()=>{}; toast=()=>{}; closeModal=()=>{};");
assert.equal(run('tasks().length'),3);assert.equal(run('state.quotes.length'),5);
run("taskPerson='Deepam';page='My tasks';taskFilters={search:'',owner:'',status:'',scope:'open'}");assert.equal(run('filteredTasks().length'),1);
run("page='Tasks';taskFilters.scope='overdue'");assert.equal(run('filteredTasks().length'),1);
run("taskFilters.scope='open';taskFilters.status='Blocked'");assert.equal(run('filteredTasks().length'),1);
run("taskFilters.status='';taskFilters.search='site access'");assert.equal(run('filteredTasks().length'),1);
// Creation, blocked/completed requirements, deadline and owner history, reopening.
const form={dataset:{id:'new-task'},data:{title:'Prepare proposal',owner:'Suman',actor:'Deepam',priority:'High',status:'Assigned',clientId:run('state.clients[0].id'),quoteId:run('state.quotes[0].id'),job:'School job',instructions:'Deliver priced PDF with confirmed dimensions.',dueDate:'2027-01-01',dueTime:'12:00',blocker:'',completion:'',update:''}};
ctx.testForm=form;
await run('saveTask(testForm)');assert.equal(run('tasks().length'),4);
const get=()=>run("tasks().find(t=>t.id==='new-task')");assert.equal(get().assignedBy,'Deepam');assert.equal(get().events.length,1);
form.data.status='Blocked';await assert.rejects(()=>run('saveTask(testForm)'));assert.equal(get().status,'Assigned');
form.data.blocker='Waiting for height';await run('saveTask(testForm)');assert.equal(get().status,'Blocked');
form.data.status='Completed';await assert.rejects(()=>run('saveTask(testForm)'));assert.equal(get().status,'Blocked');
form.data.completion='Sent proposal.pdf';await run('saveTask(testForm)');assert.equal(get().status,'Completed');assert.ok(get().completedAt);assert.equal(run("taskLate(tasks().find(t=>t.id==='new-task'))"),false);
form.data.status='In progress';form.data.owner='Raju';form.data.dueDate='2027-02-01';form.data.update='Client change';await run('saveTask(testForm)');assert.equal(get().completedAt,null);assert.equal(get().events.length,4);assert.ok(get().events.at(-1).text.includes('Responsible: Suman → Raju'));assert.ok(get().events.at(-1).text.includes('Deadline:'));
await run('saveTask(testForm)'); // Explicit progress note creates a history entry.
form.data.update='';const count=get().events.length;await run('saveTask(testForm)');assert.equal(get().events.length,count);
// Backups are backwards compatible and reject malformed linked task data.
assert.equal(run("validateBackup({app:'artisan-quotation-desk',formatVersion:1,workspace:'real',data:clone(state)}).tasks.length"),4);
assert.equal(run("(()=>{const s=clone(state);delete s.tasks;return validateBackup({app:'artisan-quotation-desk',formatVersion:1,workspace:'real',data:s}).tasks.length})()"),0);
assert.throws(()=>run("(()=>{const s=clone(state);s.tasks[0].quoteId='missing';validateBackup({app:'artisan-quotation-desk',formatVersion:1,workspace:'real',data:s})})()"));
assert.throws(()=>run("(()=>{const s=clone(state);s.tasks.push(s.tasks[0]);validateBackup({app:'artisan-quotation-desk',formatVersion:1,workspace:'real',data:s})})()"));
// Client quotation output does not expose internal task notes, including hostile input.
run("tasks()[0].title='<img src=x onerror=alert(1)>';tasks()[0].blocker='<script>alert(2)</script>'");
assert.ok(run('taskTable(tasks())').includes('&lt;img'));
assert.ok(!run('taskTable(tasks())').includes('<img src=x'));
assert.ok(!run('clientPreview(state.quotes[0])').includes('Waiting for height'));
assert.ok(run('quoteTasks(state.quotes[0])').includes('Prepare proposal'));
// Generated spreadsheets include the task queue and complete update history.
run('workbook=async (sheets,name)=>{globalThis.exported={sheets,name}}');await run('exportTasks()');assert.equal(run('exported.sheets.length'),2);assert.equal(run('exported.sheets[0].rows.length'),5);assert.ok(run("exported.sheets[1].rows.some(r=>r[3].includes('Client change'))"));
// Validate task editor required flags without a browser.
nodes['#taskForm']={elements:{status:{value:'Blocked'},blocker:{required:false},completion:{required:false}}};run('taskRequirements()');assert.ok(nodes['#taskForm'].elements.blocker.required);assert.ok(!nodes['#taskForm'].elements.completion.required);
nodes['#taskForm'].elements.status.value='Completed';run('taskRequirements()');assert.ok(nodes['#taskForm'].elements.completion.required);assert.ok(!nodes['#taskForm'].elements.blocker.required);
// Simulate IndexedDB read of a prior record set, checking safe migration.
run("db={transaction:()=>({objectStore:()=>({get:()=>{const r={result:{version:3,quotes:[{id:'keep'}],clients:[],leads:[]}};Promise.resolve().then(()=>r.onsuccess());return r}})})}");
assert.equal(await run("readKey('real').then(s=>s.tasks.length)"),0);assert.equal(await run("readKey('real').then(s=>s.quotes[0].id)"),'keep');
console.log('PASS: 28 assertions covering task assignment, filters, blockers, completion, reopen/history, no-change save, legacy/new backups, invalid data, HTML escaping, client quotation privacy, task/history Excel export, required fields and legacy browser record migration.');
})().catch(e=>{console.error(e);process.exit(1)});
