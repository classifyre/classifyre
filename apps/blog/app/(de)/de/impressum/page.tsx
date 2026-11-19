import type { Metadata } from "next";

import { Marker, PageHero, SectionShell } from "@/components/page-kit";

import "../../../landing.css";

export const metadata: Metadata = {
  title: "Impressum",
  description:
    "Impressum der Classifyre-Websites: Medieninhaber, Unternehmensgegenstand und Sitz gemäß § 25 Mediengesetz.",
  alternates: {
    canonical: "/de/impressum/",
    languages: {
      en: "/impressum/",
      de: "/de/impressum/",
      "x-default": "/impressum/",
    },
  },
  openGraph: {
    title: "Classifyre — Impressum",
    description: "Wer hinter den Classifyre-Websites steht.",
    type: "website",
  },
};

export default function ImpressumPageDe() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="Impressum"
        title={
          <>
            Impres
            <span className="inline-block bg-accent px-[0.12em] text-black">
              sum
            </span>
          </>
        }
        lede="Wer hinter den Classifyre-Websites steht."
      />
      <SectionShell>
        <div className="mx-auto max-w-3xl space-y-8">
          <div className="space-y-3">
            <Marker label="§ 25 MedienG" />
            <h2 className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.04em]">
              Offenlegung gemäß § 25 Abs. 5 Mediengesetz
            </h2>
          </div>
          <dl className="border-b-2 border-border text-base leading-7 text-muted-foreground">
            <div className="grid gap-1 border-t-2 border-border py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
              <dt className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">Medieninhaber</dt>
              <dd>Michael Bender</dd>
            </div>
            <div className="grid gap-1 border-t-2 border-border py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
              <dt className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">Unternehmensgegenstand</dt>
              <dd>Entwicklung und Betreuung von Open-Source-Software für Data Governance</dd>
            </div>
            <div className="grid gap-1 border-t-2 border-border py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
              <dt className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">Sitz</dt>
              <dd>Wien, Österreich</dd>
            </div>
          </dl>
          <p className="text-base leading-7 text-muted-foreground">
            Classifyre steht unter der Apache-2.0-Lizenz. Informationen zum Datenschutz finden Sie in unserer{" "}
            <a
              href="/de/privacy/"
              className="text-foreground underline decoration-accent decoration-2 underline-offset-2 hover:text-accent"
            >
              Datenschutzerklärung
            </a>
            {" "}.
          </p>
        </div>
      </SectionShell>
    </main>
  );
}
