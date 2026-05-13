-- Complément wallet payé au checkout panier (`stripe:cart_order_wallet:*`) :
-- les points achetés en € doivent alimenter le seau consommation, pas l’échange.
-- Corrige les lignes déjà postées + rééquilibre `user_wallets`.

create temporary table _fix_cart_wallet_topup_exchange on commit drop as
select wt.id, wt.user_id, greatest(0::bigint, coalesce(wt.amount_points, 0)::bigint) as pts
from public.wallet_transactions wt
where wt.kind = 'credit'
  and wt.direction = 'credit'
  and wt.status = 'posted'
  and lower(trim(coalesce(wt.credit_bucket, ''))) = 'exchange'
  and wt.idempotency_key like 'stripe:cart_order_wallet:%';

update public.wallet_transactions wt
set
  credit_bucket = 'consumption',
  metadata =
    coalesce(wt.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'credits_kind', 'consumption',
      'bucket_corrected_from_exchange_cart_topup', true
    )
from _fix_cart_wallet_topup_exchange f
where wt.id = f.id;

update public.user_wallets uw
set
  balance_exchange_points = greatest(
    0::bigint,
    coalesce(uw.balance_exchange_points, 0::bigint) - a.move_pts
  ),
  balance_consumption_points = coalesce(uw.balance_consumption_points, 0) + a.move_pts,
  updated_at = timezone('utc', now())
from (
  select f.user_id, sum(f.pts)::bigint as move_pts
  from _fix_cart_wallet_topup_exchange f
  group by f.user_id
) a
where uw.user_id = a.user_id
  and uw.deleted_at is null;
