"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";

import { CartDisputeItemPicker } from "@/components/commande/CartDisputeItemPicker";
import { CartDisputePhotoPicker, type CartDisputePhotoDraft } from "@/components/commande/CartDisputePhotoPicker";
import { segnaDialogBodyClass } from "@/components/ui/SegnaAppDialog";
import {
  memberCartDisputeCategoriesForKind,
  resolveDisputeScopeFromSelection,
  type MemberCartDisputeReportKind,
} from "@/lib/disputes/member-cart-dispute-categories";
import type { MemberCartOrderLine } from "@/lib/cart/fetch-member-cart-order-detail";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

type Props = {
  cartId: string;
  orderNumberCompact: string;
  backHref: string;
  lines: MemberCartOrderLine[];
  /** `borrow` = pendant l’emprunt ; `reception` = constat à la livraison / ouverture du colis. */
  reportKind?: MemberCartDisputeReportKind;
};

const COPY: Record<
  MemberCartDisputeReportKind,
  {
    title: string;
    intro?: string;
    crossLink?: {
      label: string;
      href: (cartId: string) => string;
      hint: string;
    };
    itemsHeading: string;
    categoryHeading: string;
    descriptionPlaceholder: string;
    submitLabel: string;
    successMessage: string;
  }
> = {
  borrow: {
    title: "Déclarer un problème",
    intro:
      "Signale un incident survenu pendant ton emprunt : perte, détérioration, retard de retour, difficulté au relais…",
    crossLink: {
      label: "Problème à la réception du colis ?",
      href: (id) => `/commande/${id}/probleme?kind=reception`,
      hint: "Colis, contenu ou conformité constatés à l’ouverture : déclaration distincte, dans les 48 h après livraison.",
    },
    itemsHeading: "Articles concernés",
    categoryHeading: "Que s’est-il passé ?",
    descriptionPlaceholder:
      "Décris précisément la situation (quand, où, circonstances) et ce que tu attends de Segna…",
    submitLabel: "Envoyer le signalement",
    successMessage:
      "Merci, ton signalement a bien été enregistré. L'équipe Segna examine ta demande et te recontactera si besoin.",
  },
  reception: {
    title: "Déclarer un problème",
    itemsHeading: "Articles concernés",
    categoryHeading: "Type de problème constaté",
    descriptionPlaceholder:
      "Décris ce que tu as constaté à la réception (état du colis, pièces manquantes, non-conformité…)…",
    submitLabel: "Envoyer la déclaration",
    successMessage:
      "Merci, ta déclaration à la réception est enregistrée. L'équipe Segna la traite en priorité et te recontactera si besoin.",
  },
};

