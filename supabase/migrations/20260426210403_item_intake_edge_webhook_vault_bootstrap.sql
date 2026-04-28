-- Secret Vault pour l’en-tête `X-Webhook-Secret` (aligner avec le secret Edge `ITEM_INTAKE_WEBHOOK_SECRET`).
-- Sur les environnements vides, copier la valeur exposée ici (SQL) dans Dashboard → Project Settings → Edge Functions.
do $$
declare
  s text;
begin
  if not exists (select 1 from vault.secrets where name = 'item_intake_edge_webhook') then
    s := encode(gen_random_bytes(32), 'hex');
    perform vault.create_secret(s, 'item_intake_edge_webhook', 'X-Webhook-Secret for Edge function item-intake-evaluation-webhook');
  end if;
end
$$;
