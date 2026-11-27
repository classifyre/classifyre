import type { Metadata } from "next";

import { Button } from "@workspace/ui/components";

import { AboutPillars } from "@/components/about-pillars";
import {
  DocsLink,
  Marker,
  PageHero,
  SectionHead,
  SectionShell,
} from "@/components/page-kit";
import { Reveal } from "@/components/reveal";
import {
  JsonLdScripts,
  generateAboutPageSchema,
  generateBreadcrumbSchema,
  siteOrigin,
} from "@/lib/seo";
import {
  contactEmail,
  docs,
  repoUrl,
  routes,
  showcaseUrl,
} from "@/lib/site";

import "../../landing.css";

export const metadata: Metadata = {
  title: { absolute: "About Classifyre – Sovereign Data Governance Platform" },
  description:
    "Classifyre is a sovereign data governance platform engineered in Austria to European privacy and security standards, deployed by organisations across Europe, North America, and worldwide.",
  alternates: {
    canonical: "/made-in-europe/",
    languages: {
      en: "/made-in-europe/",
      de: "/de/made-in-europe/",
      "x-default": "/made-in-europe/",
    },
  },
  openGraph: {
    title: "About Classifyre – Sovereign Data Governance Platform",
    description:
      "Sovereign data governance platform built in Austria to European standards and deployed globally on your own infrastructure.",
    type: "website",
    locale: "en_US",
  },
};

function SubtleAustrianMark() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-3.5 w-5 shrink-0 flex-col overflow-hidden border border-white/25"
    >
      <span className="h-1/3 w-full bg-[#ed2939]" />
      <span className="h-1/3 w-full bg-white" />
      <span className="h-1/3 w-full bg-[#ed2939]" />
    </span>
  );
}

const principles: readonly {
  marker: string;
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
}[] = [
  {
    marker: "Integration first",
    title: "Works with the stack you already run",
    body: "Keep your existing ETL pipelines, databases, Iceberg and Delta lakehouses, identity provider, and BI tools. Classifyre integrates cleanly on top instead of forcing an expensive platform migration.",
    href: routes.sources,
    hrefLabel: "Explore supported sources",
  },
  {
    marker: "Data sovereignty",
    title: "Everything stays on your infrastructure",
    body: "Classifyre is self-hosted software — never a multi-tenant SaaS upload. Run it locally with Docker, on Kubernetes and OpenShift on-premises or in your own cloud — operated by your own team or integrator.",
    href: docs.deployment,
    hrefLabel: "Deployment architecture",
  },
  {
    marker: "European standards",
    title: "Privacy and security built into the defaults",
    body: "Engineered in Austria under GDPR, NIS2, DORA, and EU AI Act expectations. Personal columns are masked by default, admins never inherit clear values automatically, every read is logged, and AI models remain entirely your choice.",
    href: docs.aiProviders,
    hrefLabel: "AI & model configuration",
  },
  {
    marker: "Open by design",
    title: "100% Apache-2.0, zero locked tiers",
    body: "Inspect every line of code, audit how masking and access control work, and deploy the full platform yourself with no per-seat licensing. Questions about your setup are always welcome.",
    href: routes.support,
    hrefLabel: "Support & contact",
  },
];

const openSourceFacts: readonly {
  label: string;
  value: string;
  detail: string;
}[] = [
  {
    label: "Licence",
    value: "Apache-2.0",
    detail:
      "Permissive open-source licence with explicit patent grant. Audit it, extend it, and run it commercially without vendor lock-in.",
  },
  {
    label: "Complete core",
    value: "Every capability included",
    detail:
      "SSO, roles, row filters, dynamic masking, SQL/BI gateway, shared datasets, audit logging, Docker image, and Kubernetes/OpenShift Helm chart.",
  },
  {
    label: "Engineering transparency",
    value: "Developed in the open",
    detail:
      "Architecture, connectors, releases, and security fixes are visible directly on GitHub so your team can verify quality before adopting.",
  },
];

const coordinates: readonly { label: string; value: string; accent?: boolean }[] = [
  { label: "Engineering", value: "Austria, European Union", accent: true },
  { label: "Global reach", value: "Europe, North America & Worldwide" },
  { label: "Licence", value: "Apache-2.0 · 100% Open Source" },
  { label: "Deployment", value: "Docker · Kubernetes · OpenShift" },
];

