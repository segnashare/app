import {
  getDiscordBotToken,
  getDiscordItemChatChannelId,
  getItemPublicAppUrl,
  getItemPublicWebUrl,
  isItemChatDiscordEnabled,
  isItemChatDiscordSyncEnabled,
} from "@/lib/item-chat/config";
import type { ItemChatConversationRow, ItemChatSource } from "@/lib/item-chat/types";

const DISCORD_API = "https://discord.com/api/v10";

export type DiscordAuthor = {
  id: string;
  bot?: boolean;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
};

type DiscordMessage = {
  id: string;
  content?: string;
  author?: DiscordAuthor;
  timestamp?: string;
};

/** Prénom affiché + avatar CDN à partir de l’auteur Discord. */
export function discordStaffProfileFromAuthor(
  author: DiscordAuthor | null | undefined,
): { displayName: string; avatarUrl: string } | null {
  if (!author?.id) return null;
  const full = (author.global_name || author.username || "").trim();
  if (!full) return null;
  const firstToken = full.split(/\s+/)[0] || full;
  const displayName = firstToken.slice(0, 40);

  let avatarUrl: string;
  if (author.avatar) {
    const ext = author.avatar.startsWith("a_") ? "gif" : "png";
    avatarUrl = `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.${ext}?size=128`;
  } else {
    let index = 0;
    try {
      index = Number((BigInt(author.id) >> 22n) % 6n);
    } catch {
      index = 0;
    }
    avatarUrl = `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
  return { displayName, avatarUrl };
}

async function discordFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getDiscordBotToken();
  return fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

function threadNameFromConversation(conv: ItemChatConversationRow, clientName?: string | null): string {
  const who =
    (clientName && clientName.trim()) ||
    (conv.contact_email || conv.visitor_id.slice(0, 8)).trim();
  return who.slice(0, 100);
}

export async function discordCreateThreadAndPost(params: {
  conversation: ItemChatConversationRow;
  body: string;
  source: ItemChatSource;
}): Promise<{ threadId: string; messageId: string } | null> {
  if (!isItemChatDiscordEnabled()) return null;
  const channelId = getDiscordItemChatChannelId();
  const conv = params.conversation;
  const webUrl = getItemPublicWebUrl(conv.item_id);
  const appUrl = getItemPublicAppUrl(conv.item_id);

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Source", value: params.source, inline: true },
    { name: "Email", value: conv.contact_email || "—", inline: true },
  ];
  if (conv.item_id) {
    fields.unshift(
      { name: "Taille", value: conv.item_size_label || "—", inline: true },
      { name: "État", value: conv.item_condition_label || "—", inline: true },
    );
    if (webUrl) fields.push({ name: "Site", value: webUrl, inline: false });
    if (appUrl) fields.push({ name: "App", value: appUrl, inline: false });
  }

  const embed = {
    title: conv.item_title || (conv.item_id ? "Question pièce" : "Question générale"),
    description: params.body.slice(0, 2000),
    color: 0x6b6560,
    fields,
  };

  // Forum / channel supporting thread+message in one shot
  const forumRes = await discordFetch(`/channels/${channelId}/threads`, {
    method: "POST",
    body: JSON.stringify({
      name: threadNameFromConversation(conv),
      auto_archive_duration: 10080,
      message: {
        content: `💬 Nouvelle question (${params.source})`,
        embeds: [embed],
      },
    }),
  });

  if (forumRes.ok) {
    const data = (await forumRes.json()) as { id?: string; message_id?: string; message?: { id?: string } };
    const threadId = typeof data.id === "string" ? data.id : null;
    const messageId =
      (typeof data.message?.id === "string" && data.message.id) ||
      (typeof data.message_id === "string" && data.message_id) ||
      null;
    if (threadId) return { threadId, messageId: messageId || threadId };
  }

  // Salon texte : message puis thread à partir du message
  const msgRes = await discordFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: `💬 Nouvelle question (${params.source})`,
      embeds: [embed],
    }),
  });
  if (!msgRes.ok) {
    const text = await msgRes.text().catch(() => "");
    console.error("[item-chat/discord] channel message failed", msgRes.status, text);
    return null;
  }
  const msg = (await msgRes.json()) as { id?: string };
  if (!msg.id) return null;

  const threadRes = await discordFetch(`/channels/${channelId}/messages/${msg.id}/threads`, {
    method: "POST",
    body: JSON.stringify({
      name: threadNameFromConversation(conv),
      auto_archive_duration: 10080,
    }),
  });
  if (!threadRes.ok) {
    const text = await threadRes.text().catch(() => "");
    console.error("[item-chat/discord] start thread failed", threadRes.status, text);
    return null;
  }
  const thread = (await threadRes.json()) as { id?: string };
  if (!thread.id) return null;
  return { threadId: thread.id, messageId: msg.id };
}

export async function discordPostToThread(params: {
  threadId: string;
  body: string;
  asStaffNote?: boolean;
}): Promise<string | null> {
  if (!isItemChatDiscordEnabled()) return null;
  const content = (params.asStaffNote ? params.body : `👤 ${params.body}`).slice(0, 1900);
  const res = await discordFetch(`/channels/${params.threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[item-chat/discord] post message failed", res.status, text);
    return null;
  }
  const data = (await res.json()) as { id?: string };
  return typeof data.id === "string" ? data.id : null;
}

export async function discordFetchThreadMessagesAfter(params: {
  threadId: string;
  afterMessageId: string | null;
}): Promise<DiscordMessage[]> {
  if (!isItemChatDiscordSyncEnabled()) return [];
  const qs = new URLSearchParams({ limit: "50" });
  if (params.afterMessageId) qs.set("after", params.afterMessageId);
  const res = await discordFetch(`/channels/${params.threadId}/messages?${qs.toString()}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[item-chat/discord] list messages failed", res.status, text);
    return [];
  }
  const data = (await res.json()) as DiscordMessage[];
  if (!Array.isArray(data)) return [];
  // Discord returns newest first — chronological for insert
  return [...data].reverse();
}

export async function discordGetBotUserId(): Promise<string | null> {
  if (!isItemChatDiscordSyncEnabled()) return null;
  const res = await discordFetch("/users/@me");
  if (!res.ok) return null;
  const data = (await res.json()) as { id?: string };
  return typeof data.id === "string" ? data.id : null;
}

/** Supprime un fil Discord (nécessite MANAGE_THREADS). */
export async function discordDeleteThread(threadId: string): Promise<boolean> {
  if (!isItemChatDiscordSyncEnabled() || !threadId.trim()) return false;
  const res = await discordFetch(`/channels/${threadId.trim()}`, { method: "DELETE" });
  if (res.ok || res.status === 404) return true;
  const text = await res.text().catch(() => "");
  console.error("[item-chat/discord] delete thread failed", res.status, text);
  return false;
}
