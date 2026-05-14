"use client";

import { cn } from "@/lib/utils/cn";

const GOOGLE_REVIEW_URL = "https://g.page/r/CWChbx3Nhlj2EBI/review";

function GoogleGLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" width={20} height={20} aria-hidden>
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4c-7.682 0-14.344 4.337-17.694 10.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C39.09 35.883 44 30.564 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

type GoogleReviewCtaProps = {
  className?: string;
  /** Dans une coquille déjà bordée (ex. profil à côté de Trustpilot) : pas de double cadre. */
  variant?: "default" | "inset";
};

export function GoogleReviewCta({ className, variant = "default" }: GoogleReviewCtaProps) {
  const isInset = variant === "inset";
  return (
    <a
      href={GOOGLE_REVIEW_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Donner un avis sur Google"
      className={cn(
        "flex w-full min-w-0 items-center justify-center gap-2 font-semibold text-zinc-900 transition",
        isInset
          ? "h-full min-h-0 rounded-none border-0 bg-transparent px-1 py-0 shadow-none hover:bg-zinc-100/70 active:bg-zinc-100"
          : "h-14 rounded-xl border border-zinc-200 bg-white px-2 shadow-sm hover:border-zinc-300 hover:bg-zinc-50 sm:gap-2.5 sm:px-3",
        className,
      )}
    >
      <GoogleGLogo className="shrink-0" />
      <span className="truncate text-[13px] leading-tight tracking-tight">Donner un avis</span>
    </a>
  );
}
