-- Recharge le cache PostgREST pour les RPC badges backoffice.

grant execute on function public.backoffice_count_moderation_pipeline(text[]) to service_role;
grant execute on function public.backoffice_commandes_nav_tab_counts() to service_role;
grant execute on function public.backoffice_items_hub_kpis(text[]) to service_role;

notify pgrst, 'reload schema';
