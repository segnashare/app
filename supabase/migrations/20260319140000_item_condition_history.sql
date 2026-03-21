-- Table d'historique des conditions/défauts d'une pièce.
-- Chaque ligne = un instant de la vie de la pièce : on sait d'où vient la condition (source)
-- et à quel moment elle était pertinente (recorded_at).
-- Sources : état initial annoncé par la membre, état à l'arrivée en collection,
-- états successifs aux retours, défauts pendant les échanges, contrôles périodiques.
create table if not exists public.item_condition_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  source text not null check (
    source in (
      'owner_announced',      -- état initial annoncé par la membre
      'arrival_inspection',   -- état remarqué à l'arrivée en collection
      'return_inspection',    -- état constaté au retour d'un prêt
      'defect_during_exchange', -- défaut survenu pendant un échange
      'periodic_check',       -- contrôle périodique
      'other'
    )
  ),
  condition_score text not null check (
    condition_score in ('excellent', 'bon', 'acceptable', 'degrade')
  ),
  description text,
  defect_notes text,
  recorded_at timestamptz not null default now(),
  recorded_by_user_id uuid references public.users(id) on delete set null,
  shipment_item_id uuid references public.shipment_items(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_item_condition_history_item_id
  on public.item_condition_history (item_id);
create index if not exists idx_item_condition_history_recorded_at
  on public.item_condition_history (item_id, recorded_at desc);

comment on table public.item_condition_history is 'Historique des conditions et défauts d''une pièce. Chaque ligne = un instant de vie : source (d''où vient la condition) et recorded_at (quand elle était pertinente).';
comment on column public.item_condition_history.source is 'owner_announced=état initial membre, arrival_inspection=à l''arrivée en collection, return_inspection=au retour prêt, defect_during_exchange=défaut pendant échange, periodic_check=contrôle périodique';
comment on column public.item_condition_history.condition_score is 'excellent | bon | acceptable | degrade';
comment on column public.item_condition_history.shipment_item_id is 'Lien optionnel vers le shipment_item si la condition a été constatée lors d''un envoi/retour';

-- items.current_condition_id : pointe vers la dernière condition enregistrée (pour accès rapide)
alter table public.items
  add column if not exists current_condition_id uuid references public.item_condition_history(id) on delete set null;

create index if not exists idx_items_current_condition_id
  on public.items (current_condition_id) where current_condition_id is not null;

-- Trigger : mettre à jour items.current_condition_id à chaque nouvelle entrée
create or replace function public.sync_item_current_condition_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.items
  set current_condition_id = new.id
  where id = new.item_id;
  return new;
end;
$$;

drop trigger if exists trg_item_condition_history_sync_current on public.item_condition_history;
create trigger trg_item_condition_history_sync_current
  after insert on public.item_condition_history
  for each row execute function public.sync_item_current_condition_id();

-- RLS
alter table public.item_condition_history enable row level security;

-- Lecture : owner de l'item ou staff
create policy "item_condition_history_select_via_item_owner"
  on public.item_condition_history for select
  to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_condition_history.item_id
        and i.owner_user_id = auth.uid()
        and i.deleted_at is null
    )
  );

create policy "item_condition_history_select_via_staff"
  on public.item_condition_history for select
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role in ('moderator', 'admin', 'super_admin')
        and ur.deleted_at is null
    )
  );

-- Insert : owner de l'item (owner_announced) ou staff (arrival, return, defect, etc.)
create policy "item_condition_history_insert_via_item_owner"
  on public.item_condition_history for insert
  to authenticated
  with check (
    exists (
      select 1 from public.items i
      where i.id = item_condition_history.item_id
        and i.owner_user_id = auth.uid()
        and i.deleted_at is null
    )
  );

create policy "item_condition_history_insert_via_staff"
  on public.item_condition_history for insert
  to authenticated
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role in ('moderator', 'admin', 'super_admin')
        and ur.deleted_at is null
    )
  );

-- Update/Delete : pas prévus (historique append-only)

grant select, insert on public.item_condition_history to authenticated;
