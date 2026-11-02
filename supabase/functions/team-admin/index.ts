// Runs only on Supabase Edge Functions. Service credentials never reach the browser.
const url = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const origin = Deno.env.get('APP_ORIGIN') || 'https://d-pum.github.io';
const cors = {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
async function admin(path:string,init:RequestInit={}){
 const response=await fetch(url+path,{...init,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...init.headers}});
 const text=await response.text();const data=text?JSON.parse(text):null;
 if(!response.ok)throw new Error(data?.msg||data?.message||data?.error_description||'Account operation failed');return data;
}
Deno.serve(async(req:Request)=>{
 if(!origin)return reply({message:'APP_ORIGIN must be configured.'},503);
 if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return reply({message:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return reply({message:'Method not allowed'},405);
 try{
  const authorization=req.headers.get('Authorization')||'';if(!authorization.startsWith('Bearer '))return reply({message:'Sign in required'},401);
  const response=await fetch(url+'/auth/v1/user',{headers:{apikey:key,Authorization:authorization}});
  if(!response.ok)return reply({message:'Session is invalid'},401);const user=await response.json();
  const caller=(await admin('/rest/v1/crm_members?id=eq.'+encodeURIComponent(user.id)+'&select=id,role,active'))[0];
  if(!caller?.active||caller.role!=='admin')return reply({message:'Admin access required'},403);
  const body=await req.json();
  if(body.action==='create'){
   const email=String(body.email||'').trim().toLowerCase(),name=String(body.name||'').trim(),password=String(body.password||'');
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||name.length<1||name.length>80||password.length<12)return reply({message:'Enter a valid email, name and password of at least 12 characters.'},400);
   const members=await admin('/rest/v1/crm_members?select=id');if(members.length>=6)return reply({message:'All four account slots are used.'},409);
   const created=await admin('/auth/v1/admin/users',{method:'POST',body:JSON.stringify({email,password,email_confirm:true})});
   try{await admin('/rest/v1/crm_members',{method:'POST',body:JSON.stringify({id:created.id,email,display_name:name,role:'member'})});}
   catch(err){await admin('/auth/v1/admin/users/'+created.id,{method:'DELETE'});throw err}
   await admin('/rest/v1/crm_audit',{method:'POST',body:JSON.stringify({actor_id:user.id,action:'member_created',details:{id:created.id,email,name}})});
   return reply({ok:true});
  }
  if(body.action==='set-active'){
   if(typeof body.active!=='boolean'||!/^[0-9a-f-]{36}$/.test(body.id))return reply({message:'Invalid account change'},400);
   const target=(await admin('/rest/v1/crm_members?id=eq.'+body.id+'&select=id,role'))[0];if(!target||target.role!=='member')return reply({message:'Only team accounts can be enabled or disabled.'},400);
   await admin('/rest/v1/crm_members?id=eq.'+body.id,{method:'PATCH',body:JSON.stringify({active:body.active})});
   await admin('/rest/v1/crm_audit',{method:'POST',body:JSON.stringify({actor_id:user.id,action:body.active?'member_enabled':'member_disabled',details:{id:body.id}})});
   return reply({ok:true});
  }
  return reply({message:'Unknown account operation'},400);
 }catch(err){return reply({message:err instanceof Error?err.message:'Request failed'},400)}
});
