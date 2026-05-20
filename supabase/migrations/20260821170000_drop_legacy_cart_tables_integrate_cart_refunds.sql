-- Supprime tables commerce legacy (jamais branchées dans le code actuel).
-- Branche cart_refunds sur chaque crédit wallet d’annulation / remboursement panier.

-- ---------------------------------------------------------------------------
-- Drop legacy tables
-- ---------------------------------------------------------------------------

drop table if exists public.cart_shipping_addresses cascade;
drop table if exists public.cart_shipping cascade;
drop table if exists public.cart_deposits cascade;

-- ---------------------------------------------------------------------------
-- cart_refunds : alignement montants + idempotence + RLS
-- ---------------------------------------------------------------------------

alter table public.cart_refunds
  alter column amount_points type bigint using amount_points::bigint;

create unique index if not exists cart_refunds_wallet_transaction_id_key
  on public.cart_refunds (wallet_transaction_id);

create index if not exists cart_refunds_cart_id_idx on public.cart_refunds (cart_id);
create index if not exists cart_refunds_user_id_idx on public.cart_refunds (user_id);
create index if not exists cart_refunds_created_at_idx on public.cart_refunds (created_at desc);

comment on table public.cart_refunds is
  'Journal des remboursements wallet liés à un panier (une ligne par crédit wallet d’annulation).';

alter table public.cart_refunds enable row level security;

drop policy if exists cart_refunds_select_own on public.cart_refunds;
create policy cart_refunds_select_own
  on public.cart_refunds
  for select
  to authenticated
  using (user_id = (select auth.uid()));

grant select on public.cart_refunds to authenticated;
grant all on public.cart_refunds to service_role;

-- ---------------------------------------------------------------------------
-- Trigger : wallet credit cart_order_cancel → cart_refunds
-- ---------------------------------------------------------------------------

create or replace function public.cart_refunds_from_wallet_credit()
returns trigger
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_cart_id uuid;
  v_reason text;
begin
  if new.kind is distinct from 'credit' or new.direction is distinct from 'credit' then
    return new;
  end if;

  if coalesce(new.metadata ->> 'source', '') is distinct from 'cart_order_cancel' then
    return new;
  end if;

  begin
    v_cart_id := nullif(trim(new.metadata ->> 'cart_id'), '')::uuid;
  exception
    when others then
      return new;
  end;

  if v_cart_id is null or new.amount_points is null or new.amount_points <= 0 then
    return new;
  end if;

  if not exists (
    select 1 from public.carts c where c.id = v_cart_id
  ) then
    return new;
  end if;

  v_reason := coalesce(
    nullif(trim(new.metadata ->> 'credits_kind'), ''),
    nullif(trim(new.metadata ->> 'refund_reason'), ''),
    'cart_order_cancel'
  );

  insert into public.cart_refunds (
    cart_id,
    user_id,
    amount_points,
    reason,
    wallet_transaction_id
  )
  values (
    v_cart_id,
    new.user_id,
    new.amount_points,
    v_reason,
    new.id
  )
  on conflict (wallet_transaction_id) do nothing;

  return new;
end;
$fn$;

comment on function public.cart_refunds_from_wallet_credit() is
  'Après INSERT wallet_transactions : crée une ligne cart_refunds pour chaque crédit source=cart_order_cancel.';

drop trigger if exists trg_wallet_transactions_cart_refunds on public.wallet_transactions;
create trigger trg_wallet_transactions_cart_refunds
after insert on public.wallet_transactions
for each row
execute function public.cart_refunds_from_wallet_credit();

-- Backfill remboursements wallet déjà postés
insert into public.cart_refunds (cart_id, user_id, amount_points, reason, wallet_transaction_id)
select
  (wt.metadata ->> 'cart_id')::uuid,
  wt.user_id,
  wt.amount_points,
  coalesce(
    nullif(trim(wt.metadata ->> 'credits_kind'), ''),
    nullif(trim(wt.metadata ->> 'refund_reason'), ''),
    'cart_order_cancel'
  ),
  wt.id
from public.wallet_transactions wt
inner join public.carts c on c.id = (wt.metadata ->> 'cart_id')::uuid
where wt.kind = 'credit'
  and wt.direction = 'credit'
  and coalesce(wt.metadata ->> 'source', '') = 'cart_order_cancel'
  and nullif(trim(wt.metadata ->> 'cart_id'), '') is not null
  and wt.amount_points > 0
on conflict (wallet_transaction_id) do nothing;
