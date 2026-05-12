"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AtSign } from "lucide-react";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;

import { persistProfileCompletionScore } from "@/lib/profile/profile-completion-score";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  isValidInstagramHandle,
  isValidPinterestHandle,
  isValidThreadsHandle,
  isValidTiktokHandle,
  normalizeInstagramHandleInput,
  normalizePinterestHandleInput,
  normalizeThreadsHandleInput,
  normalizeTiktokHandleInput,
  readSocialHandlesFromProfileData,
} from "@/lib/profile/social-handles";
import { cn } from "@/lib/utils/cn";

type FieldErrors = Partial<Record<"instagram" | "tiktok" | "pinterest" | "threads", string>>;

/** Même clé que `ProfileTabs` / `ProfileKycCore` pour forcer un rechargement du score après sauvegarde. */
const PROFILE_HEADER_CACHE_KEY = "segna:profile:header:v3";

function SocialNetworkIcon({ id }: { id: keyof FieldErrors }) {
  const cls = "h-5 w-5 shrink-0 text-zinc-900";
  switch (id) {
    case "instagram":
      return (
        <svg className={cls} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 3.708.63c-.79.3-1.459.705-2.126 1.38C.935 3.353.333 4.805 0 7.333c-.06.945-.07 1.283-.07 3.834 0 2.55.01 2.89.07 3.834.333 2.528.935 3.98 1.582 4.323.66.675 1.336 1.093 2.126 1.38.935.306 1.617.42 3.708.63 1.305.015 1.67.02 4.947.02 3.28 0 3.644-.006 4.947-.02 2.09-.21 2.77-.324 3.708-.63.79-.287 1.46-.705 2.126-1.38.63-.638 1.353-1.643 1.598-3.31.064-.45.077-.675.085-3.845.008-2.17 0-2.593-.015-3.834-.06-2.278-.262-3.98-.63-4.89-.318-.79-.73-1.48-1.38-2.126C20.605 1.353 19.095.93 16.478.63c-.84-.12-1.623-.195-3.708-.21-.36-.003-1.203-.01-1.71 0zm0 5.465a6.535 6.535 0 1 1 0 13.07 6.535 6.535 0 0 1 0-13.07zm0 10.75a4.215 4.215 0 1 0 0-8.43 4.215 4.215 0 0 0 0 8.43zm6.406-11.845a1.525 1.525 0 1 1-3.05 0 1.525 1.525 0 0 1 3.05 0z"
          />
        </svg>
      );
    case "tiktok":
      return (
        <svg className={cls} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"
          />
        </svg>
      );
    case "pinterest":
      return (
        <svg className={cls} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.698-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.378l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592 0 11.985 0h.032z"
          />
        </svg>
      );
    case "threads":
      return <AtSign className={cls} strokeWidth={2.25} aria-hidden />;
    default:
      return null;
  }
}

