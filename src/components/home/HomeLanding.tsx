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

const featureHeading = `${montserrat.className} text-[clamp(18px,11.5vw,24px)] font-semibold leading-[0.98] tracking-[-0.035em] text-zinc-900 md:text-[22px]`;
const featureBody = `${montserrat.className} mt-1.5 text-[clamp(14px,4.5vw,18px)] font-medium leading-snug tracking-[-0.02em] text-zinc-700 md:mt-2 md:text-[16px] md:leading-relaxed`;

export function HomeLanding() {
  return (
    <main className="flex min-h-[100dvh] justify-center bg-[#f7f7f7] md:items-center md:py-12 lg:py-16">
      <div className="flex min-h-[100dvh] w-full max-w-[430px] flex-col px-5 pb-10 pt-8 md:min-h-0 md:max-w-[720px] md:px-10 md:pb-12 md:pt-10 lg:max-w-[800px] lg:px-14">
        <h1
          className={`${playfairDisplay.className} text-center text-[clamp(72px,19vw,98px)] leading-[0.9] tracking-[-0.025em] text-zinc-950 md:text-[clamp(80px,12vw,104px)]`}
        >
          Segna
        </h1>

        <section className="mt-10 flex justify-center md:mt-8">
          <Image
            src="/home/tryptique.png"
            alt="Triptyque looks"
            width={300}
            height={174}
            className="h-auto w-full max-w-[300px] md:max-w-[min(360px,100%)]"
            priority
          />
        </section>

        <section className="mt-10 space-y-5 px-2 text-center md:mt-12 md:grid md:grid-cols-2 md:gap-x-10 md:gap-y-9 md:space-y-0 md:px-0 md:text-left lg:gap-x-14 lg:gap-y-10">
          <article>
            <h2 className={featureHeading}>Plus de pièces</h2>
            <p className={featureBody}>Pioche chaque mois dans des milliers de pièces sans les acheter.</p>
          </article>
          <article>
            <h2 className={featureHeading}>Dressing premium vérifié</h2>
            <p className={featureBody}>
              Accède à une sélection de pièces rares, choisies et contrôlées pour leur style et leur qualité.
            </p>
          </article>
          <article>
            <h2 className={featureHeading}>L&apos;échange sans prise de tête</h2>
            <p className={featureBody}>Segna transforme le prêt entre copines en service clé en main.</p>
          </article>
          <article>
            <h2 className={featureHeading}>Communauté Segna</h2>
            <p className={featureBody}>Vote pour tes coups de cœur, recommande des pièces et débloque des avantages exclusifs.</p>
          </article>
        </section>

        <section className="mt-auto flex flex-col items-center gap-5 pt-10 md:mt-12 md:pt-0">
          <Link
            href="/auth/start?intent=start"
            className={`${montserrat.className} inline-flex h-[52px] w-[min(210px,100%)] max-w-full items-center justify-center rounded-full bg-gradient-to-b from-[#5E3023] to-[#895737] px-8 text-[clamp(16px,10vw,20px)] font-semibold leading-none tracking-[-0.03em] text-white md:h-14 md:w-auto md:min-w-[220px] md:text-[18px]`}
          >
            Commencer
          </Link>
          <Link
            href="/auth/start?intent=member"
            className={`${montserrat.className} text-[clamp(16px,8vw,20px)] font-semibold leading-none tracking-[-0.02em] text-[#8B6A54] md:text-[17px]`}
          >
            Je suis membre
          </Link>
        </section>
      </div>
    </main>
  );
}
