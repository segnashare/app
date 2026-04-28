import { Lock } from "lucide-react";

import { CardBase } from "@/components/layout/CardBase";
import { MainContent } from "@/components/layout/MainContent";

export default function CommunityPage() {
  return (
    <MainContent>
      <div className="flex min-h-[min(520px,70dvh)] flex-col items-center justify-center px-4 py-10">
        <CardBase className="mx-auto w-full max-w-md space-y-4 px-6 py-10 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-600">
            <Lock className="h-7 w-7" strokeWidth={2} aria-hidden />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Communauté</h1>
            <p className="text-[15px] leading-relaxed text-zinc-600">
              Cette section n&apos;est pas encore accessible. Nous préparons l&apos;expérience communautaire, tu pourras la
              découvrir ici très bientôt.
            </p>
          </div>
        </CardBase>
      </div>
    </MainContent>
  );
}
