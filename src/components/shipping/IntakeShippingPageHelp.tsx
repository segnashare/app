"use client";

import { LifeBuoy } from "lucide-react";
import { useCallback, useState } from "react";

import { INTAKE_GROUP_MAX_ITEMS } from "@/lib/items/member-intake-groups.shared";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

type IntakeShippingPageHelpProps = {
  itemIds: string[];
};

export function IntakeShippingPageHelp({ itemIds }: IntakeShippingPageHelpProps) {
  const [phase, setPhase] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const requestHelp = useCallback(async () => {
    const ids = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))].slice(
      0,
      INTAKE_GROUP_MAX_ITEMS,
    );
    if (ids.length === 0) return;

    setPhase("sending");
    try {
      const res = await fetch("/api/items/sendcloud/help-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          item_ids: ids,
          message:
            "Problème avec le portail d’envoi (lien inaccessible, erreur à l’ouverture, ou besoin d’aide côté Segna).",
        }),
      });
      setPhase(res.ok ? "sent" : "error");
    } catch {
      setPhase("error");
    }
  }, [itemIds]);

  return (
    <section className="border-t border-zinc-200 bg-white px-5 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] pt-8">
      <button
        type="button"
        onClick={() => void requestHelp()}
        disabled={phase === "sending" || phase === "sent"}
        className={cn(
          montserrat.className,
          "flex w-full items-center justify-center gap-2 text-center text-[14px] font-semibold text-zinc-900 underline underline-offset-2 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50",
        )}
      >
        <LifeBuoy className="h-4 w-4 shrink-0" aria-hidden />
        {phase === "sending"
          ? "Envoi…"
          : phase === "sent"
            ? "Demande envoyée"
            : "Problème avec le portail ? Contacter Segna"}
      </button>
      {phase === "error" ? (
        <p className={cn(montserrat.className, "mt-2 text-center text-[13px] font-medium text-rose-600")}>
          Réessaie plus tard ou écris-nous.
        </p>
      ) : null}
      {phase === "sent" ? (
        <p className={cn(montserrat.className, "mt-2 text-center text-[13px] font-medium text-zinc-500")}>
          L’équipe Segna traite ta demande.
        </p>
      ) : null}
    </section>
  );
}
