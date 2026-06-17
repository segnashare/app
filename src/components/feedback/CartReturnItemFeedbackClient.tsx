"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";

import {
  FeedbackWornPhotoSlots,
  type FeedbackWornPhotoDraft,
} from "@/components/feedback/FeedbackWornPhotoSlots";
import { StarRatingInput } from "@/components/feedback/StarRatingInput";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import type { CartReturnFeedbackLineState } from "@/lib/feedback/item-feedback-types";
import { RETURN_FEEDBACK_CREDIT_PER_ELEMENT } from "@/lib/feedback/grant-return-feedback-credits";
import { trackClientEvent } from "@/lib/analytics/track-client";
import { segnaMontserrat, segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
import { SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

type LineFormState = {
  rating: number;
  comment: string;
  newPhotos: FeedbackWornPhotoDraft[];
  removedExistingPaths: string[];
};

type CartReturnItemFeedbackClientProps = {
  cartId: string;
  lines: CartReturnFeedbackLineState[];
  eligible?: boolean;
};

function FeedbackCreditHint({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        montserrat.className,
        "text-[12px] font-semibold",
        active ? "text-emerald-700" : "text-[#5E3023]",
      )}
    >
      +{RETURN_FEEDBACK_CREDIT_PER_ELEMENT} crédits
    </span>
  );
}

function FeedbackFieldLabel({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className={cn(montserrat.className, "text-[13px] font-semibold text-zinc-700")}>{label}</span>
      <FeedbackCreditHint active={active} />
    </div>
  );
}

