---
name: release-notes
description: Write business-facing release notes as changelog.d fragments and enforce the fragment-or-skip-label rule. Use when implementing a user-facing change, when asked for release notes or a changelog entry, or when a PR needs its release-notes fragment.
---

# Release Notes

Release notes are written for **users**, not developers, and they live apart
from git history. Each PR carries its note as a small fragment file; a tool
compiles fragments into `CHANGELOG.md` at release time. PR titles and commit
messages are never used as release notes.

## The Rule

Every PR to `main` or `develop` needs exactly one of:

1. A fragment file in `changelog.d/` — any change a user, operator, or admin
   would notice.
2. The `skip-changelog` label — purely technical PRs only (refactors, tests,
   CI, docs typos, dependency bumps with no behavior change). Dependabot PRs
   are exempt automatically.

CI (`.github/workflows/changelog.yml`) fails the PR otherwise. When you
finish implementing a user-facing change, write the fragment file yourself —
do not leave it for the author.

## Fragment Format

```
changelog.d/<slug>.<type>.md
```

- `<slug>`: PR number (`1234`) or short kebab-case (`fix-empty-export-crash`).
- `<type>`: one of the following. One change per file; two user-facing changes
  means two files.

| Type       | Use for                                     |
| ---------- | ------------------------------------------- |
| added      | New features, connectors, options           |
| changed    | Behavior changes, migrations, upgrade steps |
| deprecated | Soon-to-be-removed functionality            |
| removed    | Removed functionality                       |
| fixed      | Bug fixes                                   |
| security   | Security fixes                              |

Content is plain Markdown: no frontmatter, no `#` headings. The filename
carries the type; the file carries only the note.

## Writing Rules

- Complete sentence(s) ending in `.`, `!`, or `?`.
- Describe the **impact on the user**, never the implementation.
- Consistent tense (present or past) within the entry.
- No ticket jargon: no `JIRA-123`, `PR #456`, `null check`, `refactor X`.
- Start with a capital letter.

Good:

- `You can now schedule scans to repeat weekly from the scan creation form.`
- `Exports no longer fail when a report has an empty date range.`
- `The Jira connector requires re-authentication after this upgrade; existing tokens are revoked.`

Bad:

- `Fix null check in ReportExporter.` (implementation, not impact)
- `refactor + tests` (not a sentence, not user-facing)
- `JIRA-123 done` (ticket jargon)

## Validate

After writing a fragment, run the same check CI runs:

```sh
node scripts/check-changelog-fragments.mjs changelog.d/<your-file>.md
# or: bun run changelog:check
```

## How It Ships

- Fragments merge to `develop` with the PR.
- At release, `scripts/build-release-notes.mjs` groups them by type under the
  new version heading in `CHANGELOG.md` and deletes them.
- The GitHub Release body is extracted from that `CHANGELOG.md` section, so
  the changelog and the release page always match.

Never edit `CHANGELOG.md` by hand for a normal entry — add a fragment
instead. Never paste PR titles or commit messages into release notes.
