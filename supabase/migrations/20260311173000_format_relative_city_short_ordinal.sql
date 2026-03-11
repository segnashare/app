create or replace function public.derive_relative_city_from_adress(p_adress text)
returns text
language plpgsql
immutable
as $$
declare
  v_adress text;
  v_postcode text;
  v_arrondissement integer;
  v_city text;
  v_ordinal text;
begin
  v_adress := nullif(trim(coalesce(p_adress, '')), '');
  if v_adress is null then
    return null;
  end if;

  v_postcode := substring(
    v_adress
    from '\m(750(0[1-9]|1[0-9]|20)|6900[1-9]|130(0[1-9]|1[0-6]))\M'
  );

  if v_postcode is not null then
    v_arrondissement := cast(right(v_postcode, 2) as integer);
    v_ordinal := case when v_arrondissement = 1 then '1er' else format('%se', v_arrondissement) end;

    if left(v_postcode, 2) = '75' then
      return format('Paris %s', v_ordinal);
    elsif left(v_postcode, 2) = '69' then
      return format('Lyon %s', v_ordinal);
    elsif left(v_postcode, 2) = '13' then
      return format('Marseille %s', v_ordinal);
    end if;
  end if;

  v_city := substring(v_adress from '\m\d{5}\s+([A-Za-zÀ-ÿ'' -]+)\M');
  if nullif(trim(coalesce(v_city, '')), '') is not null then
    return initcap(trim(v_city));
  end if;

  return null;
end;
$$;

update public.user_profiles up
set city = public.derive_relative_city_from_adress(u.adress)
from public.users u
where up.user_id = u.id
  and u.adress is not null;
