"use client";

import Link from "next/link";
import { Image as ImageIcon, Pencil, Repeat2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type ExchangeLendItemRowProps = {
  id: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  currentValue: number | null;
  itemStatus: string;
  photoUrl?: string | null;
  photoPosition?: {
    offset?: { x?: number; y?: number };
    zoom?: number;
    aspect?: string;
  } | null;
};

function getStatusLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "draft" || normalized === "brouillon") return "Brouillon";
  if (normalized === "valuation") return "En évaluation";
  if (normalized === "validation_pending") return "En attente";
  if (normalized.includes("validation")) return "En validation";
  if (normalized === "in_cart") return "Disponible";
  if (normalized.includes("reserved") || normalized.includes("emprunt")) return "Emprunt en cours";
  if (normalized === "available" || normalized === "disponible") return "Disponible";
  return status || "Inconnu";
}

function statusPillClassName(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "draft" || normalized === "brouillon") return "bg-[#E7772C] text-white";
  if (normalized === "valuation") return "bg-amber-100 text-amber-700";
  if (normalized === "validation_pending") return "bg-violet-600 text-white";
  if (normalized.includes("validation")) return "bg-violet-100 text-violet-700";
  if (normalized === "in_cart") return "bg-emerald-100 text-emerald-700";
  if (normalized.includes("reserved") || normalized.includes("emprunt")) return "bg-blue-100 text-blue-700";
  if (normalized === "available" || normalized === "disponible") return "bg-emerald-100 text-emerald-700";
  return "bg-zinc-100 text-zinc-700";
}

function splitNameAndBrand(name: string): { title: string; brand: string | null } {
  const trimmed = name.trim();
  const match = trimmed.match(/^(.*)\(([^)]+)\)\s*$/);
  if (!match) return { title: trimmed, brand: null };
  return { title: match[1]?.trim() || trimmed, brand: match[2]?.trim() || null };
}

function isDraftLike(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return (
    normalized === "draft" ||
    normalized === "brouillon" ||
    normalized === "valuation" ||
    normalized.includes("validation") ||
    normalized.includes("pending")
  );
}

export function ExchangeLendItemRow({ id, name, description, brand: brandProp, itemStatus, photoUrl, photoPosition }: ExchangeLendItemRowProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient() as any;
  const { title, brand: brandFromName } = splitNameAndBrand(name);
  const brand = brandProp ?? brandFromName;
  const showEditDelete = isDraftLike(itemStatus);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);

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
      .update({
        deleted_at: new Date().toISOString(),
      })
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
    setIsDeleted(true);
    router.refresh();
  };

  if (isDeleted) return null;

  return (
    <article className="relative grid w-full grid-cols-[100px_minmax(0,50%)_auto] items-center gap-1 py-2">
      <Link href={`/items/${id}`} aria-label={`Voir la pièce ${title}`} className="absolute inset-0 z-0" />

      <div className="pointer-events-none relative z-10 flex items-center">
        <div className="aspect-square w-[100px] shrink-0 overflow-hidden rounded-md">
          {photoUrl ? (
            <div
              className="h-full w-full bg-center bg-no-repeat"
              style={{
                backgroundImage: `url(${photoUrl})`,
                backgroundColor: "#000000",
                backgroundSize: `${Math.max(100, Number(photoPosition?.zoom ?? 1) * 100)}%`,
                backgroundPosition: `calc(50% + ${Number(photoPosition?.offset?.x ?? 0)}%) calc(50% + ${Number(photoPosition?.offset?.y ?? 0)}%)`,
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-zinc-400">
              <ImageIcon className="h-7 w-7" aria-hidden />
            </div>
          )}
        </div>
      </div>

      <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center justify-start px-1">
        <div className="min-w-0 flex-1">
          <p className="text-[18px] font-semibold italic leading-[1.15] text-zinc-900 break-words">
            {title}
          </p>
          {brand ? <span className="font-semibold text-[16px] not-italic"> ({brand})</span> : null}
          {description ? <p className="mt-1 text-[13px] leading-[1.3] text-zinc-500 break-words">{description}</p> : null}
          <span className={cn("mt-2 inline-flex rounded-md px-2 py-1 text-[11px] font-semibold", statusPillClassName(itemStatus))}>{getStatusLabel(itemStatus)}</span>
        </div>
      </div>

      <div className="relative z-20 flex items-center justify-end gap-1 pr-0">
        {showEditDelete ? (
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
        ) : (
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700"
            aria-label="Demander un retour"
          >
            <Repeat2 className="h-5 w-5" />
          </button>
        )}
      </div>
    </article>
  );
}
