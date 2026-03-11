"use client";

import { Montserrat, Playfair_Display } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppViewport } from "@/components/layout/AppViewport";
import { OnboardingStepTracker } from "@/components/onboarding/OnboardingStepTracker";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "700",
});

export default function OnboardingWelcomePage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [isContinuing, setIsContinuing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const url = window.location.href;
    window.history.replaceState({ noBack: true }, "", url);
    window.history.pushState({ noBack: true }, "", url);
    const blockBack = () => {
      window.history.go(1);
    };
    window.addEventListener("popstate", blockBack);
    return () => {
      window.removeEventListener("popstate", blockBack);
    };
  }, []);

  const handleContinue = async () => {
    if (isContinuing) return;
    setErrorMessage(null);
    setIsContinuing(true);
    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/phone",
      p_progress_json: { checkpoint: "/onboarding/welcome" },
      p_request_id: crypto.randomUUID(),
    });
    setIsContinuing(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    router.replace("/onboarding/phone");
  };

  return (
    <AppViewport className="bg-[#f9f9f8] px-0 py-0 md:w-[466px] md:!max-w-[466px] md:py-0">
      <OnboardingStepTracker currentStep="/onboarding/welcome" />
      <section className="px-6 pt-[clamp(2.75rem,10vh,7rem)] md:px-8 md:pt-30">
        <h1 className={`${playfairDisplay.className} w-[600px] max-w-full font-extrabold leading-[1.04] tracking-[-0.03em] text-zinc-950 min-[200px]:text-[38px]`}>
          Ton style est unique.
          <br />
          Ton profil doit l&apos;être aussi.
        </h1>
      </section>

      <section className="pointer-events-none flex flex-1 flex-col justify-center px-7 translate-y-[clamp(0.5rem,5vh,5.5rem)] md:px-8" aria-hidden>
        <img src="/ressources/Alerte_oeil.png" alt="" className="mx-auto w-[82%] max-w-[430px]" />
        <div className="mx-auto mt-8 h-px w-[58%] max-w-[250px] bg-zinc-900/80" />
        <img src="/ressources/barres/support.png" alt="" className="mx-auto w-[58%] max-w-[250px]" />
      </section>

      <button
        type="button"
        onClick={handleContinue}
        disabled={isContinuing}
        className="relative z-10 mt-auto h-[132px] w-full bg-gradient-to-b from-[#5E3023] to-[#895737] px-7 pb-8 pt-8 text-center disabled:opacity-80 md:mx-auto md:h-[140px] md:w-[423px] md:px-8"
      >
        <p className={`${montserrat.className} text-[23px] font-bold leading-[1.15] text-white`}>Entre tes informations de base</p>
      </button>

      {errorMessage ? <p className="px-7 pt-3 text-[18px] text-[#E44D3E] md:px-8">{errorMessage}</p> : null}
    </AppViewport>
  );
}
