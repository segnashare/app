-- Dernière activité app (cron rappels engagement) + pg_cron quotidien.

create or replace function public.get_members_last_app_activity_at(p_user_ids uuid[])
returns table(user_id uuid, last_activity_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id as user_id,
    greatest(
      u.updated_at,
      coalesce(ae.last_at, '-infinity'::timestamptz),
      coalesce(fh.last_at, '-infinity'::timestamptz)
    ) as last_activity_at
  from unnest(coalesce(p_user_ids, array[]::uuid[])) as uid(id)
  join public.users u on u.id = uid.id
  left join lateral (
    select max(a.created_at) as last_at
    from public.activity_events a
    where a.user_id = u.id
  ) ae on true
  left join lateral (
    select max(h.last_seen_at) as last_at
    from public.member_feed_entity_history h
    where h.member_user_id = u.id
  ) fh on true;
$$;

comment on function public.get_members_last_app_activity_at(uuid[]) is
  'Dernière activité membre (users.updated_at, activity_events, feed) pour rappels SMS engagement.';

revoke all on function public.get_members_last_app_activity_at(uuid[]) from public;
grant execute on function public.get_members_last_app_activity_at(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- pg_cron → GET /api/cron/member-engagement-reminders
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_member_engagement_reminders_cron()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_base text;
  v_secret text;
  v_url text;
  v_headers jsonb;
begin
  select btrim(ds.decrypted_secret::text)
    into v_base
  from vault.decrypted_secrets as ds
  where ds.name = 'segna_app_cron_base_url'
  limit 1;

  select btrim(ds.decrypted_secret::text)
    into v_secret
  from vault.decrypted_secrets as ds
  where ds.name = 'segna_cron_bearer_secret'
  limit 1;

  if v_base is null or v_base = '' or v_secret is null or v_secret = '' then
    raise warning
      'invoke_member_engagement_reminders_cron: secrets Vault manquants (segna_app_cron_base_url, segna_cron_bearer_secret).';
    return;
  end if;

  v_url := rtrim(v_base, '/') || '/api/cron/member-engagement-reminders';
  v_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || v_secret,
    'Accept', 'application/json'
  );

  perform net.http_get(
    url := v_url,
    headers := v_headers,
    timeout_milliseconds := 120000
  );
end;
$$;

comment on function public.invoke_member_engagement_reminders_cron() is
  'Déclenche GET /api/cron/member-engagement-reminders (onboarding, likes, panier abandonné).';

revoke all on function public.invoke_member_engagement_reminders_cron() from public;

do $do$
declare
  v_job_id bigint;
begin
  select jobid
    into v_job_id
  from cron.job
  where jobname = 'member_engagement_reminders_daily'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  -- 08:00 UTC — après les rappels retour emprunt (07:00)
  perform cron.schedule(
    'member_engagement_reminders_daily',
    '0 8 * * *',
    'select public.invoke_member_engagement_reminders_cron();'
  );
end
$do$;
