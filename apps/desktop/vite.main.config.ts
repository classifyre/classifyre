import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

function copyStaticRenderers(): import('vite').Plugin {
  const dirs = ['tab-bar'];
  return {
    name: 'copy-static-renderers',
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve('dist');
      for (const dir of dirs) {
        const src = path.resolve(__dirname, `src/renderer/${dir}`);
        const dest = path.join(outDir, dir);
        if (!fs.existsSync(src)) continue;
        fs.cpSync(src, dest, { recursive: true });
      }
      const fontsSrc = path.resolve(__dirname, 'src/renderer/fonts');
      const fontsDest = path.join(outDir, 'fonts');
      if (fs.existsSync(fontsSrc)) {
        fs.cpSync(fontsSrc, fontsDest, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  resolve: {
    conditions: ['node'],
  },
  build: {
    rollupOptions: {
      // Only externalize modules that CANNOT be bundled: embedded-postgres
      // ships native PostgreSQL binaries via its @embedded-postgres/* platform
      // packages. tree-kill and get-port are pure JS — bundling them into the
      // main chunk avoids "Cannot find module" at runtime, since the packaged
      // app (bun's symlinked isolated store → asar) doesn't ship them in
      // node_modules the way externalized requires expect.
      external: ['embedded-postgres', /^@embedded-postgres\//],
    },
  },
  plugins: [copyStaticRenderers()],
});
