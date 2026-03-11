import Link from "next/link";
import Image from "next/image";

import styles from "@/app/home.module.css";

const brandLogos = [
  { src: "/home/logo-90.svg", width: 162, height: 35, alt: "Claudie Pierlot" },
  { src: "/home/logo-91.svg", width: 130, height: 27, alt: "Miu Miu" },
  { src: "/home/logo-92.svg", width: 150, height: 31, alt: "Alaia" },
  { src: "/home/logo-93.svg", width: 182, height: 37, alt: "Jacquemus" },
  { src: "/home/logo-94.svg", width: 183, height: 50, alt: "Ganni" },
  { src: "/home/logo-95.svg", width: 169, height: 66, alt: "Isabel Marant" },
  { src: "/home/logo-96.svg", width: 183, height: 42, alt: "Khaite" },
  { src: "/home/logo-97.svg", width: 325, height: 83, alt: "Soeur" },
];

export function HomeLanding() {
  return (
    <main className={styles.page}>
      <div className={styles.phoneCanvas}>
        <section className={styles.q1}>
          <header className={styles.header}>
            <Image src="/home/eye-icon.png" alt="Segna" width={58} height={58} className={styles.eyeIcon} priority />
            <h1 className={styles.title}>
              <span>Your new wardrobe</span>
              <br />
              <span>starts here</span>
            </h1>
          </header>
        </section>

        <section className={styles.q2}>
          <section className={styles.triptiqueSection}>
            <Image
              src="/home/tryptique.png"
              alt="Triptyque looks"
              width={354}
              height={203}
              className={styles.triptique}
              priority
            />
          </section>

          <section className={styles.logoMarqueeSection} aria-label="Marques">
            <div className={styles.logoTrack}>
              {[...brandLogos, ...brandLogos].map((logo, index) => (
                <div className={styles.logoItem} key={`${logo.src}-${index}`}>
                  <Image
                    src={logo.src}
                    alt={logo.alt}
                    width={logo.width}
                    height={logo.height}
                    className={styles.logoImage}
                  />
                </div>
              ))}
            </div>
          </section>
          <div className={styles.separator} />
        </section>

        <section className={styles.q3}>
          <section className={styles.benefitsFrame}>
            <div className={styles.benefitsScroll}>
              <article className={styles.benefitBlock}>
                <h2>Plus de pièces</h2>
                <p>Pioche chaque mois dans des milliers de pièces sans les acheter.</p>
              </article>
              <article className={styles.benefitBlock}>
                <h2>Dressing premium vérifié</h2>
                <p>
                  Accède à une sélection de pièces rares, choisies et contrôlées pour leur style et leur qualité.
                </p>
              </article>
              <article className={styles.benefitBlock}>
                <h2>L&apos;échange sans prise de tête</h2>
                <p>Segna transforme le prêt entre copines en service clé en main.</p>
              </article>
              <article className={styles.benefitBlockFaded}>
                <h2>Communauté Segna</h2>
                <p>Vote pour tes coups de cœur, recommande des pièces et débloque des avantages exclusifs.</p>
              </article>
            </div>
          </section>
        </section>

        <section className={styles.q4}>
          <section className={styles.ctaSection}>
            <div className={styles.ctaFadeOverlay} aria-hidden />
            <Link href="/auth/start?intent=start" className={styles.primaryCta}>
              Commencer
            </Link>
            <Link href="/auth/start?intent=member" className={styles.secondaryCta}>
              Je suis membre
            </Link>
          </section>
        </section>
      </div>
    </main>
  );
}
