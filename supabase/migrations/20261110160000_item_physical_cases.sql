-- File de traçage physique des pièces (état catalogue), distincte des litiges panier client.
-- Une case = pièce impactée dans le réel (retour défectueux, perte, MaJ manuelle).

create table if not exists public.item_physical_cases (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  status text not null default 'open'
    check (status in ('open', 'in_review', 'resolved', 'closed')),
  source text not null
    check (source in ('return_intake', 'manual', 'dispute_disposition', 'loss')),
  kind text not null
    check (kind in ('defect', 'loss', 'absence', 'other')),
  cart_id uuid references public.carts(id) on delete set null,
  cart_dispute_id uuid references public.cart_disputes(id) on delete set null,
  item_dispute_id uuid references public.item_disputes(id) on delete set null,
  cart_item_id uuid references public.cart_items(id) on delete set null,
  note text null,
  photo_paths jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamptz null,
  resolved_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_item_physical_cases_item_id
  on public.item_physical_cases (item_id);
create index if not exists idx_item_physical_cases_status
  on public.item_physical_cases (status);
create index if not exists idx_item_physical_cases_created_at
  on public.item_physical_cases (created_at desc);
create index if not exists idx_item_physical_cases_cart_dispute_id
  on public.item_physical_cases (cart_dispute_id)
  where cart_dispute_id is not null;
create index if not exists idx_item_physical_cases_open_queue
  on public.item_physical_cases (status, updated_at desc)
  where status in ('open', 'in_review');

comment on table public.item_physical_cases is
  'File de traitement physique / catalogue d''une pièce (défaut, perte, absence). Parallèle au litige client panier.';
comment on column public.item_physical_cases.source is
  'return_intake | manual | dispute_disposition | loss';
comment on column public.item_physical_cases.kind is
  'defect | loss | absence | other';
comment on column public.item_physical_cases.metadata is
  'Inclut history[] des actions ops (condition, prix, photos, description, résolution).';

drop trigger if exists item_physical_cases_set_updated_at on public.item_physical_cases;
create trigger item_physical_cases_set_updated_at
before update on public.item_physical_cases
for each row
execute function public.set_updated_at();

alter table public.item_physical_cases enable row level security;

drop policy if exists "item_physical_cases_select_via_staff" on public.item_physical_cases;
create policy "item_physical_cases_select_via_staff"
  on public.item_physical_cases for select
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role in ('moderator', 'admin')
        and ur.deleted_at is null
    )
  );

drop policy if exists "item_physical_cases_insert_via_staff" on public.item_physical_cases;
create policy "item_physical_cases_insert_via_staff"
  on public.item_physical_cases for insert
  to authenticated
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role in ('moderator', 'admin')
        and ur.deleted_at is null
    )
  );

drop policy if exists "item_physical_cases_update_via_staff" on public.item_physical_cases;
create policy "item_physical_cases_update_via_staff"
  on public.item_physical_cases for update
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role in ('moderator', 'admin')
        and ur.deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role in ('moderator', 'admin')
        and ur.deleted_at is null
    )
  );

grant select, insert, update on public.item_physical_cases to authenticated;
