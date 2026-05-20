-- Cron quotidien : rappels retour d’emprunt J-3, J-1, J-J (+ retard) via l’API Next.js.
-- Secrets Vault requis (à créer manuellement sur chaque projet Supabase) :
--   segna_app_cron_base_url   → ex. https://app.segnashare.com
--   segna_cron_bearer_secret  → même valeur que SEGNA_CRON_SECRET / CRON_SECRET (Vercel)

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_member_borrow_return_reminders_cron()
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
      'invoke_member_borrow_return_reminders_cron: secrets Vault manquants (segna_app_cron_base_url, segna_cron_bearer_secret).';
    return;
  end if;

  v_url := rtrim(v_base, '/') || '/api/cron/member-lifecycle-reminders';
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

comment on function public.invoke_member_borrow_return_reminders_cron() is
  'Déclenche GET /api/cron/member-lifecycle-reminders (rappels J-3, J-1, J-J retour emprunt).';

revoke all on function public.invoke_member_borrow_return_reminders_cron() from public;

do $do$
declare
  v_job_id bigint;
begin
  select jobid
    into v_job_id
  from cron.job
  where jobname = 'member_borrow_return_reminders_daily'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  -- 07:00 UTC ≈ 08:00 Paris (hiver) — aligné vercel.json
  perform cron.schedule(
    'member_borrow_return_reminders_daily',
    '0 7 * * *',
    'select public.invoke_member_borrow_return_reminders_cron();'
  );
end
$do$;
