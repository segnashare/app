-- Nouvelle valeur d’enum seule (transaction séparée) : PostgreSQL refuse
-- d’utiliser la valeur dans la même transaction que ALTER TYPE ... ADD VALUE (55P04).

alter type public.app_role add value if not exists 'organization';
