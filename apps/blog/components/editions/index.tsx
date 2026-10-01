import type { ReactNode } from "react";

import { cn } from "@workspace/ui/lib/utils";

import {
  getEditionsCopy,
  type EditionCell,
  type EditionRow,
} from "@/content/editions";
import type { Locale } from "@/lib/locale";
import { docs, enterpriseContactEmail, repoUrl, routes, showcaseUrlFor } from "@/lib/site";
import { ClosingBoard } from "@/components/closing-board";
import { Mascot } from "@/components/mascot";
import {
  Enter,
  ExhibitMark,
  LandingHead,
  LandingSection,
  Micro,
  Pin,
} from "@/components/landing/motifs";

/**
 * /open-source-vs-enterprise, in the case-dossier language of the landing
 * page: a black poster band, two edition slips (one of them inverted, the
 * governed one), the honest line-by-line ledger, and a soft closing.
 *
 * The whole point of the page is that the open-source column is not a
 * teaser: four of the five groups are identical. The layout is built to
 * make that visible; the enterprise column is the only lime one, and it
 * starts at Governance.
 */

/* ── Cells ──────────────────────────────────────────────────────────────── */

function Cell({
  value,
  emphasis,
  labels,
}: {
  value: EditionCell;
  emphasis: boolean;
  labels: { included: string; excluded: string };
}) {
  if (typeof value === "string") {
    return (
      <span
        className={cn(
          "font-mono text-[11px] uppercase leading-5 tracking-[0.08em]",
          emphasis
            ? "text-accent-ink dark:text-accent"
            : "text-muted-foreground",
        )}
      >
        {value}
      </span>
    );
  }

  if (value) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center border-2 border-accent bg-accent font-mono text-[13px] font-black text-accent-foreground"
        role="img"
        aria-label={labels.included}
      >
        ✓
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center border-2 border-foreground/40 font-mono text-[13px] text-muted-foreground"
      role="img"
      aria-label={labels.excluded}
    >
      –
    </span>
  );
}

