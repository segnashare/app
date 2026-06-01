"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";

import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { shouldShowMemberFeedbackFab, shouldShowTabBar } from "@/components/layout/navigation";
import {
  FLOATING_BOTTOM_ABOVE_TAB_BAR,
  FLOATING_BOTTOM_WITHOUT_TAB_BAR,
  FLOATING_ROUND_ACTION_SHELL_CLASS,
} from "@/components/layout/floating-action-chrome";
import { MEMBER_FEEDBACK_CATEGORIES } from "@/lib/feedback/member-feedback-categories";
import { isMemberFeedbackFabEnabled } from "@/lib/feedback/member-feedback-fab-enabled";
import { cn } from "@/lib/utils/cn";

const BOTTOM_ABOVE_TAB_BAR = FLOATING_BOTTOM_ABOVE_TAB_BAR;
const BOTTOM_WITHOUT_TAB_BAR = FLOATING_BOTTOM_WITHOUT_TAB_BAR;

const optionBtn = (active: boolean) =>
  cn(
    segnaDialogMontserrat.className,
    "flex w-full items-center justify-between border-b border-zinc-200 py-2.5 text-left text-[13px] leading-snug transition last:border-b-0",
    active ? "font-semibold text-zinc-950" : "text-zinc-700",
  );

const checkBox = (active: boolean) =>
  cn(
    "inline-flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border",
    active ? "border-zinc-900 bg-zinc-900" : "border-zinc-300 bg-zinc-100",
  );

export function MemberFeedbackFab() {
  const pathname = usePathname();
  const enabled = useMemo(() => isMemberFeedbackFabEnabled(), []);
  const canRender = useMemo(
    () => enabled && shouldShowMemberFeedbackFab(pathname),
    [enabled, pathname],
  );
  const hasTabBar = useMemo(() => shouldShowTabBar(pathname), [pathname]);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [tabBarVisible, setTabBarVisible] = useState(true);
  const [category, setCategory] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const titleId = useId();
  const detailsId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onVisibility = (e: Event) => {
      const ce = e as CustomEvent<{ visible: boolean; pathname: string }>;
      if (ce.detail?.pathname === pathname) {
        setTabBarVisible(ce.detail.visible);
      }
    };
    window.addEventListener("segna:tabbar-visibility", onVisibility);
    return () => window.removeEventListener("segna:tabbar-visibility", onVisibility);
  }, [pathname]);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) return;
    const t = window.setTimeout(() => {
      setCategory("");
      setDetails("");
      setError(null);
      setSent(false);
    }, 200);
    return () => window.clearTimeout(t);
  }, [open]);

  const canSubmit = category.length > 0 && details.trim().length >= 10;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/member-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          details: details.trim(),
          pagePath: pathname,
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Envoi impossible. Réessaie.");
        return;
      }
      setSent(true);
    } catch {
      setError("Envoi impossible. Réessaie.");
    } finally {
      setBusy(false);
    }
  }

  if (!canRender) return null;

  const fab = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Signaler un problème ou poser une question"
      className={FLOATING_ROUND_ACTION_SHELL_CLASS}
    >
      <MessageCircle className="h-7 w-7" strokeWidth={2} aria-hidden />
    </button>
  );

  const modal =
    open ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]"
          role="presentation"
          onClick={close}
        >
          <div
            className={cn(SEGNA_DIALOG_CARD_CLASS, "relative max-h-[min(90dvh,640px)] overflow-y-auto text-left")}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <SegnaDialogDismissButton
              onClick={close}
              className={busy ? "pointer-events-none opacity-40" : undefined}
            />
            <h2 id={titleId} className={segnaDialogTitleClass("pr-10")}>
              {sent ? "Message envoyé" : "Signaler ou demander de l’aide"}
            </h2>

            {sent ? (
              <p className={cn(segnaDialogBodyClass(), "mt-3")}>
                Merci, ton message a bien été transmis à l’équipe Segna. Nous te recontacterons si besoin.
              </p>
            ) : (
              <form className="mt-3" onSubmit={(e) => void handleSubmit(e)}>
                <p className={cn(segnaDialogBodyClass(), "mb-4")}>
                  Choisis le type de sujet et décris la situation. Nous traitons chaque message en priorité.
                </p>

                <fieldset className="border-0 p-0">
                  <legend className={cn(segnaDialogMontserrat.className, "mb-2 text-[13px] font-semibold text-zinc-900")}>
                    Type de sujet
                  </legend>
                  <div className="max-h-[168px] overflow-y-auto overscroll-contain rounded-xl border border-zinc-200 px-3 [-webkit-overflow-scrolling:touch]">
                    {MEMBER_FEEDBACK_CATEGORIES.map((opt) => {
                      const active = category === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setCategory(opt.id)}
                          className={optionBtn(active)}
                        >
                          <span className="min-w-0 pr-3">{opt.label}</span>
                          <span className={checkBox(active)} aria-hidden>
                            {active ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <label htmlFor={detailsId} className={cn(segnaDialogMontserrat.className, "mt-4 block text-[13px] font-semibold text-zinc-900")}>
                  Description détaillée
                </label>
                <textarea
                  id={detailsId}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  rows={5}
                  maxLength={4000}
                  placeholder="Explique ce qui s’est passé, depuis quand, et ce que tu attends de Segna…"
                  className={cn(
                    segnaDialogMontserrat.className,
                    "mt-2 w-full resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none",
                    "placeholder:text-zinc-500 focus:border-zinc-900",
                  )}
                />
                <p className={cn(segnaDialogMontserrat.className, "mt-1 text-[12px] text-zinc-500")}>
                  Minimum 10 caractères · {details.trim().length}/4000
                </p>

                {error ? (
                  <p className={cn(segnaDialogMontserrat.className, "mt-3 text-sm text-red-600")}>{error}</p>
                ) : null}

                <button
                  type="submit"
                  disabled={!canSubmit || busy}
                  className={cn(
                    segnaDialogMontserrat.className,
                    "mt-5 w-full rounded-full bg-zinc-900 py-3.5 text-[15px] font-semibold text-white transition",
                    "hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  {busy ? "Envoi…" : "Envoyer"}
                </button>
              </form>
            )}

            {sent ? (
              <button
                type="button"
                onClick={close}
                className={cn(
                  segnaDialogMontserrat.className,
                  "mt-5 w-full rounded-full bg-zinc-900 py-3.5 text-[15px] font-semibold text-white transition hover:bg-zinc-800",
                )}
              >
                Fermer
              </button>
            ) : null}
          </div>
        </div>
      ) : null;

  const modalPortal =
    open && mounted && typeof document !== "undefined" ? createPortal(modal, document.body) : null;

  return (
    <>
      <div
        className="pointer-events-none fixed right-3 z-[47] flex max-w-[430px] justify-end motion-reduce:transition-none md:right-[max(12px,calc((100vw-430px)/2+12px))]"
        style={{
          bottom: hasTabBar && tabBarVisible ? BOTTOM_ABOVE_TAB_BAR : BOTTOM_WITHOUT_TAB_BAR,
          transition: "bottom 250ms ease-out",
        }}
      >
        {fab}
      </div>
      {modalPortal}
    </>
  );
}
