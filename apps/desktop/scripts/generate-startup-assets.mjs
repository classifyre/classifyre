#!/usr/bin/env node
/**
 * Regenerates src/main/startup-assets.ts — the fonts and icon the startup
 * window inlines (see that file's header for why they must be embedded).
 *
 * Run after the web app's fonts or icon change:
 *   cd apps/web && bun run build     # produces out/_next/static/media/*.woff2
 *   node apps/desktop/scripts/generate-startup-assets.mjs
 *
 * next/font emits content-hashed filenames, so the faces are located by
 * parsing the exported CSS rather than hardcoded.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const webDir = path.resolve(desktopDir, '../web');
const staticDir = path.join(webDir, 'out/_next/static');
const outFile = path.join(desktopDir, 'src/main/startup-assets.ts');

// The face we want is the one covering basic latin — next/font marks it with a
// `U+??` unicode-range (U+0000-00FF), unlike the latin-ext subsets.
function findFace(css, family) {
  const faces = css.match(/@font-face\{[^}]*\}/g) ?? [];
  for (const face of faces) {
    if (!face.includes(`font-family:${family}`)) continue;
    if (!face.includes('U+??')) continue;
    const url = face.match(/media\/([^)]+\.woff2)/)?.[1];
    if (url) return url;
  }
  throw new Error(`No latin @font-face found for ${family}. Rebuild apps/web.`);
}

if (!fs.existsSync(staticDir)) {
  throw new Error(`${staticDir} not found — build apps/web first.`);
}

const css = fs
  .readdirSync(path.join(staticDir, 'chunks'))
  .filter((name) => name.endsWith('.css'))
  .map((name) => fs.readFileSync(path.join(staticDir, 'chunks', name), 'utf-8'))
  .join('\n');

const fonts = {
  ARCHIVO_BLACK_WOFF2: findFace(css, 'Archivo Black'),
  PLEX_SANS_WOFF2: findFace(css, 'IBM Plex Sans'),
  PLEX_MONO_WOFF2: findFace(css, 'IBM Plex Mono'),
};

// The window shows the icon at 40px; 128px covers 3x displays.
const iconSource = path.join(webDir, 'public/clasifyre_icon.png');
const iconScaled = path.join(os.tmpdir(), 'classifyre-startup-icon.png');
if (process.platform === 'darwin') {
  execFileSync('sips', ['-Z', '128', iconSource, '--out', iconScaled], {
    stdio: 'ignore',
  });
} else {
  // No sips outside macOS: fall back to the full-size icon.
  fs.copyFileSync(iconSource, iconScaled);
}

const parts = [
  `// Generated brand assets for the startup window, embedded as base64.
//
// The startup window renders from a data: URL before anything else is
// unpacked, so it cannot reference the web export's font files or the app
// icon on disk (a data: document has an opaque origin and no file access) and
// must work with no network. These are therefore inlined.
//
// Regenerate with \`node scripts/generate-startup-assets.mjs\` whenever the web
// app's fonts (apps/web/app/layout.tsx) or icon change.
`,
];
for (const [name, file] of Object.entries(fonts)) {
  const data = fs.readFileSync(path.join(staticDir, 'media', file));
  parts.push(`/** ${file} */\nexport const ${name} =\n  "${data.toString('base64')}";\n`);
}
const icon = fs.readFileSync(iconScaled);
parts.push(
  `/** clasifyre_icon.png @128px */\nexport const LOGO_PNG =\n  "${icon.toString('base64')}";\n`,
);

fs.writeFileSync(outFile, parts.join('\n'));
console.log(`Wrote ${outFile} (${Math.round(fs.statSync(outFile).size / 1024)} KB)`);
