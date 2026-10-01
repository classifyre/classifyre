import {
  DockerRunBlock,
  HelmLogo,
  KubernetesLogo,
} from "@workspace/ui/components";

import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import {
  docs,
  enterpriseContactEmail,
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
 * Conversion: "open your first case tonight" on the string-board backdrop.
 * Three honest paths (laptop, cluster, enterprise) and no form anywhere.
 * The enterprise line is deliberately the quietest thing in the section.
 */
export function Convert({ locale }: { locale: Locale }) {
  const copy = getLandingCopy(locale);
  const showcase = showcaseUrlFor(locale);

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
          {/* The two ways to run it */}
          <div className="space-y-6 lg:col-span-7">
            <div className="space-y-2">
              <h3 className="font-serif text-lg font-black uppercase tracking-[0.04em] sm:text-xl">
                {copy.install.title}
              </h3>
              <p className="max-w-2xl text-sm leading-7 text-white/60 sm:text-base sm:leading-8">
                {copy.install.lede}
              </p>
            </div>

            <div className="border-2 border-white/20 bg-white/[0.04] p-5 sm:p-6">
              <Micro className="text-white/45">{copy.install.dockerLabel}</Micro>
              <DockerRunBlock
                tone="dark"
                tag={softwareVersion}
                className="mt-3"
                showNotes={false}
              />
            </div>

            <div className="border-2 border-white/20 bg-white/[0.04] p-5 sm:p-6">
              <Micro className="text-accent">{copy.install.helmLabel}</Micro>
              <h4 className="mt-2 font-serif text-base font-black uppercase tracking-[0.04em]">
                {copy.install.helmTitle}
              </h4>
              <p className="mt-2 text-sm leading-7 text-white/60">
                {copy.install.helmCopy}
              </p>
              <div className="mt-4 flex items-center gap-6 border-2 border-white/15 bg-white/[0.04] px-5 py-4">
                <KubernetesLogo className="h-10 w-10 text-accent" />
                <span aria-hidden="true" className="h-8 w-px bg-white/20" />
                <HelmLogo className="h-10 w-10 text-accent" />
                <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] leading-6 text-white/70">
                  <code>{helmInstallCommand.join("\n")}</code>
                </pre>
              </div>
              <div className="mt-4 flex flex-wrap gap-4">
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

          {/* Three paths, one thread */}
          <div className="flex flex-col gap-10 lg:col-span-5">
            <ol className="space-y-6 border-l-2 border-accent/40 pl-5">
              {copy.convert.paths.map((path) => (
                <li key={path.label} className="relative">
                  <span aria-hidden="true" className="absolute -left-[1.72rem] top-1.5">
                    <Pin />
                  </span>
                  <Micro className="text-white/85">{path.label}</Micro>
                  <p className="mt-1 text-sm leading-6 text-white/60">
                    {path.text}
                  </p>
                </li>
              ))}
            </ol>

            <div className="flex flex-col gap-3">
              <a
                href={routes.get}
                className="inline-flex w-fit items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
              >
                {copy.convert.ctaPrimary}
              </a>
              <a
                href={showcase}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center border-2 border-white/25 px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:border-accent hover:text-accent"
              >
                {copy.convert.ctaSecondary}
              </a>
              <a
                href={`mailto:${enterpriseContactEmail}`}
                className="group mt-2 flex items-center gap-2"
              >
                <Pin solid={false} />
                <Micro className="text-white/55 transition-colors group-hover:text-accent">
                  {copy.convert.ctaEnterprise} →
                </Micro>
              </a>
              <a href={routes.blog} className="group flex items-center gap-2">
                <Pin solid={false} />
                <Micro className="text-white/55 transition-colors group-hover:text-accent">
                  {copy.convert.ctaBlog} →
                </Micro>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
