"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Maximize2, Minimize2, Plus, Send, X } from "lucide-react";
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
import { ITEM_CHAT_STAFF_JOINED_BODY } from "@/lib/item-chat/types";

function StaffAvatar({
  name,
  url,
  sizeClass = "h-6 w-6 text-[10px]",
}: {
  name: string;
  url?: string | null;
  sizeClass?: string;
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={24}
        height={24}
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
    startNewChat,
    conversations,
    unreadCount,
    messages,
    conversation,
    pendingItem,
    sending,
    error,
    clearError,
    openConversation,
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
  }, [panelOpen, view, messages.length]);

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
    conversation?.itemTitle ||
    pendingItem?.itemTitle ||
    (conversation && !conversation.itemId ? "Question générale" : "Question");

  const welcomeCopy =
    conversation?.itemId || pendingItem?.itemId
      ? "Qu'est-ce que tu aimerais savoir sur cette pièce ?"
      : "Qu'est-ce que tu aimerais savoir ?";

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    void sendMessage(text).then(() => setDraft(""));
  };

  const onListNewChat = (e: FormEvent) => {
    e.preventDefault();
    const text = listDraft.trim();
    if (!text || sending) return;
    void startNewChat({ initialMessage: text }).then(() => setListDraft(""));
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
          {view === "list" ? (
            showEmptyWelcome ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-2.5 py-2.5 max-md:px-3 max-md:py-3.5">
                  <div className="flex min-w-0 items-center gap-1.5 max-md:gap-2">
                    <button
                      type="button"
                      aria-label="Toutes les discussions"
                      onClick={() => setBrowseEmptyList(true)}
                      className="rounded-full p-1.5 text-zinc-900 hover:bg-zinc-100 max-md:p-2"
                    >
                      <ChevronLeft className="h-5 w-5 max-md:h-6 max-md:w-6" />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/ressources/segna_logo.svg"
                      alt="Segna"
                      className="h-6 w-auto object-contain max-md:h-7"
                    />
                    <p className="min-w-0 truncate text-[11px] text-zinc-500 max-md:text-[13px]">Question générale</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 max-md:gap-1">
                    <button
                      type="button"
                      aria-label={expanded ? "Réduire le chat" : "Agrandir le chat"}
                      aria-pressed={expanded}
                      onClick={() => setExpanded((v) => !v)}
                      className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 max-md:p-2.5"
                    >
                      {expanded ? (
                        <Minimize2 className="h-4 w-4 max-md:h-5 max-md:w-5" />
                      ) : (
                        <Maximize2 className="h-4 w-4 max-md:h-5 max-md:w-5" />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label="Fermer le chat"
                      className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 max-md:p-2.5"
                      onClick={() => {
                        setExpanded(false);
                        setPanelOpen(false);
                      }}
                    >
                      <X className="h-4 w-4 max-md:h-5 max-md:w-5" />
                    </button>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-white px-3.5 py-3.5 max-md:gap-3 max-md:px-4 max-md:py-4">
                  <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-zinc-100 px-3.5 py-2.5 text-[13px] leading-snug text-zinc-900 max-md:px-4 max-md:py-3 max-md:text-[15px]">
                    <p className="mb-1 text-[12px] font-semibold max-md:text-[13px]">Segna</p>
                    Une question sur une pièce&nbsp;? Un bug&nbsp;? Un problème&nbsp;?
                    Écris-nous ci-dessous pour démarrer.
                  </div>
                </div>
                <form
                  onSubmit={onListNewChat}
                  className="border-t border-zinc-100 bg-white px-3 py-2.5 max-md:px-4 max-md:py-3.5"
                >
                  <div className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white py-1 pl-3.5 pr-1 max-md:py-1.5 max-md:pl-4">
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
                      className="min-w-0 flex-1 bg-transparent py-2 text-[16px] outline-none max-md:py-2.5 max-md:text-[17px]"
                    />
                    <button
                      type="submit"
                      disabled={sending || !listDraft.trim()}
                      aria-label="Envoyer"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-35 max-md:size-11"
                    >
                      <Send className="h-4 w-4 max-md:h-5 max-md:w-5" />
                    </button>
                  </div>
                  {error ? <p className="mt-1.5 text-[11px] text-red-600">{error}</p> : null}
                </form>
              </>
            ) : (
            <>
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3.5 max-md:px-4 max-md:py-4">
                <p className="text-[16px] font-bold text-zinc-900 max-md:text-[18px]">Chat</p>
                <div className="flex items-center gap-0.5 max-md:gap-1">
                  <button
                    type="button"
                    aria-label="Nouveau chat"
                    onClick={() => {
                      if (conversations.length === 0) setBrowseEmptyList(false);
                      else listInputRef.current?.focus();
                    }}
                    className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 max-md:p-2.5"
                  >
                    <Plus className="h-4 w-4 max-md:h-5 max-md:w-5" />
                  </button>
                  <button
                    type="button"
                    aria-label={expanded ? "Réduire le chat" : "Agrandir le chat"}
                    aria-pressed={expanded}
                    onClick={() => setExpanded((v) => !v)}
                    className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 max-md:p-2.5"
                  >
                    {expanded ? (
                      <Minimize2 className="h-4 w-4 max-md:h-5 max-md:w-5" />
                    ) : (
                      <Maximize2 className="h-4 w-4 max-md:h-5 max-md:w-5" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Fermer"
                    className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 max-md:p-2.5"
                    onClick={() => {
                      setExpanded(false);
                      setPanelOpen(false);
                    }}
                  >
                    <X className="h-4 w-4 max-md:h-5 max-md:w-5" />
                  </button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {conversations.length === 0 ? (
                    <p className="px-4 py-8 text-center text-[13px] text-zinc-500 max-md:text-[15px]">
                      Aucune discussion pour l’instant.
                    </p>
                  ) : (
                    conversations.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => void openConversation(c.id)}
                        className="flex w-full items-center gap-3 border-b border-zinc-50 px-4 py-3.5 text-left hover:bg-zinc-50 max-md:gap-3.5 max-md:px-4 max-md:py-4"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="/ressources/segna_logo.svg"
                          alt=""
                          className="h-9 w-9 object-contain max-md:h-11 max-md:w-11"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[14px] font-semibold text-zinc-900 max-md:text-[16px]">
                              {c.itemTitle || (c.itemId ? "Pièce" : "Question générale")}
                            </span>
                            <span className="shrink-0 text-[11px] text-zinc-400 max-md:text-[12px]">
                              {formatWhen(c.lastMessageAt)}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[12px] text-zinc-500 max-md:mt-1 max-md:text-[14px]">
                            {c.unreadStaffCount > 0
                              ? `${c.unreadStaffCount} nouvelle${c.unreadStaffCount > 1 ? "s" : ""} réponse${c.unreadStaffCount > 1 ? "s" : ""}`
                              : c.hasVisitorMessage
                                ? "En attente de réponse"
                                : "Ouvrir la discussion"}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <form
                  onSubmit={onListNewChat}
                  className="shrink-0 border-t border-zinc-100 bg-white px-3 py-2.5 max-md:px-4 max-md:py-3.5"
                >
                  <div className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white py-1 pl-3.5 pr-1 max-md:py-1.5 max-md:pl-4">
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
                      className="min-w-0 flex-1 bg-transparent py-2 text-[16px] outline-none max-md:py-2.5 max-md:text-[17px]"
                    />
                    <button
                      type="submit"
                      disabled={sending || !listDraft.trim()}
                      aria-label="Envoyer"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-35 max-md:size-11"
                    >
                      <Send className="h-4 w-4 max-md:h-5 max-md:w-5" />
                    </button>
                  </div>
                  {error ? <p className="mt-1.5 text-[11px] text-red-600">{error}</p> : null}
                </form>
              </div>
            </>
            )
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-2.5 py-2.5 max-md:px-3 max-md:py-3.5">
                <div className="flex min-w-0 items-center gap-1.5 max-md:gap-2">
                  <button
                    type="button"
                    aria-label="Toutes les discussions"
                    onClick={goToList}
                    className="rounded-full p-1.5 text-zinc-900 hover:bg-zinc-100 max-md:p-2"
                  >
                    <ChevronLeft className="h-5 w-5 max-md:h-6 max-md:w-6" />
                  </button>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/ressources/segna_logo.svg"
                    alt="Segna"
                    className="h-6 w-auto object-contain max-md:h-7"
                  />
                  <p className="min-w-0 truncate text-[11px] text-zinc-500 max-md:text-[13px]">{title}</p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 max-md:gap-1">
                  <button
                    type="button"
                    aria-label={expanded ? "Réduire le chat" : "Agrandir le chat"}
                    aria-pressed={expanded}
                    onClick={() => setExpanded((v) => !v)}
                    className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 max-md:p-2.5"
                  >
                    {expanded ? (
                      <Minimize2 className="h-4 w-4 max-md:h-5 max-md:w-5" />
                    ) : (
                      <Maximize2 className="h-4 w-4 max-md:h-5 max-md:w-5" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Fermer le chat"
                    className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 max-md:p-2.5"
                    onClick={() => {
                      setExpanded(false);
                      setPanelOpen(false);
                    }}
                  >
                    <X className="h-4 w-4 max-md:h-5 max-md:w-5" />
                  </button>
                </div>
              </div>

              <div
                ref={listRef}
                className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-white px-3.5 py-3.5 max-md:gap-3 max-md:px-4 max-md:py-4"
              >
                <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-zinc-100 px-3.5 py-2.5 text-[13px] leading-snug text-zinc-900 max-md:px-4 max-md:py-3 max-md:text-[15px]">
                  <p className="mb-1 text-[12px] font-semibold max-md:text-[13px]">Segna</p>
                  {welcomeCopy}
                </div>

                {messages.map((m) => {
                  if (m.role === "visitor") {
                    return (
                      <div
                        key={m.id}
                        className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-zinc-900 px-3.5 py-2.5 text-[13px] leading-snug text-white max-md:px-4 max-md:py-3 max-md:text-[15px]"
                      >
                        {m.body}
                      </div>
                    );
                  }
                  if (m.role === "system") {
                    const joinName = m.staffDisplayName?.trim();
                    if (joinName && m.body === ITEM_CHAT_STAFF_JOINED_BODY) {
                      return (
                        <div
                          key={m.id}
                          className="mr-auto flex max-w-[95%] items-center gap-2 py-0.5"
                        >
                          <StaffAvatar name={joinName} url={m.staffAvatarUrl} />
                          <p className="text-[12px] leading-snug text-zinc-500 max-md:text-[13px]">
                            <span className="font-semibold text-zinc-800">{joinName}</span>
                            {" "}
                            a rejoint la conversation
                          </p>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={m.id}
                        className="mx-auto max-w-[85%] text-center text-[11px] leading-snug text-zinc-400 max-md:text-[12px]"
                      >
                        {m.body}
                      </div>
                    );
                  }
                  const name = m.staffDisplayName?.trim();
                  if (name) {
                    return (
                      <div key={m.id} className="mr-auto flex max-w-[92%] flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <StaffAvatar name={name} url={m.staffAvatarUrl} />
                          <p className="text-[12px] font-semibold text-zinc-800 max-md:text-[13px]">
                            {name}
                          </p>
                        </div>
                        <div className="rounded-2xl rounded-tl-md bg-zinc-100 px-3.5 py-2.5 text-[13px] leading-snug text-zinc-900 max-md:px-4 max-md:py-3 max-md:text-[15px]">
                          {m.body}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={m.id}
                      className="mr-auto max-w-[85%] rounded-2xl bg-zinc-100 px-3.5 py-2.5 text-[13px] leading-snug text-zinc-900 max-md:px-4 max-md:py-3 max-md:text-[15px]"
                    >
                      {m.body}
                    </div>
                  );
                })}
                {awaitingUsefulness ? (
                  <div className="mt-1 flex justify-center gap-2 max-md:gap-3">
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void submitUsefulnessRating("yes")}
                      className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-40 max-md:min-h-11 max-md:px-5 max-md:text-[15px]"
                    >
                      Oui
                    </button>
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void submitUsefulnessRating("no")}
                      className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-40 max-md:min-h-11 max-md:px-5 max-md:text-[15px]"
                    >
                      Non
                    </button>
                  </div>
                ) : messages.some((m) => m.role === "visitor") &&
                  !messages.some(
                    (m) =>
                      m.role === "system" &&
                      m.body === ITEM_CHAT_STAFF_JOINED_BODY &&
                      m.staffDisplayName,
                  ) ? (
                  <p className="mx-auto mt-1 text-center text-[12px] text-zinc-400 max-md:text-[14px]">
                    En attente de réponse
                  </p>
                ) : null}
              </div>

              <form
                onSubmit={onSubmit}
                className="border-t border-zinc-100 bg-white px-3 py-2.5 max-md:px-4 max-md:py-3.5"
              >
                <div className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white py-1 pl-3.5 pr-1 max-md:py-1.5 max-md:pl-4">
                  <input
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => {
                      clearError();
                      setDraft(e.target.value);
                    }}
                    placeholder="Demande-nous n’importe quoi…"
                    maxLength={4000}
                    className="min-w-0 flex-1 bg-transparent py-2 text-[16px] outline-none max-md:py-2.5 max-md:text-[17px]"
                  />
                  <button
                    type="submit"
                    disabled={sending || !draft.trim()}
                    aria-label="Envoyer"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-35 max-md:size-11"
                  >
                    <Send className="h-4 w-4 max-md:h-5 max-md:w-5" />
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
