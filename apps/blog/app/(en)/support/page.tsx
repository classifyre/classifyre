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
import { contactEmail, docs, routes } from "@/lib/site";

import "../../landing.css";

export const metadata: Metadata = {
  title: "Support & Tailored Deployments",
  description:
    "Classifyre is 100% Apache-2.0 open source with no enterprise tiers. Work directly with our engineering team when you need custom IAM integration, bespoke connectors, Delta data products, or custom detectors.",
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
      "100% open source with direct engineering support for IAM, custom sources, Delta data products, detectors, and Kubernetes/OpenShift rollouts.",
    type: "website",
  },
};

const topics: readonly { marker: string; title: string; body: string }[] = [
  {
    marker: "IAM & org design",
    title: "Identity, security, and organisational fit",
    body: "Align Classifyre with complex Active Directory, Entra ID, Okta, or custom IAM architectures, multi-tenant workspace models, and your internal security and data protection policies.",
  },
  {
    marker: "Custom sources",
    title: "Connectors for proprietary or legacy systems",
    body: "Connectors are open-source plugins. When your organisation relies on industry-specific databases, custom APIs, or legacy systems not yet in the catalogue, we can build and maintain the connector with you.",
  },
  {
    marker: "Data products",
    title: "Delta data products and sharing workflows",
    body: "Design governed shared datasets, Delta Sharing pipelines, and plain-language business request workflows with owner approval and inherited column and row masking.",
  },
  {
    marker: "Detectors & AI",
    title: "Business-specific detectors and models",
    body: "Go beyond standard PII: build custom regex and Python checks, fine-tune lightweight local CPU AI models (such as GLiNER2), or configure domain-specific LLM classifiers inside your own environment.",
  },
  {
    marker: "Infrastructure",
    title: "Kubernetes, OpenShift, and air-gapped setup",
    body: "Architecture review and production rollout on Kubernetes, OpenShift, on-premises data centres, or private/public clouds (AWS, Azure, GCP), including sizing, TLS, and performance tuning.",
  },
  {
    marker: "Guided pilot",
    title: "4–6 week pilot on your real data",
    body: "Connect priority sources, map your directory groups, verify row filters and column masks in Power BI and Excel, publish your first governed data product, and produce an audit report for leadership.",
  },
];

export default function SupportPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="Support & Tailoring"
        title={
          <>
            Open source by default.
            <br />
            <span className="inline-block bg-accent px-[0.12em] text-black">
              Tailored for your org.
            </span>
          </>
        }
        lede={
          <>
            Every feature in Classifyre is open source under Apache-2.0 — there
            is no gated enterprise edition. Deploy and operate everything
            yourself, or work directly with the engineers who build Classifyre
            when you need custom IAM integration, proprietary sources, Delta
            data products, or tailored detectors and models.
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
                href={`mailto:${contactEmail}?subject=${encodeURIComponent("Tailored Classifyre rollout")}`}
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
              <a href={routes.get}>Deployment guide</a>
            </Button>
          </>
        }
      />

      <section aria-labelledby="support-topics-title">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="support-topics-title"
              marker="How we help"
              title="Direct engineering support, scoped to your needs"
              lede="Whether you are in Europe, North America, or elsewhere, you speak directly with the engineers who write and maintain Classifyre."
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
              Same open-source core.{" "}
              <span className="inline-block bg-accent px-[0.12em] text-black">
                Built around your team.
              </span>
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/75">
              Start by evaluating the open-source release on your own
              infrastructure, or write to us to scope a pilot or custom
              integration.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
              >
                <a href={`mailto:${contactEmail}`}>Contact our team</a>
              </Button>
              <DocsLink href={docs.deployment} tone="signal">
                Deployment docs
              </DocsLink>
            </div>
          </div>
        </SectionShell>
      </section>
    </main>
  );
}
