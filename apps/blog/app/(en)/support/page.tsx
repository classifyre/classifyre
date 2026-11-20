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
  title: "Support",
  description:
    "Classifyre is open source with every feature included. If you need help with setup, installation, a connector, or tailoring Classifyre to your organisation, contact us.",
  alternates: {
    canonical: "/support/",
    languages: {
      en: "/support/",
      de: "/de/support/",
      "x-default": "/support/",
    },
  },
  openGraph: {
    title: "Classifyre support",
    description:
      "No tiers, no enterprise build. Help with setup, connectors and tailoring, on request.",
    type: "website",
  },
};

const topics: readonly { marker: string; title: string; body: string }[] = [
  {
    marker: "Setup",
    title: "Setup and installation",
    body: "One Docker image tonight, or the Helm chart on Kubernetes — on-premises, in your own cloud, or on public cloud infrastructure like AWS, Azure or Google Cloud. If you get stuck, or want someone to look over the setup, write to us.",
  },
  {
    marker: "Connectors",
    title: "A connector for your systems",
    body: "Connectors are plugins and the project is open source, so a pull request is always welcome. If you need a connector for your industry's systems and would rather we build it, tell us which systems.",
  },
  {
    marker: "Tailoring",
    title: "Fitting your organisation",
    body: "Mapping your directory groups and access rules, row filters per team, masks on the right columns, the first Power BI connection, an access report your DPO can sign off. A four-to-six-week pilot covers all of it on a real system.",
  },
  {
    marker: "Questions",
    title: "Questions about the product",
    body: "How the masking holds in your tools, which detectors fit your data, where something should live. The same address reaches the people who wrote the code.",
  },
];

export default function SupportPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="Support"
        title={
          <>
            Need help?
            <br />
            <span className="inline-block bg-accent px-[0.12em] text-black">
              Write to us.
            </span>
          </>
        }
        lede={
          <>
            Classifyre is open source and every feature is included — there is
            no enterprise edition and nothing to switch to. If you need help
            with setup or installation, a connector for your systems, or
            tailoring Classifyre to fit your organisation, contact us. You or
            your integrator can also run everything yourselves.
          </>
        }
        actions={
          <>
            <Button
              asChild
              size="lg"
              className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
            >
              <a href={`mailto:${contactEmail}?subject=${encodeURIComponent("Classifyre support")}`}>
                {contactEmail}
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
            >
              <a href={routes.get}>Get Classifyre</a>
            </Button>
          </>
        }
      />

      <section aria-labelledby="support-topics-title">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="support-topics-title"
              marker="What we help with"
              title="Setup, connectors, tailoring, questions"
              lede="Support is a conversation, not a tier. Everything below is help on request, on the same open-source product."
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
              Same product.{" "}
              <span className="inline-block bg-accent px-[0.12em] text-black">
                Help on request.
              </span>
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/70">
              No tiers, no gated features. Run it yourself tonight, or write
              to us first — either way you are running the same Classifyre.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
              >
                <a href={`mailto:${contactEmail}`}>Contact us</a>
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
