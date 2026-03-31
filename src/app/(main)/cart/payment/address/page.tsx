"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { OnboardingLocationCore } from "@/components/onboarding/OnboardingLocationCore";
import { readCheckoutDeliveryAddress } from "@/lib/cart/checkout-delivery-storage";
import { cn } from "@/lib/utils/cn";

export default function CheckoutDeliveryAddressPage() {
  const router = useRouter();
  const [canContinue, setCanContinue] = useState(false);
  const [initialLocation, setInitialLocation] = useState<
    | {
        label?: string;
        lat?: number | null;
        lon?: number | null;
        city?: string | null;
        relativeCity?: string | null;
        timezone?: string | null;
        hasStreet?: boolean;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    const a = readCheckoutDeliveryAddress();
    if (!a) return;
    setInitialLocation({
      label: a.label,
      lat: a.lat,
      lon: a.lon,
      city: a.city,
      relativeCity: a.relativeCity,
      timezone: a.timezone,
      hasStreet: true,
    });
  }, []);

  const onBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-zinc-100">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-zinc-200 bg-white px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top,0px)+8px)]">
        <div className="relative mx-auto flex h-11 max-w-[430px] items-center justify-between">
          <div className="flex w-14 shrink-0 justify-start">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-800"
              aria-label="Retour"
            >
              <ChevronLeft className="h-7 w-7" strokeWidth={2.25} aria-hidden />
            </button>
          </div>
          <h1 className="pointer-events-none absolute left-1/2 top-1/2 z-0 max-w-[min(100%,14rem)] -translate-x-1/2 -translate-y-1/2 text-center text-[17px] font-semibold text-zinc-900">
            Adresse de livraison
          </h1>
          <div className="w-14 shrink-0" aria-hidden />
        </div>
      </header>

      <div className="mx-auto w-full max-w-[430px] flex-1 bg-white px-5 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] pt-[calc(max(0.75rem,env(safe-area-inset-top,0px)+8px)+3.25rem)]">
        <OnboardingLocationCore
          formId="checkout-delivery-address-form"
          submitTarget="checkout"
          redirectPath="/cart/payment"
          initialLocation={initialLocation}
          onCanContinueChange={setCanContinue}
        />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
        <div className="mx-auto max-w-[430px]">
          <button
            type="submit"
            form="checkout-delivery-address-form"
            disabled={!canContinue}
            className={cn(
              "flex h-[52px] w-full items-center justify-center rounded-xl text-[16px] font-bold text-white shadow-sm",
              canContinue
                ? "bg-gradient-to-b from-[#5E3023] to-[#895737]"
                : "cursor-not-allowed bg-zinc-300",
            )}
            aria-label="Enregistrer l'adresse de livraison"
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
