"use client";

import { Montserrat } from "next/font/google";
import { useEffect, useRef, useState } from "react";
import type { WheelEvent as ReactWheelEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });
const WHEEL_STEP_THRESHOLD = 120;
const WHEEL_COOLDOWN_MS = 140;

type SizeOption = { id: string; code: string; label: string };

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
    <div className="min-h-[280px] border-b border-zinc-300 pb-4 pt-2">
      <div ref={wheelContainerRef} className="select-none">
        <button type="button" className="flex min-h-[70px] w-full items-center justify-center py-3" onClick={() => step(-1)}>
          <span className={cn(montserrat.className, "text-[clamp(20px,3.8vw,28px)] font-semibold leading-none text-zinc-400")}>
            {prev?.label ?? ""}
          </span>
        </button>

        <button
          type="button"
          className="flex min-h-[90px] w-full items-center justify-center border-y border-zinc-700 bg-zinc-100/65 py-5"
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

        <button type="button" className="flex min-h-[70px] w-full items-center justify-center py-3" onClick={() => step(1)}>
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
  const supabase = createSupabaseBrowserClient() as any;
  const categoryId = searchParams.get("categoryId")?.trim() || null;
  const selectedCode = searchParams.get("size") ?? "";
  const selectedSizeId = searchParams.get("sizeId") ?? "";

  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSize, setSelectedSize] = useState<SizeOption | null>(null);

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
      if (isUnmounted) return;
      const options = (data ?? []).map((row: { id: string; code: string; label?: string | null }) => ({
        id: row.id,
        code: row.code,
        label: row.label ?? (row.code.includes(":") ? row.code.split(":")[1] ?? row.code : row.code),
      }));
      setSizes(options);
      if (options.length > 0) {
        const existing = selectedSizeId
          ? options.find((o: SizeOption) => o.id === selectedSizeId)
          : selectedCode
            ? options.find((o: SizeOption) => o.code === selectedCode)
            : null;
        setSelectedSize(existing ?? options[Math.floor(options.length / 2)]);
      } else {
        setSelectedSize(null);
      }
      setIsLoading(false);
    };
    void load();
    return () => {
      isUnmounted = true;
    };
  }, [supabase, categoryId]);

  const goBack = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("photoModifyId");
    router.push(`/items/new?${params.toString()}`);
  };

  const goBackWithSize = () => {
    if (!selectedSize) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("size", selectedSize.code);
    params.set("sizeId", selectedSize.id);
    params.delete("photoModifyId");
    router.push(`/items/new?${params.toString()}`);
  };

  return (
    <main className="min-h-[100dvh] bg-white">
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 px-5 pb-4 pt-7">
        <button type="button" className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023]")} onClick={goBack}>
          Annuler
        </button>
        <h1 className={cn(montserrat.className, "text-center text-[24px] font-bold leading-none text-zinc-900")}>Taille</h1>
        <button
          type="button"
          className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023] disabled:opacity-40")}
          disabled={!selectedSize || isLoading}
          onClick={goBackWithSize}
        >
          Terminé
        </button>
      </header>

      <section className="mx-auto w-full max-w-[460px] px-4 pb-8 pt-10">
        <div className="mx-auto w-full max-w-[380px]">
          <p className={cn(montserrat.className, "mb-6 mt-2 text-[14px] text-zinc-500")}>Sélectionne la taille de ta pièce.</p>

          {isLoading ? (
            <div className="flex min-h-[120px] items-center justify-center">
              <div aria-label="Chargement" className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-[#5E3023]" />
            </div>
          ) : sizes.length === 0 ? (
            <p className="py-6 text-sm text-zinc-500">Aucune taille disponible pour cette catégorie.</p>
          ) : (
            <SizeWheelPicker options={sizes} value={selectedSize} onChange={setSelectedSize} />
          )}
        </div>
      </section>
    </main>
  );
}
