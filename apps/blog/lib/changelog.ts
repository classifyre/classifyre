import fs from "node:fs";
import path from "node:path";

/**
 * Reads the monorepo's `CHANGELOG.md` at build time (the blog is a static
 * export, so this runs once per build). The file is compiled from
 * `changelog.d/` fragments at release time — see `changelog.d/README.md` — so
 * the website never has its own copy of the release notes to keep in sync.
 *
 * Entries are written in English only; the German page translates the chrome,
 * not the notes.
 */

export const CHANGE_TYPES = [
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
  "Security",
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export interface ReleaseSection {
  type: ChangeType;
  entries: string[];
}

export interface Release {
  version: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  sections: ReleaseSection[];
}

const changelogPath = path.join(process.cwd(), "..", "..", "CHANGELOG.md");

export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: ReleaseSection | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\s*$/.exec(line);
    if (heading) {
      release = { version: heading[1]!, date: heading[2]!, sections: [] };
      releases.push(release);
      section = null;
      continue;
    }
    if (!release) continue;

    const type = /^### (.+?)\s*$/.exec(line)?.[1];
    if (type) {
      section = (CHANGE_TYPES as readonly string[]).includes(type)
        ? { type: type as ChangeType, entries: [] }
        : null;
      if (section) release.sections.push(section);
      continue;
    }

    if (section && line.startsWith("- ")) {
      section.entries.push(line.slice(2).trim());
    } else if (section && line.startsWith("  ") && section.entries.length) {
      // Wrapped continuation of the previous bullet.
      section.entries[section.entries.length - 1] += ` ${line.trim()}`;
    }
  }
  return releases;
}

export function getReleases(): Release[] {
  return parseChangelog(fs.readFileSync(changelogPath, "utf8"));
}
