import type { Metadata } from "next";

import { Button } from "@workspace/ui/components";

import {
  DocsLink,
  Marker,
  PageHero,
  SectionHead,
  SectionShell,
} from "@/components/page-kit";
import { Reveal } from "@/components/reveal";
import { contactEmail, docs } from "@/lib/site";

import "../../../landing.css";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Classifyre ist Open Source, alle Funktionen sind enthalten. Wenn Sie Hilfe bei Einrichtung, Installation, einem Konnektor oder Anpassung brauchen, kontaktieren Sie uns.",
  alternates: {
    canonical: "/de/support/",
    languages: {
      en: "/support/",
      de: "/de/support/",
      "x-default": "/support/",
    },
  },
  openGraph: {
    title: "Classifyre-Support",
    description:
      "Keine Stufen, kein Enterprise-Build. Hilfe bei Einrichtung, Konnektoren und Anpassung, auf Anfrage.",
    type: "website",
  },
};

const topics: readonly { marker: string; title: string; body: string }[] = [
  {
    marker: "Einrichtung",
    title: "Einrichtung und Installation",
    body: "Heute Abend ein Docker-Image, oder das Helm-Chart auf Kubernetes — On-Premises, in Ihrer eigenen Cloud oder auf Public-Cloud-Infrastruktur wie AWS, Azure oder Google Cloud. Wenn Sie feststecken oder jemand über die Einrichtung schauen soll, schreiben Sie uns.",
  },
  {
    marker: "Konnektoren",
    title: "Ein Konnektor für Ihre Systeme",
    body: "Konnektoren sind Plugins und das Projekt ist Open Source, ein Pull Request ist also immer willkommen. Wenn Sie einen Konnektor für die Systeme Ihrer Branche brauchen und ihn lieber von uns bauen lassen, sagen Sie uns, welche Systeme.",
  },
  {
    marker: "Anpassung",
    title: "Passend zu Ihrer Organisation",
    body: "Ihre Verzeichnisgruppen und Zugriffsregeln abbilden, Zeilenfilter pro Team, Masken auf den richtigen Spalten, die erste Power-BI-Verbindung, ein Zugriffsbericht, den Ihre Datenschutzbeauftragte abzeichnen kann. Ein Pilot über vier bis sechs Wochen deckt das alles auf einem echten System ab.",
  },
  {
    marker: "Fragen",
    title: "Fragen zum Produkt",
    body: "Wie die Maskierung in Ihren Werkzeugen hält, welche Detektoren zu Ihren Daten passen, wo etwas hingehört. Unter derselben Adresse erreichen Sie die Leute, die den Code geschrieben haben.",
  },
];

export default function SupportPageDe() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="Support"
        title={
          <>
            Brauchen Sie Hilfe?
            <br />
            <span className="inline-block bg-accent px-[0.12em] text-black">
              Schreiben Sie uns.
            </span>
          </>
        }
        lede={
          <>
            Classifyre ist Open Source und alle Funktionen sind enthalten — es
            gibt keine Enterprise-Version und nichts, wohin man wechseln
            müsste. Wenn Sie Hilfe bei Einrichtung oder Installation brauchen,
            einen Konnektor für Ihre Systeme oder Anpassung an Ihre
            Organisation, kontaktieren Sie uns. Sie oder Ihr Integrator können
            auch alles selbst betreiben.
          </>
        }
        actions={
          <>
            <Button
              asChild
              size="lg"
              className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
            >
              <a href={`mailto:${contactEmail}?subject=${encodeURIComponent("Classifyre-Support")}`}>
                {contactEmail}
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
            >
              <a href="/de/get/">Classifyre holen</a>
            </Button>
          </>
        }
      />

      <section aria-labelledby="support-topics-title">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="support-topics-title"
              marker="Wobei wir helfen"
              title="Einrichtung, Konnektoren, Anpassung, Fragen"
              lede="Support ist ein Gespräch, keine Stufe. Alles unten ist Hilfe auf Anfrage, auf demselben Open-Source-Produkt."
            />
            <div className="grid gap-4 lg:grid-cols-2">
              {topics.map((item, index) => (
                <Reveal key={item.marker} delayMs={index * 80} className="h-full">
                  <div className="flex h-full flex-col items-start gap-3 border-2 border-border bg-background p-6 shadow-[6px_6px_0_var(--color-border)]">
                    <Marker label={item.marker} />
                    <h3 className="font-serif text-lg font-black uppercase leading-tight tracking-[0.04em]">
                      {item.title}
                    </h3>
                    <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </SectionShell>
      </section>

      <section aria-labelledby="support-cta-title">
        <SectionShell tone="signal" fullWidth className="bg-black">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 py-4 text-center text-white">
            <h2
              id="support-cta-title"
              className="font-hero text-[clamp(2.5rem,7vw,5rem)] uppercase leading-[0.88] tracking-[0.01em]"
            >
              Dasselbe Produkt.{" "}
              <span className="inline-block bg-accent px-[0.12em] text-black">
                Hilfe auf Anfrage.
              </span>
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/70">
              Keine Stufen, keine gesperrten Funktionen. Betreiben Sie es heute
              Abend selbst, oder schreiben Sie uns zuerst — so oder so läuft
              dasselbe Classifyre.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
              >
                <a href={`mailto:${contactEmail}`}>Kontakt aufnehmen</a>
              </Button>
              <DocsLink href={docs.deployment} tone="signal">
                Deployment-Doku
              </DocsLink>
            </div>
          </div>
        </SectionShell>
      </section>
    </main>
  );
}
