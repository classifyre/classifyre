import type { CSSProperties } from "react";

import {
  DockerLogo,
  DockerRunBlock,
  dockerRunLines,
  HelmLogo,
  KubernetesLogo,
} from "@workspace/ui/components";

import { getGetCopy } from "@/content/get";
import { getDockerNotes, getTranslationsForLocale } from "@/i18n";
import type { Locale } from "@/lib/locale";
import { withLocalePrefix } from "@/lib/locale";
import {
  docs,
  helmChartRef,
  helmInstallCommand,
  repoUrl,
  routes,
  showcaseUrlFor,
  softwareVersion,
} from "@/lib/site";
import { Mascot } from "@/components/mascot";
import {
  DotRow,
  Enter,
  LandingHead,
  Micro,
  Pin,
} from "@/components/landing/motifs";

/**
 * /get ("Get Classifyre"), in the case-dossier language of the landing page:
 * a black poster band with the investigator on watch, the two ways to run it
 * as evidence cards on paper, the first run threaded along a lime rail, and a
 * memo closing the file. Shared by both locales; every string comes from
 * `@/content/get`, every URL from `@/lib/site`.
 */

/* ── Thread rail: the evidence line the first run hangs on ─────────────── */

function ThreadRail() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 2 100"
      preserveAspectRatio="none"
      className="absolute bottom-8 left-1 top-2 hidden w-2 sm:block"
    >
      <line
        x1="1"
        y1="0"
        x2="1"
        y2="100"
        stroke="#b7ff00"
        strokeOpacity="0.4"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1="1"
        y1="0"
        x2="1"
        y2="100"
        stroke="#b7ff00"
        strokeWidth="3"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        className="cl-travel"
        style={{ "--cl-dur": "5s" } as CSSProperties}
      />
    </svg>
  );
}

/** A version-pinned shell command in the card's paper palette. */
function CommandBlock({
  label,
  command,
}: {
  label: string;
  command: string;
}) {
  return (
    <div className="min-w-0">
      <Micro className="text-muted-foreground">{label}</Micro>
      {/* min-w-0 lets the pre's own overflow-x-auto win: without it the
          unbreakable OCI ref would size the whole grid track. */}
      <pre className="mt-2 min-w-0 overflow-x-auto border-2 border-foreground/15 bg-background px-3 py-3 font-mono text-[11px] leading-6 text-foreground/85 sm:text-xs">
        <code>{command}</code>
      </pre>
    </div>
  );
}

