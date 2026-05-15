-- wallet_available_points (requis avant reserve_cart_atomic checkout). deleted_at : voir 20260513120150.

alter table public.user_wallets
  add column if not exists balance_points bigint not null default 0;

create or replace function public.wallet_available_points(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select w.balance_points from public.user_wallets w where w.user_id = p_user_id),
    0::bigint
  );
$function$;
