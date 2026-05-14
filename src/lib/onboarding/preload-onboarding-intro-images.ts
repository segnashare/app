/**
 * Précharge et décode les visuels intro onboarding pour éviter le flash gris
 * (background-image) avant affichage.
 */
export async function preloadOnboardingIntroCollageUrls(urls: string[]): Promise<void> {
  await Promise.all(
    urls.map(
      (href) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            void (async () => {
              try {
                if (typeof img.decode === "function") await img.decode();
              } catch {
                /* ignore */
              }
              resolve();
            })();
          };
          img.onerror = () => resolve();
          img.src = href;
        }),
    ),
  );
}
