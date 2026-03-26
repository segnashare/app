-- 1) Enum fulfillment : ne garder que shipping | in_verification | verified (supprime shipped_in / verification_pending).
-- 2) item_intake.deleted_at : miroir logique quand items passe en draft_deleted.
-- 3) item_status_history : colonnes optionnelles pour suivre listing + fulfillment.
-- 4) Triggers d'audit + RPC mark_item_draft_deleted pour le chemin membre.

-- ---------------------------------------------------------------------------
-- A) Données : dernières lignes encore sur les anciens labels
-- ---------------------------------------------------------------------------
update public.item_intake
set fulfillment_stage = 'shipping'::public.item_intake_fulfillment_stage
where fulfillment_stage::text = 'shipped_in';

update public.item_intake
set fulfillment_stage = 'in_verification'::public.item_intake_fulfillment_stage
where fulfillment_stage::text = 'verification_pending';

-- ---------------------------------------------------------------------------
-- B) Remplacer le type enum (sans DROP VALUE, impossible en PG)
-- ---------------------------------------------------------------------------
drop trigger if exists trg_item_intake_after_update_sync_listed on public.item_intake;
drop trigger if exists trg_item_intake_before_insert_guard on public.item_intake;
drop trigger if exists trg_item_intake_before_update_guard on public.item_intake;

create type public.item_intake_fulfillment_stage_new as enum (
  'shipping',
  'in_verification',
  'verified'
);

alter table public.item_intake
  alter column fulfillment_stage type public.item_intake_fulfillment_stage_new
  using (
    case fulfillment_stage::text
      when 'shipped_in' then 'shipping'::public.item_intake_fulfillment_stage_new
      when 'verification_pending' then 'in_verification'::public.item_intake_fulfillment_stage_new
      when 'shipping' then 'shipping'::public.item_intake_fulfillment_stage_new
      when 'in_verification' then 'in_verification'::public.item_intake_fulfillment_stage_new
      when 'verified' then 'verified'::public.item_intake_fulfillment_stage_new
      else null
    end
  );

drop type public.item_intake_fulfillment_stage;
alter type public.item_intake_fulfillment_stage_new rename to item_intake_fulfillment_stage;

comment on column public.item_intake.fulfillment_stage is
  'shipping=en transit vers Segna ; in_verification=controle physique ; verified=OK -> items.status listed (trigger).';

-- Recréer les fonctions / triggers pipeline (même logique que 20260325210100 / 20260330130000)
create or replace function public.item_intake_before_insert_member_fulfillment_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfillment_stage is not null
     and coalesce((select auth.jwt()) ->> 'role', '') = 'authenticated'
  then
    raise exception 'item_intake.fulfillment_stage: insertion reservee au service role';
  end if;
  return new;
end;
$$;

create trigger trg_item_intake_before_insert_guard
before insert on public.item_intake
for each row
execute function public.item_intake_before_insert_member_fulfillment_guard();

create or replace function public.item_intake_before_update_member_fulfillment_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select auth.jwt()) ->> 'role', '') = 'authenticated'
     and new.fulfillment_stage is distinct from old.fulfillment_stage
  then
    raise exception 'item_intake.fulfillment_stage: mise a jour reservee au service role';
  end if;
  if new.listing_stage::text = 'validated'
     and old.listing_stage::text = 'validation_pending'
     and new.fulfillment_stage is null
  then
    new.fulfillment_stage := 'shipping'::public.item_intake_fulfillment_stage;
  end if;
  return new;
end;
$$;

create trigger trg_item_intake_before_update_guard
before update on public.item_intake
for each row
execute function public.item_intake_before_update_member_fulfillment_guard();

create or replace function public.item_intake_after_update_sync_items_listed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfillment_stage::text = 'verified' and new.listing_stage::text = 'validated' then
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.fulfillment_stage is distinct from new.fulfillment_stage) then
      update public.items
      set
        status = 'listed'::public.item_status,
        updated_at = now()
      where id = new.item_id
        and deleted_at is null
        and status not in ('in_cart'::public.item_status, 'reserved'::public.item_status);
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_item_intake_after_update_sync_listed
after insert or update of fulfillment_stage on public.item_intake
for each row
execute function public.item_intake_after_update_sync_items_listed();

-- ---------------------------------------------------------------------------
-- C) item_intake.deleted_at
-- ---------------------------------------------------------------------------
alter table public.item_intake
  add column if not exists deleted_at timestamptz;

comment on column public.item_intake.deleted_at is
  'Aligné sur la suppression brouillon côté items (draft_deleted + deleted_at).';

create index if not exists item_intake_deleted_at_idx on public.item_intake (deleted_at)
  where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- D) Historique : colonnes intake sur item_status_history
-- ---------------------------------------------------------------------------
alter table public.item_status_history
  add column if not exists from_listing_stage public.item_intake_listing_stage,
  add column if not exists to_listing_stage public.item_intake_listing_stage,
  add column if not exists from_fulfillment_stage public.item_intake_fulfillment_stage,
  add column if not exists to_fulfillment_stage public.item_intake_fulfillment_stage;

