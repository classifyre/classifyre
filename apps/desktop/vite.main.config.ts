import { defineConfig } from 'vite';

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
});
