update public.user_wallets uw
set
  balance_consumption_points =
    coalesce(uw.balance_consumption_points, 0) + coalesce(uw.balance_exchange_points, 0),
  balance_exchange_points = null
where uw.deleted_at is null
  and not public.user_can_reserve_cart_inventory(uw.user_id)
  and coalesce(uw.balance_exchange_points, 0) <> 0;

update public.user_wallets uw
set
  balance_consumption_points = uw.balance_consumption_points,
  balance_exchange_points = uw.balance_exchange_points;
