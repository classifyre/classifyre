import type { Locale } from "@/lib/locale";

import { CaseDemo } from "@/components/landing/case-demo";
import { Convert } from "@/components/landing/convert";
import { Faq } from "@/components/landing/faq";
import { Hero } from "@/components/landing/hero";
import { Journey } from "@/components/landing/journey";
// import { OpenSourceEnterprise } from "@/components/landing/open-source-enterprise";
import { Sectors } from "@/components/landing/sectors";
import { SourcesTape } from "@/components/landing/sources-tape";
import { Tension } from "@/components/landing/tension";

/**
 * The marketing landing page, shared by both locales.
 *
 * Section rhythm is deliberate: night band (hero) / paper (problem) /
 * night band (the journey, then the case file) / paper (sectors, editions) /
 * night band (conversion) / paper (FAQ), so the
 * page breathes as one document instead of repeating one section template.
 * The Nextra header and footer wrap this from the locale layouts.
 */
export function LandingPage({ locale }: { locale: Locale }) {
  return (
    <>
      {/* Without JS the in-view reveals never fire and stages never light:
          show everything. */}
      <noscript>
        <style>{".cl-reveal,.cl-stage{opacity:1 !important;transform:none !important}"}</style>
      </noscript>
      <main className="flex w-full flex-col">
        <Hero locale={locale} />
        <Tension locale={locale} />
        <SourcesTape locale={locale} />
        <Journey locale={locale} />
        <CaseDemo locale={locale} />
        <Sectors locale={locale} />
        {/* <OpenSourceEnterprise locale={locale} /> */}
        <Convert locale={locale} />
        <Faq locale={locale} />
      </main>
    </>
  );
}
