-- Corrige l’URL Edge figée sur le projet dev (ptkeulrfiiiuiqgwhnap) : en prod le trigger
-- appelait l’Edge dev → workflow n8n dev.
-- URL lue depuis Vault `item_intake_evaluation_edge_url` (bootstrap selon segna_app_cron_base_url).

create or replace function public._trg_notify_item_intake_edge_evaluation()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, vault
as
$$
declare
  v_secret text;
  v_url text;
  v_payload jsonb;
  v_headers jsonb;
  ls_eval public.item_intake_listing_stage := 'evaluation'::public.item_intake_listing_stage;
begin
  if tg_op = 'INSERT' and new.listing_stage = ls_eval then
    v_payload := jsonb_build_object(
      'type', 'INSERT',
      'table', 'item_intake',
      'schema', 'public',
      'record', to_jsonb(new),
      'old_record', null
    );
  elsif
    tg_op = 'UPDATE'
    and new.listing_stage = ls_eval
    and (old.listing_stage is distinct from ls_eval) then
    v_payload := jsonb_build_object(
      'type', 'UPDATE',
      'table', 'item_intake',
      'schema', 'public',
      'record', to_jsonb(new),
      'old_record', to_jsonb(old)
    );
  else
    return new;
  end if;

  select ds.decrypted_secret::text into v_url
  from vault.decrypted_secrets as ds
  where ds.name = 'item_intake_evaluation_edge_url'
  limit 1;

  if v_url is null or btrim(v_url) = '' then
    raise warning
      'item_intake_evaluation_edge_url: secret Vault introuvable — évaluation n8n non déclenchée.';
    return new;
  end if;

  select ds.decrypted_secret::text into v_secret
  from vault.decrypted_secrets as ds
  where ds.name = 'item_intake_edge_webhook'
  limit 1;

  if v_secret is null or btrim(v_secret) = '' then
    raise warning
      'item_intake_edge_webhook: secret Vault introuvable (migration 20260426210403).';
    return new;
  end if;

  v_headers := jsonb_build_object(
    'content-type', 'application/json',
    'X-Webhook-Secret', v_secret
  );

  perform net.http_post(
    url := btrim(v_url),
    body := v_payload,
    params := '{}'::jsonb,
    headers := v_headers,
    timeout_milliseconds := 20000
  );
  return new;
end;
$$;

comment on function public._trg_notify_item_intake_edge_evaluation() is
  'Transition listing_stage → evaluation : pg_net vers Edge item-intake-evaluation-webhook (URL Vault item_intake_evaluation_edge_url).';

do $$
declare
  v_cron_base text;
  v_edge_url text;
begin
  if exists (select 1 from vault.secrets where name = 'item_intake_evaluation_edge_url') then
    return;
  end if;

  select ds.decrypted_secret::text into v_cron_base
  from vault.decrypted_secrets as ds
  where ds.name = 'segna_app_cron_base_url'
  limit 1;

  if coalesce(v_cron_base, '') ilike '%app.segnashare.com%' then
    v_edge_url := 'https://lzdtipwxueczbwpmwyye.supabase.co/functions/v1/item-intake-evaluation-webhook';
  else
    v_edge_url := 'https://ptkeulrfiiiuiqgwhnap.supabase.co/functions/v1/item-intake-evaluation-webhook';
  end if;

  perform vault.create_secret(
    v_edge_url,
    'item_intake_evaluation_edge_url',
    'URL Edge item-intake-evaluation-webhook (trigger item_intake → evaluation → n8n)'
  );
end
$$;
