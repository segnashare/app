"use client";

import Image from "next/image";
import Link from "next/link";
import { Montserrat, Playfair_Display } from "next/font/google";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils/cn";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

const benefits = [
  { title: "Plus de pièces", description: "Emprunte 10 pièces par mois avec une valeur allant jusqu'à 5000€", faded: false },
  { title: "Dressing premium vérifié", description: "Accès à une collection de pièces rares, sélectionnées et vérifiées", faded: false },
  { title: "Accès prioritaire", description: "Réserve les pièces les plus demandées avant les autres.", faded: false },
  { title: "Logistique simplifiée", description: "Échange tes paniers dans le point relais le plus proche", faded: false },
  { title: "Communauté Segna", description: "Vote. Recommande. Échange. Cumule des points et débloque des avantages.", faded: false },
];

const rotatingBrands = ["MiuMiu", "Jacquemus", "Sézane", "Isabel Marant", "Alaïa"];

export default function OnboardingSubscriptionPage() {
  const [brandIndex, setBrandIndex] = useState(0);
  const [flipPhase, setFlipPhase] = useState<"idle" | "out" | "inStart">("idle");
  const [isShortViewport, setIsShortViewport] = useState(false);
  const outTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setFlipPhase("out");
      outTimeoutRef.current = window.setTimeout(() => {
        setBrandIndex((prev) => (prev + 1) % rotatingBrands.length);
        setFlipPhase("inStart");
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setFlipPhase("idle"));
        });
      }, 220);
    }, 3000);
    return () => {
      window.clearInterval(intervalId);
      if (outTimeoutRef.current) window.clearTimeout(outTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const syncViewportMode = () => {
      // Compact mode for short viewports to preserve room for benefits + CTAs.
      setIsShortViewport(window.innerHeight <= 760);
    };

    syncViewportMode();
    window.addEventListener("resize", syncViewportMode);
    return () => window.removeEventListener("resize", syncViewportMode);
  }, []);

  return (
    <main className="flex min-h-[100dvh] justify-center overflow-y-auto bg-white">
      <div className={cn("flex min-h-[100dvh] w-full max-w-[430px] flex-col px-6 pb-8 md:max-w-[560px] md:px-8", isShortViewport ? "pt-4 md:pt-5" : "pt-8 md:pt-12")}>
        <header className={cn("flex flex-col items-center", isShortViewport ? "gap-4 pt-1" : "gap-[clamp(18px,4vh,56px)] pt-[clamp(6px,2vh,32px)]")}>
          <Image src="/ressources/icons/oeil_logo.svg" alt="Segna" width={58} height={58} priority />
          <h1
            className={cn(
              playfairDisplay.className,
              "w-full text-left font-extrabold tracking-[-0.02em] text-zinc-950",
              isShortViewport ? "text-[clamp(30px,3.2vw,44px)] leading-[0.92]" : "text-[clamp(38px,2.5vw,58px)] leading-[0.98]",
            )}
          >
            Nos membres portent du{" "}
            <span
              className="inline-block text-[#5E3023] transition-[transform,opacity] duration-[300ms] [transform-style:preserve-3d] [backface-visibility:hidden]"
              style={{
                transform:
                  flipPhase === "out"
                    ? "perspective(900px) rotateX(100deg)"
                    : flipPhase === "inStart"
                      ? "perspective(900px) rotateX(100deg)"
                      : "perspective(900px) rotateX(0deg)",
                opacity: flipPhase === "idle" ? 1 : 0,
              }}
            >
              {rotatingBrands[brandIndex]}
            </span>
            <br /> chaque semaine
          </h1>
        </header>

        <section className={cn("flex justify-center", isShortViewport ? "mt-4" : "mt-[clamp(16px,3.5vh,40px)]")}>
          <Image
            src="/home/tryptique.png"
            alt="Looks Segna"
            width={340}
            height={195}
            className={cn("h-auto", isShortViewport ? "w-[282px]" : "w-[340px]")}
            priority
          />
        </section>

        <section className={cn("min-h-0 flex-1", isShortViewport ? "mt-4" : "mt-[clamp(14px,3vh,42px)]")}>
          <div className={cn("h-full overflow-y-auto pr-1", isShortViewport ? "min-h-[120px] max-h-[220px]" : "min-h-[170px] max-h-[320px]")}>
            <div className="space-y-1">
              {benefits.map((benefit) => (
                <article key={benefit.title} className="min-h-[80px]">
                  <h2
                    className={cn(
                      montserrat.className,
                      "text-center text-[clamp(16px,1.6vw,24px)] font-semibold leading-[1.02] tracking-[-0.02em]",
                      benefit.faded ? "text-zinc-300" : "text-zinc-950",
                    )}
                  >
                    {benefit.title}
                  </h2>
                  <p
                    className={cn(
                      montserrat.className,
                      "mt-0.5 text-center text-[clamp(14px,3.8vw,16px)] font-medium leading-[1.02] tracking-[-0.015em]",
                      benefit.faded ? "text-zinc-300" : "text-zinc-600",
                    )}
                  >
                    {benefit.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="relative mt-4 flex flex-col items-center gap-5 pb-2 pt-2 md:mt-6">
          <div
            className="pointer-events-none absolute -top-14 left-0 right-0 z-20 h-14 bg-gradient-to-b from-transparent via-white/90 to-white"
            aria-hidden
          />
          <Link
            href="/onboarding/package"
            className={cn(
              montserrat.className,
              "inline-flex h-[58px] w-[177px] items-center justify-center rounded-full bg-gradient-to-b from-[#5E3023] to-[#895737] text-[clamp(16px,3vw,26px)] font-semibold leading-none text-white",
            )}
          >
            Découvrir
          </Link>
          <Link href="/onboarding/end" className={cn(montserrat.className, "text-[clamp(16px,2.8vw,26px)] font-semibold leading-none text-[#5E3023]")}>
            Peut-être plus tard
          </Link>
        </section>
      </div>
    </main>
  );
}
