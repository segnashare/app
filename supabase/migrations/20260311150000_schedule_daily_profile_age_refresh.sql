create extension if not exists pg_cron;

create or replace function public.refresh_user_profile_ages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  update public.user_profiles up
  set age = extract(year from age(current_date, u.birth_date))::integer
  from public.users u
  where up.user_id = u.id
    and u.birth_date is not null
    and up.age is distinct from extract(year from age(current_date, u.birth_date))::integer;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

do $do$
declare
  v_job_id bigint;
begin
  select jobid
  into v_job_id
  from cron.job
  where jobname = 'refresh_user_profile_ages_daily'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'refresh_user_profile_ages_daily',
    '5 0 * * *',
    'select public.refresh_user_profile_ages();'
  );
end
$do$;
