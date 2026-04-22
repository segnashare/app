"use client";

import { cn } from "@/lib/utils/cn";

type OnboardingProgressPillsProps = {
  /** 0 = première étape (onboarding /1), 1 et 2 pour les suivantes. */
  activeIndex: 0 | 1 | 2;
  /** Sur fond coloré (ex. onboarding 3 carrousel) : segments clairs. */
  variant?: "default" | "onDark";
  className?: string;
};

const TOTAL = 3;

/**
 * Pastilles d’avancement (3 étapes) : segment actif plus long et noir.
 */
export function OnboardingProgressPills({ activeIndex, variant = "default", className }: OnboardingProgressPillsProps) {
  const onDark = variant === "onDark";
  return (
    <div className={cn("flex items-center justify-center gap-2", className)} role="list" aria-label="Progression onboarding">
      {Array.from({ length: TOTAL }, (_, i) => {
        const active = i === activeIndex;
        return (
          <span
            key={i}
            role="listitem"
            aria-current={active ? "step" : undefined}
            className={cn(
              "h-1.5 shrink-0 rounded-full transition-[width,background-color] duration-200",
              onDark
                ? active
                  ? "w-10 bg-white"
                  : "w-6 bg-white/35"
                : active
                  ? "w-10 bg-zinc-900"
                  : "w-6 bg-zinc-300",
            )}
          />
        );
      })}
    </div>
  );
}
