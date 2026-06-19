import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    conditions: ['node'],
  },
  build: {
    rollupOptions: {
      external: [
        'embedded-postgres',
        /^@embedded-postgres\//,
        'tree-kill',
        'get-port',
      ],
    },
  },
});
