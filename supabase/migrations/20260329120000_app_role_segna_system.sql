-- Rôle applicatif pour les comptes techniques Segna (stock corporate, etc.).
-- Pas d’élévation de privilèges : les policies staff restent sur moderator/admin.
-- Valeur enum : voir 20260329115900_app_role_add_segna_system_enum_value.sql (transaction séparée, évite 55P04).

-- Compte aligné sur segna-corporate-inventory.ts / migration corporate_inventory_system_user.
insert into public.user_roles (user_id, role)
values (
  'b2c3d4e5-f6a7-4890-b123-456789abcdef'::uuid,
  'segna_system'::public.app_role
)
on conflict (user_id, role) do nothing;
