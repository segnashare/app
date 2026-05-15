-- Table attendue par le feed (202604021300) et les index/policies (202605121100) ; absente de la chaîne neuve.

create table if not exists public.item_favorites (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  deleted_at timestamptz
);

drop trigger if exists trg_item_favorites_updated_at on public.item_favorites;
create trigger trg_item_favorites_updated_at
before update on public.item_favorites
for each row execute function public.set_updated_at();

drop trigger if exists trg_item_favorites_to_member_item_interactions on public.item_favorites;
create trigger trg_item_favorites_to_member_item_interactions
after insert or update on public.item_favorites
for each row execute function public.member_item_interactions_from_business_tables();

alter table public.item_favorites enable row level security;

grant select, insert, update, delete on public.item_favorites to authenticated;
