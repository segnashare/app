"use client";

import { BadgeCheck } from "lucide-react";

import { cn } from "@/lib/utils/cn";

type ProfileIdentitySummaryProps = {
  displayName: string;
  subtitle?: string;
  kycStatus: "not_started" | "pending" | "rejected" | "verified" | "unknown";
};

export function ProfileIdentitySummary({ displayName, subtitle, kycStatus }: ProfileIdentitySummaryProps) {
  const isVerified = kycStatus === "verified";

  return (
    <div className="mt-4 flex flex-col items-center">
      <div className="flex items-center gap-1.5">
        <p className="text-[32px] font-semibold leading-none tracking-tight text-zinc-900">{displayName}</p>
        <BadgeCheck
          size={26}
          aria-label={isVerified ? "KYC verifie" : "KYC non verifie"}
          className={cn("transition-colors", isVerified ? "text-[#3B82F6]" : "text-zinc-400")}
        />
      </div>
      {subtitle ? <p className="mt-2 text-[18px] font-semibold text-zinc-700">{subtitle}</p> : null}
    </div>
  );
}
