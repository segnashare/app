"use client";

import Image from "next/image";
import Link from "next/link";
import { SquarePlus } from "lucide-react";

import { createInspirationHref } from "@/lib/community/create-inspiration-href";

export function HomePageHeader() {
  return (
    <header className="flex items-center justify-between px-3 pt-2">
      <Link href="/home" aria-label="Segna — accueil" className="inline-flex shrink-0 items-center">
        <Image src="/ressources/segna_logo.svg" alt="Segna" width={96} height={28} className="h-7 w-auto" priority />
      </Link>

      <Link
        href={createInspirationHref("/home")}
        aria-label="Nouveau look"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white shadow-sm transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
      >
        <SquarePlus className="h-5 w-5" strokeWidth={2} aria-hidden />
      </Link>
    </header>
  );
}
