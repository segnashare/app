import type { CoursierPackage } from "@/lib/coursier/types";

/** Grille standard Coursier « S » — petit colis (mode / accessoires). */
const DEFAULT_PACKAGE: Omit<CoursierPackage, "NumberOfPackage"> = {
  Name: "S",
  Weight: 3,
  Length: 30,
  Width: 25,
  Height: 25,
};

/** Colisage par défaut pour le devis checkout (1 ligne par article). */
export function buildDefaultCoursierPackages(itemCount: number): CoursierPackage[] {
  const count = Math.max(1, Math.min(99, Math.floor(itemCount) || 1));
  return [
    {
      ...DEFAULT_PACKAGE,
      NumberOfPackage: count,
    },
  ];
}
