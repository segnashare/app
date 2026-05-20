-- Re-synchronise l’URL Edge (Vault) avec le projet Supabase courant.
-- Corrige le cas prod : secret créé avec l’URL dev (ptkeul…) quand segna_app_cron_base_url est absent.

create or replace function public._segna_resolve_supabase_project_ref()
  returns text
  language plpgsql
  security definer
  set search_path = public, vault
as
$$
declare
  v_cron_base text;
  v_edge_url text;
begin
  select ds.decrypted_secret::text into v_cron_base
  from vault.decrypted_secrets as ds
  where ds.name = 'segna_app_cron_base_url'
  limit 1;

  if coalesce(v_cron_base, '') ~* '^https://app\.segnashare\.com(/|$|\?)' then
    return 'lzdtipwxueczbwpmwyye';
  end if;

  select ds.decrypted_secret::text into v_edge_url
  from vault.decrypted_secrets as ds
  where ds.name = 'item_intake_evaluation_edge_url'
  limit 1;

  if coalesce(v_edge_url, '') like '%lzdtipwxueczbwpmwyye%' then
    return 'lzdtipwxueczbwpmwyye';
  end if;

  return 'ptkeulrfiiiuiqgwhnap';
end;
$$;

revoke all on function public._segna_resolve_supabase_project_ref() from public;

do $$
declare
  v_ref text;
  v_edge_url text;
  v_secret_id uuid;
  v_current text;
begin
  v_ref := public._segna_resolve_supabase_project_ref();
  v_edge_url := format(
    'https://%s.supabase.co/functions/v1/item-intake-evaluation-webhook',
    v_ref
  );

  select s.id, ds.decrypted_secret::text
  into v_secret_id, v_current
  from vault.secrets as s
  join vault.decrypted_secrets as ds on ds.name = s.name
  where s.name = 'item_intake_evaluation_edge_url'
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_edge_url,
      'item_intake_evaluation_edge_url',
      'URL Edge item-intake-evaluation-webhook (sync par ref projet)'
    );
  elsif btrim(v_current) is distinct from v_edge_url then
    perform vault.update_secret(
      v_secret_id,
      v_edge_url,
      'item_intake_evaluation_edge_url',
      'URL Edge item-intake-evaluation-webhook (sync par ref projet)'
    );
  end if;
end
$$;