export default function MadeInEuropePage() {
  const siteUrl = siteOrigin();

  return (
    <>
      <JsonLdScripts
        schemas={[
          generateBreadcrumbSchema(siteUrl, [
            { name: "Classifyre", path: "/" },
            { name: "About", path: "/made-in-europe/" },
          ]),
          generateAboutPageSchema(siteUrl, "/made-in-europe/", "en"),
        ]}
      />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="About Classifyre"
        title={
          <>
            Built in Austria.
            <br />
            <span className="inline-block bg-accent px-[0.12em] text-black">
              Deployed worldwide.
            </span>
          </>
        }
        lede={
          <>
            Classifyre is a sovereign data governance platform engineered in
            Austria to European privacy and security standards, built for
            organisations across Europe, North America, and beyond. We believe
            critical data governance infrastructure should be transparent,
            self-hosted, and free from proprietary vendor lock-in.
          </>
        }
        actions={
          <>
            <Button
              asChild
              size="lg"
              className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
            >
              <a href={routes.support}>Get in touch</a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="ghost"
              className="border-2 border-white/35 bg-white/10 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white hover:border-accent hover:bg-white/15 hover:text-accent"
            >
              <a href={repoUrl} target="_blank" rel="noreferrer">
                View source on GitHub
              </a>
            </Button>
          </>
        }
        aside={
          <div className="border-2 border-white/20 bg-white/[0.04] p-6">
            <dl className="divide-y divide-white/15">
              {coordinates.map((item) => (
                <div key={item.label} className="py-3.5 first:pt-0 last:pb-0">
                  <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
                    {item.label}
                  </dt>
                  <dd className="mt-1 flex items-center gap-2.5 font-sans text-base font-semibold text-white">
                    {item.accent ? <SubtleAustrianMark /> : null}
                    <span>{item.value}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        }
      />

      {/* ── End-to-end capabilities ───────────────────────────────────────── */}
      <AboutPillars locale="en" />

      {/* ── Engineering principles ────────────────────────────────────────── */}
      <section aria-labelledby="principles-title">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="principles-title"
              marker="How we build"
              title="Practical engineering, clear boundaries"
              lede="Designed for organisations that need rigorous data governance without handing control of their data estate to a closed-source vendor."
            />

            <div className="grid gap-4 lg:grid-cols-2">
              {principles.map((item, index) => {
                const external = item.href?.startsWith("http");
                return (
                  <Reveal key={item.marker} delayMs={index * 70} className="h-full">
                    <div className="flex h-full flex-col items-start gap-3 border-2 border-border bg-background p-6 shadow-[6px_6px_0_var(--color-border)]">
                      <Marker label={item.marker} />
                      <h3 className="font-sans text-lg font-bold leading-snug text-foreground">
                        {item.title}
                      </h3>
                      <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
                      {item.href && item.hrefLabel ? (
                        <div className="mt-auto pt-2">
                          <a
                            href={item.href}
                            {...(external ? { target: "_blank", rel: "noreferrer" } : null)}
                            className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground underline-offset-4 hover:text-accent-foreground hover:underline dark:hover:text-accent"
                          >
                            {item.hrefLabel} →
                          </a>
                        </div>
                      ) : null}
                    </div>
                  </Reveal>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-2 border-border bg-muted/30 p-5 sm:p-6">
              <div className="max-w-3xl space-y-1.5">
                <Marker label="Compliance note" />
                <p className="pt-1 text-sm leading-6 text-muted-foreground">
                  No software tool makes an organisation compliant by itself.
                  Classifyre gives your security, data, and legal teams the
                  technical enforcement — group permissions, row filters,
                  column masking, and verifiable read logs — that supports GDPR,
                  NIS2, DORA, and internal governance frameworks.
                </p>
              </div>
              <DocsLink href={docs.deployment}>Architecture docs</DocsLink>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── Open-source commitment ────────────────────────────────────────── */}
      <section aria-labelledby="open-source-title">
        <SectionShell tone="signal" fullWidth className="bg-black">
          <div className="mx-auto max-w-7xl space-y-8 text-white">
            <div className="max-w-2xl space-y-3">
              <Marker label="Open source" />
              <h2
                id="open-source-title"
                className="font-hero text-[clamp(2.2rem,5vw,3.8rem)] uppercase leading-[0.9] tracking-[0.01em] text-white"
              >
                Inspect the quality yourself.
              </h2>
              <p className="text-base leading-7 text-white/70">
                Evaluate Classifyre by reading the codebase, testing it on your
                own databases, and deploying it in your environment — with zero
                feature walls.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {openSourceFacts.map((fact) => (
                <div
                  key={fact.label}
                  className="flex h-full flex-col gap-2 border-2 border-white/20 bg-white/[0.04] p-5"
                >
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                    {fact.label}
                  </span>
                  <p className="font-sans text-lg font-bold text-white">
                    {fact.value}
                  </p>
                  <p className="text-sm leading-6 text-white/70">{fact.detail}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4 border-t border-white/15 pt-6">
              <Button
                asChild
                size="lg"
                className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
              >
                <a href={routes.get}>Deploy Classifyre</a>
              </Button>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="border-2 border-white/35 bg-white/10 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white hover:border-accent hover:bg-white/15 hover:text-accent"
              >
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
              </Button>
              <a
                href={showcaseUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/75 underline-offset-4 hover:text-accent hover:underline"
              >
                Explore live demo →
              </a>
            </div>
          </div>
        </SectionShell>
      </section>
      </main>
    </>
  );
}
