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
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

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

// ---------------------------------------------------------------------------
// Embedding worker: transformers-embedding.worker.js
// ---------------------------------------------------------------------------
// EmbeddingProviderService spawns a worker_threads Worker at
// path.join(__dirname, 'transformers-embedding.worker.js') (see
// apps/api/src/embedding/embedding-provider.service.ts). That file is never
// require()'d/imported by main.js, so the single-entry bundle above never
// walks into it and it goes missing from the packaged app (the desktop app
// only ships `outfile`). Bundle it as a second, separate esbuild entry point,
// emitted into the SAME directory as `outfile` so that __dirname join
// resolves at runtime unchanged.
//
// @huggingface/transformers already inlines its own heavy pure-JS/wasm deps
// at publish time — @huggingface/jinja, @huggingface/tokenizers, and even
// onnxruntime-web's wasm/webgpu bundle are baked directly into
// dist/transformers.node.cjs (confirmed by inspecting that file: it has no
// `require("@huggingface/jinja")` etc., only source-map-style comments
// showing where the inlined code came from). The ONLY real runtime
// `require()` calls transformers.node.cjs makes for anything outside itself
// are Node builtins plus exactly three packages — `sharp`, `onnxruntime-node`,
// `onnxruntime-common` — all required unconditionally at module scope (not
// lazily), so the worker bundle would throw at load time if any is missing.
// All three resolve native binaries from disk by relative path
// (onnxruntime-node's bin/napi-v6/<platform>/<arch>/onnxruntime_binding.node;
// sharp's @img/sharp-<platform>-<arch> / @img/sharp-libvips-<platform>-<arch>
// addons), so — same rationale as `pg`/Prisma in the `external` list above —
// they must stay external and be staged as real files, not bundled.
const workerEntry = path.join(
  path.dirname(entry),
  'embedding',
  'transformers-embedding.worker.js',
);
if (!fs.existsSync(workerEntry)) {
  console.error(
    `Expected compiled embedding worker at ${workerEntry} — did the nest build output layout change?`,
  );
  process.exit(1);
}
const workerOutfile = path.join(
  path.dirname(outfile),
  'transformers-embedding.worker.js',
);
const workerExternal = ['sharp', 'onnxruntime-node', 'onnxruntime-common'];

await build({
  entryPoints: [workerEntry],
  outfile: workerOutfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
  logOverride: {
    'unsupported-require-call': 'silent',
  },
  external: workerExternal,
});

console.log(`Bundled embedding worker → ${workerOutfile}`);

// --- Stage sharp / onnxruntime-node / onnxruntime-common as real files -----
// Same idea as the KEEP-list npm install stage-resources.sh runs for the main
// bundle's external set, but done here (scoped to exactly what this worker
// needs) because these three packages are transitive deps of
// @huggingface/transformers only — they never appear in apps/api/package.json
// so stage-resources.sh's KEEP-list installer has no way to know about them.
//
// Rather than hardcoding platform package names, walk the ACTUAL dependency
// graph as installed in node_modules: CI builds each desktop platform
// natively (see stage-pgvector.sh / the "build pgvector across CI platforms"
// fix), so bun/npm will only ever have installed the optional
// @img/sharp-<platform>-<arch> / @img/sharp-libvips-<platform>-<arch> pair
// that matches the host running this script — whatever resolves here IS the
// right set to ship.
//
// adm-zip / global-agent are onnxruntime-node's install-script-only deps (it
// downloads prebuilt binaries with them at `npm install` time); its actual
// runtime code (dist/index.js, backend.js, binding.js) requires only
// onnxruntime-common and its own ./backend, ./binding, ./version — verified
// by inspecting those files — so they're excluded to avoid vendoring dead
// weight.
const skipTransitive = new Set(['adm-zip', 'global-agent']);

