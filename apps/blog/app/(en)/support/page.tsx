import type { Metadata } from "next";

import { Button } from "@workspace/ui/components";

import { FaqList } from "@/components/landing/faq";
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
  generateBreadcrumbSchema,
  generateContactPageSchema,
  generateFaqSchema,
  siteOrigin,
} from "@/lib/seo";
import { contactEmail, docs, repoUrl, routes, showcaseUrl } from "@/lib/site";

import "../../landing.css";

export const metadata: Metadata = {
  title: "Support & Tailored Deployments",
  description:
    "Self-service resources, community channels, and direct engineering collaboration for Classifyre. 100% Apache-2.0 open source with individually agreed tailoring for IAM, custom sources, Delta data products, and bespoke detectors.",
  alternates: {
    canonical: "/support/",
    languages: {
      en: "/support/",
      de: "/de/support/",
      "x-default": "/support/",
    },
  },
  openGraph: {
    title: "Classifyre Support & Tailored Rollouts",
    description:
      "Documentation, GitHub community support, and direct engineering collaboration scoped individually to your organisation.",
    type: "website",
  },
};

const selfService: readonly {
  marker: string;
  title: string;
  body: string;
  href: string;
  label: string;
  external?: boolean;
}[] = [
  {
    marker: "Documentation",
    title: "Setup, connectors & governance guides",
    body: "Step-by-step manuals for Docker, Kubernetes & OpenShift Helm deployments, directory SSO, masking, SQL connections, and custom detectors.",
    href: docs.root,
    label: "Browse docs",
    external: true,
  },
  {
    marker: "Community & bugs",
    title: "GitHub issues & pull requests",
    body: "Report a bug, request a connector or feature, or follow active releases directly in the public Apache-2.0 repository.",
    href: `${repoUrl}/issues`,
    label: "Open GitHub issues",
    external: true,
  },
  {
    marker: "Live environment",
    title: "Explore the read-only showcase",
    body: "Inspect real workspace views, classification findings, masking behaviour, and governance tabs without installing anything locally.",
    href: showcaseUrl,
    label: "Launch live demo",
    external: true,
  },
  {
    marker: "Releases & security",
    title: "Release notes & vulnerability reporting",
    body: "Track version changes and upgrade notes — or email security disclosures directly to our engineering team for coordinated handling.",
    href: `${routes.releaseNotes}/`,
    label: "View release notes",
  },
];

const tailoringAreas: readonly { marker: string; title: string; body: string }[] = [
  {
    marker: "IAM & org design",
    title: "Identity, security & organisational fit",
    body: "Integrate complex Active Directory, Entra ID, Okta, or custom IAM hierarchies, multi-tenant structures, and internal security and data protection policies.",
  },
  {
    marker: "Custom sources",
    title: "Connectors for proprietary or legacy systems",
    body: "Build, harden, and maintain connectors for industry-specific databases, internal APIs, or legacy systems not yet covered in the public catalog.",
  },
  {
    marker: "Data products",
    title: "Delta data products & sharing workflows",
    body: "Design governed shared datasets, Delta Sharing pipelines, and plain-language business dataset request workflows with owner approval and inherited masks.",
  },
  {
    marker: "Detectors & AI",
    title: "Business-specific detectors & custom models",
    body: "Author domain rules in regex or Python, tune lightweight on-CPU AI models (such as GLiNER2), or configure private LLM classifiers inside your environment.",
  },
  {
    marker: "Infrastructure",
    title: "Kubernetes, OpenShift & air-gapped operations",
    body: "Production architecture review and deployment on Kubernetes, OpenShift, on-premises clusters, or private/public clouds — including TLS, sizing, and tuning.",
  },
  {
    marker: "Architecture review",
    title: "Security, masking & compliance verification",
    body: "Review row-level security, column masking policies, Power BI / Excel / ODBC connectivity, and audit logging with your security and data protection teams.",
  },
];

