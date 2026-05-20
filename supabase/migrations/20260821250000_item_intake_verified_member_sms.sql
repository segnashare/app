-- SMS membre quand item_intake passe en verified (listing validated), après crédit wallet.

create or replace function public.invoke_member_lifecycle_item_notify_http(
  p_item_id uuid,
  p_event text,
  p_source text default 'item_intake_trigger'
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
  if p_item_id is null or p_event is null or btrim(p_event) = '' then
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
  where ds.name = 'segna_internal_member_lifecycle_secret'
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
      'invoke_member_lifecycle_item_notify_http: secrets Vault manquants (segna_app_cron_base_url + secret membre).';
    return;
  end if;

  v_url := rtrim(v_base, '/') || '/api/internal/member-lifecycle/notify';
  v_body := jsonb_build_object(
    'item_id', p_item_id,
    'event', btrim(p_event)
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

comment on function public.invoke_member_lifecycle_item_notify_http(uuid, text, text) is
  'POST async vers segna-app /api/internal/member-lifecycle/notify (SMS intake verified, etc.).';

-- Compte stock Segna (défaut app) : pas de SMS membre.
create or replace function public.trg_item_intake_verified_member_sms()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner uuid;
  v_corporate constant uuid := 'b2c3d4e5-f6a7-4890-b123-456789abcdef'::uuid;
begin
  if new.listing_stage::text is distinct from 'validated' then
    return new;
  end if;
  if lower(new.fulfillment_stage::text) is distinct from 'verified' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if lower(coalesce(old.fulfillment_stage::text, '')) = 'verified' then
      return new;
    end if;
  end if;

  select i.owner_user_id into v_owner
  from public.items i
  where i.id = new.item_id
    and i.deleted_at is null;

  if v_owner is null or v_owner = v_corporate then
    return new;
  end if;

  perform public.invoke_member_lifecycle_item_notify_http(
    new.item_id,
    'item_intake_verified',
    'item_intake_verified_trigger'
  );

  return new;
end;
$fn$;

drop trigger if exists trg_item_intake_verified_member_sms on public.item_intake;
create trigger trg_item_intake_verified_member_sms
after insert or update of fulfillment_stage, listing_stage on public.item_intake
for each row
execute function public.trg_item_intake_verified_member_sms();

comment on function public.trg_item_intake_verified_member_sms() is
  'Après intake validated+verified : SMS membre (crédits d’échange) via app ; exclut stock corporate.';
