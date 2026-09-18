import type { Metadata } from "next";

import { Button } from "@workspace/ui/components";
import {
  SOURCE_CATEGORY_META,
  resolveSourceCatalogMeta,
  type SourceCatalogCategory,
} from "@workspace/ui/lib/source-catalog";
import { getAllSourceDocs } from "@workspace/schemas/source-docs";

import { Illustration } from "@/components/illustration";
import {
  DocsLink,
  PageHero,
  SectionHead,
  SectionShell,
} from "@/components/page-kit";
import { Reveal } from "@/components/reveal";
import {
  SourceCatalogSection,
  SourceMarquee,
  sourceCount,
} from "@/components/source-showcase";
import { docs, enterpriseContactEmail, routes } from "@/lib/site";
import { withLocalePrefix } from "@/lib/locale";

import "../../../landing.css";

const total = sourceCount();

export const metadata: Metadata = {
  title: "Unterstützte Quellen",
  description: `Jedes System, das Classifyre scannen kann — ${total} Konnektoren über Datenbanken, Warehouses und Lakehouses, Streaming, Object Storage, Kollaborationstools, Analytics und öffentliche Inhalte. Jeder Konnektor verlinkt auf seine Konfigurationsreferenz.`,
  alternates: {
    canonical: "/de/sources/",
    languages: {
      en: "/sources/",
      de: "/de/sources/",
      "x-default": "/sources/",
    },
  },
  openGraph: {
    title: "Classifyre — Unterstützte Quellen",
    description: `${total} Konnektoren über Datenbanken, Lakehouses, Storage, Kollaborationstools, Analytics und öffentliche Inhalte.`,
    type: "website",
  },
};

