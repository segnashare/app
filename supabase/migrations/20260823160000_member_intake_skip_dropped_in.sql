-- member_intake : plus d’étape dropped_in (dépôt relais → in_transit_out direct).
-- SMS membre sur in_transit_out ; promotion intake shipping reste sur dropped_out.

drop trigger if exists trg_shipments_member_intake_dropped_in_effects on public.shipments;

create or replace function public.trg_shipments_member_intake_in_transit_out_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.context::text is distinct from 'member_intake' then
    return new;
  end if;
  if new.deleted_at is not null then
    return new;
  end if;
  if lower(new.status::text) is distinct from 'in_transit_out' then
    return new;
  end if;

  if tg_op = 'UPDATE' and lower(coalesce(old.status::text, '')) = 'in_transit_out' then
    return new;
  end if;

  perform public.invoke_shipment_lifecycle_notify_http(
    new.id,
    coalesce(old.status::text, ''),
    new.status::text,
    'shipment_member_intake_in_transit_out'
  );

  return new;
end;
$fn$;

drop trigger if exists trg_shipments_member_intake_in_transit_out_effects on public.shipments;
create trigger trg_shipments_member_intake_in_transit_out_effects
after insert or update of status on public.shipments
for each row
execute function public.trg_shipments_member_intake_in_transit_out_effects();

comment on function public.trg_shipments_member_intake_in_transit_out_effects() is
  'member_intake → in_transit_out : notification SMS membre (HTTP app).';

-- Colis encore bloqués sur dropped_in : avancer vers in_transit_out.
update public.shipments s
set
  status = 'in_transit_out'::public.shipment_status,
  updated_at = timezone('utc', now())
where s.deleted_at is null
  and s.context = 'member_intake'::public.shipment_context
  and lower(s.status::text) = 'dropped_in';
