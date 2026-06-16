-- finalize_cart_order_checkout appelait confirm_cart_paid_from_stripe avec 6 args.
-- En prod, les surcharges 6 / 9 / 10 params coexistent → "function is not unique".

drop function if exists public.confirm_cart_paid_from_stripe(uuid, uuid, text, text, text, text);
drop function if exists public.confirm_cart_paid_from_stripe(uuid, uuid, text, text, text, text, text, text, text);

create or replace function public.finalize_cart_order_checkout(
  p_cart_id uuid,
  p_user_id uuid,
  p_checkout_session_id text,
  p_wallet_idempotency_key text,
  p_wallet_metadata jsonb default '{}'::jsonb,
  p_delivery_channel text default 'relay',
  p_relay_point_id text default null,
  p_delivery_line1 text default null,
  p_return_relay_point_id text default null,
  p_return_relay_label text default null,
  p_return_relay_search_postal_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $finalize$
declare
  v_debit jsonb;
  v_confirm jsonb;
  v_used_included_order boolean := coalesce(p_wallet_metadata->>'used_included_order', 'false') = 'true';
begin
  v_debit := public.wallet_debit_cart_order_stripe(
    p_user_id,
    p_cart_id,
    p_checkout_session_id,
    p_wallet_idempotency_key,
    coalesce(p_wallet_metadata, '{}'::jsonb)
  );

  v_confirm := public.confirm_cart_paid_from_stripe(
    p_cart_id,
    p_user_id,
    p_checkout_session_id,
    p_delivery_channel,
    p_relay_point_id,
    p_delivery_line1,
    p_return_relay_point_id,
    p_return_relay_label,
    p_return_relay_search_postal_code,
    v_used_included_order
  );

  return coalesce(v_confirm, '{}'::jsonb)
    || jsonb_build_object('wallet_debit', coalesce(v_debit, '{}'::jsonb));
end;
$finalize$;

comment on function public.finalize_cart_order_checkout(uuid, uuid, text, text, jsonb, text, text, text, text, text, text) is
  'Paiement panier : débit wallet (si applicable) + confirm_cart_paid_from_stripe, atomique.';

revoke all on function public.finalize_cart_order_checkout(uuid, uuid, text, text, jsonb, text, text, text, text, text, text) from public;
grant execute on function public.finalize_cart_order_checkout(uuid, uuid, text, text, jsonb, text, text, text, text, text, text) to service_role;
