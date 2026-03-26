-- Pipeline : items.status = draft jusqu'a verification physique (fulfillment = verified) -> items.listed
-- Les anciens items.status valuation / validation_pending sont ramenes en draft (verite dans item_intake).
-- Depend de 20260325210000_intake_fulfillment_enum_values.sql

update public.item_intake
set fulfillment_stage = 'shipping'::public.item_intake_fulfillment_stage
where fulfillment_stage::text = 'shipped_in';

update public.item_intake
set fulfillment_stage = 'in_verification'::public.item_intake_fulfillment_stage
where fulfillment_stage::text = 'verification_pending';

update public.items
set status = 'draft'::public.item_status,
    updated_at = now()
where status::text in ('valuation', 'validation_pending')
  and deleted_at is null;

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

drop trigger if exists trg_item_intake_before_insert_guard on public.item_intake;
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

drop trigger if exists trg_item_intake_before_update_guard on public.item_intake;
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

drop trigger if exists trg_item_intake_after_update_sync_listed on public.item_intake;
create trigger trg_item_intake_after_update_sync_listed
after insert or update of fulfillment_stage on public.item_intake
for each row
execute function public.item_intake_after_update_sync_items_listed();

comment on column public.item_intake.fulfillment_stage is
  'shipping=vers Segna ; in_verification=controle physique ; verified=OK -> items.status listed (trigger). Valeurs shipped_in / verification_pending depreciees (migrees).';
