-- Rôle applicatif pour les comptes membres créés par le staff avant parcours « normal » (visible comme les autres sur le feed).

alter type public.app_role add value if not exists 'prospect';
