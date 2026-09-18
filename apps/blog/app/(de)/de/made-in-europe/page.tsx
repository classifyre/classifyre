import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Button } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";

import { Illustration } from "@/components/illustration";
import {
  DocsLink,
  Marker,
  PageHero,
  SectionHead,
  SectionShell,
} from "@/components/page-kit";
import { Reveal } from "@/components/reveal";
import {
  docs,
  enterpriseContactEmail,
  repoUrl,
  routes,
  showcaseUrlFor,
} from "@/lib/site";
import { withLocalePrefix } from "@/lib/locale";

import "../../../landing.css";

export const metadata: Metadata = {
  title: "Made in Austria",
  description:
    "Classifyre wird in Österreich, in der Europäischen Union, gebaut und als Open Source unter Apache-2.0 veröffentlicht. Die Software läuft auf Ihren eigenen Maschinen — Ihre Daten bleiben, wo Sie sie hingelegt haben, unter den Regeln, unter denen wir selbst arbeiten.",
  alternates: {
    canonical: "/de/made-in-europe/",
    languages: {
      en: "/made-in-europe/",
      de: "/de/made-in-europe/",
      "x-default": "/made-in-europe/",
    },
  },
  openGraph: {
    title: "Classifyre — Made in Austria, offen gebaut",
    description:
      "Eine österreichische, europäische Open-Source-Ermittlungsplattform unter Apache-2.0. Ihre Daten müssen Ihre Infrastruktur — oder den Kontinent — nie verlassen.",
    type: "website",
  },
};

/**
 * The Austrian flag as three painted bars rather than an emoji or a PNG: the
 * site's whole visual language is 2px borders and flat blocks, and a glossy
 * flag graphic would read as a sticker dropped onto a case file. Decorative —
 * the surrounding copy already says "Austria" in words.
 */
function AustrianFlag({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-12 w-16 flex-col overflow-hidden border-2 border-border",
        className,
      )}
    >
      <span className="h-1/3 w-full bg-[#ed2939]" />
      <span className="h-1/3 w-full bg-white" />
      <span className="h-1/3 w-full bg-[#ed2939]" />
    </span>
  );
}

/**
 * The twelve stars, drawn on a circle rather than hand-placed. Real polygons
 * rather than the ★ glyph: a text star would land in the page's copied text
 * and in anything scraping it, twelve times over, for a purely decorative mark.
 */
const STAR_POINTS = [
  [0, -1],
  [0.2245, -0.309],
  [0.951, -0.309],
  [0.363, 0.118],
  [0.588, 0.809],
  [0, 0.382],
  [-0.588, 0.809],
  [-0.363, 0.118],
  [-0.951, -0.309],
  [-0.2245, -0.309],
]
  .map(([x, y]) => `${x},${y}`)
  .join(" ");