export function CommandeDeclareProblemeClient({
  cartId,
  orderNumberCompact,
  backHref,
  lines,
  reportKind = "borrow",
}: Props) {
  const router = useRouter();
  const copy = COPY[reportKind];
  const categories = memberCartDisputeCategoriesForKind(reportKind);

  const allItemIds = useMemo(() => lines.map((l) => l.itemId), [lines]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>(allItemIds);
  const [category, setCategory] = useState("");
  const [details, setDetails] = useState("");
  const [photos, setPhotos] = useState<CartDisputePhotoDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setSelectedItemIds(allItemIds);
  }, [allItemIds]);

  const scopeResolved = useMemo(
    () => resolveDisputeScopeFromSelection(allItemIds, selectedItemIds),
    [allItemIds, selectedItemIds],
  );

  const canSubmit = useMemo(() => {
    if (!category || !details.trim()) return false;
    return !("error" in scopeResolved);
  }, [category, details, scopeResolved]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy || "error" in scopeResolved) return;

    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("cartId", cartId);
      formData.append("reportKind", reportKind);
      formData.append("category", category);
      formData.append("scope", scopeResolved.scope);
      formData.append("details", details.trim());
      formData.append("itemIds", JSON.stringify(scopeResolved.itemIds));
      for (const photo of photos) {
        formData.append("photos", photo.file);
      }

      const res = await fetch("/api/cart/dispute/open", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Envoi impossible. Réessaie.");
        return;
      }
      setSent(true);
    } catch {
      setError("Envoi impossible. Réessaie.");
    } finally {
      setBusy(false);
    }
  }

  const optionBtn = (active: boolean) =>
    cn(
      segnaMontserrat.className,
      "flex w-full items-center justify-between border-b border-zinc-200 py-3.5 text-left transition",
      active ? "text-zinc-950" : "text-zinc-700",
    );

  const checkBox = (active: boolean) =>
    cn(
      "inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center border",
      active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-zinc-100 text-transparent",
    );

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-white pb-[max(5rem,env(safe-area-inset-bottom,0px)+4.5rem)]">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <Link
            href={backHref}
            className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900 transition hover:bg-zinc-100"
            aria-label="Retour"
          >
            <X className="h-8 w-8" strokeWidth={2.25} />
          </Link>
          <h1 className={cn("mt-4 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            {copy.title}
          </h1>
          <p className={cn(segnaDialogBodyClass(), "mt-2")}>Commande {orderNumberCompact}</p>
        </div>
      </header>

      <div className="flex flex-1 flex-col px-5 pb-6 pt-4">
        {sent ? (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
            <p className={cn(segnaMontserrat.className, "text-[15px] leading-relaxed text-zinc-800")}>
              {copy.successMessage}
            </p>
            <button
              type="button"
              onClick={() => router.push(backHref)}
              className={cn(
                segnaMontserrat.className,
                "mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white",
              )}
            >
              Retour
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-6">
            {copy.intro ? (
              <p className={cn(segnaMontserrat.className, "text-[14px] leading-relaxed text-zinc-600")}>{copy.intro}</p>
            ) : null}

            {copy.crossLink ? (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3">
                <Link
                  href={copy.crossLink.href(cartId)}
                  className={cn(
                    segnaMontserrat.className,
                    "text-[14px] font-semibold text-zinc-900 underline underline-offset-2",
                  )}
                >
                  {copy.crossLink.label}
                </Link>
                <p className={cn(segnaMontserrat.className, "mt-1.5 text-[13px] leading-snug text-zinc-500")}>
                  {copy.crossLink.hint}
                </p>
              </div>
            ) : null}

            <section>
              <h2 className={cn(segnaMontserrat.className, "text-[15px] font-bold text-zinc-900")}>
                {copy.itemsHeading}
              </h2>
              <div className="mt-2">
                <CartDisputeItemPicker
                  lines={lines}
                  selectedItemIds={selectedItemIds}
                  onChange={setSelectedItemIds}
                />
              </div>
              {"error" in scopeResolved ? (
                <p className="mt-2 text-sm font-medium text-red-600">{scopeResolved.error}</p>
              ) : null}
            </section>

            <section>
              <h2 className={cn(segnaMontserrat.className, "text-[15px] font-bold text-zinc-900")}>
                {copy.categoryHeading}
              </h2>
              <div className="mt-2 space-y-0">
                {categories.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setCategory(opt.id)}
                    className={optionBtn(category === opt.id)}
                  >
                    <span className="pr-3 text-[15px] font-semibold leading-snug">{opt.label}</span>
                    <span className={checkBox(category === opt.id)} aria-hidden>
                      <Check size={14} strokeWidth={3} />
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <label
                htmlFor="cart-dispute-details"
                className={cn(segnaMontserrat.className, "text-[15px] font-bold text-zinc-900")}
              >
                Description
              </label>
              <textarea
                id="cart-dispute-details"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={5}
                required
                placeholder={copy.descriptionPlaceholder}
                className="mt-2 w-full resize-none rounded-xl border border-zinc-200 px-3 py-2.5 text-[15px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400"
              />
            </section>

            <CartDisputePhotoPicker photos={photos} onChange={setPhotos} />

            {error ? (
              <p className="text-sm font-medium text-red-600" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={!canSubmit || busy}
              className={cn(
                segnaMontserrat.className,
                "flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {busy ? "Envoi…" : copy.submitLabel}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