const collaborationSteps: readonly { step: string; title: string; body: string }[] = [
  {
    step: "01",
    title: "Share your environment & goals",
    body: "Tell us which sources, IAM directory, cluster runtime, and governance goals matter most. You speak directly with the engineers who build Classifyre.",
  },
  {
    step: "02",
    title: "Agree an individual scope",
    body: "No canned tiers or rigid packages. Together we define exact deliverables — whether a short architecture review, a custom connector, or a full tailored rollout.",
  },
  {
    step: "03",
    title: "Deliver & hand over cleanly",
    body: "Everything runs on your own infrastructure under Apache-2.0 or your agreed private modules, documented so your internal team or integrator owns operations long-term.",
  },
];

const inquiryChecklist: readonly string[] = [
  "Data sources & formats involved (e.g., PostgreSQL, Oracle/ODBC, Databricks, Iceberg, Delta, Parquet, S3/Azure/GCS)",
  "Identity provider & group structure (e.g., Entra ID, Active Directory, Okta, Keycloak, OIDC/SAML)",
  "Target infrastructure (Docker, Kubernetes, OpenShift, on-premises, air-gapped, or cloud)",
  "Primary goals (group masking, Power BI/Excel access, Delta data products, custom sources, or custom detectors)",
];

const supportFaq: readonly { q: string; a: string }[] = [
  {
    q: "Is any feature locked behind a paid support contract or enterprise edition?",
    a: "No. Every capability — SSO, roles, row filters, dynamic column masking, SQL/BI gateway, dataset requests, shared datasets, audit logging, and the Helm chart — is 100% Apache-2.0 open source. You only engage us if you want direct engineering help, custom extensions, or tailored rollout support.",
  },
  {
    q: "How is tailored work scoped and agreed?",
    a: "Every engagement is individual and agreed directly around your technical requirements, timeline, and internal team capacity — ranging from focused architecture reviews or custom connector development to end-to-end rollout assistance.",
  },
  {
    q: "Can custom connectors or detectors stay private to our organisation?",
    a: "Yes. Connectors and detectors are modular plugins. You can choose to contribute general improvements upstream to the open-source repository or keep organisation-specific integrations and business rules strictly private in your own environment.",
  },
  {
    q: "Can you work under NDA and standard European or North American procurement?",
    a: "Yes. We work with organisations across Austria, the European Union, North America, and globally under standard NDAs and direct engineering agreements.",
  },
  {
    q: "How do I report a security vulnerability?",
    a: "Please send details directly to contact@classifyre.com with “Security” in the subject line rather than opening a public GitHub issue, so we can coordinate verification and a fix promptly.",
  },
];

