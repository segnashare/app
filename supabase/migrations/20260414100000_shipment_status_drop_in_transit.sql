-- Retrait de la valeur enum obsolète `in_transit` (remplacée par `in_transit_in` / `in_transit_out`).
-- Prérequis côté types : `dropped_in` / `dropped_out` (migration 20260410120000_shipment_status_dropped_in_out.sql).

-- 1) Dernières lignes encore en `in_transit` (même logique que 20260517120000).
update public.shipments s
set status = 'in_transit_in'::public.shipment_status
where s.status = 'in_transit'::public.shipment_status
  and s.context = 'cart_outbound'::public.shipment_context
  and s.deleted_at is null;

update public.shipments s
set status = 'in_transit_out'::public.shipment_status
where s.status = 'in_transit'::public.shipment_status
  and s.context = 'cart_return'::public.shipment_context
  and s.deleted_at is null;

update public.shipments s
set status = 'in_transit_in'::public.shipment_status
where s.status = 'in_transit'::public.shipment_status
  and s.context is distinct from 'cart_return'::public.shipment_context
  and s.deleted_at is null;

-- 2) Historique si colonnes typées `shipment_status` (schéma optionnel).
do $body$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'shipment_status_history'
      and c.column_name = 'to_status'
      and c.udt_name = 'shipment_status'
  ) then
    execute $sql$
      update public.shipment_status_history
      set to_status = 'in_transit_in'::public.shipment_status
      where to_status = 'in_transit'::public.shipment_status
    $sql$;
  end if;
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'shipment_status_history'
      and c.column_name = 'from_status'
      and c.udt_name = 'shipment_status'
  ) then
    execute $sql$
      update public.shipment_status_history
      set from_status = 'in_transit_in'::public.shipment_status
      where from_status = 'in_transit'::public.shipment_status
    $sql$;
  end if;
end
$body$;

-- 3) Retrait de la valeur d’enum `in_transit` : `ALTER TYPE … DROP VALUE` nécessite PostgreSQL 15+
--    et n’est pas toujours disponible (ex. hébergeur « dropping an enum value is not implemented »).
--    Les données sont migrées ci-dessus ; le label peut rester dans pg_enum sans effet tant qu’aucune ligne ne l’utilise.
--    Pour supprimer le label : upgrade PG / recréer le type, ou appliquer manuellement sur une instance compatible.

comment on type public.shipment_status is
  'Aller panier : pending, ready, dropped_in, in_transit_in, delivered, … ; retour panier : dropped_out, dropped_in, in_transit_in, returned, … ; in_transit_out = autre flux retour ; dropped_in = dépôt Segna partenaire ; dropped_out = dépôt membre relais.';
