create table if not exists public.item_losses (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'in_review', 'resolved', 'closed')),
  reason text not null,
  details text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_item_losses_item_id on public.item_losses(item_id);
create index if not exists idx_item_losses_status on public.item_losses(status);

drop trigger if exists item_losses_set_updated_at on public.item_losses;
create trigger item_losses_set_updated_at
before update on public.item_losses
for each row
execute function public.set_updated_at();
