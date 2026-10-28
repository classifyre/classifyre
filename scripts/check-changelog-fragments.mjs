#!/usr/bin/env node
// Validates changelog.d fragments (naming + user-facing shape).
// Usage:
//   node scripts/check-changelog-fragments.mjs [file ...]
//   node scripts/check-changelog-fragments.mjs --base origin/develop --head HEAD
// With explicit files, validates those. With --base/--head, validates the
// fragments changed in that range (used by CI). Exits non-zero on failure.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const FRAGMENT_DIR = "changelog.d";
const VALID_TYPES = new Set([
  "added",
  "changed",
  "deprecated",
  "removed",
  "fixed",
  "security",
]);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 80;
const MIN_BODY_LENGTH = 20;
const MAX_BODY_LENGTH = 2000;
// Terminal punctuation, optionally followed by a closing quote/backtick/paren.
const TERMINAL_PUNCT_RE = /[.!?]["'`)\]]?\s*$/;
// Jargon that signals a developer-facing note rather than a user-facing one.
const JARGON_RES = [
  /\bnull\s?check\b/i,
  /\brefactor\b/i,
  /\bJIRA-\d+/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /\(\)\s*(method|function|fix|call)/,
];

function fail(message) {
  console.error(`::error::${message}`);
  process.errorExitCode = 1;
}

function warn(message) {
  console.error(`::warning::${message}`);
}

function validateFile(relativePath) {
  const errors = [];
  const warnings = [];
  const base = path.basename(relativePath);

  if (path.dirname(relativePath) !== FRAGMENT_DIR) {
    return {
      errors: [`${relativePath}: must live in ${FRAGMENT_DIR}/`],
      warnings,
    };
  }
  if (base === "README.md") return { errors, warnings }; // docs, not a fragment

  const match = base.match(/^(.+)\.([a-z]+)\.md$/);
  if (!match) {
    return {
      errors: [
        `${relativePath}: name must be <slug>.<type>.md with type in ${[...VALID_TYPES].join(", ")}`,
      ],
      warnings,
    };
  }
  const [, slug, type] = match;
  if (!VALID_TYPES.has(type)) {
    errors.push(
      `${relativePath}: unknown type "${type}"; expected one of ${[...VALID_TYPES].join(", ")}`,
    );
  }
  if (slug.length > MAX_SLUG_LENGTH || !SLUG_RE.test(slug)) {
    errors.push(
      `${relativePath}: slug "${slug}" must be lowercase kebab-case (letters, digits, hyphens), max ${MAX_SLUG_LENGTH} chars`,
    );
  }

  let body = "";
  try {
    body = fs.readFileSync(relativePath, "utf8").replace(/\r\n/g, "\n").trim();
  } catch {
    errors.push(`${relativePath}: cannot be read`);
    return { errors, warnings };
  }
  if (body.length === 0) {
    errors.push(
      `${relativePath}: fragment is empty; write the user-facing impact as complete sentence(s)`,
    );
    return { errors, warnings };
  }
  if (body.length < MIN_BODY_LENGTH) {
    errors.push(
      `${relativePath}: too short (${body.length} chars, minimum ${MIN_BODY_LENGTH}); describe the user-visible impact`,
    );
  }
  if (body.length > MAX_BODY_LENGTH) {
    errors.push(
      `${relativePath}: too long (${body.length} chars, maximum ${MAX_BODY_LENGTH}); one change per file`,
    );
  }
  if (body.startsWith("#")) {
    errors.push(
      `${relativePath}: must not contain a heading; the release tool adds headings`,
    );
  }
  if (body.startsWith("---")) {
    errors.push(
      `${relativePath}: must not contain frontmatter; the filename carries the type`,
    );
  }
  if (!TERMINAL_PUNCT_RE.test(body)) {
    errors.push(
      `${relativePath}: must end with terminal punctuation (. ! or ?)`,
    );
  }

  // Tone hints are warnings, not failures — CI stays green while reviewers
  // still get a nudge toward user-facing wording.
  const first = body[0];
  if (
    first !== first.toUpperCase() &&
    first !== "`" &&
    first !== '"' &&
    first !== "'"
  ) {
    warnings.push(
      `${relativePath}: start with a capital letter so it reads as a release note`,
    );
  }
  for (const re of JARGON_RES) {
    if (re.test(body)) {
      warnings.push(
        `${relativePath}: looks developer-facing (${re}); describe the user impact instead of the implementation`,
      );
      break;
    }
  }

  return { errors, warnings };
}

function changedFragments(base, head) {
  const range = `${base}...${head}`;
  let out;
  try {
    out = execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACMRT", range],
      {
        encoding: "utf8",
      },
    );
  } catch (error) {
    fail(`could not diff ${range}: ${error.message}`);
    return [];
  }
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) => line.startsWith(`${FRAGMENT_DIR}/`) && line.endsWith(".md"),
    );
}

function main() {
  const args = process.argv.slice(2);
  let files = [];
  const baseIdx = args.indexOf("--base");
  const headIdx = args.indexOf("--head");
  if (
    baseIdx !== -1 &&
    headIdx !== -1 &&
    args[baseIdx + 1] &&
    args[headIdx + 1]
  ) {
    files = changedFragments(args[baseIdx + 1], args[headIdx + 1]);
    if (files.length === 0) {
      console.log(
        "No changelog.d fragments changed in range; nothing to validate.",
      );
      return;
    }
  } else {
    files = args.filter((arg) => !arg.startsWith("--"));
    if (files.length === 0) {
      // No args: validate every fragment currently on disk.
      if (!fs.existsSync(FRAGMENT_DIR)) {
        console.log(`No ${FRAGMENT_DIR}/ directory; nothing to validate.`);
        return;
      }
      files = fs
        .readdirSync(FRAGMENT_DIR)
        .filter((name) => name.endsWith(".md"))
        .map((name) => path.join(FRAGMENT_DIR, name));
    }
  }

  let failed = false;
  for (const file of files) {
    const { errors, warnings } = validateFile(file);
    for (const message of warnings) warn(message);
    if (errors.length > 0) {
      failed = true;
      for (const message of errors) fail(message);
    } else {
      console.log(`ok: ${file}`);
    }
  }
  if (failed) {
    console.error(
      `\nChangelog fragment check failed. See ${FRAGMENT_DIR}/README.md for naming and wording rules.`,
    );
    process.exitCode = 1;
  }
}

main();
