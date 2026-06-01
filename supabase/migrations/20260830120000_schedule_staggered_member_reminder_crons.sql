-- Crons étalés (UTC ≈ Paris hiver UTC+1) :
--   09:00 → retard emprunt (10h Paris)
--   14:00 → onboarding (15h Paris)
--   17:00 → panier abandonné (18h Paris)
--   18:30 → rappel emprunt J-X / J-J (19h30 Paris)

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_segna_app_cron(p_path text)
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
  v_path text;
begin
  v_path := coalesce(nullif(btrim(p_path), ''), '/');
  if v_path not like '/%' then
    v_path := '/' || v_path;
  end if;

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
      'invoke_segna_app_cron(%): secrets Vault manquants (segna_app_cron_base_url, segna_cron_bearer_secret).',
      v_path;
    return;
  end if;

  v_url := rtrim(v_base, '/') || v_path;
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

comment on function public.invoke_segna_app_cron(text) is
  'Déclenche GET {segna_app_cron_base_url}{p_path} (crons membre Segna).';

revoke all on function public.invoke_segna_app_cron(text) from public;

do $do$
declare
  v_job_id bigint;
  v_legacy text[] := array[
    'member_borrow_return_reminders_daily',
    'member_engagement_reminders_daily'
  ];
  v_name text;
begin
  foreach v_name in array v_legacy loop
    select jobid into v_job_id from cron.job where jobname = v_name limit 1;
    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;
  end loop;

  foreach v_name in array array[
    'member_borrow_overdue_accrual_daily',
    'member_onboarding_reminders_daily',
    'member_abandoned_cart_reminders_daily',
    'member_borrow_return_reminders_daily'
  ] loop
    select jobid into v_job_id from cron.job where jobname = v_name limit 1;
    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;
  end loop;

  perform cron.schedule(
    'member_borrow_overdue_accrual_daily',
    '0 9 * * *',
    $$select public.invoke_segna_app_cron('/api/cron/member-borrow-overdue-accrual');$$
  );

  perform cron.schedule(
    'member_onboarding_reminders_daily',
    '0 14 * * *',
    $$select public.invoke_segna_app_cron('/api/cron/member-onboarding-reminders');$$
  );

  perform cron.schedule(
    'member_abandoned_cart_reminders_daily',
    '0 17 * * *',
    $$select public.invoke_segna_app_cron('/api/cron/member-abandoned-cart-reminders');$$
  );

  perform cron.schedule(
    'member_borrow_return_reminders_daily',
    '30 18 * * *',
    $$select public.invoke_segna_app_cron('/api/cron/member-borrow-return-reminders');$$
  );
end
$do$;