export function GetPage({ locale }: { locale: Locale }) {
  const copy = getGetCopy(locale);
  const showcase = showcaseUrlFor(locale);
  /** Localized marketing routes keep the site's trailing-slash convention. */
  const localized = (path: string): string =>
    locale === "de" ? `${withLocalePrefix("de", path)}/` : path;
  const dockerLines = dockerRunLines(softwareVersion, getDockerNotes(locale));
  const dockerCopy = getTranslationsForLocale(locale).docker;

  return (
    <>
      {/* Without JS the in-view reveals never fire; show everything. */}
      <noscript>
        <style>{".cl-reveal{opacity:1 !important;transform:none !important}"}</style>
      </noscript>
      <main className="flex w-full flex-col">
        {/* ── Hero band ─────────────────────────────────────────────── */}
        <section
          aria-labelledby="get-hero-title"
          className="cl-bleed relative overflow-hidden bg-black text-white"
        >
          <div className="landing-grid absolute inset-0 opacity-[0.10]" />
          <div className="relative mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
            <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
              <div className="space-y-7 lg:col-span-8">
                <h1
                  id="get-hero-title"
                  className="font-hero text-[clamp(3rem,8vw,6.5rem)] uppercase leading-[0.88] tracking-[0.01em] text-white"
                >
                  <span className="block">{copy.hero.titleLead}</span>
                  <span className="block">
                    <span className="inline-block bg-accent px-[0.12em] text-black">
                      {copy.hero.titleHighlight}
                    </span>
                  </span>
                </h1>

                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href="#docker"
                    className="inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
                  >
                    {copy.hero.ctaDocker}
                  </a>
                  <a
                    href="#kubernetes"
                    className="inline-flex items-center border-2 border-white/25 px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:border-accent hover:text-accent"
                  >
                    {copy.hero.ctaKubernetes}
                  </a>
                </div>

                <Micro className="block text-white/40">
                  v{softwareVersion} · {copy.hero.micro}
                </Micro>
              </div>

              {/* The investigator on watch beside the headline. */}
              <div className="flex justify-center lg:col-span-4 lg:justify-end">
                <Mascot
                  name="looking-around"
                  alt={copy.mascots.lookingAround}
                  surface="dark"
                  eager
                  className="hidden h-44 w-auto lg:block"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── Quick start: both run commands, side by side ──────────── */}
        <section aria-labelledby="quickstart-title">
          <div className="mx-auto w-full max-w-7xl px-4 pt-20 sm:px-6 lg:px-10 lg:pt-24">
            <LandingHead
              id="quickstart-title"
              mark={copy.quickstart.marker}
              title={copy.quickstart.title}
              lede={copy.quickstart.lede}
            />

            <div className="mt-12 grid items-stretch gap-6 lg:grid-cols-2">
              {/* Docker: one image, tonight. */}
              <div
                id="docker"
                className="flex min-w-0 flex-col gap-4 border-2 border-foreground/80 bg-card p-5 sm:p-6"
              >
                <div className="flex items-center gap-4">
                  <DockerLogo className="h-10 w-10 shrink-0 text-accent-ink dark:text-accent" />
                  <Micro className="text-accent-ink dark:text-accent">
                    {copy.docker.cardLabel}
                  </Micro>
                </div>
                <DockerRunBlock lines={dockerLines} copy={dockerCopy} />
                <p className="mt-auto text-sm leading-6 text-muted-foreground">
                  {copy.docker.footnote.beforeHost}
                  <span className="font-mono text-foreground">
                    {copy.docker.footnote.host}
                  </span>
                  {copy.docker.footnote.afterHost}
                  <a
                    href={docs.docker}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground underline decoration-accent decoration-2 underline-offset-4"
                  >
                    {copy.docker.footnote.linkLabel}
                  </a>
                  {copy.docker.footnote.afterLink}
                </p>
              </div>

              {/* Helm: the same core, on your cluster. */}
              <div
                id="kubernetes"
                className="flex min-w-0 flex-col gap-4 border-2 border-foreground/80 bg-card p-5 sm:p-6"
              >
                <div>
                  <Micro className="text-accent-ink dark:text-accent">
                    {copy.kubernetes.helmLabel}
                  </Micro>
                  <h3 className="mt-2 font-serif text-lg font-black uppercase tracking-[0.04em]">
                    {copy.kubernetes.helmTitle}
                  </h3>
                </div>
                <CommandBlock
                  label={copy.kubernetes.installLabel}
                  command={helmInstallCommand.join("\n")}
                />
                <div className="flex items-center gap-6">
                  <KubernetesLogo className="h-10 w-10 shrink-0 text-accent-ink dark:text-accent" />
                  <span
                    aria-hidden="true"
                    className="h-8 w-px bg-foreground/20"
                  />
                  <HelmLogo className="h-10 w-10 shrink-0 text-accent-ink dark:text-accent" />
                </div>
                <div className="mt-auto flex flex-wrap gap-4">
                  <a
                    href={docs.kubernetes}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent-ink underline-offset-4 hover:underline dark:text-accent"
                  >
                    {copy.kubernetes.ctaDocs} →
                  </a>
                  <a
                    href={`${repoUrl}/blob/main/helm/classifyre/README.md`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent-ink underline-offset-4 hover:underline dark:text-accent"
                  >
                    {copy.kubernetes.ctaChartReadme} →
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Docker in depth ────────────────────────────────────────── */}
        <section id="docker-details" aria-labelledby="docker-title">
          <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
            <LandingHead
              id="docker-title"
              mark={copy.docker.marker}
              title={copy.docker.title}
              lede={copy.docker.lede}
            />

            {/* What the image brings with it: hairline editorial rows. */}
            <div className="mt-14 grid gap-x-10 sm:grid-cols-2">
              {copy.docker.includes.map((item, index) => (
                <Enter key={item.title} delayMs={index * 70}>
                  <article className="border-t-2 border-foreground/80 py-5">
                    <h3 className="font-serif text-base font-black uppercase tracking-[0.04em]">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {item.body}
                    </p>
                  </article>
                </Enter>
              ))}
            </div>
          </div>
        </section>

        {/* ── First run, threaded ───────────────────────────────────── */}
        <section
          aria-labelledby="first-run-title"
          className="cl-bleed relative overflow-hidden bg-black text-white"
        >
          <div className="landing-grid absolute inset-0 opacity-[0.08]" />
          <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
            <LandingHead
              id="first-run-title"
              mark={copy.firstRun.marker}
              title={copy.firstRun.title}
              lede={copy.firstRun.lede}
              tone="dark"
              aside={
                <a
                  href={copy.firstRun.action.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent underline-offset-4 hover:underline"
                >
                  {copy.firstRun.action.label} →
                </a>
              }
            />

            <ol className="relative mt-14 sm:pl-10">
              {/* The thread itself, with a pulse of evidence running down it. */}
              <ThreadRail />

              {copy.firstRun.steps.map((step, index) => (
                <Enter key={step.step} as="li" delayMs={index * 70}>
                  <article className="relative border-t-2 border-white/12 py-8 sm:py-10">
                    {/* Pin on the thread */}
                    <span
                      aria-hidden="true"
                      className="absolute -left-[2.45rem] top-9 hidden sm:block"
                    >
                      <Pin className="cl-pin-pulse size-3 bg-black" />
                    </span>

                    <div className="grid gap-5 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-10">
                      <div className="flex items-baseline gap-4 lg:flex-col lg:gap-1">
                        <span className="font-hero text-5xl leading-none text-accent">
                          {step.step}
                        </span>
                      </div>

                      <div className="max-w-3xl space-y-3">
                        <h3 className="font-serif text-lg font-black uppercase leading-tight tracking-[0.04em] sm:text-xl">
                          {step.title}
                        </h3>
                        <p className="text-sm leading-7 text-white/65 sm:text-base sm:leading-8">
                          {step.body}
                        </p>
                        {step.href ? (
                          <a
                            href={step.href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block pt-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent underline-offset-4 hover:underline"
                          >
                            {step.hrefLabel} →
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </article>
                </Enter>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Kubernetes ────────────────────────────────────────────── */}
        <section id="kubernetes-details" aria-labelledby="kubernetes-title">
          <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
            <LandingHead
              id="kubernetes-title"
              mark={copy.kubernetes.marker}
              title={copy.kubernetes.title}
              lede={copy.kubernetes.lede}
            />

            <div className="mt-12 grid items-start gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              {/* Inspect before installing */}
              <div className="flex min-w-0 flex-col gap-5 border-2 border-foreground/80 bg-card p-5 sm:p-6">
                <CommandBlock
                  label={copy.kubernetes.inspectLabel}
                  command={`helm show chart ${helmChartRef}`}
                />
              </div>

              {/* Prerequisites + images: the paper index. */}
              <div className="flex min-w-0 flex-col gap-6">
                <div>
                  <Micro className="text-accent-ink dark:text-accent">
                    {copy.kubernetes.prerequisitesLabel}
                  </Micro>
                  <div className="mt-3 space-y-2">
                    {copy.kubernetes.prerequisites.map((item) => (
                      <DotRow key={item.label} label={item.label} value={item.value} />
                    ))}
                  </div>
                </div>

                <div className="border-t-2 border-foreground/25 pt-5">
                  <Micro className="text-accent-ink dark:text-accent">
                    {copy.kubernetes.imagesLabel}
                  </Micro>
                  <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    {copy.kubernetes.imagesValue}
                  </p>
                </div>
              </div>
            </div>

            {/* Deeper reading, pinned straight to the docs. */}
            <ul className="mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {copy.kubernetes.docs.map((item, index) => (
                <Enter key={item.href} as="li" delayMs={index * 70}>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex h-full gap-3"
                  >
                    <span aria-hidden="true" className="mt-1.5 shrink-0">
                      <Pin />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-serif text-base font-black uppercase leading-tight tracking-[0.04em]">
                        {item.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {item.body}
                      </p>
                      <span className="mt-2 inline-block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent-ink underline-offset-4 group-hover:underline dark:text-accent">
                        {copy.kubernetes.docsLinkLabel} →
                      </span>
                    </div>
                  </a>
                </Enter>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Which one ─────────────────────────────────────────────── */}
        <section aria-labelledby="which-title">
          <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
            <LandingHead
              id="which-title"
              mark={copy.which.marker}
              title={copy.which.title}
              lede={copy.which.lede}
            />

            <div className="mt-12 grid gap-10 md:grid-cols-2">
              {[
                {
                  head: copy.which.dockerHead,
                  points: copy.which.dockerPoints,
                },
                {
                  head: copy.which.kubernetesHead,
                  points: copy.which.kubernetesPoints,
                },
              ].map((column) => (
                <div key={column.head} className="border-t-2 border-foreground/80 pt-5">
                  <h3 className="font-serif text-lg font-black uppercase tracking-[0.04em]">
                    {column.head}
                  </h3>
                  <ul className="mt-4 flex flex-col gap-2">
                    {column.points.map((point) => (
                      <li
                        key={point}
                        className="flex gap-3 text-sm leading-6 text-muted-foreground"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-2 size-1.5 shrink-0 bg-accent"
                        />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* The enterprise layer, said out loud: one memo, no card grid. */}
            <Enter className="mt-12">
              <div className="border-2 border-foreground/25 bg-muted/50 p-6 sm:p-8">
                <Micro className="text-accent-ink dark:text-accent">
                  {copy.which.marker}
                </Micro>
                <p className="mt-3 max-w-4xl text-base leading-8 sm:text-lg sm:leading-9">
                  {copy.which.enterpriseNote}
                </p>
                <a
                  href={localized(routes.editions)}
                  className="mt-5 inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-foreground hover:bg-foreground hover:text-background"
                >
                  {copy.which.enterpriseCta}
                </a>
              </div>
            </Enter>
          </div>
        </section>

        {/* ── Closing ───────────────────────────────────────────────── */}
        <section
          aria-labelledby="download-cta-title"
          className="cl-bleed relative overflow-hidden bg-black text-white"
        >
          <div className="landing-grid absolute inset-0 opacity-[0.10]" />
          <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
            <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
              <h2
                id="download-cta-title"
                className="font-hero text-[clamp(2.5rem,7vw,5rem)] uppercase leading-[0.88] tracking-[0.01em]"
              >
                {copy.closing.titleLead}{" "}
                <span className="inline-block bg-accent px-[0.12em] text-black">
                  {copy.closing.titleHighlight}
                </span>
              </h2>
              <p className="max-w-xl text-base leading-7 text-white/70">
                {copy.closing.body}
              </p>
              <div className="flex w-full flex-wrap items-start justify-center gap-3">
                <div className="w-full max-w-2xl">
                  <DockerRunBlock
                    tone="dark"
                    lines={dockerLines}
                    copy={dockerCopy}
                  />
                </div>
                <a
                  href={showcase}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center border-2 border-white/25 px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:border-accent hover:text-accent"
                >
                  {copy.closing.ctaShowcase}
                </a>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.12em] text-white/50">
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-4 hover:text-accent hover:underline"
                >
                  {copy.closing.linkSource}
                </a>
                <a
                  href={localized(routes.sources)}
                  className="underline-offset-4 hover:text-accent hover:underline"
                >
                  {copy.closing.linkSources}
                </a>
                <a
                  href={docs.root}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-4 hover:text-accent hover:underline"
                >
                  {copy.closing.linkDocs}
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
