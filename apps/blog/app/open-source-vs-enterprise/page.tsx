import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Button } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";

import { Illustration } from "@/components/illustration";
import {
  Marker,
  PageHero,
  SectionHead,
  SectionShell,
} from "@/components/page-kit";
import {
  demoUrl,
  docs,
  enterpriseContactEmail,
  repoUrl,
  routes,
} from "@/lib/site";

import "../landing.css";

export const metadata: Metadata = {
  title: "Open Source vs Enterprise",
  description:
    "A plain comparison of Classifyre's open-source core and the enterprise layer. Every detection, investigation, and deployment feature is open source; enterprise adds SSO, roles, per-workspace authorization, tuned models, and SLA-backed support.",
  alternates: { canonical: routes.editions },
  openGraph: {
    title: "Classifyre — Open Source vs Enterprise",
    description:
      "Detection, investigations, autopilot, and both runtimes are open source. Enterprise adds the governance layer and our engineers.",
    type: "website",
  },
};

/**
 * `oss` / `ent` are either a boolean (rendered as a tick or a dash) or a
 * short string when the two editions differ by degree rather than presence.
 * Nothing in the open-source column is a teaser for a paid feature — that is
 * the entire point of the page, so the data is written to make it obvious.
 */
type Row = {
  capability: string;
  detail?: string;
  oss: boolean | string;
  ent: boolean | string;
};

type RowGroup = {
  group: string;
  summary: string;
  rows: Row[];
};

const COMPARISON: readonly RowGroup[] = [
  {
    group: "Detection",
    summary: "Identical. The engine is the open-source project.",
    rows: [
      {
        capability: "Every source connector",
        detail: "Databases, lakehouses, collaboration tools, storage, streams",
        oss: true,
        ent: true,
      },
      {
        capability: "Built-in detector packs",
        detail: "PII, secrets, code security, threats, content quality",
        oss: true,
        ent: true,
      },
      {
        capability: "Custom detectors",
        detail: "Regex, entity classification, Hugging Face models, any LLM",
        oss: true,
        ent: "Built with you",
      },
      {
        capability: "Semantic ranking",
        detail: "Importance 0–1 with written reasons, not just severity",
        oss: true,
        ent: "Calibrated to your corpus",
      },
      {
        capability: "Detection tuned to your terminology",
        detail: "Models trained so a term means what it means at your company",
        oss: false,
        ent: true,
      },
      {
        capability: "Multilanguage detection tuning",
        oss: false,
        ent: true,
      },
    ],
  },
  {
    group: "Investigation",
    summary: "Identical. Cases are the product, in both editions.",
    rows: [
      {
        capability: "Findings, inquiries, and fingerprints",
        oss: true,
        ent: true,
      },
      {
        capability: "Cases, hypotheses, and evidence trails",
        oss: true,
        ent: true,
      },
      {
        capability: "Harness AI autopilot",
        detail: "Five agents working the investigation between scans",
        oss: true,
        ent: "Tuned to your workflows",
      },
      {
        capability: "In-app assistant and MCP server",
        detail: "Drive the whole product from your own AI client",
        oss: true,
        ent: true,
      },
      { capability: "Notifications and data export", oss: true, ent: true },
    ],
  },
  {
    group: "Deployment",
    summary: "Identical. No runtime is held back.",
    rows: [
      {
        capability: "Desktop app",
        detail: "macOS, Windows, Linux — PostgreSQL embedded",
        oss: true,
        ent: true,
      },
      {
        capability: "Helm chart on Kubernetes",
        detail: "Scales as far as the estate demands",
        oss: true,
        ent: true,
      },
      {
        capability: "Workspace isolation",
        detail: "Own schema, evidence, AI memory, and endpoint per workspace",
        oss: true,
        ent: true,
      },
      {
        capability: "OpenShift",
        detail: "With upgrade assistance from our engineers",
        oss: false,
        ent: true,
      },
    ],
  },
  {
    group: "Governance",
    summary: "The real difference — the lock on the cabinet.",
    rows: [
      { capability: "Single sign-on (SSO)", oss: false, ent: true },
      { capability: "Roles and permissions", oss: false, ent: true },
      {
        capability: "Per-workspace authorization",
        detail: "An auditor opens the audit workspace and nothing else",
        oss: false,
        ent: true,
      },
    ],
  },
  {
    group: "People",
    summary: "What you get besides software.",
    rows: [
      {
        capability: "Support",
        oss: "GitHub issues",
        ent: "SLA-backed, named engineers",
      },
      {
        capability: "Onboarding",
        oss: "Docs and the demo",
        ent: "Guided pilot, architecture review",
      },
      {
        capability: "Roadmap influence",
        oss: "Open issues and PRs",
        ent: "Direct, on your industry's data",
      },
      { capability: "Price", oss: "Free, forever", ent: "Talk to us" },
    ],
  },
];

