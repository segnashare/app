"use client";

import { Montserrat } from "next/font/google";

import { BrandsCard } from "./BrandsCard";
import { InsightCard } from "./InsightCard";
import { ProfileInfoCard } from "./ProfileInfoCard";
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

function LookImage({ slot, className }: { slot: ProfileViewLookSlot; className?: string }) {
  return (
    <div
      className={cn("h-full w-full bg-center bg-no-repeat", className)}
      style={{
        backgroundColor: "#000000",
        backgroundImage: `url(${slot.dataUrl})`,
        backgroundSize: `${Math.max(100, 100 * (slot.imageRatio / LOOK_STAGE_RATIO)) * slot.zoom}%`,
        backgroundPosition: `calc(50% + ${slot.offset.x}%) calc(50% + ${slot.offset.y}%)`,
      }}
    />
  );
}

export function ProfileView({ mode, data, isLoading }: ProfileViewProps) {
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
    <div className="min-h-full bg-white pb-6">
      {/* 1. Photo de profil */}
      <div className="pb-2">
        {data.profilePhoto ? (
          <div className="relative aspect-square w-full max-w-[430px] mx-auto overflow-hidden rounded-2xl bg-black">
            <LookImage slot={data.profilePhoto} />
          </div>
        ) : (
          <div className="mx-auto flex aspect-square w-full max-w-[430px] items-center justify-center rounded-2xl bg-zinc-200">
            <span className={cn(montserrat.className, "text-zinc-500")}>Photo de profil</span>
          </div>
        )}
      </div>

      {/* 2. Composant infos (directement après la photo) */}
      <div className="mx-auto w-full max-w-[430px] pt-2">
        <ProfileInfoCard data={data.infoCard} />
      </div>

      <div className="mx-auto w-full max-w-[430px] space-y-4 pt-4">

        {/* 4. Look 1 */}
        {data.looksSlots[0] ? (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="relative aspect-square w-full">
              <LookImage slot={data.looksSlots[0]} />
            </div>
          </div>
        ) : null}

        {/* 5. Insight 1 */}
        {data.insights[0]?.prompt.trim() || data.insights[0]?.response.trim() ? (
          <InsightCard data={{ prompt: data.insights[0].prompt, response: data.insights[0].response }} />
        ) : null}

        {/* 6. Section marques préférées */}
        {hasBrands ? (
          <BrandsCard brands={data.brands} />
        ) : null}

        {/* 7. Look 2 */}
        {data.looksSlots[1] ? (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="relative aspect-square w-full">
              <LookImage slot={data.looksSlots[1]} />
            </div>
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
          <InsightCard data={{ prompt: data.insights[1].prompt, response: data.insights[1].response }} />
        ) : null}

        {/* 10. Look 3 */}
        {data.looksSlots[2] ? (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="relative aspect-square w-full">
              <LookImage slot={data.looksSlots[2]} />
            </div>
          </div>
        ) : null}

        {/* 11. Insight 3 */}
        {data.insights[2]?.prompt.trim() || data.insights[2]?.response.trim() ? (
          <InsightCard data={{ prompt: data.insights[2].prompt, response: data.insights[2].response }} />
        ) : null}
      </div>
    </div>
  );
}
