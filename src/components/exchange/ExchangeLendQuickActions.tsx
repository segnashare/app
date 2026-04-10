"use client";

import Link from "next/link";
import { Pencil, Repeat2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { setItemIntakeListingStage } from "@/lib/items/item-intake";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { cn } from "@/lib/utils/cn";

type ExchangeLendQuickActionsProps = {
  id: string;
  showEditDelete: boolean;
};

export function ExchangeLendQuickActions({ id, showEditDelete }: ExchangeLendQuickActionsProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient() as any;
  const [isDeleting, setIsDeleting] = useState(false);
  const [returnConfirmOpen, setReturnConfirmOpen] = useState(false);

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setIsDeleting(false);
      return;
    }

    const { error } = await supabase
      .from("items")
      .update({ status: "draft_deleted" })
      .eq("id", id)
      .eq("owner_user_id", user.id)
      .is("deleted_at", null);

    setIsDeleting(false);
    if (error) return;

    const intakeRes = await setItemIntakeListingStage(supabase, id, "refused");
    if (!intakeRes.ok) return;

    try {
      const activeDraftId = window.sessionStorage.getItem("segna:new-item:active-draft-id");
      if (activeDraftId === id) {
        window.sessionStorage.removeItem("segna:new-item:active-draft-id");
        window.sessionStorage.removeItem("segna:new-item:slots-draft");
      }
    } catch {
      // no-op
    }

    router.refresh();
  };

  if (showEditDelete) {
    return (
      <>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700"
          aria-label="Supprimer l'item"
        >
          <Trash2 className={cn("h-5 w-5", isDeleting ? "opacity-40" : "")} />
        </button>
        <Link
          href={`/items/new?itemId=${encodeURIComponent(id)}&from=item`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700"
          aria-label="Modifier l'item"
        >
          <Pencil className="h-5 w-5" />
        </Link>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setReturnConfirmOpen(true)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700"
        aria-label="Demander un retour"
      >
        <Repeat2 className="h-5 w-5" />
      </button>
      {returnConfirmOpen ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
          <div
            className={cn(SEGNA_DIALOG_CARD_CLASS, "relative")}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`confirm-return-${id}`}
          >
            <SegnaDialogDismissButton onClick={() => setReturnConfirmOpen(false)} />
            <h2
              id={`confirm-return-${id}`}
              className={segnaDialogTitleClass("pr-10 text-[20px] sm:text-[22px]")}
            >
              Récupérer cette pièce ?
            </h2>
            <p className={cn(segnaDialogBodyClass(), "mt-2")}>
              Tu vas démarrer une demande de retour. Tu pourras ensuite confirmer l&apos;expédition depuis la page retour.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setReturnConfirmOpen(false)}
                className="h-10 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-800"
              >
                Non
              </button>
              <button
                type="button"
                onClick={() => {
                  setReturnConfirmOpen(false);
                  router.push(`/items/${encodeURIComponent(id)}/retour`);
                }}
                className="h-10 rounded-lg bg-zinc-900 text-sm font-semibold text-white"
              >
                Oui, récupérer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
