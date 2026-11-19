import type { Metadata } from "next";

import { Marker, PageHero, SectionShell } from "@/components/page-kit";

import "../../landing.css";

export const metadata: Metadata = {
  title: "Legal notice",
  description:
    "Legal notice of the Classifyre websites: media owner, business purpose and seat, as required by § 25 of the Austrian Media Act.",
  alternates: {
    canonical: "/impressum/",
    languages: {
      en: "/impressum/",
      de: "/de/impressum/",
      "x-default": "/impressum/",
    },
  },
  openGraph: {
    title: "Classifyre — Legal notice",
    description: "Who is behind the Classifyre websites.",
    type: "website",
  },
};

export default function ImpressumPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="Legal notice"
        title={
          <>
            Legal
            <span className="inline-block bg-accent px-[0.12em] text-black">
              notice
            </span>
          </>
        }
        lede="Who is behind the Classifyre websites."
      />
      <SectionShell>
        <div className="mx-auto max-w-3xl space-y-8">
          <div className="space-y-3">
            <Marker label="§ 25 MedienG" />
            <h2 className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.04em]">
              Disclosure pursuant to § 25(5) of the Austrian Media Act (MedienG)
            </h2>
          </div>
          <dl className="border-b-2 border-border text-base leading-7 text-muted-foreground">
            <div className="grid gap-1 border-t-2 border-border py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
              <dt className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">Media owner</dt>
              <dd>Michael Bender</dd>
            </div>
            <div className="grid gap-1 border-t-2 border-border py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
              <dt className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">Business purpose</dt>
              <dd>Development and support of open-source software for data governance</dd>
            </div>
            <div className="grid gap-1 border-t-2 border-border py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
              <dt className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">Seat</dt>
              <dd>Vienna, Austria</dd>
            </div>
          </dl>
          <p className="text-base leading-7 text-muted-foreground">
            Classifyre is licensed under Apache-2.0. See our{" "}
            <a
              href="/privacy/"
              className="text-foreground underline decoration-accent decoration-2 underline-offset-2 hover:text-accent"
            >
              Privacy Policy
            </a>
            {" "}for how we process personal data.
          </p>
        </div>
      </SectionShell>
    </main>
  );
}
