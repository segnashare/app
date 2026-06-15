-- « Complétez votre tenue » : + filtre taille profil membre (haut / bas / chaussures).

create or replace function public.item_borrowable_for_outfit_suggestion(
  p_item_id uuid,
  p_borrower_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.items i
    where i.id = p_item_id
      and i.deleted_at is null
      and i.owner_user_id is distinct from p_borrower_user_id
      and coalesce(i.price_points, 0) < 50
      and public.item_size_matches_member_profile(i.item_size_id, p_borrower_user_id)
      and i.status in (
        'available'::public.item_status,
        'in_cart'::public.item_status
      )
      and not exists (
        select 1
        from public.users u
        where u.id = i.owner_user_id
          and u.status = 'corporate_inventory'::public.user_status
      )
      and not exists (
        select 1
        from public.users u2
        where u2.id = i.owner_user_id
          and coalesce(u2.phantom_mode, false)
      )
  );
$$;

comment on function public.item_borrowable_for_outfit_suggestion(uuid, uuid) is
  'Pièce éligible rail « Complétez votre tenue » : available/in_cart, taille membre, < 50 crédits.';

comment on function public.get_cart_outfit_suggestions(uuid[], uuid[], integer) is
  'Panier « Complétez votre tenue » : tenues CMS, taille membre, available/in_cart, < 50 crédits.';
