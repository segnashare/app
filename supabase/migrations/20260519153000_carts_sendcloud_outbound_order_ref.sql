-- Référence Sendcloud aller au niveau panier (commande importée à la confirmation).
alter table public.carts
  add column if not exists sendcloud_outbound_order_number text,
  add column if not exists sendcloud_outbound_panel_order_id text,
  add column if not exists sendcloud_outbound_cancelled_at timestamptz;

comment on column public.carts.sendcloud_outbound_order_number is
  'Numéro commande Sendcloud aller (ex. segna-{cart8}-{ship8}), posé à la confirmation panier.';
comment on column public.carts.sendcloud_outbound_panel_order_id is
  'Identifiant commande dans le panel Sendcloud (null après annulation panel).';
comment on column public.carts.sendcloud_outbound_cancelled_at is
  'Horodatage annulation logistique Sendcloud aller (panier annulé ou commande panel supprimée).';

create index if not exists carts_sendcloud_outbound_order_number_idx
  on public.carts (sendcloud_outbound_order_number)
  where sendcloud_outbound_order_number is not null
    and deleted_at is null;

-- Paniers déjà confirmés : recopie depuis shipment_destinations.metadata.
update public.carts c
set
  sendcloud_outbound_order_number = nullif(trim(sd.metadata ->> 'sendcloud_order_number'), ''),
  sendcloud_outbound_panel_order_id = nullif(trim(sd.metadata ->> 'sendcloud_panel_order_id'), ''),
  sendcloud_outbound_cancelled_at = case
    when nullif(trim(sd.metadata ->> 'sendcloud_order_cancelled_at'), '') is not null
      then (sd.metadata ->> 'sendcloud_order_cancelled_at')::timestamptz
    else c.sendcloud_outbound_cancelled_at
  end
from public.shipments s
join public.shipment_destinations sd on sd.shipment_id = s.id
where s.cart_id = c.id
  and s.context = 'cart_outbound'
  and s.deleted_at is null
  and c.deleted_at is null
  and c.status in ('confirmed', 'canceled')
  and c.sendcloud_outbound_order_number is null
  and nullif(trim(sd.metadata ->> 'sendcloud_order_number'), '') is not null;
