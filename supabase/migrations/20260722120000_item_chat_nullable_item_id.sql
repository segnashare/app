-- Chat général (sans pièce) : item_id optionnel.
-- Les chats ouverts depuis une fiche pièce restent liés via item_id.

alter table public.item_chat_conversations
  alter column item_id drop not null;

create index if not exists item_chat_conversations_general_open_idx
  on public.item_chat_conversations (visitor_id, status)
  where item_id is null and status = 'open';

create index if not exists item_chat_conversations_general_user_open_idx
  on public.item_chat_conversations (user_id, status)
  where item_id is null and status = 'open' and user_id is not null;
