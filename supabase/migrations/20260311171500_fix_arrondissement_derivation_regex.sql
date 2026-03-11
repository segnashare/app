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
    if left(v_postcode, 2) = '75' then
      v_arrondissement := cast(right(v_postcode, 2) as integer);
      return case
        when v_arrondissement = 1 then 'Paris 1er arrondissement'
        else format('Paris %sème arrondissement', v_arrondissement)
      end;
    elsif left(v_postcode, 2) = '69' then
      v_arrondissement := cast(right(v_postcode, 2) as integer);
      return case
        when v_arrondissement = 1 then 'Lyon 1er arrondissement'
        else format('Lyon %sème arrondissement', v_arrondissement)
      end;
    elsif left(v_postcode, 2) = '13' then
      v_arrondissement := cast(right(v_postcode, 2) as integer);
      return case
        when v_arrondissement = 1 then 'Marseille 1er arrondissement'
        else format('Marseille %sème arrondissement', v_arrondissement)
      end;
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
