// Bundles the compiled NestJS API (apps/api/dist) into a single CommonJS file
// for the desktop app. Called from stage-resources.sh.
//
//   node scripts/bundle-api.mjs <api-dist-main-js> <outfile>
//
// Why bundle the tsc OUTPUT and not the TS sources: esbuild cannot emit
// TypeScript decorator metadata (design:paramtypes), which NestJS DI depends
// on. `nest build` already emitted those __decorate/__metadata calls into
// dist/, so we bundle that.
//
// Strategy: bundle the heavy leaf SDKs (@aws-sdk, openai, @slack, @anthropic,
// @google/genai, @modelcontextprotocol, pg-boss, zod, ajv, …) into one file,
// but keep the FRAMEWORK layer external as real files on disk. Framework
// packages either (a) resolve native binaries / on-disk data by path
// (@prisma/client engines, swagger-ui-dist assets, natural's wordnet-db), or
// (b) rely on runtime `require(variableName)` (Nest's optional loadPackage for
// microservices/websockets, class-transformer's /storage) which a bundle can't
// satisfy, or (c) must keep a SINGLE shared instance whose object identity
// crosses the app↔framework boundary (rxjs Observables flow through Nest;
// reflect-metadata is a global polyfill; pg is shared with @prisma/adapter-pg).
// stage-resources.sh installs exactly this external set into the staged
// node_modules, so the file count drops from ~60k to a few thousand.

import { build } from 'esbuild';

const [, , entry, outfile] = process.argv;
if (!entry || !outfile) {
  console.error('usage: node bundle-api.mjs <entry> <outfile>');
  process.exit(2);
}

// Packages that must remain real files in the staged node_modules. Keep this
// list in sync with the KEEP set in stage-resources.sh (the minimal install).
// Wildcards use esbuild's `*` matcher.
const external = [
  // Prisma: generated client + native query engines + CLI (spawned separately
  // at runtime via `prisma migrate deploy`). Never bundle.
  '@prisma/*',
  '.prisma/*',
  'prisma',
  // NestJS framework + DI. Nest's loadPackage() does runtime require(variable)
  // for optional deps (@nestjs/microservices, @nestjs/websockets, …); keeping
  // all of @nestjs external means those resolve from disk as Nest expects.
  '@nestjs/*',
  // Fastify stack — driven by @nestjs/platform-fastify (external).
  'fastify',
  '@fastify/*',
  // rxjs Observable instances cross the app↔Nest boundary; a duplicated bundled
  // copy would break instanceof/operator interop. Single on-disk copy.
  'rxjs',
  'rxjs/*',
  // Global metadata polyfill — must be a single instance.
  'reflect-metadata',
  // class-transformer does a runtime require('class-transformer/storage');
  // class-validator uses the same metadata storage pattern.
  'class-transformer',
  'class-transformer/*',
  'class-validator',
  'class-validator/*',
  // Swagger UI static assets resolved from disk by SwaggerModule.setup.
  'swagger-ui-dist',
  'swagger-ui-dist/*',
  // NOTE: `natural` is NOT external. The app only requires three pure-JS
  // sub-modules (natural/lib/natural/{phonetics,distance,tokenizers}); esbuild
  // bundles exactly those. Keeping natural external would drag in its optional
  // storage backends (mongoose→mongodb, redis, memjs, …) — thousands of files —
  // none of which those sub-modules touch. Only natural's wordnet module needs
  // on-disk data (wordnet-db), and the app never uses it.
  // Shared with @prisma/adapter-pg (which builds its own pool from this module)
  // and used by bundled pg-boss / pg-query-stream — one on-disk copy.
  'pg',
  'pg/*',
  'pg-native',
  // socket.io shared with @nestjs/platform-socket.io (external).
  'socket.io',
  'socket.io/*',
  // Kubernetes job runner: lazy `await import()`, never exercised on desktop.
  // External + omitted from the staged install (the import only throws if a
  // k8s job mode is used, which desktop never does).
  '@kubernetes/client-node',
  // NOTE: @workspace/schemas is deliberately NOT external — esbuild compiles
  // its TypeScript sources straight into the bundle (along with its `zod`
  // dependency). The JSON schema files it also ships are loaded elsewhere by
  // filesystem path (see apps/api utils/schema-path.ts), not via require, so
  // bundling the JS half changes nothing there.
  // OpenTelemetry is stubbed out below (desktop ships no tracing); listing it
  // external is belt-and-suspenders so a stray import can never pull it in.
  '@opentelemetry/*',
];

// Desktop ships no telemetry, and OpenTelemetry's auto-instrumentation patches
// require() in ways that break when bundled. main.js does `require("./tracing")`
// as its very first statement; replace that module with an empty stub so none
// of @opentelemetry/* enters the graph (it is ~20k files otherwise).
const stubTracing = {
  name: 'stub-tracing',
  setup(b) {
    b.onResolve({ filter: /^\.\/tracing$/ }, () => ({
      path: 'api-tracing-stub',
      namespace: 'stub',
    }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: '// tracing disabled in desktop build',
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // Electron's bundled Node runs this; keep it debuggable but not source-mapped
  // (dist source maps point at the original TS which we don't ship).
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
  logOverride: {
    // Dynamic `require()`/`import()` inside bundled deps that esbuild can't
    // statically resolve are expected (they resolve at runtime or are optional).
    'unsupported-require-call': 'silent',
  },
  external,
  plugins: [stubTracing],
});

console.log(`Bundled API → ${outfile}`);
