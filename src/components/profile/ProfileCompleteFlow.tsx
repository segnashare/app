"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ProfileCompleteHeader, type ProfileCompleteMode } from "@/components/profile/ProfileCompleteHeader";
import { ProfileCompleteModifyCore } from "@/components/profile/ProfileCompleteModifyCore";
import { ProfileCompleteVisualizationCore } from "@/components/profile/ProfileCompleteVisualizationCore";

type ProfileCompleteFlowProps = {
  /** Annuler / Terminé : profil ou paramètres selon l’entrée dans le flux. */
  exitHref: string;
  displayName: string;
  completionScore: number;
};

export function ProfileCompleteFlow({ exitHref, displayName, completionScore }: ProfileCompleteFlowProps) {
  const router = useRouter();
  const [mode, setMode] = useState<ProfileCompleteMode>("edit");
  const [insightsAreComplete, setInsightsAreComplete] = useState(true);
  const [showInsightsValidationError, setShowInsightsValidationError] = useState(false);
  const [previewScore, setPreviewScore] = useState<number | null>(null);
  const displayedScore = previewScore ?? completionScore;

  useEffect(() => {
    if (mode === "view") setPreviewScore(null);
  }, [mode]);

  const handleDone = () => {
    if (mode === "edit" && !insightsAreComplete) {
      setShowInsightsValidationError(true);
      return;
    }
    setShowInsightsValidationError(false);
    router.push(exitHref);
  };

  return (
    <div className="min-h-[100dvh] w-full">
      <main className="mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-white">
        <ProfileCompleteHeader
          exitHref={exitHref}
          displayName={displayName}
          completionScore={displayedScore}
          mode={mode}
          onModeChange={setMode}
          onDone={handleDone}
        />

        <section className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {mode === "edit" ? (
          <ProfileCompleteModifyCore
            onInsightsValidityChange={(isComplete) => {
              setInsightsAreComplete(isComplete);
              if (isComplete) setShowInsightsValidationError(false);
            }}
            showInsightsValidationError={showInsightsValidationError}
            onScorePreviewChange={setPreviewScore}
          />
        ) : (
          <ProfileCompleteVisualizationCore displayName={displayName} />
        )}
        </section>
      </main>
    </div>
  );
}
