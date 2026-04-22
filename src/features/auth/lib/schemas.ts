import { z } from "zod";

export const emailSchema = z.object({
  email: z.email("Adresse e-mail invalide."),
});

export const signInSchema = z.object({
  email: z.email("Adresse e-mail invalide."),
  password: z.string().min(1, "Mot de passe requis"),
});

/** Inscription mot de passe seul (pas de confirmation). */
export const signUpPasswordSchema = z.object({
  password: z.string().min(8, "8 caractères minimum"),
});

export const passwordSchema = z
  .object({
    password: z.string().min(8, "8 caractères minimum"),
    confirmPassword: z.string().min(1, "Confirme le mot de passe"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirmPassword"],
  });

export const otpSchema = z.object({
  code: z
    .string()
    .regex(/^\d{8}$/, "Le code doit contenir 8 chiffres"),
});

/** SMS / téléphone onboarding (6 chiffres). */
export const otpPhoneSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Le code doit contenir 6 chiffres."),
});
