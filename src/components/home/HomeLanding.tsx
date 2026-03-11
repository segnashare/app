import Link from "next/link";
import Image from "next/image";
import { Montserrat, Playfair_Display } from "next/font/google";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export function HomeLanding() {
  return (
    <main className="flex min-h-[100dvh] justify-center bg-[#f7f7f7]">
      <div className="flex min-h-[100dvh] w-full max-w-[430px] flex-col px-5 pb-10 pt-8">
        <h1 className={`${playfairDisplay.className} text-center text-[clamp(72px,19vw,98px)] leading-[0.9] tracking-[-0.025em] text-zinc-950`}>Segna</h1>

        <section className="mt-12 flex justify-center">
          <Image src="/home/tryptique.png" alt="Triptyque looks" width={300} height={174} className="h-auto w-full max-w-[300px]" priority />
        </section>

        <section className="mt-12 space-y-5 px-2 text-center">
          <article>
            <h2 className={`${montserrat.className} text-[clamp(18px,11.5vw,24px)] font-semibold leading-[0.98] tracking-[-0.035em] text-zinc-900`}>Plus de pièces</h2>
            <p className={`${montserrat.className} mt-1 text-[clamp(14px,4.5vw,18px)] font-medium leading-[1.05] tracking-[-0.02em] text-zinc-700`}>Pioche chaque mois dans des milliers de pièces sans les acheter.</p>
          </article>
          <article>
            <h2 className={`${montserrat.className} text-[clamp(18px,11.5vw,24px)] font-semibold leading-[0.98] tracking-[-0.035em] text-zinc-900`}>Dressing premium vérifié</h2>
            <p className={`${montserrat.className} mt-1 text-[clamp(14px,4.5vw,18px)] font-medium leading-[1.05] tracking-[-0.02em] text-zinc-700`}>
              Accède à une sélection de pièces rares, choisies et contrôlées pour leur style et leur qualité.
            </p>
          </article>
          <article>
            <h2 className={`${montserrat.className} text-[clamp(18px,11.5vw,24px)] font-semibold leading-[0.98] tracking-[-0.035em] text-zinc-900`}>L&apos;échange sans prise de tête</h2>
            <p className={`${montserrat.className} mt-1 text-[clamp(14px,4.5vw,18px)] font-medium leading-[1.05] tracking-[-0.02em] text-zinc-700`}>Segna transforme le prêt entre copines en service clé en main.</p>
          </article>
          <article>
            <h2 className={`${montserrat.className} text-[clamp(18px,11.5vw,24px)] font-semibold leading-[0.98] tracking-[-0.035em] text-zinc-900`}>Communauté Segna</h2>
            <p className={`${montserrat.className} mt-1 text-[clamp(14px,4.5vw,18px)] font-medium leading-[1.05] tracking-[-0.02em] text-zinc-700`}>Vote pour tes coups de cœur, recommande des pièces et débloque des avantages exclusifs.</p>
          </article>
        </section>

        <section className="mt-auto flex flex-col items-center gap-5 pt-10">
          <Link
            href="/auth/start?intent=start"
            className={`${montserrat.className} inline-flex h-[52px] w-[210px] items-center justify-center rounded-full bg-gradient-to-b from-[#5E3023] to-[#895737] text-[clamp(16px,10vw,20px)] font-semibold leading-none tracking-[-0.03em] text-white`}
          >
            Commencer
          </Link>
          <Link href="/auth/start?intent=member" className={`${montserrat.className} text-[clamp(16px,8vw,20px)] font-semibold leading-none tracking-[-0.02em] text-[#8B6A54]`}>
            Je suis membre
          </Link>
        </section>
      </div>
    </main>
  );
}
