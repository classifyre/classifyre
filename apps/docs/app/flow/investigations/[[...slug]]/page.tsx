import Link from "next/link";
import type { Metadata } from "next";

import { RedirectClient } from "./redirect-client";

// The Investigations section moved from /flow/investigations/ to
// /investigations/. These stubs keep the old URLs alive in the static export.
const MOVED_ROUTES: string[][] = [
  [],
  ["inquiry"],
  ["fingerprints"],
  ["cases"],
  ["cases", "hypothesis"],
  ["cases", "timeline"],
  ["cases", "graph"],
  ["autopilot"],
  ["autopilot", "agents"],
  ["autopilot", "cycle"],
  ["autopilot", "memory"],
  ["autopilot", "steering"],
  ["autopilot", "flight-recorder"],
];

export function generateStaticParams() {
  return MOVED_ROUTES.map((slug) => ({ slug }));
}

export const dynamicParams = false;

export const metadata: Metadata = {
  title: "Moved to Investigations",
  robots: { index: false, follow: true },
};

export default async function MovedInvestigationsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const target = `/investigations/${slug?.length ? `${slug.join("/")}/` : ""}`;

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-start justify-center gap-4 px-6 py-16">
      <RedirectClient target={target} />
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
        This page moved
      </p>
      <h1 className="font-serif text-2xl font-black uppercase tracking-[0.06em]">
        Investigations has a new home
      </h1>
      <p className="text-muted-foreground">
        Investigations now lives at the top level of the docs. If you are not
        redirected automatically, follow the link below.
      </p>
      <Link
        href={target}
        className="border-2 border-border bg-accent px-4 py-2 font-mono text-sm font-bold uppercase tracking-[0.1em] text-accent-foreground"
      >
        Go to {target}
      </Link>
    </main>
  );
}
