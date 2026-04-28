"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  cartId: string;
};

export function CommandeUberActivateButton({ cartId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function onActivate() {
    if (loading) return;
    setLoading(true);
    setMessage(null);
    setIsError(false);
    try {
      const res = await fetch("/api/cart/order/uber/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ cartId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        uber?: { status?: string; error?: string };
        status?: string;
      };
      if (!res.ok || !data.ok) {
        setIsError(true);
        setMessage("Activation impossible pour le moment.");
        return;
      }
      const status = data.status ?? data.uber?.status ?? "";
      if (status === "already_active" || status === "duplicate_ignored" || status === "created") {
        setMessage("Course Uber activée. Mise à jour en cours…");
        router.refresh();
        return;
      }
      if (status === "not_applicable") {
        setMessage("Ton colis est encore en préparation. Réessaie dans un instant.");
        return;
      }
      if (status === "failed") {
        setIsError(true);
        setMessage("Activation Uber échouée. Réessaie ou contacte le support.");
        return;
      }
      setMessage("Demande envoyée.");
      router.refresh();
    } catch {
      setIsError(true);
      setMessage("Erreur réseau. Réessaie.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-5 w-full max-w-sm">
      <button
        type="button"
        onClick={() => void onActivate()}
        disabled={loading}
        className="flex w-full items-center justify-center rounded-full border border-black bg-white px-6 py-3 text-center text-[15px] font-bold leading-none text-black transition hover:bg-zinc-50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:text-[16px]"
      >
        {loading ? "Activation…" : "Activer la livraison Uber"}
      </button>
      {message ? (
        <p className={`mt-2 text-center text-[12px] ${isError ? "text-red-600" : "text-zinc-500"}`}>{message}</p>
      ) : null}
    </div>
  );
}
