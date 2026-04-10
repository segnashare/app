-- Référentiel transporteurs + lien shipments.provider_id + RPC d’affectation (backoffice / service_role).

create table if not exists public.shipment_providers (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists shipment_providers_code_lower_uq
  on public.shipment_providers (lower(code));

comment on table public.shipment_providers is
  'Transporteurs (Mondial Relay, Uber Direct, etc.). is_active = false tant que l’intégration n’est pas prête.';

alter table public.shipments
  add column if not exists provider_id uuid references public.shipment_providers (id) on delete set null;

create index if not exists shipments_provider_id_idx on public.shipments (provider_id);

comment on column public.shipments.provider_id is
  'Transporteur retenu pour cet envoi (choix backoffice ou flux automatisé).';

insert into public.shipment_providers (code, name, is_active)
values
  ('mondial_relay', 'Mondial Relay', true),
  ('uber_direct', 'Uber Direct', false)
on conflict ((lower(code))) do update
set
  name = excluded.name,
  is_active = excluded.is_active;

create or replace function public.set_shipment_provider(
  p_shipment_id uuid,
  p_provider_id uuid default null,
  p_provider_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_pid uuid;
begin
  if p_shipment_id is null then
    raise exception 'p_shipment_id is required';
  end if;

  if p_provider_id is not null then
    select sp.id into v_pid
    from public.shipment_providers sp
    where sp.id = p_provider_id;

    if v_pid is null then
      raise exception 'Provider not found: %', p_provider_id;
    end if;
  elsif p_provider_code is not null and length(trim(p_provider_code)) > 0 then
    select sp.id into v_pid
    from public.shipment_providers sp
    where lower(sp.code) = lower(trim(p_provider_code));

    if v_pid is null then
      raise exception 'Unknown provider code: %', p_provider_code;
    end if;
  else
    raise exception 'Pass p_provider_id or p_provider_code';
  end if;

  if not exists (
    select 1
    from public.shipments s
    where s.id = p_shipment_id
      and s.deleted_at is null
  ) then
    raise exception 'Shipment not found or deleted: %', p_shipment_id;
  end if;

  update public.shipments s
  set
    provider_id = v_pid,
    updated_at = now()
  where s.id = p_shipment_id
    and s.deleted_at is null;

  return jsonb_build_object(
    'ok', true,
    'shipment_id', p_shipment_id,
    'provider_id', v_pid
  );
end;
$fn$;

comment on function public.set_shipment_provider(uuid, uuid, text) is
  'Attache un envoi à un transporteur (id ou code : mondial_relay, uber_direct). service_role / backoffice.';

grant execute on function public.set_shipment_provider(uuid, uuid, text) to service_role;
