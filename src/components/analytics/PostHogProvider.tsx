"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as PostHogClientProvider } from "posthog-js/react";

import { PostHogAuthTracker } from "@/components/analytics/PostHogAuthTracker";

function PostHogPageView(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) {
      return;
    }

    const query = searchParams.toString();
    const url = `${window.location.origin}${pathname}${query ? `?${query}` : ""}`;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const posthogWindow = window as Window & { __segnaPosthogLoaded?: boolean };

    if (!apiKey || posthogWindow.__segnaPosthogLoaded) {
      return;
    }

    const apiHost =
      process.env.NODE_ENV === "production"
        ? "/ingest"
        : (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com");

    posthog.init(apiKey, {
      api_host: apiHost,
      ui_host: "https://eu.posthog.com",
      capture_pageview: false,
      capture_pageleave: true,
      disable_session_recording: false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "[data-ph-mask]",
      },
      disable_surveys: true,
      debug: process.env.NODE_ENV === "development",
    });

    posthogWindow.__segnaPosthogLoaded = true;
  }, []);

  return (
    <PostHogClientProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <PostHogAuthTracker />
      {children}
    </PostHogClientProvider>
  );
}
