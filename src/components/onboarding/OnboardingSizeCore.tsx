"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Plus } from "lucide-react";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;

import { APPAREL_SIZE_BANDS } from "@/lib/sizes/apparel-size-referential";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

type SupabaseBrowser = ReturnType<typeof createSupabaseBrowserClient>;

function isMissingSizesRpcError(message: string): boolean {
  return /could not find the function|schema cache|42883|function public\.set_user_profile_sizes/i.test(message);
}

function isUniqueOrDuplicateError(message: string, code?: string): boolean {
  return code === "23505" || /duplicate key|unique constraint/i.test(message);
}

/**
 * Enregistre les tailles profil : RPC `text[]` si dispo, sinon DELETE+INSERT (une requête) via catalogue `sizes`,
 * sinon ancienne RPC une taille par zone si exactement une sélection par catégorie.
 */
async function persistUserProfileSizes(
  supabase: SupabaseBrowser,
  topCodes: string[],
  bottomCodes: string[],
  shoesCodes: string[],
): Promise<{ error: string | null }> {
  const requestId = crypto.randomUUID();

  const { error: rpcNewError } = await supabase.rpc("set_user_profile_sizes", {
    p_top_size_codes: topCodes,
    p_bottom_size_codes: bottomCodes,
    p_shoes_size_codes: shoesCodes,
    p_request_id: requestId,
  });

  if (!rpcNewError) return { error: null };

  const rpcMsg = rpcNewError.message ?? "";
  if (!isMissingSizesRpcError(rpcMsg)) return { error: rpcMsg };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { error: "Tu dois être connectée pour enregistrer tes tailles." };

  const { data: profile, error: profileError } = await supabase.from("user_profiles").select("id").eq("user_id", user.id).maybeSingle();
  if (profileError || !profile?.id) return { error: profileError?.message ?? "Profil introuvable." };

  const allCodes = [...new Set([...topCodes, ...bottomCodes, ...shoesCodes])];
  const { data: sizeRows, error: sizesLookupError } = await supabase.from("sizes").select("id,code").in("code", allCodes);
  if (sizesLookupError) return { error: sizesLookupError.message };
  const idByCode = new Map((sizeRows ?? []).map((row: { id: string; code: string | null }) => [row.code ?? "", row.id]));

  for (const code of allCodes) {
    if (!idByCode.has(code) || !idByCode.get(code)) {
      return { error: `Taille inconnue : ${code}` };
    }
  }

  const rows: Array<{ user_profile_id: string; category: string; size_id: string }> = [
    ...topCodes.map((code) => ({ user_profile_id: profile.id, category: "top", size_id: idByCode.get(code)! })),
    ...bottomCodes.map((code) => ({ user_profile_id: profile.id, category: "bottom", size_id: idByCode.get(code)! })),
    ...shoesCodes.map((code) => ({ user_profile_id: profile.id, category: "shoes", size_id: idByCode.get(code)! })),
  ];

  const { error: deleteError } = await supabase
    .from("user_profile_sizes")
    .delete()
    .eq("user_profile_id", profile.id)
    .in("category", ["top", "bottom", "shoes"]);
  if (deleteError) return { error: deleteError.message };

  const { error: insertError } = await supabase.from("user_profile_sizes").insert(rows);
  if (!insertError) return { error: null };

  const insMsg = insertError.message ?? "";
  if (
    isUniqueOrDuplicateError(insMsg, insertError.code) &&
    (topCodes.length > 1 || bottomCodes.length > 1 || shoesCodes.length > 1)
  ) {
    return {
      error:
        "Ta base n’accepte pas encore plusieurs tailles par catégorie. Applique la migration « 20260421140000_user_profile_sizes_multi.sql » sur Supabase, puis recharge le schéma API (ou réduis à une taille par zone pour tester).",
    };
  }

  if (topCodes.length === 1 && bottomCodes.length === 1 && shoesCodes.length === 1) {
    const { error: rpcLegacyError } = await supabase.rpc("set_user_profile_sizes", {
      p_top_size_code: topCodes[0],
      p_bottom_size_code: bottomCodes[0],
      p_shoes_size_code: shoesCodes[0],
      p_request_id: crypto.randomUUID(),
    });
    if (!rpcLegacyError) return { error: null };
    return { error: rpcLegacyError.message };
  }

  return { error: insMsg };
}

type OnboardingSizeCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
  onSubmittingChange?: (value: boolean) => void;
  onFooterErrorChange?: (message: string | null) => void;
  redirectPath?: string;
  /** Codes affichés (sans préfixe top:/bottom:/shoes:), ex. M, 40, 38 */
  initialTopSizes?: string[];
  initialBottomSizes?: string[];
  initialShoesSizes?: string[];
  /** @deprecated Utiliser initialTopSizes */
  initialTopSize?: string;
  /** @deprecated Utiliser initialBottomSizes */
  initialBottomSize?: string;
  /** @deprecated Utiliser initialShoesSizes */
  initialShoesSize?: string;
  /** Classes du conteneur racine */
  formClassName?: string;
};

const TOP_OPTIONS = APPAREL_SIZE_BANDS.map((b) => b.letter);
const BOTTOM_OPTIONS = APPAREL_SIZE_BANDS.map((b) => b.fr);
const TOP_LABEL_BY_CODE = Object.fromEntries(APPAREL_SIZE_BANDS.map((b) => [b.letter, b.label])) as Record<
  string,
  string
>;
const BOTTOM_LABEL_BY_CODE = Object.fromEntries(APPAREL_SIZE_BANDS.map((b) => [b.fr, b.label])) as Record<
  string,
  string
>;
/** Pointures affichées (33–44). */
const SHOES_OPTIONS = Array.from({ length: 12 }, (_, i) => String(33 + i)) as readonly string[];

