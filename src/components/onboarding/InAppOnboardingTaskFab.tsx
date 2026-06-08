"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { SegnaTaskProgress, segnaTaskRingCounterFontSizePx } from "@/components/ui/SegnaTaskProgress";
import { shouldShowMemberFeedbackFab, shouldShowTabBar } from "@/components/layout/navigation";
import {
  FLOATING_BOTTOM_ABOVE_TAB_BAR,
  FLOATING_BOTTOM_WITHOUT_TAB_BAR,
  FLOATING_CART_PILL_MIN_HEIGHT_PX,
  FLOATING_ROUND_ACTION_SHELL_CLASS,
} from "@/components/layout/floating-action-chrome";
import {
  getInAppOnboardingTaskProgress,
  shouldShowInAppOnboardingTaskFab,
} from "@/lib/onboarding/in-app-onboarding-tasks";
import { subscribeOnboardingOfferClaimed } from "@/lib/onboarding/onboarding-offer-claimed-event";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const BOTTOM_ABOVE_TAB_BAR = FLOATING_BOTTOM_ABOVE_TAB_BAR;
const BOTTOM_WITHOUT_TAB_BAR = FLOATING_BOTTOM_WITHOUT_TAB_BAR;

export function InAppOnboardingTaskFab() {
  const pathname = usePathname();
  const router = useRouter();
  const canRender = useMemo(() => shouldShowMemberFeedbackFab(pathname), [pathname]);
  const hasTabBar = useMemo(() => shouldShowTabBar(pathname), [pathname]);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [tabBarVisible, setTabBarVisible] = useState(true);
  const [onboardingProcess, setOnboardingProcess] = useState<string | null>(null);
  const titleId = useId();
  const progress = useMemo(() => getInAppOnboardingTaskProgress(onboardingProcess), [onboardingProcess]);
  const showFab = Boolean(progress) && shouldShowInAppOnboardingTaskFab(onboardingProcess);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("users")
        .select("onboarding_process")
        .eq("id", user.id)
        .maybeSingle<{ onboarding_process?: string | null }>();
      if (!cancelled) setOnboardingProcess(data?.onboarding_process ?? null);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    return subscribeOnboardingOfferClaimed(() => {
      void (async () => {
        const supabase = createSupabaseBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from("users")
          .select("onboarding_process")
          .eq("id", user.id)
          .maybeSingle<{ onboarding_process?: string | null }>();
        setOnboardingProcess(data?.onboarding_process ?? null);
      })();
    });
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

  const close = useCallback(() => setOpen(false), []);

  const goToActiveTask = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!canRender || !showFab || !progress) return null;

  const counterLabel = `${progress.completedCount}/${progress.totalCount}`;
  const counterFontSizePx = segnaTaskRingCounterFontSizePx(FLOATING_CART_PILL_MIN_HEIGHT_PX);

  const fab = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={`Parcours onboarding, ${counterLabel} étapes complétées`}
      className={FLOATING_ROUND_ACTION_SHELL_CLASS}
    >
      <SegnaTaskProgress
        total={progress.totalCount}
        filled={progress.completedCount}
        layout="ring"
        variant="onDark"
        ringSize={FLOATING_CART_PILL_MIN_HEIGHT_PX}
      />
      <span
        className={cn(segnaDialogMontserrat.className, "relative z-[1] font-bold tabular-nums leading-none text-white")}
        style={{ fontSize: counterFontSizePx }}
      >
        {counterLabel}
      </span>
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
          <SegnaDialogDismissButton onClick={close} />
          <h2 id={titleId} className={segnaDialogTitleClass("pr-10")}>
            Ton parcours Segna
          </h2>
          <p className={cn(segnaDialogBodyClass(), "mt-2 text-[15px] font-semibold leading-snug text-zinc-600")}>
            Voici les étapes à suivre pour activer ton compte et lancer ton premier échange. Priorise la tâche en
            cours.
          </p>

          <div className="mt-5 flex items-center gap-3">
            <span
              className={cn(
                segnaDialogMontserrat.className,
                "shrink-0 text-[19px] font-bold tabular-nums text-zinc-900",
              )}
            >
              {counterLabel}
            </span>
            <SegnaTaskProgress total={progress.totalCount} filled={progress.completedCount} layout="bar" variant="onLight" />
          </div>

          <ul className="mt-6 space-y-0 divide-y divide-zinc-200 rounded-2xl border border-zinc-200">
            {progress.tasks.map((task) => {
              const rowInner = (
                <>
                  <span
                    className={cn(
                      "mt-1 inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border",
                      task.done
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : task.current
                          ? "border-zinc-900 bg-white"
                          : "border-zinc-300 bg-zinc-100",
                    )}
                    aria-hidden
                  >
                    {task.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                    {task.current ? <span className="h-2.5 w-2.5 rounded-full bg-zinc-900" /> : null}
                  </span>
                  <div className="min-w-0 flex-1 text-left">
                    <p
                      className={cn(
                        segnaDialogMontserrat.className,
                        "text-[16px] font-bold leading-snug",
                        task.done ? "text-zinc-500 line-through" : task.current ? "text-zinc-950" : "text-zinc-800",
                      )}
                    >
                      {task.title}
                    </p>
                    <p
                      className={cn(
                        segnaDialogMontserrat.className,
                        "mt-1 text-[13px] font-medium leading-snug text-zinc-600",
                      )}
                    >
                      {task.description}
                    </p>
                  </div>
                </>
              );

              return (
                <li key={task.id}>
                  {task.current ? (
                    <button
                      type="button"
                      onClick={() => goToActiveTask(task.href)}
                      className="flex w-full items-start gap-3.5 px-4 py-4 text-left transition hover:bg-zinc-50 active:bg-zinc-100"
                    >
                      {rowInner}
                    </button>
                  ) : (
                    <div className="flex items-start gap-3.5 px-4 py-4">{rowInner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    ) : null;

  const modalPortal =
    open && mounted && typeof document !== "undefined" ? createPortal(modal, document.body) : null;

  return (
    <>
      <div
        className="pointer-events-none fixed left-3 z-[47] flex max-w-[430px] justify-start motion-reduce:transition-none md:left-[max(12px,calc((100vw-430px)/2+12px))]"
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
