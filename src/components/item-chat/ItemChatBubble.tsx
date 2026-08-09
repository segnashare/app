"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, ChevronLeft, Maximize2, Minimize2, Send, X } from "lucide-react";
import { usePathname } from "next/navigation";

import { useItemChat } from "@/components/item-chat/ItemChatProvider";
import { shouldShowMemberFeedbackFab, shouldShowTabBar } from "@/components/layout/navigation";
import { usePageChromeHidden } from "@/components/layout/PageChromeLoadingContext";
import {
  FLOATING_BOTTOM_ABOVE_TAB_BAR,
  FLOATING_BOTTOM_WITHOUT_TAB_BAR,
  FLOATING_ROUND_ACTION_SHELL_CLASS,
} from "@/components/layout/floating-action-chrome";
import { cn } from "@/lib/utils/cn";
import { resolveStaffAvatarUrl, resolveConversationAvatarUrl, CHATBOT_AVATAR_URL } from "@/lib/item-chat/staff-avatars";
import { ITEM_CHAT_STAFF_JOINED_BODY } from "@/lib/item-chat/types";

function ConversationAvatar({
  name,
  url,
  className,
}: {
  name?: string | null;
  url?: string | null;
  className?: string;
}) {
  const [src, setSrc] = useState(() => resolveConversationAvatarUrl(name, url));
  const isLogo = src === CHATBOT_AVATAR_URL;

  useEffect(() => {
    setSrc(resolveConversationAvatarUrl(name, url));
  }, [name, url]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={cn(
        "shrink-0 rounded-full bg-zinc-100",
        isLogo ? "object-cover bg-zinc-900 p-[2px] box-border" : "object-cover",
        className,
      )}
      referrerPolicy="no-referrer"
      onError={() => {
        if (src !== CHATBOT_AVATAR_URL) setSrc(CHATBOT_AVATAR_URL);
      }}
    />
  );
}

function StaffAvatar({
  name,
  url,
  sizeClass = "h-7 w-7 text-[10px]",
}: {
  name: string;
  url?: string | null;
  sizeClass?: string;
}) {
  const resolved = resolveStaffAvatarUrl(name, url);
  if (resolved) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolved}
        alt=""
        width={28}
        height={28}
        className={cn("shrink-0 rounded-full object-cover ring-1 ring-zinc-200", sizeClass)}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-zinc-200 font-semibold text-zinc-600",
        sizeClass,
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const h = Math.floor(diff / 3_600_000);
    if (h < 1) return "à l’instant";
    if (h < 24) return `il y a ${h} h`;
    return `il y a ${Math.floor(h / 24)} j`;
  } catch {
    return "";
  }
}

