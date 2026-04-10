-- shipment_status : `dropped` → `dropped_in` (Segna dépose chez le partenaire — aller panier).
-- Nouveau `dropped_out` : membre dépose au relais (retour — engagement délais respecté).

do $body$
begin
  alter type public.shipment_status rename value 'dropped' to 'dropped_in';
exception
  when undefined_object then
    null;
  when invalid_parameter_value then
    null;
end
$body$;

do $body$
begin
  alter type public.shipment_status add value 'dropped_out';
exception
  when duplicate_object then
    null;
end
$body$;

comment on type public.shipment_status is
  'Cycle expédition panier / retour. dropped_in = dépôt Segna chez partenaire (aller) ; dropped_out = dépôt membre au relais (retour, prise en charge engagement).';
