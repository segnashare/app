-- Rôle applicatif pour les comptes techniques Segna (stock corporate, etc.).
-- Pas d’élévation de privilèges : les policies staff restent sur moderator/admin.

do $$
begin
  if exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'app_role'
  ) then
    begin
      alter type public.app_role add value if not exists 'segna_system';
    exception
      when duplicate_object then null;
    end;
  end if;
end
$$;

-- Compte aligné sur segna-corporate-inventory.ts / migration corporate_inventory_system_user.
insert into public.user_roles (user_id, role)
values (
  'b2c3d4e5-f6a7-4890-b123-456789abcdef'::uuid,
  'segna_system'::public.app_role
)
on conflict (user_id, role) do nothing;
