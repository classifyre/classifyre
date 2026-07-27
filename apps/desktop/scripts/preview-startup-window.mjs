#!/usr/bin/env node
/**
 * Renders the startup window's page at real window size for design review,
 * without booting Electron. Writes an HTML file that frames the page in both
 * themes and at each startup phase.
 *
 *   node scripts/preview-startup-window.mjs [outFile]
 */
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const outFile = process.argv[2] ?? path.join(desktopDir, '.vite/startup-preview.html');

// startup-page.ts has no Electron imports, so it can be bundled and imported.
const bundled = await build({
  entryPoints: [path.join(desktopDir, 'src/main/startup-page.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
});
const module = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const { STARTUP_HTML, STARTUP_BOOTSTRAP, STARTUP_STEPS } = module;

const WIDTH = 480;
const HEIGHT = 376;

const scenes = [
  {
    name: 'Cold start · first step',
    state: { step: 'database', detail: 'Creating the local database for the first time…' },
  },
  {
    name: 'Unpacking',
    state: { step: 'runtime', detail: 'Unpacking application components…' },
  },
  {
    name: 'Slow service step (hint shown)',
    state: {
      step: 'service',
      detail: 'Starting the service — first launch runs database migrations (140s)',
    },
    hint: true,
  },
  {
    name: 'Handoff',
    state: { step: 'interface', detail: 'Opening the workspace directory…' },
  },
  {
    name: 'Failure',
    state: {
      title: 'Startup failed',
      error:
        'The embedded PostgreSQL database failed to start.\n\nPostgres init script failed (code: 1, signal: null). ERROR OUTPUT: initdb: error: could not create directory "/Users/you/Library/Application Support/Classifyre/pgdata": Permission denied',
      log: '/Users/you/Library/Application Support/Classifyre/logs/main.log',
    },
  },
];

const frames = (theme) =>
  scenes
    .map(
      (scene, index) => `
  <figure>
    <figcaption>${scene.name}</figcaption>
    <iframe
      data-scene="${index}" data-theme="${theme}"
      width="${WIDTH}" height="${HEIGHT}"
      style="color-scheme: ${theme}"
      srcdoc="${STARTUP_HTML.replace(/"/g, '&quot;')}"></iframe>
  </figure>`,
    )
    .join('');

const page = `<!doctype html>
<meta charset="utf-8">
<title>Startup window preview</title>
<style>
  body { margin: 0; padding: 28px; background: #6b6b6b; font: 12px system-ui; }
  h2 { color: #fff; font: 600 13px system-ui; letter-spacing: .12em; text-transform: uppercase; }
  .row { display: flex; flex-wrap: wrap; gap: 22px; margin-bottom: 34px; }
  figure { margin: 0; }
  figcaption { color: #fff; opacity: .75; margin-bottom: 6px; }
  iframe { border: 0; display: block; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
</style>
<h2>Dark (system default)</h2>
<div class="row">${frames('dark')}</div>
<h2>Light</h2>
<div class="row">${frames('light')}</div>
<script>
  const scenes = ${JSON.stringify(scenes)};
  const bootstrap = ${JSON.stringify(STARTUP_BOOTSTRAP)};
  for (const frame of document.querySelectorAll('iframe')) {
    frame.addEventListener('load', () => {
      const scene = scenes[Number(frame.dataset.scene)];
      const win = frame.contentWindow;
      win.eval(bootstrap);
      win.__startup(scene.state);
      // The 20s hint timer is real; reveal it immediately for the preview.
      if (scene.hint) {
        win.clearTimeout(win.__hintTimer);
        frame.contentDocument.getElementById('hint').classList.add('visible');
      }
    });
  }
</script>
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, page);
console.log(`Wrote ${outFile} (${STARTUP_STEPS.length} steps, ${scenes.length} scenes × 2 themes)`);
