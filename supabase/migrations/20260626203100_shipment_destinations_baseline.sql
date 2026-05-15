-- Table `shipment_destinations` (inserts depuis confirm_cart_* ; RPC 20260626210000 y fait référence).

do $t$
begin
  create type public.shipment_destination_type as enum (
    'pickup_point',
    'home'
  );
exception
  when duplicate_object then null;
end
$t$;

create table if not exists public.shipment_destinations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  destination_type public.shipment_destination_type not null,
  provider_point_id text,
  line1 text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists shipment_destinations_shipment_id_idx
  on public.shipment_destinations (shipment_id);

drop trigger if exists trg_shipment_destinations_updated_at on public.shipment_destinations;
create trigger trg_shipment_destinations_updated_at
before update on public.shipment_destinations
for each row execute function public.set_updated_at();

comment on table public.shipment_destinations is
  'Destination livraison (point relais ou domicile) liée à une expédition.';
