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
      external: [
        'embedded-postgres',
        /^@embedded-postgres\//,
        'electron-updater',
        'tree-kill',
        'get-port',
      ],
    },
  },
  plugins: [copyStaticRenderers()],
});
