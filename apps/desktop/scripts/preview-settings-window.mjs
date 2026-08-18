#!/usr/bin/env node
/**
 * Renders the settings window's page at real window size for design review,
 * without booting Electron. The `settingsAPI` bridge is stubbed, so the page
 * can be exercised (toggles, validation warnings, the read-only details) the
 * same way it behaves in the app.
 *
 *   node scripts/preview-settings-window.mjs [outFile]
 */
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const outFile = process.argv[2] ?? path.join(desktopDir, '.vite/settings-preview.html');

// settings-page.ts has no Electron imports, so it can be bundled and imported.
const bundled = await build({
  entryPoints: [path.join(desktopDir, 'src/main/settings-page.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
});
const module = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`,
);
const { SETTINGS_HTML } = module;

const WIDTH = 620;
const HEIGHT = 760;

const scenes = [
  {
    name: 'Defaults',
    state: {
      settings: {
        apiPort: 0,
        postgresPort: 54320,
        runInBackground: true,
        desktopNotifications: true,
        memoryLimitMb: 0,
        maxConcurrentRunners: 2,
        readonlyDbEnabled: false,
      },
      effective: { apiPort: 51872, postgresPort: 54320 },
      readonly: null,
    },
  },
  {
    name: 'Tuned, read-only published',
    state: {
      settings: {
        apiPort: 8123,
        postgresPort: 54321,
        runInBackground: false,
        desktopNotifications: true,
        memoryLimitMb: 6144,
        maxConcurrentRunners: 0,
        readonlyDbEnabled: true,
      },
      effective: { apiPort: 8123, postgresPort: 54321 },
      readonly: {
        host: '192.168.1.42',
        port: 54321,
        database: 'classifyre',
        user: 'classifyre_readonly',
        password: 'yBqk3Xt7wQ9r0sHfLzN2vJdE4pGmA1cU',
        connectionString:
          'postgresql://classifyre_readonly:yBqk3Xt7wQ9r0sHfLzN2vJdE4pGmA1cU@192.168.1.42:54321/classifyre',
      },
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
      data-scene="${index}"
      width="${WIDTH}" height="${HEIGHT}"
      style="color-scheme: ${theme}"
      srcdoc="${SETTINGS_HTML.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>
  </figure>`,
    )
    .join('');

const page = `<!doctype html>
<meta charset="utf-8">
<title>Settings window preview</title>
<style>
  body { margin: 0; padding: 28px; background: #6b6b6b; font: 12px system-ui; }
  h2 { color: #fff; font: 600 13px system-ui; letter-spacing: .12em; text-transform: uppercase; }
  .row { display: flex; flex-wrap: wrap; gap: 22px; margin-bottom: 34px; }
  figure { margin: 0; }
  figcaption { color: #fff; opacity: .75; margin-bottom: 6px; }
  iframe { border: 0; display: block; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
</style>
<h2>Light</h2>
<div class="row">${frames('light')}</div>
<h2>Dark (system default on this machine)</h2>
<div class="row">${frames('dark')}</div>
<script>
  const scenes = ${JSON.stringify(scenes)};
  for (const frame of document.querySelectorAll('iframe')) {
    const scene = scenes[Number(frame.dataset.scene)];
    // Install the stub before the page's own script runs.
    frame.contentWindow.settingsAPI = {
      load: () => Promise.resolve(scene.state),
      save: () => Promise.resolve({ ok: true }),
      regenerateReadonly: () => Promise.resolve(scene.state.readonly),
      copy: () => {},
      close: () => {},
    };
  }
</script>
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, page);
console.log(`Wrote ${outFile} (${scenes.length} scenes × 2 themes)`);
