"use client";

import { Montserrat } from "next/font/google";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { OnboardingBirthCore } from "@/components/onboarding/OnboardingBirthCore";
import { OnboardingBrandsCore } from "@/components/onboarding/OnboardingBrandsCore";
import { OnboardingBudgetCore } from "@/components/onboarding/OnboardingBudgetCore";
import { OnboardingDressingCore } from "@/components/onboarding/OnboardingDressingCore";
import { OnboardingEthicCore } from "@/components/onboarding/OnboardingEthicCore";
import { OnboardingExperienceCore } from "@/components/onboarding/OnboardingExperienceCore";
import { OnboardingLocationCore } from "@/components/onboarding/OnboardingLocationCore";
import { OnboardingMotivationCore } from "@/components/onboarding/OnboardingMotivationCore";
import { OnboardingNameCore } from "@/components/onboarding/OnboardingNameCore";
import { OnboardingShareCore } from "@/components/onboarding/OnboardingShareCore";
import { OnboardingSizeCore } from "@/components/onboarding/OnboardingSizeCore";
import { OnboardingStyleCore } from "@/components/onboarding/OnboardingStyleCore";
import { OnboardingWorkCore } from "@/components/onboarding/OnboardingWorkCore";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type FieldId =
  | "first_name"
  | "age"
  | "location"
  | "work"
  | "sizes"
  | "brands"
  | "style"
  | "motivation"
  | "experience"
  | "share"
  | "budget"
  | "dressing"
  | "ethic";

type FieldKind =
  | "name"
  | "birth"
  | "location"
  | "work"
  | "sizes"
  | "brands"
  | "style"
  | "motivation"
  | "experience"
  | "share"
  | "budget"
  | "dressing"
  | "ethic";

type FieldConfig = {
  id: FieldId;
  label: string;
  kind: FieldKind;
};

const FIELD_CONFIG: Record<FieldId, FieldConfig> = {
  first_name: { id: "first_name", label: "Prénom", kind: "name" },
  age: { id: "age", label: "Âge", kind: "birth" },
  location: { id: "location", label: "Position", kind: "location" },
  work: { id: "work", label: "Profession", kind: "work" },
  sizes: { id: "sizes", label: "Tailles", kind: "sizes" },
  brands: { id: "brands", label: "Marques", kind: "brands" },
  style: { id: "style", label: "Style", kind: "style" },
  motivation: { id: "motivation", label: "Motivation", kind: "motivation" },
  experience: { id: "experience", label: "Expérience", kind: "experience" },
  share: { id: "share", label: "Partage", kind: "share" },
  budget: { id: "budget", label: "Budget", kind: "budget" },
  dressing: { id: "dressing", label: "Dressing", kind: "dressing" },
  ethic: { id: "ethic", label: "Éthique", kind: "ethic" },
};

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });

export function ProfileFieldEditClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient() as any, []);

  const fieldRaw = (searchParams.get("field") ?? "first_name") as FieldId;
  const field = FIELD_CONFIG[fieldRaw] ? fieldRaw : "first_name";
  const config = FIELD_CONFIG[field];
  const returnPath = searchParams.get("returnPath") ?? "/profile/complete?tab=me";
  const [canContinue, setCanContinue] = useState(false);
  const [isLoadingInitials, setIsLoadingInitials] = useState(true);
  const [initialValues, setInitialValues] = useState<{
    firstName?: string;
    lastName?: string;
    birthDate?: string;
    work?: string;
    locationLabel?: string;
    locationLat?: number;
    locationLon?: number;
    locationCity?: string;
    locationRelativeCity?: string;
    locationTimezone?: string;
    topSize?: string;
    bottomSize?: string;
    shoesSize?: string;
    selectedBrandIds?: string[];
  }>({});

  const formId = useMemo(() => `profile-edit-form-${field}`, [field]);

  useEffect(() => {
    let mounted = true;
    const loadInitialValues = async () => {
      setIsLoadingInitials(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (mounted) setIsLoadingInitials(false);
        return;
      }

      const [{ data: usersRow }, { data: profileRow }] = await Promise.all([
        supabase.from("users").select("first_name,last_name").eq("id", user.id).maybeSingle(),
        supabase.from("user_profiles").select("*").eq("user_id", user.id).maybeSingle(),
      ]);

      const profile = (profileRow ?? {}) as Record<string, unknown>;
      const profileData = (profile.profile_data ?? {}) as Record<string, unknown>;
      const location = (profileData.location ?? {}) as Record<string, unknown>;
      const profileId = typeof profile.id === "string" ? profile.id : null;

      const [sizesResponse, brandsResponse] = await Promise.all([
        profileId ? supabase.from("user_profile_sizes").select("category,size_id").eq("user_profile_id", profileId) : Promise.resolve({ data: [] }),
        profileId ? supabase.from("user_profile_brands").select("brand_id,rank").eq("user_profile_id", profileId).order("rank", { ascending: true }) : Promise.resolve({ data: [] }),
      ]);
      const sizesRows = (sizesResponse.data ?? []) as Array<{ category?: string | null; size_id?: string | null }>;
      const sizeIds = Array.from(
        new Set(sizesRows.map((entry) => (typeof entry.size_id === "string" ? entry.size_id : "")).filter((entry) => entry.length > 0)),
      );
      const { data: sizesCatalogRows } =
        sizeIds.length > 0 ? await supabase.from("sizes").select("id,code").in("id", sizeIds) : { data: [] as Array<{ id: string; code: string }> };
      const sizeCodeById = new Map<string, string>(
        ((sizesCatalogRows ?? []) as Array<{ id?: string | null; code?: string | null }>)
          .filter((entry): entry is { id: string; code: string | null } => typeof entry.id === "string")
          .map((entry) => [entry.id, entry.code ?? ""]),
      );
      const parseSize = (category: "top" | "bottom" | "shoes") => {
        const row = sizesRows.find((entry) => entry.category === category);
        const sizeId = typeof row?.size_id === "string" ? row.size_id : "";
        const code = sizeId ? sizeCodeById.get(sizeId) ?? "" : "";
        if (!code) return undefined;
        return code.includes(":") ? code.split(":")[1] || undefined : code;
      };

      if (!mounted) return;
      setInitialValues({
        firstName: typeof usersRow?.first_name === "string" ? usersRow.first_name : "",
        lastName: typeof usersRow?.last_name === "string" ? usersRow.last_name : "",
        birthDate: typeof profileData.birth_date === "string" ? profileData.birth_date : undefined,
        work: typeof profileData.work === "string" ? profileData.work : "",
        locationLabel: typeof location.label === "string" ? location.label : typeof profile.city === "string" ? profile.city : "",
        locationLat: typeof location.lat === "number" ? location.lat : undefined,
        locationLon: typeof location.lon === "number" ? location.lon : undefined,
        locationCity: typeof profile.city === "string" ? profile.city : undefined,
        locationRelativeCity: typeof location.relative_city === "string" ? location.relative_city : undefined,
        locationTimezone: typeof location.timezone === "string" ? location.timezone : "Europe/Paris",
        topSize: parseSize("top"),
        bottomSize: parseSize("bottom"),
        shoesSize: parseSize("shoes"),
        selectedBrandIds: ((brandsResponse.data ?? []) as Array<{ brand_id?: string | null }>)
          .map((entry) => entry.brand_id ?? "")
          .filter((entry) => entry.length > 0),
      });
      setIsLoadingInitials(false);
    };

    void loadInitialValues();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  const fieldBody = useMemo(() => {
    const sharedProps = {
      formId,
      onCanContinueChange: setCanContinue,
      redirectPath: returnPath,
    };
    if (config.kind === "name") return <OnboardingNameCore {...sharedProps} initialFirstName={initialValues.firstName} initialLastName={initialValues.lastName} />;
    if (config.kind === "birth") return <OnboardingBirthCore {...sharedProps} initialBirthDate={initialValues.birthDate} />;
    if (config.kind === "location")
      return (
        <OnboardingLocationCore
          {...sharedProps}
          initialLocation={{
            label: initialValues.locationLabel,
            lat: initialValues.locationLat,
            lon: initialValues.locationLon,
            city: initialValues.locationCity,
            relativeCity: initialValues.locationRelativeCity,
            timezone: initialValues.locationTimezone,
          }}
        />
      );
    if (config.kind === "work") return <OnboardingWorkCore {...sharedProps} initialProfession={initialValues.work} />;
    if (config.kind === "sizes")
      return (
        <OnboardingSizeCore
          {...sharedProps}
          initialTopSize={initialValues.topSize}
          initialBottomSize={initialValues.bottomSize}
          initialShoesSize={initialValues.shoesSize}
        />
      );
    if (config.kind === "brands")
      return <OnboardingBrandsCore {...sharedProps} initialSelectedBrandIds={initialValues.selectedBrandIds} showRankSection />;
    if (config.kind === "style") return <OnboardingStyleCore {...sharedProps} />;
    if (config.kind === "motivation") return <OnboardingMotivationCore {...sharedProps} />;
    if (config.kind === "experience") return <OnboardingExperienceCore {...sharedProps} />;
    if (config.kind === "share") return <OnboardingShareCore {...sharedProps} />;
    if (config.kind === "budget") return <OnboardingBudgetCore {...sharedProps} />;
    if (config.kind === "dressing") return <OnboardingDressingCore {...sharedProps} />;
    if (config.kind === "ethic") return <OnboardingEthicCore {...sharedProps} />;
    return null;
  }, [config.kind, formId, initialValues.birthDate, initialValues.bottomSize, initialValues.firstName, initialValues.lastName, initialValues.locationCity, initialValues.locationLabel, initialValues.locationLat, initialValues.locationLon, initialValues.locationRelativeCity, initialValues.locationTimezone, initialValues.selectedBrandIds, initialValues.shoesSize, initialValues.topSize, initialValues.work, returnPath]);

  return (
    <main className="min-h-[100dvh] bg-white">
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 px-5 pb-4 pt-7">
        <button type="button" className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023]")} onClick={() => router.push(returnPath)}>
          Annuler
        </button>
        <h1 className={cn(montserrat.className, "text-center text-[24px] font-bold leading-none text-zinc-900")}>{config.label}</h1>
        <button type="submit" form={formId} disabled={!canContinue} className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023] disabled:opacity-40")}>
          Terminé
        </button>
      </header>

      <section className="mx-auto w-full max-w-[460px] px-4 pb-8 pt-3">
        <div className="mx-auto w-full max-w-[380px]">
          {isLoadingInitials ? (
            <div className="flex min-h-[55vh] items-center justify-center">
              <div
                aria-label="Chargement"
                className="h-12 w-12 animate-spin rounded-full border-[4px] border-zinc-200 border-t-[#5E3023] border-r-[#5E3023]"
              />
            </div>
          ) : (
            fieldBody
          )}
        </div>
      </section>
    </main>
  );
}
