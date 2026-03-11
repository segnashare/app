"use client";

import { Montserrat } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Crosshair } from "lucide-react";

import { Input } from "@/components/ui/Input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

type LocationFormValues = {
  location: string;
};

type OnboardingLocationCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

type AdresseApiFeature = {
  properties: {
    id: string;
    label: string;
    name: string;
    type?: string;
    city?: string;
    postcode?: string;
    context?: string;
  };
  geometry: {
    coordinates: [number, number];
  };
};

type LocationSuggestion = {
  id: string;
  label: string;
  secondary: string;
  lat: number;
  lon: number;
  hasStreet: boolean;
  city: string | null;
  relativeCity: string | null;
  timezone: string;
};

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

const DEFAULT_CENTER = { lat: 48.8566, lon: 2.3522 };
const MAP_DELTA = 0.18;

function buildMapEmbedSrc(lat: number, lon: number) {
  const left = lon - MAP_DELTA;
  const right = lon + MAP_DELTA;
  const top = lat + MAP_DELTA;
  const bottom = lat - MAP_DELTA;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lon}`;
}

function toLocationSuggestion(feature: AdresseApiFeature): LocationSuggestion {
  const [lon, lat] = feature.geometry.coordinates;
  const cityPart = [feature.properties.postcode, feature.properties.city].filter(Boolean).join(" ");
  const secondary = feature.properties.context ? `${cityPart} - ${feature.properties.context}` : cityPart;
  const primaryLabel = feature.properties.name?.trim();
  const label = primaryLabel && cityPart ? `${primaryLabel}, ${cityPart}` : feature.properties.label;
  const lowerName = (feature.properties.name ?? "").toLowerCase();
  const hasStreetKeyword = /(rue|avenue|av\.|boulevard|bd\.|chemin|allee|all[ée]e|impasse|place|route|quai|villa|passage)\b/.test(lowerName);
  const hasStreet = feature.properties.type === "housenumber" || feature.properties.type === "street" || hasStreetKeyword;
  const postcode = feature.properties.postcode ?? "";
  const city = feature.properties.city ?? null;

  const formatArrondissementLabel = (cityLabel: string, arrondissement: number) => {
    const ordinal = arrondissement === 1 ? "1er" : `${arrondissement}e`;
    return `${cityLabel} ${ordinal} arrondissement`;
  };

  let relativeCity: string | null = city;
  if (city) {
    if (/^Paris$/i.test(city) && /^750(0[1-9]|1[0-9]|20)$/.test(postcode)) {
      relativeCity = formatArrondissementLabel("Paris", Number(postcode.slice(3)));
    } else if (/^Lyon$/i.test(city) && /^6900[1-9]$/.test(postcode)) {
      relativeCity = formatArrondissementLabel("Lyon", Number(postcode.slice(3)));
    } else if (/^Marseille$/i.test(city) && /^130(0[1-9]|1[0-6])$/.test(postcode)) {
      relativeCity = formatArrondissementLabel("Marseille", Number(postcode.slice(3)));
    }
  }

  return {
    id: feature.properties.id,
    label,
    secondary,
    lat,
    lon,
    hasStreet,
    city,
    relativeCity,
    timezone: "Europe/Paris",
  };
}

export function OnboardingLocationCore({ formId, onCanContinueChange }: OnboardingLocationCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const rpcUntyped = async (fn: string, args?: Record<string, unknown>) =>
    (supabase.rpc as unknown as (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data?: unknown; error?: { message?: string } | null } | undefined>)(fn, args);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [selectedSuggestion, setSelectedSuggestion] = useState<LocationSuggestion | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { isSubmitting },
  } = useForm<LocationFormValues>({
    mode: "onChange",
    defaultValues: { location: "" },
  });

  const locationValue = watch("location", "");
  const isSelectedLocationValid =
    selectedSuggestion !== null &&
    selectedSuggestion.hasStreet &&
    locationValue.trim() === selectedSuggestion.label &&
    locationValue.includes(",");
  const canContinue = isSelectedLocationValid && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  useEffect(() => {
    const query = locationValue.trim();
    if (query.length < 3) {
      setSuggestions([]);
      setActiveSuggestionIndex(-1);
      setIsLoadingSuggestions(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsLoadingSuggestions(true);
      try {
        const response = await fetch(
          `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=7&autocomplete=1`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          setSuggestions([]);
          setActiveSuggestionIndex(-1);
          return;
        }

        const data = (await response.json()) as { features?: AdresseApiFeature[] };
        const nextSuggestions = (data.features ?? []).map(toLocationSuggestion);
        setSuggestions(nextSuggestions);
        setActiveSuggestionIndex(nextSuggestions.length > 0 ? 0 : -1);
      } catch {
        setSuggestions([]);
        setActiveSuggestionIndex(-1);
      } finally {
        setIsLoadingSuggestions(false);
      }
    }, 240);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [locationValue]);

  const onSubmit = handleSubmit(async ({ location }) => {
    setErrorMessage(null);
    const normalizedLocation = location.trim();
    if (!isSelectedLocationValid) {
      setErrorMessage("Sélectionne une adresse complète (rue + ville) dans la liste.");
      return;
    }

    const locationResult = await rpcUntyped("set_user_location", {
      p_adress: selectedSuggestion?.label ?? normalizedLocation,
      p_timezone: selectedSuggestion?.timezone ?? "Europe/Paris",
      p_relative_city: selectedSuggestion?.relativeCity ?? selectedSuggestion?.city ?? null,
      p_request_id: crypto.randomUUID(),
    });
    if (locationResult?.error) {
      setErrorMessage(locationResult.error.message ?? "Impossible d'enregistrer ton adresse.");
      return;
    }

    const { error: profileError } = await supabase.rpc("update_user_profile_public", {
      p_profile_json: {
        profile_data: {
          location: {
            label: selectedSuggestion?.label ?? normalizedLocation,
            lat: selectedSuggestion?.lat ?? null,
            lon: selectedSuggestion?.lon ?? null,
            timezone: selectedSuggestion?.timezone ?? "Europe/Paris",
          },
        },
      },
      p_request_id: crypto.randomUUID(),
    });
    if (profileError) {
      setErrorMessage(profileError.message);
      return;
    }

    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/profile",
      p_progress_json: { checkpoint: "/onboarding/location" },
      p_request_id: crypto.randomUUID(),
    });
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/profile");
  });

  const handleLocateMe = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setMapCenter({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
      () => {
        setErrorMessage("Impossible de récupérer ta position actuelle.");
      },
      { enableHighAccuracy: true, timeout: 7000 },
    );
  };

  const selectSuggestion = (suggestion: LocationSuggestion) => {
    setValue("location", suggestion.label, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    setMapCenter({ lat: suggestion.lat, lon: suggestion.lon });
    setShowSuggestions(false);
    setActiveSuggestionIndex(-1);
    setSelectedSuggestion(suggestion);
  };

  const locationRegistration = register("location");

  return (
    <div className="mt-8 w-full">
      <p className={cn(montserrat.className, "mb-5 text-[clamp(14px,2.9vw,18px)] leading-[1.25] text-zinc-500")}>
        Seul le nom du quartier apparaîtra sur ton profil.
      </p>

      <div className="relative mb-6 aspect-square w-full overflow-hidden rounded-sm border border-zinc-200 bg-zinc-100">
        <iframe
          title="Carte de localisation"
          src={buildMapEmbedSrc(mapCenter.lat, mapCenter.lon)}
          className="h-full w-full"
          loading="lazy"
        />

        <button
          type="button"
          onClick={handleLocateMe}
          className="absolute right-4 top-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-white shadow"
          aria-label="Centrer la carte"
        >
          <Crosshair size={22} />
        </button>

      </div>

      <form id={formId} onSubmit={onSubmit} noValidate>
        <div className="relative">
          <Input
            id="location"
            type="text"
            autoComplete="address-level2"
            placeholder="Saisis ton adresse, ton quartier ou ta ville..."
            className={cn(
              montserrat.className,
              themeClassNames.onboarding.textes.champPrincipalBase,
              "text-[clamp(14px,2.8vw,24px)] font-medium placeholder:text-zinc-500",
              "border-zinc-900 text-zinc-900 focus:border-zinc-900",
            )}
            {...locationRegistration}
            onFocus={() => setShowSuggestions(true)}
            onBlur={(event) => {
              locationRegistration.onBlur(event);
              window.setTimeout(() => setShowSuggestions(false), 120);
            }}
            onChange={(event) => {
              locationRegistration.onChange(event);
              setShowSuggestions(true);
              setActiveSuggestionIndex(-1);
              setSelectedSuggestion(null);
            }}
            onKeyDown={(event) => {
              if (!showSuggestions || suggestions.length === 0) return;

              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveSuggestionIndex((prev) => {
                  if (prev < 0) return 0;
                  return Math.min(prev + 1, suggestions.length - 1);
                });
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveSuggestionIndex((prev) => {
                  if (prev <= 0) return 0;
                  return prev - 1;
                });
                return;
              }

              if (event.key === "Enter" && activeSuggestionIndex >= 0 && activeSuggestionIndex < suggestions.length) {
                event.preventDefault();
                selectSuggestion(suggestions[activeSuggestionIndex]);
              }
            }}
          />

          {showSuggestions && (isLoadingSuggestions || suggestions.length > 0) ? (
            <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
              {isLoadingSuggestions ? (
                <p className="px-4 py-3 text-[14px] text-zinc-500">Recherche d&apos;adresses...</p>
              ) : (
                suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    className={cn(
                      "block w-full border-b border-zinc-100 px-4 py-3 text-left leading-[1.25] text-zinc-800 last:border-b-0",
                      index === activeSuggestionIndex ? "bg-zinc-100" : "hover:bg-zinc-50",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectSuggestion(suggestion);
                    }}
                  >
                    <p className="text-[14px] font-medium">{suggestion.label}</p>
                    {suggestion.secondary ? <p className="mt-1 text-[12px] text-zinc-500">{suggestion.secondary}</p> : null}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      </form>

      {errorMessage ? <p className="mt-3 text-[clamp(12px,4.2vw,18px)] text-[#E44D3E]">{errorMessage}</p> : null}
    </div>
  );
}