export function CartReturnItemFeedbackClient({
  cartId,
  lines,
  eligible = true,
}: CartReturnItemFeedbackClientProps) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, LineFormState>>(() => {
    const initial: Record<string, LineFormState> = {};
    for (const line of lines) {
      initial[line.cartItemId] = {
        rating: line.existingRating ?? 0,
        comment: line.existingComment ?? "",
        newPhotos: [],
        removedExistingPaths: [],
      };
    }
    return initial;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allRated = useMemo(
    () => lines.every((line) => (drafts[line.cartItemId]?.rating ?? 0) >= 1),
    [drafts, lines],
  );

  const estimatedCredits = useMemo(() => {
    let total = 0;
    for (const line of lines) {
      const draft = drafts[line.cartItemId];
      if (!draft) continue;
      const keptExisting = line.existingWornPhotos.filter(
        (p) => !draft.removedExistingPaths.includes(p.storagePath),
      );
      const photoCount = keptExisting.length + draft.newPhotos.length;
      if (draft.rating >= 1) total += RETURN_FEEDBACK_CREDIT_PER_ELEMENT;
      if (draft.comment.trim().length > 5) total += RETURN_FEEDBACK_CREDIT_PER_ELEMENT;
      if (photoCount >= 1) total += RETURN_FEEDBACK_CREDIT_PER_ELEMENT;
    }
    return total;
  }, [drafts, lines]);

  async function handleSubmit() {
    if (!allRated) {
      setError("Attribue une note à chaque pièce (1 à 5 étoiles).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("cart_id", cartId);
      formData.append(
        "items",
        JSON.stringify(
          lines.map((line) => {
            const draft = drafts[line.cartItemId] ?? {
              rating: 0,
              comment: "",
              newPhotos: [],
              removedExistingPaths: [],
            };
            const keepWornPhotoPaths = line.existingWornPhotos
              .filter((p) => !draft.removedExistingPaths.includes(p.storagePath))
              .map((p) => p.storagePath);
            return {
              cart_item_id: line.cartItemId,
              item_id: line.itemId,
              rating: draft.rating,
              comment: draft.comment.trim(),
              keep_worn_photo_paths: keepWornPhotoPaths,
            };
          }),
        ),
      );

      for (const line of lines) {
        const draft = drafts[line.cartItemId];
        if (!draft) continue;
        draft.newPhotos.forEach((photo, index) => {
          formData.append(`photo_${line.cartItemId}_${index}`, photo.file);
        });
      }

      const res = await fetch("/api/cart/return/feedbacks", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        credits_granted?: number;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Erreur ${res.status}`);
        return;
      }
      trackClientEvent("order_returned", {
        cart_id: cartId,
        phase: "return_feedback_submitted",
      });
      const credits = Math.max(0, Math.floor(Number(data.credits_granted ?? 0)));
      const query = credits > 0 ? `?avis=ok&credits=${credits}` : "?avis=ok";
      router.replace(`/exchange/retour/${cartId}${query}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-white pb-[max(5rem,env(safe-area-inset-bottom,0px)+4.5rem)]">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <Link
            href={`/exchange/retour/${cartId}`}
            className="-ml-1.5 inline-flex h-12 w-12 items-center justify-center rounded-full text-zinc-900 transition hover:bg-zinc-100"
            aria-label="Retour"
          >
            <ChevronLeft className="h-8 w-8" strokeWidth={2.25} />
          </Link>
          <h1 className={cn("mt-3", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            Note ton échange
          </h1>
          <p className={cn(montserrat.className, "mt-1.5 text-[17px] font-medium leading-snug text-zinc-600")}>
            Gagne des crédits en partageant ton avis sur les pièces que tu as portées.
          </p>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-5 px-5 py-6">
        {!eligible ? (
          <p className={cn(montserrat.className, "text-center text-[15px] leading-relaxed text-zinc-600")}>
            Les avis seront disponibles dès que ton colis retour sera déposé au relais.
          </p>
        ) : lines.length === 0 ? (
          <p className={cn(montserrat.className, "text-center text-[15px] leading-relaxed text-zinc-600")}>
            Aucune pièce à noter pour cette commande.
          </p>
        ) : null}

        {eligible
          ? lines.map((line) => {
              const draft = drafts[line.cartItemId] ?? {
                rating: 0,
                comment: "",
                newPhotos: [],
                removedExistingPaths: [],
              };
              const visibleExisting = line.existingWornPhotos
                .filter((p) => !draft.removedExistingPaths.includes(p.storagePath))
                .filter((p) => p.previewUrl)
                .map((p) => ({
                  id: p.id,
                  storagePath: p.storagePath,
                  previewUrl: p.previewUrl!,
                }));
              const photoCount = visibleExisting.length + draft.newPhotos.length;
              const ratingActive = draft.rating >= 1;
              const commentActive = draft.comment.trim().length > 5;
              const photoActive = photoCount >= 1;

              return (
                <article
                  key={line.cartItemId}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex gap-3">
                    <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
                      {line.photoUrl ? (
                        <RemoteCoverThumb photoUrl={line.photoUrl} frameClassName="h-full w-full" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
                          —
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn(montserrat.className, "truncate text-[15px] font-bold text-zinc-900")}>
                        {line.itemName}
                      </p>
                      {line.brand ? (
                        <p className={cn(montserrat.className, "truncate text-[13px] text-zinc-500")}>
                          {line.brand}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4">
                    <FeedbackFieldLabel label="Votre note" active={ratingActive} />
                    <StarRatingInput
                      value={draft.rating}
                      onChange={(rating) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [line.cartItemId]: { ...draft, rating },
                        }))
                      }
                      disabled={submitting}
                    />
                  </div>

                  <label className="mt-4 block">
                    <FeedbackFieldLabel label="Votre avis" active={commentActive} />
                    <textarea
                      value={draft.comment}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [line.cartItemId]: { ...draft, comment: e.target.value },
                        }))
                      }
                      disabled={submitting}
                      rows={3}
                      placeholder="Comment s’est portée la pièce ? Coupe, confort, état à la restitution…"
                      className={cn(
                        montserrat.className,
                        "w-full resize-none rounded-xl border border-zinc-200 px-3 py-2.5 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:border-[#8B6A54]/45 focus:outline-none focus:ring-2 focus:ring-[#8B6A54]/20",
                      )}
                    />
                    <p className={cn(montserrat.className, "mt-1 text-[11px] text-zinc-400")}>
                      Plus de 5 caractères pour débloquer les crédits.
                    </p>
                  </label>

                  <FeedbackWornPhotoSlots
                    existingPhotos={visibleExisting}
                    newPhotos={draft.newPhotos}
                    onNewPhotosChange={(photos) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [line.cartItemId]: { ...draft, newPhotos: photos },
                      }))
                    }
                    onRemoveExisting={(id) => {
                      const removed = line.existingWornPhotos.find((p) => p.id === id);
                      if (!removed) return;
                      setDrafts((prev) => ({
                        ...prev,
                        [line.cartItemId]: {
                          ...draft,
                          removedExistingPaths: [...draft.removedExistingPaths, removed.storagePath],
                        },
                      }));
                    }}
                    disabled={submitting}
                  />
                  {!photoActive ? (
                    <p className={cn(montserrat.className, "mt-1 text-[11px] text-zinc-400")}>
                      Ajoute au moins une photo portée pour gagner +{RETURN_FEEDBACK_CREDIT_PER_ELEMENT} crédits.
                    </p>
                  ) : null}
                </article>
              );
            })
          : null}

        {error ? <p className="text-center text-sm text-rose-700">{error}</p> : null}

        {eligible && lines.length > 0 ? (
          <>
            {estimatedCredits > 0 ? (
              <p className={cn(montserrat.className, "text-center text-[14px] font-medium text-zinc-700")}>
                Jusqu&apos;à {estimatedCredits} crédits pour cette commande
              </p>
            ) : null}
            <button
              type="button"
              disabled={submitting || !allRated}
              onClick={() => void handleSubmit()}
              className={cn(
                montserrat.className,
                "w-full rounded-full bg-zinc-950 py-3.5 text-[16px] font-bold text-white transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {submitting ? "Enregistrement…" : "Envoyer mes avis"}
            </button>
          </>
        ) : null}
      </div>
    </main>
  );
}
