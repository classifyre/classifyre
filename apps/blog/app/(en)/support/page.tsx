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
  title: "Support & Contact",
  description:
    "Documentation, GitHub issues, the live demo and release notes for self-hosting Classifyre — and a direct line to the engineers if you have questions about your setup.",
  alternates: {
    canonical: "/support/",
    languages: {
      en: "/support/",
      de: "/de/support/",
      "x-default": "/support/",
    },
  },
  openGraph: {
    title: "Classifyre Support & Contact",
    description:
      "Self-service resources for running Classifyre yourself, and a direct line to the engineers for questions.",
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

const questionTopics: readonly { marker: string; title: string; body: string }[] = [
  {
    marker: "Evaluating",
    title: "Does it fit your environment?",
    body: "Not sure Classifyre covers your sources, identity provider or masking rules? Ask before you install — we'd rather give you an honest answer than have you guess.",
  },
  {
    marker: "Sources",
    title: "Systems we haven't seen yet",
    body: "Proprietary or legacy systems, internal APIs, EDI feeds or file formats that aren't in the source catalog — tell us what you have. It shapes what we build next.",
  },
  {
    marker: "Identity",
    title: "Unusual directory or group structures",
    body: "Nested Active Directory groups, several Entra ID tenants, Okta or Keycloak setups that don't map neatly onto workspaces and roles — describe yours and we'll tell you how it maps.",
  },
  {
    marker: "Infrastructure",
    title: "Air-gapped, OpenShift & locked-down clusters",
    body: "Questions about running Classifyre where outbound traffic is blocked, images come from an internal registry, or BI and AI tools must route only through the gateway.",
  },
  {
    marker: "Detectors & AI",
    title: "Business-specific detection",
    body: "Custom regex or Python detectors, on-CPU classification models or a private LLM inside your network — ask how to set them up if the docs leave you stuck.",
  },
  {
    marker: "Feedback",
    title: "What's missing or confusing",
    body: "Something that didn't work the way you expected, a doc that skipped a step, or a feature you'd need before using Classifyre — all of it is useful to hear.",
  },
];

const collaborationSteps: readonly { step: string; title: string; body: string }[] = [
  {
    step: "01",
    title: "Write to us",
    body: "Tell us what you're trying to do and where you're stuck. A short note is enough — there's no form and nothing to sign.",
  },
  {
    step: "02",
    title: "An engineer reads it",
    body: "Messages go to the people who build Classifyre. We reply as soon as we can, and point you to the docs or an issue when the answer already exists.",
  },
  {
    step: "03",
    title: "Everyone benefits",
    body: "When your question shows a gap, the fix lands in the open-source repository or the documentation, so the next person doesn't hit it.",
  },
];

const inquiryChecklist: readonly string[] = [
  "Data sources and formats involved (e.g., PostgreSQL, Oracle/ODBC, Databricks, Iceberg, Delta, Parquet, S3/Azure/GCS, or a proprietary system)",
  "Identity provider and group structure (e.g., Entra ID, Active Directory, Okta, Keycloak, OIDC/SAML)",
  "Where it runs (Docker, Kubernetes, OpenShift, air-gapped)",
  "What you're trying to achieve, and where you got stuck",
];

const supportFaq: readonly { q: string; a: string }[] = [
  {
    q: "Is any feature locked behind a paid edition?",
    a: "No. Every capability — SSO, roles, row filters, dynamic column masking, the SQL/BI gateway, dataset requests, shared datasets, audit logging, and the Helm chart — is 100% Apache-2.0 open source. There is no enterprise edition.",
  },
  {
    q: "Is Classifyre available as SaaS?",
    a: "No. Classifyre is never multi-tenant SaaS. It runs on your own infrastructure — Docker for evaluation, Kubernetes or OpenShift via Helm for production — operated by your own team or the integrator you already work with.",
  },
  {
    q: "Can I ask a question without committing to anything?",
    a: "Yes. Questions about whether Classifyre fits your sources, identity provider or infrastructure are welcome, and so are descriptions of setups the docs don't cover. Writing to us doesn't start a sales process.",
  },
  {
    q: "Can custom connectors or detectors stay private to our organisation?",
    a: "Yes. Connectors and detectors are modular plugins. You can contribute general improvements upstream to the open-source repository or keep organisation-specific integrations and business rules private in your own environment.",
  },
  {
    q: "Where do I report bugs or request features?",
    a: "Open an issue in the public GitHub repository so others can follow and add to it. If the details are sensitive, email contact@classifyre.com instead.",
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
          eyebrow="Support & Contact"
          title={
            <>
              Open source by default.
              <br />
              <span className="inline-block bg-accent px-[0.12em] text-black">
                Questions welcome.
              </span>
            </>
          }
          lede={
            <>
              Every capability in Classifyre is open source under Apache-2.0
              with no gated tiers, and runs on your own infrastructure. If
              you’re evaluating it, hit something the docs don’t cover, or
              have a setup we haven’t seen, write to us — we read every
              message.
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
                  href={`mailto:${contactEmail}?subject=${encodeURIComponent("Classifyre question")}`}
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

        {/* ── Questions we welcome ─────────────────────────────────────── */}
        <section aria-labelledby="support-topics-title">
          <SectionShell tone="plain">
            <div className="space-y-8">
              <SectionHead
                id="support-topics-title"
                marker="Questions welcome"
                title="Things we're happy to hear about"
                lede="No question is too early or too specific. These are the ones we get most often."
              />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {questionTopics.map((item, index) => (
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

        {/* ── How asking works + What to include ────────────────────────── */}
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
                    Straight to the engineers. No sales process.
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
                  <Marker label="Writing to us" />
                  <h3 className="font-sans text-xl font-bold text-white">
                    What helps when you write to us
                  </h3>
                  <p className="text-sm leading-6 text-white/75">
                    None of this is required, but a line on any of these points
                    helps us give you a concrete answer:
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
                      href={`mailto:${contactEmail}?subject=${encodeURIComponent("Classifyre question")}`}
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
          title="Questions about getting help."
          items={supportFaq}
          locale="en"
        />
      </main>
    </>
  );
}
