import {
  DockerRunBlock,
  HelmLogo,
  KubernetesLogo,
} from "@workspace/ui/components";

import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import { withLocalePrefix } from "@/lib/locale";
import {
  docs,
  helmInstallCommand,
  repoUrl,
  routes,
  showcaseUrlFor,
  softwareVersion,
} from "@/lib/site";
import { ClosingBoard } from "@/components/closing-board";
import {
  LandingHead,
  Micro,
  Pin,
} from "@/components/landing/motifs";

/**
 * Open source closing section:
 * Left: self-host the complete Apache-2.0 platform via Docker, Kubernetes, or OpenShift.
 * Right: an invitation to ask questions or describe an unusual setup. Deliberately not
 * an offer: no plans, prices, subscriptions or services are advertised here.
 */
export function Convert({ locale }: { locale: Locale }) {
  const copy = getLandingCopy(locale);
  const showcase = showcaseUrlFor(locale);
  const supportHref = `${withLocalePrefix(locale, routes.support)}/`;
  const deployHref = `${withLocalePrefix(locale, routes.get)}/`;

  return (
    <section
      id="run-it"
      aria-labelledby="convert-title"
      className="cl-bleed relative overflow-hidden bg-black text-white"
    >
      <ClosingBoard locale={locale} />

      <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
        <LandingHead
          id="convert-title"
          mark={copy.convert.marker}
          title={copy.convert.title}
          lede={copy.convert.lede}
          tone="dark"
        />

        <div className="mt-14 grid gap-12 lg:grid-cols-12 lg:gap-10">
          {/* Left: Self-hosted deployment (Docker + Kubernetes/OpenShift) */}
          <div className="space-y-6 lg:col-span-6">
            <div className="space-y-2">
              <h3 className="font-sans text-xl font-bold text-white">
                {copy.install.title}
              </h3>
              <p className="max-w-2xl text-sm leading-7 text-white/70 sm:text-base">
                {copy.install.lede}
              </p>
            </div>

            <div className="border-2 border-white/20 bg-white/[0.04] p-5 sm:p-6">
              <Micro className="text-white/55">{copy.install.dockerLabel}</Micro>
              <DockerRunBlock
                tone="dark"
                tag={softwareVersion}
                className="mt-3"
                showNotes={false}
              />
            </div>

            <div className="border-2 border-white/20 bg-white/[0.04] p-5 sm:p-6">
              <Micro className="text-accent">{copy.install.helmLabel}</Micro>
              <h4 className="mt-2 font-sans text-base font-bold text-white">
                {copy.install.helmTitle}
              </h4>
              <p className="mt-2 text-sm leading-6 text-white/70">
                {copy.install.helmCopy}
              </p>
              <div className="mt-4 flex items-center gap-5 border-2 border-white/15 bg-black/40 px-4 py-3.5">
                <KubernetesLogo className="h-9 w-9 shrink-0 text-accent" />
                <span aria-hidden="true" className="h-7 w-px bg-white/20" />
                <HelmLogo className="h-9 w-9 shrink-0 text-accent" />
                <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] leading-6 text-white/80">
                  <code>{helmInstallCommand.join("\n")}</code>
                </pre>
              </div>
              <div className="mt-4 flex flex-wrap gap-5">
                <a
                  href={docs.kubernetes}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent underline-offset-4 hover:underline"
                >
                  {copy.install.helmCtaDocs} →
                </a>
                <a
                  href={`${repoUrl}/blob/main/helm/classifyre/README.md`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent underline-offset-4 hover:underline"
                >
                  {copy.install.helmCtaRepo} →
                </a>
              </div>
            </div>
          </div>

          {/* Right: questions & contact (not a sales offer) */}
          <div className="flex flex-col justify-between gap-8 border-2 border-white/20 bg-white/[0.03] p-6 sm:p-8 lg:col-span-6">
            <div className="space-y-6">
              <div className="space-y-2">
                <Micro className="text-accent">{copy.convert.marker}</Micro>
                <h3 className="font-sans text-xl font-bold text-white">
                  {copy.convert.tailoringTitle}
                </h3>
                <p className="text-sm leading-7 text-white/70 sm:text-base">
                  {copy.convert.tailoringLede}
                </p>
              </div>

              <ol className="space-y-5 border-l-2 border-accent/40 pl-5">
                {copy.convert.paths.map((path) => (
                  <li key={path.label} className="relative">
                    <span aria-hidden="true" className="absolute -left-[1.72rem] top-1.5">
                      <Pin />
                    </span>
                    <p className="font-sans text-sm font-bold text-white">
                      {path.label}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-white/65">
                      {path.text}
                    </p>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-4 border-t border-white/15 pt-6">
              <div className="flex flex-wrap gap-3">
                <a
                  href={supportHref}
                  className="inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
                >
                  {copy.convert.ctaPrimary}
                </a>
                <a
                  href={deployHref}
                  className="inline-flex items-center border-2 border-white/25 px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:border-accent hover:text-accent"
                >
                  {copy.convert.ctaSecondary}
                </a>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1">
                <a
                  href={showcase}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-2"
                >
                  <Pin solid={false} />
                  <Micro className="text-white/60 transition-colors group-hover:text-accent">
                    {copy.convert.ctaShowcase} →
                  </Micro>
                </a>
                <a href={`${withLocalePrefix(locale, routes.blog)}/`} className="group flex items-center gap-2">
                  <Pin solid={false} />
                  <Micro className="text-white/60 transition-colors group-hover:text-accent">
                    {copy.convert.ctaBlog} →
                  </Micro>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