export function ItemChatBubble() {
  const pathname = usePathname();
  const chromeHidden = usePageChromeHidden();
  const {
    panelOpen,
    setPanelOpen,
    view,
    goToList,
    goToArchives,
    startNewChat,
    conversations,
    archivedConversations,
    unreadCount,
    messages,
    conversation,
    pendingItem,
    sending,
    botTyping,
    error,
    clearError,
    openConversation,
    archiveConversation,
    unarchiveConversation,
    sendMessage,
    submitUsefulnessRating,
  } = useItemChat();

  const hasTabBar = useMemo(() => shouldShowTabBar(pathname), [pathname]);
  const showFabChrome = useMemo(() => shouldShowMemberFeedbackFab(pathname), [pathname]);
  const [tabBarVisible, setTabBarVisible] = useState(true);
  const [draft, setDraft] = useState("");
  const [listDraft, setListDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [browseEmptyList, setBrowseEmptyList] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listInputRef = useRef<HTMLInputElement>(null);

  const awaitingUsefulness =
    Boolean(conversation?.usefulnessPromptedAt) && !conversation?.usefulnessRating;
  const showEmptyWelcome = view === "list" && conversations.length === 0 && !browseEmptyList;

  useEffect(() => {
    const onVisibility = (e: Event) => {
      const ce = e as CustomEvent<{ visible: boolean; pathname: string }>;
      if (ce.detail?.pathname === pathname) setTabBarVisible(ce.detail.visible);
    };
    window.addEventListener("segna:tabbar-visibility", onVisibility);
    return () => window.removeEventListener("segna:tabbar-visibility", onVisibility);
  }, [pathname]);

  useEffect(() => {
    if (!panelOpen || view !== "thread") return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [panelOpen, view, messages.length, botTyping]);

  useEffect(() => {
    if (!panelOpen || !expanded) return;
    const mq = window.matchMedia("(max-width: 767px)");
    if (!mq.matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [panelOpen, expanded]);

  if (chromeHidden || !showFabChrome) return null;

  const baseBottom = hasTabBar && tabBarVisible ? FLOATING_BOTTOM_ABOVE_TAB_BAR : FLOATING_BOTTOM_WITHOUT_TAB_BAR;
  const title =
    conversation?.operatorDisplayName?.trim() ||
    (messages.find((m) => m.role === "staff" && m.staffDisplayName?.trim())?.staffDisplayName?.trim() ??
      null) ||
    "Chatbot";

  const welcomeCopy = conversation?.itemId || pendingItem?.itemId
    ? "Qu'est-ce que tu aimerais savoir sur cette pièce ?"
    : "Qu'est-ce que tu aimerais savoir ?";

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    void sendMessage(text);
  };

  const onListNewChat = (e: FormEvent) => {
    e.preventDefault();
    const text = listDraft.trim();
    if (!text || sending) return;
    setListDraft("");
    void startNewChat({ initialMessage: text });
  };

  return (
    <div
      className={cn(
        "pointer-events-none fixed right-3 z-[48] flex max-w-[430px] flex-col items-end gap-2 md:right-[max(12px,calc((100vw-430px)/2+12px))]",
        expanded &&
          "max-md:pointer-events-auto max-md:!inset-0 max-md:!bottom-0 max-md:z-[100] max-md:h-dvh max-md:max-w-none max-md:items-stretch max-md:gap-0",
      )}
      style={{
        bottom: baseBottom,
        transition: "bottom 250ms ease-out",
      }}
    >
      {panelOpen ? (
        <div
          className={cn(
            "pointer-events-auto flex w-[min(100vw-1.25rem,360px)] flex-col overflow-hidden rounded-[18px] border border-zinc-200 bg-white shadow-[0_16px_48px_rgba(0,0,0,0.16)]",
            "max-md:w-[calc(100vw-1.25rem)]",
            expanded
              ? "max-h-none max-md:!h-dvh max-md:!min-h-0 max-md:!w-full max-md:max-h-none max-md:rounded-none max-md:border-0 max-md:shadow-none max-md:pt-[env(safe-area-inset-top,0px)] max-md:pb-[env(safe-area-inset-bottom,0px)] md:h-[calc(100dvh*2/3)] md:w-[min(100vw-24px,420px)]"
              : "h-[min(42dvh,360px)] max-h-[min(42dvh,360px)] max-md:h-[min(42dvh,380px)] max-md:max-h-[min(42dvh,380px)] md:max-h-[min(70vh,520px)] md:h-auto",
          )}
          role="dialog"
          aria-label="Chat Segna"
        >
          {view === "archives" ? (
              <>
                <div className="flex items-center justify-between border-b border-zinc-100 px-2.5 py-2.5">
                  <div className="flex min-w-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label="Retour aux discussions"
                      onClick={goToList}
                      className="rounded-full p-1.5 text-zinc-900 hover:bg-zinc-100"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <p className="text-[16px] font-bold text-zinc-900">Archives</p>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={expanded ? "Réduire le chat" : "Agrandir le chat"}
                      aria-pressed={expanded}
                      onClick={() => setExpanded((v) => !v)}
                      className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                    >
                      {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      aria-label="Fermer"
                      className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                      onClick={() => {
                        setExpanded(false);
                        setPanelOpen(false);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {archivedConversations.length === 0 ? (
                    <p className="px-4 py-8 text-center text-[13px] text-zinc-500">
                      Aucune discussion archivée.
                    </p>
                  ) : (
                    archivedConversations.map((c) => {
                      const operatorName = c.operatorDisplayName?.trim() || null;
                      const listTitle = operatorName || "Chatbot";
                      const preview =
                        c.lastMessagePreview?.trim() ||
                        (c.usefulnessRating ? "Merci pour ton retour" : "Ouvrir la discussion");
                      return (
                        <div
                          key={c.id}
                          className="flex w-full items-center gap-2 border-b border-zinc-50 px-3 py-3.5 hover:bg-zinc-50"
                        >
                          <button
                            type="button"
                            onClick={() => void openConversation(c.id)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <ConversationAvatar
                              name={operatorName}
                              url={c.operatorAvatarUrl}
                              className="h-9 w-9"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-[14px] font-semibold text-zinc-900">
                                  {listTitle}
                                </span>
                                <span className="shrink-0 text-[11px] text-zinc-400">
                                  {formatWhen(c.lastMessageAt)}
                                </span>
                              </span>
                              <span className="mt-0.5 block truncate text-[12px] text-zinc-500">
                                {preview}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label="Restaurer"
                            onClick={() => void unarchiveConversation(c.id)}
                            className="shrink-0 rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                          >
                            <ArchiveRestore className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                {error ? <p className="px-4 pb-2 text-[11px] text-red-600">{error}</p> : null}
              </>
          ) : view === "list" ? (
            showEmptyWelcome ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-2.5 py-2.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="Toutes les discussions"
                      onClick={() => setBrowseEmptyList(true)}
                      className="rounded-full p-1.5 text-zinc-900 hover:bg-zinc-100"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/ressources/segna_logo.svg"
                      alt="Segna"
                      className="h-6 w-auto object-contain"
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={expanded ? "Réduire le chat" : "Agrandir le chat"}
                      aria-pressed={expanded}
                      onClick={() => setExpanded((v) => !v)}
                      className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900.5"
                    >
                      {expanded ? (
                        <Minimize2 className="h-4 w-4" />
                      ) : (
                        <Maximize2 className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label="Fermer le chat"
                      className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900.5"
                      onClick={() => {
                        setExpanded(false);
                        setPanelOpen(false);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-white px-3.5 py-3.5">
                  <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-zinc-100 px-3.5 py-2.5 text-[13px] leading-snug text-zinc-900">
                    <p className="mb-1 text-[12px] font-semibold">Segna</p>
                    Une question sur une pièce&nbsp;? Un bug&nbsp;? Un problème&nbsp;?
                    Écris-nous ci-dessous pour démarrer.
                  </div>
                </div>
                <form
                  onSubmit={onListNewChat}
                  className="border-t border-zinc-100 bg-white px-3 py-2.5.5"
                >
                  <div className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white py-1 pl-3.5 pr-1">
                    <input
                      ref={listInputRef}
                      value={listDraft}
                      onChange={(e) => {
                        clearError();
                        setListDraft(e.target.value);
                      }}
                      placeholder="Demande-nous n’importe quoi…"
                      maxLength={4000}
                      disabled={sending}
                      className="min-w-0 flex-1 bg-transparent py-2 text-[16px] outline-none"
                    />
                    <button
                      type="submit"
                      disabled={sending || !listDraft.trim()}
                      aria-label="Envoyer"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-35"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                  {error ? <p className="mt-1.5 text-[11px] text-red-600">{error}</p> : null}
                </form>
              </>
            ) : (
            <>
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3.5">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="text-[16px] font-bold text-zinc-900">Chat</p>
                  <button
                    type="button"
                    onClick={goToArchives}
                    className="inline-flex items-center gap-1 rounded-full bg-zinc-50 px-2.5 py-1 text-[12px] font-semibold text-zinc-700 hover:bg-zinc-100"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archives
                  </button>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={expanded ? "Réduire le chat" : "Agrandir le chat"}
                    aria-pressed={expanded}
                    onClick={() => setExpanded((v) => !v)}
                    className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900.5"
                  >
                    {expanded ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Fermer"
                    className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900.5"
                    onClick={() => {
                      setExpanded(false);
                      setPanelOpen(false);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {conversations.length === 0 ? (
                    <p className="px-4 py-8 text-center text-[13px] text-zinc-500">
                      Aucune discussion pour l’instant.
                    </p>
                  ) : (
                    conversations.map((c) => {
                      const operatorName = c.operatorDisplayName?.trim() || null;
                      const listTitle = operatorName || "Chatbot";
                      const preview =
                        c.lastMessagePreview?.trim() ||
                        (c.usefulnessRating ? "Merci pour ton retour" : "Ouvrir la discussion");
                      return (
                        <div
                          key={c.id}
                          className="flex w-full items-center gap-2 border-b border-zinc-50 px-3 py-3.5 hover:bg-zinc-50"
                        >
                        <button
                          type="button"
                          onClick={() => void openConversation(c.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="relative shrink-0">
                            {c.unreadStaffCount > 0 ? (
                              <span
                                className="absolute -left-1 top-1/2 z-[1] h-2 w-2 -translate-y-1/2 rounded-full bg-sky-500"
                                aria-label="Nouvelle réponse"
                              />
                            ) : null}
                            <ConversationAvatar
                              name={operatorName}
                              url={c.operatorAvatarUrl}
                              className="h-9 w-9"
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[14px] font-semibold text-zinc-900">
                                {listTitle}
                              </span>
                              <span className="shrink-0 text-[11px] text-zinc-400">
                                {formatWhen(c.lastMessageAt)}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] text-zinc-500">
                              {preview}
                            </span>
                          </span>
                        </button>
                          <button
                            type="button"
                            aria-label="Archiver"
                            onClick={() => void archiveConversation(c.id)}
                            className="shrink-0 rounded-full p-2 text-zinc-400 hover:bg-sky-50 hover:text-sky-600"
                          >
                            <Archive className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <form
                  onSubmit={onListNewChat}
                  className="shrink-0 border-t border-zinc-100 bg-white px-3 py-2.5.5"
                >
                  <div className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white py-1 pl-3.5 pr-1">
                    <input
                      ref={listInputRef}
                      value={listDraft}
                      onChange={(e) => {
                        clearError();
                        setListDraft(e.target.value);
                      }}
                      placeholder="Nouveau chat…"
                      maxLength={4000}
                      disabled={sending}
                      className="min-w-0 flex-1 bg-transparent py-2 text-[16px] outline-none"
                    />
                    <button
                      type="submit"
                      disabled={sending || !listDraft.trim()}
                      aria-label="Envoyer"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-35"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                  {error ? <p className="mt-1.5 text-[11px] text-red-600">{error}</p> : null}
                </form>
              </div>
            </>
            )
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-2.5 py-2.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Toutes les discussions"
                    onClick={goToList}
                    className="rounded-full p-1.5 text-zinc-900 hover:bg-zinc-100"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <ConversationAvatar
                    name={
                      conversation?.operatorDisplayName ||
                      messages.find((m) => m.role === "staff" && m.staffDisplayName)?.staffDisplayName
                    }
                    url={
                      conversation?.operatorAvatarUrl ||
                      messages.find((m) => m.role === "staff" && m.staffAvatarUrl)?.staffAvatarUrl
                    }
                    className="h-7 w-7"
                  />
                  <p className="min-w-0 truncate text-[14px] font-semibold text-zinc-900">
                    {title}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={expanded ? "Réduire le chat" : "Agrandir le chat"}
                    aria-pressed={expanded}
                    onClick={() => setExpanded((v) => !v)}
                    className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900.5"
                  >
                    {expanded ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Fermer le chat"
                    className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900.5"
                    onClick={() => {
                      setExpanded(false);
                      setPanelOpen(false);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div
                ref={listRef}
                className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-white px-3.5 py-3.5"
              >
                <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-zinc-100 px-3.5 py-2.5 text-[13px] leading-snug text-zinc-900">
                  <p className="mb-1 text-[12px] font-semibold">Segna</p>
                  {welcomeCopy}
                </div>

                {messages.map((m) => {
                  if (m.role === "visitor") {
                    return (
                      <div
                        key={m.id}
                        className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-zinc-900 px-3.5 py-2.5 text-[13px] leading-snug text-white"
                      >
                        {m.body}
                      </div>
                    );
                  }
                  if (m.role === "system") {
                    const joinName = m.staffDisplayName?.trim();
                    if (joinName && m.body === ITEM_CHAT_STAFF_JOINED_BODY) {
                      return (
                        <p
                          key={m.id}
                          className="mx-auto mt-1 max-w-[95%] text-center text-[12px] leading-snug text-zinc-400"
                        >
                          <span className="font-semibold text-zinc-800">{joinName}</span>
                          {" "}
                          a rejoint la conversation
                        </p>
                      );
                    }
                    return (
                      <div
                        key={m.id}
                        className="mx-auto max-w-[85%] text-center text-[11px] leading-snug text-zinc-400"
                      >
                        {m.body}
                      </div>
                    );
                  }
                  const name = m.staffDisplayName?.trim();
                  if (name) {
                    return (
                      <div key={m.id} className="mr-auto flex max-w-[92%] items-end gap-2">
                        <StaffAvatar name={name} url={m.staffAvatarUrl} />
                        <div className="min-w-0 rounded-2xl rounded-tl-md bg-zinc-100 px-3.5 py-2.5 text-[13px] leading-snug text-zinc-900">
                          <p className="mb-1 text-[12px] font-semibold">{name}</p>
                          {m.body}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={m.id}
                      className="mr-auto max-w-[85%] rounded-2xl bg-zinc-100 px-3.5 py-2.5 text-[13px] leading-snug text-zinc-900"
                    >
                      {m.body}
                    </div>
                  );
                })}
                {botTyping ? (
                  <div
                    className="max-w-[92%] rounded-2xl rounded-tl-md bg-zinc-100 px-3.5 py-3 text-[13px] leading-snug text-zinc-900"
                    aria-label="Segna écrit"
                  >
                    <p className="mb-1.5 text-[12px] font-semibold">Segna</p>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.24s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.12s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:0.12s]" />
                    </span>
                  </div>
                ) : null}

                {awaitingUsefulness ? (
                  <div className="mt-1 flex justify-center gap-2">
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void submitUsefulnessRating("yes")}
                      className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-40"
                    >
                      Oui
                    </button>
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void submitUsefulnessRating("no")}
                      className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-40"
                    >
                      Non
                    </button>
                  </div>
                ) : !botTyping &&
                  !conversation?.usefulnessRating &&
                  messages.some((m) => m.role === "visitor") &&
                  !messages.some(
                    (m) =>
                      m.role === "system" &&
                      m.body === ITEM_CHAT_STAFF_JOINED_BODY &&
                      m.staffDisplayName,
                  ) ? (
                  <p className="mx-auto mt-1 text-center text-[12px] text-zinc-400">
                    En attente de réponse
                  </p>
                ) : null}
              </div>

              <form
                onSubmit={onSubmit}
                className="border-t border-zinc-100 bg-white px-3 py-2.5.5"
              >
                <div className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white py-1 pl-3.5 pr-1">
                  <input
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => {
                      clearError();
                      setDraft(e.target.value);
                    }}
                    placeholder="Demande-nous n’importe quoi…"
                    maxLength={4000}
                    className="min-w-0 flex-1 bg-transparent py-2 text-[16px] outline-none"
                  />
                  <button
                    type="submit"
                    disabled={sending || !draft.trim()}
                    aria-label="Envoyer"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-35"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
                {error ? <p className="mt-1.5 text-[11px] text-red-600">{error}</p> : null}
              </form>
            </>
          )}
        </div>
      ) : null}

      <button
        type="button"
        aria-label={panelOpen ? "Fermer le chat pièce" : "Ouvrir le chat pièce"}
        onClick={() => {
          if (panelOpen) {
            setExpanded(false);
            setPanelOpen(false);
          } else {
            clearError();
            setBrowseEmptyList(false);
            goToList();
            setPanelOpen(true);
          }
        }}
        className={cn(FLOATING_ROUND_ACTION_SHELL_CLASS, expanded && "max-md:hidden")}
      >
        {panelOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <svg
            viewBox="0 0 24 24"
            width="26"
            height="26"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path
              d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {unreadCount > 0 && !panelOpen ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white ring-2 ring-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}