/** Category counts, derived from the schema rather than hand-maintained. */
function categoryBreakdown(): {
  category: SourceCatalogCategory;
  label: string;
  description: string;
  count: number;
}[] {
  const counts = new Map<SourceCatalogCategory, number>();
  for (const source of getAllSourceDocs()) {
    const { category } = resolveSourceCatalogMeta(source.sourceType);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return (Object.keys(SOURCE_CATEGORY_META) as SourceCatalogCategory[])
    .map((category) => ({
      category,
      label: SOURCE_CATEGORY_META[category].label,
      description: SOURCE_CATEGORY_META[category].description,
      count: counts.get(category) ?? 0,
    }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count);
}

/** What every connector gives you, regardless of which system it talks to. */
const commonCapabilities = [
  {
    illustration: "docs" as const,
    title: "Assets, nicht nur Zeilen",
    body: "Jeder Konnektor liefert Assets mit dranhängenden Quell-Metadaten — Owner, Pfad, Zeitstempel — damit ein Befund immer mitführt, woher er kam.",
    href: docs.sources,
    hrefLabel: "Assets & Metadaten",
  },
  {
    illustration: "probe" as const,
    title: "Vor dem Scan testen",
    body: "Jede Quelle lässt sich aus der App dry-runnen: Credentials prüfen, sehen, was sie lesen würde, und erst dann einen vollen Scan committen.",
    href: docs.sourceTesting,
    hrefLabel: "Quellen testen",
  },
  {
    illustration: "dna" as const,
    title: "Sampling, das Kosten deckelt",
    body: "Große Tabellen und Dateien werden durch Sampling-Fenster mit Cursor pro Asset gelesen — ein Scan liest also einen begrenzten Ausschnitt statt allem.",
    href: docs.sampling,
    hrefLabel: "Sampling",
  },
  {
    illustration: "finger-print" as const,
    title: "Quellenübergreifende Fingerprints",
    body: "Derselbe Wert in zwei verschiedenen Systemen wird per Identität verlinkt — wo die meisten echten Ermittlungen tatsächlich beginnen.",
    href: docs.howItWorks,
    hrefLabel: "So funktioniert es",
  },
] as const;

export default function SourcesPageDe() {
  const breakdown = categoryBreakdown();
  const getHref = `${withLocalePrefix("de", routes.get)}/`;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="Quellen"
        title={
          <>
            Scannen Sie die Systeme,
            <br />
            die Sie{" "}
            <span className="inline-block bg-accent px-[0.12em] text-black">
              bereits besitzen.
            </span>
          </>
        }
        lede={
          <>
            <strong className="text-white">{total} Konnektoren</strong> über
            Datenbanken, Warehouses und Lakehouses, Streaming, Object Storage,
            Kollaborationstools, Analytics und öffentliche Inhalte — alle
            speisen einen Beweisstrom.
          </>
        }
        actions={
          <>
            <Button
              asChild
              size="lg"
              className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
            >
              <a href="#catalog">Katalog durchstöbern</a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
            >
              <a href={getHref}>Betreiben und einen anbinden</a>
            </Button>
          </>
        }
      />

      {/* ── Marquee + breakdown ──────────────────────────────────────────── */}
      <section aria-labelledby="breakdown-title">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SourceMarquee />

            <SectionHead
              id="breakdown-title"
              marker="Nach Kategorie"
              title="Woher die Beweise kommen"
              lede="Konnektoren sind gruppiert nach dem, was sie sind, nicht nach Hersteller. Zählungen kommen direkt aus dem Schema — diese Seite kann also nie von dem abweichen, was das Produkt wirklich unterstützt."
            />

            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {breakdown.map((entry, index) => (
                <Reveal key={entry.category} as="li" delayMs={index * 60}>
                  <div className="flex h-full flex-col gap-2 border-2 border-border bg-background p-5 shadow-[4px_4px_0_var(--color-border)]">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-serif text-base font-black uppercase leading-tight tracking-[0.04em]">
                        {entry.label}
                      </span>
                      <span className="shrink-0 border-2 border-accent bg-accent px-1.5 py-0.5 font-mono text-[11px] font-black text-black">
                        {entry.count}
                      </span>
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {entry.description}
                    </p>
                  </div>
                </Reveal>
              ))}
            </ul>
          </div>
        </SectionShell>
      </section>

      {/* ── The catalog ──────────────────────────────────────────────────── */}
      <section aria-labelledby="catalog-title" id="catalog">
        <SectionShell tone="signal">
          <div className="space-y-8">
            <SectionHead
              id="catalog-title"
              marker="Voller Katalog"
              tone="signal"
              illustration="binders"
              title={`Alle ${total} Konnektoren`}
              lede="Suchen Sie nach Name, Kategorie oder Fähigkeit. Jeder Eintrag verlinkt auf seine Konfigurationsreferenz in der Doku-Site — Pflichtfelder, Auth und ein durchgearbeitetes Beispiel."
              action={
                <DocsLink href={docs.sourceConfiguration} tone="signal">
                  Konfigurationsreferenz
                </DocsLink>
              }
            />

            <SourceCatalogSection locale="de" />
          </div>
        </SectionShell>
      </section>

      {/* ── What every connector does ────────────────────────────────────── */}
      <section aria-labelledby="capabilities-title">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="capabilities-title"
              marker="Jeder Konnektor"
              title="Was alle gemeinsam haben"
              lede="Das System am anderen Ende wechselt. Was Classifyre mit dem Gelesenen tut, nicht."
            />

            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {commonCapabilities.map((item, index) => (
                <Reveal key={item.title} as="li" delayMs={index * 80}>
                  <div className="flex h-full flex-col border-2 border-border bg-background shadow-[4px_4px_0_var(--color-border)]">
                    <div className="flex min-h-38 items-center justify-center px-5 py-6">
                      <Illustration
                        name={item.illustration}
                        tilt={index % 2 === 0 ? "left" : "right"}
                        className="h-28 w-28"
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-2 border-t-2 border-border p-5">
                      <p className="font-serif text-base font-black uppercase leading-tight tracking-[0.04em]">
                        {item.title}
                      </p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {item.body}
                      </p>
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-auto pt-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent-foreground/70 underline-offset-4 hover:underline dark:text-accent"
                      >
                        {item.hrefLabel} →
                      </a>
                    </div>
                  </div>
                </Reveal>
              ))}
            </ul>
          </div>
        </SectionShell>
      </section>

      {/* ── Missing one ──────────────────────────────────────────────────── */}
      <section aria-labelledby="missing-title">
        <SectionShell tone="signal" fullWidth className="bg-black">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 py-4 text-center text-white">
            <Illustration
              name="settings"
              surface="inverted"
              tilt="right"
              className="h-24 w-24"
            />
            <h2
              id="missing-title"
              className="font-hero text-[clamp(2.5rem,7vw,5rem)] uppercase leading-[0.88] tracking-[0.01em]"
            >
              Fehlt der eine,{" "}
              <span className="inline-block bg-accent px-[0.12em] text-black">
                den Sie brauchen?
              </span>
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/70">
              Konnektoren sind Plugins, und das Projekt ist Open Source — die
              Antwort ist also entweder ein Pull Request oder ein Gespräch.
              Enterprise-Kunden bekommen Quellen für die Systeme ihrer Branche,
              gebaut von unseren Engineers.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
              >
                <a
                  href="https://github.com/classifyre/classifyre/issues/new"
                  target="_blank"
                  rel="noreferrer"
                >
                  Konnektor anfragen
                </a>
              </Button>
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
              >
                <a href={`mailto:${enterpriseContactEmail}`}>
                  Mit uns über Enterprise sprechen
                </a>
              </Button>
            </div>
          </div>
        </SectionShell>
      </section>
    </main>
  );
}
