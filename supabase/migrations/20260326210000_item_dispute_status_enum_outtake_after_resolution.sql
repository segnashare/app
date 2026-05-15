-- Statut litige typé + outtake ouvert seulement après résolution item_disputes (refus logistique).

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'item_dispute_status'
  ) then
    create type public.item_dispute_status as enum ('open', 'in_review', 'resolved', 'closed');
  end if;
end $$;

-- Prérequis : absente des migrations antérieures (261120 / 607051310 l’utilisent déjà).
create table if not exists public.item_disputes (
  id uuid primary key default gen_random_uuid(),
  cart_dispute_id uuid not null references public.cart_disputes (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  reason text,
  details text,
  status text not null default 'open'::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.item_disputes
  alter column status drop default;

alter table public.item_disputes
  alter column status type public.item_dispute_status using status::text::public.item_dispute_status;

alter table public.item_disputes
  alter column status set default 'open'::public.item_dispute_status;

comment on type public.item_dispute_status is
  'Cycle de vie litige article (BO). L’outtake « return » pour refus logistique s’ouvre quand le statut passe à resolved ou closed.';

-- Refus logistique : litige + métadonnées ; pas d’item_outtake tant que le litige n’est pas terminé.
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
        status = 'open'::public.item_dispute_status,
        updated_at = now()
      where item_id = new.item_id
        and deleted_at is null;

      insert into public.item_disputes (cart_dispute_id, item_id, reason, details, status)
      select
        v_cart_dispute_id,
        new.item_id,
        'item_refused_fulfillment',
        coalesce(v_details, 'Refus logistique: retour à la propriétaire à ses frais.'),
        'open'::public.item_dispute_status
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

-- À la clôture du litige (resolved / closed), ouvrir l’outtake retour pour les refus logistique encore en fulfillment refused.
create or replace function public.item_disputes_after_resolution_open_fulfillment_outtake()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fs text;
  v_details text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status not in ('resolved'::public.item_dispute_status, 'closed'::public.item_dispute_status) then
    return new;
  end if;

  if old.status in ('resolved'::public.item_dispute_status, 'closed'::public.item_dispute_status) then
    return new;
  end if;

  if coalesce(new.reason, '') <> 'item_refused_fulfillment' then
    return new;
  end if;

  select coalesce(ii.fulfillment_stage::text, '') into v_fs
  from public.item_intake ii
  where ii.item_id = new.item_id;

  if v_fs <> 'refused' then
    return new;
  end if;

  v_details := nullif(trim(coalesce(new.details, '')), '');
  if v_details is null then
    select nullif(
      trim(
        coalesce(
          ii.metadata -> 'verification' ->> 'refusal_comment',
          ii.metadata -> 'verification' ->> 'last_logistics_decision_note',
          ''
        )
      ),
      ''
    )
    into v_details
    from public.item_intake ii
    where ii.item_id = new.item_id;
  end if;

  insert into public.item_outtake (item_id, stage, metadata)
  values (
    new.item_id,
    'return_open'::public.item_outtake_stage,
    jsonb_build_object(
      'reason', 'fulfillment_refused',
      'member_pays_return', true,
      'note', coalesce(v_details, 'Refus logistique: retour à la propriétaire à ses frais.'),
      'opened_after_dispute_status', new.status::text
    )
  )
  on conflict (item_id) do update
    set stage = 'return_open'::public.item_outtake_stage,
        metadata = coalesce(public.item_outtake.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_item_disputes_after_resolution_open_outtake on public.item_disputes;
create trigger trg_item_disputes_after_resolution_open_outtake
after update of status on public.item_disputes
for each row
execute function public.item_disputes_after_resolution_open_fulfillment_outtake();

comment on function public.item_disputes_after_resolution_open_fulfillment_outtake() is
  'Crée ou met à jour item_outtake en return_open quand item_disputes passe à resolved/closed pour un refus logistique (fulfillment refused).';
