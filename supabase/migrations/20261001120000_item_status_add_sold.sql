-- Ajoute le statut catalogue `sold` (achat définitif), distinct de `reserved` (emprunt en cours).
-- Valeur à utiliser uniquement dans une migration ultérieure (même transaction PG interdit ADD VALUE + usage).

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'item_status'
      and e.enumlabel = 'sold'
  ) then
    alter type public.item_status add value 'sold' after 'reserved';
  end if;
end $$;

comment on type public.item_status is
  'Statut operational item. available/in_cart=shoppable ; reserved=emprunt payé ; sold=achat définitif ; cleaning=pressing post-retour ; retired/archived/refused/draft*=hors cycle emprunt.';
