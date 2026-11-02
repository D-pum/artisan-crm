begin;
create schema crm_private;
revoke all on schema crm_private from public;
grant usage on schema crm_private to authenticated,service_role;
create table public.crm_members (
 id uuid primary key references auth.users(id),
 email text not null unique check (email = lower(email)),
 display_name text not null check (length(trim(display_name)) between 1 and 80),
 role text not null check (role in ('admin','member')),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create unique index crm_one_admin on public.crm_members(role) where role='admin';
create unique index crm_unique_name on public.crm_members(lower(display_name));
create function crm_private.crm_limit_members() returns trigger language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(202611024);
 if TG_OP='INSERT' and (select count(*) from public.crm_members)>=6 then raise exception 'This workspace has six accounts already.'; end if;
 if TG_OP='UPDATE' and old.role='admin' and (new.role<>'admin' or not new.active) then raise exception 'The admin account must remain active.'; end if;
 return new;
end $$;
create trigger crm_member_limit before insert or update on public.crm_members for each row execute function crm_private.crm_limit_members();
create table public.crm_workspace (
 id boolean primary key default true check(id),
 version bigint not null default 0,
 data jsonb not null default '{"schemaVersion":1,"nextNumber":1,"settings":{"business":"Artisan & Co.","address":"","phone":"","email":"","gstin":"","prefix":"ART","owners":[],"gst":18,"terms":"Scope of work: as listed.\nPayment terms: as agreed.\nDelivery subject to site readiness.\nQuotation validity: as stated.","logo":""},"clients":[],"leads":[],"quotes":[],"tasks":[],"lastBackup":null}'::jsonb,
 updated_at timestamptz not null default now()
);
insert into public.crm_workspace(id) values(true);
create table public.crm_audit (
 id bigint generated always as identity primary key,
 actor_id uuid not null references public.crm_members(id),
 at timestamptz not null default now(),
 action text not null,
 details jsonb not null default '{}'
);
create table public.crm_files (
 id uuid primary key default gen_random_uuid(),
 entity_type text not null check(entity_type in ('quote','task')),
 entity_id text not null,
 object_path text not null unique,
 file_name text not null check(length(file_name) between 1 and 200),
 size_bytes bigint not null check(size_bytes between 1 and 10485760),
 uploaded_by uuid not null references public.crm_members(id),
 created_at timestamptz not null default now()
);
create index crm_files_entity on public.crm_files(entity_type,entity_id);
alter table public.crm_members enable row level security;
alter table public.crm_workspace enable row level security;
alter table public.crm_audit enable row level security;
alter table public.crm_files enable row level security;
revoke all on public.crm_members, public.crm_workspace, public.crm_audit, public.crm_files from anon, authenticated;
grant all on public.crm_members, public.crm_workspace, public.crm_audit, public.crm_files to service_role;
grant usage,select on sequence public.crm_audit_id_seq to service_role;

create function crm_private.crm_is_member() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.crm_members where id=auth.uid() and active);
$$;
create function crm_private.crm_current_member() returns public.crm_members language plpgsql stable security definer set search_path='' as $$
declare m public.crm_members;
begin
 select * into m from public.crm_members where id=auth.uid() and active;
 if not found then raise exception 'Your account has no active workspace access.' using errcode='42501'; end if;
 return m;
end $$;
create function crm_private.crm_redact_quote(q jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare r jsonb;
begin
 r=jsonb_set(q,'{notes}','""');
 r=jsonb_set(r,'{items}',coalesce((select jsonb_agg(jsonb_set(x,'{cost}','0')) from jsonb_array_elements(q->'items') x),'[]'));
 r=jsonb_set(r,'{revisions}',coalesce((select jsonb_agg(crm_private.crm_redact_quote(x)) from jsonb_array_elements(coalesce(q->'revisions','[]')) x),'[]'));
 return r;
end $$;
create function crm_private.crm_view_state(s jsonb, is_admin boolean) returns jsonb language plpgsql stable set search_path='' as $$
declare r jsonb=s;
begin
 r=jsonb_set(r,'{settings,owners}',coalesce((select jsonb_agg(display_name order by role,display_name) from public.crm_members where active),'[]'));
 if not is_admin then
  r=jsonb_set(r,'{quotes}',coalesce((select jsonb_agg(crm_private.crm_redact_quote(x)) from jsonb_array_elements(s->'quotes') x),'[]'));
 end if;
 return r;
end $$;
create function crm_private.crm_load() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.crm_members; w public.crm_workspace;
begin
 m=crm_private.crm_current_member(); select * into w from public.crm_workspace where id;
 return jsonb_build_object('profile',to_jsonb(m),'members',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'display_name',display_name,'role',role,'active',active)),'[]') from public.crm_members),'state',crm_private.crm_view_state(w.data,m.role='admin')||jsonb_build_object('version',w.version));
