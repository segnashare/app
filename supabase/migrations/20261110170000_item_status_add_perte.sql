-- Statut catalogue `perte` : pièce déclarée perdue (traçage / litige).
-- Affichage app : traité comme `sold` (indisponible à l’emprunt, pastille type vendu).

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'item_status'
      and e.enumlabel = 'perte'
  ) then
    alter type public.item_status add value 'perte' after 'sold';
  end if;
end $$;

comment on type public.item_status is
  'Statut operational item. available/in_cart=shoppable ; reserved=emprunt payé ; sold=achat définitif ; perte=déclarée perdue (UI type sold) ; cleaning=pressing post-retour ; retired/archived/refused/draft*=hors cycle emprunt.';
