alter table public.item_brands
  add column if not exists vinted_brand_id bigint;

comment on column public.item_brands.vinted_brand_id is
  'Identifiant de la marque sur Vinted (extrait des URLs /brand/<id>-<slug>).';

update public.item_brands
set vinted_brand_id = case slug
  when 'paloma-wool' then 411267
  when 'patou' then 281982
  when 'paul-joe' then 4755
  when 'paule-ka' then 12555
  when 'pinko' then 1281
  when 'prada' then 3573
  when 'proenza-schouler' then 77604
  when 'rag-bone' then 93348
  when 'reiss' then 2579
  when 'rick-owens' then 145654
  when 'roksanda' then 463042
  when 'rouje' then 282478
  when 'saint-laurent' then 83122
  when 'samsoe-samsoe' then 87414
  when 'sandro-paris' then 115
  when 'scotch-soda' then 13743
  when 'selected-femme' then 351365
  when 'self-portrait' then 248126
  when 'sezane' then 38437
  when 'stella-mccartney' then 13893
  when 'theory' then 69798
  when 'tory-burch' then 78042
  when 'valentino' then 5928803
  when 'versace' then 2293
  when 'zimmermann' then 172418
  when 'zadig-voltaire' then 765
  else vinted_brand_id
end
where slug in (
  'paloma-wool',
  'patou',
  'paul-joe',
  'paule-ka',
  'pinko',
  'prada',
  'proenza-schouler',
  'rag-bone',
  'reiss',
  'rick-owens',
  'roksanda',
  'rouje',
  'saint-laurent',
  'samsoe-samsoe',
  'sandro-paris',
  'scotch-soda',
  'selected-femme',
  'self-portrait',
  'sezane',
  'stella-mccartney',
  'theory',
  'tory-burch',
  'valentino',
  'versace',
  'zimmermann',
  'zadig-voltaire'
);
