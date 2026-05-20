insert into public.shipment_providers (code, name, is_active)
values ('chronopost', 'Chronopost', true)
on conflict ((lower(code))) do update
set name = excluded.name, is_active = excluded.is_active;