function findAncestorPackageRoot(name, startDir) {
  let dir = startDir;
  for (;;) {
    const pkgJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      if (pkg.name === name) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

// Resolves the on-disk root directory of `name` as seen from `fromFile`,
// Node-resolution-style (so it follows the same bun-store symlinks esbuild
// itself follows above). Some packages here (sharp's prebuilt @img/sharp-*
// addons) only declare narrow subpath exports (e.g. "./sharp.node") and have
// no "." entry, so a bare require.resolve(name) throws
// ERR_PACKAGE_PATH_NOT_EXPORTED even though the package is installed —
// fall back to scanning require.resolve.paths(name) by directory existence,
// which sidesteps the exports map entirely.
function resolvePackageRoot(name, fromFile) {
  const req = createRequire(fromFile);
  try {
    const entryPath = req.resolve(name);
    const root = findAncestorPackageRoot(name, path.dirname(entryPath));
    if (root) return root;
  } catch {
    // fall through to directory scan below
  }
  for (const candidateBase of req.resolve.paths(name) ?? []) {
    const candidate = path.join(candidateBase, ...name.split('/'));
    const pkgJsonPath = path.join(candidate, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      if (pkg.name === name) return candidate;
    }
  }
  return undefined;
}

function collectPackageDirs(names, fromFile, seen) {
  for (const name of names) {
    if (seen.has(name) || skipTransitive.has(name)) continue;
    const dir = resolvePackageRoot(name, fromFile);
    if (!dir) {
      // Expected for the ~20 @img/sharp-<other-platform> optional deps that
      // don't apply to this build host.
      continue;
    }
    seen.set(name, dir);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const depNames = Object.keys({
      ...(pkg.dependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    });
    collectPackageDirs(depNames, path.join(dir, 'package.json'), seen);
  }
}

const transformersRoot = resolvePackageRoot('@huggingface/transformers', workerEntry);
if (!transformersRoot) {
  console.error('Could not resolve @huggingface/transformers from ' + workerEntry);
  process.exit(1);
}
const packageDirs = new Map();
collectPackageDirs(
  workerExternal,
  path.join(transformersRoot, 'package.json'),
  packageDirs,
);

// The output dir may already hold the npm-installed KEEP tree (stage-resources
// runs `npm install` before this script), so never remove node_modules
// wholesale — stage per package, and let an already-installed copy win: the
// only overlap is ubiquitous leaves like semver/detect-libc, where either
// resolution satisfies the staged consumers.
const workerNodeModules = path.join(path.dirname(workerOutfile), 'node_modules');
for (const [name, dir] of packageDirs) {
  const dest = path.join(workerNodeModules, name);
  if (fs.existsSync(dest)) continue;
  fs.cpSync(dir, dest, {
    recursive: true,
    dereference: true, // these are bun-store symlinks; copy real file contents
    // Each dependency is staged at the node_modules top level above; skip any
    // NESTED node_modules within this package (relative to its own root — the
    // absolute src path always contains a "node_modules" segment just by
    // virtue of living in the bun store) so we don't recursively duplicate
    // trees already collected separately.
    filter: (src) => {
      const rel = path.relative(dir, src);
      return rel === '' || !rel.split(path.sep).includes('node_modules');
    },
  });
}

// onnxruntime-node ships prebuilt native binaries for EVERY platform inside
// its own package (bin/napi-v6/{linux,darwin,win32}/{x64,arm64,...}/*) rather
// than as separate optional npm packages — ~210MB uncompressed for all of
// them combined. Keep only this build host's platform/arch (CI builds
// natively per platform, same assumption stage-pgvector.sh makes for its
// native binary).
const ortBinDir = path.join(workerNodeModules, 'onnxruntime-node', 'bin');
if (fs.existsSync(ortBinDir)) {
  for (const napiDir of fs.readdirSync(ortBinDir)) {
    const platformsDir = path.join(ortBinDir, napiDir);
    for (const platformName of fs.readdirSync(platformsDir)) {
      const platformDir = path.join(platformsDir, platformName);
      if (platformName !== process.platform) {
        fs.rmSync(platformDir, { recursive: true, force: true });
        continue;
      }
      for (const archName of fs.readdirSync(platformDir)) {
        if (archName !== process.arch) {
          fs.rmSync(path.join(platformDir, archName), {
            recursive: true,
            force: true,
          });
        }
      }
    }
  }
}

console.log(
  `Staged ${packageDirs.size} embedding-worker package(s) (${[...packageDirs.keys()].join(', ')}) → ${workerNodeModules}`,
);
