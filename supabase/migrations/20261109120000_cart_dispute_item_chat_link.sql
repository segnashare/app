-- Lien litige panier ↔ conversation chatbot (création parallèle à l’ouverture).

alter table public.cart_disputes
  add column if not exists conversation_id uuid null
    references public.item_chat_conversations (id) on delete set null;

alter table public.item_chat_conversations
  add column if not exists cart_dispute_id uuid null
    references public.cart_disputes (id) on delete set null;

create unique index if not exists cart_disputes_conversation_id_uidx
  on public.cart_disputes (conversation_id)
  where conversation_id is not null;

create unique index if not exists item_chat_conversations_cart_dispute_id_uidx
  on public.item_chat_conversations (cart_dispute_id)
  where cart_dispute_id is not null;

comment on column public.cart_disputes.conversation_id is
  'Conversation chatbot ouverte en parallèle du litige membre.';

comment on column public.item_chat_conversations.cart_dispute_id is
  'Litige panier à l’origine de cette conversation (si applicable).';
