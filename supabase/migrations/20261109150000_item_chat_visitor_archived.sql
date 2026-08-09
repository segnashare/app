-- Archive membre : conversation masquée du feed chat (pas de close Discord).
alter table public.item_chat_conversations
  add column if not exists visitor_archived_at timestamptz null;

comment on column public.item_chat_conversations.visitor_archived_at is
  'Instant où le membre a archivé la conversation (balayage / action inbox). Null = visible dans le feed.';

create index if not exists item_chat_conversations_visitor_active_idx
  on public.item_chat_conversations (visitor_id, last_message_at desc)
  where visitor_archived_at is null;

create index if not exists item_chat_conversations_user_active_idx
  on public.item_chat_conversations (user_id, last_message_at desc)
  where visitor_archived_at is null
    and user_id is not null;
