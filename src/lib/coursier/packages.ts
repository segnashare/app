import type { CoursierPackage } from "@/lib/coursier/types";

/** Grille standard Coursier « M » — colis moyen (mode / accessoires). */
const DEFAULT_MEDIUM_PACKAGE: Omit<CoursierPackage, "NumberOfPackage"> = {
  Name: "M",
  Weight: 5,
  Length: 40,
  Width: 30,
  Height: 30,
};

/** Colisage par défaut pour le devis checkout (1 ligne par article). */
export function buildDefaultCoursierPackages(itemCount: number): CoursierPackage[] {
  const count = Math.max(1, Math.min(99, Math.floor(itemCount) || 1));
  return [
    {
      ...DEFAULT_MEDIUM_PACKAGE,
      NumberOfPackage: count,
    },
  ];
}
