import { ArrowRight, Database, ShieldCheck, BarChart3 } from "lucide-react";

import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import {
  LandingHead,
  LandingSection,
  Micro,
  Enter,
} from "@/components/landing/motifs";

/**
 * Why Classifyre: architectural clarity showing how Classifyre sits cleanly
 * between existing data sources and governed consumption tools without
 * forcing a stack migration.
 */
function ArchitectureDiagram({ locale }: { locale: Locale }) {
  const { diagram, figureCaption } = getLandingCopy(locale).tension;

  return (
    <figure className="flex h-full flex-col justify-between border-2 border-foreground/80 bg-card p-5 sm:p-7 shadow-[6px_6px_0_var(--color-border)]">
      {/* 3-stage architecture flow */}
      <div className="my-auto grid gap-4 md:grid-cols-[1fr_auto_1.2fr_auto_1fr] md:items-stretch">
        {/* Left: existing sources */}
        <div className="flex flex-col border-2 border-foreground/25 bg-background p-4">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-muted-foreground" aria-hidden="true" />
            <Micro className="text-muted-foreground">{diagram.leftLabel}</Micro>
          </div>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-foreground/85">
            {diagram.leftSources.map((src) => (
              <li
                key={src}
                className="border border-foreground/15 bg-muted/30 px-2.5 py-1.5 font-mono text-[11px]"
              >
                {src}
              </li>
            ))}
          </ul>
        </div>

        <div className="hidden items-center justify-center text-muted-foreground md:flex" aria-hidden="true">
          <ArrowRight className="size-4" />
        </div>

        {/* Center: Classifyre Governance Layer */}
        <div className="flex flex-col border-2 border-black bg-black p-4 text-white dark:border-accent">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-accent" aria-hidden="true" />
            <Micro className="text-accent">{diagram.centerSub}</Micro>
          </div>
          <p className="mt-2 font-serif text-base font-black uppercase leading-tight tracking-[0.03em] text-white">
            {diagram.centerTitle}
          </p>
          <ul className="mt-4 space-y-2">
            {diagram.centerPillars.map((pillar) => (
              <li
                key={pillar}
                className="flex items-center gap-2 border border-white/15 bg-white/[0.06] px-2.5 py-1.5 font-mono text-[11px] text-white/90"
              >
                <span aria-hidden="true" className="size-1.5 shrink-0 bg-accent" />
                {pillar}
              </li>
            ))}
          </ul>
        </div>

        <div className="hidden items-center justify-center text-muted-foreground md:flex" aria-hidden="true">
          <ArrowRight className="size-4" />
        </div>

        {/* Right: governed consumption */}
        <div className="flex flex-col border-2 border-foreground/25 bg-background p-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="size-4 text-muted-foreground" aria-hidden="true" />
            <Micro className="text-muted-foreground">{diagram.rightLabel}</Micro>
          </div>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-foreground/85">
            {diagram.rightTools.map((tool) => (
              <li
                key={tool}
                className="border border-foreground/15 bg-muted/30 px-2.5 py-1.5 font-mono text-[11px]"
              >
                {tool}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <figcaption className="mt-6 border-t border-foreground/15 pt-4">
        <Micro className="text-muted-foreground">{figureCaption}</Micro>
      </figcaption>
    </figure>
  );
}

export function Tension({ locale }: { locale: Locale }) {
  const copy = getLandingCopy(locale);
  return (
    <LandingSection className="py-20 lg:py-28">
      <div aria-labelledby="tension-title">
        <LandingHead
          id="tension-title"
          mark={copy.tension.marker}
          title={copy.tension.title}
          lede={copy.tension.lede}
        />

        <div className="mt-14 grid gap-10 lg:grid-cols-12 lg:items-stretch">
          <div className="min-w-0 lg:col-span-7">
            <ArchitectureDiagram locale={locale} />
          </div>

          <ul className="min-w-0 grid gap-6 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
            {copy.tension.notes.map((note, index) => (
              <Enter key={note.label} as="li" delayMs={index * 80}>
                <div className="border-t-2 border-foreground/80 pt-4">
                  <Micro className="text-accent-ink dark:text-accent">
                    {note.label}
                  </Micro>
                  <h3 className="mt-2 font-sans text-base font-bold leading-snug text-foreground">
                    {note.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    {note.body}
                  </p>
                </div>
              </Enter>
            ))}
          </ul>
        </div>

        <Enter className="mt-12">
          <div className="border-2 border-foreground/20 bg-muted/40 p-6 sm:p-8">
            <p className="max-w-4xl text-base font-medium leading-8 text-foreground sm:text-lg">
              {copy.tension.kicker}
            </p>
          </div>
        </Enter>
      </div>
    </LandingSection>
  );
}