comment on column public.item_status_history.from_listing_stage is
  'Renseigné quand la ligne documente un changement item_intake (avec to_*).';
comment on column public.item_status_history.to_listing_stage is
  'Renseigné quand la ligne documente un changement item_intake (avec from_*).';

-- ---------------------------------------------------------------------------
-- E) Audit : changements items.status / deleted_at
-- ---------------------------------------------------------------------------
create or replace function public.items_after_update_log_item_status_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status
     or old.deleted_at is distinct from new.deleted_at
  then
    insert into public.item_status_history (
      id,
      item_id,
      actor_user_id,
      from_status,
      to_status,
      reason,
      from_listing_stage,
      to_listing_stage,
      from_fulfillment_stage,
      to_fulfillment_stage
    )
    values (
      gen_random_uuid(),
      new.id,
      auth.uid(),
      old.status,
      new.status,
      case
        when old.deleted_at is distinct from new.deleted_at then 'items_deleted_at_or_status'
        else 'items_status'
      end,
      null,
      null,
      null,
      null
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_items_after_update_log_status_history on public.items;
create trigger trg_items_after_update_log_status_history
after update on public.items
for each row
execute function public.items_after_update_log_item_status_history();

create or replace function public.items_after_insert_log_item_status_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.item_status_history (
    id,
    item_id,
    actor_user_id,
    from_status,
    to_status,
    reason,
    from_listing_stage,
    to_listing_stage,
    from_fulfillment_stage,
    to_fulfillment_stage
  )
  values (
    gen_random_uuid(),
    new.id,
    auth.uid(),
    null,
    new.status,
    'items_insert',
    null,
    null,
    null,
    null
  );
  return new;
end;
$$;

drop trigger if exists trg_items_after_insert_log_status_history on public.items;
create trigger trg_items_after_insert_log_status_history
after insert on public.items
for each row
execute function public.items_after_insert_log_item_status_history();

-- ---------------------------------------------------------------------------
-- F) Audit : changements item_intake listing / fulfillment
-- ---------------------------------------------------------------------------
create or replace function public.item_intake_after_update_log_pipeline_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_st public.item_status;
begin
  if old.listing_stage is distinct from new.listing_stage
     or old.fulfillment_stage is distinct from new.fulfillment_stage
     or old.deleted_at is distinct from new.deleted_at
  then
    select i.status into v_st from public.items i where i.id = new.item_id;
    if v_st is null then
      return new;
    end if;
    insert into public.item_status_history (
      id,
      item_id,
      actor_user_id,
      from_status,
      to_status,
      reason,
      from_listing_stage,
      to_listing_stage,
      from_fulfillment_stage,
      to_fulfillment_stage
    )
    values (
      gen_random_uuid(),
      new.item_id,
      auth.uid(),
      v_st,
      v_st,
      'item_intake_pipeline',
      old.listing_stage,
      new.listing_stage,
      old.fulfillment_stage,
      new.fulfillment_stage
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_item_intake_after_update_log_pipeline_history on public.item_intake;
create trigger trg_item_intake_after_update_log_pipeline_history
after update on public.item_intake
for each row
execute function public.item_intake_after_update_log_pipeline_history();

-- ---------------------------------------------------------------------------
-- G) Sync draft_deleted -> item_intake (deleted_at + reset fulfillment)
-- ---------------------------------------------------------------------------
create or replace function public.items_after_update_sync_item_intake_on_draft_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'draft_deleted'::public.item_status then
    update public.item_intake
    set
      deleted_at = coalesce(new.deleted_at, now()),
      fulfillment_stage = null,
      listing_stage = 'draft'::public.item_intake_listing_stage,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('legacy_items_status', 'draft_deleted'),
      updated_at = now()
    where item_id = new.id;
  elsif old.status = 'draft_deleted'::public.item_status
        and new.status = 'draft'::public.item_status
        and new.deleted_at is null
  then
    update public.item_intake
    set
      deleted_at = null,
      updated_at = now()
    where item_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_items_after_update_sync_item_intake_draft_deleted on public.items;
create trigger trg_items_after_update_sync_item_intake_draft_deleted
after update on public.items
for each row
execute function public.items_after_update_sync_item_intake_on_draft_deleted();

-- ---------------------------------------------------------------------------
-- H) RPC membre / staff : brouillon supprimé (aligne items + item_intake via triggers ci-dessus)
-- ---------------------------------------------------------------------------
create or replace function public.mark_item_draft_deleted(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner_user_id into v_owner from public.items where id = p_item_id;
  if v_owner is null then
    raise exception 'item introuvable';
  end if;
  if v_owner is distinct from auth.uid()
     and not public.has_role('admin'::public.app_role)
     and not public.has_role('moderator'::public.app_role)
  then
    raise exception 'non autorise';
  end if;

  update public.items
  set
    status = 'draft_deleted'::public.item_status,
    deleted_at = coalesce(deleted_at, now()),
    updated_at = now()
  where id = p_item_id;
end;
$$;

grant execute on function public.mark_item_draft_deleted(uuid) to authenticated;
