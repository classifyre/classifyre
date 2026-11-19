import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import { withLocalePrefix } from "@/lib/locale";
import { enterpriseContactEmail, routes } from "@/lib/site";
import { Mascot } from "@/components/mascot";
import {
  Enter,
  LandingHead,
  LandingSection,
  Micro,
  Pin,
} from "@/components/landing/motifs";

/**
 * The open-source / Enterprise split: the ledger of everything that is
 * open (all of it) beside what a company pays for: people, never features.
 */
export function OpenSourceEnterprise({ locale }: { locale: Locale }) {
  const copy = getLandingCopy(locale);
  const e = copy.editions;

  return (
    <LandingSection className="py-20 lg:py-28">
      <div aria-labelledby="editions-title">
        <LandingHead
          id="editions-title"
          mark={e.marker}
          title={e.title}
          lede={e.lede}
          aside={
            <Mascot
              name="hidden-gem"
              alt={copy.mascots.hiddenGem}
              className="hidden h-44 w-auto lg:block"
            />
          }
        />

        <div className="mt-12 grid gap-6 lg:grid-cols-12">
          {/* The ledger of what is open: all of it. */}
          <Enter className="lg:col-span-5">
            <div className="h-full border-2 border-foreground/80 bg-card p-6 sm:p-8">
              <Micro className="text-accent-ink dark:text-accent">{e.oss.sub}</Micro>
              <h3 className="mt-3 font-hero text-4xl uppercase leading-none">{e.oss.title}</h3>
              <ul className="mt-6 space-y-2.5">
                {e.oss.items.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm leading-6">
                    <span
                      aria-hidden="true"
                      className="mt-2 size-2 shrink-0 bg-accent-ink dark:bg-accent"
                    />
                    {item}
                  </li>
                ))}
              </ul>
              <Micro className="mt-6 block text-muted-foreground">Apache-2.0</Micro>
            </div>
          </Enter>

          {/* What Enterprise is: our people on your project. */}
          <Enter className="lg:col-span-7" delayMs={120}>
            <div className="h-full border-2 border-black bg-black p-6 text-white sm:p-8 dark:border-white/20">
              <Micro className="text-accent">{e.ent.sub}</Micro>
              <h3 className="mt-3 font-hero text-4xl uppercase leading-none">{e.ent.title}</h3>
              <ol className="mt-6 grid gap-x-8 gap-y-6 border-l-2 border-accent/40 pl-5 sm:grid-cols-2 sm:border-l-0 sm:pl-0">
                {e.ent.items.map((item) => (
                  <li key={item.title} className="relative">
                    <div className="flex items-center gap-2">
                      <Pin />
                      <span className="font-serif text-sm font-black uppercase tracking-[0.04em]">
                        {item.title}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-white/65">{item.body}</p>
                  </li>
                ))}
              </ol>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href={`mailto:${enterpriseContactEmail}?subject=Classifyre%20pilot`}
                  className="inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
                >
                  {e.ctaPilot}
                </a>
                <a
                  href={`${withLocalePrefix(locale, routes.editions)}/`}
                  className="inline-flex items-center border-2 border-white/25 px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:border-accent hover:text-accent"
                >
                  {e.ctaCompare}
                </a>
              </div>
            </div>
          </Enter>
        </div>
      </div>
    </LandingSection>
  );
}
