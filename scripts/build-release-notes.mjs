#!/usr/bin/env node
// Compiles changelog.d fragments into a CHANGELOG.md section and a GitHub
// Release body file.
// Usage:
//   node scripts/build-release-notes.mjs <version> [--date YYYY-MM-DD]
//     [--write] [--notes-file <path>] [--changelog <path>] [--fragments <dir>]
//
// Without --write: prints the section that WOULD be created (or, when no
// fragments exist, a fallback note) and optionally writes it to --notes-file.
// With --write: prepends the section to CHANGELOG.md (creating the file if
// needed), deletes the consumed fragments, and writes --notes-file when asked.
// With no fragments and --write: leaves CHANGELOG.md untouched.

import fs from "node:fs";
import path from "node:path";

const TYPE_HEADINGS = [
  ["added", "Added"],
  ["changed", "Changed"],
  ["deprecated", "Deprecated"],
  ["removed", "Removed"],
  ["fixed", "Fixed"],
  ["security", "Security"],
];
const VALID_TYPES = new Set(TYPE_HEADINGS.map(([type]) => type));
const FALLBACK_NOTE = "_No user-facing changes in this release._";

function parseArgs(argv) {
  const opts = {
    version: null,
    date: new Date().toISOString().slice(0, 10),
    write: false,
    notesFile: null,
    changelog: "CHANGELOG.md",
    fragments: "changelog.d",
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") opts.write = true;
    else if (arg === "--date") opts.date = argv[++i];
    else if (arg === "--notes-file") opts.notesFile = argv[++i];
    else if (arg === "--changelog") opts.changelog = argv[++i];
    else if (arg === "--fragments") opts.fragments = argv[++i];
    else if (arg.startsWith("--")) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    } else positional.push(arg);
  }
  opts.version = positional[0] ?? null;
  return opts;
}

function readFragments(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => {
      const match = name.match(/^(.+)\.([a-z]+)\.md$/);
      const body = fs
        .readFileSync(path.join(dir, name), "utf8")
        .replace(/\r\n/g, "\n")
        .trim();
      return {
        file: path.join(dir, name),
        name,
        body,
        type: match?.[2] ?? null,
      };
    })
    .filter((fragment) => {
      if (!VALID_TYPES.has(fragment.type)) {
        console.error(
          `::error::${fragment.file}: unknown type "${fragment.type}"`,
        );
        process.exitCode = 1;
        return false;
      }
      if (!fragment.body) {
        console.error(`::error::${fragment.file}: fragment is empty`);
        process.exitCode = 1;
        return false;
      }
      return true;
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

function oneLine(body) {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function renderSection(version, date, fragments) {
  const lines = [`## [${version}] - ${date}`, ""];
  for (const [type, heading] of TYPE_HEADINGS) {
    const group = fragments.filter((fragment) => fragment.type === type);
    if (group.length === 0) continue;
    lines.push(`### ${heading}`, "");
    for (const fragment of group) lines.push(`- ${oneLine(fragment.body)}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function extractSection(changelog, version) {
  if (!fs.existsSync(changelog)) return null;
  const text = fs.readFileSync(changelog, "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf(`## [${version}]`);
  if (start === -1) return null;
  const rest = text.slice(start);
  const next = rest.slice(1).search(/^## \[/m);
  return (next === -1 ? rest : rest.slice(0, next + 1)).trimEnd() + "\n";
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.version || !/^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/.test(opts.version)) {
    console.error(
      "Usage: node scripts/build-release-notes.mjs <major.minor.patch[-prerelease]> [--write] [--notes-file <path>]",
    );
    process.exit(2);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    console.error(`Invalid --date "${opts.date}"; expected YYYY-MM-DD`);
    process.exit(2);
  }

  const fragments = readFragments(opts.fragments);
  if (process.exitCode) process.exit(process.exitCode);

  // No fragments: release body falls back; CHANGELOG stays untouched so
  // purely technical releases do not pollute it.
  if (fragments.length === 0) {
    const existing = extractSection(opts.changelog, opts.version);
    const notes = existing ?? `${FALLBACK_NOTE}\n`;
    if (opts.notesFile) fs.writeFileSync(opts.notesFile, notes);
    else process.stdout.write(notes);
    console.error(
      "No changelog fragments found; wrote fallback release notes.",
    );
    return;
  }

  const section = renderSection(opts.version, opts.date, fragments);

  if (!opts.write) {
    if (opts.notesFile) fs.writeFileSync(opts.notesFile, section);
    process.stdout.write(section);
    return;
  }

  if (
    fs.existsSync(opts.changelog) &&
    extractSection(opts.changelog, opts.version)
  ) {
    console.error(
      `::error::${opts.changelog} already contains [${opts.version}]; refusing to duplicate`,
    );
    process.exit(1);
  }

  let changelogText = fs.existsSync(opts.changelog)
    ? fs.readFileSync(opts.changelog, "utf8").replace(/\r\n/g, "\n")
    : "# Changelog\n\nAll notable user-facing changes are recorded here.\n";
  if (!changelogText.endsWith("\n")) changelogText += "\n";
  // Insert the new section before the first existing "## " release heading
  // (i.e. after the header preamble), so the newest release stays on top.
  const lines = changelogText.split("\n");
  let insertAt = lines.findIndex((line) => line.startsWith("## "));
  if (insertAt === -1) insertAt = lines.length;
  const before = lines.slice(0, insertAt).join("\n").trimEnd();
  const after = lines.slice(insertAt).join("\n").trimStart();
  const next =
    `${before}\n\n${section.trimEnd()}\n${after === "" ? "" : `\n${after}`}`
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n";
  fs.writeFileSync(opts.changelog, next);

  for (const fragment of fragments) fs.unlinkSync(fragment.file);
  if (opts.notesFile) fs.writeFileSync(opts.notesFile, section);
  console.log(
    `Compiled ${fragments.length} fragment(s) into ${opts.changelog} under [${opts.version}].`,
  );
}

main();
