"use client";

import { useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type UserDataSection =
  | "style"
  | "brands"
  | "motivation"
  | "experience"
  | "share"
  | "budget"
  | "dressing"
  | "ethic"
  | "privacy"
  | "looks"
  | "answers";

type VisibilityToggleEyeProps = {
  section?: UserDataSection;
  visible?: boolean;
  defaultVisible?: boolean;
  onVisibilityChange?: (nextVisible: boolean) => void;
  className?: string;
  iconClassName?: string;
  ariaLabel?: string;
};

export function VisibilityToggleEye({
  section,
  visible,
  defaultVisible = true,
  onVisibilityChange,
  className,
  iconClassName,
  ariaLabel = "Visibilite profil",
}: VisibilityToggleEyeProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const rpcUntyped = async (fn: string, args?: Record<string, unknown>) =>
    (supabase.rpc as unknown as (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data?: Record<string, unknown> | null; error?: { message: string } | null } | undefined>)(fn, args);
  const [internalVisible, setInternalVisible] = useState(defaultVisible);
  const [isUpdating, setIsUpdating] = useState(false);
  const isVisible = visible ?? internalVisible;
  const iconSrc = isVisible ? "/ressources/icons/visible.svg" : "/ressources/icons/mask.svg";
  const iconAlt = isVisible ? "Visible sur le profil" : "Masque sur le profil";

  useEffect(() => {
    if (!section || visible !== undefined) return;

    let isMounted = true;
    const loadVisibility = async () => {
      const result = await rpcUntyped("get_profile_preference_visibility");
      const data = result?.data ?? null;
      const error = result?.error ?? null;
      if (error || !isMounted || !data) return;

      const key = `${section}_visible`;
      const nextVisible = typeof data[key] === "boolean" ? data[key] : true;
      setInternalVisible(nextVisible);
    };

    void loadVisibility();
    return () => {
      isMounted = false;
    };
  }, [section, visible, rpcUntyped]);

  const handleToggle = async () => {
    if (isUpdating) return;

    const nextVisible = !isVisible;
    if (visible === undefined) {
      setInternalVisible(nextVisible);
    }
    onVisibilityChange?.(nextVisible);

    if (!section) return;

    setIsUpdating(true);
    let error: { message: string } | null = null;
    try {
      const result = await rpcUntyped("set_profile_preference_visibility", {
        p_section: section,
        p_visible: nextVisible,
        p_request_id: crypto.randomUUID(),
      });
      error = result?.error ?? null;
    } finally {
      setIsUpdating(false);
    }

    if (!error || visible !== undefined) return;

    // Rollback local optimistic state if persistence failed.
    setInternalVisible(isVisible);
    onVisibilityChange?.(isVisible);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={cn("inline-flex items-center justify-center", className)}
      aria-label={ariaLabel}
      aria-pressed={isVisible}
      disabled={isUpdating}
    >
      <img src={iconSrc} alt={iconAlt} className={iconClassName} />
    </button>
  );
}
