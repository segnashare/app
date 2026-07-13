"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { MEMBER_HOME_HREF } from "@/components/layout/navigation";

export default function OnboardingDemoPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isBridgeLoading, setIsBridgeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInit = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding/init", { method: "POST" });
      if (!response.ok) {
        throw new Error("Impossible d'initialiser la démo");
      }
      router.push(MEMBER_HOME_HREF);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartBridge = async () => {
    setIsBridgeLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding/bridge/start", { method: "POST" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Impossible de passer au bridge");
      }
      router.push("/onboarding/bridge");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setIsBridgeLoading(false);
    }
  };

  return (
    <main style={{ padding: "2rem", maxWidth: "36rem", margin: "0 auto" }}>
      <h1>Mode démo onboarding</h1>
      <p>
        Tu vas entrer dans la vraie app avec un mode démo sécurisé: lecture catalogue réelle, actions de modification désactivées.
      </p>
      <button type="button" onClick={handleInit} disabled={isLoading || isBridgeLoading}>
        {isLoading ? "Initialisation..." : "Démarrer la démo"}
      </button>
      <button type="button" onClick={handleStartBridge} disabled={isLoading || isBridgeLoading} style={{ marginLeft: "0.75rem" }}>
        {isBridgeLoading ? "Passage..." : "Passer au bridge"}
      </button>
      {error ? <p style={{ color: "#c00" }}>{error}</p> : null}
    </main>
  );
}
