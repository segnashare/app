-- Contexte checkout commande panier : débit wallet + session Stripe (page commande membre).

create or replace function public.get_member_cart_order_checkout_context(p_cart_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_amount bigint;
  v_session text;
  v_credit bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select c.user_id
    into v_owner
  from public.carts c
  where c.id = p_cart_id
    and c.deleted_at is null;

  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'cart_not_found');
  end if;

  if v_owner <> v_uid then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select wt.amount_points, wt.metadata->>'checkout_session_id'
    into v_amount, v_session
  from public.wallet_transactions wt
  where wt.user_id = v_uid
    and wt.kind = 'debit'
    and wt.direction = 'debit'
    and coalesce(wt.metadata->>'source', '') = 'cart_order_stripe'
    and nullif(trim(wt.metadata->>'cart_id'), '') is not null
    and (wt.metadata->>'cart_id')::uuid = p_cart_id
  order by wt.id desc
  limit 1;

  if v_amount is null then
    return jsonb_build_object('ok', false, 'reason', 'no_debit');
  end if;

  v_credit := 0;
  if v_session is not null and length(trim(v_session)) > 0 then
    select wt.amount_points
      into v_credit
    from public.wallet_transactions wt
    where wt.user_id = v_uid
      and wt.kind = 'credit'
      and wt.direction = 'credit'
      and wt.idempotency_key = ('stripe:cart_order_wallet:' || trim(v_session))
    limit 1;
    v_credit := coalesce(v_credit, 0);
  end if;

  return jsonb_build_object(
    'ok', true,
    'debit_points_total', v_amount,
    'wallet_topup_points', v_credit,
    'points_from_lending_balance', greatest(v_amount - v_credit, 0)::bigint,
    'checkout_session_id', nullif(trim(v_session), '')
  );
end;
$fn$;

comment on function public.get_member_cart_order_checkout_context(uuid) is
  'Membre : pour un panier confirmé, retourne la répartition crédits (solde vs complément Stripe) et l’id de session Checkout.';

revoke all on function public.get_member_cart_order_checkout_context(uuid) from public;
grant execute on function public.get_member_cart_order_checkout_context(uuid) to authenticated;
