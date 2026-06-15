-- Fuseau horaire Segna : affichage Supabase + session SQL en Europe/Paris.
-- Les timestamptz restent stockés en UTC en interne ; seul l'affichage / current_date changent.

alter database postgres set timezone to 'Europe/Paris';

do $do$
declare
  r name;
begin
  foreach r in array array[
    'postgres',
    'authenticator',
    'anon',
    'authenticated',
    'service_role'
  ] loop
    begin
      execute format('alter role %I set timezone to %L', r, 'Europe/Paris');
    exception
      when undefined_object then
        null;
      when insufficient_privilege then
        null;
    end;
  end loop;
end
$do$;

comment on database postgres is
  'Segna — timezone session Europe/Paris (timestamptz stockés UTC).';

-- Helper SQL : créneau horaire Paris (pg_cron UTC → garde-fou métier).
create or replace function public.is_paris_cron_slot(
  p_hour integer,
  p_minute integer default 0,
  p_weekday integer default null
)
returns boolean
language sql
stable
as $$
  select extract(hour from timezone('Europe/Paris', now()))::integer = p_hour
     and extract(minute from timezone('Europe/Paris', now()))::integer = p_minute
     and (
       p_weekday is null
       or extract(isodow from timezone('Europe/Paris', now()))::integer = p_weekday
     );
$$;

comment on function public.is_paris_cron_slot(integer, integer, integer) is
  'Garde-fou pg_cron : vrai si now() correspond au créneau Europe/Paris (isodow 1=lundi).';

-- Agrégation demande économie : 06:00 Paris (date calendaire Paris).
create or replace function public.run_economy_demand_metrics_if_paris_slot()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_paris_cron_slot(6, 0) then
    return;
  end if;
  perform public.aggregate_item_demand_metrics((timezone('Europe/Paris', now()))::date);
end;
$$;

-- Crons HTTP : toutes les 30 min UTC, garde-fou Paris côté app (paris-cron-guard.ts).
-- Crons SQL internes : toutes les heures à :00 UTC, garde-fou Paris ci-dessus.

do $do$
declare
  v_job_id bigint;
  v_name text;
begin
  foreach v_name in array array[
    'member_borrow_overdue_accrual_daily',
    'member_onboarding_reminders_daily',
    'member_abandoned_cart_reminders_daily',
    'member_borrow_return_reminders_daily',
    'economy_demand_metrics_daily',
    'economy_exchange_recalibration_weekly'
  ] loop
    select jobid into v_job_id from cron.job where jobname = v_name limit 1;
    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;
  end loop;

  perform cron.schedule(
    'member_borrow_overdue_accrual_daily',
    '0,30 * * * *',
    $$select public.invoke_segna_app_cron('/api/cron/member-borrow-overdue-accrual');$$
  );

  perform cron.schedule(
    'member_onboarding_reminders_daily',
    '0,30 * * * *',
    $$select public.invoke_segna_app_cron('/api/cron/member-onboarding-reminders');$$
  );

  perform cron.schedule(
    'member_abandoned_cart_reminders_daily',
    '0,30 * * * *',
    $$select public.invoke_segna_app_cron('/api/cron/member-abandoned-cart-reminders');$$
  );

  perform cron.schedule(
    'member_borrow_return_reminders_daily',
    '0,30 * * * *',
    $$select public.invoke_segna_app_cron('/api/cron/member-borrow-return-reminders');$$
  );

  perform cron.schedule(
    'economy_demand_metrics_daily',
    '0 * * * *',
    $$select public.run_economy_demand_metrics_if_paris_slot();$$
  );

  perform cron.schedule(
    'economy_exchange_recalibration_weekly',
    '0,30 * * * *',
    $$select public.invoke_segna_app_cron('/api/cron/economy-exchange-recalibration');$$
  );
end
$do$;
