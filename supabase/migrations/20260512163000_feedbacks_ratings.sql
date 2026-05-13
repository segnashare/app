-- Feedbacks unifiés : notes de commande, de pièce et de membre.
-- rating est nullable : l’utilisateur / staff peut ignorer la note sans créer de fausse moyenne.

do $$
begin
  create type public.feedback_target_type as enum ('exchange', 'item', 'user');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.feedbacks (
  id uuid primary key default gen_random_uuid(),
  target_type public.feedback_target_type not null,
  cart_id uuid references public.carts(id) on delete cascade,
  cart_item_id uuid references public.cart_items(id) on delete cascade,
  item_id uuid references public.items(id) on delete cascade,
  target_user_id uuid references public.users(id) on delete cascade,
  reviewer_user_id uuid references public.users(id) on delete set null,
  rating smallint check (rating is null or rating between 1 and 5),
  comment text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint feedbacks_target_shape_chk check (
    (
      target_type = 'exchange'::public.feedback_target_type
      and cart_id is not null
    )
    or (
      target_type = 'item'::public.feedback_target_type
      and item_id is not null
    )
    or (
      target_type = 'user'::public.feedback_target_type
      and target_user_id is not null
    )
  )
);

create index if not exists feedbacks_item_rating_idx
  on public.feedbacks (item_id, rating)
  where deleted_at is null
    and target_type = 'item'::public.feedback_target_type
    and rating is not null;

create index if not exists feedbacks_user_rating_idx
  on public.feedbacks (target_user_id, rating)
  where deleted_at is null
    and target_type = 'user'::public.feedback_target_type
    and rating is not null;

create index if not exists feedbacks_exchange_cart_idx
  on public.feedbacks (cart_id, reviewer_user_id)
  where deleted_at is null
    and target_type = 'exchange'::public.feedback_target_type;

create unique index if not exists feedbacks_exchange_unique_live_idx
  on public.feedbacks (cart_id, reviewer_user_id)
  where deleted_at is null
    and target_type = 'exchange'::public.feedback_target_type
    and cart_id is not null
    and reviewer_user_id is not null;

create unique index if not exists feedbacks_item_unique_live_idx
  on public.feedbacks (cart_item_id, reviewer_user_id)
  where deleted_at is null
    and target_type = 'item'::public.feedback_target_type
    and cart_item_id is not null
    and reviewer_user_id is not null;

create unique index if not exists feedbacks_user_unique_live_idx
  on public.feedbacks (cart_id, target_user_id, reviewer_user_id)
  where deleted_at is null
    and target_type = 'user'::public.feedback_target_type
    and cart_id is not null
    and target_user_id is not null
    and reviewer_user_id is not null;

alter table public.feedbacks enable row level security;

drop policy if exists feedbacks_select_participants_or_staff on public.feedbacks;
create policy feedbacks_select_participants_or_staff
on public.feedbacks
for select
to authenticated
using (
  reviewer_user_id = auth.uid()
  or target_user_id = auth.uid()
  or exists (
    select 1
    from public.carts c
    where c.id = feedbacks.cart_id
      and c.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.items i
    where i.id = feedbacks.item_id
      and i.owner_user_id = auth.uid()
  )
  or is_staff()
);

drop policy if exists feedbacks_insert_own_or_staff on public.feedbacks;
create policy feedbacks_insert_own_or_staff
on public.feedbacks
for insert
to authenticated
with check (
  reviewer_user_id = auth.uid()
  or is_staff()
);

drop policy if exists feedbacks_update_own_or_staff on public.feedbacks;
create policy feedbacks_update_own_or_staff
on public.feedbacks
for update
to authenticated
using (
  reviewer_user_id = auth.uid()
  or is_staff()
)
with check (
  reviewer_user_id = auth.uid()
  or is_staff()
);

grant select, insert, update on public.feedbacks to authenticated;
grant all on public.feedbacks to service_role;

create or replace function public.get_feedback_rating_average(
  p_target_type text,
  p_item_id uuid default null,
  p_target_user_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(avg(f.rating)::numeric, 2)
  from public.feedbacks f
  where f.deleted_at is null
    and f.rating is not null
    and f.target_type::text = p_target_type
    and (
      (p_target_type = 'item' and f.item_id = p_item_id)
      or (p_target_type = 'user' and f.target_user_id = p_target_user_id)
      or (p_target_type = 'exchange' and f.cart_id is not null)
    );
$$;

grant execute on function public.get_feedback_rating_average(text, uuid, uuid) to authenticated;

create or replace function public.get_feedback_rating_summary(
  p_target_type text,
  p_item_id uuid default null,
  p_target_user_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'average', round(avg(f.rating)::numeric, 2),
    'count', count(f.rating)::integer
  )
  from public.feedbacks f
  where f.deleted_at is null
    and f.rating is not null
    and f.target_type::text = p_target_type
    and (
      (p_target_type = 'item' and f.item_id = p_item_id)
      or (p_target_type = 'user' and f.target_user_id = p_target_user_id)
      or (p_target_type = 'exchange' and f.cart_id is not null)
    );
$$;

grant execute on function public.get_feedback_rating_summary(text, uuid, uuid) to authenticated;

create or replace function public.get_item_exchange_count(p_item_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.cart_items ci
  inner join public.carts c on c.id = ci.cart_id
  where ci.item_id = p_item_id
    and ci.deleted_at is null
    and ci.status = 'archived'::public.cart_item_status
    and c.deleted_at is null
    and c.status = 'archived'::public.cart_status;
$$;

grant execute on function public.get_item_exchange_count(uuid) to authenticated;

create or replace function public.get_user_exchange_count(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct c.id)::integer
  from public.carts c
  left join public.cart_items ci
    on ci.cart_id = c.id
    and ci.deleted_at is null
  left join public.items i
    on i.id = ci.item_id
    and i.deleted_at is null
  where c.deleted_at is null
    and c.status = 'archived'::public.cart_status
    and (
      c.user_id = p_user_id
      or i.owner_user_id = p_user_id
    );
$$;

grant execute on function public.get_user_exchange_count(uuid) to authenticated;

comment on table public.feedbacks is
  'Notes optionnelles (1-5 ou null) pour échanges, pièces et membres. Les moyennes affichées ignorent les ratings null.';