export function ProfileReseauxClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient() as any, []);
  const returnPath = searchParams.get("returnPath") ?? "/profile/complete?tab=me";

  const [instagram, setInstagram] = useState("");
  const [tiktok, setTiktok] = useState("");
  const [pinterest, setPinterest] = useState("");
  const [threads, setThreads] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      setErrorMessage(null);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setIsLoading(false);
        return;
      }
      const { data: row, error } = await supabase.from("user_profiles").select("profile_data").eq("user_id", user.id).maybeSingle();
      if (error || !row) {
        if (!cancelled) {
          setErrorMessage(error?.message ?? "Profil introuvable.");
          setIsLoading(false);
        }
        return;
      }
      const profileData = ((row as { profile_data?: Record<string, unknown> }).profile_data ?? {}) as Record<string, unknown>;
      const h = readSocialHandlesFromProfileData(profileData);
      if (!cancelled) {
        setInstagram(h.instagram);
        setTiktok(h.tiktok);
        setPinterest(h.pinterest);
        setThreads(h.threads);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const validate = (): boolean => {
    const next: FieldErrors = {};
    const ig = normalizeInstagramHandleInput(instagram);
    const tk = normalizeTiktokHandleInput(tiktok);
    const pin = normalizePinterestHandleInput(pinterest);
    const th = normalizeThreadsHandleInput(threads);
    if (ig && !isValidInstagramHandle(ig)) next.instagram = "Pseudo Instagram invalide.";
    if (tk && !isValidTiktokHandle(tk)) next.tiktok = "Pseudo TikTok invalide.";
    if (pin && !isValidPinterestHandle(pin)) next.pinterest = "Pseudo Pinterest invalide.";
    if (th && !isValidThreadsHandle(th)) next.threads = "Pseudo Threads invalide.";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSave = async () => {
    setErrorMessage(null);
    if (!validate()) return;
    setIsSaving(true);
    try {
      const ig = normalizeInstagramHandleInput(instagram) || null;
      const tk = normalizeTiktokHandleInput(tiktok) || null;
      const pin = normalizePinterestHandleInput(pinterest) || null;
      const th = normalizeThreadsHandleInput(threads) || null;
      const { error } = await supabase.rpc("update_user_profile_public", {
        p_profile_json: {
          profile_data: {
            instagram_username: ig,
            tiktok_username: tk,
            pinterest_username: pin,
            threads_username: th,
          },
        },
        p_request_id: crypto.randomUUID(),
      });
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      await persistProfileCompletionScore(supabase);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(PROFILE_HEADER_CACHE_KEY);
      }
      router.refresh();
      router.push(returnPath);
    } finally {
      setIsSaving(false);
    }
  };

  const field = (opts: { id: keyof FieldErrors; label: string; placeholder: string; value: string; onChange: (v: string) => void }) => (
    <div className="space-y-2">
      <label htmlFor={opts.id} className={cn(montserrat.className, "flex items-center gap-2.5 text-[15px] font-semibold text-zinc-900")}>
        <SocialNetworkIcon id={opts.id} />
        <span>{opts.label}</span>
      </label>
      <input
        id={opts.id}
        type="text"
        inputMode="text"
        autoComplete="off"
        placeholder={opts.placeholder}
        value={opts.value}
        onChange={(e) => {
          opts.onChange(e.target.value);
          setFieldErrors((prev) => ({ ...prev, [opts.id]: undefined }));
        }}
        className={cn(
          montserrat.className,
          "h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none ring-zinc-900 focus-visible:ring-2",
        )}
      />
      {fieldErrors[opts.id] ? <p className="text-xs text-[#E44D3E]">{fieldErrors[opts.id]}</p> : null}
    </div>
  );

  return (
    <main className="min-h-[100dvh] bg-white">
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 px-5 pb-4 pt-7">
        <button type="button" className={cn(montserrat.className, "text-[18px] font-semibold text-zinc-900")} onClick={() => router.push(returnPath)}>
          Annuler
        </button>
        <h1 className={cn(montserrat.className, "text-center text-[22px] font-bold leading-none text-zinc-900")}>Réseaux</h1>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={isSaving || isLoading}
          className={cn(montserrat.className, "text-[18px] font-semibold text-zinc-900 disabled:opacity-40")}
        >
          {isSaving ? "..." : "Terminé"}
        </button>
      </header>

      <section className="mx-auto w-full max-w-[460px] space-y-6 px-5 pb-10 pt-4">
        {isLoading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <div
              aria-label="Chargement"
              className="h-12 w-12 animate-spin rounded-full border-[4px] border-zinc-200 border-t-zinc-900 border-r-zinc-900"
            />
          </div>
        ) : (
          <>
            {field({
              id: "instagram",
              label: "Instagram",
              placeholder: "ex. segna_officiel",
              value: instagram,
              onChange: setInstagram,
            })}

            {field({
              id: "tiktok",
              label: "TikTok",
              placeholder: "ex. segna",
              value: tiktok,
              onChange: setTiktok,
            })}

            {field({
              id: "pinterest",
              label: "Pinterest",
              placeholder: "ex. monpseudo",
              value: pinterest,
              onChange: setPinterest,
            })}

            {field({
              id: "threads",
              label: "Threads",
              placeholder: "ex. segna",
              value: threads,
              onChange: setThreads,
            })}

            {errorMessage ? <p className={cn(montserrat.className, "text-sm text-[#E44D3E]")}>{errorMessage}</p> : null}
          </>
        )}
      </section>
    </main>
  );
}