/** One capability as a slip, the mobile shape of the comparison ledger. */
function RowCard({ row, labels }: { row: RowCardRow; labels: RowCardLabels }) {
  return (
    <div className="border-2 border-foreground/80 bg-background p-4">
      <p className="font-serif text-sm font-black uppercase leading-tight tracking-[0.04em]">
        {row.capability}
      </p>
      {row.detail ? (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{row.detail}</p>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-px bg-foreground/20">
        <div className="flex flex-col gap-1.5 bg-background p-3">
          <dt>
            <Micro className="text-muted-foreground">{labels.oss}</Micro>
          </dt>
          <dd>
            <Cell value={row.oss} emphasis={false} labels={labels.cell} />
          </dd>
        </div>
        <div className="flex flex-col gap-1.5 bg-background p-3">
          <dt>
            <Micro className="text-accent-ink dark:text-accent">{labels.ent}</Micro>
          </dt>
          <dd>
            <Cell value={row.ent} emphasis labels={labels.cell} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

type RowCardRow = EditionRow;
type RowCardLabels = {
  oss: string;
  ent: string;
  cell: { included: string; excluded: string };
};

/* ── Edition slips ──────────────────────────────────────────────────────── */

function EditionSlip({
  eyebrow,
  title,
  body,
  points,
  action,
  inverted = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  points: readonly string[];
  action: ReactNode;
  inverted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-5 border-2 p-6 sm:p-8",
        inverted
          ? "border-foreground bg-foreground text-primary-foreground"
          : "border-foreground/80 bg-background",
      )}
    >
      <Micro className={inverted ? "text-accent" : "text-accent-ink dark:text-accent"}>
        {eyebrow}
      </Micro>
      <h3 className="font-hero text-4xl uppercase leading-none tracking-[0.01em]">
        {title}
      </h3>
      <p
        className={cn(
          "text-sm leading-7",
          inverted ? "text-primary-foreground/75" : "text-muted-foreground",
        )}
      >
        {body}
      </p>
      <ul className="flex flex-col gap-2.5">
        {points.map((point) => (
          <li key={point} className="flex gap-3 text-sm leading-6">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 bg-accent" />
            <span className={inverted ? "text-primary-foreground/85" : ""}>
              {point}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-2">{action}</div>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export function EditionsPage({ locale }: { locale: Locale }) {
  const copy = getEditionsCopy(locale);
  const showcase = showcaseUrlFor(locale);

  return (
    <>
      <noscript>
        <style>{".cl-reveal{opacity:1 !important;transform:none !important}"}</style>
      </noscript>
      <main className="flex w-full flex-col">
        {/* ── Hero band ───────────────────────────────────────────────── */}
        <section
          aria-labelledby="editions-hero-title"
          className="cl-bleed relative overflow-hidden bg-black text-white"
        >
          <div className="landing-grid absolute inset-0 opacity-[0.10]" />
          <div className="relative mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
            <div className="grid items-center gap-10 lg:grid-cols-12">
              <div className="space-y-6 lg:col-span-8">
                <ExhibitMark>{copy.hero.mark}</ExhibitMark>
                <h1
                  id="editions-hero-title"
                  className="font-hero text-[clamp(3rem,8vw,6.5rem)] uppercase leading-[0.88] tracking-[0.01em] text-white"
                >
                  <span className="block">{copy.hero.titleA}</span>
                  <span className="block">
                    {copy.hero.titleBLead}{" "}
                    <span className="inline-block bg-accent px-[0.12em] text-black">
                      {copy.hero.titleBHighlight}
                    </span>
                  </span>
                </h1>
                <p className="max-w-2xl text-base leading-7 text-white/75 sm:text-lg sm:leading-8">
                  {copy.hero.lede}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={routes.get}
                    className="inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
                  >
                    {copy.hero.ctaPrimary}
                  </a>
                  <a
                    href={`mailto:${enterpriseContactEmail}`}
                    className="inline-flex items-center border-2 border-white/25 px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:border-accent hover:text-accent"
                  >
                    {copy.hero.ctaSecondary}
                  </a>
                </div>
              </div>

              {/* The investigator greets the enterprise reader. */}
              <div className="flex justify-center lg:col-span-4 lg:justify-end">
                <Mascot
                  name="looking-at-you"
                  alt={copy.mascots.lookingAtYou}
                  surface="dark"
                  className="h-56 w-auto lg:h-72"
                />
              </div>
            </div>

            {/* What gets compared: the ledger's index, threaded. */}
            <ul className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t-2 border-white/15 pt-5">
              {copy.comparison.groups.map((group) => (
                <li key={group.group} className="flex items-center gap-2">
                  <Pin />
                  <Micro className="text-white/55">{group.group}</Micro>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── The two editions ────────────────────────────────────────── */}
        <LandingSection className="py-20 lg:py-28">
          <div aria-labelledby="editions-title">
            <LandingHead
              id="editions-title"
              mark={copy.editions.mark}
              title={copy.editions.title}
              lede={copy.editions.lede}
            />

            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              <Enter>
                <EditionSlip
                  eyebrow={copy.editions.core.eyebrow}
                  title={copy.editions.core.title}
                  body={copy.editions.core.body}
                  points={copy.editions.core.points}
                  action={
                    <div className="flex flex-wrap gap-3">
                      <a
                        href={routes.get}
                        className="inline-flex items-center border-2 border-accent bg-accent px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-foreground hover:bg-foreground hover:text-background"
                      >
                        {copy.editions.core.ctaPrimary}
                      </a>
                      <a
                        href={repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center border-2 border-foreground/40 px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] transition-colors hover:border-foreground"
                      >
                        {copy.editions.core.ctaSecondary}
                      </a>
                    </div>
                  }
                />
              </Enter>
              <Enter delayMs={90}>
                <EditionSlip
                  inverted
                  eyebrow={copy.editions.governed.eyebrow}
                  title={copy.editions.governed.title}
                  body={copy.editions.governed.body}
                  points={copy.editions.governed.points}
                  action={
                    <div className="flex flex-wrap items-center gap-3">
                      <a
                        href={`mailto:${enterpriseContactEmail}`}
                        className="inline-flex items-center border-2 border-accent bg-accent px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
                      >
                        {copy.editions.governed.ctaPrimary}
                      </a>
                      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-primary-foreground/60">
                        {enterpriseContactEmail}
                      </span>
                    </div>
                  }
                />
              </Enter>
            </div>
          </div>
        </LandingSection>

        {/* ── How an engagement runs ─────────────────────────────────── */}
        <section
          aria-labelledby="engagement-title"
          className="cl-bleed relative overflow-hidden bg-black text-white"
        >
          <div className="landing-grid absolute inset-0 opacity-[0.08]" />
          <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-10 lg:py-24">
            <LandingHead
              id="engagement-title"
              mark={copy.engagement.marker}
              title={copy.engagement.title}
              lede={copy.engagement.lede}
              tone="dark"
              aside={
                <Mascot
                  name="hidden-gem"
                  alt={copy.mascots.hiddenGem}
                  surface="dark"
                  className="hidden h-40 w-auto lg:block"
                />
              }
            />

            <ol className="relative mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
              {/* One thread through the engagement, pin per step. */}
              <span
                aria-hidden="true"
                className="absolute left-0 right-0 top-[5px] hidden h-0.5 bg-accent/30 lg:block"
              />
              {copy.engagement.steps.map((step) => (
                <li key={step.no} className="relative">
                  <div className="flex items-center gap-3">
                    <Pin />
                    <span className="font-hero text-3xl leading-none text-accent">
                      {step.no}
                    </span>
                  </div>
                  <h3 className="mt-4 font-serif text-base font-black uppercase tracking-[0.04em]">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-7 text-white/65">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── The ledger ──────────────────────────────────────────────── */}
        <LandingSection className="pb-20 lg:pb-28" width="wide">
          <div aria-labelledby="comparison-title" id="comparison">
            <LandingHead
              id="comparison-title"
              mark={copy.comparison.mark}
              title={copy.comparison.title}
              lede={copy.comparison.lede}
            />

            {/* Desktop: one continuous ledger. Below lg the same data renders
                as slips, because a three-column table with prose in it is
                unreadable on a phone no matter how it is scrolled. */}
            <div className="mt-12 hidden overflow-hidden border-2 border-foreground/80 lg:block">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">{copy.comparison.caption}</caption>
                <thead>
                  <tr className="bg-foreground text-primary-foreground">
                    <th
                      scope="col"
                      className="w-1/2 px-5 py-4"
                    >
                      <Micro>{copy.comparison.columns.capability}</Micro>
                    </th>
                    <th scope="col" className="w-1/4 px-5 py-4">
                      <Micro>{copy.comparison.columns.oss}</Micro>
                    </th>
                    {/* A lime block rather than lime text: the header bar is
                        painted with bg-foreground, which flips with the theme,
                        and accent text is unreadable on its light side. */}
                    <th
                      scope="col"
                      className="w-1/4 border-l-2 border-accent bg-accent px-5 py-4 text-accent-foreground"
                    >
                      <Micro>{copy.comparison.columns.ent}</Micro>
                    </th>
                  </tr>
                </thead>
                {copy.comparison.groups.map((group) => (
                  <tbody key={group.group}>
                    <tr className="border-t-2 border-foreground/80 bg-muted/50">
                      <th scope="colgroup" colSpan={3} className="px-5 py-3 text-left">
                        <span className="font-serif text-base font-black uppercase tracking-[0.06em]">
                          {group.group}
                        </span>
                        <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          {group.summary}
                        </span>
                      </th>
                    </tr>
                    {group.rows.map((row) => (
                      <tr
                        key={row.capability}
                        className="border-t-2 border-foreground/25 align-top"
                      >
                        <th scope="row" className="px-5 py-4 text-left font-normal">
                          <span className="font-mono text-[12px] font-bold uppercase tracking-[0.08em]">
                            {row.capability}
                          </span>
                          {row.detail ? (
                            <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                              {row.detail}
                            </span>
                          ) : null}
                        </th>
                        <td className="px-5 py-4">
                          <Cell
                            value={row.oss}
                            emphasis={false}
                            labels={{
                              included: copy.comparison.included,
                              excluded: copy.comparison.excluded,
                            }}
                          />
                        </td>
                        <td className="border-l-2 border-accent bg-accent/5 px-5 py-4">
                          <Cell
                            value={row.ent}
                            emphasis
                            labels={{
                              included: copy.comparison.included,
                              excluded: copy.comparison.excluded,
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>

            {/* Mobile / tablet */}
            <div className="mt-10 space-y-6 lg:hidden">
              {copy.comparison.groups.map((group) => (
                <div key={group.group} className="space-y-3">
                  <div className="border-l-2 border-accent pl-4">
                    <h3 className="font-serif text-lg font-black uppercase tracking-[0.06em]">
                      {group.group}
                    </h3>
                    <p className="font-mono text-[10px] uppercase leading-5 tracking-[0.12em] text-muted-foreground">
                      {group.summary}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {group.rows.map((row) => (
                      <RowCard
                        key={row.capability}
                        row={row}
                        labels={{
                          oss: copy.comparison.columns.oss,
                          ent: copy.comparison.columns.ent,
                          cell: {
                            included: copy.comparison.included,
                            excluded: copy.comparison.excluded,
                          },
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* The wall is free; the lock is not. */}
            <div className="mt-10 border-2 border-foreground/25 bg-muted/50 p-6 sm:p-8">
              <p className="max-w-3xl text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">
                {copy.comparison.workspaceNote}
              </p>
              <a
                href={docs.workspaces}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent-ink underline-offset-4 hover:underline dark:text-accent"
              >
                {copy.comparison.workspaceCta} →
              </a>
            </div>
          </div>
        </LandingSection>

        {/* ── Closing ─────────────────────────────────────────────────── */}
        <section
          aria-labelledby="editions-cta-title"
          className="cl-bleed relative overflow-hidden bg-black text-white"
        >
          <ClosingBoard locale={locale} />
          <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6 lg:py-24">
            <h2
              id="editions-cta-title"
              className="font-hero text-[clamp(2.5rem,7vw,5rem)] uppercase leading-[0.88] tracking-[0.01em]"
            >
              {copy.closing.titleLead}{" "}
              <span className="inline-block bg-accent px-[0.12em] text-black">
                {copy.closing.titleHighlight}
              </span>
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/70">
              {copy.closing.lede}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <a
                href={routes.get}
                className="inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
              >
                {copy.closing.ctaPrimary}
              </a>
              <a
                href={`mailto:${enterpriseContactEmail}`}
                className="inline-flex items-center border-2 border-white/25 px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:border-accent hover:text-accent"
              >
                {copy.closing.ctaSecondary}
              </a>
            </div>
            <a
              href={showcase}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/50 underline-offset-4 hover:text-accent hover:underline"
            >
              {copy.closing.ctaTertiary} →
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
