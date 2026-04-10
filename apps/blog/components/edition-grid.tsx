import Link from "next/link";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components";
import { softwareVersion } from "@workspace/ui/lib/software-version";

const enterpriseContactEmail = "contact@classifyre.com";

const editionCards = [
  {
    name: "Docker",
    eyebrow: "Open core preview",
    description:
      "Run the all-in-one image locally to test the workflow, show the product, and get a feel for how Classifyre works.",
    highlights: [
      "One command runtime on port 3000",
      "Best for testing, demos, and internal evaluation",
      "Not the production topology",
    ],
    ctaLabel: "Docker docs",
    ctaHref: "https://docs.classifyre.com/deployment/docker/",
    ctaExternal: true,
    marker: "DKR",
    accentClassName: "bg-card text-foreground",
  },
  {
    name: "Kubernetes Core",
    eyebrow: "Open source production",
    description:
      "Deploy the open-source core with Helm into your cluster. This is the production-ready self-hosted path.",
    highlights: [
      `Helm install pinned to ${softwareVersion}`,
      "Production-ready on your Kubernetes cluster",
      "Enterprise controls and SLA not included",
    ],
    ctaLabel: "Kubernetes docs",
    ctaHref: "https://docs.classifyre.com/deployment/kubernetes/",
    ctaExternal: true,
    marker: "K8S",
    accentClassName: "bg-card text-foreground",
  },
  {
    name: "Enterprise",
    eyebrow: "Enterprise package",
    description:
      "Turn the open-source core into a supported platform for regulated, global, and heavily customized deployments.",
    highlights: [
      "Authorization, governance, and SLA-backed support",
      "Cloud deployment support across Kubernetes and OpenShift",
      "Multilanguage support plus custom sources and detectors",
      `Contact ${enterpriseContactEmail} for pricing`,
    ],
    ctaLabel: "Contact us",
    ctaHref: `mailto:${enterpriseContactEmail}`,
    ctaExternal: true,
    marker: "ENT",
    accentClassName: "bg-accent text-accent-foreground",
  },
] as const;

export function EditionGrid() {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {editionCards.map((edition) => (
        <Card
          key={edition.name}
          className={`panel-card rounded-[20px] border-2 ${edition.accentClassName}`}
        >
          <CardHeader className="gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <Badge
                  variant="secondary"
                  className="w-fit rounded-[4px] border border-border bg-background/70 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-foreground"
                >
                  {edition.eyebrow}
                </Badge>
                <div className="space-y-2">
                  <CardTitle className="text-3xl uppercase tracking-[0.06em]">
                    {edition.name}
                  </CardTitle>
                  <p className="max-w-xl text-sm text-current/80">
                    {edition.description}
                  </p>
                </div>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-border bg-background/80">
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em]">
                  {edition.marker}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-5">
            <ul className="space-y-3 text-sm">
              {edition.highlights.map((highlight) => (
                <li key={highlight} className="flex items-start gap-3">
                  <span className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 border border-current" />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
            <div className="mt-auto flex flex-wrap items-center gap-3">
              <Button
                asChild
                className="border-2 border-border bg-background text-foreground hover:bg-background/90"
              >
                {edition.ctaExternal ? (
                  <a href={edition.ctaHref} target="_blank" rel="noreferrer">
                    {edition.ctaLabel}
                  </a>
                ) : (
                  <Link href={edition.ctaHref}>{edition.ctaLabel}</Link>
                )}
              </Button>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.14em] text-foreground/70">
                {edition.marker === "DKR"
                  ? "Testing and evaluation"
                  : edition.marker === "K8S"
                    ? "Open source production"
                    : "Commercial support"}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
