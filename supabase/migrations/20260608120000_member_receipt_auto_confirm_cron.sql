-- Auto-validation réception membre : 24 h après livraison aller (cron horaire).

comment on column public.carts.member_receipt_confirmed_at is
  'Horodatage validation « bonne réception » (manuel ou auto 24 h après livraison aller). NULL = page commande ; renseigné = page emprunt.';

do $do$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'member_receipt_auto_confirm_hourly' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'member_receipt_auto_confirm_hourly',
    '15 * * * *',
    $$select public.invoke_segna_app_cron('/api/cron/member-receipt-auto-confirm');$$
  );
end
$do$;
