import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import { withLocalePrefix } from "@/lib/locale";
import { routes } from "@/lib/site";
import { Micro } from "@/components/landing/motifs";
import { SourceMarquee } from "@/components/source-showcase";

/**
 * The connector tape: a thin full-bleed band of the source systems
 * Classifyre reads, drifting like a ticker. It sits between the problem and
 * the method (the answer to "but what does it actually read?") and reuses
 * the schema-derived connector catalogue, so new connectors appear here
 * without a copy edit.
 */
export function SourcesTape({ locale }: { locale: Locale }) {
  const copy = getLandingCopy(locale);
  const stage = copy.method.stages[0];
  if (!stage) return null;

  return (
    <div className="cl-bleed border-y-2 border-foreground/80 bg-background">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <Micro className="text-accent-ink dark:text-accent">
            {stage.title}
          </Micro>
          <a
            href={`${withLocalePrefix(locale, routes.sources)}/`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {stage.linkLabel} →
          </a>
        </div>
        <SourceMarquee />
      </div>
    </div>
  );
}
