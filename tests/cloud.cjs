const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const stored=new Map(),requests=[];
const ctx=vm.createContext({console,URL,URLSearchParams,JSON,Date,Error,Promise,Object,String,Number,Set,Array,Blob,Response,atob,structuredClone,
 window:{ARTISAN_CONFIG:{supabaseUrl:'https://test-project.supabase.co',publishableKey:'sb_publishable_test'}},
 sessionStorage:{setItem:(k,v)=>stored.set(k,v),getItem:k=>stored.get(k)||null,removeItem:k=>stored.delete(k)},
 document:{addEventListener:()=>{},hidden:false},location:{origin:'https://example.test',pathname:'/crm/',hash:'',search:''},history:{replaceState:()=>{}},
 $:()=>({innerHTML:''}),$$:()=>[],esc:String,
 commit:()=>{},readKey:()=>{},shell:()=>{},taskTable:()=>'',taskModal:()=>{},taskRequirements:()=>{},detailView:()=>'',action:()=>{},
 setInterval:()=>0,clearInterval:()=>{},state:null,taskPerson:'',role:'',workspace:'',editor:null,dirty:false,modalDirty:false,
 fetch:async(url,options)=>{requests.push({url,options});if(url.includes('grant_type=refresh_token'))return new Response(JSON.stringify({access_token:'fresh',refresh_token:'rotated',expires_in:3600}),{headers:{'Content-Type':'application/json'}});return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json'}})}
});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/cloud.js'),'utf8').replace(/cloudInit\(\);\s*$/,''),ctx);
const run=s=>vm.runInContext(s,ctx);
(async()=>{
assert.equal(run('cloudConfig().supabaseUrl'),'https://test-project.supabase.co');
run("window.ARTISAN_CONFIG.publishableKey='sb_secret_never_publish'");assert.throws(()=>run('cloudConfig()'),/server secret/);
run("window.ARTISAN_CONFIG.publishableKey='sb_publishable_test'");
assert.throws(()=>run("cloudSession({access_token:'x'});window.ARTISAN_CONFIG.supabaseUrl='http://evil.test';cloudConfig()"),/not finished/);
run("window.ARTISAN_CONFIG.supabaseUrl='https://test-project.supabase.co'");
await assert.rejects(()=>run('cloudSession(null);cloudToken()'),/Sign in/);
run("cloudSession({access_token:'valid',refresh_token:'r',expires_at:Date.now()/1000+3600})");
await run("cloudRPC('crm_load')");assert.equal(requests.at(-1).options.headers.Authorization,'Bearer valid');assert.equal(requests.at(-1).options.headers.apikey,'sb_publishable_test');assert.equal(requests.at(-1).options.cache,'no-store');
run("Cloud.session.expires_at=0");const before=requests.length;const results=await run('Promise.all([cloudToken(),cloudToken(),cloudToken()])');assert.deepEqual([...results],['fresh','fresh','fresh']);assert.equal(requests.length-before,1);assert.equal(JSON.parse(stored.get('artisan-session')).refresh_token,'rotated');
run("cloudApply({profile:{id:'one',display_name:'Deepam',role:'admin'},members:[],state:{version:1}})");assert.equal(run('isAdmin()'),true);assert.equal(run('role'),'Owner');
run("cloudApply({profile:{id:'two',display_name:'Staff',role:'member'},members:[],state:{version:1}})");assert.equal(run('isAdmin()'),false);assert.equal(run('role'),'Sales preview');assert.equal(run('taskPerson'),'Staff');
let failed=false;ctx.fetch=async()=>new Response(JSON.stringify({message:'Denied',code:'42501'}),{status:403,headers:{'Content-Type':'application/json'}});try{await run("cloudRequest('/rest/v1/rpc/crm_load')")}catch(e){failed=e.status===403&&e.code==='42501'}assert.ok(failed);
run('cloudSession(null)');assert.equal(stored.has('artisan-session'),false);
console.log('PASS cloud adapter: public configuration, server-key rejection, project-origin validation, authentication required, bearer/API headers, uncached requests, refresh coalescing and token rotation, admin/member identity, API denial propagation, session clearing.');
})().catch(e=>{console.error(e);process.exit(1)});
