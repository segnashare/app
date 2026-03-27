"use client";

import { useState } from "react";
import { Montserrat } from "next/font/google";
import { Heart } from "lucide-react";

import { BrandsCard } from "./BrandsCard";
import { InsightCard } from "./InsightCard";
import { ProfileInfoCard } from "./ProfileInfoCard";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });

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
  ratingValue?: string | number;
  ratingStars?: number;
  levelIcon?: string | null;
  levelNumber?: number;
  smoking?: boolean;
  alcohol?: boolean;
  sport?: boolean;
  night?: boolean;
  city: string | null;
  profession: string | null;
  instagramHandle: string | null;
  displayName: string | null;
};

export type ProfileViewBrand = {
  id: string;
  label: string;
  logoUrl: string | null;
};

export type ProfileViewData = {
  profilePhoto: ProfileViewLookSlot | null;
  infoCard: ProfileViewInfoCardData;
  looksSlots: Array<ProfileViewLookSlot | null>;
  infoItems: ProfileViewInfoItem[];
  brands: ProfileViewBrand[];
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

const LOOK_STAGE_RATIO = 1;

function FrameLikeButton({
  isLiked,
  onToggle,
}: {
  isLiked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={isLiked ? "Retirer le like" : "Liker cette frame"}
      onClick={onToggle}
      className="absolute bottom-4 right-4 z-10 grid h-14 w-14 place-items-center rounded-full bg-white/95 text-zinc-900 shadow-lg ring-1 ring-zinc-200 backdrop-blur-sm transition hover:scale-[1.02] active:scale-[0.98]"
    >
      <Heart className={cn("h-7 w-7", isLiked && "fill-current")} strokeWidth={2.2} />
    </button>
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

export function ProfileView({ mode, data, isLoading }: ProfileViewProps) {
  const [likedFrames, setLikedFrames] = useState<Record<string, boolean>>({});

  function toggleFrameLike(frameId: string) {
    setLikedFrames((previous) => ({ ...previous, [frameId]: !previous[frameId] }));
  }

  if (isLoading) {
    return (
      <div className="space-y-4 bg-white py-6">
        <div className="mx-auto aspect-square w-full max-w-[430px] animate-pulse rounded-2xl bg-zinc-200" />
        <div className="mx-auto w-full max-w-[430px] animate-pulse rounded-2xl bg-zinc-200 p-6" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white px-4 py-8">
        <p className={cn(montserrat.className, "text-center text-zinc-500")}>Profil introuvable.</p>
      </div>
    );
  }

  const visibleInfoItems = data.infoItems.filter((item) => item.visibility === "visible");
  const hasInsights = data.insights.some((i) => i.prompt.trim() || i.response.trim());
  const hasBrands = data.brands.length > 0;
  const hasLentPieces = data.lentPieces.length > 0;

  return (
    <div className="bg-white pb-2">
      {/* 1. Photo de profil */}
      <div className="pb-2">
        {data.profilePhoto ? (
          <div className="relative mx-auto aspect-square w-full max-w-[430px] overflow-hidden rounded-2xl">
            <LookImage slot={data.profilePhoto} />
            {mode === "vue_etrangere" ? (
              <FrameLikeButton
                isLiked={Boolean(likedFrames.profile_photo)}
                onToggle={() => toggleFrameLike("profile_photo")}
              />
            ) : null}
          </div>
        ) : <div className="mx-auto aspect-square w-full max-w-[430px] rounded-2xl bg-zinc-100" />}
      </div>

      {/* 2. Composant infos (directement après la photo) */}
      <div className="mx-auto w-full max-w-[430px] pt-2">
        <ProfileInfoCard data={data.infoCard} />
      </div>

      <div className="mx-auto w-full max-w-[430px] space-y-4 pt-4">

        {/* 4. Look 1 */}
        {data.looksSlots[0] ? (
          <div className="relative overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="relative aspect-square w-full">
              <LookImage slot={data.looksSlots[0]} />
            </div>
            {mode === "vue_etrangere" ? (
              <FrameLikeButton
                isLiked={Boolean(likedFrames.look_1)}
                onToggle={() => toggleFrameLike("look_1")}
              />
            ) : null}
          </div>
        ) : null}

        {/* 5. Insight 1 */}
        {data.insights[0]?.prompt.trim() || data.insights[0]?.response.trim() ? (
          <div className="relative">
            <InsightCard data={{ prompt: data.insights[0].prompt, response: data.insights[0].response }} />
            {mode === "vue_etrangere" ? (
              <FrameLikeButton
                isLiked={Boolean(likedFrames.insight_1)}
                onToggle={() => toggleFrameLike("insight_1")}
              />
            ) : null}
          </div>
        ) : null}

        {/* 6. Section marques préférées */}
        {hasBrands ? (
          <BrandsCard brands={data.brands} />
        ) : null}

        {/* 7. Look 2 */}
        {data.looksSlots[1] ? (
          <div className="relative overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="relative aspect-square w-full">
              <LookImage slot={data.looksSlots[1]} />
            </div>
            {mode === "vue_etrangere" ? (
              <FrameLikeButton
                isLiked={Boolean(likedFrames.look_2)}
                onToggle={() => toggleFrameLike("look_2")}
              />
            ) : null}
          </div>
        ) : null}

        {/* 8. Section pièces prêtées */}
        {hasLentPieces ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className={cn(montserrat.className, "mb-3 text-[14px] font-semibold text-zinc-500")}>Pièces prêtées</p>
            <div className="grid grid-cols-4 gap-2">
              {data.lentPieces.map((piece) => (
                <div key={piece.id} className="aspect-square overflow-hidden rounded-lg bg-zinc-100">
                  {piece.photoUrl ? (
                    <img src={piece.photoUrl} alt={piece.title} className="h-full w-full object-cover" />
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

        {/* 9. Insight 2 */}
        {data.insights[1]?.prompt.trim() || data.insights[1]?.response.trim() ? (
          <div className="relative">
            <InsightCard data={{ prompt: data.insights[1].prompt, response: data.insights[1].response }} />
            {mode === "vue_etrangere" ? (
              <FrameLikeButton
                isLiked={Boolean(likedFrames.insight_2)}
                onToggle={() => toggleFrameLike("insight_2")}
              />
            ) : null}
          </div>
        ) : null}

        {/* 10. Look 3 */}
        {data.looksSlots[2] ? (
          <div className="relative overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="relative aspect-square w-full">
              <LookImage slot={data.looksSlots[2]} />
            </div>
            {mode === "vue_etrangere" ? (
              <FrameLikeButton
                isLiked={Boolean(likedFrames.look_3)}
                onToggle={() => toggleFrameLike("look_3")}
              />
            ) : null}
          </div>
        ) : null}

        {/* 11. Insight 3 */}
        {data.insights[2]?.prompt.trim() || data.insights[2]?.response.trim() ? (
          <div className="relative">
            <InsightCard data={{ prompt: data.insights[2].prompt, response: data.insights[2].response }} />
            {mode === "vue_etrangere" ? (
              <FrameLikeButton
                isLiked={Boolean(likedFrames.insight_3)}
                onToggle={() => toggleFrameLike("insight_3")}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
