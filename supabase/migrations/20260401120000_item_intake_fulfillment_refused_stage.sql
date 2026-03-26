-- Réintroduit `refused` sur fulfillment après le trim 20260331140000 (refus logistique BO).

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'item_intake_fulfillment_stage'
      and e.enumlabel = 'refused'
  ) then
    alter type public.item_intake_fulfillment_stage add value 'refused';
  end if;
end $$;
