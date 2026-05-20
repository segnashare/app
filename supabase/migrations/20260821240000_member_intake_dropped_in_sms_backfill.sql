-- Rattrapage SMS member_intake / dropped_in (la migration précédente ne promouvait que fulfillment).

do $do$
declare
  r record;
begin
  for r in
    select s.id
    from public.shipments s
    where s.context = 'member_intake'::public.shipment_context
      and s.deleted_at is null
      and lower(s.status::text) = 'dropped_in'
      and not exists (
        select 1
        from public.notification_send_log n
        where n.kind = 'member_intake_dropped_in'
          and (n.metadata->>'shipment_id') = s.id::text
          and n.delivery_channels = 'phone'
      )
  loop
    perform public.invoke_shipment_lifecycle_notify_http(
      r.id,
      'in_transit_out',
      'dropped_in',
      'backfill_member_intake_dropped_in_sms'
    );
  end loop;
end
$do$;
