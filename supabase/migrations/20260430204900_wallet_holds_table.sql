-- Holds wallet par panier (réservation) : absente du baseline ; requise avant les RPC compétition / release.

create table if not exists public.wallet_holds (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.users (id) on delete cascade,
  cart_id uuid not null references public.carts (id) on delete cascade,
  amount_points bigint not null,
  status text not null default 'active',
  expires_at timestamptz not null,
  released_at timestamptz,
  constraint wallet_holds_cart_id_key unique (cart_id),
  constraint wallet_holds_status_check check (status in ('active', 'expired'))
);

create index if not exists wallet_holds_user_id_idx on public.wallet_holds (user_id);
create index if not exists wallet_holds_status_expires_idx on public.wallet_holds (status, expires_at);

drop trigger if exists trg_wallet_holds_updated_at on public.wallet_holds;
create trigger trg_wallet_holds_updated_at
before update on public.wallet_holds
for each row execute function public.set_updated_at();

comment on table public.wallet_holds is
  'Blocage points wallet pendant réservation panier (référencé par reserve_cart_atomic / expire_wallet_holds).';
