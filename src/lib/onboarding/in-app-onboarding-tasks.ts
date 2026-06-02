import type { OnboardingProcessStatus } from "@/lib/onboarding/in-app-onboarding";
import { KYC_INCLUDED_IN_ONBOARDING } from "@/lib/kyc/kyc-policy";

/** Étapes comptées comme tâches onboarding in-app (hors intro, reward, finished). */
export const IN_APP_ONBOARDING_TASK_STATUSES = (
  KYC_INCLUDED_IN_ONBOARDING
    ? (["profile", "kyc", "panier", "offer", "exchange"] as const)
    : (["profile", "panier", "offer", "exchange"] as const)
) satisfies readonly OnboardingProcessStatus[];

export type InAppOnboardingTaskStatus = (typeof IN_APP_ONBOARDING_TASK_STATUSES)[number];

export type InAppOnboardingTaskDefinition = {
  id: InAppOnboardingTaskStatus;
  title: string;
  description: string;
  /** Destination quand la tâche est l’étape courante (clic dans la modale checklist). */
  href: string;
};

export const IN_APP_ONBOARDING_TASKS: readonly InAppOnboardingTaskDefinition[] = [
  {
    id: "profile",
    title: "Complète ton profil",
    description: "Photo et infos pour inspirer confiance aux autres membres.",
    href: "/profile/complete?tab=me",
  },
  ...(KYC_INCLUDED_IN_ONBOARDING
    ? ([
        {
          id: "kyc" as const,
          title: "Vérifie ton identité",
          description: "Sécurise ton compte et débloque tes premiers échanges.",
          href: "/profile/kyc?tab=me",
        },
      ] satisfies readonly InAppOnboardingTaskDefinition[])
    : []),
  {
    id: "panier",
    title: "Compose ton premier panier",
    description: "Ajoute des pièces au panier pour lancer ton premier échange.",
    href: "/shop",
  },
  {
    id: "offer",
    title: "Profite de tes crédits offerts",
    description: "Récupère ton cadeau de bienvenue depuis le panier.",
    href: "/package?plan=credits",
  },
  {
    id: "exchange",
    title: "Prête ta première pièce",
    description: "Fais entrer une pièce dans la collection et gagne des crédits.",
    href: "/items/new?fresh=1",
  },
] as const;

const TASK_INDEX = new Map<string, number>(
  IN_APP_ONBOARDING_TASK_STATUSES.map((id, index) => [id, index]),
);

export type InAppOnboardingTaskProgress = {
  completedCount: number;
  totalCount: number;
  currentStatus: InAppOnboardingTaskStatus;
  tasks: Array<
    InAppOnboardingTaskDefinition & {
      done: boolean;
      current: boolean;
    }
  >;
};

export function isInAppOnboardingTaskStatus(value: string | null | undefined): value is InAppOnboardingTaskStatus {
  return typeof value === "string" && TASK_INDEX.has(normalizeInAppOnboardingTaskStatus(value) ?? "");
}

/** Utilisateurs bloqués sur l’étape KYC avant désactivation : les traite comme « panier ». */
export function normalizeInAppOnboardingTaskStatus(
  process: string | null | undefined,
): InAppOnboardingTaskStatus | null {
  if (typeof process !== "string") return null;
  if (!KYC_INCLUDED_IN_ONBOARDING && process === "kyc") return "panier";
  return TASK_INDEX.has(process) ? (process as InAppOnboardingTaskStatus) : null;
}

/** Affiche le compteur flottant uniquement pendant les tâches actives (pas intro / reward / finished). */
export function shouldShowInAppOnboardingTaskFab(process: string | null | undefined): boolean {
  return normalizeInAppOnboardingTaskStatus(process) != null;
}

export function getInAppOnboardingTaskHref(taskId: InAppOnboardingTaskStatus): string {
  return IN_APP_ONBOARDING_TASKS.find((t) => t.id === taskId)?.href ?? "/shop";
}

export function getInAppOnboardingTaskProgress(
  process: string | null | undefined,
): InAppOnboardingTaskProgress | null {
  const normalized = normalizeInAppOnboardingTaskStatus(process);
  if (!normalized) return null;
  const currentIndex = TASK_INDEX.get(normalized) ?? 0;
  const totalCount = IN_APP_ONBOARDING_TASK_STATUSES.length;
  const tasks = IN_APP_ONBOARDING_TASKS.map((task, index) => ({
    ...task,
    done: index < currentIndex,
    current: index === currentIndex,
  }));
  return {
    completedCount: currentIndex,
    totalCount,
    currentStatus: normalized,
    tasks,
  };
}