function Cell({
  value,
  emphasis,
}: {
  value: boolean | string;
  emphasis: boolean;
}) {
  if (typeof value === "string") {
    return (
      <span
        className={cn(
          "font-mono text-[11px] uppercase leading-5 tracking-[0.08em]",
          emphasis
            ? "text-accent-foreground/80 dark:text-accent"
            : "text-muted-foreground",
        )}
      >
        {value}
      </span>
    );
  }

  if (value) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center border-2 border-accent bg-accent font-mono text-[13px] font-black text-black"
        role="img"
        aria-label="Included"
      >
        ✓
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center border-2 border-border font-mono text-[13px] text-muted-foreground"
      role="img"
      aria-label="Not included"
    >
      –
    </span>
  );
}

/** One capability as a card — the mobile shape of the comparison table. */
function RowCard({ row }: { row: Row }) {
  return (
    <div className="border-2 border-border bg-background p-4">
      <p className="font-serif text-sm font-black uppercase leading-tight tracking-[0.04em]">
        {row.capability}
      </p>
      {row.detail ? (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {row.detail}
        </p>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-px bg-border">
        <div className="flex flex-col gap-1.5 bg-background p-3">
          <dt className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Open source
          </dt>
          <dd>
            <Cell value={row.oss} emphasis={false} />
          </dd>
        </div>
        <div className="flex flex-col gap-1.5 bg-background p-3">
          <dt className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-accent-foreground/70 dark:text-accent">
            Enterprise
          </dt>
          <dd>
            <Cell value={row.ent} emphasis />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function EditionCard({
  eyebrow,
  title,
  body,
  points,
  action,
  featured = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  points: readonly string[];
  action: ReactNode;
  featured?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-4 border-2 bg-background p-6 sm:p-8",
        featured
          ? "border-accent shadow-[6px_6px_0_var(--color-accent)]"
          : "border-border shadow-[6px_6px_0_var(--color-border)]",
      )}
    >
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        {eyebrow}
      </span>
      <h3 className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.04em]">
        {title}
      </h3>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
      <ul className="flex flex-col gap-2">
        {points.map((point) => (
          <li
            key={point}
            className="flex gap-3 text-sm leading-6 text-muted-foreground"
          >
            <span
              aria-hidden="true"
              className="mt-2 h-1.5 w-1.5 shrink-0 bg-accent"
            />
            {point}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-2">{action}</div>
    </div>
  );
}

export default function EditionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">

      {/* ── The two editions ─────────────────────────────────────────────── */}
      <section aria-labelledby="editions-title">
        <SectionShell tone="plain" fullWidth>
          <div className="space-y-8">
            <SectionHead
              id="editions-title"
              marker="At a glance"
              title="Same engine. Different room."
              lede="The open-source core is the whole product, not a funnel into a paid one. What enterprise sells is governance, tuning, and people — the things a large organisation actually cannot self-serve."
            />

            <div className="grid gap-4 lg:grid-cols-2">
              <EditionCard
                eyebrow="Open source · free forever"
                title="Core"
                body="Everything that detects, investigates, and deploys. Run it on a laptop or across a cluster, for as long as you like, with no seat count and no expiry."
                points={[
                  "Every connector, detector pack, and custom detector tier",
                  "Inquiries, fingerprints, cases, and the Harness AI autopilot",
                  "Desktop app and the Helm chart, both fully featured",
                  "Workspace isolation is in the core and always on",
                ]}
                action={
                  <div className="flex flex-wrap gap-3">
                    <Button
                      asChild
                      className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
                    >
                      <a href={routes.download}>Download</a>
                    </Button>
                    <Button
                      asChild
                      variant="secondary"
                      className="border-2 border-border"
                    >
                      <a href={repoUrl} target="_blank" rel="noreferrer">
                        Source
                      </a>
                    </Button>
                  </div>
                }
              />
              <EditionCard
                featured
                eyebrow="Enterprise · a partnership"
                title="Governed"
                body="The core plus the lock on the cabinet, and engineers who learn your domain. Our people work with your team from the first pilot rather than handing over a license key."
                points={[
                  "SSO, roles, and per-workspace authorization",
                  "Models tuned on your terminology and languages",
                  "Detectors and sources built for your industry's data",
                  "Architecture reviews, OpenShift, SLA-backed support",
                ]}
                action={
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      asChild
                      className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
                    >
                      <a href={`mailto:${enterpriseContactEmail}`}>
                        Start the conversation
                      </a>
                    </Button>
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      {enterpriseContactEmail}
                    </span>
                  </div>
                }
              />
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── The table ────────────────────────────────────────────────────── */}
      <section aria-labelledby="comparison-title" id="comparison">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="comparison-title"
              marker="Line by line"
              title="The whole comparison"
              lede="Four of the five groups below are identical between editions."
            />

            {/* Desktop: one continuous table. Below lg the same data renders
                as cards, because a three-column table with prose in it is
                unreadable on a phone no matter how it is scrolled. */}
            <div className="hidden overflow-hidden border-2 border-border lg:block">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">
                  Feature comparison between the Classifyre open-source core and
                  the enterprise edition
                </caption>
                <thead>
                  <tr className="bg-foreground text-primary-foreground">
                    <th
                      scope="col"
                      className="w-1/2 px-5 py-4 font-mono text-[11px] font-bold uppercase tracking-[0.18em]"
                    >
                      Capability
                    </th>
                    <th
                      scope="col"
                      className="w-1/4 px-5 py-4 font-mono text-[11px] font-bold uppercase tracking-[0.18em]"
                    >
                      Open source
                    </th>
                    {/* A lime block rather than lime text: the header bar is
                        painted with bg-foreground, which flips with the theme,
                        and accent text is unreadable on its light side. */}
                    <th
                      scope="col"
                      className="w-1/4 border-l-2 border-accent bg-accent px-5 py-4 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black"
                    >
                      Enterprise
                    </th>
                  </tr>
                </thead>
                {COMPARISON.map((section) => (
                  <tbody key={section.group}>
                    <tr className="border-t-2 border-border bg-muted/40">
                      <th
                        scope="colgroup"
                        colSpan={3}
                        className="px-5 py-3 text-left"
                      >
                        <span className="font-serif text-base font-black uppercase tracking-[0.06em]">
                          {section.group}
                        </span>
                        <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          {section.summary}
                        </span>
                      </th>
                    </tr>
                    {section.rows.map((row) => (
                      <tr
                        key={row.capability}
                        className="border-t-2 border-border align-top"
                      >
                        <th
                          scope="row"
                          className="px-5 py-4 text-left font-normal"
                        >
                          <span className="font-mono text-[12px] font-bold uppercase tracking-[0.08em]">
                            {row.capability}
                          </span>
                          {row.detail ? (
                            <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                              {row.detail}
                            </span>
                          ) : null}
                        </th>
                        <td className="px-5 py-4">
                          <Cell value={row.oss} emphasis={false} />
                        </td>
                        <td className="border-l-2 border-accent bg-accent/5 px-5 py-4">
                          <Cell value={row.ent} emphasis />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>

            {/* Mobile / tablet */}
            <div className="space-y-6 lg:hidden">
              {COMPARISON.map((section) => (
                <div key={section.group} className="space-y-3">
                  <div className="border-l-2 border-accent pl-4">
                    <h3 className="font-serif text-lg font-black uppercase tracking-[0.06em]">
                      {section.group}
                    </h3>
                    <p className="font-mono text-[10px] uppercase leading-5 tracking-[0.12em] text-muted-foreground">
                      {section.summary}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {section.rows.map((row) => (
                      <RowCard key={row.capability} row={row} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-2 border-border bg-background p-5">
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Workspace isolation lives in the open-source core and is always
                on — a workspace has its own database schema, evidence, AI
                memory, and endpoint. Enterprise does not add the wall; it adds
                the <em>authorization</em> that decides who may open which
                drawer.
              </p>
              <Button
                asChild
                variant="secondary"
                className="border-2 border-border"
              >
                <a href={docs.workspaces} target="_blank" rel="noreferrer">
                  How workspaces work
                </a>
              </Button>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── Closing ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="editions-cta-title">
        <SectionShell tone="signal" fullWidth className="bg-black">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 py-4 text-center text-white">
            <h2
              id="editions-cta-title"
              className="font-hero text-[clamp(2.5rem,7vw,5rem)] uppercase leading-[0.88] tracking-[0.01em]"
            >
              Start free.{" "}
              <span className="inline-block bg-accent px-[0.12em] text-black">
                Call us later.
              </span>
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/70">
              Almost everyone starts on the open-source core and stays there.
              The conversation is worth having when SSO, roles, and a tuned
              model start mattering more than the scan itself.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
              >
                <a href={"/download"} target="_blank" rel="noreferrer">
                  Download the free core
                </a>
              </Button>
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
              >
                <a href={`mailto:${enterpriseContactEmail}`}>
                  Talk about enterprise
                </a>
              </Button>
            </div>
            <a
              href={demoUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/50 underline-offset-4 hover:text-accent hover:underline"
            >
              Or poke at the live demo first
            </a>
          </div>
        </SectionShell>
      </section>
    </main>
  );
}
