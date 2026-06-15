import { AuthRingDotSpinner } from "@/components/ui/AuthRingDotSpinner";

type AppPageLoadingProps = {
  label?: string;
};

/** Écran de chargement pleine page — spinner seul, sans squelette. */
export function AppPageLoading({ label = "Chargement" }: AppPageLoadingProps) {
  return (
    <div
      className="flex min-h-[70vh] items-center justify-center bg-white"
      aria-busy
      aria-label={label}
    >
      <AuthRingDotSpinner variant="onLight" dotCount={6} filledDots={6} spinning aria-label={label} />
    </div>
  );
}
