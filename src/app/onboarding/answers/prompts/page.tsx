"use client";

import { Montserrat } from "next/font/google";
import { X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { AppViewport } from "@/components/layout/AppViewport";
import { OnboardingStepTracker } from "@/components/onboarding/OnboardingStepTracker";
import { ANSWERS_PROMPTS_BY_TAB, ANSWERS_TABS, type AnswersTabId } from "@/lib/onboarding/answersPrompts";
import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

function isAnswersTab(value: string): value is AnswersTabId {
  return ANSWERS_TABS.some((tab) => tab.id === value);
}

function OnboardingAnswersPromptsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabsScrollRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ active: boolean; lastX: number }>({ active: false, lastX: 0 });

  const tabParam = searchParams.get("tab") ?? ANSWERS_TABS[0].id;
  const currentTab: AnswersTabId = isAnswersTab(tabParam) ? tabParam : ANSWERS_TABS[0].id;

  const slotRaw = Number(searchParams.get("slot") ?? "0");
  const slotIndex = Number.isNaN(slotRaw) ? 0 : Math.max(0, Math.min(2, slotRaw));

  const p0 = searchParams.get("p0") ?? "";
  const p1 = searchParams.get("p1") ?? "";
  const p2 = searchParams.get("p2") ?? "";
  const r0 = searchParams.get("r0") ?? "";
  const r1 = searchParams.get("r1") ?? "";
  const r2 = searchParams.get("r2") ?? "";
  const returnPath = searchParams.get("returnPath") ?? "/onboarding/answers";

  const buildAnswersUrl = (nextValues?: { p0?: string; p1?: string; p2?: string; r0?: string; r1?: string; r2?: string }) => {
    const [basePath, existingQuery] = returnPath.split("?");
    const query = new URLSearchParams(existingQuery ?? "");
    const nextP0 = nextValues?.p0 ?? p0;
    const nextP1 = nextValues?.p1 ?? p1;
    const nextP2 = nextValues?.p2 ?? p2;
    const nextR0 = nextValues?.r0 ?? r0;
    const nextR1 = nextValues?.r1 ?? r1;
    const nextR2 = nextValues?.r2 ?? r2;
    if (nextP0.trim()) query.set("p0", nextP0.trim());
    if (nextP1.trim()) query.set("p1", nextP1.trim());
    if (nextP2.trim()) query.set("p2", nextP2.trim());
    if (nextR0.trim()) query.set("r0", nextR0.trim());
    if (nextR1.trim()) query.set("r1", nextR1.trim());
    if (nextR2.trim()) query.set("r2", nextR2.trim());
    const queryString = query.toString();
    return queryString ? `${basePath}?${queryString}` : basePath;
  };

  const goToTab = (tab: AnswersTabId) => {
    const query = new URLSearchParams(searchParams.toString());
    query.set("tab", tab);
    router.push(`/onboarding/answers/prompts?${query.toString()}`);
  };

  const selectPrompt = (prompt: string) => {
    const next = { p0, p1, p2, r0, r1, r2 };
    if (slotIndex === 0) {
      next.p0 = prompt;
      next.r0 = "";
    }
    if (slotIndex === 1) {
      next.p1 = prompt;
      next.r1 = "";
    }
    if (slotIndex === 2) {
      next.p2 = prompt;
      next.r2 = "";
    }
    router.push(buildAnswersUrl(next));
  };

  useEffect(() => {
    const container = tabsScrollRef.current;
    if (!container) return;

    const onWheel = (event: WheelEvent) => {
      const horizontalDelta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY;
      if (horizontalDelta === 0) return;
      event.preventDefault();
      container.scrollLeft += horizontalDelta;
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <AppViewport className="bg-[#f9f9f8] px-0 py-0 md:w-[min(92vw,760px)] md:!max-w-[760px] md:py-0">
      <OnboardingStepTracker currentStep="/onboarding/answers" />

      <div className="px-5 pb-4 pt-4 md:px-8">
        <div className="mb-4 flex items-center justify-between">
          <button type="button" onClick={() => router.push(buildAnswersUrl())} className={cn(montserrat.className, "text-[clamp(16px,2.8vw,22px)] text-[#5E3023]")}>
            Voir tout
          </button>
          <p className={cn(montserrat.className, "text-[clamp(20px,3.3vw,30px)] font-semibold text-zinc-950")}>Insights</p>
          <button type="button" onClick={() => router.push(buildAnswersUrl())} className="text-zinc-900" aria-label="Fermer">
            <X size={24} strokeWidth={2.6} />
          </button>
        </div>

        <div
          ref={tabsScrollRef}
          className="mb-4 flex gap-2 overflow-x-auto overflow-y-hidden pb-1 touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ WebkitOverflowScrolling: "touch" }}
          onPointerDown={(event) => {
            dragStateRef.current = { active: true, lastX: event.clientX };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!dragStateRef.current.active || !tabsScrollRef.current) return;
            const delta = event.clientX - dragStateRef.current.lastX;
            tabsScrollRef.current.scrollLeft -= delta;
            dragStateRef.current.lastX = event.clientX;
          }}
          onPointerUp={(event) => {
            dragStateRef.current.active = false;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={(event) => {
            dragStateRef.current.active = false;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
        >
          {ANSWERS_TABS.map((tab) => {
            const isActive = tab.id === currentTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => goToTab(tab.id)}
                className={cn(
                  montserrat.className,
                  "shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-[clamp(13px,2vw,18px)]",
                  isActive ? "border-[#5E3023] bg-[#5E3023] text-white" : "border-zinc-200 bg-white text-zinc-900",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="max-h-[58vh] overflow-y-auto border-y border-zinc-200">
          {ANSWERS_PROMPTS_BY_TAB[currentTab].map((prompt) => (
            <button key={prompt} type="button" onClick={() => selectPrompt(prompt)} className="w-full border-b border-zinc-200 px-1 py-3 text-left last:border-b-0 md:py-2.5">
              <span className={cn(montserrat.className, "text-[clamp(14px,2.1vw,20px)] leading-[1.1] text-zinc-950")}>{prompt}</span>
            </button>
          ))}
        </div>
      </div>
    </AppViewport>
  );
}

export default function OnboardingAnswersPromptsPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingAnswersPromptsPageContent />
    </Suspense>
  );
}
