# changelog.d

Per-PR, human-written **release note fragments**. One tiny file per user-facing
change. A tool compiles them into [`CHANGELOG.md`](../CHANGELOG.md) at release
time, so PR titles and commit messages never leak into release notes.

## Do I need one?

- **Yes** — any change a user, operator, or admin would notice: new features,
  behavior changes, fixes, deprecations, removals, security fixes, migration
  or upgrade steps.
- **No** — refactors, tests, CI, docs typos, dependency bumps with no behavior
  change. Put the `skip-changelog` label on the PR instead (CI enforces
  "fragment or label").

## Naming

```
changelog.d/<slug>.<type>.md
```

- `<slug>`: the PR number (`1234`) or a short kebab-case slug
  (`fix-empty-export-crash`). Lowercase letters, digits, hyphens only.
- `<type>`: one of `added`, `changed`, `deprecated`, `removed`, `fixed`,
  `security` (Keep a Changelog order).
- One change per file. A PR with two user-facing changes adds two files.

## Content

Plain Markdown, one entry — no frontmatter, no `#` headings. The filename
carries the type; the file carries only the note.

```md
Exports no longer fail when a report has an empty date range.
```

Rules: complete sentence(s) ending in `.`, `!`, or `?`; describe the
**impact on the user**, not the implementation; past or present tense
consistently; no ticket jargon (`JIRA-123`, `PR #456`, `null check`,
`refactor FooService`).

Good:

- `You can now schedule scans to repeat weekly from the scan creation form.`
- `Exports no longer fail when a report has an empty date range.`
- `The Jira connector requires re-authentication after this upgrade; existing tokens are revoked.`

Bad:

- `Fix null check in ReportExporter.` (implementation, not impact)
- `refactor + tests` (not a sentence, not user-facing)
- `JIRA-123 done` (ticket jargon)

## Lifecycle

Fragments are merged to `develop` with the PR. At release,
`scripts/build-release-notes.mjs` groups them by type under the new version
heading in `CHANGELOG.md`, uses that section as the GitHub Release body, and
deletes the fragments. Never edit `CHANGELOG.md` by hand for a normal release
entry — add a fragment instead.

Validate locally before pushing:

```sh
node scripts/check-changelog-fragments.mjs changelog.d/1234.fixed.md
```
