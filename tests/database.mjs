import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,storage to anon,authenticated,service_role;
 grant execute on function auth.uid() to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;
 create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;`);
let migration=await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');
try{await db.exec(migration)}catch(e){console.error('MIGRATION ERROR',e.message,e.query);process.exit(1)}
const admin='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',fourth='44444444-4444-4444-8444-444444444444',fifth='55555555-5555-4555-8555-555555555555',sixth='66666666-6666-4666-8666-666666666666',seventh='77777777-7777-4777-8777-777777777777';
for(const [id,name,role] of [[admin,'Deepam','admin'],[member,'Shrabonika','member'],[other,'Raju','member'],[fourth,'Suman','member'],[fifth,'Fifth','member'],[sixth,'Sixth','member']]){await db.query('insert into auth.users values($1)',[id]);await db.query('insert into public.crm_members(id,email,display_name,role) values($1,$2,$3,$4)',[id,name.toLowerCase()+'@example.test',name,role])}
await db.query('insert into auth.users values($1)',[seventh]);
await assert.rejects(()=>db.query("insert into public.crm_members(id,email,display_name,role) values($1,'seventh@example.test','Seventh','member')",[seventh]),/six accounts/);
async function as(id,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role)}
async function load(){return (await db.query('select public.crm_load() as v')).rows[0].v}
async function save(s){return (await db.query('select public.crm_save($1,$2::jsonb) as v',[s.version,JSON.stringify(s)])).rows[0].v}
await as(admin);let s=(await load()).state;s.clients=[{id:'client',name:'School'}];s.quotes=[{id:'quote',number:'ART-2026-0001',title:'School display',items:[{description:'LED',qty:1,rate:5000,cost:3500}],notes:'PRIVATE MARGIN',revisions:[{items:[{cost:3000}],notes:'PRIVATE OLD',revisions:[]}]}];s.tasks=[{id:'task',title:'Prepare proposal',owner:'Shrabonika',assignedBy:'Deepam',priority:'High',clientId:'client',quoteId:'quote',job:'School',instructions:'Prepare priced PDF',dueAt:'2026-12-01T12:00',status:'Assigned',blocker:'',completion:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),completedAt:null,events:[{at:new Date().toISOString(),actor:'FAKE',text:'Task assigned'}]}];
let r=await save(s);assert.equal(r.state.tasks[0].ownerId,member);assert.equal(r.state.tasks[0].events[0].actor,'Deepam');let oldVersion=r.state.version;
await assert.rejects(()=>save(s),/Records changed/);
await as(member);r=await load();assert.equal(r.state.quotes[0].items[0].cost,0);assert.equal(r.state.quotes[0].notes,'');assert.equal(r.state.quotes[0].revisions[0].items[0].cost,0);assert.equal(r.state.quotes[0].revisions[0].notes,'');
s=r.state;s.tasks[0].status='Blocked';s.tasks[0].blocker='Need dimensions';s.tasks[0].events.push({text:'Need dimensions',actor:'SPOOFED'});r=await save(s);assert.equal(r.state.tasks[0].events.at(-1).actor,'Shrabonika');assert.equal(r.state.tasks[0].events.length,2);
s=r.state;s.tasks[0].dueAt='2026-12-30T12:00';await assert.rejects(()=>save(s),/Only the admin/);
s=(await load()).state;s.tasks[0].owner='Raju';await assert.rejects(()=>save(s),/Only the admin/);
s=(await load()).state;s.tasks[0].status='Completed';await assert.rejects(()=>save(s),/completion note/);
s=(await load()).state;s.tasks[0].status='Completed';s.tasks[0].completion='Delivered proposal.pdf';s.tasks[0].events.push({text:'Delivered'});r=await save(s);assert.ok(r.state.tasks[0].completedAt);
// Internal costs cannot be overwritten by a member's sanitised copy.
await as(admin);r=await load();assert.equal(r.state.quotes[0].items[0].cost,3500);assert.equal(r.state.quotes[0].notes,'PRIVATE MARGIN');
await as(other);s=(await load()).state;s.tasks[0].status='In progress';await assert.rejects(()=>save(s),/only update your assigned/);
await assert.rejects(()=>db.query('select * from public.crm_workspace'),/permission denied/);
await assert.rejects(()=>db.query("update public.crm_members set role='admin' where id=$1",[other]),/permission denied/);
await assert.rejects(()=>db.query('select public.crm_team()'),/Admin access/);
await as('');await assert.rejects(()=>load(),/no active workspace access/);
await as('', 'anon');await assert.rejects(()=>load(),/permission denied/);
await db.exec('reset role');await db.query('update public.crm_members set active=false where id=$1',[member]);await as(member);await assert.rejects(()=>load(),/no active workspace access/);
await as(admin);const afterDisable=(await load()).state;afterDisable.settings.phone='123';await save(afterDisable);
await db.exec('reset role');await assert.rejects(()=>db.query('update public.crm_members set active=false where id=$1',[admin]),/admin account must remain active/);
// Private bucket permits active users' own new paths, rejects foreign paths/anonymous.
await as(other);await db.query("insert into storage.objects(bucket_id,name,metadata) values('crm-files',$1,'{\"size\":100}')",[other+'/proof.pdf']);
await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('crm-files',$1,'{}')",[admin+'/spoof.pdf']),/row-level security/);
await as(admin);let file=(await db.query("select public.crm_register_file('quote','quote',$1,'proposal.pdf',100) as id",[admin+'/proposal.pdf']).catch(()=>({rows:[]}))).rows;assert.equal(file.length,0);
await db.query("insert into storage.objects(bucket_id,name,metadata) values('crm-files',$1,'{\"size\":100}')",[admin+'/proposal.pdf']);
await db.query("select public.crm_register_file('quote','quote',$1,'proposal.pdf',100)",[admin+'/proposal.pdf']);
assert.equal((await db.query("select * from public.crm_list_files('quote','quote')")).rows.length,1);
assert.equal((await db.query('select * from public.crm_audit_log()')).rows.length,5);
console.log('PASS database: migration execution; six-account limit; authenticated membership; admin persistence; concurrent-write conflict; current and historical cost redaction; own-task updates; immutable attribution; protected deadlines/owners; completion requirements; other-user denial; direct table denial; role escalation denial; anonymous denial; disabled-account denial; admin safeguard; private upload paths; file registration and audit trail.');
await db.close();
