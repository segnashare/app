-- Refus logistique: fulfillment_stage=refused + sync items.status + outtake/dispute auto.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'public'
      and t.typname = 'item_intake_fulfillment_stage'
      and e.enumlabel = 'refused'
  ) then
    alter type public.item_intake_fulfillment_stage add value 'refused';
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'public'
      and t.typname = 'item_status'
      and e.enumlabel = 'refused'
  ) then
    alter type public.item_status add value 'refused';
  end if;
end $$;

create or replace function public.item_intake_after_refusal_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_cart_id uuid;
  v_cart_dispute_id uuid;
  v_details text;
begin
  if not (new.listing_stage::text = 'refused' or coalesce(new.fulfillment_stage::text, '') = 'refused') then
    return new;
  end if;

  if coalesce(new.fulfillment_stage::text, '') = 'refused'
     and (tg_op = 'INSERT' or coalesce(old.fulfillment_stage::text, '') <> 'refused')
  then
    v_details := nullif(
      coalesce(
        new.metadata -> 'verification' ->> 'refusal_comment',
        new.metadata -> 'verification' ->> 'last_logistics_decision_note',
        ''
      ),
      ''
    );

    insert into public.item_outtake (item_id, stage, metadata)
    values (
      new.item_id,
      'return_open'::public.item_outtake_stage,
      jsonb_build_object(
        'reason', 'fulfillment_refused',
        'member_pays_return', true,
        'note', coalesce(v_details, 'Refus logistique: retour à la propriétaire à ses frais.')
      )
    )
    on conflict (item_id) do update
      set stage = 'return_open'::public.item_outtake_stage,
          metadata = coalesce(public.item_outtake.metadata, '{}'::jsonb) || excluded.metadata,
          updated_at = now();

    select i.owner_user_id into v_owner_id
    from public.items i
    where i.id = new.item_id;

    select cd.id into v_cart_dispute_id
    from public.cart_disputes cd
    join public.cart_items ci on ci.cart_id = cd.cart_id
    where ci.item_id = new.item_id
      and cd.deleted_at is null
    order by cd.created_at desc
    limit 1;

    if v_cart_dispute_id is null then
      select ci.cart_id into v_cart_id
      from public.cart_items ci
      where ci.item_id = new.item_id
      order by coalesce(ci.updated_at, ci.created_at) desc
      limit 1;

      if v_cart_id is null and v_owner_id is not null then
        insert into public.carts (user_id, status)
        values (v_owner_id, 'active'::public.cart_status)
        returning id into v_cart_id;
      end if;

      if v_cart_id is not null and v_owner_id is not null then
        insert into public.cart_disputes (cart_id, opened_by_user_id, reason, details, status)
        values (
          v_cart_id,
          v_owner_id,
          'item_refused_fulfillment',
          coalesce(v_details, 'Refus logistique: retour à la propriétaire à ses frais.'),
          'open'
        )
        returning id into v_cart_dispute_id;
      end if;
    end if;

    if v_cart_dispute_id is not null then
      update public.item_disputes
      set
        reason = 'item_refused_fulfillment',
        details = coalesce(v_details, 'Refus logistique: retour à la propriétaire à ses frais.'),
        status = 'open',
        updated_at = now()
      where item_id = new.item_id
        and deleted_at is null;

      insert into public.item_disputes (cart_dispute_id, item_id, reason, details, status)
      select
        v_cart_dispute_id,
        new.item_id,
        'item_refused_fulfillment',
        coalesce(v_details, 'Refus logistique: retour à la propriétaire à ses frais.'),
        'open'
      where not exists (
        select 1
        from public.item_disputes d
        where d.item_id = new.item_id
          and d.deleted_at is null
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_item_intake_after_refusal_workflow on public.item_intake;
create trigger trg_item_intake_after_refusal_workflow
after insert or update of listing_stage, fulfillment_stage on public.item_intake
for each row
execute function public.item_intake_after_refusal_workflow();