export default function SupportPage() {
  const siteUrl = siteOrigin();

  return (
    <>
      <JsonLdScripts
        schemas={[
          generateBreadcrumbSchema(siteUrl, [
            { name: "Classifyre", path: "/" },
            { name: "Support", path: "/support/" },
          ]),
          generateContactPageSchema(siteUrl, "/support/", "en"),
          generateFaqSchema(supportFaq),
        ]}
      />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
        <PageHero
          eyebrow="Support & Tailoring"
          title={
            <>
              Open source by default.
              <br />
              <span className="inline-block bg-accent px-[0.12em] text-black">
                Tailored to your needs.
              </span>
            </>
          }
          lede={
            <>
              Every capability in Classifyre is open source under Apache-2.0
              with no gated tiers. Use our documentation and public repository
              for self-hosted operations, or work directly with the engineers
              who build Classifyre on an individual, agreed scope for custom
              IAM, sources, Delta data products, or detectors.
            </>
          }
          actions={
            <>
              <Button
                asChild
                size="lg"
                className="border-2 border-accent bg-accent font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-black hover:bg-accent/90"
              >
                <a
                  href={`mailto:${contactEmail}?subject=${encodeURIComponent("Classifyre inquiry")}`}
                >
                  {contactEmail}
                </a>
              </Button>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="border-2 border-white/35 bg-white/10 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white hover:border-accent hover:bg-white/15 hover:text-accent"
              >
                <a href={`${routes.get}/`}>Deployment guide</a>
              </Button>
            </>
          }
        />

        {/* ── Self-service & community hub ──────────────────────────────── */}
        <section aria-labelledby="self-service-title">
          <SectionShell tone="plain">
            <div className="space-y-8">
              <SectionHead
                id="self-service-title"
                marker="Self-service & community"
                title="Start here if you are self-hosting"
                lede="Direct links to technical documentation, community issue tracking, the live demo, and release notes."
              />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {selfService.map((item, index) => (
                  <Reveal key={item.marker} delayMs={index * 60} className="h-full">
                    <a
                      href={item.href}
                      {...(item.external ? { target: "_blank", rel: "noreferrer" } : null)}
                      className="group flex h-full flex-col items-start gap-3 border-2 border-border bg-background p-5 transition-colors hover:border-accent"
                    >
                      <Marker label={item.marker} />
                      <h3 className="font-sans text-base font-bold leading-snug text-foreground">
                        {item.title}
                      </h3>
                      <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
                      <span className="mt-auto pt-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-accent-ink group-hover:underline dark:text-accent">
                        {item.label} →
                      </span>
                    </a>
                  </Reveal>
                ))}
              </div>
            </div>
          </SectionShell>
        </section>

        {/* ── Tailored engineering areas ────────────────────────────────── */}
        <section aria-labelledby="support-topics-title">
          <SectionShell tone="plain">
            <div className="space-y-8">
              <SectionHead
                id="support-topics-title"
                marker="Direct engineering"
                title="Where we collaborate with organisations"
                lede="Scope, deliverables, and timelines are agreed individually with your team — no rigid packages and no vendor lock-in."
              />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {tailoringAreas.map((item, index) => (
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

        {/* ── How collaboration works + What to include ─────────────────── */}
        <section aria-labelledby="how-we-work-title">
          <SectionShell tone="signal" fullWidth className="bg-black">
            <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-12">
              <div className="space-y-8 lg:col-span-7">
                <div className="space-y-3">
                  <Marker label="How it works" />
                  <h2
                    id="how-we-work-title"
                    className="font-hero text-[clamp(2.2rem,5vw,3.8rem)] uppercase leading-[0.9] tracking-[0.01em] text-white"
                  >
                    Direct to the engineers. Individually agreed.
                  </h2>
                </div>
                <ol className="space-y-6">
                  {collaborationSteps.map((s) => (
                    <li
                      key={s.step}
                      className="grid gap-3 border-t border-white/15 pt-5 sm:grid-cols-[4rem_1fr]"
                    >
                      <span className="font-hero text-4xl leading-none text-accent">
                        {s.step}
                      </span>
                      <div className="space-y-1.5">
                        <h3 className="font-sans text-base font-bold text-white">
                          {s.title}
                        </h3>
                        <p className="text-sm leading-6 text-white/75">{s.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="flex flex-col justify-between gap-6 border-2 border-white/25 bg-white/[0.04] p-6 sm:p-8 lg:col-span-5">
                <div className="space-y-4">
                  <Marker label="Fastest way to start" />
                  <h3 className="font-sans text-xl font-bold text-white">
                    What helps when you write to us
                  </h3>
                  <p className="text-sm leading-6 text-white/75">
                    A brief note covering any of the points below helps us reply
                    with concrete technical answers right away:
                  </p>
                  <ul className="space-y-3 pt-1">
                    {inquiryChecklist.map((line) => (
                      <li
                        key={line}
                        className="flex items-start gap-3 text-sm leading-6 text-white/85"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-2 size-1.5 shrink-0 bg-accent"
                        />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap items-center gap-3 border-t border-white/15 pt-6">
                  <Button
                    asChild
                    size="lg"
                    className="border-2 border-accent bg-accent font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-black hover:bg-accent/90"
                  >
                    <a
                      href={`mailto:${contactEmail}?subject=${encodeURIComponent("Classifyre technical inquiry")}`}
                    >
                      Email {contactEmail}
                    </a>
                  </Button>
                  <DocsLink href={docs.deployment} tone="signal">
                    Deployment docs
                  </DocsLink>
                </div>
              </div>
            </div>
          </SectionShell>
        </section>

        {/* ── Support FAQ ──────────────────────────────────────────────── */}
        <FaqList
          id="support-faq-title"
          mark="Support FAQ"
          title="Questions about working with us."
          items={supportFaq}
          locale="en"
        />
      </main>
    </>
  );
}
