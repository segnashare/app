import Link from "next/link";

import { SubflowShell } from "@/components/layout/SubflowShell";
import { SettingsSignOutButton } from "@/components/profile/SettingsSignOutButton";

type ProfileSettingsPageProps = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function ProfileSettingsPage({ searchParams }: ProfileSettingsPageProps) {
  const { tab } = await searchParams;
  const safeTab = tab && ["plus", "security", "me"].includes(tab) ? tab : "plus";

  return (
    <SubflowShell>
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col bg-white px-5 py-6">
        <header className="flex items-center justify-between">
          <Link href={`/profile?tab=${safeTab}`} className="inline-flex h-10 items-center text-sm font-medium text-zinc-700 underline">
            Retour au profil
          </Link>
        </header>

        <section className="mt-8">
          <h1 className="text-3xl font-semibold text-zinc-950">Parametres</h1>
          <p className="mt-2 text-base text-zinc-600">Configure ton compte et tes preferences.</p>
        </section>

        <section className="mt-6 space-y-3">
          {["Compte", "Notifications", "Confidentialite", "Securite", "Aide"].map((item) => (
            <button
              key={item}
              type="button"
              className="flex min-h-[52px] w-full items-center justify-between rounded-2xl border border-zinc-200 bg-white px-4 text-left text-base font-medium text-zinc-900"
            >
              <span>{item}</span>
              <span aria-hidden className="text-zinc-400">
                ›
              </span>
            </button>
          ))}
        </section>

        <section className="mt-auto pt-6">
          <SettingsSignOutButton />
        </section>
      </main>
    </SubflowShell>
  );
}
