"use client";

import { useEffect, useRef, useState } from "react";
import type { WheelEvent as ReactWheelEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;

import { NewItemDetailPageShell } from "@/components/items/new-item/NewItemDetailPageShell";
import { getItemInfoDraft, mergeItemInfoDraft } from "@/lib/items/itemInfoDraftStorage";
import { withFromItemParam } from "@/lib/items/new-item-nav";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const WHEEL_STEP_THRESHOLD = 120;
const WHEEL_COOLDOWN_MS = 140;

type SizeOption = { id: string; code: string; label: string };
type MannequinOption = { id: string; first_name: string; size_description: string };

function getWrapped<T>(options: T[], index: number): T {
  const total = options.length;
  if (total === 0) return options[0];
  return options[((index % total) + total) % total];
}

function SizeWheelPicker({
  options,
  value,
  onChange,
}: {
  options: SizeOption[];
  value: SizeOption | null;
  onChange: (option: SizeOption) => void;
}) {
  const currentIndex = value ? Math.max(0, options.findIndex((o) => o.id === value.id)) : 0;
  const effectiveIndex = options.length > 0 ? currentIndex : 0;
  const prev = options.length > 0 ? getWrapped(options, effectiveIndex - 1) : null;
  const next = options.length > 0 ? getWrapped(options, effectiveIndex + 1) : null;
  const current = options.length > 0 ? getWrapped(options, effectiveIndex) : null;
  const wheelContainerRef = useRef<HTMLDivElement | null>(null);
  const wheelDeltaAccumulatorRef = useRef(0);
  const lastWheelStepAtRef = useRef(0);

  const step = (delta: number) => {
    if (options.length === 0) return;
    onChange(getWrapped(options, effectiveIndex + delta));
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (options.length === 0) return;

    const now = Date.now();
    if (now - lastWheelStepAtRef.current < WHEEL_COOLDOWN_MS) return;

    wheelDeltaAccumulatorRef.current += event.deltaY;
    const absDelta = Math.abs(wheelDeltaAccumulatorRef.current);

    if (absDelta < WHEEL_STEP_THRESHOLD) return;

    const direction = wheelDeltaAccumulatorRef.current > 0 ? 1 : -1;
    step(direction);
    lastWheelStepAtRef.current = now;
    wheelDeltaAccumulatorRef.current = 0;
  };

  useEffect(() => {
    const element = wheelContainerRef.current;
    if (!element) return;

    const onWheelNative = (event: globalThis.WheelEvent) => {
      handleWheel(event as unknown as ReactWheelEvent<HTMLDivElement>);
    };

    element.addEventListener("wheel", onWheelNative, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheelNative);
    };
  });

  if (options.length === 0) return null;

  return (
    <div className="min-h-[240px] border-b border-zinc-300 pb-4 pt-2">
      <div ref={wheelContainerRef} className="select-none">
        <button type="button" className="flex min-h-[64px] w-full items-center justify-center py-3" onClick={() => step(-1)}>
          <span className={cn(montserrat.className, "text-[clamp(20px,3.8vw,28px)] font-semibold leading-none text-zinc-400")}>
            {prev?.label ?? ""}
          </span>
        </button>

        <button
          type="button"
          className="flex min-h-[84px] w-full items-center justify-center border-y border-zinc-700 bg-zinc-100/65 py-5"
          onClick={() => step(1)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") step(1);
            if (event.key === "ArrowUp") step(-1);
          }}
        >
          <span className={cn(montserrat.className, "text-[clamp(24px,4.4vw,34px)] font-semibold leading-none text-zinc-800")}>
            {current?.label ?? ""}
          </span>
        </button>

        <button type="button" className="flex min-h-[64px] w-full items-center justify-center py-3" onClick={() => step(1)}>
          <span className={cn(montserrat.className, "text-[clamp(20px,3.8vw,28px)] font-semibold leading-none text-zinc-400")}>
            {next?.label ?? ""}
          </span>
        </button>
      </div>
    </div>
  );
}

