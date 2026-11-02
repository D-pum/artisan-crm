begin;
-- One approved admin email, configured privately during provisioning.
create table crm_private.crm_bootstrap (
 id boolean primary key default true check(id),
 admin_email text not null check(admin_email=lower(admin_email))
);
alter table crm_private.crm_bootstrap enable row level security;
revoke all on crm_private.crm_bootstrap from public,anon,authenticated;
create function crm_private.crm_bootstrap_needed() returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.crm_members) and exists(select 1 from crm_private.crm_bootstrap);
$$;
create function crm_private.crm_claim_admin() returns boolean language plpgsql security definer set search_path='' as $$
declare allowed text; person record;
begin
 if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(202611024);
 if exists(select 1 from public.crm_members where id=auth.uid() and active) then return true;end if;
 if exists(select 1 from public.crm_members) then raise exception 'Admin setup is already complete.' using errcode='42501';end if;
 select admin_email into allowed from crm_private.crm_bootstrap where id for update;
 select id,email,email_confirmed_at into person from auth.users where id=auth.uid();
 if allowed is null or lower(coalesce(person.email,''))<>allowed or person.email_confirmed_at is null then raise exception 'Only the approved, email-verified admin can finish setup.' using errcode='42501';end if;
 insert into public.crm_members(id,email,display_name,role) values(person.id,lower(person.email),'Deepam','admin');
 delete from crm_private.crm_bootstrap where id;
 insert into public.crm_audit(actor_id,action,details) values(person.id,'admin_setup_completed','{}');
 return true;
end $$;
create function public.crm_bootstrap_needed() returns boolean language sql stable set search_path='' as $$ select crm_private.crm_bootstrap_needed() $$;
create function public.crm_claim_admin() returns boolean language sql set search_path='' as $$ select crm_private.crm_claim_admin() $$;
revoke all on function crm_private.crm_bootstrap_needed(),crm_private.crm_claim_admin(),public.crm_bootstrap_needed(),public.crm_claim_admin() from public,anon,authenticated;
grant usage on schema crm_private to anon;
grant execute on function crm_private.crm_bootstrap_needed(),public.crm_bootstrap_needed() to anon,authenticated;
grant execute on function crm_private.crm_claim_admin(),public.crm_claim_admin() to authenticated;
commit;