function EuropeanStars({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={cn("h-12 w-12", className)}
    >
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index * Math.PI) / 6 - Math.PI / 2;
        const x = 50 + 32 * Math.cos(angle);
        const y = 50 + 32 * Math.sin(angle);
        return (
          <polygon
            key={index}
            points={STAR_POINTS}
            fill="currentColor"
            transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(9)`}
          />
        );
      })}
    </svg>
  );
}

/** What the address actually changes for someone running the software. */
const consequences: readonly {
  marker: string;
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
}[] = [
  {
    marker: "Residenz",
    title: "Ihre Daten müssen das Haus nie verlassen",
    body: "Classifyre ist Software, die Sie betreiben, kein Dienst, zu dem Sie hochladen. Das Docker-Image hält alles auf einer Maschine; der Helm-Chart hält alles in Ihrem Cluster. Es gibt keine Anbieter-Mandantschaft, für die man eine Region wählen müsste — denn es gibt keine Anbieter-Mandantschaft.",
    href: docs.deployment,
    hrefLabel: "Deployment-Optionen",
  },
  {
    marker: "Souveränität",
    title: "Keine Abhängigkeit von einer Nicht-EU-Cloud",
    body: "Nichts im Stack verlangt ein Hyperscaler-Konto. PostgreSQL und Kubernetes sind die einzigen harten Abhängigkeiten — die gesamte Plattform läuft bei einem EU-Anbieter, auf eigener Hardware oder in einem air-gapped Rack, immer derselbe Build.",
    href: docs.kubernetes,
    hrefLabel: "Auf Kubernetes betreiben",
  },
  {
    marker: "KI zu Ihren Bedingungen",
    title: "Sie wählen das Modell — und wo es läuft",
    body: "KI-Anbieter sind Konfiguration, kein fest verdrahteter Hersteller. Richten Sie Autopilot und LLM-Detektoren auf einen europäischen Endpunkt, auf ein selbst gehostetes Modell oder auf gar nichts — die regelbasierten Detektoren und die lokalen Modelle arbeiten ohne jeden konfigurierten Anbieter.",
    href: docs.aiProviders,
    hrefLabel: "KI-Anbieter",
  },
  {
    marker: "Gleiches Regelwerk",
    title: "Wir arbeiten unter den Regeln, unter denen Sie arbeiten",
    body: "DSGVO, NIS2, DORA und der AI Act sind für uns keine Export-Checkliste — sie sind das Recht, wo wir sitzen. Das prägt die Produkt-Defaults: Audit-Trails auf Fällen, verschlüsselte Zugangsdaten, Workspace-Isolierung und Telemetrie zum Abschalten.",
    href: docs.telemetry,
    hrefLabel: "Was die Telemetrie sendet",
  },
];

/** Why the open-source part is a commitment rather than a marketing tier. */
const openSourceFacts: readonly {
  label: string;
  value: string;
  detail: string;
}[] = [
  {
    label: "Lizenz",
    value: "Apache-2.0",
    detail:
      "Permissiv, mit Patentgrant und absichtlich langweilig. Forken, ausliefern, kommerziell betreiben.",
  },
  {
    label: "Umfang",
    value: "Die ganze Engine",
    detail:
      "Konnektoren, Detektoren, Ermittlungen, Autopilot, Docker-Image und Helm-Chart — keine abgespeckte Demo.",
  },
  {
    label: "Entwicklung",
    value: "In der Öffentlichkeit",
    detail:
      "Issues, Pull Requests und Releases passieren alle im öffentlichen Repository, öffentlich.",
  },
];

function Fact({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex h-full flex-col gap-2 border-2 border-white/20 bg-white/[0.04] p-5">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
        {label}
      </span>
      <p className="font-serif text-xl font-black uppercase leading-tight tracking-[0.04em] text-white">
        {value}
      </p>
      <p className="text-sm leading-6 text-white/70">{detail}</p>
    </div>
  );
}

function Consequence({
  marker,
  title,
  body,
  href,
  hrefLabel,
}: {
  marker: string;
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="flex h-full flex-col items-start gap-3 border-2 border-border bg-background p-6 shadow-[6px_6px_0_var(--color-border)]">
      <Marker label={marker} />
      <h3 className="font-serif text-lg font-black uppercase leading-tight tracking-[0.04em]">
        {title}
      </h3>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
      {href && hrefLabel ? (
        <div className="mt-auto pt-2">
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground underline-offset-4 hover:text-accent-foreground hover:underline dark:hover:text-accent"
          >
            {hrefLabel} →
          </a>
        </div>
      ) : null}
    </div>
  );
}

/** One line of the "where we sit" card stack. */
function Coordinate({
  label,
  value,
  aside,
}: {
  label: string;
  value: string;
  aside: ReactNode;
}) {
  return (
    <div className="flex items-center gap-5 border-2 border-border bg-background p-5">
      <div className="shrink-0">{aside}</div>
      <div className="space-y-1">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </p>
        <p className="font-serif text-lg font-black uppercase leading-tight tracking-[0.04em]">
          {value}
        </p>
      </div>
    </div>
  );
}

export default function MadeInEuropePageDe() {
  const getHref = `${withLocalePrefix("de", routes.get)}/`;
  const editionsHref = `${withLocalePrefix("de", routes.editions)}/`;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="Servus"
        title={
          <>
            Made in Austria.
            <br />
            <span className="inline-block bg-accent px-[0.12em] text-black">
              Offen für alle.
            </span>
          </>
        }
        lede={
          <>
            Classifyre wird in Österreich, in der Europäischen Union, gebaut und
            als Open Source unter Apache-2.0 veröffentlicht. Wir sind keine
            europäische Marke auf fremder Cloud — die Software läuft auf Ihren
            Maschinen, unter denselben Regeln, unter denen wir selbst arbeiten.
          </>
        }
        actions={
          <>
            <Button
              asChild
              size="lg"
              className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
            >
              <a href={repoUrl} target="_blank" rel="noreferrer">
                Quellcode lesen
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
            >
              <a href={getHref}>Classifyre holen</a>
            </Button>
          </>
        }
        aside={
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-4 border-2 border-white/20 bg-white/[0.04] p-5">
              <AustrianFlag className="shrink-0" />
              <div className="space-y-1">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                  Gebaut in
                </p>
                <p className="font-serif text-xl font-black uppercase tracking-[0.04em] text-white">
                  Österreich
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 border-2 border-white/20 bg-white/[0.04] p-5">
              <EuropeanStars className="shrink-0 text-accent" />
              <div className="space-y-1">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                  Nach den Regeln von
                </p>
                <p className="font-serif text-xl font-black uppercase tracking-[0.04em] text-white">
                  Der Europäischen Union
                </p>
              </div>
            </div>
          </div>
        }
      />

      {/* ── Where we sit ─────────────────────────────────────────────────── */}
      <section aria-labelledby="where-title">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="where-title"
              marker="Koordinaten"
              illustration="feet"
              title="Ein kleines europäisches Team, arbeitet öffentlich"
              lede="Keine Offshore-Entwicklungsfabrik, kein anonymes Maintainer-Konto."
            />

            <div className="flex flex-wrap items-center gap-4 border-2 border-border bg-muted/30 p-5">
              <Marker label="Hallo sagen" />
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Fragen zu einem Rollout, einem Konnektor, den Sie brauchen, oder
                dazu, wohin sich das Projekt entwickelt? Schreiben Sie uns —
                dieselbe Adresse erreicht die Menschen, die den Code geschrieben
                haben.
              </p>
              <Button
                asChild
                variant="secondary"
                className="border-2 border-border"
              >
                <a href={`mailto:${enterpriseContactEmail}`}>
                  {enterpriseContactEmail}
                </a>
              </Button>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── What it changes for you ──────────────────────────────────────── */}
      <section aria-labelledby="consequences-title">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="consequences-title"
              marker="Was es ändert"
              illustration="binders"
              title="Europäisch sein"
              lede="Viele Tools behaupten EU-Hosting und bitten Sie dann trotzdem, Ihre sensibelsten Daten zu ihnen zu schicken. Classifyre ist andersherum gebaut: Die Software reist zu den Daten."
            />

            <div className="grid gap-4 lg:grid-cols-2">
              {consequences.map((item, index) => (
                <Reveal key={item.marker} delayMs={index * 80} className="h-full">
                  <Consequence {...item} />
                </Reveal>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4 border-2 border-border bg-background p-5">
              <Marker label="Klare Antwort" />
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Wir werden Ihnen nicht erzählen, eine Software mache Sie
                DSGVO-konform — das tut keine Software. Was wir sagen können:
                Classifyre braucht nie eine Kopie Ihrer Daten, und jede
                Designentscheidung oben wurde so getroffen, dass eine
                europäische Compliance-Prüfung ein kurzes Gespräch statt eines
                Projekts ist.
              </p>
              <DocsLink href={docs.deployment}>Deployment-Doku</DocsLink>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── Open source ──────────────────────────────────────────────────── */}
      <section aria-labelledby="open-source-title">
        <SectionShell tone="signal" fullWidth className="bg-black">
          <div className="space-y-8 text-white">

            <div className="grid gap-3 md:grid-cols-3">
              {openSourceFacts.map((fact) => (
                <Fact key={fact.label} {...fact} />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                asChild
                className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
              >
                <a href={repoUrl} target="_blank" rel="noreferrer">
                  Repository durchstöbern
                </a>
              </Button>
              <Button
                asChild
                variant="secondary"
                className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
              >
                <a href={editionsHref}>Open Source vs. Enterprise</a>
              </Button>
              <a
                href={showcaseUrlFor("de")}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/50 underline-offset-4 hover:text-accent hover:underline"
              >
                Oder die Live-Showcase ausprobieren
              </a>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── Closing ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="europe-cta-title">
        <SectionShell tone="signal" fullWidth className="bg-black">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 py-4 text-center text-white">
            <div className="flex items-center gap-4">
              <AustrianFlag className="h-10 w-14 border-white/30" />
              <EuropeanStars className="h-10 w-10 text-accent" />
            </div>
            <h2
              id="europe-cta-title"
              className="font-hero text-[clamp(2.5rem,7vw,5rem)] uppercase leading-[0.88] tracking-[0.01em]"
            >
              Hier gebaut.{" "}
              <span className="inline-block bg-accent px-[0.12em] text-black">
                Läuft überall.
              </span>
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/70">
              Betreiben Sie es und richten Sie es auf etwas Echtes. Nichts wird
              hochgeladen, nichts telefoniert mit einer ausländischen Cloud, und
              alles, was Sie aufbauen, tragen Sie mit, wenn Sie zu Kubernetes
              wechseln.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
              >
                <a href={getHref}>
                  Classifyre holen
                </a>
              </Button>
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
              >
                <a href={`mailto:${enterpriseContactEmail}`}>Sprechen Sie mit uns</a>
              </Button>
            </div>
          </div>
        </SectionShell>
      </section>
    </main>
  );
}
