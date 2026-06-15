-- Enveloppes logistiques communes membre ↔ Segna (intake + outtake).
-- Remplace intakes / intake_items et supprime les slots legacy item_intake_1_id / item_intake_2_id.

-- ── Renommage tables & colonnes ─────────────────────────────────────────────

alter table if exists public.intakes rename to transfers;

comment on table public.transfers is
  'Enveloppe logistique membre (1 colis / 1 bordereau). Intake ou outtake selon shipments.context.';

alter index if exists public.intakes_user_id_active_idx rename to transfers_user_id_active_idx;

alter table if exists public.intake_items rename to transfer_items;

alter table if exists public.transfer_items rename column intake_id to transfer_id;

comment on table public.transfer_items is
  'Pièces rattachées à une enveloppe logistique (équivalent cart_items).';

alter index if exists public.intake_items_item_id_active_uniq rename to transfer_items_item_id_active_uniq;
alter index if exists public.intake_items_intake_id_active_idx rename to transfer_items_transfer_id_active_idx;

alter table public.shipments rename column intake_id to transfer_id;

comment on column public.shipments.transfer_id is
  'Enveloppe logistique (transfers). Obligatoire pour member_intake / member_outtake actifs.';

drop index if exists public.shipments_member_intake_intake_active_uniq;

create unique index if not exists shipments_member_intake_transfer_active_uniq
  on public.shipments (transfer_id)
  where context = 'member_intake'::public.shipment_context
    and deleted_at is null
    and transfer_id is not null;

create unique index if not exists shipments_member_outtake_transfer_active_uniq
  on public.shipments (transfer_id)
  where context = 'member_outtake'::public.shipment_context
    and deleted_at is null
    and transfer_id is not null;

-- FK transfer_items → items (intake + outtake)
alter table public.transfer_items drop constraint if exists intake_items_item_id_fkey;

alter table public.transfer_items
  add constraint transfer_items_item_id_fkey
  foreign key (item_id) references public.items (id) on delete cascade;

-- ── Suppression slots legacy ──────────────────────────────────────────────────

drop index if exists public.shipments_member_intake_slot1_active_idx;
drop index if exists public.shipments_member_intake_slot1_active_uniq;
drop index if exists public.shipments_member_intake_slot2_active_uniq;

alter table public.shipments drop constraint if exists shipments_member_intake_slots_check;

alter table public.shipments
  drop column if exists item_intake_1_id,
  drop column if exists item_intake_2_id;

-- ── Contrainte contexte shipment ────────────────────────────────────────────

alter table public.shipments drop constraint if exists shipments_context_fk_check;

alter table public.shipments
  add constraint shipments_context_fk_check check (
    (
      context in ('cart_outbound'::public.shipment_context, 'cart_return'::public.shipment_context)
      and cart_id is not null
      and transfer_id is null
    )
    or (
      context = 'member_intake'::public.shipment_context
      and cart_id is null
      and (deleted_at is not null or transfer_id is not null)
    )
    or (
      context = 'member_outtake'::public.shipment_context
      and cart_id is null
      and (deleted_at is not null or transfer_id is not null)
    )
    or (
      context not in (
        'cart_outbound'::public.shipment_context,
        'cart_return'::public.shipment_context,
        'member_intake'::public.shipment_context,
        'member_outtake'::public.shipment_context
      )
    )
  );

comment on constraint shipments_context_fk_check on public.shipments is
  'cart_* exige cart_id ; member_intake / member_outtake actifs exigent transfer_id.';

-- ── RPC pièces d''un shipment membre ─────────────────────────────────────────

create or replace function public.member_intake_item_ids_from_shipment(p_shipment_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select array_agg(ti.item_id order by ti.sort_order, ti.item_id)
      from public.transfer_items ti
      join public.shipments s on s.transfer_id = ti.transfer_id
      where s.id = p_shipment_id
        and ti.deleted_at is null
        and s.deleted_at is null
    ),
    '{}'::uuid[]
  );
$$;

comment on function public.member_intake_item_ids_from_shipment(uuid) is
  'Liste ordonnée des pièces liées à un shipment member_intake (transfer_items).';

create or replace function public.member_transfer_item_ids_from_shipment(p_shipment_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select public.member_intake_item_ids_from_shipment(p_shipment_id);
$$;

comment on function public.member_transfer_item_ids_from_shipment(uuid) is
  'Alias générique (intake / outtake) : pièces d''un shipment membre via transfer_items.';

-- ── Trigger archive shipment quand item_intake supprimé ───────────────────────

create or replace function public.archive_member_intake_shipments_on_item_intake_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer_id uuid;
  v_remaining int;
begin
  update public.transfer_items
  set deleted_at = coalesce(deleted_at, now())
  where item_id = old.item_id
    and deleted_at is null
  returning transfer_id into v_transfer_id;

  if v_transfer_id is not null then
    select count(*)::int into v_remaining
    from public.transfer_items
    where transfer_id = v_transfer_id
      and deleted_at is null;

    if v_remaining = 0 then
      update public.transfers
      set deleted_at = coalesce(deleted_at, now()), updated_at = now()
      where id = v_transfer_id and deleted_at is null;
    end if;
  end if;

  update public.shipments s
  set
    deleted_at = coalesce(s.deleted_at, now()),
    tracking_number = null,
    member_tracking_url = null,
    transfer_id = null,
    updated_at = now()
  where s.context = 'member_intake'::public.shipment_context
    and s.deleted_at is null
    and s.transfer_id in (
      select ti.transfer_id
      from public.transfer_items ti
      where ti.item_id = old.item_id
    );

  return old;
end;
$$;

-- promote_member_intake_items_to_shipping : utilise la RPC mise à jour
create or replace function public.promote_member_intake_items_to_shipping(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_ids uuid[];
  v_item_id uuid;
  v_sid text;
begin
  v_sid := p_shipment_id::text;
  v_item_ids := public.member_intake_item_ids_from_shipment(p_shipment_id);

  foreach v_item_id in array v_item_ids
  loop
    update public.item_intake ii
    set fulfillment_stage = 'shipping'::public.item_intake_fulfillment_stage,
        updated_at = now()
    where ii.item_id = v_item_id
      and ii.deleted_at is null
      and ii.fulfillment_stage = 'ready'::public.item_intake_fulfillment_stage
      and coalesce(ii.metadata->'sendcloud'->>'sc_member_intake_shipment_id', '') = v_sid;
  end loop;
end;
$$;
