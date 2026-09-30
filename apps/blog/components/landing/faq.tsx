import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTitle,
  AccordionTrigger,
} from "@workspace/ui/components";

import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import {
  LandingHead,
  LandingSection,
  Micro,
} from "@/components/landing/motifs";

/**
 * FAQ, set as the last exhibit: hairline rows on the reading measure, with
 * the questions people actually type into search engines: what the thing
 * is, what it costs, where the data lives, how it differs from the incumbents.
 * The same Q&A ships as FAQPage structured data in the page's JSON-LD.
 */
export function Faq({ locale }: { locale: Locale }) {
  const copy = getLandingCopy(locale);

  return (
    <LandingSection className="py-20 lg:py-28">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-24">
            <LandingHead
              id="faq-title"
              mark={copy.faq.marker}
              title={copy.faq.title}
              lede={copy.faq.lede || undefined}
            />
          </div>
        </div>

        <div className="lg:col-span-8">
          <Accordion type="single" collapsible className="w-full">
            {copy.faq.items.map((item, index) => (
              <AccordionItem
                key={item.q}
                value={`faq-${index}`}
                className="rounded-none border-0 border-t-2 border-foreground/80 bg-transparent last:border-b-2"
              >
                <AccordionTrigger className="border-0 bg-transparent px-0 py-5 text-foreground hover:bg-transparent [&_.accordion-chevron]:text-accent-ink dark:[&_.accordion-chevron]:text-accent">
                  <AccordionTitle className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground sm:text-xs">
                    {item.q}
                  </AccordionTitle>
                </AccordionTrigger>
                <AccordionContent className="bg-transparent px-0 pb-6">
                  <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">
                    {item.a}
                  </p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <Micro className="mt-8 block text-muted-foreground">
            {locale === "de"
              ? "Mehr Detail in der Dokumentation · docs.classifyre.com"
              : "More detail lives in the docs · docs.classifyre.com"}
          </Micro>
        </div>
      </div>
    </LandingSection>
  );
}
