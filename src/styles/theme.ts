// V0 minimal: uniquement les className réellement utilisés.
export const themeClassNames = {
  onboarding: {
    textes: {
      titreOnboardingPrincipal: "font-extrabold leading-[0.96] tracking-[-0.03em] text-zinc-950",
      titreOnboardingPrincipalTailleFluide: "text-[clamp(2.5rem,8vw,3rem)]",
      h1PlayfairDisplayExtraBold:
        "font-['Playfair_Display'] text-[clamp(38px,3.5vw,55px)] font-extrabold leading-[0.96] tracking-[-0.03em] text-zinc-950",
      microUpperCase: "text-center font-semibold uppercase tracking-[0] text-[clamp(10.46px,2vw,14px)] text-[#919191]",
      helperMuted: "leading-[1.25] text-zinc-400",
      helperTailleFluide: "text-[clamp(1rem,3.6vw,1.125rem)]",
      accentMarron: "font-semibold text-[#5E3023]",
      erreurFormulaire: "text-[18px] font-medium text-[#E44D3E]",
      champPrincipalBase:
        "h-auto rounded-none border-0 border-b bg-transparent px-0 pb-3 pt-0 font-semibold leading-none outline-none placeholder:text-zinc-900 focus:border-b-2",
      champPrincipalTailleFluide: "text-[clamp(2rem,7vw,2.5rem)]",
      champPrincipalNormal: "border-zinc-900 text-zinc-900 focus:border-zinc-900",
      champPrincipalErreur: "border-[#d56a61] text-[#df4e43] focus:border-[#d56a61]",
      footerVisibiliteTexteSemiBold: "text-[clamp(16px,2.6vw,20px)] font-semibold leading-none text-zinc-950",
      info: "text-[clamp(14px,2.6vw,18px)] font-medium leading-[1.2] tracking-[0.01em] text-[#AAAAAA]",
    },
    shell: {
      viewportOnboardingStandard: "justify-start bg-[#f9f9f8] px-7 py-6 md:px-8 md:py-8",
      spacerHautOnboarding: "h-1/6 min-h-[92px] shrink-0",
      rangeeIconeEtBarre:
        "flex h-[clamp(40px,5.5vh,50px)] w-full shrink-0 items-center gap-[5%] self-start",
      layoutCarreSvg: "h-[clamp(40px,5.5vh,50px)] w-[clamp(40px,5.5vh,50px)] shrink-0",
      svgRemplitCadre: "h-full w-full",
      layoutBarreLongue: "h-[clamp(40px,5.5vh,50px)] min-w-0 flex-1",
      layoutH1NeufDixieme: "mt-6 w-[90%] max-w-[90%] shrink-0",
      mainLayout: "mt-4 min-h-0 w-full flex-1",
      imageBarreStandard: "h-9 w-full max-w-[400px]",
      formulaireStackStandard: "space-y-6",
      largeurMaxDeuxTiersViewport: "max-w-[66.666vw]",
      footerDeuxFrames: "flex h-1/6 min-h-[92px] w-full shrink-0",
      footerDeuxFramesAuto: "mt-4 flex w-full shrink-0",
      footerFrameGauche: "flex min-h-0 flex-1 flex-col",
      footerFrameGaucheLayerHaut: "h-1/5 shrink-0",
      footerFrameGaucheLayerCentre: "h-3/5 min-h-0 shrink-0",
      footerFrameGaucheLayerBasVide: "h-1/5 shrink-0",
      footerLigneVisibilite: "flex h-full items-center gap-3 px-2",
      footerLigneInfo: "flex h-full items-end justify-start px-2 pb-1",
      footerInfoTroisQuarts: "w-3/4",
      footerIconeOeil: "h-[clamp(24px,3.2vw,30px)] w-[clamp(24px,3.2vw,30px)] shrink-0",
      footerFrameDroiteFleche: "flex h-full w-[62px] shrink-0 items-end justify-end pb-1",
      debugCadreFooterGauche: "rounded-sm border border-zinc-300/80",
      debugCadreFooterDroite: "rounded-sm border border-zinc-300/80",
      wrapperNextArrowBasDroite: "flex h-1/6 min-h-[92px] shrink-0 items-end justify-end pb-1",
      debugCadreViewport: "ring-1 ring-zinc-300/80",
      debugCadreSpacer: "rounded-sm border border-zinc-300/80",
      debugCadreContenu: "rounded-sm border border-zinc-300/80",
      debugCadreFooter: "rounded-sm border border-zinc-300/80",
    },
  },
} as const;

export type AppThemeClassNames = typeof themeClassNames;
