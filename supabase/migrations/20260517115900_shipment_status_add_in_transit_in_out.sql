-- Nouvelles valeurs enum (transaction séparée : PG exige un commit avant usage dans UPDATE).
-- Voir 20260517120000_shipment_in_transit_split_member_summary_rpc.sql pour le backfill + RPC.

do $body$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'shipment_status'
      and e.enumlabel = 'in_transit_in'
  ) then
    alter type public.shipment_status add value 'in_transit_in';
  end if;
end $body$;

do $body$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'shipment_status'
      and e.enumlabel = 'in_transit_out'
  ) then
    alter type public.shipment_status add value 'in_transit_out';
  end if;
end $body$;
