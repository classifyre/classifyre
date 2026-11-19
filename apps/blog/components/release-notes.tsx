import type { ReactNode } from "react";

import { Marker, PageHero, SectionShell } from "@/components/page-kit";
import {
  CHANGE_TYPES,
  getReleases,
  type ChangeType,
  type Release,
} from "@/lib/changelog";
import { releasesLatestUrl } from "@/lib/site";

export interface ReleaseNotesCopy {
  eyebrow: string;
  titleLead: string;
  titleMark: string;
  lede: string;
  intro: ReactNode;
  latest: string;
  /** Shown when the notes are not translated. */
  languageNote: string;
  githubReleases: string;
  types: Record<ChangeType, string>;
}

/** `**bold**` and `code` are the only inline markup the changelog uses. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
          return (
            <code
              key={index}
              className="border border-border bg-muted/50 px-1 py-0.5 font-mono text-[0.85em] text-foreground"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return (
            <strong key={index} className="font-bold text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return part;
      })}
    </>
  );
}

function ReleaseBlock({
  release,
  isLatest,
  locale,
  copy,
}: {
  release: Release;
  isLatest: boolean;
  locale: string;
  copy: ReleaseNotesCopy;
}) {
  const id = release.version;
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${release.date}T00:00:00Z`));
  const sections = CHANGE_TYPES.map((type) =>
    release.sections.find((section) => section.type === type),
  ).filter((section) => section && section.entries.length > 0);

  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-24 space-y-6 border-t-2 border-border pt-8"
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* The version is the anchor: /release-notes/#0.8.0 scrolls here. */}
        <a
          href={`#${id}`}
          aria-label={`v${release.version}`}
        >
          <Marker label={`v${release.version}`} />
        </a>
        {isLatest && (
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {copy.latest}
          </span>
        )}
      </div>
      <h2
        id={`${id}-title`}
        className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.04em]"
      >
        <time dateTime={release.date}>{date}</time>
      </h2>
      {sections.map((section) => (
        <div key={section!.type} className="space-y-3">
          <h3 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-foreground">
            {copy.types[section!.type]}
          </h3>
          <ul className="space-y-3 text-base leading-7 text-muted-foreground">
            {section!.entries.map((entry, index) => (
              <li key={index} className="flex gap-3">
                <span aria-hidden="true" className="mt-2.5 h-1.5 w-3 shrink-0 bg-accent" />
                <span>
                  <Inline text={entry} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function ReleaseNotesPage({
  copy,
  locale,
}: {
  copy: ReleaseNotesCopy;
  locale: "en" | "de";
}) {
  const releases = getReleases();
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow={copy.eyebrow}
        title={
          <>
            {copy.titleLead}
            <br />
            <span className="inline-block bg-accent px-[0.12em] text-black">
              {copy.titleMark}
            </span>
          </>
        }
        lede={copy.lede}
      />
      <SectionShell>
        <div className="mx-auto max-w-3xl space-y-10">
          <p className="text-lg leading-8 text-muted-foreground">{copy.intro}</p>
          {locale === "de" && (
            <p className="border-2 border-border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
              {copy.languageNote}
            </p>
          )}
          <nav aria-label="Versions" className="flex flex-wrap gap-2">
            {releases.map((release) => (
              <a
                key={release.version}
                href={`#${release.version}`}
                className="border-2 border-border px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-foreground hover:border-accent hover:bg-accent hover:text-black"
              >
                v{release.version}
              </a>
            ))}
          </nav>
          {releases.map((release, index) => (
            <ReleaseBlock
              key={release.version}
              release={release}
              isLatest={index === 0}
              locale={locale}
              copy={copy}
            />
          ))}
          <p className="border-t-2 border-border pt-8 text-sm text-muted-foreground">
            <a
              href={releasesLatestUrl.replace(/\/latest$/, "")}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline decoration-accent decoration-2 underline-offset-2 hover:text-accent"
            >
              {copy.githubReleases}
            </a>
           
</p>
        </div>
      </SectionShell>
    </main>
  );
}
