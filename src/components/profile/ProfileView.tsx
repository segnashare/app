"use client";

import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;

import { InsightCard } from "./InsightCard";
import { ProfileInfoCard } from "./ProfileInfoCard";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { cn } from "@/lib/utils/cn";



export type ProfileViewMode = "visualisation" | "vue_etrangere";

export type ProfileViewLookSlot = {
  dataUrl: string;
  offset: { x: number; y: number };
  zoom: number;
  imageRatio: number;
};

export type ProfileViewInfoItem = {
  id: string;
  label: string;
  value: string;
  visibility: "visible" | "hidden";
};

export type ProfileViewInsight = {
  prompt: string;
  response: string;
};

export type ProfileViewLentPiece = {
  id: string;
  title: string;
  photoUrl?: string | null;
};

export type ProfileViewInfoCardData = {
  age: string | null;
  ratingValue?: string | number | null;
  ratingCount?: number;
  ratingStars?: number;
  levelIcon?: string | null;
  levelNumber?: number;
  exchangeCount?: number;
  city: string | null;
  profession: string | null;
  /** Afficher le bloc liens (respecte `info_visibility.reseaux`). */
  socialSectionVisible?: boolean;
  instagramHandle: string | null;
  tiktokHandle?: string | null;
  pinterestHandle?: string | null;
  threadsHandle?: string | null;
  /** Résumé texte des réseaux remplis (ligne « infos »). */
  reseauxSummary?: string | null;
  displayName: string | null;
};

export type ProfileViewData = {
  profilePhoto: ProfileViewLookSlot | null;
  infoCard: ProfileViewInfoCardData;
  looksSlots: Array<ProfileViewLookSlot | null>;
  infoItems: ProfileViewInfoItem[];
  insights: ProfileViewInsight[];
  lentPieces: ProfileViewLentPiece[];
  instagramUsername?: string | null;
  locationLabel?: string | null;
  statsValue?: string | null;
};

type ProfileViewProps = {
  mode: ProfileViewMode;
  data: ProfileViewData | null;
  isLoading?: boolean;
};

const LOOK_STAGE_RATIO = 3 / 4;
const PROFILE_PHOTO_FRAME_CLASS = "aspect-[3/4]";

/** Squelette page profil (aligné chargement fiche article). */
export function ProfileViewLoadingSkeleton() {
  return (
    <div className="space-y-4 bg-white py-6">
      <div className={cn("relative mx-auto w-full max-w-[430px] overflow-hidden rounded-2xl", PROFILE_PHOTO_FRAME_CLASS)}>
        <SegnaSkeletonBlock className="absolute inset-0 h-full w-full" rounded="rounded-2xl" />
      </div>
      <div className="mx-auto w-full max-w-[430px] space-y-3 rounded-2xl border border-zinc-200 p-6 shadow-sm">
        <SegnaSkeletonBlock className="h-8 w-48" rounded="rounded-lg" />
        <SegnaSkeletonBlock className="h-4 w-full max-w-[90%]" rounded="rounded-md" />
        <SegnaSkeletonBlock className="h-4 w-full max-w-[70%]" rounded="rounded-md" />
      </div>
    </div>
  );
}

function LookImage({ slot, className }: { slot: ProfileViewLookSlot; className?: string }) {
  return (
    <RemoteCoverThumb
      photoUrl={slot.dataUrl}
      frameClassName={cn("h-full w-full", className)}
      coverStyle={{
        backgroundSize: `${Math.max(100, 100 * (slot.imageRatio / LOOK_STAGE_RATIO)) * slot.zoom}%`,
        backgroundPosition: `calc(50% + ${slot.offset.x}%) calc(50% + ${slot.offset.y}%)`,
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}

export function ProfileView({ mode: _mode, data, isLoading }: ProfileViewProps) {
  if (isLoading) {
    return <ProfileViewLoadingSkeleton />;
  }

  if (!data) {
    return (
      <div className="bg-white px-4 py-8">
        <p className={cn(montserrat.className, "text-center text-zinc-500")}>Profil introuvable.</p>
      </div>
    );
  }

  const hasInsights = data.insights.some((i) => i.prompt.trim() || i.response.trim());
  const hasLentPieces = data.lentPieces.length > 0;
  const heroPhoto = data.profilePhoto ?? data.looksSlots[0] ?? null;
  const look1AlreadyUsedAsHero = data.profilePhoto == null && data.looksSlots[0] != null;

  return (
    <div className="bg-white pb-2">
      {/* 1. Photo principale : dans l’onboarding, la première photo sert de PDP. */}
      {heroPhoto ? (
        <div className="pb-2">
          <div className={cn("relative mx-auto w-full max-w-[430px] overflow-hidden rounded-2xl", PROFILE_PHOTO_FRAME_CLASS)}>
            <LookImage slot={heroPhoto} />
          </div>
        </div>
      ) : null}

      {/* 2. Composant infos (directement après la photo) */}
      <div className="mx-auto w-full max-w-[430px] pt-2">
        <ProfileInfoCard data={data.infoCard} />
      </div>

      <div className="mx-auto w-full max-w-[430px] space-y-4 pt-4">

        {/* 4. Look 1 */}
        {data.looksSlots[0] && !look1AlreadyUsedAsHero ? (
          <div className="relative overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className={cn("relative w-full", PROFILE_PHOTO_FRAME_CLASS)}>
              <LookImage slot={data.looksSlots[0]} />
            </div>
          </div>
        ) : null}

        {/* 5. Insight 1 */}
        {data.insights[0]?.prompt.trim() || data.insights[0]?.response.trim() ? (
          <div className="relative">
            <InsightCard data={{ prompt: data.insights[0].prompt, response: data.insights[0].response }} />
          </div>
        ) : null}

        {/* 6. Look 2 */}
        {data.looksSlots[1] ? (
          <div className="relative overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className={cn("relative w-full", PROFILE_PHOTO_FRAME_CLASS)}>
              <LookImage slot={data.looksSlots[1]} />
            </div>
          </div>
        ) : null}

        {/* 7. Section pièces prêtées */}
        {hasLentPieces ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className={cn(montserrat.className, "mb-3 text-[14px] font-semibold text-zinc-500")}>Pièces prêtées</p>
            <div className="grid grid-cols-4 gap-2">
              {data.lentPieces.map((piece) => (
                <div key={piece.id} className="aspect-square overflow-hidden rounded-lg bg-zinc-200">
                  {piece.photoUrl ? (
                    <RemoteCoverThumb photoUrl={piece.photoUrl} frameClassName="h-full w-full rounded-lg" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-zinc-400">
                      <span className="text-xs">{piece.title.slice(0, 2)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* 8. Insight 2 */}
        {data.insights[1]?.prompt.trim() || data.insights[1]?.response.trim() ? (
          <div className="relative">
            <InsightCard data={{ prompt: data.insights[1].prompt, response: data.insights[1].response }} />
          </div>
        ) : null}

        {/* 9. Look 3 */}
        {data.looksSlots[2] ? (
          <div className="relative overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className={cn("relative w-full", PROFILE_PHOTO_FRAME_CLASS)}>
              <LookImage slot={data.looksSlots[2]} />
            </div>
          </div>
        ) : null}

        {/* 10. Insight 3 */}
        {data.insights[2]?.prompt.trim() || data.insights[2]?.response.trim() ? (
          <div className="relative">
            <InsightCard data={{ prompt: data.insights[2].prompt, response: data.insights[2].response }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