export default function NewItemSizePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const itemId = searchParams.get("itemId")?.trim() || null;
  const supabase = createSupabaseBrowserClient() as any;
  const draft = getItemInfoDraft();
  const categoryId = draft.categoryId?.trim() || null;
  const selectedCode = draft.size ?? "";
  const selectedSizeId = draft.sizeId ?? "";
  const selectedRecommendedSizeId = draft.recommendedSizeId ?? "";
  const photographedOnMannequin = Boolean(draft.photographedOnMannequin);
  const selectedMannequinId = draft.mannequinId ?? "";

  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [mannequins, setMannequins] = useState<MannequinOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSize, setSelectedSize] = useState<SizeOption | null>(null);
  const [selectedRecommendedSize, setSelectedRecommendedSize] = useState<SizeOption | null>(null);
  const [onMannequin, setOnMannequin] = useState(photographedOnMannequin);
  const [selectedMannequin, setSelectedMannequin] = useState<MannequinOption | null>(null);

  useEffect(() => {
    let isUnmounted = false;
    const load = async () => {
      let scope: string | null = null;
      if (categoryId) {
        const { data: catData } = await supabase
          .from("item_categories")
          .select("size_scope")
          .eq("id", categoryId)
          .maybeSingle();
        scope = (catData as { size_scope?: string | null } | null)?.size_scope ?? null;
      }

      let data: { id: string; code: string; label?: string | null }[] | null = null;
      if (scope && scope !== "none") {
        const res = await supabase
          .from("sizes")
          .select("id,code,label")
          .like("code", `${scope}:%`)
          .order("code", { ascending: true });
        data = res.data;
      }

      const { data: mannequinRows } = await supabase
        .from("mannequins")
        .select("id,first_name,size_description")
        .order("first_name", { ascending: true });

      if (isUnmounted) return;

      const options = (data ?? []).map((row: { id: string; code: string; label?: string | null }) => ({
        id: row.id,
        code: row.code,
        label: row.label ?? (row.code.includes(":") ? row.code.split(":")[1] ?? row.code : row.code),
      }));
      setSizes(options);

      const mannequinOptions = (mannequinRows ?? []).map(
        (row: { id: string; first_name: string; size_description?: string | null }) => ({
          id: row.id,
          first_name: row.first_name,
          size_description: row.size_description?.trim() ?? "",
        }),
      );
      setMannequins(mannequinOptions);

      if (options.length > 0) {
        const existingLabel =
          selectedSizeId
            ? options.find((o: SizeOption) => o.id === selectedSizeId)
            : selectedCode
              ? options.find((o: SizeOption) => o.code === selectedCode || o.label === selectedCode)
              : null;
        const labelSize = existingLabel ?? options[Math.floor(options.length / 2)];
        setSelectedSize(labelSize);

        const existingRecommended = selectedRecommendedSizeId
          ? options.find((o: SizeOption) => o.id === selectedRecommendedSizeId)
          : draft.recommendedSize
            ? options.find((o: SizeOption) => o.label === draft.recommendedSize)
            : null;
        setSelectedRecommendedSize(existingRecommended ?? labelSize);
      } else {
        setSelectedSize(null);
        setSelectedRecommendedSize(null);
      }

      if (mannequinOptions.length > 0) {
        const existingMannequin = selectedMannequinId
          ? mannequinOptions.find((m: MannequinOption) => m.id === selectedMannequinId)
          : draft.mannequinFirstName
            ? mannequinOptions.find(
                (m: MannequinOption) => m.first_name.toLowerCase() === draft.mannequinFirstName?.toLowerCase(),
              )
            : null;
        setSelectedMannequin(existingMannequin ?? mannequinOptions[0]);
      } else {
        setSelectedMannequin(null);
      }

      setOnMannequin(photographedOnMannequin);
      setIsLoading(false);
    };
    void load();
    return () => {
      isUnmounted = true;
    };
  }, [supabase, categoryId]);

  const goBack = () => {
    const base = itemId ? `/items/new?itemId=${itemId}` : "/items/new";
    router.replace(withFromItemParam(base, searchParams));
  };

  const canConfirm =
    Boolean(selectedSize) &&
    Boolean(selectedRecommendedSize) &&
    (!onMannequin || Boolean(selectedMannequin));

  const goBackWithSize = () => {
    if (!selectedSize || !selectedRecommendedSize) return;
    mergeItemInfoDraft({
      size: selectedSize.label,
      sizeId: selectedSize.id,
      recommendedSize: selectedRecommendedSize.label,
      recommendedSizeId: selectedRecommendedSize.id,
      photographedOnMannequin: onMannequin,
      mannequinId: onMannequin && selectedMannequin ? selectedMannequin.id : null,
      mannequinFirstName: onMannequin && selectedMannequin ? selectedMannequin.first_name : null,
    });
    const base = itemId ? `/items/new?itemId=${itemId}` : "/items/new";
    router.replace(withFromItemParam(base, searchParams));
  };

  return (
    <NewItemDetailPageShell
      title="Taille"
      onCancel={goBack}
      onConfirm={goBackWithSize}
      confirmDisabled={!canConfirm || isLoading}
    >
      {isLoading ? (
        <div className="flex min-h-[120px] items-center justify-center">
          <div aria-label="Chargement" className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-900" />
        </div>
      ) : sizes.length === 0 ? (
        <p className="py-6 text-sm text-zinc-500">Aucune taille disponible pour cette catégorie.</p>
      ) : (
        <div className="space-y-8">
          <section className="space-y-2">
            <p className={cn(montserrat.className, "text-[14px] font-semibold text-zinc-900")}>Taille étiquette</p>
            <p className={cn(montserrat.className, "text-[13px] text-zinc-500")}>
              Ce qui est indiqué sur l&apos;étiquette de la pièce.
            </p>
            <SizeWheelPicker options={sizes} value={selectedSize} onChange={setSelectedSize} />
          </section>

          <section className="space-y-2">
            <p className={cn(montserrat.className, "text-[14px] font-semibold text-zinc-900")}>Taille recommandée Segna</p>
            <p className={cn(montserrat.className, "text-[13px] text-zinc-500")}>
              La taille que Segna conseille selon le fit réel (peut différer de l&apos;étiquette).
            </p>
            <SizeWheelPicker
              options={sizes}
              value={selectedRecommendedSize}
              onChange={setSelectedRecommendedSize}
            />
          </section>

          <section className="space-y-3 border-t border-zinc-200 pt-6">
            <button
              type="button"
              onClick={() => setOnMannequin((value) => !value)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <div>
                <p className={cn(montserrat.className, "text-[14px] font-semibold text-zinc-900")}>Photo sur mannequin</p>
                <p className={cn(montserrat.className, "mt-1 text-[13px] text-zinc-500")}>
                  Coche si les photos ont été prises sur un mannequin Segna.
                </p>
              </div>
              <span
                className={cn(
                  "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
                  onMannequin ? "bg-zinc-900" : "bg-zinc-200",
                )}
                aria-hidden
              >
                <span
                  className={cn(
                    "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
                    onMannequin ? "translate-x-6" : "translate-x-1",
                  )}
                />
              </span>
            </button>

            {onMannequin ? (
              mannequins.length === 0 ? (
                <p className={cn(montserrat.className, "text-[13px] text-zinc-500")}>Aucun mannequin disponible.</p>
              ) : (
                <div className="space-y-2">
                  <p className={cn(montserrat.className, "text-[13px] font-medium text-zinc-600")}>Mannequin</p>
                  <div className="space-y-2">
                    {mannequins.map((mannequin) => {
                      const selected = selectedMannequin?.id === mannequin.id;
                      return (
                        <button
                          key={mannequin.id}
                          type="button"
                          onClick={() => setSelectedMannequin(mannequin)}
                          className={cn(
                            "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition",
                            selected
                              ? "border-zinc-900 bg-zinc-50"
                              : "border-zinc-200 bg-white hover:border-zinc-300",
                          )}
                        >
                          <span className={cn(montserrat.className, "text-[15px] font-semibold text-zinc-900")}>
                            {mannequin.first_name}
                          </span>
                          <span className={cn(montserrat.className, "text-[13px] text-zinc-500")}>
                            {mannequin.size_description || "—"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )
            ) : null}
          </section>
        </div>
      )}
    </NewItemDetailPageShell>
  );
}
