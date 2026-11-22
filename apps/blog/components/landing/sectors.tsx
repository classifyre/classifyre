import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import { withLocalePrefix } from "@/lib/locale";
import {
  LandingHead,
  LandingSection,
  Micro,
} from "@/components/landing/motifs";

/**
 * Real-world multi-group governance scenarios across industries and teams.
 */
export function Sectors({ locale }: { locale: Locale }) {
  const copy = getLandingCopy(locale);

  return (
    <LandingSection className="py-20 lg:py-28">
      <div aria-labelledby="sectors-title">
        <LandingHead
          id="sectors-title"
          mark={copy.sectors.marker}
          title={copy.sectors.title}
          lede={copy.sectors.lede}
        />

        <div className="mt-12">
          <div className="hidden grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.4fr)] gap-8 border-b-2 border-foreground/80 pb-2.5 lg:grid">
            <Micro className="text-muted-foreground">
              {copy.sectors.columns.sector}
            </Micro>
            <Micro className="text-muted-foreground">
              {copy.sectors.columns.data}
            </Micro>
            <Micro className="text-muted-foreground">
              {copy.sectors.columns.finds}
            </Micro>
          </div>

          <ul>
            {copy.sectors.rows.map((row) => (
              <li
                key={row.sector}
                className="grid gap-2 border-b border-foreground/20 py-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.4fr)] lg:items-baseline lg:gap-8"
              >
                <span className="font-sans text-base font-bold leading-snug text-foreground">
                  {row.sector}
                </span>
                <span className="text-sm leading-6 text-muted-foreground">
                  <Micro className="mr-2 lg:hidden">
                    {copy.sectors.columns.data}
                  </Micro>
                  {row.data}
                </span>
                <span className="text-sm leading-6 text-foreground/90">
                  <Micro className="mr-2 lg:hidden">
                    {copy.sectors.columns.finds}
                  </Micro>
                  {row.finds}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-6 max-w-3xl text-sm text-muted-foreground">
          {copy.sectors.footnote}
        </p>

        <nav aria-label={copy.sectors.marker} className="mt-6 flex flex-wrap gap-x-6 gap-y-2.5">
          {copy.sectors.links.map((link) => (
            <a
              key={link.href}
              href={`${withLocalePrefix(locale, link.href)}/`}
              className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-accent-ink underline-offset-4 hover:underline dark:text-accent"
            >
              {link.label} →
            </a>
          ))}
        </nav>
      </div>
    </LandingSection>
  );
}
