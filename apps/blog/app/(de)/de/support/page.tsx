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
  title: "Support & individuelle Anpassung",
  description:
    "Classifyre ist 100 % Open Source unter Apache-2.0 ohne Enterprise-Stufen. Arbeiten Sie direkt mit unserem Engineering-Team für IAM-Integration, eigene Konnektoren, Delta-Datenprodukte oder maßgeschneiderte Detektoren.",
  alternates: {
    canonical: "/de/support/",
    languages: {
      en: "/support/",
      de: "/de/support/",
      "x-default": "/support/",
    },
  },
  openGraph: {
    title: "Classifyre Support & individuelle Einführung",
    description:
      "100 % Open Source mit direkter Engineering-Unterstützung für IAM, eigene Quellen, Delta-Datenprodukte, Detektoren und Kubernetes/OpenShift.",
    type: "website",
  },
};

const topics: readonly { marker: string; title: string; body: string }[] = [
  {
    marker: "IAM & Organisation",
    title: "Verzeichnisdienst, Sicherheit & Organisationsdesign",
    body: "Passgenaue Anbindung an komplexe Active-Directory-, Entra-ID-, Okta- oder eigene IAM-Landschaften, Mandantenstrukturen sowie Ihre internen Sicherheits- und Datenschutzrichtlinien.",
  },
  {
    marker: "Eigene Quellen",
    title: "Konnektoren für Fach- und Bestandssysteme",
    body: "Konnektoren sind offene Plugins. Wenn Ihre Organisation branchenspezifische Datenbanken, eigene APIs oder gewachsene Fachverfahren nutzt, entwickeln und betreuen wir den passenden Konnektor gemeinsam mit Ihnen.",
  },
  {
    marker: "Datenprodukte",
    title: "Delta-Datenprodukte & Freigabeprozesse",
    body: "Aufbau verwalteter geteilter Datasets, Delta-Sharing-Strecken sowie fachlicher Datenanfragen in Alltagssprache – inklusive Owner-Freigabe und vererbter Spalten- und Zeilenmaskierung.",
  },
  {
    marker: "Detektoren & KI",
    title: "Geschäftsspezifische Detektoren & Modelle",
    body: "Über Standard-PII hinaus: Umsetzung eigener Regex- und Python-Regeln, lokaler CPU-KI-Modelle (wie GLiNER2) oder fachspezifischer LLM-Klassifikatoren direkt in Ihrer eigenen Umgebung.",
  },
  {
    marker: "Infrastruktur",
    title: "Kubernetes, OpenShift & Air-Gapped-Betrieb",
    body: "Architektur-Review und Produktivbetrieb auf Kubernetes, OpenShift, im eigenen Rechenzentrum oder in Ihrer Cloud (AWS, Azure, GCP) – inklusive Dimensionierung, TLS und Tuning.",
  },
  {
    marker: "Begleiteter Pilot",
    title: "4–6 Wochen Pilot mit Ihren echten Daten",
    body: "Prioritäre Quellen anbinden, Verzeichnisgruppen abbilden, Zeilenfilter und Spaltenmasken in Power BI und Excel verifizieren, das erste Datenprodukt veröffentlichen und einen Audit-Bericht erstellen.",
  },
];

export default function SupportPageDe() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="Support & Anpassung"
        title={
          <>
            Offen im Kern.
            <br />
            <span className="inline-block bg-accent px-[0.12em] text-black">
              Passgenau für Sie.
            </span>
          </>
        }
        lede={
          <>
            Jede Funktion von Classifyre steht offen unter Apache-2.0 – ohne
            gesperrte Enterprise-Edition. Betreiben Sie alles selbst oder
            arbeiten Sie direkt mit den Entwicklern von Classifyre zusammen,
            wenn Sie individuelle IAM-Integration, eigene Datenquellen,
            Delta-Datenprodukte oder fachspezifische Detektoren benötigen.
          </>
        }
        actions={
          <>
            <Button
              asChild
              size="lg"
              className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
            >
              <a
                href={`mailto:${contactEmail}?subject=${encodeURIComponent("Classifyre Anpassung & Pilot")}`}
              >
                {contactEmail}
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
            >
              <a href="/de/get/">Installationsleitfaden</a>
            </Button>
          </>
        }
      />

      <section aria-labelledby="support-topics-title">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="support-topics-title"
              marker="Wobei wir unterstützen"
              title="Direkter Engineering-Support nach Ihrem Bedarf"
              lede="Ob in Österreich, der EU, Nordamerika oder weltweit – Sie sprechen direkt mit dem Team, das Classifyre entwickelt."
            />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {topics.map((item, index) => (
                <Reveal key={item.marker} delayMs={index * 60} className="h-full">
                  <div className="flex h-full flex-col items-start gap-3 border-2 border-border bg-background p-6 shadow-[6px_6px_0_var(--color-border)]">
                    <Marker label={item.marker} />
                    <h3 className="font-sans text-lg font-bold leading-snug text-foreground">
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
              Derselbe Open-Source-Kern.{" "}
              <span className="inline-block bg-accent px-[0.12em] text-black">
                Passend zu Ihrem Team.
              </span>
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/75">
              Evaluieren Sie Classifyre direkt auf Ihrer eigenen Infrastruktur
              oder schreiben Sie uns, um einen Piloten oder eine individuelle
              Integration zu planen.
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
