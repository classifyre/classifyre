// Re-sign the packaged macOS .app with the MODERN @electron/osx-sign (2.x),
// then hand off to notarization. Called from the release workflow after
// `forge package`:
//
//   node scripts/resign-macos.mjs <path-to-Classifyre.app>
//
// Why this exists: Apple's notary rejected builds with "The signature of the
// binary is invalid" on the Electron helper apps (GPU/Renderer/Plugin). Those
// signatures are produced by the osx-sign that @electron/packager 18.4.4 pins
// (`^1.0.5` → 1.3.3, the last CJS release). packager cannot use osx-sign 2.x
// because it `require()`s the module and 2.x is ESM-only (Node >=22.12), which
// is why the whole tree is stuck on 1.3.3 for packaging. This standalone ESM
// script is NOT bound by that constraint: apps/desktop depends directly on
// `@electron/osx-sign@^2.5.0`, so importing it here resolves the modern signer
// and re-signs the final bundle that actually goes to the notary — replacing
// 1.3.3's signatures wholesale.
//
// osx-sign 2.x signs strictly inside-out (helpers deepest-first, top-level app
// last), applies the correct per-helper default entitlements, and runs
// sequentially. The re-sign of this bundle takes ~40s (api ships as a single
// api.tar.gz, so the Mach-O count is modest).
//
// The optionsForFile mapping MUST stay in sync with apps/desktop/forge.config.ts
// (the Python resources need disable-library-validation via
// build/entitlements.python.plist so runtime-installed native extensions load;
// everything else keeps osx-sign's stricter per-file defaults).

import path from 'path';
import { fileURLToPath } from 'url';
import { sign } from '@electron/osx-sign';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const appPath = process.argv[2];
if (!appPath) {
  console.error('Usage: node scripts/resign-macos.mjs <path-to-app>');
  process.exit(1);
}

// Keep in sync with forge.config.ts.
const pythonEntitlements = path.resolve(__dirname, '..', 'build/entitlements.python.plist');
const isPythonResource = (filePath) =>
  filePath.includes('/Contents/Resources/python/') ||
  filePath.includes('/Contents/Resources/venv/');

// Pin the identity when provided (APPLE_SIGNING_IDENTITY); otherwise let
// osx-sign auto-discover the "Developer ID Application" identity from the
// keychain, exactly as the packaging step does.
const signingIdentity = process.env['APPLE_SIGNING_IDENTITY'];

await sign({
  app: appPath,
  platform: 'darwin',
  ...(signingIdentity ? { identity: signingIdentity } : {}),
  optionsForFile: (filePath) =>
    isPythonResource(filePath) ? { entitlements: pythonEntitlements } : {},
});

console.log(`Re-signed ${appPath}`);
