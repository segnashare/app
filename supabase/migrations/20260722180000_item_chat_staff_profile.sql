-- Profil opérateur affiché sur les réponses Discord (prénom + photo).
alter table public.item_chat_messages
  add column if not exists staff_display_name text,
  add column if not exists staff_avatar_url text;

comment on column public.item_chat_messages.staff_display_name is
  'Prénom / nom affiché pour une réponse staff (souvent depuis Discord global_name).';
comment on column public.item_chat_messages.staff_avatar_url is
  'URL avatar opérateur (CDN Discord ou autre).';
