"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AppPageLoading } from "@/components/ui/AppPageLoading";
import { preloadRemoteImages } from "@/lib/ui/preload-remote-images";

type PageImageReadyShellProps = {
  preloadUrls: string[];
  loadingLabel?: string;
  children: ReactNode;
};

function deferSetReady(setReady: (value: boolean) => void) {
  queueMicrotask(() => setReady(true));
}

/** Maintient l’écran de chargement jusqu’à ce que les visuels critiques soient prêts. */
export function PageImageReadyShell({ preloadUrls, loadingLabel, children }: PageImageReadyShellProps) {
  const urlsKey = useMemo(() => preloadUrls.filter(Boolean).join("\0"), [preloadUrls]);
  const stableUrls = useMemo(() => (urlsKey ? urlsKey.split("\0") : []), [urlsKey]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void preloadRemoteImages(stableUrls).finally(() => {
      if (cancelled) return;
      deferSetReady(setReady);
    });
    return () => {
      cancelled = true;
    };
  }, [stableUrls, urlsKey]);

  if (!ready) {
    return <AppPageLoading label={loadingLabel} />;
  }

  return children;
}
