"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function OnboardingBridgePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleComplete = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding/bridge/complete", { method: "POST" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Impossible de finaliser le bridge");
      }
      router.push("/shop");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main style={{ padding: "2rem", maxWidth: "36rem", margin: "0 auto" }}>
      <h1>Passage vers l&apos;espace réel</h1>
      <p>Quand la checklist est complète, tu peux quitter le mode démo et basculer vers tes données réelles.</p>
      <button type="button" onClick={handleComplete} disabled={isLoading}>
        {isLoading ? "Validation..." : "Accéder à mon espace réel"}
      </button>
      {error ? <p style={{ color: "#c00" }}>{error}</p> : null}
    </main>
  );
}
