alter table public.ai_fashion_models
  add column if not exists default_instructions text not null default '';

comment on column public.ai_fashion_models.default_instructions is
  'Instructions FASHN appliquées par défaut à chaque try-on de ce mannequin.';
