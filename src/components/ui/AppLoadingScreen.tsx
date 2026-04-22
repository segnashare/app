import { AuthRingDotSpinner } from "@/components/ui/AuthRingDotSpinner";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

type AppLoadingScreenProps = {
  /** Par défaut : « Chargement… » (aligné auth / onboarding intro). */
  label?: string;
};

/** Même indicateur que `/auth` et les intros onboarding 1–3 (`AuthRingDotSpinner` 6/6). */
export function AppLoadingScreen({ label = "Chargement…" }: AppLoadingScreenProps) {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-white px-6">
      <div className="flex flex-col items-center gap-5">
        <AuthRingDotSpinner variant="onLight" dotCount={6} filledDots={6} spinning aria-label="Chargement" />
        <p className={cn(montserrat.className, "text-center text-[15px] font-semibold text-zinc-500")}>{label}</p>
      </div>
    </div>
  );
}
