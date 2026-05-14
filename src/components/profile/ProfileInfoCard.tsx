"use client";

import { Fragment, type ReactNode } from "react";
import { Briefcase, MapPin, Repeat2, Star } from "lucide-react";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;

import {
  instagramWebProfileUrl,
  normalizeInstagramHandleInput,
  normalizePinterestHandleInput,
  normalizeThreadsHandleInput,
  normalizeTiktokHandleInput,
  pinterestWebProfileUrl,
  threadsWebProfileUrl,
  tiktokWebProfileUrl,
} from "@/lib/profile/social-handles";
import { cn } from "@/lib/utils/cn";



const INSTAGRAM_ICON_PATH = "/ressources/icons/instagram.svg";

export type ProfileInfoCardData = {
  age: string | null;
  ratingValue?: string | number | null;
  ratingCount?: number;
  ratingStars?: number;
  levelIcon?: string | null;
  levelNumber?: number;
  exchangeCount?: number;
  city: string | null;
  profession: string | null;
  socialSectionVisible?: boolean;
  instagramHandle: string | null;
  tiktokHandle?: string | null;
  pinterestHandle?: string | null;
  threadsHandle?: string | null;
  /** Résumé « IG @… · TikTok @… » pour la zone infos (sous la profession). */
  reseauxSummary?: string | null;
  displayName: string | null;
};

type ProfileInfoCardProps = {
  data: ProfileInfoCardData;
  className?: string;
};

const CAKE_ICON_PATH = "/ressources/icons/cake.svg";

export function ProfileInfoCard({ data, className }: ProfileInfoCardProps) {
  const scrollItems: Array<{ key: string; content: ReactNode }> = [];

  if (data.age) {
    scrollItems.push({
      key: "age",
      content: (
        <span className={cn(montserrat.className, "flex items-center gap-2 font-bold text-zinc-900")}>
          <img src={CAKE_ICON_PATH} alt="" className="h-5 w-5 shrink-0" aria-hidden />
          {data.age}
        </span>
      ),
    });
  }

  const levelNum = data.levelNumber ?? 1;
  if (data.levelIcon || levelNum > 0) {
    scrollItems.push({
      key: "level",
      content: (
        <span className={cn(montserrat.className, "flex items-center gap-2 font-semibold text-zinc-900")}>
          {data.levelIcon ? <span className="text-[20px]">{data.levelIcon}</span> : null}
          <span>Niv. {levelNum}</span>
        </span>
      ),
    });
  }

  const exchangeCount = Math.max(0, Math.floor(Number(data.exchangeCount ?? 0)));
  scrollItems.push({
    key: "exchanges",
    content: (
      <span className={cn(montserrat.className, "flex items-center gap-2 font-semibold text-zinc-900")}>
        <Repeat2 className="h-5 w-5" strokeWidth={2} aria-hidden />
        <span>{exchangeCount}</span>
      </span>
    ),
  });

  return (
    <div
      className={cn(
        "w-full rounded-[10px] border border-zinc-200 bg-white p-5 shadow-sm",
        className,
      )}
    >
      {/* Ligne 1 : trois zones équilibrées sur la largeur (séparateurs entre colonnes) */}
      <div className="w-full min-w-0 pb-4">
        <div className="flex w-full items-stretch">
          {scrollItems.map((item, index) => (
            <Fragment key={item.key}>
              {index > 0 ? (
                <span className="mx-3 w-px shrink-0 self-stretch bg-zinc-200 sm:mx-4" aria-hidden />
              ) : null}
              <div className="flex min-w-0 flex-1 items-center justify-center">
                <span className="shrink-0">{item.content}</span>
              </div>
            </Fragment>
          ))}
        </div>
      </div>

      {/* Ligne 2 : profession uniquement ; les réseaux ont leur section dédiée juste dessous. */}
      {data.profession ? (
        <div className="space-y-3 border-t border-zinc-100 py-4">
          <div className="flex items-center gap-4">
            <Briefcase className="h-6 w-6 shrink-0 text-black" strokeWidth={2} />
            <span className={cn(montserrat.className, "font-semibold text-zinc-900")}>{data.profession}</span>
          </div>
        </div>
      ) : null}

      {data.city ? (
        <div className="flex items-center gap-4 border-t border-zinc-100 py-4">
          <MapPin className="h-6 w-6 shrink-0 text-black" strokeWidth={2} />
          <span className={cn(montserrat.className, "font-semibold text-zinc-900")}>{data.city}</span>
        </div>
      ) : null}

      {/* Réseaux sociaux (liens publics) */}
      {data.socialSectionVisible !== false
        ? (() => {
            const ig = normalizeInstagramHandleInput(data.instagramHandle ?? "");
            const tk = normalizeTiktokHandleInput(data.tiktokHandle ?? "");
            const pin = normalizePinterestHandleInput(data.pinterestHandle ?? "");
            const th = normalizeThreadsHandleInput(data.threadsHandle ?? "");
            const rows: Array<{ key: string; icon: ReactNode; label: string; href: string }> = [];
            if (ig) {
              rows.push({
                key: "ig",
                icon: <img src={INSTAGRAM_ICON_PATH} alt="" className="h-6 w-6 shrink-0" aria-hidden />,
                label: `@${ig}`,
                href: instagramWebProfileUrl(ig),
              });
            }
            if (tk) {
              rows.push({
                key: "tk",
                icon: (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-[10px] font-bold text-white" aria-hidden>
                    TT
                  </span>
                ),
                label: `@${tk}`,
                href: tiktokWebProfileUrl(tk),
              });
            }
            if (pin) {
              rows.push({
                key: "pin",
                icon: (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#E60023] text-[10px] font-bold text-white" aria-hidden>
                    P
                  </span>
                ),
                label: `@${pin}`,
                href: pinterestWebProfileUrl(pin),
              });
            }
            if (th) {
              rows.push({
                key: "th",
                icon: (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-[10px] font-bold text-white" aria-hidden>
                    @
                  </span>
                ),
                label: `@${th}`,
                href: threadsWebProfileUrl(th),
              });
            }
            if (rows.length === 0) return null;
            return (
              <div className="divide-y divide-zinc-100 border-t border-zinc-100">
                {rows.map((row) => (
                  <div key={row.key} className="flex items-center gap-4 py-3 first:pt-4 last:pb-2">
                    {row.icon}
                    <a
                      href={row.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        montserrat.className,
                        "min-w-0 truncate font-semibold text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-600",
                      )}
                    >
                      {row.label}
                    </a>
                  </div>
                ))}
              </div>
            );
          })()
        : null}
      {data.ratingValue != null && String(data.ratingValue).trim() !== "" && Math.max(0, Math.floor(Number(data.ratingCount ?? 0))) > 0 ? (
        <div className="flex items-center gap-4 border-t border-zinc-100 py-4">
          <Star className="h-6 w-6 shrink-0 fill-zinc-900 text-zinc-900" strokeWidth={2} />
          <span className={cn(montserrat.className, "font-semibold text-zinc-900")}>
            {String(data.ratingValue)}/5 · {Math.max(0, Math.floor(Number(data.ratingCount ?? 0)))}{" "}
            {Math.max(0, Math.floor(Number(data.ratingCount ?? 0))) > 1 ? "notes" : "note"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
