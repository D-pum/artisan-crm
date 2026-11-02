#!/usr/bin/env python3
"""Create the first admin after applying the schema. Secrets stay in the prompt/session."""
import getpass,json,urllib.request,urllib.error,re
url=input('Supabase project URL: ').strip().rstrip('/')
if not re.fullmatch(r'https://[a-z0-9-]+\.supabase\.co',url): raise SystemExit('Invalid project URL')
key=getpass.getpass('Service-role key (hidden, used only for this setup): ')
email=input('Admin email: ').strip().lower()
name=input('Admin name [Deepam]: ').strip() or 'Deepam'
password=getpass.getpass('Admin initial password (12+ characters): ')
if len(password)<12:raise SystemExit('Use at least 12 characters')
def api(path,method='GET',body=None):
 data=None if body is None else json.dumps(body).encode()
 req=urllib.request.Request(url+path,data=data,method=method,headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=30) as r:
   value=r.read();return json.loads(value) if value else None
 except urllib.error.HTTPError as e:
  # Do not print requests or credentials.
  raise RuntimeError('Setup request failed ('+str(e.code)+'). Check the project and schema.') from None
if api('/rest/v1/crm_members?select=id'):raise SystemExit('Workspace already has accounts. No changes made.')
u=api('/auth/v1/admin/users','POST',{'email':email,'password':password,'email_confirm':True})
try:api('/rest/v1/crm_members','POST',{'id':u['id'],'email':email,'display_name':name,'role':'admin'})
except Exception:
 api('/auth/v1/admin/users/'+u['id'],'DELETE');raise
print('Admin created. Sign in to create the other five logins under Team & access.')
