"use client";

import Link from "next/link";
import { Pencil, Repeat2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type ExchangeLendQuickActionsProps = {
  id: string;
  showEditDelete: boolean;
};

export function ExchangeLendQuickActions({ id, showEditDelete }: ExchangeLendQuickActionsProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient() as any;
  const [isDeleting, setIsDeleting] = useState(false);

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
          href={`/items/new?itemId=${encodeURIComponent(id)}`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700"
          aria-label="Modifier l'item"
        >
          <Pencil className="h-5 w-5" />
        </Link>
      </>
    );
  }

  return (
    <button
      type="button"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700"
      aria-label="Demander un retour"
    >
      <Repeat2 className="h-5 w-5" />
    </button>
  );
}
