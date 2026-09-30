import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import { Mascot } from "@/components/mascot";
import {
  LandingHead,
  LandingSection,
  Micro,
} from "@/components/landing/motifs";

/**
 * Sectors: the page's index. Same method everywhere, so the sector only
 * decides which signals get defined first, set as a paper index with three
 * columns and hairline rules, not as ten cards. The investigator watches
 * from the right margin while you scan the list.
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
          aside={
            <Mascot
              name="looking-at-you"
              alt={copy.mascots.lookingAtYou}
              className="hidden h-44 w-auto lg:block"
            />
          }
        />

        <div className="mt-12">
          {/* Column heads, desktop only; mobile gets per-field labels. */}
          <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1.15fr)] gap-8 border-b-2 border-foreground/80 pb-2 lg:grid">
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
                className="grid gap-2 border-b border-foreground/20 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1.15fr)] lg:items-baseline lg:gap-8"
              >
                <span className="font-serif text-sm font-black uppercase leading-tight tracking-[0.03em]">
                  {row.sector}
                </span>
                <span className="text-sm leading-6 text-muted-foreground">
                  <Micro className="mr-2 lg:hidden">
                    {copy.sectors.columns.data}
                  </Micro>
                  {row.data}
                </span>
                <span className="text-sm leading-6 text-foreground/85">
                  <Micro className="mr-2 lg:hidden">
                    {copy.sectors.columns.finds}
                  </Micro>
                  {row.finds}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-6 max-w-3xl">
          <Micro className="leading-5 text-muted-foreground/80">
            {copy.sectors.footnote}
          </Micro>
        </p>
      </div>
    </LandingSection>
  );
}
