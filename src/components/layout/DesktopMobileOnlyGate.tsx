"use client";

import Image from "next/image";
import { Smartphone } from "lucide-react";
import QRCode from "react-qr-code";

import { resolveDesktopMobileGateAppUrl } from "@/lib/config/desktop-mobile-gate-enabled";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;
const APP_URL = resolveDesktopMobileGateAppUrl();

export function DesktopMobileOnlyGate() {
  return (
    <div
      className={cn(
        montserrat.className,
        "fixed inset-0 z-[9999] hidden flex-col items-center justify-center bg-[#f9f9f8] px-6 text-zinc-900 md:flex",
      )}
      aria-hidden={false}
      role="dialog"
      aria-labelledby="desktop-mobile-gate-title"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-8 text-center">
        <Image
          src="/ressources/segna_logo.svg"
          alt="Segna"
          width={192}
          height={48}
          priority
          className="h-16 w-auto"
        />

        <div className="flex flex-col items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-700">
            <Smartphone className="size-7" strokeWidth={1.75} aria-hidden />
          </div>
          <h1
            id="desktop-mobile-gate-title"
            className="text-[22px] font-semibold leading-snug tracking-tight text-zinc-900"
          >
            Segna est pensé pour mobile
          </h1>
          <p className="max-w-sm text-[15px] leading-relaxed text-zinc-600">
            Ouvre l’app sur ton téléphone pour continuer. Scanne le QR code ou saisis l’adresse dans
            ton navigateur mobile.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <QRCode value={APP_URL} size={168} bgColor="#ffffff" fgColor="#18181b" level="M" />
          </div>
          <a
            href={APP_URL}
            className="text-[15px] font-medium text-zinc-800 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-500"
          >
            {APP_URL.replace(/^https:\/\//, "")}
          </a>
        </div>
      </div>
    </div>
  );
}
