export type ItemChatSource = "web" | "app";
export type ItemChatMessageRole = "visitor" | "staff" | "system";
export type ItemChatStatus = "open" | "closed";
export type ItemChatUsefulnessRating = "yes" | "no";

export type ItemChatConversationRow = {
  id: string;
  item_id: string | null;
  visitor_id: string;
  user_id: string | null;
  contact_email: string | null;
  discord_thread_id: string | null;
  discord_last_message_id: string | null;
  source: ItemChatSource;
  status: ItemChatStatus;
  item_title: string | null;
  item_size_label: string | null;
  item_condition_label: string | null;
  last_message_at: string;
  last_read_at: string | null;
  usefulness_prompted_at: string | null;
  usefulness_rating: ItemChatUsefulnessRating | null;
  discord_thread_deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ItemChatMessageRow = {
  id: string;
  conversation_id: string;
  role: ItemChatMessageRole;
  body: string;
  discord_message_id: string | null;
  staff_display_name: string | null;
  staff_avatar_url: string | null;
  created_at: string;
};

export type ItemChatMessageDto = {
  id: string;
  role: ItemChatMessageRole;
  body: string;
  createdAt: string;
  staffDisplayName: string | null;
  staffAvatarUrl: string | null;
};

export type ItemChatConversationDto = {
  id: string;
  itemId: string | null;
  itemTitle: string | null;
  itemSizeLabel: string | null;
  itemConditionLabel: string | null;
  contactEmail: string | null;
  status: ItemChatStatus;
  lastMessageAt: string;
  lastReadAt: string | null;
  unreadStaffCount: number;
  hasVisitorMessage: boolean;
  usefulnessPromptedAt: string | null;
  usefulnessRating: ItemChatUsefulnessRating | null;
  /** Dernier message non-système (aperçu liste). */
  lastMessagePreview: string | null;
  /** Opérateur Discord (null → afficher « Chatbot »). */
  operatorDisplayName: string | null;
  operatorAvatarUrl: string | null;
};

export const ITEM_CHAT_BODY_MAX = 4000;
export const ITEM_CHAT_BODY_MIN = 1;

/** Corps des messages `system` « opérateur a rejoint » (persistés en base). */
export const ITEM_CHAT_STAFF_JOINED_BODY = "a rejoint la conversation";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
