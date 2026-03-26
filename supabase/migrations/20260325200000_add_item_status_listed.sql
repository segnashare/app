-- listed : visible au catalogue mais pas empruntable / panier (nettoyage, emprunt en cours, etc.)
-- available : eligible panier et reservation

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'item_status'
      and e.enumlabel = 'listed'
  ) then
    alter type public.item_status add value 'listed' before 'available';
  end if;
end $$;

-- Intake : piece au catalogue (listed ou available) = pipeline annonce termine (validated)
create or replace function public.items_after_insert_ensure_item_intake()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.item_intake (item_id, listing_stage, metadata)
  values (
    new.id,
    case new.status::text
      when 'draft' then 'draft'::public.item_intake_listing_stage
      when 'draft_deleted' then 'draft'::public.item_intake_listing_stage
      when 'validation_pending' then 'evaluation'::public.item_intake_listing_stage
      when 'valuation' then 'validation_pending'::public.item_intake_listing_stage
      when 'listed' then 'validated'::public.item_intake_listing_stage
      else 'validated'::public.item_intake_listing_stage
    end,
    case
      when new.status::text = 'draft_deleted' then jsonb_build_object('legacy_items_status', 'draft_deleted')
      else '{}'::jsonb
    end
  )
  on conflict (item_id) do nothing;
  return new;
end;
$$;

comment on type public.item_status is
  'Statut operational item. listed=catalogue sans emprunt immediat ; available=panier/reservation possibles.';
