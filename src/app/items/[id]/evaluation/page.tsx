"use client";

import { Montserrat } from "next/font/google";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });

export default function ItemEvaluationPage() {
  const params = useParams();
  const router = useRouter();
  const itemId = typeof params.id === "string" ? params.id : null;

  const [value, setValue] = useState<string>("");
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const supabase = createSupabaseBrowserClient() as any;

  useEffect(() => {
    if (!itemId) return;
    let isUnmounted = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("items")
        .select("price_points")
        .eq("id", itemId)
        .single();

      if (isUnmounted) return;
      if (error) {
        setErrorMessage("Item introuvable.");
        setIsLoading(false);
        return;
      }
      const pts = data?.price_points;
      setCurrentPrice(pts != null ? Number(pts) : null);
      if (pts != null) setValue(String(pts));
      setIsLoading(false);
    };

    void load();
    return () => {
      isUnmounted = true;
    };
  }, [itemId, supabase]);

  const handleSubmit = async () => {
    if (!itemId) return;
    const num = Math.round(Number(value));
    if (!Number.isFinite(num) || num < 0) {
      setErrorMessage("Saisis un nombre valide (≥ 0).");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setIsSubmitting(false);
      setErrorMessage("Session invalide.");
      return;
    }

    const oldPoints = currentPrice;
    const newPoints = num;

    const { error: updateError } = await supabase
      .from("items")
      .update({ price_points: newPoints, status: "validation_pending" })
      .eq("id", itemId)
      .eq("owner_user_id", user.id);

    if (updateError) {
      setIsSubmitting(false);
      setErrorMessage(updateError.message);
      return;
    }

    await supabase.from("item_price_history").insert({
      item_id: itemId,
      actor_user_id: user.id,
      old_price_points: oldPoints,
      new_price_points: newPoints,
      reason: "owner_evaluation",
    });

    setIsSubmitting(false);
    router.push(`/items/${itemId}`);
    router.refresh();
  };

  const numValue = Math.round(Number(value));
  const canSubmit = Number.isFinite(numValue) && numValue >= 0;

  if (!itemId) {
    return (
      <main className="min-h-[100dvh] bg-white">
        <p className="p-6 text-sm text-zinc-500">Item introuvable.</p>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-white">
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 px-5 pb-4 pt-7">
        <div className="w-[72px]" aria-hidden />
        <h1 className={cn(montserrat.className, "text-center text-[24px] font-bold leading-none text-zinc-900")}>
          Value
        </h1>
        <button
          type="button"
          className={cn(
            montserrat.className,
            "w-[72px] text-right text-[18px] font-semibold text-[#5E3023] disabled:opacity-40",
          )}
          disabled={!canSubmit || isSubmitting}
          onClick={handleSubmit}
        >
          {isSubmitting ? "..." : "Terminer"}
        </button>
      </header>

      <section className="mx-auto w-full max-w-[460px] px-4 pb-8 pt-6">
        <div className="mx-auto w-full max-w-[380px]">
          {isLoading ? (
            <p className="py-6 text-sm text-zinc-500">Chargement...</p>
          ) : (
            <>
              {errorMessage ? (
                <p className="mb-4 text-sm text-[#E44D3E]">{errorMessage}</p>
              ) : null}
              <label className={cn(montserrat.className, "mb-2 block text-[14px] text-zinc-500")}>
                Valeur en points
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                className={cn(
                  "h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-[18px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900",
                )}
              />
            </>
          )}
        </div>
      </section>
    </main>
  );
}