end $$;
create function crm_private.crm_save(p_expected_version bigint, p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.crm_members; w public.crm_workspace; n jsonb; old_task jsonb; new_task jsonb; combined jsonb='[]'; ev jsonb; note text; assigned uuid; changes jsonb='[]';
begin
 m=crm_private.crm_current_member();select * into w from public.crm_workspace where id for update;
 if p_expected_version is null or p_expected_version<>w.version then raise exception 'Records changed. Reload before saving; copy unsaved text first.' using errcode='40001'; end if;
 if pg_column_size(p_data)>20971520 then raise exception 'Workspace exceeds 20 MB. Store documents as attachments.'; end if;
 if p_data->>'schemaVersion' is distinct from '1' or jsonb_typeof(p_data->'tasks') is distinct from 'array' or jsonb_typeof(p_data->'clients') is distinct from 'array' or jsonb_typeof(p_data->'quotes') is distinct from 'array' or jsonb_typeof(p_data->'leads') is distinct from 'array' then raise exception 'Invalid workspace structure.';end if;
 if m.role='admin' then n=p_data-'version'; else
  n=w.data;
  if jsonb_array_length(p_data->'tasks')<>jsonb_array_length(w.data->'tasks') then raise exception 'Only the admin can assign or remove tasks.' using errcode='42501';end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_data->'tasks') x)<>jsonb_array_length(p_data->'tasks') then raise exception 'Duplicate task IDs.';end if;
  for old_task in select value from jsonb_array_elements(w.data->'tasks') loop
   select value into new_task from jsonb_array_elements(p_data->'tasks') where value->>'id'=old_task->>'id';
   if new_task is null then raise exception 'Missing task.';end if;
   if new_task<>old_task then
    if old_task->>'ownerId'<>m.id::text or old_task->>'ownerId' is null then raise exception 'You can only update your assigned tasks.' using errcode='42501';end if;
    if (new_task-array['status','blocker','completion','events','updatedAt','completedAt'])<>(old_task-array['status','blocker','completion','events','updatedAt','completedAt']) then raise exception 'Only the admin can change the handout or deadline.' using errcode='42501';end if;
    if new_task->>'status' not in ('Assigned','In progress','Blocked','Completed') then raise exception 'Invalid task status.';end if;
   end if;
   combined=combined||jsonb_build_array(new_task);
  end loop;
  n=jsonb_set(n,'{tasks}',combined);combined='[]';
 end if;
 -- Canonical task identity and append-only attribution are set by the server.
 for new_task in select value from jsonb_array_elements(n->'tasks') loop
  if new_task->>'status' not in ('Assigned','In progress','Blocked','Completed','Cancelled') or length(trim(coalesce(new_task->>'title','')))=0 or length(trim(coalesce(new_task->>'instructions','')))=0 then raise exception 'Task needs a title, instructions and valid status.';end if;
  if new_task->>'status'='Blocked' and length(trim(coalesce(new_task->>'blocker','')))=0 then raise exception 'Blocked work needs a reason.';end if;
  if new_task->>'status'='Completed' and length(trim(coalesce(new_task->>'completion','')))=0 then raise exception 'Completed work needs a completion note.';end if;
  if coalesce(new_task->>'dueAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then raise exception 'Task deadline is required.';end if;
  perform (new_task->>'dueAt')::timestamp;
  select value into old_task from jsonb_array_elements(w.data->'tasks') where value->>'id'=new_task->>'id';
  select id into assigned from public.crm_members where display_name=new_task->>'owner' and (active or id::text=old_task->>'ownerId');
  if assigned is null then raise exception 'Assign the task to an active team account.';end if;
  new_task=jsonb_set(new_task,'{ownerId}',to_jsonb(assigned::text));
  if old_task is null or (old_task-'events')<>(new_task-'events') or old_task->'events'<>new_task->'events' then
   note=coalesce(new_task->'events'->-1->>'text','Task updated.');
   ev=jsonb_build_object('at',now(),'actor',m.display_name,'actorId',m.id,'text',note);
   new_task=jsonb_set(new_task,'{events}',coalesce(old_task->'events','[]')||jsonb_build_array(ev));
   new_task=jsonb_set(new_task,'{updatedAt}',to_jsonb(now()));
   new_task=jsonb_set(new_task,'{createdAt}',coalesce(old_task->'createdAt',to_jsonb(now())));
   new_task=jsonb_set(new_task,'{completedAt}',case when new_task->>'status'='Completed' then case when old_task->>'status'='Completed' then old_task->'completedAt' else to_jsonb(now()) end else 'null'::jsonb end);
   if old_task is null then new_task=jsonb_set(new_task,'{assignedBy}',to_jsonb(m.display_name));end if;
   changes=changes||jsonb_build_array(jsonb_build_object('id',new_task->>'id','title',new_task->>'title','from',old_task->>'status','to',new_task->>'status','owner',new_task->>'owner','deadline',new_task->>'dueAt'));
  end if;
  combined=combined||jsonb_build_array(new_task);
 end loop;
 n=jsonb_set(n,'{tasks}',combined);
 if (select count(distinct x->>'id') from jsonb_array_elements(n->'tasks') x)<>jsonb_array_length(n->'tasks') then raise exception 'Duplicate task IDs.';end if;
 update public.crm_workspace set data=n,version=w.version+1,updated_at=now() where id;
 insert into public.crm_audit(actor_id,action,details) values(m.id,'workspace_saved',jsonb_build_object('version',w.version+1,'tasks',changes));
 return crm_private.crm_load();
end $$;

create function crm_private.crm_register_file(p_entity_type text,p_entity_id text,p_path text,p_name text,p_size bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare m public.crm_members; w jsonb; f uuid;
begin
 m=crm_private.crm_current_member();select data into w from public.crm_workspace where id for update;
 if split_part(p_path,'/',1)<>m.id::text or p_path!~'\.(pdf|pptx|xlsx|jpg|jpeg|png|webp)$' then raise exception 'Invalid file path.';end if;
 if not exists(select 1 from storage.objects where bucket_id='crm-files' and name=p_path and (metadata->>'size')::bigint=p_size) then raise exception 'Uploaded file not found.';end if;
 if p_entity_type='quote' then
  if not exists(select 1 from jsonb_array_elements(w->'quotes') q where q->>'id'=p_entity_id) then raise exception 'Quotation not found.';end if;
 elsif p_entity_type='task' then
  if not exists(select 1 from jsonb_array_elements(w->'tasks') t where t->>'id'=p_entity_id and (m.role='admin' or t->>'ownerId'=m.id::text)) then raise exception 'Task not found or not assigned to you.';end if;
 else raise exception 'Invalid attachment type.';end if;
 if (select count(*) from public.crm_files where entity_type=p_entity_type and entity_id=p_entity_id)>=25 then raise exception 'Maximum 25 files per record.';end if;
 insert into public.crm_files(entity_type,entity_id,object_path,file_name,size_bytes,uploaded_by) values(p_entity_type,p_entity_id,p_path,p_name,p_size,m.id) returning id into f;
 insert into public.crm_audit(actor_id,action,details) values(m.id,'file_uploaded',jsonb_build_object('file_id',f,'record',p_entity_id,'name',p_name));
 return f;
end $$;
create function crm_private.crm_list_files(p_entity_type text,p_entity_id text) returns setof public.crm_files language plpgsql stable security definer set search_path='' as $$
begin perform crm_private.crm_current_member();return query select * from public.crm_files where entity_type=p_entity_type and entity_id=p_entity_id order by created_at desc;end $$;
create function crm_private.crm_team() returns setof public.crm_members language plpgsql stable security definer set search_path='' as $$
begin if (crm_private.crm_current_member()).role<>'admin' then raise exception 'Admin access required.' using errcode='42501';end if;return query select * from public.crm_members order by role,display_name;end $$;
create function crm_private.crm_audit_log() returns setof public.crm_audit language plpgsql stable security definer set search_path='' as $$
begin if (crm_private.crm_current_member()).role<>'admin' then raise exception 'Admin access required.' using errcode='42501';end if;return query select * from public.crm_audit order by id desc limit 100;end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('crm-files','crm-files',false,10485760,array['application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp']);
create policy crm_file_read on storage.objects for select to authenticated using(bucket_id='crm-files' and crm_private.crm_is_member());
create policy crm_file_upload on storage.objects for insert to authenticated with check(bucket_id='crm-files' and crm_private.crm_is_member() and (storage.foldername(name))[1]=auth.uid()::text);
-- Cleanup only of own unregistered uploads; registered attachments are retained.
create policy crm_file_cleanup on storage.objects for delete to authenticated using(bucket_id='crm-files' and crm_private.crm_is_member() and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.crm_files f where f.object_path=name));
-- Storage policy needs a narrowly scoped existence helper instead of direct table access.
create function crm_private.crm_file_registered(p_path text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.crm_files where object_path=p_path) $$;
drop policy crm_file_cleanup on storage.objects;
create policy crm_file_cleanup on storage.objects for delete to authenticated using(bucket_id='crm-files' and crm_private.crm_is_member() and (storage.foldername(name))[1]=auth.uid()::text and not crm_private.crm_file_registered(name));

revoke all on function crm_private.crm_limit_members(),crm_private.crm_is_member(),crm_private.crm_current_member(),crm_private.crm_redact_quote(jsonb),crm_private.crm_view_state(jsonb,boolean),crm_private.crm_load(),crm_private.crm_save(bigint,jsonb),crm_private.crm_register_file(text,text,text,text,bigint),crm_private.crm_list_files(text,text),crm_private.crm_team(),crm_private.crm_audit_log(),crm_private.crm_file_registered(text) from public,anon,authenticated;
grant execute on function crm_private.crm_is_member(),crm_private.crm_load(),crm_private.crm_save(bigint,jsonb),crm_private.crm_register_file(text,text,text,text,bigint),crm_private.crm_list_files(text,text),crm_private.crm_team(),crm_private.crm_audit_log(),crm_private.crm_file_registered(text) to authenticated;

-- Data API entry points run as the caller; privileged work stays in a non-exposed schema.
create function public.crm_is_member() returns boolean language sql stable set search_path='' as $$ select crm_private.crm_is_member() $$;
create function public.crm_file_registered(p_path text) returns boolean language sql stable set search_path='' as $$ select crm_private.crm_file_registered(p_path) $$;
create function public.crm_load() returns jsonb language sql stable set search_path='' as $$ select crm_private.crm_load() $$;
create function public.crm_save(p_expected_version bigint,p_data jsonb) returns jsonb language sql set search_path='' as $$ select crm_private.crm_save(p_expected_version,p_data) $$;
create function public.crm_register_file(p_entity_type text,p_entity_id text,p_path text,p_name text,p_size bigint) returns uuid language sql set search_path='' as $$ select crm_private.crm_register_file(p_entity_type,p_entity_id,p_path,p_name,p_size) $$;
create function public.crm_list_files(p_entity_type text,p_entity_id text) returns setof public.crm_files language sql stable set search_path='' as $$ select * from crm_private.crm_list_files(p_entity_type,p_entity_id) $$;
create function public.crm_team() returns setof public.crm_members language sql stable set search_path='' as $$ select * from crm_private.crm_team() $$;
create function public.crm_audit_log() returns setof public.crm_audit language sql stable set search_path='' as $$ select * from crm_private.crm_audit_log() $$;
revoke all on function public.crm_is_member(),public.crm_file_registered(text),public.crm_load(),public.crm_save(bigint,jsonb),public.crm_register_file(text,text,text,text,bigint),public.crm_list_files(text,text),public.crm_team(),public.crm_audit_log() from public,anon,authenticated;
grant execute on function public.crm_is_member(),public.crm_file_registered(text),public.crm_load(),public.crm_save(bigint,jsonb),public.crm_register_file(text,text,text,text,bigint),public.crm_list_files(text,text),public.crm_team(),public.crm_audit_log() to authenticated;
commit;
