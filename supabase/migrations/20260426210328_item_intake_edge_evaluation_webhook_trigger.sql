-- Envoie un payload (format « Database Webhook ») vers l’Edge `item-intake-evaluation-webhook` → n8n.
-- URL projet : vérifier qu’elle correspond (dev/staging/prod).
-- Secret : l’en-tête vient de Vault (`item_intake_edge_webhook`) — migration 20260426210403
-- ou secret créé manuellement avant l’arrivée en évaluation.
create or replace function public._trg_notify_item_intake_edge_evaluation()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, vault
as
$$
declare
  v_secret text;
  v_url     text := 'https://ptkeulrfiiiuiqgwhnap.supabase.co/functions/v1/item-intake-evaluation-webhook';
  v_payload jsonb;
  v_headers jsonb;
  ls_eval   public.item_intake_listing_stage := 'evaluation'::public.item_intake_listing_stage;
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
    tg_op = 'UPDATE' and new.listing_stage = ls_eval and (old.listing_stage is distinct from ls_eval) then
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

  select ds.decrypted_secret::text into v_secret
  from vault.decrypted_secrets as ds
  where ds.name = 'item_intake_edge_webhook'
  limit 1;

  if v_secret is null or btrim(v_secret) = '' then
    raise warning
      'item_intake_edge_webhook: secret Vault introuvable (exécuter 20260426210403 item_intake_edge_webhook_vault_bootstrap).';
    return new;
  end if;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Webhook-Secret', v_secret
  );

  perform
    net.http_post(
      url := v_url,
      body := v_payload,
      params := '{}'::jsonb,
      headers := v_headers,
      timeout_milliseconds := 20000
    );
  return new;
end;
$$;

revoke all on function public._trg_notify_item_intake_edge_evaluation() from public;

drop trigger if exists trg_item_intake_edge_evaluation_webhook on public.item_intake;
create trigger trg_item_intake_edge_evaluation_webhook
  after insert or update of listing_stage
  on public.item_intake
  for each row
execute function public._trg_notify_item_intake_edge_evaluation();

comment on function public._trg_notify_item_intake_edge_evaluation() is
'Envoie le payload (type Database Webhook) vers l’Edge `item-intake-evaluation-webhook` (net.http_post + Vault).';
