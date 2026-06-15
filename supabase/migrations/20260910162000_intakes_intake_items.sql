-- Enveloppes d'envoi membre → Segna (comme carts / cart_items pour les emprunts).
-- Remplace les slots item_intake_1_id / item_intake_2_id sur shipments.

create table if not exists public.intakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.intakes is
  'Enveloppe logistique membre → Segna (1 colis / 1 bordereau). Liée à un shipment member_intake.';

create index if not exists intakes_user_id_active_idx
  on public.intakes (user_id)
  where deleted_at is null;

create table if not exists public.intake_items (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.intakes (id) on delete cascade,
  item_id uuid not null references public.item_intake (item_id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.intake_items is
  'Pièces rattachées à une enveloppe d''envoi (équivalent cart_items).';

create unique index if not exists intake_items_item_id_active_uniq
  on public.intake_items (item_id)
  where deleted_at is null;

create index if not exists intake_items_intake_id_active_idx
  on public.intake_items (intake_id)
  where deleted_at is null;

alter table public.shipments
  add column if not exists intake_id uuid references public.intakes (id) on delete set null;

comment on column public.shipments.intake_id is
  'Enveloppe d''envoi membre (intakes). Obligatoire pour context member_intake actif.';

create unique index if not exists shipments_member_intake_intake_active_uniq
  on public.shipments (intake_id)
  where context = 'member_intake'::public.shipment_context
    and deleted_at is null
    and intake_id is not null;

-- Rattrapage : shipments member_intake actifs → intakes + intake_items
do $backfill$
declare
  v_ship record;
  v_intake_id uuid;
  v_item_ids uuid[];
  v_item_id uuid;
  v_sort int;
  v_user_id uuid;
begin
  for v_ship in
    select s.id, s.item_intake_1_id, s.item_intake_2_id
    from public.shipments s
    where s.context = 'member_intake'::public.shipment_context
      and s.deleted_at is null
      and s.intake_id is null
      and (s.item_intake_1_id is not null or s.item_intake_2_id is not null)
  loop
    v_item_ids := array_remove(
      array[v_ship.item_intake_1_id, v_ship.item_intake_2_id],
      null::uuid
    );

    if coalesce(array_length(v_item_ids, 1), 0) = 0 then
      continue;
    end if;

    select i.owner_user_id into v_user_id
    from public.items i
    where i.id = v_item_ids[1]
    limit 1;

    if v_user_id is null then
      continue;
    end if;

    insert into public.intakes (user_id)
    values (v_user_id)
    returning id into v_intake_id;

    v_sort := 0;
    foreach v_item_id in array v_item_ids
    loop
      insert into public.intake_items (intake_id, item_id, sort_order)
      values (v_intake_id, v_item_id, v_sort)
      on conflict do nothing;
      v_sort := v_sort + 1;
    end loop;

    update public.shipments
    set intake_id = v_intake_id, updated_at = now()
    where id = v_ship.id;
  end loop;
end;
$backfill$;

-- Contrainte FK : member_intake exige intake_id (slots conservés en lecture seule legacy)
alter table public.shipments drop constraint if exists shipments_context_fk_check;

alter table public.shipments
  add constraint shipments_context_fk_check check (
    (
      context in ('cart_outbound'::public.shipment_context, 'cart_return'::public.shipment_context)
      and cart_id is not null
      and intake_id is null
    )
    or (
      context = 'member_intake'::public.shipment_context
      and cart_id is null
      and (
        deleted_at is not null
        or intake_id is not null
        or item_intake_1_id is not null
      )
    )
    or (
      context not in (
        'cart_outbound'::public.shipment_context,
        'cart_return'::public.shipment_context,
        'member_intake'::public.shipment_context
      )
    )
  );

comment on constraint shipments_context_fk_check on public.shipments is
  'cart_* exige cart_id ; member_intake actif exige intake_id (ou slot legacy en transition).';

-- RPC : pièces d'un shipment member_intake via intake_items
create or replace function public.member_intake_item_ids_from_shipment(p_shipment_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select array_agg(ii.item_id order by ii.sort_order, ii.item_id)
      from public.intake_items ii
      join public.shipments s on s.intake_id = ii.intake_id
      where s.id = p_shipment_id
        and ii.deleted_at is null
        and s.deleted_at is null
    ),
    (
      select array_remove(
        array[s.item_intake_1_id, s.item_intake_2_id],
        null::uuid
      )
      from public.shipments s
      where s.id = p_shipment_id
    ),
    '{}'::uuid[]
  );
$$;

comment on function public.member_intake_item_ids_from_shipment(uuid) is
  'Liste ordonnée des item_intake liés à un shipment member_intake (intake_items, repli slots legacy).';

-- Archive shipment member_intake quand une pièce intake est supprimée
create or replace function public.archive_member_intake_shipments_on_item_intake_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intake_id uuid;
  v_remaining int;
begin
  update public.intake_items
  set deleted_at = coalesce(deleted_at, now())
  where item_id = old.item_id
    and deleted_at is null
  returning intake_id into v_intake_id;

  if v_intake_id is not null then
    select count(*)::int into v_remaining
    from public.intake_items
    where intake_id = v_intake_id
      and deleted_at is null;

    if v_remaining = 0 then
      update public.intakes
      set deleted_at = coalesce(deleted_at, now()), updated_at = now()
      where id = v_intake_id and deleted_at is null;
    end if;
  end if;

  update public.shipments s
  set
    deleted_at = coalesce(s.deleted_at, now()),
    tracking_number = null,
    member_tracking_url = null,
    item_intake_1_id = null,
    item_intake_2_id = null,
    intake_id = null,
    updated_at = now()
  where s.context = 'member_intake'::public.shipment_context
    and s.deleted_at is null
    and (
      s.item_intake_1_id = old.item_id
      or s.item_intake_2_id = old.item_id
      or s.intake_id in (
        select ii.intake_id
        from public.intake_items ii
        where ii.item_id = old.item_id
      )
    );

  return old;
end;
$$;
