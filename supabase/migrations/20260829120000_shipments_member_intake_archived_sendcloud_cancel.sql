-- member_intake archivé (deleted_at) → annulation async Sendcloud via segna-app (pg_net).

create extension if not exists pg_net;

create or replace function public.invoke_member_intake_shipment_sendcloud_cancel_http(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $fn$
declare
  v_base text;
  v_secret text;
  v_url text;
  v_headers jsonb;
  v_body jsonb;
begin
  if p_shipment_id is null then
    return;
  end if;

  select btrim(ds.decrypted_secret::text)
    into v_base
  from vault.decrypted_secrets as ds
  where ds.name = 'segna_app_cron_base_url'
  limit 1;

  select btrim(ds.decrypted_secret::text)
    into v_secret
  from vault.decrypted_secrets as ds
  where ds.name = 'segna_internal_shipment_lifecycle_secret'
  limit 1;

  if v_secret is null or v_secret = '' then
    select btrim(ds.decrypted_secret::text)
      into v_secret
    from vault.decrypted_secrets as ds
    where ds.name = 'segna_cron_bearer_secret'
    limit 1;
  end if;

  if v_base is null or v_base = '' or v_secret is null or v_secret = '' then
    raise warning
      'invoke_member_intake_shipment_sendcloud_cancel_http: secrets Vault manquants (segna_app_cron_base_url + segna_internal_shipment_lifecycle_secret ou segna_cron_bearer_secret).';
    return;
  end if;

  v_url := rtrim(v_base, '/') || '/api/internal/member-intake-shipment/cancel-sendcloud';
  v_body := jsonb_build_object('shipment_id', p_shipment_id);
  v_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || v_secret,
    'Content-Type', 'application/json',
    'Accept', 'application/json'
  );

  perform net.http_post(
    url := v_url,
    body := v_body,
    params := '{}'::jsonb,
    headers := v_headers,
    timeout_milliseconds := 120000
  );
end;
$fn$;

comment on function public.invoke_member_intake_shipment_sendcloud_cancel_http(uuid) is
  'POST async vers segna-app /api/internal/member-intake-shipment/cancel-sendcloud (annulation aller/retour Sendcloud).';

create or replace function public.trg_shipments_member_intake_archived_sendcloud_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'UPDATE'
    and old.deleted_at is null
    and new.deleted_at is not null
    and new.context = 'member_intake'::public.shipment_context then
    perform public.invoke_member_intake_shipment_sendcloud_cancel_http(new.id);
  end if;
  return new;
end;
$fn$;

drop trigger if exists shipments_member_intake_archived_sendcloud_cancel on public.shipments;

create trigger shipments_member_intake_archived_sendcloud_cancel
  after update of deleted_at on public.shipments
  for each row
  execute function public.trg_shipments_member_intake_archived_sendcloud_cancel();