function codesFromInitial(
  multi: string[] | undefined,
  single: string | undefined,
  allowed: readonly string[],
): string[] {
  if (multi && multi.length > 0) {
    const set = new Set(multi.filter((c) => allowed.includes(c)));
    return Array.from(set);
  }
  if (single && allowed.includes(single)) return [single];
  return [];
}

function SizePill({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        montserrat.className,
        "inline-flex min-h-[44px] items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-semibold transition-colors sm:px-4 sm:text-[14px]",
        selected
          ? "border-black bg-black text-white"
          : "border-zinc-200 bg-white text-zinc-900 shadow-[0_2px_10px_rgba(0,0,0,0.07)] hover:border-zinc-300",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          selected ? "bg-white/20 text-white" : "border border-zinc-300 bg-zinc-50 text-zinc-600",
        )}
        aria-hidden
      >
        {selected ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />}
      </span>
    </button>
  );
}

function SizeSection({
  heading,
  options,
  labelByCode,
  selected,
  onToggle,
}: {
  heading: string;
  options: readonly string[];
  labelByCode?: Record<string, string>;
  selected: Set<string>;
  onToggle: (code: string) => void;
}) {
  return (
    <div className="w-full">
      <p className={cn(montserrat.className, "mb-2.5 text-left text-[13px] font-semibold uppercase tracking-wide text-[#999999]")}>{heading}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <SizePill
            key={opt}
            label={labelByCode?.[opt] ?? opt}
            selected={selected.has(opt)}
            onToggle={() => onToggle(opt)}
          />
        ))}
      </div>
    </div>
  );
}

export function OnboardingSizeCore({
  formId,
  onCanContinueChange,
  onSubmittingChange,
  onFooterErrorChange,
  redirectPath,
  initialTopSizes,
  initialBottomSizes,
  initialShoesSizes,
  initialTopSize,
  initialBottomSize,
  initialShoesSize,
  formClassName,
}: OnboardingSizeCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const [topSelected, setTopSelected] = useState<Set<string>>(() => new Set());
  const [bottomSelected, setBottomSelected] = useState<Set<string>>(() => new Set());
  const [shoesSelected, setShoesSelected] = useState<Set<string>>(() => new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const allowedTop = useMemo(() => new Set<string>(TOP_OPTIONS), []);
  const allowedBottom = useMemo(() => new Set<string>(BOTTOM_OPTIONS), []);
  const allowedShoes = useMemo(() => new Set<string>(SHOES_OPTIONS), []);

  useEffect(() => {
    const tops = codesFromInitial(initialTopSizes, initialTopSize, TOP_OPTIONS);
    const bottoms = codesFromInitial(initialBottomSizes, initialBottomSize, BOTTOM_OPTIONS);
    const shoes = codesFromInitial(initialShoesSizes, initialShoesSize, SHOES_OPTIONS);
    setTopSelected(new Set(tops));
    setBottomSelected(new Set(bottoms));
    setShoesSelected(new Set(shoes));
  }, [
    initialTopSizes,
    initialBottomSizes,
    initialShoesSizes,
    initialTopSize,
    initialBottomSize,
    initialShoesSize,
  ]);

  const canContinue =
    topSelected.size > 0 && bottomSelected.size > 0 && shoesSelected.size > 0 && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    onFooterErrorChange?.(errorMessage);
  }, [errorMessage, onFooterErrorChange]);

  const toggleTop = useCallback((code: string) => {
    if (!allowedTop.has(code)) return;
    setErrorMessage(null);
    setTopSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, [allowedTop]);

  const toggleBottom = useCallback((code: string) => {
    if (!allowedBottom.has(code)) return;
    setErrorMessage(null);
    setBottomSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, [allowedBottom]);

  const toggleShoes = useCallback((code: string) => {
    if (!allowedShoes.has(code)) return;
    setErrorMessage(null);
    setShoesSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, [allowedShoes]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (topSelected.size === 0 || bottomSelected.size === 0 || shoesSelected.size === 0) {
      setErrorMessage("Choisis au moins une taille pour le haut, le bas et les chaussures.");
      return;
    }

    setIsSubmitting(true);
    const topCodes = Array.from(topSelected).map((c) => `top:${c}`);
    const bottomCodes = Array.from(bottomSelected).map((c) => `bottom:${c}`);
    const shoesCodes = Array.from(shoesSelected).map((c) => `shoes:${c}`);

    const { error: sizesPersistError } = await persistUserProfileSizes(supabase, topCodes, bottomCodes, shoesCodes);
    if (sizesPersistError) {
      setIsSubmitting(false);
      setErrorMessage(sizesPersistError);
      return;
    }

    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/3",
      p_progress_json: {
        checkpoint: "/onboarding/size",
      },
      p_request_id: crypto.randomUUID(),
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push(redirectPath ?? "/onboarding/3");
  };

  return (
    <div className={cn(formClassName ?? "mt-3 w-full")}>
      <form id={formId} onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-6">
        <SizeSection
          heading="Haut"
          options={TOP_OPTIONS}
          labelByCode={TOP_LABEL_BY_CODE}
          selected={topSelected}
          onToggle={toggleTop}
        />
        <SizeSection
          heading="Bas"
          options={BOTTOM_OPTIONS}
          labelByCode={BOTTOM_LABEL_BY_CODE}
          selected={bottomSelected}
          onToggle={toggleBottom}
        />
        <SizeSection heading="Chaussures" options={SHOES_OPTIONS} selected={shoesSelected} onToggle={toggleShoes} />
      </form>

      {onFooterErrorChange ? null : errorMessage ? (
        <p className={cn("mt-3 text-center", themeClassNames.onboarding.textes.erreurFormulaire)}>{errorMessage}</p>
      ) : null}
    </div>
  );
}
