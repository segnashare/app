-- member_intake → dropped_in : promotion item_intake.shipping + SMS via app (pg_net).
-- Déclenché par la mise à jour de shipments.status (RPC transition_shipment_status, etc.), pas par Sendcloud directement.

create extension if not exists pg_net;

create or replace function public.promote_member_intake_items_to_shipping(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sid text := p_shipment_id::text;
  v_dest_csv text;
  v_item_id uuid;
  v_ids uuid[] := '{}';
  v_part text;
begin
  if p_shipment_id is null then
    return;
  end if;

  select coalesce(array_agg(distinct ii.item_id), '{}')
    into v_ids
  from public.item_intake ii
  where ii.metadata->'sendcloud'->>'sc_member_intake_shipment_id' = v_sid
     or ii.metadata->'sendcloud'->>'sc_dummy_shipment_id' = v_sid;

  select sd.metadata->>'sc_intake_item_ids'
    into v_dest_csv
  from public.shipment_destinations sd
  where sd.shipment_id = p_shipment_id
  limit 1;

  if v_dest_csv is not null and btrim(v_dest_csv) <> '' then
    foreach v_part in array string_to_array(v_dest_csv, ',') loop
      v_part := btrim(v_part);
      if v_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        v_item_id := v_part::uuid;
        if not (v_item_id = any (v_ids)) then
          v_ids := array_append(v_ids, v_item_id);
        end if;
      end if;
    end loop;
  end if;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return;
  end if;

  update public.item_intake ii
  set fulfillment_stage = 'shipping'::public.item_intake_fulfillment_stage
  where ii.item_id = any (v_ids)
    and ii.listing_stage::text = 'validated'
    and ii.fulfillment_stage::text = 'ready';
end;
$fn$;

comment on function public.promote_member_intake_items_to_shipping(uuid) is
  'Passe les pièces liées à un envoi member_intake de fulfillment ready → shipping (dépôt transporteur / dropped_in).';

create or replace function public.invoke_shipment_lifecycle_notify_http(
  p_shipment_id uuid,
  p_from_status text,
  p_to_status text,
  p_source text default 'shipment_status_trigger'
)
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
      'invoke_shipment_lifecycle_notify_http: secrets Vault manquants (segna_app_cron_base_url + segna_internal_shipment_lifecycle_secret ou segna_cron_bearer_secret).';
    return;
  end if;

  v_url := rtrim(v_base, '/') || '/api/internal/shipment-lifecycle-notify';
  v_body := jsonb_build_object(
    'shipment_id', p_shipment_id,
    'from_status', coalesce(p_from_status, ''),
    'to_status', coalesce(p_to_status, ''),
    'source', coalesce(nullif(btrim(p_source), ''), 'shipment_status_trigger')
  );
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

comment on function public.invoke_shipment_lifecycle_notify_http(uuid, text, text, text) is
  'POST async vers segna-app /api/internal/shipment-lifecycle-notify (SMS / e-mails logistiques).';

create or replace function public.trg_shipments_member_intake_dropped_in_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.context::text is distinct from 'member_intake' then
    return new;
  end if;
  if new.deleted_at is not null then
    return new;
  end if;
  if lower(new.status::text) is distinct from 'dropped_in' then
    return new;
  end if;

  if tg_op = 'UPDATE' and lower(coalesce(old.status::text, '')) = 'dropped_in' then
    return new;
  end if;

  perform public.promote_member_intake_items_to_shipping(new.id);
  perform public.invoke_shipment_lifecycle_notify_http(
    new.id,
    coalesce(old.status::text, ''),
    new.status::text,
    'shipment_member_intake_dropped_in'
  );

  return new;
end;
$fn$;

drop trigger if exists trg_shipments_member_intake_dropped_in_effects on public.shipments;
create trigger trg_shipments_member_intake_dropped_in_effects
after insert or update of status on public.shipments
for each row
execute function public.trg_shipments_member_intake_dropped_in_effects();

comment on function public.trg_shipments_member_intake_dropped_in_effects() is
  'Après passage member_intake en dropped_in : fulfillment shipping + notification membre (HTTP app).';

-- Rattrapage : envois déjà dropped_in, pièces encore ready.
select public.promote_member_intake_items_to_shipping(s.id)
from public.shipments s
where s.context = 'member_intake'::public.shipment_context
  and s.deleted_at is null
  and lower(s.status::text) = 'dropped_in';
