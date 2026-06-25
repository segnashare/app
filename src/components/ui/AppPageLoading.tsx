import { AuthRingDotSpinner } from "@/components/ui/AuthRingDotSpinner";
import { PageChromeLoadingMarker } from "@/components/layout/PageChromeLoadingContext";

type AppPageLoadingProps = {
  label?: string;
};

/** Écran de chargement pleine page — spinner seul, sans squelette. */
export function AppPageLoading({ label = "Chargement" }: AppPageLoadingProps) {
  return (
    <>
      <PageChromeLoadingMarker />
      <div
        className="segna-lock-document-scroll flex min-h-[100dvh] w-full items-center justify-center bg-white"
        aria-busy
        aria-label={label}
      >
        <AuthRingDotSpinner variant="onLight" dotCount={6} filledDots={6} spinning aria-label={label} />
      </div>
    </>
  );
}
