"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { revokeSessionLog } from "@/lib/supabase/userSessions";

type JsonObject = Record<string, unknown>;
type LookPreview = {
  src: string | null;
  offset: { x: number; y: number };
  zoom: number;
};

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isDirectImageUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:image/") || value.startsWith("blob:");
}

export default function AppHomePage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [profilePhotoSrc, setProfilePhotoSrc] = useState<string | null>(null);
  const [looksPreview, setLooksPreview] = useState<LookPreview[]>([
    { src: null, offset: { x: 0, y: 0 }, zoom: 1 },
    { src: null, offset: { x: 0, y: 0 }, zoom: 1 },
    { src: null, offset: { x: 0, y: 0 }, zoom: 1 },
  ]);
  const [looksImageRatios, setLooksImageRatios] = useState<number[]>([1, 1, 1]);

  useEffect(() => {
    const resolveImageSource = async (raw: string | null) => {
      if (!raw) return null;
      if (isDirectImageUrl(raw)) return raw;
      const { data, error } = await supabase.storage.from("bucket_focus").createSignedUrl(raw, 60 * 60);
      if (error) return null;
      return data?.signedUrl ?? null;
    };

    const loadPreview = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) {
        router.replace("/auth");
        return;
      }

      const { data: profileRow, error: profileError } = await supabase
        .from("user_profiles")
        .select("photos, looks")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profileError) {
        setErrorMessage(profileError.message);
        setIsLoading(false);
        return;
      }

      const photos = asObject(profileRow?.photos);
      const looks = profileRow?.looks;
      const profilePath = asString(photos?.profile_photo_path);

      const lookCandidates: LookPreview[] = [
        { src: null, offset: { x: 0, y: 0 }, zoom: 1 },
        { src: null, offset: { x: 0, y: 0 }, zoom: 1 },
        { src: null, offset: { x: 0, y: 0 }, zoom: 1 },
      ];
      if (Array.isArray(looks)) {
        looks.slice(0, 3).forEach((item, index) => {
          const itemObj = asObject(item);
          if (!itemObj) return;
          const position = asObject(itemObj.position);
          const offset = asObject(position?.offset);
          lookCandidates[index] = {
            src: asString(itemObj.storage_path) ?? asString(itemObj.url),
            offset: {
              x: asNumber(offset?.x) ?? 0,
              y: asNumber(offset?.y) ?? 0,
            },
            zoom: asNumber(position?.zoom) ?? 1,
          };
        });
      } else {
        const looksObj = asObject(looks);
        for (let index = 0; index < 3; index += 1) {
          const key = `look${index + 1}`;
          const lookObj = asObject(looksObj?.[key]);
          const position = asObject(lookObj?.position);
          const offset = asObject(position?.offset);
          lookCandidates[index] = {
            src: asString(lookObj?.storage_path) ?? asString(lookObj?.url),
            offset: {
              x: asNumber(offset?.x) ?? 0,
              y: asNumber(offset?.y) ?? 0,
            },
            zoom: asNumber(position?.zoom) ?? 1,
          };
        }
      }

      const [resolvedProfile, ...resolvedLooks] = await Promise.all([
        resolveImageSource(profilePath),
        ...lookCandidates.map((candidate) => resolveImageSource(candidate.src)),
      ]);

      setProfilePhotoSrc(resolvedProfile);
      setLooksPreview([
        { ...lookCandidates[0], src: resolvedLooks[0] ?? null },
        { ...lookCandidates[1], src: resolvedLooks[1] ?? null },
        { ...lookCandidates[2], src: resolvedLooks[2] ?? null },
      ]);
      setIsLoading(false);
    };

    void loadPreview();
  }, [router, supabase]);

  useEffect(() => {
    looksPreview.forEach((look, index) => {
      if (!look.src) {
        setLooksImageRatios((prev) => {
          const next = [...prev];
          next[index] = 1;
          return next;
        });
        return;
      }
      const image = new Image();
      image.onload = () => {
        const nextRatio = image.width > 0 && image.height > 0 ? image.width / image.height : 1;
        setLooksImageRatios((prev) => {
          const next = [...prev];
          next[index] = nextRatio;
          return next;
        });
      };
      image.onerror = () => {
        setLooksImageRatios((prev) => {
          const next = [...prev];
          next[index] = 1;
          return next;
        });
      };
      image.src = look.src;
    });
  }, [looksPreview]);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await revokeSessionLog(supabase, session).catch(() => undefined);
    await supabase.auth.signOut();
    router.replace("/auth");
  };

  return (
    <main className="flex min-h-[100dvh] justify-center bg-white p-6">
      <section className="w-full max-w-[460px] space-y-6">
        <h1 className="text-2xl font-semibold text-zinc-900">Vérification profil</h1>

        <div className="rounded-2xl border border-zinc-200 p-5">
          <p className="text-sm font-medium text-zinc-700">Photo de profil</p>
          <div className="mt-4 flex justify-center">
            <div className="h-28 w-28 overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
              {profilePhotoSrc ? (
                <img src={profilePhotoSrc} alt="Photo de profil" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">Aucune photo</div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 p-5">
          <p className="text-sm font-medium text-zinc-700">Mes 3 looks</p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {looksPreview.map((look, index) => (
              <div key={`look-${index + 1}`} className="aspect-square overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
                {look.src ? (
                  <div
                    className="h-full w-full bg-center bg-no-repeat"
                    style={{
                      backgroundColor: "#000000",
                      backgroundImage: `url(${look.src})`,
                      backgroundSize: `${Math.max(100, 100 * looksImageRatios[index]) * look.zoom}%`,
                      backgroundPosition: `calc(50% + ${look.offset.x}%) calc(50% + ${look.offset.y}%)`,
                    }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[11px] text-zinc-500">{`Look ${index + 1}`}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {isLoading ? <p className="text-sm text-zinc-500">Chargement...</p> : null}
        {errorMessage ? <p className="text-sm text-[#E44D3E]">{errorMessage}</p> : null}

        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="inline-flex h-12 items-center justify-center rounded-full border border-zinc-300 px-6 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSigningOut ? "Déconnexion..." : "Se déconnecter"}
        </button>
      </section>
    </main>
  );
}
